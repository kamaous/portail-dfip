const express = require('express');
const ExcelJS = require('exceljs');
const { getDb } = require('../db/connection');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();

const NAVY = 'FF1E3A5F';
const LIGHT = 'FFF0F5FA';

// Rôles direction autorisés à extraire les statistiques globales
const EXPORT_ROLES = ['RECTEUR', 'VICE_RECTEUR', 'DIRECTEUR', 'CHEF_SERVICE',
  'CHEF_DIV_TECHNOPEDAGOGIE', 'CHEF_DIV_EVALUATION', 'ADMIN_PORTAIL'];

function styliserEntete(ws, nbCols) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  row.alignment = { vertical: 'middle' };
  row.height = 22;
  for (let c = 1; c <= nbCols; c++) {
    row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  }
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

// Barres de données (graphique en barres natif Excel dans les cellules)
function barresDonnees(ws, colonne, deb, fin) {
  ws.addConditionalFormatting({
    ref: `${colonne}${deb}:${colonne}${fin}`,
    rules: [{ type: 'dataBar', minLength: 0, maxLength: 100, cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb: 'FF2563EB' } }],
  });
}

function feuilleStat(wb, nom, titres, lignes, largeurs) {
  const ws = wb.addWorksheet(nom);
  ws.columns = titres.map((t, i) => ({ header: t, width: largeurs?.[i] || 22 }));
  lignes.forEach(l => ws.addRow(l));
  styliserEntete(ws, titres.length);
  // Zébrage
  for (let i = 2; i <= lignes.length + 1; i++) {
    if (i % 2 === 0) {
      for (let c = 1; c <= titres.length; c++) {
        ws.getRow(i).getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };
      }
    }
  }
  return ws;
}

