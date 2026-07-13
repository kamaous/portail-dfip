const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { getDb } = require('../db/connection');
const { auth, requireRole } = require('../middleware/auth');
const { sendEmail, templates } = require('../services/email');
const { UPLOAD_DIR } = require('../config');

const router = express.Router();

// Configuration multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_DIR, 'calendriers');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `cal_${Date.now()}_${req.user.id}${ext}`;
    cb(null, name);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.xlsx', '.xls', '.csv'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers Excel (.xlsx, .xls) et CSV sont acceptés'));
    }
  }
});

// Garde : une année académique doit exister (créée par le Directeur) avant tout calendrier
function exigerAnnee(req, res, next) {
  const db = getDb();
  const nb = db.prepare('SELECT COUNT(*) as c FROM annees_academiques').get().c;
  if (nb === 0) {
    return res.status(409).json({ error: "Aucune année académique n'existe. Le Directeur doit d'abord créer l'année académique." });
  }
  // L'année ciblée doit exister
  const annee_id = req.body.annee_id;
  if (annee_id && !db.prepare('SELECT 1 FROM annees_academiques WHERE id = ?').get(annee_id)) {
    return res.status(400).json({ error: "Année académique invalide." });
  }
  next();
}

// GET /api/calendriers
router.get('/', auth, (req, res) => {
  const db = getDb();
  const { annee_id, pole_id } = req.query;

  let query = `
    SELECT c.*,
      u.nom as uploaded_by_nom, u.prenom as uploaded_by_prenom,
      v.nom as valide_par_nom, v.prenom as valide_par_prenom,
      p.nom as pole_nom, pf.nom as filiere_nom,
      s.nom as semestre_nom, aa.libelle as annee_libelle
    FROM calendriers c
    JOIN users u ON u.id = c.uploaded_by
    LEFT JOIN users v ON v.id = c.valide_par
    JOIN poles p ON p.id = c.pole_id
    JOIN annees_academiques aa ON aa.id = c.annee_id
    LEFT JOIN promo_filieres pf ON pf.id = c.promo_filiere_id
    LEFT JOIN semestres s ON s.id = c.semestre_id
    WHERE 1=1
  `;
  const params = [];

  if (annee_id) { query += ' AND c.annee_id = ?'; params.push(annee_id); }
  if (pole_id) { query += ' AND c.pole_id = ?'; params.push(pole_id); }

  // Les membres de pôle voient seulement leur pôle
  if (req.user.role === 'MEMBRE_POLE' && req.user.pole_id) {
    query += ' AND c.pole_id = ?';
    params.push(req.user.pole_id);
  }

  query += ' ORDER BY c.created_at DESC';
  res.json(db.prepare(query).all(...params));
});

// POST /api/calendriers/upload
router.post('/upload', auth, upload.single('fichier'), exigerAnnee, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Fichier requis' });

  const { annee_id, pole_id, promo_filiere_id, semestre_id } = req.body;
  if (!annee_id || !pole_id) return res.status(400).json({ error: 'annee_id et pole_id requis' });

  const db = getDb();
  const result = db.prepare(`
    INSERT INTO calendriers (annee_id, pole_id, promo_filiere_id, semestre_id, uploaded_by, fichier_nom, fichier_path, mode)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'FICHIER')
  `).run(annee_id, pole_id, promo_filiere_id || null, semestre_id || null, req.user.id, req.file.originalname, req.file.filename);

  const cal = db.prepare('SELECT * FROM calendriers WHERE id = ?').get(result.lastInsertRowid);
  const pole = db.prepare('SELECT * FROM poles WHERE id = ?').get(pole_id);
  const annee = db.prepare('SELECT * FROM annees_academiques WHERE id = ?').get(annee_id);

  // Notifier le Directeur et les Chefs de service
  const admins = db.prepare(`SELECT * FROM users WHERE role IN ('DIRECTEUR', 'CHEF_SERVICE') AND actif = 1`).all();
  admins.forEach(admin => {
    db.prepare(`INSERT INTO notifications (user_id, titre, message, type, lien) VALUES (?, ?, ?, ?, ?)`)
      .run(admin.id, 'Calendrier uploadé', `${req.user.prenom} ${req.user.nom} a uploadé un calendrier pour ${pole?.nom}`, 'CALENDRIER', `/calendriers/${cal.id}`);
    const tpl = templates.calendrierUploade(req.user, pole?.nom || 'N/A', annee?.libelle || '');
    sendEmail({ to: admin.email, ...tpl });
  });

  db.prepare(`INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)`)
    .run(req.user.id, 'UPLOAD_CALENDRIER', 'CALENDRIERS', `pole=${pole_id}, annee=${annee_id}`);

  res.status(201).json(cal);
});

