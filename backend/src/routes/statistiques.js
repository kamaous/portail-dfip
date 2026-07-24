const express = require('express');
const { getDb } = require('../db/connection');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();

/* ===== Module STATISTIQUES =====
   - ENO et capacités : gérés par l'Admin/Directeur, affinés par le Chargé de scolarité de chaque ENO
   - Effectifs par (promotion × niveau × formation × ENO) : renseignés par le Directeur DES
   - Simulateur d'évaluations : effectifs cumulés par ENO vs capacités */

const GESTION = ['DIRECTEUR', 'ADMIN_PORTAIL'];

// Capacité effective d'un ENO : somme des salles disponibles si des salles sont
// déclarées, sinon la capacité globale saisie
function capaciteEffective(db, eno) {
  const s = db.prepare('SELECT COUNT(*) as n, COALESCE(SUM(CASE WHEN disponible = 1 THEN capacite ELSE 0 END), 0) as cap FROM eno_salles WHERE eno_id = ?').get(eno.id);
  return s.n > 0 ? s.cap : eno.capacite;
}

/* ===== ENO ===== */
router.get('/eno', auth, (req, res) => {
  const db = getDb();
  const enos = db.prepare('SELECT * FROM enos ORDER BY nom').all();
  const salles = db.prepare('SELECT * FROM eno_salles ORDER BY eno_id, nom').all();
  res.json(enos.map(e => ({
    ...e,
    salles: salles.filter(s => s.eno_id === e.id),
    capacite_effective: capaciteEffective(db, e),
  })));
});

router.post('/eno', auth, requireRole(...GESTION), (req, res) => {
  const { nom, capacite, note } = req.body;
  if (!nom?.trim()) return res.status(400).json({ error: 'Nom requis' });
  const db = getDb();
  try {
    const r = db.prepare('INSERT INTO enos (nom, capacite, note) VALUES (?, ?, ?)')
      .run(nom.trim().toUpperCase(), Number(capacite) || 0, note || null);
    res.status(201).json(db.prepare('SELECT * FROM enos WHERE id = ?').get(r.lastInsertRowid));
  } catch { res.status(409).json({ error: 'Cet ENO existe déjà' }); }
});

// Mise à jour : Admin/Directeur, ou Chargé de scolarité pour SON ENO (capacité + note)
router.put('/eno/:id', auth, (req, res) => {
  const db = getDb();
  const eno = db.prepare('SELECT * FROM enos WHERE id = ?').get(req.params.id);
  if (!eno) return res.status(404).json({ error: 'ENO introuvable' });
  const estGestion = GESTION.includes(req.user.role);
  const estCharge = req.user.role === 'CHARGE_SCOLARITE' && req.user.eno_id === eno.id;
  if (!estGestion && !estCharge) return res.status(403).json({ error: 'Réservé à l\'administration ou au Chargé de scolarité de cet ENO.' });
  const { nom, capacite, note, actif } = req.body;
  db.prepare('UPDATE enos SET nom = ?, capacite = ?, note = ?, actif = ? WHERE id = ?')
    .run(estGestion && nom?.trim() ? nom.trim().toUpperCase() : eno.nom,
      capacite !== undefined ? Number(capacite) || 0 : eno.capacite,
      note !== undefined ? (note || null) : eno.note,
      estGestion && actif !== undefined ? (actif ? 1 : 0) : eno.actif,
      eno.id);
  db.prepare('INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)')
    .run(req.user.id, 'UPDATE_ENO', 'STATISTIQUES', `${eno.nom} capacite=${capacite ?? eno.capacite}`);
  res.json(db.prepare('SELECT * FROM enos WHERE id = ?').get(eno.id));
});

router.delete('/eno/:id', auth, requireRole(...GESTION), (req, res) => {
  const db = getDb();
  const n = db.prepare('SELECT COUNT(*) as c FROM effectifs WHERE eno_id = ?').get(req.params.id).c;
  if (n > 0) return res.status(409).json({ error: `Impossible : ${n} effectif(s) rattachés à cet ENO` });
  db.prepare('DELETE FROM enos WHERE id = ?').run(req.params.id);
  res.json({ message: 'ENO supprimé' });
});

