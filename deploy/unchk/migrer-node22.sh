#!/usr/bin/env bash
# =============================================================================
#  Migration de Node.js 20 → Node.js 22 (LTS, dépôt NodeSource node_22.x)
#  sur le serveur UNCHK — à exécuter SUR LE SERVEUR, étape par étape :
#
#    ./migrer-node22.sh verifier                    # état actuel, rien n'est modifié
#    ./migrer-node22.sh sauvegarder                 # sauvegarde complète + copie des modules Node 20
#        → télécharger le dossier de sauvegarde sur le PC (copie hors serveur)
#    ./migrer-node22.sh migrer <dossier_sauvegarde> # Node 22, recompilation, redémarrage, contrôles
#    ./migrer-node22.sh retour <dossier_sauvegarde> # retour à Node 20 et aux modules d'origine
#
#  Le module natif better-sqlite3 (9.6.0) n'a pas de binaire précompilé pour Node 22 :
#  il est RECOMPILÉ sur place (outils build-essential et python3 installés si besoin).
#  En cas d'échec de la recompilation ou du redémarrage, le retour à Node 20 est
#  AUTOMATIQUE. La base de données n'est jamais touchée.
#  Commandes apt : sudo est demandé.
# =============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/suivipedagogique.unchk.sn}"
BACKUP_ROOT="${BACKUP_ROOT:-$HOME/sauvegardes-suivipedagogique}"
ICI="$(cd "$(dirname "$0")" && pwd)"
DB="$APP_DIR/backend/database.sqlite"
SAUVEGARDE_MAX_MIN=180
SUDO="${SUDO-sudo}"

rouge() { printf '\033[31m%s\033[0m\n' "$*"; }
vert()  { printf '\033[32m%s\033[0m\n' "$*"; }
titre() { printf '\n\033[1;34m== %s ==\033[0m\n' "$*"; }
stop()  { rouge "ARRÊT : $*"; exit 1; }
root()  { if [ -n "$SUDO" ]; then $SUDO -E "$@"; else "$@"; fi; }  # commande en administrateur

# Processus PM2 qui fait tourner le backend de APP_DIR : nom<TAB>pid<TAB>port
app_pm2() {
  command -v pm2 >/dev/null || stop "pm2 introuvable pour l'utilisateur $(whoami)"
  pm2 jlist 2>/dev/null | node -e '
    let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
      const dir = process.argv[1].replace(/\/$/, "");
      const a = JSON.parse(s.slice(s.indexOf("[")) || "[]").filter(x =>
        (x.pm2_env.pm_cwd || "").replace(/\/$/, "").startsWith(dir) || (x.pm2_env.pm_exec_path || "").startsWith(dir));
      if (a.length !== 1) { console.error("processus PM2 de l\x27application : " + a.length + " trouvé(s)"); process.exit(1); }
      const e = a[0].pm2_env;
      console.log([a[0].name, a[0].pid, e.PORT || (e.env && e.env.PORT) || 5100].join("\t"));
    });' "$APP_DIR"
}

