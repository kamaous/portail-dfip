const express = require('express');
const { getDb } = require('../db/connection');
const { auth, requireRole } = require('../middleware/auth');
const { notifierConcernes, checkDateBloquee } = require('../services/notify');
const { ROLES_RESTREINTS } = require('../config');

const router = express.Router();

const SESSION_LABEL = { 1: 'Session Normale', 2: 'Session de Rattrapage' };

// GET /api/sessions
router.get('/', auth, (req, res) => {
  const db = getDb();
  const { annee_id, pole_id, session_num } = req.query;
  let sql = `
    SELECT se.*,
      aa.libelle as annee_libelle,
      p.nom as pole_nom, p.code as pole_code,
      f.nom as formation_nom, f.code as formation_code, f.cycle as formation_cycle,
      pr.code as promotion_code,
      cb.nom as created_by_nom, cb.prenom as created_by_prenom
    FROM sessions_examen se
    JOIN annees_academiques aa ON aa.id = se.annee_id
    LEFT JOIN poles p ON p.id = se.pole_id
    LEFT JOIN formations f ON f.id = se.formation_id
    LEFT JOIN promotions pr ON pr.id = se.promotion_id
    JOIN users cb ON cb.id = se.created_by
    WHERE 1=1`;
  const params = [];
  if (annee_id) { sql += ' AND se.annee_id = ?'; params.push(annee_id); }
  if (pole_id) { sql += ' AND se.pole_id = ?'; params.push(pole_id); }
  if (session_num) { sql += ' AND se.session_num = ?'; params.push(session_num); }
  if (ROLES_RESTREINTS.includes(req.user.role) && req.user.pole_id) {
    sql += ' AND se.pole_id = ?'; params.push(req.user.pole_id);
  }
  sql += ' ORDER BY se.session_num, se.date_demarrage';
  res.json(db.prepare(sql).all(...params));
});

// POST /api/sessions/check-date — vérifier qu'une date n'est ni fériée ni en vacances
router.post('/check-date', auth, (req, res) => {
  res.json(checkDateBloquee(req.body.date));
});

// Écriture examens : Chef division Évaluation & Formation + hiérarchie
const WRITE_ROLES = ['DIRECTEUR', 'CHEF_SERVICE', 'CHEF_DIV_EVALUATION', 'ADMIN_PORTAIL', 'SCOLARITE'];
// Délibérations : Responsables de pôle (leur pôle) + Directeur/Admin
const DELIB_ROLES = ['DIRECTEUR', 'ADMIN_PORTAIL', 'RESPONSABLE_POLE'];

