// Importe la hiérarchie Pôles / Promo-Filières / Semestres depuis la base Dashboard DFE
// pour garantir une structure identique entre les deux projets.
const Database = require('better-sqlite3');
const path = require('path');
const { getDb } = require('./connection');

const SRC_PATH = process.env.DFE_DB ||
  'C:/Users/Ousmane KAMA/ClaudeCode/dashboarddfe/backend/database.sqlite';

const src = new Database(SRC_PATH, { readonly: true });
const dest = getDb();

const poles = src.prepare('SELECT id, code, nom FROM poles ORDER BY id').all();
const filieres = src.prepare('SELECT id, pole_id, nom FROM promo_filieres ORDER BY id').all();
const semestres = src.prepare('SELECT id, promo_filiere_id, nom FROM semestres ORDER BY id').all();

console.log(`Source : ${poles.length} pôles, ${filieres.length} filières, ${semestres.length} semestres`);

const importer = dest.transaction(() => {
  // Vider l'ancienne structure (CASCADE supprime filières + semestres liés)
  dest.prepare('DELETE FROM semestres').run();
  dest.prepare('DELETE FROM promo_filieres').run();
  dest.prepare('DELETE FROM poles').run();

  const insPole = dest.prepare('INSERT INTO poles (id, code, nom) VALUES (?, ?, ?)');
  const insFil = dest.prepare('INSERT INTO promo_filieres (id, pole_id, nom) VALUES (?, ?, ?)');
  const insSem = dest.prepare('INSERT INTO semestres (id, promo_filiere_id, nom) VALUES (?, ?, ?)');

  poles.forEach(p => insPole.run(p.id, p.code, p.nom));
  filieres.forEach(f => insFil.run(f.id, f.pole_id, f.nom));
  semestres.forEach(s => insSem.run(s.id, s.promo_filiere_id, s.nom));
});

importer();

console.log('Import terminé :');
console.log(`  ${dest.prepare('SELECT COUNT(*) c FROM poles').get().c} pôles`);
console.log(`  ${dest.prepare('SELECT COUNT(*) c FROM promo_filieres').get().c} filières`);
console.log(`  ${dest.prepare('SELECT COUNT(*) c FROM semestres').get().c} semestres`);

src.close();
