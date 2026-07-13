const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../db/connection');
const { auth, requireRole } = require('../middleware/auth');
const { sendEmail } = require('../services/email');
const { emailWrapper } = require('../services/notify');

const router = express.Router();

const TERANGAMEET_URL = process.env.TERANGAMEET_URL || 'https://terangameet.unchk.sn';

// Slug de salle : titre nettoyé + suffixe aléatoire (évite les collisions et les salles devinables)
function genSalle(titre) {
  const base = (titre || 'reunion')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // retire les accents
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'reunion';
  return `DFE-${base}-${crypto.randomBytes(4).toString('hex')}`;
}

function withDetails(db, r) {
  const org = db.prepare('SELECT id, nom, prenom, email FROM users WHERE id = ?').get(r.organisateur_id);
  let ids = [];
  try { ids = JSON.parse(r.participants || '[]'); } catch { ids = []; }
  const participants = ids.length
    ? db.prepare(`SELECT id, nom, prenom, email, role FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)
    : [];
  return { ...r, lien: `${TERANGAMEET_URL}/${r.salle}`, organisateur: org, participants_detail: participants };
}

// Détection : TerangaMeet autorise-t-il l'intégration en iframe depuis un autre domaine ?
// (cache 10 min pour éviter une requête sortante à chaque affichage)
let embedCache = { at: 0, embeddable: false };
async function checkEmbeddable() {
  if (Date.now() - embedCache.at < 10 * 60 * 1000) return embedCache.embeddable;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(TERANGAMEET_URL, { method: 'HEAD', signal: ctrl.signal, redirect: 'follow' });
    clearTimeout(t);
    const xfo = (r.headers.get('x-frame-options') || '').toUpperCase();
    const csp = r.headers.get('content-security-policy') || '';
    const fa = csp.match(/frame-ancestors([^;]*)/i);
    let embeddable;
    if (fa) {
      // frame-ancestors prime sur X-Frame-Options : intégrable sauf si restreint à 'none'/'self' uniquement
      const val = fa[1].trim();
      embeddable = !val.includes("'none'") && !(val === "'self'");
    } else {
      embeddable = !(xfo.includes('DENY') || xfo.includes('SAMEORIGIN'));
    }
    embedCache = { at: Date.now(), embeddable };
  } catch {
    embedCache = { at: Date.now(), embeddable: false };
  }
  return embedCache.embeddable;
}

// GET /api/reunions/config — URL TerangaMeet + capacité d'intégration iframe
router.get('/config', auth, async (req, res) => {
  res.json({ terangameet_url: TERANGAMEET_URL, embeddable: await checkEmbeddable() });
});

// GET /api/reunions — mes réunions (organisateur ou participant) ; Directeur/Admin voient tout
router.get('/', auth, (req, res) => {
  const db = getDb();
  const all = db.prepare(`SELECT * FROM reunions ORDER BY date_reunion DESC, heure DESC`).all();
  const voitTout = ['DIRECTEUR', 'ADMIN_PORTAIL'].includes(req.user.role);
  const visibles = all.filter(r => {
    if (voitTout || r.organisateur_id === req.user.id) return true;
    try { return JSON.parse(r.participants || '[]').includes(req.user.id); } catch { return false; }
  });
  res.json(visibles.map(r => withDetails(db, r)));
});

// POST /api/reunions — programmer une réunion (tous les acteurs)
router.post('/', auth, (req, res) => {
  const { titre, description, date_reunion, heure, duree_minutes, participants } = req.body;
  if (!titre || !date_reunion || !heure) {
    return res.status(400).json({ error: 'Titre, date et heure requis' });
  }

  const db = getDb();
  const salle = genSalle(titre);
  const ids = Array.isArray(participants) ? participants.map(Number).filter(Boolean) : [];

  const r = db.prepare(`
    INSERT INTO reunions (titre, description, date_reunion, heure, duree_minutes, salle, organisateur_id, participants)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(titre, description || null, date_reunion, heure, duree_minutes || 60, salle, req.user.id, JSON.stringify(ids));

  const reunion = db.prepare('SELECT * FROM reunions WHERE id = ?').get(r.lastInsertRowid);
  const lien = `${TERANGAMEET_URL}/${salle}`;

  // Notifier chaque participant (in-app + email avec le lien)
  const insNotif = db.prepare('INSERT INTO notifications (user_id, titre, message, type, lien) VALUES (?, ?, ?, ?, ?)');
  ids.forEach(uid => {
    const u = db.prepare('SELECT * FROM users WHERE id = ? AND actif = 1').get(uid);
    if (!u || u.id === req.user.id) return;
    insNotif.run(u.id, '📅 Réunion programmée', `${req.user.prenom} ${req.user.nom} : "${titre}" le ${date_reunion} à ${heure}`, 'REUNION', '/reunions');
    sendEmail({
      to: u.email,
      subject: `[Portail DFIP] Réunion : ${titre} — ${date_reunion} à ${heure}`,
      html: emailWrapper(u, 'Invitation à une réunion', `
        <p><strong>${req.user.prenom} ${req.user.nom}</strong> vous invite à une réunion :</p>
        <div style="background:#f0f9ff;border:1px solid #bfdbfe;padding:16px;border-radius:8px;margin:16px 0">
          <h3 style="margin:0 0 8px;color:#1e40af">${titre}</h3>
          ${description ? `<p style="margin:0 0 8px;color:#374151">${description}</p>` : ''}
          <p style="margin:0;font-size:14px">📅 <strong>${date_reunion}</strong> à <strong>${heure}</strong> (${duree_minutes || 60} min)</p>
        </div>
        <p style="text-align:center;margin:20px 0">
          <a href="${lien}" style="background:#1e3a5f;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Rejoindre la réunion</a>
        </p>
        <p style="font-size:12px;color:#6b7280">Ou copiez ce lien : ${lien}</p>`),
    });
  });

  db.prepare('INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)')
    .run(req.user.id, 'CREATE_REUNION', 'REUNIONS', titre);

  res.status(201).json(withDetails(db, reunion));
});