// GET /api/export/dashboard — classeur Excel complet des statistiques de la direction
router.get('/dashboard', auth, requireRole(...EXPORT_ROLES), async (req, res) => {
  const db = getDb();
  const anneeActive = db.prepare('SELECT * FROM annees_academiques WHERE active = 1 LIMIT 1').get();
  const annee_id = req.query.annee_id ? parseInt(req.query.annee_id) : anneeActive?.id;
  const annee = annee_id ? db.prepare('SELECT * FROM annees_academiques WHERE id = ?').get(annee_id) : null;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Portail DFIP - UnCHK';
  wb.created = new Date();

  /* ===== 1. Synthèse ===== */
  const stats = [
    ['Tâches — total', db.prepare('SELECT COUNT(*) c FROM taches').get().c],
    ['Tâches ouvertes', db.prepare("SELECT COUNT(*) c FROM taches WHERE statut = 'OUVERTE'").get().c],
    ['Tâches en cours', db.prepare("SELECT COUNT(*) c FROM taches WHERE statut = 'EN_COURS'").get().c],
    ['Tâches complétées', db.prepare("SELECT COUNT(*) c FROM taches WHERE statut = 'COMPLETEE'").get().c],
    ['Incidents — total', db.prepare('SELECT COUNT(*) c FROM incidents').get().c],
    ['Incidents ouverts', db.prepare("SELECT COUNT(*) c FROM incidents WHERE statut = 'OUVERT'").get().c],
    ['Incidents critiques non résolus', db.prepare("SELECT COUNT(*) c FROM incidents WHERE gravite = 'CRITIQUE' AND statut != 'RESOLU'").get().c],
    ['Fiches tutorat', annee_id ? db.prepare('SELECT COUNT(*) c FROM tutorat WHERE annee_id = ?').get(annee_id).c : 0],
    ['Tutorats en cours', annee_id ? db.prepare("SELECT COUNT(*) c FROM tutorat WHERE annee_id = ? AND etat_tutorat = 'EN_COURS'").get(annee_id).c : 0],
    ['Sessions d\'examen', annee_id ? db.prepare('SELECT COUNT(*) c FROM sessions_examen WHERE annee_id = ?').get(annee_id).c : 0],
    ['Délibérations faites', annee_id ? db.prepare('SELECT COUNT(*) c FROM sessions_examen WHERE annee_id = ? AND deliberation = 1').get(annee_id).c : 0],
    ['Calendriers déposés', annee_id ? db.prepare('SELECT COUNT(*) c FROM calendriers WHERE annee_id = ?').get(annee_id).c : 0],
    ['Calendriers validés', annee_id ? db.prepare("SELECT COUNT(*) c FROM calendriers WHERE annee_id = ? AND statut = 'VALIDE'").get(annee_id).c : 0],
    ['Réunions programmées', db.prepare('SELECT COUNT(*) c FROM reunions').get().c],
    ['Utilisateurs actifs', db.prepare('SELECT COUNT(*) c FROM users WHERE actif = 1').get().c],
  ];
  const wsSyn = wb.addWorksheet('Synthèse');
  wsSyn.mergeCells('A1:B1');
  wsSyn.getCell('A1').value = `PORTAIL DFE — Statistiques de la Direction (${annee?.libelle || 'toutes années'})`;
  wsSyn.getCell('A1').font = { bold: true, size: 14, color: { argb: NAVY } };
  wsSyn.getCell('A2').value = `Généré le ${new Date().toLocaleString('fr-FR')}`;
  wsSyn.getCell('A2').font = { italic: true, size: 9, color: { argb: 'FF64748B' } };
  wsSyn.addRow([]);
  const enTete = wsSyn.addRow(['Indicateur', 'Valeur']);
  enTete.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  enTete.getCell(1).fill = enTete.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  stats.forEach(s => wsSyn.addRow(s));
  wsSyn.getColumn(1).width = 42;
  wsSyn.getColumn(2).width = 14;
  barresDonnees(wsSyn, 'B', 5, 4 + stats.length);

  /* ===== 2. Charge par pôle (graphique barres) ===== */
  const parPole = db.prepare(`
    SELECT p.nom,
      (SELECT COUNT(*) FROM tutorat t WHERE t.pole_id = p.id ${annee_id ? 'AND t.annee_id = ' + annee_id : ''}) as tutorats,
      (SELECT COUNT(*) FROM sessions_examen se WHERE se.pole_id = p.id ${annee_id ? 'AND se.annee_id = ' + annee_id : ''}) as sessions,
      (SELECT COUNT(*) FROM incidents i WHERE i.pole_id = p.id) as incidents,
      (SELECT COUNT(*) FROM calendriers c WHERE c.pole_id = p.id ${annee_id ? 'AND c.annee_id = ' + annee_id : ''}) as calendriers
    FROM poles p ORDER BY p.id
  `).all();
  const wsPoles = feuilleStat(wb, 'Par pôle',
    ['Pôle', 'Tutorats', 'Sessions examen', 'Incidents', 'Calendriers'],
    parPole.map(p => [p.nom, p.tutorats, p.sessions, p.incidents, p.calendriers]),
    [45, 12, 16, 12, 14]);
  ['B', 'C', 'D', 'E'].forEach(c => barresDonnees(wsPoles, c, 2, parPole.length + 1));

  /* ===== 3. Tutorat détaillé ===== */
  const ETAT_T = { PAS_DEMARRE: 'Pas démarré', EN_COURS: 'En cours', TERMINE: 'Terminé' };
  const tut = db.prepare(`
    SELECT t.*, p.code pole, f.nom formation, pr.code promo
    FROM tutorat t
    LEFT JOIN poles p ON p.id = t.pole_id
    LEFT JOIN formations f ON f.id = t.formation_id
    LEFT JOIN promotions pr ON pr.id = t.promotion_id
    ${annee_id ? 'WHERE t.annee_id = ' + annee_id : ''}
    ORDER BY p.code, f.nom
  `).all();
  feuilleStat(wb, 'Tutorat',
    ['Pôle', 'Formation', 'Promo', 'Niveau', 'Semestre', 'Plateforme', 'Cours', 'Enrôl. tuteurs', 'Enrôl. étudiants', 'Enrôl. enseignants', 'État', 'Début prévu', 'Fin prévue', 'Démarré le', 'Terminé le'],
    tut.map(t => [t.pole, t.formation, t.promo, t.niveau, t.semestre_code, t.plateforme_cours, t.cours,
      t.enrolement_tuteurs, t.enrolement_etudiants, t.enrolement_enseignants,
      ETAT_T[t.etat_tutorat] || t.etat_tutorat, t.date_debut, t.date_fin, t.date_demarree_le, t.date_terminee_le]),
    [10, 40, 8, 8, 10, 16, 14, 14, 14, 16, 12, 12, 12, 12, 12]);

  /* ===== 4. Sessions d'examen ===== */
  const sess = db.prepare(`
    SELECT se.*, p.code pole, f.nom formation, pr.code promo
    FROM sessions_examen se
    LEFT JOIN poles p ON p.id = se.pole_id
    LEFT JOIN formations f ON f.id = se.formation_id
    LEFT JOIN promotions pr ON pr.id = se.promotion_id
    ${annee_id ? 'WHERE se.annee_id = ' + annee_id : ''}
    ORDER BY se.session_num, p.code
  `).all();
  feuilleStat(wb, 'Sessions examen',
    ['Session', 'Pôle', 'Formation', 'Promo', 'Niveau', 'Semestre', 'Démarrage', 'Fin prévue', 'Programmation', 'Sujets reçus', 'Date réception', 'État', 'Délibération', 'Date délibération'],
    sess.map(x => [x.session_num === 1 ? 'Normale' : 'Rattrapage', x.pole, x.formation, x.promo, x.niveau, x.semestre_code,
      x.date_demarrage, x.date_fin_prevue, x.date_programmation, x.sujets_reception, x.date_reception_sujets,
      x.etat, x.deliberation ? 'Oui' : 'Non', x.date_deliberation]),
    [12, 10, 38, 8, 8, 10, 12, 12, 14, 12, 14, 12, 12, 14]);

  /* ===== 5. Incidents ===== */
  const inc = db.prepare(`
    SELECT i.*, p.nom pole, u.nom snom, u.prenom sprenom
    FROM incidents i LEFT JOIN poles p ON p.id = i.pole_id JOIN users u ON u.id = i.signale_par
    ORDER BY i.created_at DESC
  `).all();
  feuilleStat(wb, 'Incidents',
    ['Titre', 'Type', 'Gravité', 'Statut', 'Pôle', 'Début', 'Fin', 'Conséq. examens', 'Conséq. tutorat', 'Conséq. calendrier', 'Signalé par'],
    inc.map(i => [i.titre, i.type_incident, i.gravite, i.statut, i.pole, i.date_debut, i.date_fin,
      i.consequence_examens, i.consequence_tutorat, i.consequence_calendrier, `${i.sprenom} ${i.snom}`]),
    [35, 18, 10, 10, 30, 11, 11, 22, 22, 22, 20]);

  /* ===== 6. Connexions ===== */
  const cnx = db.prepare(`
    SELECT u.nom, u.prenom, u.role, COUNT(s.id) sessions,
      MAX(s.connected_at) derniere,
      ROUND(SUM((julianday(COALESCE(s.disconnected_at, s.last_activity)) - julianday(s.connected_at)) * 24 * 60)) minutes
    FROM users u LEFT JOIN user_sessions s ON s.user_id = u.id
    WHERE u.actif = 1 GROUP BY u.id ORDER BY minutes DESC
  `).all();
  const wsCnx = feuilleStat(wb, 'Connexions',
    ['Utilisateur', 'Rôle', 'Nb connexions', 'Dernière connexion', 'Temps total (min)'],
    cnx.map(c => [`${c.prenom} ${c.nom}`, c.role, c.sessions, c.derniere, c.minutes || 0]),
    [28, 24, 14, 20, 16]);
  barresDonnees(wsCnx, 'E', 2, cnx.length + 1);

  /* Envoi */
  const nomFichier = `Statistiques_DFIP_${(annee?.libelle || 'global').replace(/[^0-9a-zA-Z-]/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nomFichier}"`);
  await wb.xlsx.write(res);
  res.end();

  db.prepare('INSERT INTO audit_logs (user_id, action, module, detail) VALUES (?, ?, ?, ?)')
    .run(req.user.id, 'EXPORT_EXCEL', 'DASHBOARD', nomFichier);
});

module.exports = router;
