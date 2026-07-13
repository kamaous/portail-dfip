// REFONTE du référentiel : remplace l'ancien modèle promo-filières (importé du Dashboard DFE)
// par le modèle réel UN-CHK issu des fichiers officiels :
//   - Calendrier académique 2025-2026 UN-CHK.xlsx (feuille "Formations" : formations par pôle et cycle)
//   - Situation pédagogique UNCHK (promotions P9..P13, suivi Promotion × Niveau × Semestre × Formation)
// Crée aussi un compte de test par profil.
const XLSX = require('xlsx');
const bcrypt = require('bcryptjs');
const { getDb } = require('./connection');
const { ROLE_LABELS } = require('../config');

const CAL_PATH = process.env.CAL_XLSX ||
  'C:/Users/Ousmane KAMA/ClaudeCode/Calendrier académique 2025-2026 UN-CHK.xlsx';

const db = getDb();

/* ========== 1. PURGE de l'ancien référentiel et des données liées ========== */
console.log('=== 1. Purge ancien référentiel ===');
const purge = db.transaction(() => {
  db.prepare('DELETE FROM calendrier_evenements').run();
  db.prepare('DELETE FROM calendriers').run();
  db.prepare('DELETE FROM tutorat').run();
  db.prepare('DELETE FROM sessions_examen').run();
  db.prepare('UPDATE incidents SET promo_filiere_id = NULL').run();
  db.prepare('DELETE FROM semestres').run();
  db.prepare('DELETE FROM promo_filieres').run();
  db.prepare('DELETE FROM formations').run();
  db.prepare('DELETE FROM promotions').run();
});
purge();
console.log('  Ancien référentiel (385 filières / 2196 semestres) et données de test supprimés.');

/* ========== 2. PÔLES : noms officiels des fichiers ========== */
console.log('=== 2. Pôles officiels ===');
const POLES = [
  { code: 'LSHE', nom: "Pôle Lettres, Sciences humaines et de l'Education (PLSHE)" },
  { code: 'STN', nom: 'Pôle Sciences, Technologies et Numérique (PSTN)' },
  { code: 'SEJA', nom: "Pôle Sciences économiques, juridiques et de l'Administration (PSEJA)" },
];
POLES.forEach(p => {
  const ex = db.prepare('SELECT id FROM poles WHERE code = ?').get(p.code);
  if (ex) db.prepare('UPDATE poles SET nom = ? WHERE id = ?').run(p.nom, ex.id);
  else db.prepare('INSERT INTO poles (code, nom) VALUES (?, ?)').run(p.code, p.nom);
  console.log('  ' + p.code + ' — ' + p.nom);
});
const poleId = code => db.prepare('SELECT id FROM poles WHERE code = ?').get(code).id;

/* ========== 3. FORMATIONS depuis la feuille "Formations" du calendrier ========== */
console.log('=== 3. Formations (feuille "Formations") ===');
const wb = XLSX.readFile(CAL_PATH);
const rows = XLSX.utils.sheet_to_json(wb.Sheets['Formations'], { header: 1, defval: '' });
// Colonnes : A=cycle marker, B=SEJA, C=STN, D=LSHE
const COLS = { 1: 'SEJA', 2: 'STN', 3: 'LSHE' };
let cycle = null;
const insFormation = db.prepare('INSERT OR IGNORE INTO formations (pole_id, nom, code, cycle) VALUES (?, ?, ?, ?)');
let nb = 0;
for (const r of rows) {
  const marker = String(r[0] || '').trim().toUpperCase();
  if (marker === 'LICENCE') cycle = 'LICENCE';
  else if (marker === 'MASTER') cycle = 'MASTER';
  if (!cycle) continue;
  for (const [col, pole] of Object.entries(COLS)) {
    const nom = String(r[col] || '').replace(/\s+/g, ' ').trim();
    if (!nom || nom === pole) continue;
    const m = nom.match(/\(([^)]+)\)\s*$/);
    const code = m ? m[1].trim() : null;
    const res = insFormation.run(poleId(pole), nom, code, cycle);
    if (res.changes) nb++;
  }
}
console.log(`  ${nb} formations importées.`);
db.prepare('SELECT p.code pole, f.cycle, COUNT(*) c FROM formations f JOIN poles p ON p.id = f.pole_id GROUP BY p.code, f.cycle ORDER BY p.code, f.cycle')
  .all().forEach(x => console.log(`   ${x.pole} ${x.cycle}: ${x.c}`));

/* ========== 4. PROMOTIONS (Situation pédagogique : P9..P13) ========== */
console.log('=== 4. Promotions ===');
const PROMOS = [
  { code: 'P9',  annee_entree: '2021-2022' },
  { code: 'P10', annee_entree: '2022-2023' },
  { code: 'P11', annee_entree: '2023-2024' },
  { code: 'P12', annee_entree: '2024-2025' },
  { code: 'P13', annee_entree: '2025-2026' },
];
const insPromo = db.prepare('INSERT OR IGNORE INTO promotions (code, annee_entree) VALUES (?, ?)');
PROMOS.forEach(p => { insPromo.run(p.code, p.annee_entree); console.log(`  ${p.code} (entrée ${p.annee_entree})`); });

/* ========== 5. Année académique 2025-2026 active ========== */
console.log('=== 5. Année académique ===');
const an = db.prepare('SELECT id FROM annees_academiques WHERE libelle = ?').get('2025-2026');
if (!an) db.prepare('INSERT INTO annees_academiques (libelle, active) VALUES (?, 0)').run('2025-2026');
db.prepare('UPDATE annees_academiques SET active = 0').run();
db.prepare("UPDATE annees_academiques SET active = 1 WHERE libelle = '2025-2026'").run();
console.log('  2025-2026 créée et activée.');

/* ========== 6. COMPTES DE TEST (un par profil) ========== */
console.log('=== 6. Comptes de test ===');
const PASSWORD = 'Test@2026';
const hash = bcrypt.hashSync(PASSWORD, 10);
const stnId = poleId('STN');
// Rôles rattachés à un pôle pour tester la restriction de visibilité
const AVEC_POLE = ['RESPONSABLE_POLE', 'RESPONSABLE_FORMATION', 'MEMBRE_POLE', 'ENSEIGNANT', 'ETUDIANT'];
const insUser = db.prepare(`
  INSERT OR IGNORE INTO users (nom, prenom, email, password_hash, role, pole_id, must_change_password, actif)
  VALUES (?, ?, ?, ?, ?, ?, 0, 1)
`);
const comptes = [];
for (const [role, label] of Object.entries(ROLE_LABELS)) {
  if (role === 'ADMIN_PORTAIL') continue; // le compte admin existe déjà
  const email = `test.${role.toLowerCase().replace(/_/g, '-')}@unchk.edu.sn`;
  insUser.run(label, 'Test', email, hash, role, AVEC_POLE.includes(role) ? stnId : null);
  comptes.push({ role: label, email });
  console.log(`  ${label.padEnd(38)} ${email}`);
}
console.log(`  Mot de passe commun : ${PASSWORD}`);

console.log('\n=== REFONTE TERMINÉE ===');
console.log('Formations:', db.prepare('SELECT COUNT(*) c FROM formations').get().c);
console.log('Promotions:', db.prepare('SELECT COUNT(*) c FROM promotions').get().c);
console.log('Utilisateurs:', db.prepare('SELECT COUNT(*) c FROM users WHERE actif = 1').get().c);
