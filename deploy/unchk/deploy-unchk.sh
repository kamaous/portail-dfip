#!/usr/bin/env bash
# =============================================================================
#  Déploiement de SUIVI PÉDAGOGIQUE sur le serveur UNCHK (suivipedagogique.unchk.sn)
#  À exécuter SUR LE SERVEUR (session MobaXterm), étape par étape :
#
#    ./deploy-unchk.sh verifier                       # état actuel, rien n'est modifié
#    ./deploy-unchk.sh sauvegarder                    # sauvegarde complète + vérification
#    ./deploy-unchk.sh reparer-index                  # si « sauvegarder » signale un index défectueux
#        → télécharger le dossier de sauvegarde sur le PC (copie hors serveur)
#    ./deploy-unchk.sh deployer <paquet.tar.gz> <dossier_sauvegarde>
#    ./deploy-unchk.sh controler                      # contrôles après déploiement
#    ./deploy-unchk.sh retour <dossier_sauvegarde>    # retour à la version précédente
#
#  Règles (AGENTS.md) : sauvegarde vérifiée AVANT chaque déploiement, copie hors
#  serveur, retour arrière prêt ; la base de production n'est JAMAIS remplacée et
#  les secrets du serveur (config.secrets.js) ne sont JAMAIS écrasés.
#  Le script s'arrête à la première erreur.
# =============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/suivipedagogique.unchk.sn}"
BACKUP_ROOT="${BACKUP_ROOT:-$HOME/sauvegardes-suivipedagogique}"
URL_PUBLIQUE="${URL_PUBLIQUE:-https://suivipedagogique.unchk.sn}"
DB="$APP_DIR/backend/database.sqlite"
SQLITE_MOD="$APP_DIR/backend/node_modules/better-sqlite3"
SAUVEGARDE_MAX_MIN=180   # une sauvegarde plus ancienne ne peut pas servir à déployer

rouge() { printf '\033[31m%s\033[0m\n' "$*"; }
vert()  { printf '\033[32m%s\033[0m\n' "$*"; }
titre() { printf '\n\033[1;34m== %s ==\033[0m\n' "$*"; }
stop()  { rouge "ARRÊT : $*"; exit 1; }

# --- Requêtes SQLite via le module de l'application (pas besoin du client sqlite3) ---
# Usage : sql_node <fichier.sqlite> <readonly 1|0> <code JS utilisant db>
sql_node() {
  node -e "
    const D = require('$SQLITE_MOD');
    const db = new D(process.argv[1], { readonly: process.argv[2] === '1', fileMustExist: true });
    try { $3 } finally { db.close(); }
  " "$1" "$2"
}
integrite() { sql_node "$1" 1 "console.log(db.pragma('integrity_check').map(r => r.integrity_check).join(' | '))"; }
comptages() {
  sql_node "$1" 1 "
    const t = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name\").all();
    for (const { name } of t) console.log(name + ' ' + db.prepare('SELECT COUNT(*) c FROM \"' + name + '\" NOT INDEXED').get().c);"
}

# --- Processus PM2 qui fait tourner le backend de APP_DIR ---
pm2_app() {
  command -v pm2 >/dev/null || stop "pm2 introuvable pour l'utilisateur $(whoami)"
  pm2 jlist 2>/dev/null | node -e '
    let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
      const dir = process.argv[1].replace(/\/$/, "");
      const apps = JSON.parse(s.slice(s.indexOf("[")) || "[]").filter(a =>
        (a.pm2_env.pm_cwd || "").replace(/\/$/, "").startsWith(dir) ||
        (a.pm2_env.pm_exec_path || "").startsWith(dir));
      for (const a of apps) console.log([a.name, a.pm2_env.status, a.pm2_env.PORT || a.pm2_env.env?.PORT || "", a.pm2_env.pm_cwd].join("\t"));
    });' "$APP_DIR"
}

