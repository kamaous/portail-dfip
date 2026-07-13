const { getDb } = require('./connection');
const bcrypt = require('bcryptjs');

const db = getDb();

// Poles (repris du dashboarddfe)
const poles = [
  { code: 'POLE1', nom: 'Pôle Sciences et Technologies' },
  { code: 'POLE2', nom: 'Pôle Sciences de la Santé' },
  { code: 'POLE3', nom: 'Pôle Sciences Humaines et Sociales' },
  { code: 'POLE4', nom: 'Pôle Sciences Économiques et Juridiques' },
];

const insertPoles = db.prepare('INSERT OR IGNORE INTO poles (code, nom) VALUES (?, ?)');
poles.forEach(p => insertPoles.run(p.code, p.nom));

// Année académique initiale
db.prepare('INSERT OR IGNORE INTO annees_academiques (libelle, active) VALUES (?, ?)').run('2024-2025', 1);

// Utilisateurs par défaut
const users = [
  {
    nom: 'KAMA',
    prenom: 'Ousmane',
    email: 'ousmane.kama@unchk.edu.sn',
    password: 'Admin@2025',
    role: 'ADMIN_PORTAIL',
    must_change_password: 0
  },
  {
    nom: 'DIRECTEUR',
    prenom: 'DFE',
    email: 'directeur.dfe@unchk.edu.sn',
    password: 'DFE@2025',
    role: 'DIRECTEUR',
    must_change_password: 1
  },
  {
    nom: 'NDIAYE',
    prenom: 'Mamadou',
    email: 'chef.service1@unchk.edu.sn',
    password: 'Chef@2025',
    role: 'CHEF_SERVICE',
    must_change_password: 1
  },
];

const insertUser = db.prepare(`
  INSERT OR IGNORE INTO users (nom, prenom, email, password_hash, role, must_change_password)
  VALUES (?, ?, ?, ?, ?, ?)
`);

users.forEach(u => {
  const hash = bcrypt.hashSync(u.password, 10);
  insertUser.run(u.nom, u.prenom, u.email, hash, u.role, u.must_change_password);
});

console.log('Seed terminé avec succès.');
console.log('Comptes créés :');
users.forEach(u => console.log(`  ${u.role}: ${u.email} / ${u.password}`));
