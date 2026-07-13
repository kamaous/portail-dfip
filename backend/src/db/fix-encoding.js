// Répare les chaînes corrompues (U+FFFD �) introduites par des tests curl
// dont l'encodage Windows n'était pas UTF-8. L'application web n'est pas en cause.
const { getDb } = require('./connection');
const db = getDb();

// Corrections de caractères connus (les valeurs d'origine sont documentées par les seeds/tests)
const REMPLACEMENTS = [
  ['Coupure �lectricit�', 'Coupure électricité'],
  ['pr�vu', 'prévu'],
  ['report�', 'reporté'],
  ['prolong�e', 'prolongée'],
  ['D�calage', 'Décalage'],
  ['D�coupage MODIFI�', 'Découpage MODIFIÉ'],
  ["D�coupage de l'ann�e", "Découpage de l'année"],
  ['F�te de l Ind�pendance', "Fête de l'Indépendance"],
  ['D�lib', 'Délib'],
];

function reparer(s) {
  let out = s;
  for (const [de, vers] of REMPLACEMENTS) out = out.split(de).join(vers);
  return out;
}

let corrigees = 0, restantes = 0;
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
for (const t of tables) {
  const cols = db.prepare(`PRAGMA table_info(${t})`).all().filter(c => c.type === 'TEXT').map(c => c.name);
  for (const c of cols) {
    let rows;
    try { rows = db.prepare(`SELECT id, ${c} as v FROM ${t} WHERE ${c} LIKE ?`).all('%�%'); }
    catch { continue; }
    for (const r of rows) {
      const fixed = reparer(r.v);
      if (fixed !== r.v && !fixed.includes('�')) {
        db.prepare(`UPDATE ${t} SET ${c} = ? WHERE id = ?`).run(fixed, r.id);
        corrigees++;
      } else {
        console.log(`  ⚠ non résolu : ${t}.${c} #${r.id}: ${r.v}`);
        restantes++;
      }
    }
  }
}

// Cas particulier : l'activité #3 du planning était « TC » avant le test de modification
const act3 = db.prepare('SELECT * FROM planning_activites WHERE id = 3').get();
if (act3 && act3.libelle === 'Découpage MODIFIÉ') {
  db.prepare("UPDATE planning_activites SET libelle = 'TC', date_debut = '2025-12-01' WHERE id = 3").run();
  console.log('  Activité #3 restaurée : TC (2025-12-01)');
}

console.log(`${corrigees} valeur(s) corrigée(s), ${restantes} restante(s).`);