prerequis() {
  [ -d "$APP_DIR/backend/src" ] || stop "$APP_DIR/backend/src introuvable (APP_DIR=$APP_DIR)"
  [ -f "$DB" ] || stop "base introuvable : $DB"
  [ -d "$SQLITE_MOD" ] || stop "module better-sqlite3 introuvable : $SQLITE_MOD"
  command -v node >/dev/null || stop "node introuvable"
}

app_pm2_unique() {
  local l; l="$(pm2_app)"
  [ -n "$l" ] || stop "aucun processus PM2 de $(whoami) ne fait tourner $APP_DIR (le backend tourne-t-il sous un autre utilisateur ? essayez avec sudo -E)"
  [ "$(printf '%s\n' "$l" | wc -l)" -eq 1 ] || stop "plusieurs processus PM2 correspondent :\n$l"
  printf '%s\n' "$l"
}

# =============================================================================
cmd_verifier() {
  titre "Vérification de l'état actuel (lecture seule)"
  prerequis
  echo "Utilisateur      : $(whoami) @ $(hostname)"
  echo "Application      : $APP_DIR"
  echo "Node             : $(node -v)"
  echo "Version en ligne : $(cat "$APP_DIR/VERSION" 2>/dev/null | head -1 || echo '(pas de fichier VERSION — version antérieure à v3.18)')"
  echo "Build frontend   : $(grep -o 'assets/index-[^"]*\.js' "$APP_DIR/frontend/dist/index.html" || echo '?')"
  echo "Secrets serveur  : $([ -f "$APP_DIR/backend/src/config.secrets.js" ] && echo 'config.secrets.js présent (conservé)' || echo 'ABSENT')"
  echo "Écriture         : $( [ -w "$APP_DIR/backend/src" ] && [ -w "$APP_DIR/frontend/dist" ] && echo 'autorisée' || echo 'REFUSÉE pour cet utilisateur')"
  echo "Espace disque    : $(df -h "$APP_DIR" | awk 'NR==2 {print $4 " libres sur " $2}')"
  echo "Base             : $(du -h "$DB" | cut -f1) (+ WAL $(du -h "$DB-wal" 2>/dev/null | cut -f1 || echo 0))"
  echo "Intégrité base   : $(integrite "$DB")"
  echo "Table password_resets : $(sql_node "$DB" 1 "console.log(db.prepare(\"SELECT 1 FROM sqlite_master WHERE name='password_resets'\").get() ? 'présente' : 'absente (sera créée au redémarrage)')")"
  titre "PM2"
  pm2_app || true
  titre "Santé"
  local ligne port; ligne="$(pm2_app | head -1)"; port="$(printf '%s' "$ligne" | cut -f3)"; port="${port:-5100}"
  echo "API locale  (port $port) : $(curl -s -m 5 "http://127.0.0.1:$port/api/health" || echo 'injoignable')"
  echo "API publique             : $(curl -s -m 10 "$URL_PUBLIQUE/api/health" || echo 'injoignable')"
}

