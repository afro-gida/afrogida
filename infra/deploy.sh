#!/usr/bin/env bash
# Afro Gida deploy: pull the repo on the VPS and roll it out.
#
#   deploy.sh              -> backend only (server.py + restart + health check + auto-rollback)
#   deploy.sh --frontend   -> also rsync frontend/ into the nginx web root
#   deploy.sh --force       -> deploy even if origin/main == current HEAD
#
# Safe to re-run. On a failed health check the backend is restored and the
# checkout is reset to the previous commit.
set -euo pipefail

REPO=/opt/afrogida
LIVE_BACKEND=/root/afro-proje-yedek/afro-proje/backend
LIVE_FRONTEND=/var/www/afro-proje
BRANCH=main

DO_FRONTEND=0
FORCE=0
for arg in "$@"; do
    case "$arg" in
        --frontend) DO_FRONTEND=1 ;;
        --force)    FORCE=1 ;;
        *) echo "unknown arg: $arg" >&2; exit 2 ;;
    esac
done

cd "$REPO"
OLD_SHA=$(git rev-parse HEAD)
git fetch --quiet origin "$BRANCH"
NEW_SHA=$(git rev-parse "origin/$BRANCH")

if [ "$OLD_SHA" = "$NEW_SHA" ] && [ "$FORCE" -eq 0 ]; then
    echo "already up to date at ${OLD_SHA:0:12}"
    exit 0
fi

echo ">> ${OLD_SHA:0:12} -> ${NEW_SHA:0:12}"
git reset --hard "origin/$BRANCH"

TS=$(date +%Y%m%d-%H%M%S)
PYBIN="$LIVE_BACKEND/venv/bin/python3"

# ---- backend ----
echo ">> backend: syntax check"
sudo "$PYBIN" -m py_compile "$REPO/backend/server.py"

if [ -f "$REPO/backend/requirements.txt" ]; then
    echo ">> backend: pip install -r requirements.txt"
    sudo "$LIVE_BACKEND/venv/bin/pip" install -q -r "$REPO/backend/requirements.txt"
fi

echo ">> backend: backup + install + restart"
sudo cp -a "$LIVE_BACKEND/server.py" "$LIVE_BACKEND/server.py.deploy-bak-$TS"
sudo install -m 644 -o root -g root "$REPO/backend/server.py" "$LIVE_BACKEND/server.py"
sudo systemctl restart afro-backend
sleep 4

echo ">> health check"
LOCAL=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/api/ || echo 000)
EDGE=$(curl -s -o /dev/null -w '%{http_code}' https://afrogida.com.tr/api/ || echo 000)
echo "   backend=$LOCAL  edge=$EDGE"
if [ "$LOCAL" != "200" ]; then
    echo "!! HEALTH CHECK FAILED - rolling back"
    sudo install -m 644 -o root -g root "$LIVE_BACKEND/server.py.deploy-bak-$TS" "$LIVE_BACKEND/server.py"
    sudo systemctl restart afro-backend
    git reset --hard "$OLD_SHA"
    exit 1
fi

# ---- frontend (opt-in) ----
if [ "$DO_FRONTEND" -eq 1 ]; then
    echo ">> frontend: rsync -> $LIVE_FRONTEND (no --delete)"
    sudo rsync -a \
        --exclude='*.bak' --exclude='*.bak-*' --exclude='*.bak_*' --exclude='*.bak.*' \
        --exclude='server_remote*.py' --exclude='.git' \
        "$REPO/frontend/" "$LIVE_FRONTEND/"
    sudo chown -R www-data:www-data "$LIVE_FRONTEND"
fi

# prune old deploy backups (keep last 10)
sudo bash -c "ls -1t $LIVE_BACKEND/server.py.deploy-bak-* 2>/dev/null | tail -n +11 | xargs -r rm -f"

echo ">> deployed ${NEW_SHA:0:12}  (health OK)"
