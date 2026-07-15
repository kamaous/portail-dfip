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

module.exports = router;