# =============================================================================
cmd_sauvegarder() {
  prerequis
  local stamp bk ligne
  stamp="$(date +%Y%m%d-%H%M%S)"
  bk="$BACKUP_ROOT/$stamp"
  mkdir -p "$bk"
  titre "Sauvegarde dans $bk"

  # 1. Base : sauvegarde EN LIGNE (API backup de SQLite, cohérente même pendant l'utilisation)
  echo "→ Base de données (sauvegarde en ligne)..."
  node -e "
    const D = require('$SQLITE_MOD');
    const db = new D(process.argv[1], { readonly: true, fileMustExist: true });
    db.backup(process.argv[2])
      .then(() => {
        db.close();
        // copie autonome en UN seul fichier (pas de -wal/-shm à transporter)
        const c = new D(process.argv[2]); c.pragma('journal_mode = DELETE'); c.close();
        console.log('  ok');
      })
      .catch(e => { console.error(e.message); process.exit(1); });
  " "$DB" "$bk/database.sqlite" || stop "échec de la sauvegarde de la base"
  [ -s "$bk/database.sqlite" ] || stop "la sauvegarde de la base est vide"

  # 2. Vérification de la base sauvegardée : intégrité + mêmes tables/comptages
  echo "→ Vérification de la base sauvegardée..."
  local int_prod int_bk
  int_prod="$(integrite "$DB")"; int_bk="$(integrite "$bk/database.sqlite")"
  echo "  intégrité production : $int_prod"
  echo "  intégrité sauvegarde : $int_bk"
  comptages "$DB" > "$bk/comptages-production.txt"
  comptages "$bk/database.sqlite" > "$bk/comptages-sauvegarde.txt"
  # les tables de sessions/journaux peuvent bouger pendant la sauvegarde : comparées à part
  if ! diff <(grep -vE '^(user_sessions|audit_logs|notifications) ' "$bk/comptages-production.txt") \
            <(grep -vE '^(user_sessions|audit_logs|notifications) ' "$bk/comptages-sauvegarde.txt") >/dev/null; then
    diff "$bk/comptages-production.txt" "$bk/comptages-sauvegarde.txt" || true
    stop "les comptages de la sauvegarde diffèrent de la production"
  fi
  [ "$int_bk" = "ok" ] || stop "intégrité de la sauvegarde = « $int_bk » — voir la procédure (section intégrité) avant de continuer"

  # 3. Code, configuration et fichiers persistants (uploads, secrets, build) — sans node_modules ni base
  echo "→ Code, configuration, uploads, secrets..."
  tar -czf "$bk/application.tar.gz" -C "$(dirname "$APP_DIR")" \
    --exclude='node_modules' --exclude='database.sqlite*' "$(basename "$APP_DIR")"
  local contenu; contenu="$(tar -tzf "$bk/application.tar.gz")" || stop "archive application.tar.gz illisible"
  grep -q 'backend/src/index.js' <<< "$contenu" || stop "archive incomplète (backend/src/index.js absent)"
  grep -q 'frontend/dist/index.html' <<< "$contenu" || stop "archive incomplète (frontend/dist/index.html absent)"

  # 4. Contexte d'exécution : PM2, nginx, version
  echo "→ Contexte (PM2, nginx, version)..."
  ligne="$(app_pm2_unique)"
  printf '%s\n' "$ligne" > "$bk/pm2-processus.txt"
  pm2 describe "$(printf '%s' "$ligne" | cut -f1)" > "$bk/pm2-describe.txt" 2>&1 || true
  local confs; confs="$(grep -rls 'suivipedagogique' /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null || true)"
  for f in $confs; do cp "$f" "$bk/nginx-$(basename "$f").conf" 2>/dev/null || true; done
  { cat "$APP_DIR/VERSION" 2>/dev/null || echo "version antérieure à v3.18 (pas de fichier VERSION)"
    grep -o 'assets/index-[^"]*\.js' "$APP_DIR/frontend/dist/index.html" || true; } > "$bk/version-en-ligne.txt"

  # 5. Empreintes + marqueur de validité
  ( cd "$bk" && sha256sum database.sqlite application.tar.gz > SHA256SUMS && sha256sum -c --quiet SHA256SUMS ) \
    || stop "empreintes de la sauvegarde invalides"
  echo "$stamp" > "$bk/SAUVEGARDE_OK"
  vert "Sauvegarde vérifiée : $bk ($(du -sh "$bk" | cut -f1))"
  echo
  echo "ÉTAPE SUIVANTE OBLIGATOIRE : copier ce dossier HORS du serveur (panneau de fichiers MobaXterm"
  echo "→ $bk → clic droit → Download), puis lancer :"
  echo "  ./deploy-unchk.sh deployer <paquet.tar.gz> $bk"
}