// POST /api/calendriers/manuel — créer un calendrier saisi manuellement (+ événements)
router.post('/manuel', auth, exigerAnnee, (req, res) => {
  const { annee_id, pole_id, promo_filiere_id, semestre_id, evenements } = req.body;
  if (!annee_id || !pole_id) return res.status(400).json({ error: 'annee_id et pole_id requis' });

  const db = getDb();
  const tx = db.transaction(() => {
    const r = db.prepare(`
      INSERT INTO calendriers (annee_id, pole_id, promo_filiere_id, semestre_id, uploaded_by, fichier_nom, fichier_path, mode)
      VALUES (?, ?, ?, ?, ?, ?, '', 'MANUEL')
    `).run(annee_id, pole_id, promo_filiere_id || null, semestre_id || null, req.user.id, '(saisie manuelle)');
    const calId = r.lastInsertRowid;

    const ins = db.prepare(`
      INSERT INTO calendrier_evenements (calendrier_id, type, libelle, date_debut, date_fin, description)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    (Array.isArray(evenements) ? evenements : []).forEach(ev => {
      if (ev.libelle && ev.date_debut) {
        ins.run(calId, ev.type || 'AUTRE', ev.libelle, ev.date_debut, ev.date_fin || null, ev.description || null);
      }
    });
    return calId;
  });

  const calId = tx();
  const cal = db.prepare('SELECT * FROM calendriers WHERE id = ?').get(calId);
  const pole = db.prepare('SELECT * FROM poles WHERE id = ?').get(pole_id);
  const annee = db.prepare('SELECT * FROM annees_academiques WHERE id = ?').get(annee_id);

  // Notifier Directeur + Chefs de service
  const admins = db.prepare(`SELECT * FROM users WHERE role IN ('DIRECTEUR', 'CHEF_SERVICE') AND actif = 1`).all();
  admins.forEach(admin => {
    db.prepare(`INSERT INTO notifications (user_id, titre, message, type, lien) VALUES (?, ?, ?, ?, ?)`)
      .run(admin.id, 'Calendrier saisi', `${req.user.prenom} ${req.user.nom} a saisi un calendrier pour ${pole?.nom}`, 'CALENDRIER', `/calendriers`);
    const tpl = templates.calendrierUploade(req.user, pole?.nom || 'N/A', annee?.libelle || '');
    sendEmail({ to: admin.email, ...tpl });
  });

  db.prepare(`INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)`)
    .run(req.user.id, 'CREATE_CALENDRIER_MANUEL', 'CALENDRIERS', `pole=${pole_id}, annee=${annee_id}`);

  res.status(201).json(cal);
});

// GET /api/calendriers/:id/evenements
router.get('/:id/evenements', auth, (req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM calendrier_evenements WHERE calendrier_id = ? ORDER BY date_debut').all(req.params.id));
});

// POST /api/calendriers/:id/evenements — ajouter un événement
router.post('/:id/evenements', auth, (req, res) => {
  const { type, libelle, date_debut, date_fin, description } = req.body;
  if (!libelle || !date_debut) return res.status(400).json({ error: 'Libellé et date de début requis' });
  const db = getDb();
  const cal = db.prepare('SELECT * FROM calendriers WHERE id = ?').get(req.params.id);
  if (!cal) return res.status(404).json({ error: 'Calendrier introuvable' });
  const r = db.prepare(`
    INSERT INTO calendrier_evenements (calendrier_id, type, libelle, date_debut, date_fin, description)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.params.id, type || 'AUTRE', libelle, date_debut, date_fin || null, description || null);
  res.status(201).json(db.prepare('SELECT * FROM calendrier_evenements WHERE id = ?').get(r.lastInsertRowid));
});

// DELETE /api/calendriers/:id/evenements/:eid
router.delete('/:id/evenements/:eid', auth, (req, res) => {
  getDb().prepare('DELETE FROM calendrier_evenements WHERE id = ? AND calendrier_id = ?').run(req.params.eid, req.params.id);
  res.json({ message: 'Événement supprimé' });
});

// POST /api/calendriers/:id/valider (DIRECTEUR + CHEF_SERVICE)
router.post('/:id/valider', auth, requireRole('DIRECTEUR', 'CHEF_SERVICE', 'ADMIN_PORTAIL'), (req, res) => {
  const { statut, observations } = req.body; // VALIDE | REJETE
  const db = getDb();

  db.prepare(`
    UPDATE calendriers SET statut = ?, valide_par = ?, date_validation = datetime('now'), observations = ?
    WHERE id = ?
  `).run(statut || 'VALIDE', req.user.id, observations || null, req.params.id);

  const cal = db.prepare('SELECT * FROM calendriers WHERE id = ?').get(req.params.id);
  const uploader = db.prepare('SELECT * FROM users WHERE id = ?').get(cal.uploaded_by);

  if (uploader) {
    const msg = statut === 'REJETE'
      ? `Votre calendrier a été rejeté. ${observations || ''}`
      : 'Votre calendrier a été validé !';
    db.prepare(`INSERT INTO notifications (user_id, titre, message, type) VALUES (?, ?, ?, ?)`)
      .run(uploader.id, `Calendrier ${statut === 'REJETE' ? 'rejeté' : 'validé'}`, msg, statut === 'REJETE' ? 'ERREUR' : 'SUCCES');
    sendEmail({
      to: uploader.email,
      subject: `[Portail DFIP] Calendrier ${statut === 'REJETE' ? 'rejeté' : 'validé'}`,
      html: `<p>${msg}</p>`
    });
  }

  res.json({ message: `Calendrier ${statut}` });
});

// GET /api/calendriers/:id/apercu — lire le contenu du fichier Excel
router.get('/:id/apercu', auth, (req, res) => {
  const db = getDb();
  const cal = db.prepare('SELECT * FROM calendriers WHERE id = ?').get(req.params.id);
  if (!cal) return res.status(404).json({ error: 'Calendrier non trouvé' });

  const filePath = path.join(UPLOAD_DIR, 'calendriers', cal.fichier_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichier introuvable' });

  try {
    const wb = XLSX.readFile(filePath);
    const sheets = wb.SheetNames.map(name => ({
      name,
      data: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 }).slice(0, 50)
    }));
    res.json({ fichier_nom: cal.fichier_nom, sheets });
  } catch {
    res.status(500).json({ error: 'Impossible de lire le fichier' });
  }
});

// GET /api/calendriers/:id/download
router.get('/:id/download', auth, (req, res) => {
  const db = getDb();
  const cal = db.prepare('SELECT * FROM calendriers WHERE id = ?').get(req.params.id);
  if (!cal) return res.status(404).json({ error: 'Calendrier non trouvé' });

  const filePath = path.join(UPLOAD_DIR, 'calendriers', cal.fichier_path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichier introuvable' });

  res.download(filePath, cal.fichier_nom);
});

// DELETE /api/calendriers/:id
router.delete('/:id', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL'), (req, res) => {
  const db = getDb();
  const cal = db.prepare('SELECT * FROM calendriers WHERE id = ?').get(req.params.id);
  if (!cal) return res.status(404).json({ error: 'Calendrier non trouvé' });

  const filePath = path.join(UPLOAD_DIR, 'calendriers', cal.fichier_path);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  db.prepare('DELETE FROM calendriers WHERE id = ?').run(req.params.id);
  res.json({ message: 'Calendrier supprimé' });
});

module.exports = router;
