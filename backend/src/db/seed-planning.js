// Seed du planning annuel 2025-2026 (inspiré de la feuille "Planning global"
// du Calendrier académique UN-CHK). Dates indicatives — à ajuster dans le portail.
const { getDb } = require('./connection');

const db = getDb();
const annee = db.prepare("SELECT id FROM annees_academiques WHERE libelle = '2025-2026'").get();
if (!annee) { console.error('Année 2025-2026 introuvable'); process.exit(1); }
const admin = db.prepare("SELECT id FROM users WHERE role = 'ADMIN_PORTAIL' LIMIT 1").get();

db.prepare('DELETE FROM planning_activites WHERE annee_id = ?').run(annee.id);

const ACTIVITES = [
  // RECTORAT
  ['RECTORAT', "Découpage de l'année", 'Découpage', '2025-11-03', '2025-11-28'],
  // DFIP & DES
  ['DFIP_DES', 'Inscriptions', 'C1', '2025-11-03', '2025-12-19'],
  ['DFIP_DES', 'Cours transversaux', 'TC', '2025-12-01', '2026-03-27'],
  ['DFIP_DES', 'Réinscriptions', 'T1', '2025-11-03', '2026-02-27'],
  ['DFIP_DES', 'Demandes de dérogation', 'Dérogations', '2025-11-17', '2025-12-12'],
  ['DFIP_DES', 'Formation des tuteurs', 'Formation', '2025-12-01', '2025-12-19'],
  ['DFIP_DES', 'Évaluations SEJA', 'Éval.', '2026-07-06', '2026-07-24'],
  ['DFIP_DES', 'Évaluations STN', 'Éval.', '2026-05-04', '2026-05-22'],
  ['DFIP_DES', 'Évaluations LSHE', 'Éval.', '2026-05-11', '2026-05-29'],
  // PSEJA
  ['PSEJA', 'Licence 1', 'S1', '2026-04-06', '2026-06-26'],
  ['PSEJA', 'Licence 1', 'S1N', '2026-07-06', '2026-07-17'],
  ['PSEJA', 'Licence 1', 'S2', '2026-07-20', '2026-10-16'],
  ['PSEJA', 'Licence 2', 'S3', '2026-04-06', '2026-06-12'],
  ['PSEJA', 'Licence 2', 'S3N', '2026-06-15', '2026-06-26'],
  ['PSEJA', 'Licence 2', 'S4', '2026-06-29', '2026-09-25'],
  ['PSEJA', 'Master 1', 'S1', '2026-04-06', '2026-06-26'],
  ['PSEJA', 'Master 2', 'S3', '2026-04-06', '2026-06-12'],
  // PSTN
  ['PSTN', 'Licence 1', 'S1', '2026-03-30', '2026-06-19'],
  ['PSTN', 'Licence 1', 'S1N', '2026-05-04', '2026-05-15'],
  ['PSTN', 'Licence 1', 'S2', '2026-05-18', '2026-08-14'],
  ['PSTN', 'Licence 2', 'S3', '2026-03-30', '2026-06-05'],
  ['PSTN', 'Master 1', 'S1', '2026-03-30', '2026-06-19'],
  // PLSHE
  ['PLSHE', 'Licence 1', 'S1', '2026-04-13', '2026-07-03'],
  ['PLSHE', 'Licence 1', 'S2', '2026-07-27', '2026-10-23'],
  ['PLSHE', 'Licence 2', 'S3', '2026-04-13', '2026-06-19'],
  ['PLSHE', 'Master 1', 'S1', '2026-04-13', '2026-07-03'],
];

const ins = db.prepare(`
  INSERT INTO planning_activites (annee_id, segment, ligne, libelle, date_debut, date_fin, created_by)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
ACTIVITES.forEach(([seg, ligne, lib, d1, d2]) => ins.run(annee.id, seg, ligne, lib, d1, d2, admin?.id || null));
console.log(`${ACTIVITES.length} activités de planning créées pour 2025-2026.`);

/* Fériés civils fixes (récurrents) + périodes de vacances pour les bandes verticales */
const FERIES = [
  ['2025-12-25', 'Noël', 1],
  ['2026-01-01', "Jour de l'an", 1],
  ['2026-04-04', "Fête de l'Indépendance", 1],
  ['2026-05-01', 'Fête du Travail', 1],
  ['2026-08-15', 'Assomption', 1],
  ['2026-11-01', 'Toussaint', 1],
];
const insF = db.prepare('INSERT INTO jours_feries (date, libelle, recurrent, created_by) SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM jours_feries WHERE libelle = ?)');
FERIES.forEach(([d, l, r]) => insF.run(d, l, r, admin?.id || null, l));

const VACANCES = [
  ["Fêtes de fin d'année", '2025-12-22', '2026-01-02'],
  ['Grandes vacances', '2026-08-01', '2026-09-30'],
];
const insV = db.prepare('INSERT INTO vacances (annee_id, libelle, date_debut, date_fin, created_by) SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM vacances WHERE libelle = ? AND annee_id = ?)');
VACANCES.forEach(([l, d1, d2]) => insV.run(annee.id, l, d1, d2, admin?.id || null, l, annee.id));
console.log('Fériés civils et périodes de vacances ajoutés (fêtes mobiles Korité/Tabaski/Magal/Maouloud/Pâques : à renseigner par le Directeur).');
