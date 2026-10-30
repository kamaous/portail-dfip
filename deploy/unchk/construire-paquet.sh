#!/usr/bin/env bash
# Construit, sur le PC, le paquet à déployer sur le serveur UNCHK à partir d'une
# révision COMMITÉE (arbre de travail propre exigé) :
#   backend/src (sans config.secrets.js), backend/package*.json, frontend/dist, VERSION
# Jamais de base de données ni de secrets dans le paquet.
#   bash deploy/unchk/construire-paquet.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

[ -z "$(git status --porcelain -- backend frontend)" ] || { echo "ARRÊT : modifications non commitées dans backend/ ou frontend/"; exit 1; }
REV="$(git rev-parse --short HEAD)"
# Dernière version « vX.Y » de l'historique (les commits d'outillage n'en portent pas)
VERS="$(git log --format=%s | grep -oE '^v[0-9.]+' | sed -n 1p || true)"
NOM="portail-dfip-${VERS:-rev}-$REV"
SORTIE="deploy/unchk/paquets"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

echo "→ Build du frontend ($REV)..."
( cd frontend && npx vite build --outDir "$TMP/frontend/dist" --emptyOutDir >/dev/null )

echo "→ Code backend de la révision $REV..."
git -c core.autocrlf=false archive "$REV" backend/src backend/package.json backend/package-lock.json | tar -x -C "$TMP"
rm -f "$TMP/backend/src/config.secrets.js"
{ echo "$NOM ($(git log -1 --format=%H))"
  echo "branche : $(git rev-parse --abbrev-ref HEAD) — construit le $(date '+%Y-%m-%d %H:%M')"
  git log -1 --format=%s | cut -c1-200; } > "$TMP/VERSION"

mkdir -p "$SORTIE"
tar -czf "$SORTIE/$NOM.tar.gz" -C "$TMP" VERSION backend frontend
( cd "$SORTIE" && sha256sum "$NOM.tar.gz" > "$NOM.tar.gz.sha256" )
cp deploy/unchk/deploy-unchk.sh "$SORTIE/"
echo "Paquet : $SORTIE/$NOM.tar.gz ($(du -h "$SORTIE/$NOM.tar.gz" | cut -f1))"
if tar -tzf "$SORTIE/$NOM.tar.gz" | grep -E 'database\.sqlite|config\.secrets\.js$'; then
  rm -f "$SORTIE/$NOM.tar.gz"*; echo "ARRÊT : base ou secrets dans le paquet"; exit 1
fi
