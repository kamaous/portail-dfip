const nodemailer = require('nodemailer');
const { SMTP } = require('../config');

const transporter = nodemailer.createTransport({
  host: SMTP.host,
  port: SMTP.port,
  secure: SMTP.secure,
  auth: { user: SMTP.user, pass: SMTP.pass }
});

async function sendEmail({ to, subject, html }) {
  try {
    await transporter.sendMail({ from: SMTP.from, to, subject, html });
  } catch (err) {
    console.error('[EMAIL ERROR]', err.message);
  }
}

const templates = {
  bienvenue: (user, password) => ({
    subject: 'Bienvenue sur le Portail DFIP - UnCHK',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        <div style="background:#1e3a5f;padding:24px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:20px">Portail DFIP - UnCHK</h1>
          <p style="color:#93c5fd;margin:4px 0 0">Direction de la Formation et de l'Ingénierie Pédagogique</p>
        </div>
        <div style="padding:32px">
          <h2 style="color:#1e3a5f">Bienvenue, ${user.prenom} ${user.nom} !</h2>
          <p>Votre compte a été créé sur le <strong>Portail DFIP de l'Université numérique Cheikh Hamidou KANE - UnCHK</strong>.</p>
          <div style="background:#f0f9ff;border-left:4px solid #1e3a5f;padding:16px;margin:20px 0;border-radius:4px">
            <p style="margin:0"><strong>Email :</strong> ${user.email}</p>
            <p style="margin:8px 0 0"><strong>Mot de passe temporaire :</strong> <code style="background:#e5e7eb;padding:2px 6px;border-radius:3px">${password}</code></p>
            <p style="margin:8px 0 0"><strong>Rôle :</strong> ${user.role_label}</p>
          </div>
          <p style="color:#dc2626;font-size:14px">⚠️ Veuillez changer votre mot de passe lors de votre première connexion.</p>
        </div>
        <div style="background:#f9fafb;padding:16px;text-align:center;font-size:12px;color:#6b7280">
          Université numérique Cheikh Hamidou KANE - UnCHK — Portail DFIP
        </div>
      </div>
    `
  }),

  nouvelleTache: (assigne, assignePar, tache) => ({
    subject: `[Portail DFIP] Nouvelle tâche assignée : ${tache.titre}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        <div style="background:#1e3a5f;padding:20px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:18px">Portail DFIP - UnCHK</h1>
        </div>
        <div style="padding:28px">
          <h2 style="color:#1e3a5f">Nouvelle tâche assignée</h2>
          <p>Bonjour <strong>${assigne.prenom} ${assigne.nom}</strong>,</p>
          <p><strong>${assignePar.prenom} ${assignePar.nom}</strong> vous a assigné une nouvelle tâche :</p>
          <div style="background:#f0f9ff;border:1px solid #bfdbfe;padding:16px;border-radius:8px;margin:16px 0">
            <h3 style="margin:0 0 8px;color:#1e40af">${tache.titre}</h3>
            ${tache.description ? `<p style="margin:0 0 8px;color:#374151">${tache.description}</p>` : ''}
            <p style="margin:0;font-size:14px"><span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:12px">Priorité : ${tache.priorite}</span></p>
            ${tache.date_echeance ? `<p style="margin:8px 0 0;font-size:14px;color:#dc2626">📅 Échéance : ${tache.date_echeance}</p>` : ''}
          </div>
          <p>Connectez-vous au portail pour consulter et gérer cette tâche.</p>
        </div>
        <div style="background:#f9fafb;padding:16px;text-align:center;font-size:12px;color:#6b7280">
          Université numérique Cheikh Hamidou KANE - UnCHK — Portail DFIP
        </div>
      </div>
    `
  }),

  tacheCompletee: (assignePar, assigne, tache) => ({
    subject: `[Portail DFIP] Tâche complétée : ${tache.titre}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        <div style="background:#065f46;padding:20px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:18px">✅ Tâche Complétée</h1>
        </div>
        <div style="padding:28px">
          <p>Bonjour <strong>${assignePar.prenom} ${assignePar.nom}</strong>,</p>
          <p><strong>${assigne.prenom} ${assigne.nom}</strong> a marqué la tâche <strong>"${tache.titre}"</strong> comme complétée.</p>
        </div>
        <div style="background:#f9fafb;padding:16px;text-align:center;font-size:12px;color:#6b7280">
          Université numérique Cheikh Hamidou KANE - UnCHK — Portail DFIP
        </div>
      </div>
    `
  }),

  nouvelIncident: (assigne, signalePar, incident) => ({
    subject: `[Portail DFIP] 🚨 Incident signalé : ${incident.titre}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        <div style="background:#dc2626;padding:20px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:18px">🚨 Incident Signalé</h1>
        </div>
        <div style="padding:28px">
          <p>Bonjour <strong>${assigne.prenom} ${assigne.nom}</strong>,</p>
          <p>Un incident a été signalé par <strong>${signalePar.prenom} ${signalePar.nom}</strong> et vous a été assigné :</p>
          <div style="background:#fef2f2;border:1px solid #fecaca;padding:16px;border-radius:8px;margin:16px 0">
            <h3 style="margin:0 0 8px;color:#dc2626">${incident.titre}</h3>
            <p style="margin:0 0 8px">${incident.description}</p>
            <p style="margin:0;font-size:14px">
              <span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:12px">Gravité : ${incident.gravite}</span>
            </p>
          </div>
        </div>
        <div style="background:#f9fafb;padding:16px;text-align:center;font-size:12px;color:#6b7280">
          Université numérique Cheikh Hamidou KANE - UnCHK — Portail DFIP
        </div>
      </div>
    `
  }),

  calendrierUploade: (directeur, pole, annee) => ({
    subject: `[Portail DFIP] Calendrier uploadé — ${pole} / ${annee}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        <div style="background:#1e3a5f;padding:20px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:18px">📅 Calendrier Uploadé</h1>
        </div>
        <div style="padding:28px">
          <p>Le calendrier académique pour le <strong>${pole}</strong> (${annee}) a été déposé par <strong>${directeur.prenom} ${directeur.nom}</strong>.</p>
          <p>Connectez-vous pour valider ce calendrier.</p>
        </div>
        <div style="background:#f9fafb;padding:16px;text-align:center;font-size:12px;color:#6b7280">
          Université numérique Cheikh Hamidou KANE - UnCHK — Portail DFIP
        </div>
      </div>
    `
  })
};

module.exports = { sendEmail, templates };
