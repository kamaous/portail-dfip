const express = require('express');
const { getDb } = require('../db/connection');

const router = express.Router();

/* Accès VISITEUR sans compte : consultation du planning annuel uniquement (lecture seule).
   Aucune donnée nominative n'est exposée. */
router.get('/planning', (req, res) => {
  const db = getDb();
  const annees = db.prepare('SELECT id, libelle, active FROM annees_academiques ORDER BY libelle DESC').all();
  const annee_id = parseInt(req.query.annee_id)
    || annees.find(a => a.active)?.id || annees[0]?.id;
  if (!annee_id) return res.json({ annees: [], activites: [], vacances: [], feries: [] });

  const activites = db.prepare(`
    SELECT id, segment, ligne, libelle, date_debut, date_fin, couleur, type, sous_type
    FROM planning_activites WHERE annee_id = ?
    ORDER BY segment, ligne, date_debut
  `).all(annee_id);
  const vacances = db.prepare('SELECT libelle, date_debut, date_fin FROM vacances WHERE annee_id = ? OR annee_id IS NULL ORDER BY date_debut').all(annee_id);
  const feries = db.prepare('SELECT date, libelle, recurrent FROM jours_feries ORDER BY date').all();
  const lignes = db.prepare('SELECT segment, nom FROM planning_lignes ORDER BY segment, ordre, nom').all();

  res.json({ annees, annee_id, activites, vacances, feries, lignes });
});

/* Accès VISITEUR sans compte : module Résumé (suivi de l'exécution + programmation
   des évaluations), en lecture seule et SANS AUCUNE DONNÉE NOMINATIVE — ni créateur,
   ni déclarant, ni responsable. Seules les fiches/évaluations RATTACHÉES À UNE
   FORMATION sont exposées (comme dans le module connecté). */
router.get('/resume', (req, res) => {
  const db = getDb();

  const tutorats = db.prepare(`
    SELECT t.id, t.niveau, t.semestre_code, t.date_debut, t.date_fin,
      t.date_demarree_le, t.date_terminee_le, t.statut_fiche, t.etat_tutorat,
      t.plateforme_cours, t.cours, t.enrolement_tuteurs, t.enrolement_etudiants,
      t.enrolement_enseignants, t.activite_id, t.updated_at, t.created_at,
      p.code as pole_code, f.nom as formation_nom, f.code as formation_code,
      pr.code as promotion_code
    FROM tutorat t
    LEFT JOIN poles p ON p.id = t.pole_id
    LEFT JOIN formations f ON f.id = t.formation_id
    LEFT JOIN promotions pr ON pr.id = t.promotion_id
    WHERE t.formation_id IS NOT NULL AND t.statut_fiche != 'REJETEE'
  `).all();

  const evaluations = db.prepare(`
    SELECT se.id, se.niveau, se.semestre_code, se.session_num, se.type_evaluation,
      se.date_demarrage, se.date_fin_prevue, se.date_programmation, se.etat_eval,
      se.delib_etat, se.etat, se.reception_epreuves, se.implementation_epreuves,
      se.activite_id,
      p.code as pole_code, f.nom as formation_nom, f.code as formation_code,
      pr.code as promotion_code
    FROM sessions_examen se
    LEFT JOIN poles p ON p.id = se.pole_id
    LEFT JOIN formations f ON f.id = se.formation_id
    LEFT JOIN promotions pr ON pr.id = se.promotion_id
    WHERE se.formation_id IS NOT NULL
  `).all();

  const poles = db.prepare('SELECT id, code, nom FROM poles').all();
  // Pour le compteur « Reportées » du volet DFIP — aucun autre champ n'est exposé
  const incidents = db.prepare("SELECT conseq_eval FROM incidents WHERE conseq_eval = 'REPORT'").all();

  res.json({ tutorats, evaluations, poles, incidents });
});

module.exports = router;