# better-sqlite3 se charge-t-il avec le Node actuel, et la base de production s'ouvre-t-elle ?
tester_sqlite() {
  ( cd "$APP_DIR/backend" && node -e '
      const D = require("better-sqlite3");
      const m = new D(":memory:"); const v = m.prepare("select sqlite_version() v").get().v; m.close();
      const db = new D(process.argv[1], { readonly: true, fileMustExist: true });
      const n = db.prepare("SELECT COUNT(*) c FROM users").get().c; db.close();
      console.log("  better-sqlite3 OK sous Node " + process.version + " (SQLite " + v + ", " + n + " comptes lus)");
    ' "$DB" )
}

# Le processus de l'application tourne-t-il sur le binaire Node ACTUEL, et répond-il ?
controle_app() {
  local ligne nom pid port exe h
  ligne="$(app_pm2)" || return 1
  nom="$(cut -f1 <<< "$ligne")"; pid="$(cut -f2 <<< "$ligne")"; port="$(cut -f3 <<< "$ligne")"
  [ -n "$pid" ] && [ "$pid" != "0" ] || { rouge "  $nom : pas de processus en cours"; return 1; }
  exe="$(readlink "/proc/$pid/exe" 2>/dev/null || true)"
  echo "  $nom (pid $pid) exécute : $exe"
  [[ "$exe" != *"(deleted)"* ]] || { rouge "  le processus tourne encore sur l'ancien binaire Node"; return 1; }
  h="$(curl -s -m 5 "http://127.0.0.1:$port/api/health" || true)"
  [[ "$h" == *'"ok"'* ]] && vert "  API locale (port $port) : ok" || { rouge "  API locale : « $h »"; return 1; }
}

# =============================================================================
cmd_verifier() {
  titre "État actuel (lecture seule)"
  echo "Utilisateur       : $(whoami) @ $(hostname)"
  echo "Système           : $(. /etc/os-release && echo "$PRETTY_NAME")"
  echo "Node              : $(node -v) ($(command -v node))"
  echo "npm               : $(npm -v)"
  echo "PM2               : $(pm2 -v 2>/dev/null | tail -1) — modules globaux : $(npm root -g)"
  echo "Dépôt NodeSource  : $(grep -rhoE 'node_[0-9]+\.x' /etc/apt/sources.list.d/ 2>/dev/null | sort -u | tr '\n' ' ' || echo 'aucun')"
  echo "Outils de compil. : gcc $(command -v gcc >/dev/null && echo oui || echo NON) · make $(command -v make >/dev/null && echo oui || echo NON) · python3 $(command -v python3 >/dev/null && echo oui || echo NON)"
  echo "Espace disque     : $(df -h "$APP_DIR" | awk 'NR==2 {print $4 " libres"}')"
  echo "better-sqlite3    : $(node -p "require('$APP_DIR/backend/node_modules/better-sqlite3/package.json').version")"
  titre "Application"
  controle_app || true
  tester_sqlite || rouge "  better-sqlite3 ne se charge pas avec le Node actuel"
  titre "Autres processus PM2 (redémarrer ou mettre à jour PM2 les fait passer sous Node 22)"
  pm2 jlist 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const a of JSON.parse(s.slice(s.indexOf("["))||"[]")) console.log("  " + a.name + " · " + a.pm2_env.status + " · " + (a.pm2_env.pm_cwd||""))})'
  titre "Autres applications Node avec modules natifs (à recompiler aussi)"
  local autres; autres="$(find /var/www -path '*/node_modules/*' -name '*.node' 2>/dev/null | grep -v "^$APP_DIR/" | sed 's#/node_modules/.*##' | sort -u || true)"
  [ -n "$autres" ] && printf '  %s\n' $autres || echo "  aucune"
  titre "Processus node en cours"
  ps -eo pid,user,args | grep -E '[n]ode ' | sed 's/^/  /' || echo "  aucun"
}

# =============================================================================
cmd_sauvegarder() {
  [ -x "$ICI/deploy-unchk.sh" ] || stop "deploy-unchk.sh introuvable à côté de ce script ($ICI)"
  titre "Sauvegarde complète (deploy-unchk.sh)"
  APP_DIR="$APP_DIR" BACKUP_ROOT="$BACKUP_ROOT" "$ICI/deploy-unchk.sh" sauvegarder | sed '/ÉTAPE SUIVANTE OBLIGATOIRE/,$d'
  local bk; bk="$(ls -d "$BACKUP_ROOT"/2* | sort | tail -1)"
  [ -f "$bk/SAUVEGARDE_OK" ] || stop "sauvegarde introuvable dans $BACKUP_ROOT"
  titre "Copie des modules Node 20 (pour le retour arrière)"
  tar -czf "$bk/node_modules-node20.tar.gz" -C "$APP_DIR/backend" node_modules
  tar -tzf "$bk/node_modules-node20.tar.gz" > /dev/null || stop "archive des modules illisible"
  node -v > "$bk/node-avant.txt"
  ( cd "$bk" && sha256sum node_modules-node20.tar.gz >> SHA256SUMS && sha256sum -c --quiet SHA256SUMS ) || stop "empreintes invalides"
  vert "Prêt : $bk ($(du -sh "$bk" | cut -f1)) — Node $(cat "$bk/node-avant.txt")"
  echo
  echo "ÉTAPE SUIVANTE : copier ce dossier HORS du serveur (MobaXterm → Download), puis :"
  echo "  ./migrer-node22.sh migrer $bk"
}

