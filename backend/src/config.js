// Secrets locaux (fichier NON versionné — voir config.secrets.example.js)
let secrets = {};
try { secrets = require('./config.secrets'); } catch { /* env vars uniquement */ }

module.exports = {
  PORT: process.env.PORT || 5100,
  JWT_SECRET: process.env.JWT_SECRET || secrets.JWT_SECRET || 'dev-secret-local-uniquement',
  JWT_EXPIRES_IN: '8h',
  SESSION_TIMEOUT_MINUTES: 60,

  SMTP: {
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    user: process.env.SMTP_USER || secrets.SMTP_USER || 'ousmane.kama@unchk.edu.sn',
    pass: process.env.SMTP_PASS || secrets.SMTP_PASS || '',
    from: '"Portail DFIP - UnCHK" <ousmane.kama@unchk.edu.sn>'
  },

  UPLOAD_DIR: require('path').join(__dirname, '../uploads'),

  // Hiérarchie des rôles (plus l'index est bas, plus le rôle est élevé)
  ROLES: [
    'RECTEUR', 'VICE_RECTEUR', 'DIRECTEUR', 'DIRECTEUR_DES', 'COORDONNATEUR', 'CHEF_SERVICE',
    'CHEF_DIV_TECHNOPEDAGOGIE', 'CHEF_DIV_EVALUATION',
    'RESPONSABLE_POLE', 'RESPONSABLE_PEDAGOGIQUE', 'RESPONSABLE_FORMATION',
    'MEMBRE_POLE', 'SCOLARITE', 'ENSEIGNANT', 'ETUDIANT', 'ADMIN_PORTAIL'
  ],

  // Héritage de rôles : le Responsable pédagogique du pôle cumule
  // les privilèges du Directeur de pôle ET du Responsable de formation.
  ROLE_HERITAGE: {
    RESPONSABLE_PEDAGOGIQUE: ['RESPONSABLE_POLE', 'RESPONSABLE_FORMATION'],
  },

  // Alias de droits : le rôle hérite de TOUS les droits du rôle cible
  // (l'utilisateur garde son libellé propre, mais est traité comme le rôle cible).
  ROLE_ALIAS: {
    COORDONNATEUR: 'ADMIN_PORTAIL',  // Coordonnateur du projet : tout voir, tout tester
    DIRECTEUR_DES: 'DIRECTEUR',      // DES : mêmes vues et droits que le Directeur DFIP
  },

  // Rôles « visiteurs » : accès en LECTURE SEULE au planning annuel uniquement
  ROLES_VISITEURS: ['RECTEUR', 'VICE_RECTEUR', 'SCOLARITE', 'MEMBRE_POLE', 'ENSEIGNANT', 'ETUDIANT'],

  ROLE_LABELS: {
    RECTEUR: 'Recteur',
    VICE_RECTEUR: 'Vice-Recteur Pédagogie',
    DIRECTEUR: 'Directeur DFIP',
    DIRECTEUR_DES: 'Directeur des Études et de la Scolarité (DES)',
    COORDONNATEUR: 'Coordonnateur du Projet',
    CHEF_SERVICE: 'Chef de Service',
    CHEF_DIV_TECHNOPEDAGOGIE: 'Chef division Technopédagogie',
    CHEF_DIV_EVALUATION: 'Chef division DFE (Formation & Évaluations)',
    RESPONSABLE_POLE: 'Directeur de Pôle',
    RESPONSABLE_PEDAGOGIQUE: 'Responsable pédagogique du Pôle',
    RESPONSABLE_FORMATION: 'Responsable de Formation',
    MEMBRE_POLE: 'Membre de Pôle',
    SCOLARITE: 'Scolarité',
    ENSEIGNANT: 'Enseignant',
    ETUDIANT: 'Étudiant',
    ADMIN_PORTAIL: 'Administrateur du Portail'
  },

  // Rôles à visibilité restreinte à leur pôle (voient uniquement ce qui les concerne).
  // Les Directeurs de pôle et Responsables pédagogiques voient TOUS les pôles (comme la direction).
  ROLES_RESTREINTS: ['MEMBRE_POLE', 'RESPONSABLE_FORMATION', 'ENSEIGNANT', 'ETUDIANT']
};