/* Salles d'un ENO (Admin/Directeur, ou Chargé de scolarité de l'ENO) */
function peutGererSalles(req, db, enoId) {
  return GESTION.includes(req.user.role) || (req.user.role === 'CHARGE_SCOLARITE' && req.user.eno_id === Number(enoId));
}
router.post('/eno/:id/salles', auth, (req, res) => {
  const db = getDb();
  if (!peutGererSalles(req, db, req.params.id)) return res.status(403).json({ error: 'Non autorisé pour cet ENO' });
  const { nom, capacite, disponible, note } = req.body;
  if (!nom?.trim()) return res.status(400).json({ error: 'Nom de salle requis' });
  const r = db.prepare('INSERT INTO eno_salles (eno_id, nom, capacite, disponible, note) VALUES (?, ?, ?, ?, ?)')
    .run(req.params.id, nom.trim(), Number(capacite) || 0, disponible === 0 || disponible === false ? 0 : 1, note || null);
  res.status(201).json(db.prepare('SELECT * FROM eno_salles WHERE id = ?').get(r.lastInsertRowid));
});
router.put('/salles/:id', auth, (req, res) => {
  const db = getDb();
  const s = db.prepare('SELECT * FROM eno_salles WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Salle introuvable' });
  if (!peutGererSalles(req, db, s.eno_id)) return res.status(403).json({ error: 'Non autorisé pour cet ENO' });
  const { nom, capacite, disponible, note } = req.body;
  db.prepare('UPDATE eno_salles SET nom = ?, capacite = ?, disponible = ?, note = ? WHERE id = ?')
    .run(nom?.trim() || s.nom, capacite !== undefined ? Number(capacite) || 0 : s.capacite,
      disponible !== undefined ? (disponible ? 1 : 0) : s.disponible, note !== undefined ? (note || null) : s.note, s.id);
  res.json(db.prepare('SELECT * FROM eno_salles WHERE id = ?').get(s.id));
});
router.delete('/salles/:id', auth, (req, res) => {
  const db = getDb();
  const s = db.prepare('SELECT * FROM eno_salles WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Salle introuvable' });
  if (!peutGererSalles(req, db, s.eno_id)) return res.status(403).json({ error: 'Non autorisé pour cet ENO' });
  db.prepare('DELETE FROM eno_salles WHERE id = ?').run(s.id);
  res.json({ message: 'Salle supprimée' });
});

/* ===== Effectifs (Directeur DES / Admin) ===== */
router.get('/effectifs', auth, (req, res) => {
  const db = getDb();
  const { promotion_code, niveau, pole_id, formation_id } = req.query;
  let sql = `
    SELECT ef.*, f.nom as formation_nom, f.code as formation_code, f.pole_id,
           p.code as pole_code, e.nom as eno_nom
    FROM effectifs ef
    JOIN formations f ON f.id = ef.formation_id
    LEFT JOIN poles p ON p.id = f.pole_id
    JOIN enos e ON e.id = ef.eno_id
    WHERE 1=1`;
  const params = [];
  if (promotion_code) { sql += ' AND ef.promotion_code = ?'; params.push(promotion_code); }
  if (niveau) { sql += ' AND ef.niveau = ?'; params.push(niveau); }
  if (pole_id) { sql += ' AND f.pole_id = ?'; params.push(pole_id); }
  if (formation_id) { sql += ' AND ef.formation_id = ?'; params.push(formation_id); }
  sql += ' ORDER BY ef.promotion_code, ef.niveau, p.code, f.code, e.nom';
  res.json(db.prepare(sql).all(...params));
});

// Cursus disponibles (pour le simulateur) : couples promotion×niveau×formation ayant des effectifs
router.get('/cursus', auth, (req, res) => {
  const db = getDb();
  res.json(db.prepare(`
    SELECT ef.promotion_code, ef.niveau, ef.formation_id,
           f.nom as formation_nom, f.code as formation_code, p.code as pole_code,
           SUM(ef.nombre) as total
    FROM effectifs ef
    JOIN formations f ON f.id = ef.formation_id
    LEFT JOIN poles p ON p.id = f.pole_id
    GROUP BY ef.promotion_code, ef.niveau, ef.formation_id
    ORDER BY ef.promotion_code DESC, ef.niveau, p.code, f.code
  `).all());
});