# =============================================================================
verifier_sauvegarde() {
  local bk="$1"
  [ -f "$bk/SAUVEGARDE_OK" ] || stop "$bk n'est pas une sauvegarde vérifiée"
  [ -f "$bk/node_modules-node20.tar.gz" ] || stop "$bk ne contient pas node_modules-node20.tar.gz : lancez « ./migrer-node22.sh sauvegarder »"
  ( cd "$bk" && sha256sum -c --quiet SHA256SUMS ) || stop "empreintes de $bk invalides"
}

installer_node() { # $1 = 20 ou 22
  local v="$1"
  curl -fsSL "https://deb.nodesource.com/setup_${v}.x" -o "/tmp/nodesource_setup_${v}.sh"
  root bash "/tmp/nodesource_setup_${v}.sh" > "/tmp/nodesource_setup_${v}.log" 2>&1 || { tail -20 "/tmp/nodesource_setup_${v}.log"; return 1; }
  if [ "$v" = 22 ]; then
    root apt-get install -y nodejs > /tmp/apt-nodejs.log 2>&1 || { tail -20 /tmp/apt-nodejs.log; return 1; }
  else
    # retour : version 20.x la plus récente du dépôt, rétrogradation autorisée
    local ver; ver="$(apt-cache madison nodejs | awk '$3 ~ /^20\./ {print $3; exit}')"
    [ -n "$ver" ] || { rouge "aucune version 20.x dans le dépôt"; return 1; }
    root apt-get install -y --allow-downgrades "nodejs=$ver" > /tmp/apt-nodejs.log 2>&1 || { tail -20 /tmp/apt-nodejs.log; return 1; }
  fi
  hash -r
  [[ "$(node -v)" == "v$v."* ]] || { rouge "Node attendu v$v.x, obtenu $(node -v)"; return 1; }
}

restaurer_modules() {
  local bk="$1"
  rm -rf "$APP_DIR/backend/node_modules.migration"
  mv "$APP_DIR/backend/node_modules" "$APP_DIR/backend/node_modules.migration"
  tar -xzf "$bk/node_modules-node20.tar.gz" -C "$APP_DIR/backend"
  rm -rf "$APP_DIR/backend/node_modules.migration"
}

retour_auto() {
  local bk="$1" raison="$2"
  rouge "ÉCHEC : $raison"
  titre "Retour automatique à Node 20"
  installer_node 20 || stop "retour à Node 20 impossible : relancez « ./migrer-node22.sh retour $bk » et contactez l'administrateur système"
  restaurer_modules "$bk"
  local nom; nom="$(app_pm2 | cut -f1)"; pm2 restart "$nom" > /dev/null; sleep 5
  controle_app && vert "Retour effectué : le portail tourne de nouveau sous Node $(node -v)." || rouge "Le portail ne répond pas : vérifiez « pm2 logs $nom »."
  exit 1
}

