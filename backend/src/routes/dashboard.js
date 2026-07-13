const express = require('express');
const { getDb } = require('../db/connection');
const { auth } = require('../middleware/auth');

const router = express.Router();

// GET /api/dashboard/stats — tableau de bord global
router.get('/stats', auth, (req, res) => {
  const db = getDb();
  const anneeActive = db.prepare("SELECT * FROM annees_academiques WHERE active = 1 LIMIT 1").get();
  // Filtre optionnel par année (sinon année active)
  const annee_id = req.query.annee_id ? parseInt(req.query.annee_id) : anneeActive?.id;
  const anneeAffichee = annee_id
    ? db.prepare('SELECT * FROM annees_academiques WHERE id = ?').get(annee_id)
    : anneeActive;

  const stats = {
    annee_active: anneeActive,
    annee_affichee: anneeAffichee,

    // Tâches
    taches: {
      total: db.prepare('SELECT COUNT(*) as cnt FROM taches').get().cnt,
      ouvertes: db.prepare("SELECT COUNT(*) as cnt FROM taches WHERE statut = 'OUVERTE'").get().cnt,
      en_cours: db.prepare("SELECT COUNT(*) as cnt FROM taches WHERE statut = 'EN_COURS'").get().cnt,
      completees: db.prepare("SELECT COUNT(*) as cnt FROM taches WHERE statut = 'COMPLETEE'").get().cnt,
      mes_taches: db.prepare("SELECT COUNT(*) as cnt FROM taches WHERE assigne_a = ? AND statut != 'COMPLETEE'").get(req.user.id).cnt,
    },

    // Incidents
    incidents: {
      total: db.prepare('SELECT COUNT(*) as cnt FROM incidents').get().cnt,
      ouverts: db.prepare("SELECT COUNT(*) as cnt FROM incidents WHERE statut = 'OUVERT'").get().cnt,
      critiques: db.prepare("SELECT COUNT(*) as cnt FROM incidents WHERE gravite = 'CRITIQUE' AND statut != 'RESOLU'").get().cnt,
    },

    // Évaluations (fusion Examens + Sessions)
    evaluations: annee_id ? {
      total: db.prepare('SELECT COUNT(*) as cnt FROM sessions_examen WHERE annee_id = ?').get(annee_id).cnt,
      en_cours: db.prepare("SELECT COUNT(*) as cnt FROM sessions_examen WHERE annee_id = ? AND etat_eval = 'EVAL_EN_COURS'").get(annee_id).cnt,
      terminees: db.prepare("SELECT COUNT(*) as cnt FROM sessions_examen WHERE annee_id = ? AND etat_eval = 'EVAL_TERMINEES'").get(annee_id).cnt,
      delib_terminees: db.prepare("SELECT COUNT(*) as cnt FROM sessions_examen WHERE annee_id = ? AND delib_etat = 'TERMINEE'").get(annee_id).cnt,
    } : {},
    examens: {}, // compat ancien front

    // Tutorat
    tutorat: annee_id ? {
      total: db.prepare('SELECT COUNT(*) as cnt FROM tutorat WHERE annee_id = ?').get(annee_id).cnt,
      en_cours: db.prepare("SELECT COUNT(*) as cnt FROM tutorat WHERE annee_id = ? AND statut = 'EN_COURS'").get(annee_id).cnt,
    } : {},

    // Calendriers
    calendriers: annee_id ? {
      total: db.prepare('SELECT COUNT(*) as cnt FROM calendriers WHERE annee_id = ?').get(annee_id).cnt,
      en_attente: db.prepare("SELECT COUNT(*) as cnt FROM calendriers WHERE annee_id = ? AND statut = 'EN_ATTENTE'").get(annee_id).cnt,
      valides: db.prepare("SELECT COUNT(*) as cnt FROM calendriers WHERE annee_id = ? AND statut = 'VALIDE'").get(annee_id).cnt,
    } : {},

    // Utilisateurs
    utilisateurs: {
      total: db.prepare("SELECT COUNT(*) as cnt FROM users WHERE actif = 1").get().cnt,
      en_ligne: db.prepare(`
        SELECT COUNT(DISTINCT user_id) as cnt FROM user_sessions
        WHERE actif = 1 AND datetime(last_activity) > datetime('now', '-15 minutes')
      `).get().cnt,
    },

    // Pôles
    poles: db.prepare('SELECT COUNT(*) as cnt FROM poles').get().cnt,
  };

  // Activité récente (audit)
  stats.activite_recente = db.prepare(`
    SELECT al.*, u.nom, u.prenom, u.role
    FROM audit_logs al
    LEFT JOIN users u ON u.id = al.user_id
    ORDER BY al.created_at DESC LIMIT 10
  `).all();

  // Notifications non lues
  stats.notifications_non_lues = db.prepare(
    'SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND lue = 0'
  ).get(req.user.id).cnt;

  // === Répartitions pour graphiques ===
  stats.repartitions = {
    taches_statut: db.prepare("SELECT statut as label, COUNT(*) as value FROM taches GROUP BY statut").all(),
    incidents_gravite: db.prepare("SELECT gravite as label, COUNT(*) as value FROM incidents GROUP BY gravite").all(),
    incidents_statut: db.prepare("SELECT statut as label, COUNT(*) as value FROM incidents GROUP BY statut").all(),
    evaluations_etat: annee_id
      ? db.prepare("SELECT etat_eval as label, COUNT(*) as value FROM sessions_examen WHERE annee_id = ? GROUP BY etat_eval").all(annee_id)
      : [],
    examens_statut: [],
    utilisateurs_role: db.prepare("SELECT role as label, COUNT(*) as value FROM users WHERE actif = 1 GROUP BY role").all(),
    // Charge par pôle (tâches + incidents + examens rattachés)
    charge_poles: db.prepare(`
      SELECT p.nom as label,
        (SELECT COUNT(*) FROM examens e WHERE e.pole_id = p.id) +
        (SELECT COUNT(*) FROM incidents i WHERE i.pole_id = p.id) +
        (SELECT COUNT(*) FROM tutorat t WHERE t.pole_id = p.id) as value
      FROM poles p ORDER BY value DESC
    `).all(),
  };

  // Activité des 7 derniers jours (timeline)
  stats.activite_7j = db.prepare(`
    SELECT date(created_at) as jour, COUNT(*) as value
    FROM audit_logs
    WHERE date(created_at) >= date('now', '-6 days')
    GROUP BY date(created_at)
    ORDER BY jour
  `).all();

  res.json(stats);
});

