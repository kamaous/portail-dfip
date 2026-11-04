# Déploiement sur le serveur UNCHK — suivipedagogique.unchk.sn

Serveur : `102.36.139.32`, port SSH `3021`, utilisateur `kama` (session MobaXterm).
Application : `/var/www/suivipedagogique.unchk.sn` (backend Node/PM2 + `frontend/dist` servi par nginx).

Règles (AGENTS.md) : sauvegarde **vérifiée** avant chaque déploiement, copie **hors serveur**,
retour arrière prêt, révision **commitée et poussée sur GitHub**. La base de production n'est
jamais remplacée, les secrets du serveur (`backend/src/config.secrets.js`) jamais écrasés.
Le script `deploy-unchk.sh` s'arrête à la première erreur.

## 1. Sur le PC

```bash
cd portail-dfip
git status                                   # rien de non commité
bash deploy/unchk/construire-paquet.sh       # → deploy/unchk/paquets/
```

Le dossier `deploy/unchk/paquets/` contient : `portail-dfip-<version>-<commit>.tar.gz`, son
`.sha256` et `deploy-unchk.sh`. Le paquet ne contient ni base ni secrets (vérifié à la
construction et de nouveau sur le serveur).

## 2. Envoi sur le serveur

Dans MobaXterm, créer `~/deploiement` puis y déposer les **3 fichiers** de
`deploy/unchk/paquets/` (glisser-déposer dans le panneau de fichiers), puis :

```bash
cd ~/deploiement && chmod +x deploy-unchk.sh
```

## 3. État actuel (lecture seule)

```bash
./deploy-unchk.sh verifier
```

À contrôler : processus PM2 trouvé, écriture autorisée, `config.secrets.js` présent,
API locale et publique « ok », **intégrité base**.

> Si le backend tourne sous un autre utilisateur (PM2 introuvable) ou si l'écriture est
> refusée, s'arrêter et voir avec l'administrateur système (ne pas forcer).

## 4. Sauvegarde

```bash
./deploy-unchk.sh sauvegarder
```

Crée `~/sauvegardes-suivipedagogique/<date>/` : base (sauvegarde en ligne SQLite, cohérente
sans arrêter le portail, vérifiée par `integrity_check` et comptage des lignes de chaque
table), code + configuration + secrets + uploads (`application.tar.gz`), contexte PM2/nginx,
version en ligne, empreintes SHA-256.

**Si l'intégrité n'est pas « ok »** : lorsque l'anomalie ne touche que des index (cas observé
sur la copie téléchargée : index de `user_sessions`), lancer

```bash
./deploy-unchk.sh reparer-index      # copie de la base d'abord, puis REINDEX, aucune donnée modifiée
./deploy-unchk.sh sauvegarder        # recommencer
```

Toute autre anomalie : **arrêter le déploiement**.

## 5. Copie hors serveur (obligatoire)

Panneau de fichiers MobaXterm → `~/sauvegardes-suivipedagogique/<date>` → clic droit →
**Download** vers le PC. Le déploiement demandera de le confirmer (« oui »).

## 6. Déploiement

```bash
./deploy-unchk.sh deployer portail-dfip-<version>-<commit>.tar.gz ~/sauvegardes-suivipedagogique/<date>
```

Contrôles préalables : sauvegarde vérifiée et de moins de 3 h, empreinte du paquet, paquet
sans base ni secrets, dépendances identiques (pas de `npm install`), droits d'écriture.
Puis : copie du code (les anciens fichiers du frontend sont conservés), redémarrage PM2
**sans** `--update-env` (JWT_SECRET, PORT… inchangés), contrôles automatiques.

## 7. Contrôles

Lancés automatiquement après le déploiement ; relançables à tout moment :

```bash
./deploy-unchk.sh controler
```

PM2 « online », API locale et publique, frontend servi = build déployé, route de
récupération du mot de passe présente, table `password_resets` présente, intégrité, version.

Puis à la main sur https://suivipedagogique.unchk.sn : connexion, Résumé (DFIP par défaut),
tableau de bord, « Mot de passe oublié ? » avec une adresse **inconnue** (refus attendu) et
avec **votre** adresse (l'email doit arriver).

## 8. Retour arrière (si besoin)

```bash
./deploy-unchk.sh retour ~/sauvegardes-suivipedagogique/<date>
```

Remet le code de la sauvegarde et redémarre. La base n'est **pas** restaurée : rien de ce qui a
été saisi depuis n'est perdu (la table `password_resets` reste, sans effet sur l'ancienne
version). Restaurer la base elle-même ne se fait qu'à la main, en connaissance de cause : les
saisies faites depuis la sauvegarde seraient perdues.

## Variables (si l'installation diffère)

`APP_DIR` (défaut `/var/www/suivipedagogique.unchk.sn`), `BACKUP_ROOT`
(défaut `~/sauvegardes-suivipedagogique`), `URL_PUBLIQUE` (défaut
`https://suivipedagogique.unchk.sn`). Exemple : `APP_DIR=/var/www/autre ./deploy-unchk.sh verifier`.

> `deploy/deploy.js` concerne l'**ancien** serveur (pedagogie.tekkina.sn) : ne plus l'utiliser.

## Mise à jour de Node.js (20 → 22 LTS)

Script `migrer-node22.sh`, déposé à côté de `deploy-unchk.sh` dans `~/deploiement` :

```bash
./migrer-node22.sh verifier                    # versions, PM2, outils, autres applications
./migrer-node22.sh sauvegarder                 # sauvegarde complète + copie des modules Node 20
# copier la sauvegarde hors du serveur
./migrer-node22.sh migrer <dossier_sauvegarde> # outils de compilation, Node 22, recompilation, redémarrage
./migrer-node22.sh retour <dossier_sauvegarde> # au besoin : retour à Node 20
```

`better-sqlite3` 9.6.0 n'a pas de binaire précompilé pour Node 22 : il est recompilé sur
place (`build-essential`, `python3`). Si l'installation, la recompilation ou le redémarrage
échoue, le retour à Node 20 et aux modules d'origine est automatique. Les autres processus
PM2 passent sous Node 22 avec `pm2 save && pm2 update`, une fois leurs modules natifs
recompilés s'ils en ont.