cmd_migrer() {
  local bk="${1:-}"
  [ -n "$bk" ] || stop "usage : $0 migrer <dossier_sauvegarde>"
  titre "Contrôles avant migration"
  verifier_sauvegarde "$bk"
  local age=$(( ( $(date +%s) - $(stat -c %Y "$bk/SAUVEGARDE_OK") ) / 60 ))
  [ "$age" -le "$SAUVEGARDE_MAX_MIN" ] || stop "la sauvegarde date de $age min : relancez « ./migrer-node22.sh sauvegarder »"
  vert "  sauvegarde vérifiée ($age min) avec les modules Node 20"
  [[ "$(node -v)" == v20.* ]] || stop "Node actuel $(node -v) : cette migration part de Node 20"
  app_pm2 > /dev/null || stop "processus PM2 de l'application introuvable"
  tester_sqlite || stop "better-sqlite3 ne fonctionne déjà pas sous Node 20 : situation à examiner avant toute migration"
  echo
  read -r -p "La sauvegarde $bk a-t-elle été copiée HORS du serveur ? (tapez « oui ») " rep
  [ "$rep" = "oui" ] || stop "copie hors serveur non confirmée"

  titre "1/4 Outils de compilation"
  if command -v gcc >/dev/null && command -v make >/dev/null && command -v python3 >/dev/null; then
    vert "  déjà présents"
  else
    root timeout 600 apt-get update > /tmp/apt-update.log 2>&1 || { tail -25 /tmp/apt-update.log; stop "« apt-get update » a échoué ou a dépassé 10 min (rien n'a encore changé) : voir les lignes ci-dessus, ou /tmp/apt-update.log"; }
    root apt-get install -y build-essential python3 > /tmp/apt-build.log 2>&1 || { tail -20 /tmp/apt-build.log; stop "installation des outils impossible (rien n'a encore changé)"; }
    vert "  build-essential et python3 installés"
  fi

  titre "2/4 Node.js 22 (NodeSource node_22.x)"
  installer_node 22 || retour_auto "$bk" "installation de Node 22"
  vert "  Node $(node -v) · npm $(npm -v)"

  titre "3/4 Recompilation de better-sqlite3 pour Node 22"
  ( cd "$APP_DIR/backend" && npm rebuild better-sqlite3 > /tmp/npm-rebuild.log 2>&1 ) || { tail -25 /tmp/npm-rebuild.log; retour_auto "$bk" "recompilation de better-sqlite3"; }
  tester_sqlite || retour_auto "$bk" "better-sqlite3 ne se charge pas sous Node 22"

  titre "4/4 Redémarrage du portail sous Node 22"
  local nom; nom="$(app_pm2 | cut -f1)"
  pm2 restart "$nom" > /dev/null   # sans --update-env : JWT_SECRET, PORT… inchangés
  sleep 5
  controle_app || retour_auto "$bk" "le portail ne répond pas sous Node 22"
  vert "MIGRATION RÉUSSIE : le portail tourne sous Node $(node -v)."
  echo
  echo "À faire ensuite :"
  echo "  • ./deploy-unchk.sh controler   (contrôles complets, site public compris)"
  echo "  • les autres processus PM2 tournent encore sur l'ancien Node en mémoire ; quand ils sont prêts"
  echo "    (modules natifs recompilés s'ils en ont) : pm2 save && pm2 update"
}

# =============================================================================
cmd_retour() {
  local bk="${1:-}"
  [ -n "$bk" ] || stop "usage : $0 retour <dossier_sauvegarde>"
  verifier_sauvegarde "$bk"
  titre "Retour à Node 20 et aux modules d'origine"
  read -r -p "Confirmer le retour à Node 20 ? (tapez « oui ») " rep
  [ "$rep" = "oui" ] || stop "retour annulé"
  installer_node 20 || stop "retour à Node 20 impossible"
  restaurer_modules "$bk"
  local nom; nom="$(app_pm2 | cut -f1)"; pm2 restart "$nom" > /dev/null; sleep 5
  controle_app && vert "Le portail tourne de nouveau sous Node $(node -v)." || stop "le portail ne répond pas : pm2 logs $nom"
}

case "${1:-}" in
  verifier)    cmd_verifier ;;
  sauvegarder) cmd_sauvegarder ;;
  migrer)      shift; cmd_migrer "$@" ;;
  retour)      shift; cmd_retour "$@" ;;
  *) sed -n '2,19p' "$0"; exit 1 ;;
esac
