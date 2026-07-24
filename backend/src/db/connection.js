const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../database.sqlite');
let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
    runMigrations();
  }
  return db;
}

function initSchema() {
  db.exec(`
    -- Utilisateurs
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL,
      prenom TEXT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'MEMBRE_POLE',
      pole_id INTEGER,
      service TEXT,
      must_change_password INTEGER NOT NULL DEFAULT 1,
      avatar TEXT,
      actif INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (pole_id) REFERENCES poles(id)
    );

    -- Pôles (repris du dashboarddfe)
    CREATE TABLE IF NOT EXISTS poles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      nom TEXT
    );

    -- Promo / Filières
    CREATE TABLE IF NOT EXISTS promo_filieres (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pole_id INTEGER NOT NULL,
      nom TEXT NOT NULL,
      UNIQUE(pole_id, nom),
      FOREIGN KEY (pole_id) REFERENCES poles(id) ON DELETE CASCADE
    );

    -- Semestres
    CREATE TABLE IF NOT EXISTS semestres (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      promo_filiere_id INTEGER NOT NULL,
      nom TEXT NOT NULL,
      UNIQUE(promo_filiere_id, nom),
      FOREIGN KEY (promo_filiere_id) REFERENCES promo_filieres(id) ON DELETE CASCADE
    );

    -- Formations officielles par pôle (référentiel issu du Calendrier académique UN-CHK)
    CREATE TABLE IF NOT EXISTS formations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pole_id INTEGER NOT NULL,
      nom TEXT NOT NULL,
      code TEXT,
      cycle TEXT NOT NULL DEFAULT 'LICENCE',   -- LICENCE | MASTER
      UNIQUE(pole_id, nom, cycle),
      FOREIGN KEY (pole_id) REFERENCES poles(id) ON DELETE CASCADE
    );

    -- Promotions (cohortes : P9, P10, ... P13)
    CREATE TABLE IF NOT EXISTS promotions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      annee_entree TEXT,
      active INTEGER NOT NULL DEFAULT 1
    );

    -- Années académiques
    CREATE TABLE IF NOT EXISTS annees_academiques (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      libelle TEXT UNIQUE NOT NULL,
      active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Calendriers académiques (uploadés par les directeurs de pôle)
    CREATE TABLE IF NOT EXISTS calendriers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      annee_id INTEGER NOT NULL,
      pole_id INTEGER NOT NULL,
      promo_filiere_id INTEGER,
      semestre_id INTEGER,
      uploaded_by INTEGER NOT NULL,
      fichier_nom TEXT NOT NULL,
      fichier_path TEXT NOT NULL,
      statut TEXT NOT NULL DEFAULT 'EN_ATTENTE',
      valide_par INTEGER,
      date_validation TEXT,
      observations TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (annee_id) REFERENCES annees_academiques(id),
      FOREIGN KEY (pole_id) REFERENCES poles(id),
      FOREIGN KEY (promo_filiere_id) REFERENCES promo_filieres(id),
      FOREIGN KEY (semestre_id) REFERENCES semestres(id),
      FOREIGN KEY (uploaded_by) REFERENCES users(id),
      FOREIGN KEY (valide_par) REFERENCES users(id)
    );

    -- Tâches (entre tous les acteurs)
    CREATE TABLE IF NOT EXISTS taches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titre TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL DEFAULT 'GENERALE',
      priorite TEXT NOT NULL DEFAULT 'NORMALE',
      statut TEXT NOT NULL DEFAULT 'OUVERTE',
      assigne_par INTEGER NOT NULL,
      assigne_a INTEGER NOT NULL,
      date_echeance TEXT,
      date_completion TEXT,
      module TEXT,
      ref_id INTEGER,
      observations TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (assigne_par) REFERENCES users(id),
      FOREIGN KEY (assigne_a) REFERENCES users(id)
    );

    -- Commentaires sur les tâches
    CREATE TABLE IF NOT EXISTS tache_commentaires (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tache_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      contenu TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (tache_id) REFERENCES taches(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Tutorat
    CREATE TABLE IF NOT EXISTS tutorat (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      annee_id INTEGER NOT NULL,
      pole_id INTEGER,
      promo_filiere_id INTEGER,
      semestre_id INTEGER,
      tuteur_id INTEGER,
      etudiant_nom TEXT,
      etudiant_matricule TEXT,
      sujet TEXT,
      statut TEXT NOT NULL DEFAULT 'EN_COURS',
      date_debut TEXT,
      date_fin TEXT,
      observations TEXT,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (annee_id) REFERENCES annees_academiques(id),
      FOREIGN KEY (pole_id) REFERENCES poles(id),
      FOREIGN KEY (promo_filiere_id) REFERENCES promo_filieres(id),
      FOREIGN KEY (semestre_id) REFERENCES semestres(id),
      FOREIGN KEY (tuteur_id) REFERENCES users(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    -- Examens
    CREATE TABLE IF NOT EXISTS examens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      annee_id INTEGER NOT NULL,
      pole_id INTEGER,
      promo_filiere_id INTEGER,
      semestre_id INTEGER,
      libelle TEXT NOT NULL,
      type_examen TEXT NOT NULL DEFAULT 'ORDINAIRE',
      date_debut TEXT,
      date_fin TEXT,
      salle TEXT,
      surveillant_id INTEGER,
      statut TEXT NOT NULL DEFAULT 'PLANIFIE',
      nb_inscrits INTEGER,
      nb_presents INTEGER,
      pv_deliberation TEXT,
      observations TEXT,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (annee_id) REFERENCES annees_academiques(id),
      FOREIGN KEY (pole_id) REFERENCES poles(id),
      FOREIGN KEY (promo_filiere_id) REFERENCES promo_filieres(id),
      FOREIGN KEY (semestre_id) REFERENCES semestres(id),
      FOREIGN KEY (surveillant_id) REFERENCES users(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    -- Incidents
    CREATE TABLE IF NOT EXISTS incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titre TEXT NOT NULL,
      description TEXT NOT NULL,
      type_incident TEXT NOT NULL DEFAULT 'AUTRE',
      gravite TEXT NOT NULL DEFAULT 'FAIBLE',
      statut TEXT NOT NULL DEFAULT 'OUVERT',
      signale_par INTEGER NOT NULL,
      assigne_a INTEGER,
      pole_id INTEGER,
      promo_filiere_id INTEGER,
      module TEXT,
      date_incident TEXT,
      date_resolution TEXT,
      resolution TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (signale_par) REFERENCES users(id),
      FOREIGN KEY (assigne_a) REFERENCES users(id),
      FOREIGN KEY (pole_id) REFERENCES poles(id),
      FOREIGN KEY (promo_filiere_id) REFERENCES promo_filieres(id)
    );

    -- Commentaires incidents
    CREATE TABLE IF NOT EXISTS incident_commentaires (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      contenu TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Sessions de connexion (tracking)
    CREATE TABLE IF NOT EXISTS user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_jti TEXT UNIQUE NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      connected_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_activity TEXT NOT NULL DEFAULT (datetime('now')),
      disconnected_at TEXT,
      actif INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Notifications
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      titre TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'INFO',
      lue INTEGER NOT NULL DEFAULT 0,
      lien TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Logs d'audit
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      module TEXT,
      detail TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Sessions d'examen (par Pôle/Filière/Semestre et numéro de session)
    CREATE TABLE IF NOT EXISTS sessions_examen (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      annee_id INTEGER NOT NULL,
      pole_id INTEGER,
      promo_filiere_id INTEGER,
      semestre_id INTEGER,
      session_num INTEGER NOT NULL DEFAULT 1,      -- 1 = Normale, 2 = Rattrapage
      date_demarrage TEXT,
      etat TEXT NOT NULL DEFAULT 'PLANIFIE',        -- PLANIFIE, EN_COURS, TERMINE
      deliberation INTEGER NOT NULL DEFAULT 0,      -- 0 = Non, 1 = Oui
      date_deliberation TEXT,
      observations TEXT,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (annee_id) REFERENCES annees_academiques(id),
      FOREIGN KEY (pole_id) REFERENCES poles(id),
      FOREIGN KEY (promo_filiere_id) REFERENCES promo_filieres(id),
      FOREIGN KEY (semestre_id) REFERENCES semestres(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    -- Jours fériés (pour bloquer la programmation d'examens)
    CREATE TABLE IF NOT EXISTS jours_feries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      libelle TEXT NOT NULL,
      recurrent INTEGER NOT NULL DEFAULT 0,         -- 1 = se répète chaque année (jour/mois)
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    -- Événements de calendrier saisis manuellement (alternative à l'upload Excel)
    CREATE TABLE IF NOT EXISTS calendrier_evenements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      calendrier_id INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT 'AUTRE',          -- COURS, EXAMEN, VACANCES, DELIBERATION, AUTRE
      libelle TEXT NOT NULL,
      date_debut TEXT NOT NULL,
      date_fin TEXT,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (calendrier_id) REFERENCES calendriers(id) ON DELETE CASCADE
    );

    -- Réunions (intégration TerangaMeet)
    CREATE TABLE IF NOT EXISTS reunions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titre TEXT NOT NULL,
      description TEXT,
      date_reunion TEXT NOT NULL,               -- YYYY-MM-DD
      heure TEXT NOT NULL,                      -- HH:MM
      duree_minutes INTEGER NOT NULL DEFAULT 60,
      salle TEXT UNIQUE NOT NULL,               -- slug de la salle TerangaMeet
      statut TEXT NOT NULL DEFAULT 'PLANIFIEE', -- PLANIFIEE, EN_COURS, TERMINEE, ANNULEE
      organisateur_id INTEGER NOT NULL,
      participants TEXT NOT NULL DEFAULT '[]',  -- JSON [user_id, ...]
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (organisateur_id) REFERENCES users(id)
    );

    -- Planning annuel (Gantt) : activités par segment institutionnel
    CREATE TABLE IF NOT EXISTS planning_activites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      annee_id INTEGER NOT NULL,
      segment TEXT NOT NULL,          -- RECTORAT, DFIP_DES, PSEJA, PSTN, PLSHE
      ligne TEXT NOT NULL,            -- ex: "Licence 1", "Cours transversaux"
      libelle TEXT NOT NULL,          -- ex: "S1", "Réinscriptions"
      date_debut TEXT NOT NULL,
      date_fin TEXT NOT NULL,
      couleur TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (annee_id) REFERENCES annees_academiques(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    -- Demandes de modification/suppression du planning (validation par le Directeur DFIP)
    CREATE TABLE IF NOT EXISTS planning_demandes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activite_id INTEGER NOT NULL,
      type_demande TEXT NOT NULL,               -- MODIFICATION | SUPPRESSION
      payload TEXT,                              -- JSON des nouvelles valeurs (modification)
      statut TEXT NOT NULL DEFAULT 'EN_ATTENTE', -- EN_ATTENTE | VALIDEE | REJETEE
      demande_par INTEGER NOT NULL,
      valide_par INTEGER,
      traite_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (activite_id) REFERENCES planning_activites(id) ON DELETE CASCADE,
      FOREIGN KEY (demande_par) REFERENCES users(id),
      FOREIGN KEY (valide_par) REFERENCES users(id)
    );

    -- Signalements de non-conformité (Responsable de formation → traité par le Responsable pédagogique)
    CREATE TABLE IF NOT EXISTS signalements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cible_type TEXT NOT NULL,                 -- TUTORAT | EVALUATION
      cible_id INTEGER NOT NULL,
      pole_id INTEGER,
      formation_id INTEGER,
      objet TEXT NOT NULL,
      message TEXT NOT NULL,
      statut TEXT NOT NULL DEFAULT 'OUVERT',    -- OUVERT | TRAITE
      reponse TEXT,
      signale_par INTEGER NOT NULL,
      traite_par INTEGER,
      traite_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (pole_id) REFERENCES poles(id),
      FOREIGN KEY (formation_id) REFERENCES formations(id),
      FOREIGN KEY (signale_par) REFERENCES users(id),
      FOREIGN KEY (traite_par) REFERENCES users(id)
    );

    -- Vacances (renseignées uniquement par le Directeur)
    CREATE TABLE IF NOT EXISTS vacances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      annee_id INTEGER,
      libelle TEXT NOT NULL,
      date_debut TEXT NOT NULL,
      date_fin TEXT NOT NULL,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (annee_id) REFERENCES annees_academiques(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
  `);
}