// Saisie unitaire (Directeur DES via alias DIRECTEUR, Admin)
router.put('/effectifs', auth, requireRole(...GESTION), (req, res) => {
  const { promotion_code, niveau, formation_id, eno_id, nombre } = req.body;
  if (!promotion_code || !niveau || !formation_id || !eno_id) return res.status(400).json({ error: 'Champs requis manquants' });
  const db = getDb();
  db.prepare(`
    INSERT INTO effectifs (promotion_code, niveau, formation_id, eno_id, nombre, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(promotion_code, niveau, formation_id, eno_id)
    DO UPDATE SET nombre = excluded.nombre, updated_at = datetime('now')
  `).run(promotion_code, niveau, formation_id, eno_id, Math.max(0, Number(nombre) || 0));
  res.json({ message: 'Effectif enregistré' });
});

// Import en masse (fichier DES) : crée ENO / formations manquantes puis upsert
router.post('/effectifs/bulk', auth, requireRole(...GESTION), (req, res) => {
  const { lignes, capacites } = req.body; // lignes: [{promotion_code, niveau, pole_code, formation_code, formation_nom?, eno_nom, nombre}]
  if (!Array.isArray(lignes)) return res.status(400).json({ error: 'lignes[] requis' });
  const db = getDb();
  const bilan = { effectifs: 0, formations_creees: [], enos_crees: [], capacites: 0, ignorees: 0 };

  const getEno = (nom) => {
    const n = String(nom).trim().toUpperCase();
    let e = db.prepare('SELECT * FROM enos WHERE nom = ?').get(n);
    if (!e) {
      const r = db.prepare('INSERT INTO enos (nom) VALUES (?)').run(n);
      e = db.prepare('SELECT * FROM enos WHERE id = ?').get(r.lastInsertRowid);
      bilan.enos_crees.push(n);
    }
    return e;
  };
  const getFormation = (poleCode, code, nom) => {
    const pole = db.prepare('SELECT id FROM poles WHERE code = ?').get(String(poleCode).trim().toUpperCase());
    if (!pole) return null;
    let f = db.prepare('SELECT * FROM formations WHERE pole_id = ? AND UPPER(code) = ?').get(pole.id, String(code).trim().toUpperCase());
    if (!f) f = db.prepare('SELECT * FROM formations WHERE pole_id = ? AND UPPER(nom) = ?').get(pole.id, String(code).trim().toUpperCase());
    if (!f) {
      const cycle = /^M/.test(code) || /Master/i.test(nom || '') ? 'MASTER' : 'LICENCE';
      const r = db.prepare('INSERT INTO formations (pole_id, nom, code, cycle) VALUES (?, ?, ?, ?)')
        .run(pole.id, (nom || code).trim(), String(code).trim().toUpperCase(), cycle);
      f = db.prepare('SELECT * FROM formations WHERE id = ?').get(r.lastInsertRowid);
      bilan.formations_creees.push(`${poleCode}/${code}`);
    }
    return f;
  };

  const upsert = db.prepare(`
    INSERT INTO effectifs (promotion_code, niveau, formation_id, eno_id, nombre, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(promotion_code, niveau, formation_id, eno_id)
    DO UPDATE SET nombre = excluded.nombre, updated_at = datetime('now')
  `);
  const tx = db.transaction(() => {
    for (const l of lignes) {
      const f = getFormation(l.pole_code, l.formation_code, l.formation_nom);
      if (!f) { bilan.ignorees++; continue; }
      const e = getEno(l.eno_nom);
      upsert.run(String(l.promotion_code).toUpperCase(), String(l.niveau).toUpperCase(), f.id, e.id, Math.max(0, Number(l.nombre) || 0));
      bilan.effectifs++;
    }
    for (const c of (capacites || [])) {
      const e = getEno(c.eno_nom);
      db.prepare('UPDATE enos SET capacite = ? WHERE id = ?').run(Math.max(0, Number(c.capacite) || 0), e.id);
      bilan.capacites++;
    }
  });
  tx();
  db.prepare('INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)')
    .run(req.user.id, 'IMPORT_EFFECTIFS', 'STATISTIQUES', `${bilan.effectifs} effectifs, ${bilan.capacites} capacités`);
  res.json(bilan);
});

