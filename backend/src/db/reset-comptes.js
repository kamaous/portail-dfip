// Réinitialise les comptes : supprime tous les utilisateurs SAUF l'admin du portail,
// re-pointe les références vers l'admin, puis crée les comptes de test officiels.
const bcrypt = require('bcryptjs');
const { getDb } = require('./connection');

const db = getDb();
const PASSWORD = 'Test@2026';
const hash = bcrypt.hashSync(PASSWORD, 10);

const admin = db.prepare("SELECT id FROM users WHERE role = 'ADMIN_PORTAIL' ORDER BY id LIMIT 1").get();
if (!admin) { console.error('Admin introuvable'); process.exit(1); }

const poleId = code => db.prepare('SELECT id FROM poles WHERE code = ?').get(code)?.id || null;

const purge = db.transaction(() => {
  // Données volatiles liées aux comptes
  db.prepare('DELETE FROM notifications').run();
  db.prepare('DELETE FROM user_sessions').run();
  db.prepare('DELETE FROM planning_demandes').run();
  db.prepare('DELETE FROM taches').run();
  db.prepare('DELETE FROM tache_commentaires').run();
  db.prepare('DELETE FROM incident_commentaires').run();
  db.prepare('DELETE FROM reunions').run();
  // Re-pointer les créations vers l'admin
  db.prepare('UPDATE planning_activites SET created_by = ?').run(admin.id);
  db.prepare('UPDATE tutorat SET created_by = ?, valide_par = NULL').run(admin.id);
  db.prepare('UPDATE sessions_examen SET created_by = ?').run(admin.id);
  db.prepare('UPDATE incidents SET signale_par = ?, assigne_a = NULL').run(admin.id);
  db.prepare('UPDATE calendriers SET uploaded_by = ?, valide_par = NULL').run(admin.id);
  db.prepare('UPDATE audit_logs SET user_id = ?').run(admin.id);
  db.prepare('UPDATE jours_feries SET created_by = ?').run(admin.id);
  db.prepare('UPDATE vacances SET created_by = ?').run(admin.id);
  db.prepare('UPDATE annees_academiques SET id = id').run();
  // Supprimer tous les autres comptes
  const n = db.prepare('DELETE FROM users WHERE id != ?').run(admin.id).changes;
  return n;
});
const supprimes = purge();
console.log(`${supprimes} compte(s) supprimé(s) (admin conservé).`);

const COMPTES = [
  ['Recteur', 'Test', 'test.recteur@unchk.edu.sn', 'RECTEUR', null],
  ['Vice-Recteur', 'Test', 'vicerecteur@unchk.edu.sn', 'VICE_RECTEUR', null],
  ['Directeur DFIP', 'Test', 'dfip@unchk.edu.sn', 'DIRECTEUR', null],
  ['Directeur STN', 'Test', 'dpstn@unchk.edu.sn', 'RESPONSABLE_POLE', poleId('STN')],
  ['Directeur SEJA', 'Test', 'dpseja@unchk.edu.sn', 'RESPONSABLE_POLE', poleId('SEJA')],
  ['Directeur LSHE', 'Test', 'dplshe@unchk.edu.sn', 'RESPONSABLE_POLE', poleId('LSHE')],
  ['Resp. Formation IDA', 'Test', 'respida@unchk.edu.sn', 'RESPONSABLE_FORMATION', poleId('STN')],
  ['Resp. Formation ANG', 'Test', 'respang@unchk.edu.sn', 'RESPONSABLE_FORMATION', poleId('LSHE')],
  ['Resp. Formation SJ', 'Test', 'respsj@unchk.edu.sn', 'RESPONSABLE_FORMATION', poleId('SEJA')],
  ['Chef Technopédagogie', 'Test', 'cheftechnoped@unchk.edu.sn', 'CHEF_DIV_TECHNOPEDAGOGIE', null],
  ['Chef division DFE', 'Test', 'chefdfe@unchk.edu.sn', 'CHEF_DIV_EVALUATION', null],
  ['Étudiant', 'Test', 'etudiant@unchk.edu.sn', 'ETUDIANT', poleId('STN')],
];

const ins = db.prepare(`
  INSERT INTO users (nom, prenom, email, password_hash, role, pole_id, must_change_password, actif)
  VALUES (?, ?, ?, ?, ?, ?, 0, 1)
`);
COMPTES.forEach(([nom, prenom, email, role, pole]) => {
  ins.run(nom, prenom, email, hash, role, pole);
  console.log(`  ${email.padEnd(32)} ${role}${pole ? ' (pôle ' + pole + ')' : ''}`);
});
console.log(`\nMot de passe commun : ${PASSWORD}`);
console.log('Total utilisateurs :', db.prepare('SELECT COUNT(*) c FROM users').get().c);
