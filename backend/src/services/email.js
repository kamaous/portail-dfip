const nodemailer = require('nodemailer');
const { SMTP } = require('../config');

const transporter = nodemailer.createTransport({
  host: SMTP.host,
  port: SMTP.port,
  secure: SMTP.secure,
  auth: { user: SMTP.user, pass: SMTP.pass }
});

/* EMAIL_MODE=console : aucun email n'est envoyé, il est affiché dans la console
   (travail en local sur une copie des données réelles sans écrire aux utilisateurs). */
async function sendEmail({ to, subject, html }) {
  if (process.env.EMAIL_MODE === 'console') {
    const texte = html.replace(/<a [^>]*href="([^"]+)"[^>]*>/g, ' [$1] ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    console.log(`[EMAIL NON ENVOYÉ] à ${to} — ${subject}\n  ${texte}`);
    return true;
  }
  try {
    await transporter.sendMail({ from: SMTP.from, to, subject, html });
    return true;
  } catch (err) {
    console.error('[EMAIL ERROR]', err.message);
    return false;
  }
}

const templates = {
  bienvenue: (user, password) => ({
    subject: 'Bienvenue sur SUIVI PÉDAGOGIQUE - UnCHK',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        <div style="background:#1e3a5f;padding:24px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:20px">SUIVI PÉDAGOGIQUE - UnCHK</h1>
          <p style="color:#93c5fd;margin:4px 0 0">Direction de la Formation et de l'Ingénierie Pédagogique</p>
        </div>
        <div style="padding:32px">
          <h2 style="color:#1e3a5f">Bienvenue, ${user.prenom} ${user.nom} !</h2>
          <p>Votre compte a été créé sur le <strong>SUIVI PÉDAGOGIQUE de l'Université numérique Cheikh Hamidou KANE - UnCHK</strong>.</p>
          <div style="background:#f0f9ff;border-left:4px solid #1e3a5f;padding:16px;margin:20px 0;border-radius:4px">
            <p style="margin:0"><strong>Email :</strong> ${user.email}</p>
            <p style="margin:8px 0 0"><strong>Mot de passe temporaire :</strong> <code style="background:#e5e7eb;padding:2px 6px;border-radius:3px">${password}</code></p>
            <p style="margin:8px 0 0"><strong>Rôle :</strong> ${user.role_label}</p>
          </div>
          <p style="color:#dc2626;font-size:14px">⚠️ Veuillez changer votre mot de passe lors de votre première connexion.</p>
        </div>
        <div style="background:#f9fafb;padding:16px;text-align:center;font-size:12px;color:#6b7280">
          Université numérique Cheikh Hamidou KANE - UnCHK — SUIVI PÉDAGOGIQUE
        </div>
      </div>
    `
  }),

  nouvelleTache: (assigne, assignePar, tache) => ({
    subject: `[SUIVI PÉDAGOGIQUE] Nouvelle tâche assignée : ${tache.titre}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        <div style="background:#1e3a5f;padding:20px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:18px">SUIVI PÉDAGOGIQUE - UnCHK</h1>
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
          Université numérique Cheikh Hamidou KANE - UnCHK — SUIVI PÉDAGOGIQUE
        </div>
      </div>
    `
  }),

  recuperationMotDePasse: (user, lien, minutes) => ({
    subject: '[SUIVI PÉDAGOGIQUE] Réinitialisation de votre mot de passe',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        <div style="background:#1e3a5f;padding:20px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:18px">🔑 Récupération du mot de passe</h1>
        </div>
        <div style="padding:28px">
          <p>Bonjour <strong>${user.prenom || ''} ${user.nom}</strong>,</p>
          <p>Une demande de réinitialisation du mot de passe a été faite pour votre compte <strong>${user.email}</strong>.</p>
          <p style="text-align:center;margin:28px 0">
            <a href="${lien}" style="background:#1e3a5f;color:#fff;padding:12px 26px;border-radius:8px;text-decoration:none;font-weight:bold">Choisir un nouveau mot de passe</a>
          </p>
          <p style="font-size:13px;color:#475569">Ce lien est valable <strong>${minutes} minutes</strong> et ne peut servir qu'une seule fois.</p>
          <p style="font-size:13px;color:#dc2626">Si vous n'êtes pas à l'origine de cette demande, ignorez cet email : votre mot de passe actuel reste valable.</p>
        </div>
        <div style="background:#f9fafb;padding:16px;text-align:center;font-size:12px;color:#6b7280">
          Université numérique Cheikh Hamidou KANE - UnCHK — SUIVI PÉDAGOGIQUE
        </div>
      </div>
    `
  }),

  tacheCompletee: (assignePar, assigne, tache) => ({
    subject: `[SUIVI PÉDAGOGIQUE] Tâche complétée : ${tache.titre}`,
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
          Université numérique Cheikh Hamidou KANE - UnCHK — SUIVI PÉDAGOGIQUE
        </div>
      </div>
    `
  }),

  nouvelIncident: (assigne, signalePar, incident) => ({
    subject: `[SUIVI PÉDAGOGIQUE] 🚨 Incident signalé : ${incident.titre}`,
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
          Université numérique Cheikh Hamidou KANE - UnCHK — SUIVI PÉDAGOGIQUE
        </div>
      </div>
    `
  }),

  calendrierUploade: (directeur, pole, annee) => ({
    subject: `[SUIVI PÉDAGOGIQUE] Calendrier uploadé — ${pole} / ${annee}`,
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
          Université numérique Cheikh Hamidou KANE - UnCHK — SUIVI PÉDAGOGIQUE
        </div>
      </div>
    `
  })
};

module.exports = { sendEmail, templates };