// GET /api/dashboard/annees
router.get('/annees', auth, (req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM annees_academiques ORDER BY libelle DESC').all());
});

// POST /api/dashboard/annees (ADMIN + DIRECTEUR)
router.post('/annees', auth, (req, res) => {
  if (!['DIRECTEUR', 'ADMIN_PORTAIL'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  const { libelle } = req.body;
  if (!libelle) return res.status(400).json({ error: 'Libellé requis' });

  const db = getDb();
  try {
    const r = db.prepare('INSERT INTO annees_academiques (libelle) VALUES (?)').run(libelle);
    res.status(201).json(db.prepare('SELECT * FROM annees_academiques WHERE id = ?').get(r.lastInsertRowid));
  } catch {
    res.status(409).json({ error: 'Cette année académique existe déjà' });
  }
});

// PUT /api/dashboard/annees/:id/activer
router.put('/annees/:id/activer', auth, (req, res) => {
  if (!['DIRECTEUR', 'ADMIN_PORTAIL'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Accès refusé' });
  }
  const db = getDb();
  db.prepare('UPDATE annees_academiques SET active = 0').run();
  db.prepare('UPDATE annees_academiques SET active = 1 WHERE id = ?').run(req.params.id);
  res.json({ message: 'Année académique activée' });
});

module.exports = router;
