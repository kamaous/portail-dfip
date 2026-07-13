const { getDb } = require('../db/connection');
const { sendEmail } = require('./email');

/**
 * Retourne la liste des utilisateurs « concernés » par un événement :
 * - les membres du pôle concerné (si pole_id fourni)
 * - tous les chefs de service
 * - le(s) directeur(s)
 * - la scolarité
 */
function getConcernes(pole_id) {
  const db = getDb();
  const roles = ['DIRECTEUR', 'CHEF_SERVICE', 'SCOLARITE'];
  const placeholders = roles.map(() => '?').join(',');
  let sql = `SELECT DISTINCT id, nom, prenom, email FROM users
             WHERE actif = 1 AND (role IN (${placeholders})`;
  const params = [...roles];
  if (pole_id) {
    sql += ' OR (role = ? AND pole_id = ?)';
    params.push('MEMBRE_POLE', pole_id);
  }
  sql += ')';
  return db.prepare(sql).all(...params);
}

/**
 * Notifie les concernés : crée une notification in-app + envoie un email à chacun.
 */
function notifierConcernes({ pole_id, titre, message, type = 'INFO', lien = null, htmlBody }) {
  const db = getDb();
  const users = getConcernes(pole_id);
  const insNotif = db.prepare(
    'INSERT INTO notifications (user_id, titre, message, type, lien) VALUES (?, ?, ?, ?, ?)'
  );
  for (const u of users) {
    insNotif.run(u.id, titre, message, type, lien);
    sendEmail({
      to: u.email,
      subject: `[Portail DFIP] ${titre}`,
      html: emailWrapper(u, titre, htmlBody || `<p>${message}</p>`),
    });
  }
  return users.length;
}

function emailWrapper(user, titre, inner) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
      <div style="background:#1e3a5f;padding:20px;text-align:center">
        <h1 style="color:#fff;margin:0;font-size:18px">Portail DFIP - UnCHK</h1>
      </div>
      <div style="padding:28px">
        <h2 style="color:#1e3a5f;font-size:18px">${titre}</h2>
        <p>Bonjour ${user.prenom || ''} ${user.nom || ''},</p>
        ${inner}
        <p style="color:#6b7280;font-size:13px;margin-top:24px">Connectez-vous au portail pour plus de détails.</p>
      </div>
      <div style="background:#f9fafb;padding:16px;text-align:center;font-size:12px;color:#6b7280">
        Université numérique Cheikh Hamidou KANE - UnCHK — Portail DFIP
      </div>
    </div>`;
}

/**
 * Vérifie si une date (YYYY-MM-DD) tombe un jour férié ou pendant des vacances.
 * Retourne { ferie: {...}|null, vacances: {...}|null }.
 */
function checkDateBloquee(dateStr) {
  if (!dateStr) return { ferie: null, vacances: null };
  const db = getDb();
  const d = dateStr.slice(0, 10);
  const mmdd = d.slice(5); // MM-DD pour les fériés récurrents

  const ferie = db.prepare(`
    SELECT * FROM jours_feries
    WHERE date = ? OR (recurrent = 1 AND substr(date, 6) = ?)
    LIMIT 1
  `).get(d, mmdd);

  const vacances = db.prepare(`
    SELECT * FROM vacances WHERE date(?) BETWEEN date(date_debut) AND date(date_fin) LIMIT 1
  `).get(d);

  return { ferie: ferie || null, vacances: vacances || null };
}

module.exports = { getConcernes, notifierConcernes, checkDateBloquee, emailWrapper };