# =============================================================================
# Reconstruction d'INDEX défectueux (ex. « row N missing from index … ») : REINDEX
# reconstruit l'index à partir des lignes de la table, sans modifier aucune donnée.
# Refusé si l'anomalie touche autre chose qu'un index.
cmd_reparer_index() {
  prerequis
  titre "Réparation des index"
  local res; res="$(integrite "$DB")"
  [ "$res" != "ok" ] || { vert "Intégrité déjà ok : rien à faire."; return; }
  echo "Anomalies : $res"
  if grep -vqE 'missing from index|wrong # of entries in index|^[[:space:]]*$' <<< "$(printf '%s' "$res" | tr '|' '\n')"; then
    stop "anomalie autre qu'un index : pas de réparation automatique"
  fi
  local index; index="$(printf '%s' "$res" | grep -oE 'index [A-Za-z0-9_]+' | awk '{print $2}' | sort -u | tr '\n' ' ')"
  echo "Index à reconstruire : $index"
  local bk="$BACKUP_ROOT/avant-reindex-$(date +%Y%m%d-%H%M%S)"; mkdir -p "$bk"
  node -e "
    const D = require('$SQLITE_MOD'); const db = new D(process.argv[1], { readonly: true, fileMustExist: true });
    db.backup(process.argv[2]).then(() => db.close()).catch(e => { console.error(e.message); process.exit(1); });
  " "$DB" "$bk/database.sqlite" || stop "sauvegarde préalable impossible"
  vert "  copie de la base avant réparation : $bk/database.sqlite"
  read -r -p "Reconstruire ces index sur la base de production ? (tapez « oui ») " rep
  [ "$rep" = "oui" ] || stop "réparation annulée"
  sql_node "$DB" 0 "
    const avant = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'\").all()
      .map(t => t.name + '=' + db.prepare('SELECT COUNT(*) c FROM \"' + t.name + '\" NOT INDEXED').get().c).join(',');
    for (const i of '$index'.trim().split(/\s+/)) db.exec('REINDEX \"' + i + '\"');
    const apres = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'\").all()
      .map(t => t.name + '=' + db.prepare('SELECT COUNT(*) c FROM \"' + t.name + '\" NOT INDEXED').get().c).join(',');
    if (avant !== apres) { console.error('comptages modifiés !'); process.exit(1); }
    console.log('  comptages identiques avant/après');"
  res="$(integrite "$DB")"
  [ "$res" = "ok" ] && vert "Intégrité : ok — relancez ./deploy-unchk.sh sauvegarder" || stop "intégrité toujours en défaut : $res"
}

# =============================================================================
verifier_sauvegarde() {
  local bk="$1"
  [ -f "$bk/SAUVEGARDE_OK" ] || stop "$bk n'est pas une sauvegarde vérifiée (SAUVEGARDE_OK absent)"
  ( cd "$bk" && sha256sum -c --quiet SHA256SUMS ) || stop "empreintes de $bk invalides"
  local age=$(( ( $(date +%s) - $(stat -c %Y "$bk/SAUVEGARDE_OK") ) / 60 ))
  echo "$age"
}