function runMigrations() {
  const addColumns = (table, cols) => {
    const existing = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    for (const [col, def] of Object.entries(cols)) {
      if (!existing.includes(col)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
      }
    }
  };

  // Tutorat : suivi par semestre
  addColumns('tutorat', {
    plateforme_cours:      "TEXT NOT NULL DEFAULT 'PAS_DISPONIBLE'", // PAS_DISPONIBLE, DISPONIBLE, EN_DEPLOIEMENT
    cours:                 "TEXT NOT NULL DEFAULT 'INDISPONIBLES'",  // DISPONIBLES, INDISPONIBLES, EN_COURS
    enrolement_tuteurs:    "TEXT NOT NULL DEFAULT 'EN_ATTENTE'",      // EN_ATTENTE, EN_COURS, TERMINE
    enrolement_etudiants:  "TEXT NOT NULL DEFAULT 'EN_ATTENTE'",
    enrolement_enseignants:"TEXT NOT NULL DEFAULT 'EN_ATTENTE'",
    etat_tutorat:          "TEXT NOT NULL DEFAULT 'PAS_DEMARRE'",     // PAS_DEMARRE, EN_COURS, TERMINE
  });

  // Calendriers : mode de saisie
  addColumns('calendriers', {
    mode: "TEXT NOT NULL DEFAULT 'FICHIER'",  // FICHIER (Excel) | MANUEL
  });

  // Année : date de démarrage globale du tutorat
  addColumns('annees_academiques', {
    date_demarrage_tutorat: 'TEXT',
  });

  // Tutorat : dates effectives (état « démarré le / terminé le »)
  addColumns('tutorat', {
    date_demarree_le: 'TEXT',
    date_terminee_le: 'TEXT',
  });

  // Sessions d'examen : suivi des sujets et dates prévues
  addColumns('sessions_examen', {
    date_fin_prevue:        'TEXT',
    sujets_reception:       "TEXT NOT NULL DEFAULT 'AUCUNE'",  // AUCUNE, PARTIELLE, TOTALE
    date_reception_sujets:  'TEXT',
    date_programmation:     'TEXT',
  });

  // Refonte référentiel : Promotion × Formation × Niveau × Semestre (fichiers UN-CHK)
  addColumns('tutorat', {
    promotion_id:  'INTEGER',
    formation_id:  'INTEGER',
    niveau:        'TEXT',   // L1, L2, L3, M1, M2
    semestre_code: 'TEXT',   // CT, S1..S6
  });

  // Workflow fiches tutorat : création par Responsable de formation → validation Chef div. technopédagogie
  addColumns('tutorat', {
    statut_fiche:    "TEXT NOT NULL DEFAULT 'VALIDEE'",  // SOUMISE, VALIDEE, REJETEE
    valide_par:      'INTEGER',
    date_validation: 'TEXT',
  });
  addColumns('sessions_examen', {
    promotion_id:  'INTEGER',
    formation_id:  'INTEGER',
    niveau:        'TEXT',
    semestre_code: 'TEXT',
  });

  // Module Évaluations (fusion Examens + Sessions) : types, suivi Chef div. DFE, délibérations
  addColumns('sessions_examen', {
    type_evaluation:        "TEXT NOT NULL DEFAULT 'EVALUATION'",          // EVALUATION | DEVOIR
    reception_epreuves:     "TEXT NOT NULL DEFAULT 'PAS_DISPONIBLE'",      // DISPONIBLE, EN_COURS_COLLECTE, PAS_DISPONIBLE
    implementation_epreuves:"TEXT NOT NULL DEFAULT 'PAS_ENCORE'",          // EN_COURS, PAS_ENCORE, TERMINE
    etat_eval:              "TEXT NOT NULL DEFAULT 'CALENDRIER_DISPONIBLE'", // CALENDRIER_DISPONIBLE, EVAL_EN_COURS, EVAL_TERMINEES
    delib_etat:             "TEXT NOT NULL DEFAULT 'PAS_ENCORE'",          // PAS_ENCORE, PREVUE, TERMINEE
  });

  // Planning : type d'activité (alimente dynamiquement les modules Tutorat / Évaluations)
  addColumns('planning_activites', {
    type:      'TEXT',   // TUTORAT | EVALUATIONS | NULL (activité générique)
    sous_type: 'TEXT',   // pour EVALUATIONS : EXAMEN | DEVOIRS
  });
  // Typage rétroactif des plages d'évaluations historiques (lignes « Évaluations XXX »)
  db.exec(`
    UPDATE planning_activites SET type = 'EVALUATIONS', sous_type = COALESCE(sous_type, 'EXAMEN')
    WHERE type IS NULL AND ligne LIKE 'Évaluations %';
  `);

  // Liaison planning → modules : chaque activité typée alimente automatiquement
  // le module correspondant (fiche tutorat / évaluation liée, sans double saisie)
  addColumns('tutorat', { activite_id: 'INTEGER' });
  addColumns('sessions_examen', { activite_id: 'INTEGER' });

  // Rattrapage : créer les entrées liées pour les activités typées existantes
  const segPole = { PSEJA: 'SEJA', PSTN: 'STN', PLSHE: 'LSHE' };
  const nivMap = { 'Licence 1': 'L1', 'Licence 2': 'L2', 'Licence 3': 'L3', 'Master 1': 'M1', 'Master 2': 'M2' };
  const typees = db.prepare(`
    SELECT pa.* FROM planning_activites pa
    WHERE pa.type IN ('TUTORAT','EVALUATIONS')
      AND NOT EXISTS (SELECT 1 FROM tutorat t WHERE t.activite_id = pa.id)
      AND NOT EXISTS (SELECT 1 FROM sessions_examen se WHERE se.activite_id = pa.id)
  `).all();
  for (const pa of typees) {
    const poleCode = segPole[pa.segment];
    if (!poleCode) continue; // seuls les segments de pôle alimentent les modules
    const pole = db.prepare('SELECT id FROM poles WHERE code = ?').get(poleCode);
    if (!pole) continue;
    const admin = db.prepare("SELECT id FROM users WHERE role = 'ADMIN_PORTAIL' ORDER BY id LIMIT 1").get();
    const createdBy = pa.created_by || admin?.id;
    if (!createdBy) continue;
    if (pa.type === 'TUTORAT') {
      db.prepare(`
        INSERT INTO tutorat (annee_id, pole_id, niveau, date_debut, date_fin, statut_fiche, activite_id, created_by, observations)
        VALUES (?, ?, ?, ?, ?, 'VALIDEE', ?, ?, ?)
      `).run(pa.annee_id, pole.id, nivMap[pa.ligne] || null, pa.date_debut, pa.date_fin, pa.id, createdBy,
        `Issue du planning annuel : ${pa.libelle}`);
    } else {
      db.prepare(`
        INSERT INTO sessions_examen (annee_id, pole_id, niveau, session_num, type_evaluation,
          date_demarrage, date_fin_prevue, activite_id, created_by, observations)
        VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
      `).run(pa.annee_id, pole.id, nivMap[pa.ligne] || null,
        pa.sous_type === 'DEVOIRS' ? 'DEVOIR' : 'EVALUATION',
        pa.date_debut, pa.date_fin, pa.id, createdBy,
        `Issue du planning annuel : ${pa.libelle}`);
    }
  }

  // Incidents : types officiels + conséquences structurées avec périmètre
  addColumns('incidents', {
    conseq_eval:      'TEXT',   // REPORT, ANNULATION, RALLONGE, ARRET, AUTRE
    conseq_tutorat:   'TEXT',   // RETARD
    promotion_id:     'INTEGER',
    formation_id:     'INTEGER',
    niveau:           'TEXT',
    semestre_code:    'TEXT',
    session_num:      'INTEGER', // 1 Normale, 2 Rattrapage, 3 Spéciale
  });

  // Incidents : conséquences directes
  addColumns('incidents', {
    date_debut:             'TEXT',
    date_fin:               'TEXT',
    consequence_examens:    'TEXT',
    consequence_tutorat:    'TEXT',
    consequence_calendrier: 'TEXT',
    ref_type:               'TEXT',    // TUTORAT | SESSION_EXAMEN
    ref_id:                 'INTEGER',
  });

  // Évaluations : demande de suppression (Chef div DFE → validation Directeur DFIP)
  addColumns('sessions_examen', { suppr_demandee: 'INTEGER NOT NULL DEFAULT 0' });

  // Évaluations : créneau horaire quotidien (simultanéité exacte pour le simulateur)
  addColumns('sessions_examen', { heure_debut: 'TEXT', heure_fin: 'TEXT' });

  // ===== Module STATISTIQUES : ENO, capacités, effectifs (base du simulateur d'évaluations) =====
  db.exec(`
    CREATE TABLE IF NOT EXISTS enos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL UNIQUE,          -- ex: DAKAR, THIES...
      capacite INTEGER NOT NULL DEFAULT 0, -- capacité saisie (places) ; les salles peuvent l'affiner
      note TEXT,                          -- salles indisponibles, maintenance...
      actif INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS eno_salles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      eno_id INTEGER NOT NULL,
      nom TEXT NOT NULL,
      capacite INTEGER NOT NULL DEFAULT 0,
      disponible INTEGER NOT NULL DEFAULT 1, -- 0 = indisponible / maintenance
      note TEXT,
      FOREIGN KEY (eno_id) REFERENCES enos(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS effectifs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      promotion_code TEXT NOT NULL,      -- P13, P12...
      niveau TEXT NOT NULL,              -- L1..M2
      formation_id INTEGER NOT NULL,
      eno_id INTEGER NOT NULL,
      nombre INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (promotion_code, niveau, formation_id, eno_id),
      FOREIGN KEY (formation_id) REFERENCES formations(id) ON DELETE CASCADE,
      FOREIGN KEY (eno_id) REFERENCES enos(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS incident_historique (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id INTEGER NOT NULL,
      decision TEXT NOT NULL,
      detail TEXT,
      avant TEXT,
      apres TEXT,
      par INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
      FOREIGN KEY (par) REFERENCES users(id)
    );
  `);
  // Chargé de scolarité : rattaché à UN ENO
  addColumns('users', { eno_id: 'INTEGER' });

  // Planning annuel : lignes (niveaux) paramétrables par segment — gérées par le Directeur DFIP
  db.exec(`
    CREATE TABLE IF NOT EXISTS planning_lignes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      segment TEXT NOT NULL,   -- RECTORAT, DFIP_DES, PSEJA, PSTN, PLSHE
      nom TEXT NOT NULL,
      ordre INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (segment, nom),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
  `);
  // Amorçage : structure historique du fichier Excel + lignes déjà utilisées par des activités
  if (db.prepare('SELECT COUNT(*) as c FROM planning_lignes').get().c === 0) {
    const LIGNES_DEFAUT = {
      RECTORAT: ["Découpage de l'année"],
      DFIP_DES: ['Inscriptions', 'Cours transversaux', 'Réinscriptions', 'Demandes de dérogation', 'Formation des tuteurs', 'Évaluations SEJA', 'Évaluations STN', 'Évaluations LSHE'],
      PSEJA: ['Licence 1', 'Licence 2', 'Licence 3', 'Master 1', 'Master 2'],
      PSTN: ['Licence 1', 'Licence 2', 'Licence 3', 'Master 1', 'Master 2'],
      PLSHE: ['Licence 1', 'Licence 2', 'Licence 3', 'Master 1', 'Master 2'],
    };
    const ins = db.prepare('INSERT OR IGNORE INTO planning_lignes (segment, nom, ordre) VALUES (?, ?, ?)');
    for (const [seg, noms] of Object.entries(LIGNES_DEFAUT)) noms.forEach((n, i) => ins.run(seg, n, i));
    db.prepare(`SELECT DISTINCT segment, ligne FROM planning_activites`).all()
      .forEach(a => ins.run(a.segment, a.ligne, 99));
  }
}

module.exports = { getDb };
