# Portail DFIP — UnCHK

Portail de la **Direction de la Formation et de l'Ingénierie Pédagogique** de
l'**Université numérique Cheikh Hamidou KANE - UnCHK**.

Production : https://pedagogie.tekkina.sn

## Modules
- **Planning annuel** (Gantt) : 5 segments (Rectorat, DFIP & DES, PSEJA, PSTN, PLSHE),
  zoom jour par jour, périmètres par profil, validation des modifications par le Directeur DFIP.
- **Tutorat** : fiches créées par les Responsables de formation, validées par le Chef div.
  Technopédagogie, section PLATEFORMES ET TUTORATS avec verrou « tout doit être OK ».
- **Évaluations** : 2 types (Évaluation/Devoir) × 3 sessions (Normale/Rattrapage/Spéciale),
  dates cadrées par les plages du Planning annuel, suivi Chef division DFE,
  délibérations groupées par les Directeurs de pôle.
- **Incidents** : types officiels, conséquences structurées (évaluations/tutorat) avec périmètre.
- **Réunions** : intégration TerangaMeet (https://terangameet.unchk.sn).
- **Tableau de bord** : statistiques interactives + export Excel.
- Fériés & vacances, tâches, notifications in-app + email, journal d'audit,
  suivi des connexions.

## Stack
- **Backend** : Node.js + Express + SQLite (better-sqlite3), JWT, port 5100.
- **Frontend** : React 18 + Vite + Tailwind, port dev 5174.

## Développement local
```bash
cd backend && npm install && node src/index.js
cd frontend && npm install && npx vite --port 5174
```
Admin par défaut : voir la mémoire projet (les comptes de test utilisent Test@2026).

## Scripts utiles (backend/src/db/)
- `refonte-referentiel.js` — (ré)importe pôles/formations/promotions depuis les fichiers Excel UN-CHK
- `seed-planning.js` — planning annuel de démonstration
- `reset-comptes.js` — réinitialise les comptes de test
- `fix-encoding.js` — répare d'éventuelles chaînes mal encodées

## Déploiement
**Règle : sauvegarde obligatoire avant toute mise à jour** (locale + serveur, le script la fait).
```bash
cd frontend && npm run build
# bundle sans database.sqlite pour préserver la base de production
SSHPW=... JWTS=... node deploy/deploy.js
```
nginx sert `frontend/dist` et proxy `/api` → 127.0.0.1:5100 (PM2 `pedagogie-api`).

⚠️ `backend/src/config.js` contient des identifiants SMTP — repo à garder **privé**
(à terme : les déplacer dans des variables d'environnement).