cmd_deployer() {
  local paquet="${1:-}" bk="${2:-}"
  [ -n "$paquet" ] && [ -n "$bk" ] || stop "usage : $0 deployer <paquet.tar.gz> <dossier_sauvegarde>"
  [ -f "$paquet" ] || stop "paquet introuvable : $paquet"
  prerequis

  titre "Contrôles avant déploiement"
  local age; age="$(verifier_sauvegarde "$bk")"
  [ "$age" -le "$SAUVEGARDE_MAX_MIN" ] || stop "la sauvegarde date de $age min (max $SAUVEGARDE_MAX_MIN) : refaites ./deploy-unchk.sh sauvegarder"
  vert "  sauvegarde vérifiée ($age min)"
  if [ -f "$paquet.sha256" ]; then
    ( cd "$(dirname "$paquet")" && sha256sum -c --quiet "$(basename "$paquet").sha256" ) || stop "empreinte du paquet invalide"
    vert "  empreinte du paquet vérifiée"
  fi
  TMP_TRAVAIL="$(mktemp -d)"; trap 'rm -rf "${TMP_TRAVAIL:-/nonexistent}"' EXIT
  local tmp="$TMP_TRAVAIL"
  tar -xzf "$paquet" -C "$tmp"
  [ -f "$tmp/VERSION" ] && [ -f "$tmp/backend/src/index.js" ] && [ -f "$tmp/frontend/dist/index.html" ] || stop "paquet incomplet"
  if [ -n "$(find "$tmp" -name 'database.sqlite*' -o -name 'config.secrets.js')" ]; then stop "le paquet contient une base ou des secrets : refusé"; fi
  echo "  version à déployer : $(head -1 "$tmp/VERSION")"
  # Dépendances inchangées → pas de npm install en production
  if ! cmp -s "$tmp/backend/package-lock.json" "$APP_DIR/backend/package-lock.json"; then
    stop "les dépendances (package-lock.json) diffèrent de la production : déploiement manuel requis (npm ci)"
  fi
  vert "  dépendances identiques (aucune installation npm)"
  local ligne nom; ligne="$(app_pm2_unique)"; nom="$(printf '%s' "$ligne" | cut -f1)"
  vert "  processus PM2 : $nom"
  for d in "$APP_DIR" "$APP_DIR/backend" "$APP_DIR/backend/src" "$APP_DIR/frontend/dist" "$APP_DIR/frontend/dist/assets"; do
    [ -w "$d" ] || stop "pas de droit d'écriture sur $d pour $(whoami)"
  done
  vert "  droits d'écriture : ok"

  echo
  read -r -p "La sauvegarde $bk a-t-elle été copiée HORS du serveur ? (tapez « oui ») " rep
  [ "$rep" = "oui" ] || stop "copie hors serveur non confirmée"

  titre "Déploiement"
  # Code backend : remplacement fichier par fichier (config.secrets.js n'est pas dans le paquet → conservé)
  cp -a "$tmp/backend/src/." "$APP_DIR/backend/src/"
  cp -a "$tmp/backend/package.json" "$APP_DIR/backend/package.json"
  # Frontend : nouveaux fichiers ajoutés, anciens assets conservés (navigateurs ayant l'ancienne page en cache)
  cp -a "$tmp/frontend/dist/." "$APP_DIR/frontend/dist/"
  cp "$tmp/VERSION" "$APP_DIR/VERSION"
  [ -f "$APP_DIR/backend/src/config.secrets.js" ] || rouge "  ⚠ config.secrets.js absent sur le serveur (il l'était déjà avant)"
  # Redémarrage SANS --update-env : l'environnement d'origine (JWT_SECRET, PORT…) est conservé
  pm2 restart "$nom" >/dev/null
  vert "  code copié, $nom redémarré"
  sleep 4
  cmd_controler
}