/* ===== Simulateur =====
   selections: [{ promotion_code, niveau, formation_id }]
   date_demarrage / date_fin_prevue (optionnels) : ajoute la charge des évaluations
   déjà programmées qui chevauchent la période. */
function chargeParEno(db, selections) {
  const demande = {}; // eno_id → { total, detail: [{formation, nombre}] }
  for (const sel of selections) {
    const rows = db.prepare(`
      SELECT ef.eno_id, ef.nombre, f.code as formation_code, f.nom as formation_nom
      FROM effectifs ef JOIN formations f ON f.id = ef.formation_id
      WHERE ef.promotion_code = ? AND ef.niveau = ? AND ef.formation_id = ?
    `).all(sel.promotion_code, sel.niveau, sel.formation_id);
    for (const r of rows) {
      demande[r.eno_id] = demande[r.eno_id] || { total: 0, detail: [] };
      demande[r.eno_id].total += r.nombre;
      demande[r.eno_id].detail.push({ formation: r.formation_code || r.formation_nom, cursus: `${sel.promotion_code} ${sel.niveau}`, nombre: r.nombre });
    }
  }
  return demande;
}

// Deux créneaux horaires quotidiens se chevauchent-ils ?
// (heure absente d'un côté = journée entière → chevauchement)
function chevaucheHeures(d1, f1, d2, f2) {
  if (!d1 || !d2) return true;
  return d1 < (f2 || '23:59') && d2 < (f1 || '23:59');
}

function simuler(db, { selections, date_demarrage, date_fin_prevue, heure_debut, heure_fin, exclure_id }) {
  const demande = chargeParEno(db, selections);

  // Charge des évaluations déjà programmées sur la même période ET le même créneau horaire
  if (date_demarrage) {
    const fin = date_fin_prevue || date_demarrage;
    const evals = db.prepare(`
      SELECT se.id, se.formation_id, se.niveau, se.heure_debut, se.heure_fin, pr.code as promotion_code
      FROM sessions_examen se LEFT JOIN promotions pr ON pr.id = se.promotion_id
      WHERE se.date_demarrage IS NOT NULL
        AND se.etat NOT IN ('ANNULE', 'SUSPENDU')
        AND se.date_demarrage <= ? AND COALESCE(se.date_fin_prevue, se.date_demarrage) >= ?
        AND se.id != COALESCE(?, -1)
        AND se.formation_id IS NOT NULL AND se.niveau IS NOT NULL AND pr.code IS NOT NULL
    `).all(fin, date_demarrage, exclure_id ?? null)
      .filter(ev => chevaucheHeures(heure_debut, heure_fin, ev.heure_debut, ev.heure_fin));
    const dejaComptees = new Set(selections.map(s => `${s.promotion_code}|${s.niveau}|${s.formation_id}`));
    for (const ev of evals) {
      const cle = `${ev.promotion_code}|${ev.niveau}|${ev.formation_id}`;
      if (dejaComptees.has(cle)) continue;
      dejaComptees.add(cle);
      const d2 = chargeParEno(db, [{ promotion_code: ev.promotion_code, niveau: ev.niveau, formation_id: ev.formation_id }]);
      for (const [enoId, v] of Object.entries(d2)) {
        demande[enoId] = demande[enoId] || { total: 0, detail: [] };
        demande[enoId].total += v.total;
        demande[enoId].detail.push(...v.detail.map(x => ({ ...x, deja_programmee: true })));
      }
    }
  }

  const enos = db.prepare('SELECT * FROM enos WHERE actif = 1 ORDER BY nom').all();
  const resultat = enos.map(e => {
    const cap = capaciteEffective(db, e);
    const dem = demande[e.id]?.total || 0;
    return {
      eno_id: e.id, eno: e.nom, demande: dem, capacite: cap,
      capacite_inconnue: cap === 0,
      ok: cap === 0 ? null : dem <= cap,
      manque: cap > 0 && dem > cap ? dem - cap : 0,
      detail: demande[e.id]?.detail || [],
      note: e.note || null,
    };
  }).filter(r => r.demande > 0 || !r.capacite_inconnue);

  const satures = resultat.filter(r => r.ok === false);
  const inconnues = resultat.filter(r => r.capacite_inconnue && r.demande > 0);
  return {
    faisable: satures.length === 0,
    enos: resultat,
    satures: satures.map(r => ({ eno: r.eno, manque: r.manque, demande: r.demande, capacite: r.capacite })),
    capacites_inconnues: inconnues.map(r => r.eno),
    total_demande: resultat.reduce((s, r) => s + r.demande, 0),
    suggestions: satures.length === 0 ? [] : [
      'Décaler une partie des formations vers un autre créneau (matin / après-midi) ou un autre jour.',
      `Réduire la sélection : retirer la formation la plus nombreuse dans ${satures[0].eno} (voir le détail par ENO).`,
      'Vérifier avec les Chargés de scolarité si des salles supplémentaires peuvent être ouvertes dans les ENO saturés.',
    ],
  };
}