// POST /api/sessions
router.post('/', auth, requireRole(...WRITE_ROLES), (req, res) => {
  const { annee_id, pole_id, promotion_id, formation_id, niveau, semestre_code, session_num,
          date_demarrage, date_fin_prevue, etat, deliberation, date_deliberation,
          sujets_reception, date_reception_sujets, date_programmation, observations } = req.body;
  if (!annee_id) return res.status(400).json({ error: 'annee_id requis' });

  // Contrôle jour férié / vacances sur la date de démarrage
  if (date_demarrage) {
    const blk = checkDateBloquee(date_demarrage);
    if (blk.ferie) return res.status(409).json({ error: `Date démarrage = jour férié (${blk.ferie.libelle}). Choisissez une autre date.`, blocage: blk });
    if (blk.vacances) return res.status(409).json({ error: `Date démarrage pendant les vacances (${blk.vacances.libelle}).`, blocage: blk });
  }

  const db = getDb();
  const r = db.prepare(`
    INSERT INTO sessions_examen (annee_id, pole_id, promotion_id, formation_id, niveau, semestre_code, session_num,
      date_demarrage, date_fin_prevue, etat, deliberation, date_deliberation,
      sujets_reception, date_reception_sujets, date_programmation, observations, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(annee_id, pole_id || null, promotion_id || null, formation_id || null,
    niveau || null, semestre_code || null,
    session_num || 1, date_demarrage || null, date_fin_prevue || null, etat || 'PLANIFIE',
    deliberation ? 1 : 0, date_deliberation || null,
    sujets_reception || 'AUCUNE', date_reception_sujets || null, date_programmation || null,
    observations || null, req.user.id);

  const row = db.prepare('SELECT * FROM sessions_examen WHERE id = ?').get(r.lastInsertRowid);

  // Notifier les concernés de la planification
  if (date_demarrage) {
    const filiere = formation_id ? db.prepare('SELECT nom FROM formations WHERE id = ?').get(formation_id) : null;
    notifierConcernes({
      pole_id,
      titre: `${SESSION_LABEL[session_num || 1]} planifiée`,
      message: `Démarrage des examens prévu le ${date_demarrage}${filiere ? ` — ${filiere.nom}` : ''}.`,
      type: 'EXAMEN',
      lien: '/examens',
      htmlBody: `<p>Une <strong>${SESSION_LABEL[session_num || 1]}</strong> d'examens a été planifiée.</p>
        <p>📅 Démarrage : <strong>${date_demarrage}</strong>${filiere ? `<br>🎓 Filière : ${filiere.nom}` : ''}</p>`,
    });
  }

  db.prepare('INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)')
    .run(req.user.id, 'CREATE_SESSION_EXAMEN', 'EXAMEN', SESSION_LABEL[session_num || 1]);

  res.status(201).json(row);
});

// PUT /api/sessions/:id
router.put('/:id', auth, (req, res) => {
  const db = getDb();
  const prev = db.prepare('SELECT * FROM sessions_examen WHERE id = ?').get(req.params.id);
  if (!prev) return res.status(404).json({ error: 'Session introuvable' });

  const { date_demarrage, date_fin_prevue, etat, deliberation, date_deliberation,
          sujets_reception, date_reception_sujets, date_programmation, observations, motif } = req.body;

  const estEcriture = ['ADMIN_PORTAIL', ...([].concat(WRITE_ROLES))].includes(req.user.role);
  const estDelib = DELIB_ROLES.includes(req.user.role);

  // --- Délibérations : Responsables de pôle (leur pôle uniquement) + Directeur/Admin ---
  const changeDelib = deliberation != null || date_deliberation !== undefined;
  if (changeDelib) {
    if (!estDelib) return res.status(403).json({ error: 'Seuls les responsables de pôle (et le Directeur) renseignent les délibérations.' });
    if (req.user.role === 'RESPONSABLE_POLE' && prev.pole_id && req.user.pole_id !== prev.pole_id) {
      return res.status(403).json({ error: 'Vous ne pouvez renseigner que les délibérations de votre pôle.' });
    }
  }

  // --- Autres champs : rôles d'écriture examens ---
  const changeAutres = [date_demarrage, date_fin_prevue, etat, sujets_reception,
    date_reception_sujets, date_programmation, observations].some(v => v !== undefined);
  if (changeAutres && !estEcriture) {
    return res.status(403).json({ error: 'Accès réservé au Chef de division Évaluation & Formation.' });
  }

  // --- Report ou annulation ⇒ incident (motif) OBLIGATOIRE ---
  const estReport = date_demarrage && prev.date_demarrage && date_demarrage !== prev.date_demarrage;
  const estAnnulation = etat === 'ANNULE' && prev.etat !== 'ANNULE';
  if ((estReport || estAnnulation) && !motif) {
    return res.status(422).json({
      error: estAnnulation
        ? "Annulation d'examen : le motif (incident) est obligatoire."
        : "Reprogrammation d'examen : le motif (incident) est obligatoire.",
      motif_requis: true,
    });
  }

  if (date_demarrage && date_demarrage !== prev.date_demarrage) {
    const blk = checkDateBloquee(date_demarrage);
    if (blk.ferie) return res.status(409).json({ error: `Date démarrage = jour férié (${blk.ferie.libelle}).`, blocage: blk });
    if (blk.vacances) return res.status(409).json({ error: `Date démarrage pendant les vacances (${blk.vacances.libelle}).`, blocage: blk });
  }

  db.prepare(`
    UPDATE sessions_examen SET date_demarrage=?, date_fin_prevue=?, etat=?, deliberation=?, date_deliberation=?,
      sujets_reception=?, date_reception_sujets=?, date_programmation=?, observations=?, updated_at=datetime('now')
    WHERE id=?
  `).run(
    date_demarrage ?? prev.date_demarrage,
    date_fin_prevue ?? prev.date_fin_prevue,
    etat ?? prev.etat,
    deliberation != null ? (deliberation ? 1 : 0) : prev.deliberation,
    date_deliberation !== undefined ? date_deliberation : prev.date_deliberation,
    sujets_reception ?? prev.sujets_reception,
    date_reception_sujets ?? prev.date_reception_sujets,
    date_programmation ?? prev.date_programmation,
    observations ?? prev.observations,
    req.params.id);

  // Créer l'incident lié au report / à l'annulation
  if (estReport || estAnnulation) {
    const filiere = prev.formation_id ? db.prepare('SELECT nom FROM formations WHERE id = ?').get(prev.formation_id) : null;
    const promo = prev.promotion_id ? db.prepare('SELECT code FROM promotions WHERE id = ?').get(prev.promotion_id) : null;
    const titre = `${estAnnulation ? 'Annulation' : 'Report'} ${SESSION_LABEL[prev.session_num]}${filiere ? ` — ${filiere.nom}` : ''}${promo ? ` (${promo.code})` : ''}`;
    db.prepare(`
      INSERT INTO incidents (titre, description, type_incident, gravite, statut, signale_par,
        pole_id, date_debut, date_incident, consequence_examens, ref_type, ref_id)
      VALUES (?, ?, ?, 'HAUTE', 'OUVERT', ?, ?, date('now'), date('now'), ?, 'SESSION_EXAMEN', ?)
    `).run(titre, motif, estAnnulation ? 'ANNULATION_EXAMEN' : 'REPORT_EXAMEN', req.user.id,
      prev.pole_id || null,
      estAnnulation ? 'Examen annulé' : `Examen reporté du ${prev.date_demarrage} au ${date_demarrage}`,
      prev.id);

    notifierConcernes({
      pole_id: prev.pole_id,
      titre: `🚨 ${titre}`,
      message: `Motif : ${motif}`,
      type: 'INCIDENT',
      lien: '/incidents',
    });
  }

  // Notifier changement d'état / délibération
  if ((etat && etat !== prev.etat && !estAnnulation) || (deliberation != null && (deliberation ? 1 : 0) !== prev.deliberation)) {
    const labels = { PLANIFIE: 'Planifiée', EN_COURS: 'En cours', TERMINE: 'Terminée', ANNULE: 'Annulée' };
    notifierConcernes({
      pole_id: prev.pole_id,
      titre: `${SESSION_LABEL[prev.session_num]} mise à jour`,
      message: `État : ${labels[etat || prev.etat] || (etat || prev.etat)}${(deliberation != null && deliberation) ? ' — Délibération faite' : ''}.`,
      type: 'EXAMEN',
      lien: '/examens',
    });
  }

  res.json(db.prepare('SELECT * FROM sessions_examen WHERE id = ?').get(req.params.id));
});

// DELETE /api/sessions/:id
router.delete('/:id', auth, requireRole('DIRECTEUR', 'ADMIN_PORTAIL'), (req, res) => {
  getDb().prepare('DELETE FROM sessions_examen WHERE id = ?').run(req.params.id);
  res.json({ message: 'Session supprimée' });
});

module.exports = router;