// PUT /api/reunions/:id — modifier (organisateur, Directeur, Admin)
router.put('/:id', auth, (req, res) => {
  const db = getDb();
  const prev = db.prepare('SELECT * FROM reunions WHERE id = ?').get(req.params.id);
  if (!prev) return res.status(404).json({ error: 'Réunion introuvable' });
  if (prev.organisateur_id !== req.user.id && !['DIRECTEUR', 'ADMIN_PORTAIL'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Seul l\'organisateur peut modifier cette réunion' });
  }

  const { titre, description, date_reunion, heure, duree_minutes, statut, participants } = req.body;
  const ids = Array.isArray(participants) ? participants.map(Number).filter(Boolean) : JSON.parse(prev.participants || '[]');

  db.prepare(`
    UPDATE reunions SET titre=?, description=?, date_reunion=?, heure=?, duree_minutes=?, statut=?, participants=?, updated_at=datetime('now')
    WHERE id=?
  `).run(titre ?? prev.titre, description ?? prev.description, date_reunion ?? prev.date_reunion,
    heure ?? prev.heure, duree_minutes ?? prev.duree_minutes, statut ?? prev.statut,
    JSON.stringify(ids), req.params.id);

  // Notifier si annulation ou report
  if (statut === 'ANNULEE' || (date_reunion && date_reunion !== prev.date_reunion) || (heure && heure !== prev.heure)) {
    const insNotif = db.prepare('INSERT INTO notifications (user_id, titre, message, type, lien) VALUES (?, ?, ?, ?, ?)');
    const msg = statut === 'ANNULEE'
      ? `La réunion "${prev.titre}" a été annulée.`
      : `La réunion "${prev.titre}" est reportée au ${date_reunion || prev.date_reunion} à ${heure || prev.heure}.`;
    ids.forEach(uid => {
      const u = db.prepare('SELECT * FROM users WHERE id = ? AND actif = 1').get(uid);
      if (!u || u.id === req.user.id) return;
      insNotif.run(u.id, statut === 'ANNULEE' ? '❌ Réunion annulée' : '🔁 Réunion reportée', msg, 'REUNION', '/reunions');
      sendEmail({ to: u.email, subject: `[Portail DFIP] ${statut === 'ANNULEE' ? 'Réunion annulée' : 'Réunion reportée'} : ${prev.titre}`, html: emailWrapper(u, statut === 'ANNULEE' ? 'Réunion annulée' : 'Réunion reportée', `<p>${msg}</p>`) });
    });
  }

  res.json(withDetails(db, db.prepare('SELECT * FROM reunions WHERE id = ?').get(req.params.id)));
});

// DELETE /api/reunions/:id — organisateur, Directeur, Admin
router.delete('/:id', auth, (req, res) => {
  const db = getDb();
  const r = db.prepare('SELECT * FROM reunions WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Réunion introuvable' });
  if (r.organisateur_id !== req.user.id && !['DIRECTEUR', 'ADMIN_PORTAIL'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  db.prepare('DELETE FROM reunions WHERE id = ?').run(req.params.id);
  res.json({ message: 'Réunion supprimée' });
});

module.exports = router;
