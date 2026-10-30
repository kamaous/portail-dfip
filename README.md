# SUIVI PÉDAGOGIQUE — UnCHK

Portail de la **Direction de la Formation et de l'Ingénierie Pédagogique** de
l'**Université numérique Cheikh Hamidou KANE - UnCHK**.

Production : https://suivipedagogique.unchk.sn (serveur UNCHK, depuis le 29/07/2026 ;
l'ancienne adresse pedagogie.tekkina.sn n'affiche plus qu'une page de redirection)

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
**Règle : sauvegarde vérifiée et copiée hors serveur avant toute mise à jour.**
Serveur UNCHK : voir **[deploy/unchk/PROCEDURE.md](deploy/unchk/PROCEDURE.md)**
(`construire-paquet.sh` sur le PC, puis `deploy-unchk.sh` sur le serveur :
verifier → sauvegarder → deployer → controler, retour arrière possible).

`deploy/deploy.js` ne concerne que l'ancien serveur (pedagogie.tekkina.sn).

### Travailler en local sur une copie des données réelles
```bash
# backend : base copiée, emails affichés dans la console (jamais envoyés)
DB_PATH=/chemin/copie/database.sqlite EMAIL_MODE=console APP_URL=http://localhost:5176 PORT=5101 node src/index.js
# frontend
API_PROXY=http://localhost:5101 npx vite --port 5176
```

⚠️ `backend/src/config.js` contient des identifiants SMTP — repo à garder **privé**
(à terme : les déplacer dans des variables d'environnement).
