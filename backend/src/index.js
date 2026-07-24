const express = require('express');
const cors = require('cors');
const path = require('path');
const { PORT } = require('./config');
const { getDb } = require('./db/connection');

const app = express();

/* ===== Durcissement sécurité ===== */
app.disable('x-powered-by');
app.set('trust proxy', 1); // derrière nginx : la vraie IP client vient de X-Forwarded-For

// En-têtes de sécurité sur toutes les réponses API
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cache-Control', 'no-store'); // les réponses API ne doivent pas être mises en cache
  next();
});

// Limite de débit globale : 600 requêtes / minute / IP (large pour l'usage normal,
// bloque les scans et scripts agressifs). En mémoire, remis à zéro chaque minute.
let fenetreDebit = new Map();
setInterval(() => { fenetreDebit = new Map(); }, 60 * 1000).unref();
app.use((req, res, next) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const n = (fenetreDebit.get(ip) || 0) + 1;
  fenetreDebit.set(ip, n);
  if (n > 600) return res.status(429).json({ error: 'Trop de requêtes, ralentissez.' });
  next();
});

app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000', 'https://pedagogie.tekkina.sn'] }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Servir les fichiers uploadés
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Initialiser la DB au démarrage
getDb();

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/poles', require('./routes/poles'));
app.use('/api/taches', require('./routes/taches'));
app.use('/api/tutorat', require('./routes/tutorat'));
app.use('/api/evaluations', require('./routes/evaluations'));
app.use('/api/sessions', require('./routes/evaluations')); // alias de compatibilité
app.use('/api/incidents', require('./routes/incidents'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/calendrier-academique', require('./routes/feries'));
app.use('/api/reunions', require('./routes/reunions'));
app.use('/api/export', require('./routes/export'));
app.use('/api/planning', require('./routes/planning'));
app.use('/api/public', require('./routes/public')); // visiteur sans compte : planning en lecture seule
app.use('/api/signalements', require('./routes/signalements'));
app.use('/api/statistiques', require('./routes/statistiques').router);

// Nettoyage des sessions expirées (toutes les heures)
setInterval(() => {
  const db = getDb();
  db.prepare(`
    UPDATE user_sessions SET actif = 0, disconnected_at = datetime('now')
    WHERE actif = 1 AND datetime(last_activity) < datetime('now', '-2 hours')
  `).run();
}, 60 * 60 * 1000);

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`✅ Portail DFIP Backend démarré sur http://localhost:${PORT}`);
});