router.post('/simuler', auth, (req, res) => {
  const { selections, date_demarrage, date_fin_prevue, heure_debut, heure_fin, exclure_id } = req.body;
  if (!Array.isArray(selections) || selections.length === 0) {
    return res.status(400).json({ error: 'Sélectionnez au moins un cursus (promotion × niveau × formation)' });
  }
  res.json(simuler(getDb(), { selections, date_demarrage, date_fin_prevue, heure_debut, heure_fin, exclure_id }));
});

/* ===== Synthèse (tableau de bord Statistiques) ===== */
router.get('/synthese', auth, (req, res) => {
  const db = getDb();
  const enos = db.prepare('SELECT * FROM enos WHERE actif = 1 ORDER BY nom').all()
    .map(e => ({ ...e, capacite_effective: capaciteEffective(db, e) }));
  const parEno = db.prepare(`
    SELECT e.nom as eno, SUM(ef.nombre) as total FROM effectifs ef JOIN enos e ON e.id = ef.eno_id
    GROUP BY ef.eno_id ORDER BY total DESC`).all();
  const parPole = db.prepare(`
    SELECT COALESCE(p.code, '—') as pole, SUM(ef.nombre) as total
    FROM effectifs ef JOIN formations f ON f.id = ef.formation_id LEFT JOIN poles p ON p.id = f.pole_id
    GROUP BY f.pole_id ORDER BY total DESC`).all();
  const parPromo = db.prepare(`
    SELECT promotion_code as promo, niveau, SUM(nombre) as total FROM effectifs
    GROUP BY promotion_code, niveau ORDER BY promotion_code DESC`).all();
  const topFormations = db.prepare(`
    SELECT COALESCE(f.code, f.nom) as formation, p.code as pole, SUM(ef.nombre) as total
    FROM effectifs ef JOIN formations f ON f.id = ef.formation_id LEFT JOIN poles p ON p.id = f.pole_id
    GROUP BY ef.formation_id ORDER BY total DESC LIMIT 10`).all();
  const totalEtudiants = db.prepare('SELECT COALESCE(SUM(nombre), 0) as t FROM effectifs').get().t;
  const capaciteTotale = enos.reduce((s, e) => s + e.capacite_effective, 0);
  res.json({
    kpi: {
      total_etudiants: totalEtudiants,
      nb_formations: db.prepare('SELECT COUNT(DISTINCT formation_id) as c FROM effectifs').get().c,
      nb_enos: enos.length,
      capacite_totale: capaciteTotale,
      nb_cursus: db.prepare('SELECT COUNT(*) as c FROM (SELECT DISTINCT promotion_code, niveau, formation_id FROM effectifs)').get().c,
    },
    enos, par_eno: parEno, par_pole: parPole, par_promo: parPromo, top_formations: topFormations,
  });
});

module.exports = { router, simuler };