# =============================================================================
cmd_controler() {
  prerequis
  titre "Contrôles après déploiement"
  local ok=1 ligne nom statut port
  ligne="$(app_pm2_unique)"; nom="$(printf '%s' "$ligne" | cut -f1)"; statut="$(printf '%s' "$ligne" | cut -f2)"
  port="$(printf '%s' "$ligne" | cut -f3)"; port="${port:-5100}"
  [ "$statut" = "online" ] && vert "  PM2 $nom : online" || { rouge "  PM2 $nom : $statut"; ok=0; }
  local h; h="$(curl -s -m 5 "http://127.0.0.1:$port/api/health" || true)"
  [[ "$h" == *'"ok"'* ]] && vert "  API locale : ok" || { rouge "  API locale : $h"; ok=0; }
  h="$(curl -s -m 10 "$URL_PUBLIQUE/api/health" || true)"
  [[ "$h" == *'"ok"'* ]] && vert "  API publique : ok" || { rouge "  API publique : $h"; ok=0; }
  local attendu servi
  attendu="$(grep -o 'assets/index-[^"]*\.js' "$APP_DIR/frontend/dist/index.html")"
  servi="$(curl -s -m 10 "$URL_PUBLIQUE/" | grep -o 'assets/index-[^"]*\.js' || true)"
  [ "$attendu" = "$servi" ] && vert "  frontend servi : $servi" || { rouge "  frontend servi « $servi » ≠ attendu « $attendu »"; ok=0; }
  local code; code="$(curl -s -o /dev/null -w '%{http_code}' -m 10 -X POST -H 'Content-Type: application/json' -d '{}' "$URL_PUBLIQUE/api/auth/forgot-password" || true)"
  [ "$code" = "400" ] && vert "  route récupération du mot de passe : présente" || { rouge "  route récupération : HTTP $code"; ok=0; }
  sql_node "$DB" 1 "if (!db.prepare(\"SELECT 1 FROM sqlite_master WHERE name='password_resets'\").get()) { console.log('  table password_resets ABSENTE'); process.exit(1); } console.log('  table password_resets : présente');" || ok=0
  echo "  intégrité base : $(integrite "$DB")"
  echo "  version : $(head -1 "$APP_DIR/VERSION" 2>/dev/null || echo '?')"
  echo "--- 15 dernières lignes d'erreur PM2 ---"
  pm2 logs "$nom" --err --lines 15 --nostream 2>/dev/null | tail -15 || true
  [ $ok -eq 1 ] && vert "TOUT EST OK" || stop "au moins un contrôle a échoué — envisager : ./deploy-unchk.sh retour <dossier_sauvegarde>"
}

# =============================================================================
cmd_retour() {
  local bk="${1:-}"
  [ -n "$bk" ] || stop "usage : $0 retour <dossier_sauvegarde>"
  prerequis
  verifier_sauvegarde "$bk" >/dev/null
  titre "Retour au code de la sauvegarde $bk"
  echo "Seul le CODE est restauré (backend/src, package.json, frontend/dist, VERSION)."
  echo "La base n'est PAS touchée : les données saisies depuis la sauvegarde sont conservées."
  read -r -p "Confirmer le retour arrière ? (tapez « oui ») " rep
  [ "$rep" = "oui" ] || stop "retour annulé"
  TMP_TRAVAIL="$(mktemp -d)"; trap 'rm -rf "${TMP_TRAVAIL:-/nonexistent}"' EXIT
  local tmp="$TMP_TRAVAIL" nom d
  tar -xzf "$bk/application.tar.gz" -C "$tmp"
  d="$tmp/$(basename "$APP_DIR")"
  [ -f "$d/backend/src/index.js" ] || stop "archive de sauvegarde incomplète"
  # retire les fichiers ajoutés par la nouvelle version, puis remet l'ancien code
  ( cd "$APP_DIR/backend/src" && find . -type f ! -name 'config.secrets.js' ) | while read -r f; do
    [ -e "$d/backend/src/$f" ] || rm -f "$APP_DIR/backend/src/$f"; done
  cp -a "$d/backend/src/." "$APP_DIR/backend/src/"
  cp -a "$d/backend/package.json" "$APP_DIR/backend/package.json"
  rm -rf "$APP_DIR/frontend/dist"; cp -a "$d/frontend/dist" "$APP_DIR/frontend/dist"
  if [ -f "$d/VERSION" ]; then cp "$d/VERSION" "$APP_DIR/VERSION"; else rm -f "$APP_DIR/VERSION"; fi
  nom="$(app_pm2_unique | cut -f1)"
  pm2 restart "$nom" >/dev/null
  vert "Code précédent restauré, $nom redémarré."
  echo "(La table password_resets reste en base : elle est vide d'effet pour l'ancienne version.)"
}

case "${1:-}" in
  verifier)    cmd_verifier ;;
  sauvegarder) cmd_sauvegarder ;;
  deployer)    shift; cmd_deployer "$@" ;;
  controler)   cmd_controler ;;
  retour)      shift; cmd_retour "$@" ;;
  reparer-index) cmd_reparer_index ;;
  *) sed -n '2,18p' "$0"; exit 1 ;;
esac
