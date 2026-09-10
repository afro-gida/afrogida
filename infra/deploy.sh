#!/usr/bin/env bash
# Afro Gida deploy: pull the repo on the VPS and roll it out.
#
#   deploy.sh                     backend: sync backend/ -> live dir, restart,
#                                 health check, API-contract check, auto-rollback
#   deploy.sh --frontend          also rsync frontend/ into the nginx web root
#   deploy.sh --force             deploy even if origin/main == current HEAD
#   deploy.sh --allow-api-change  skip the OpenAPI contract guard (intended change)
#
# On a failed health check or contract drift the live backend dir is restored
# from a full tgz backup and the checkout is reset to the previous commit.
set -euo pipefail

REPO=/opt/afrogida
LIVE_BACKEND=/root/afro-proje-yedek/afro-proje/backend
LIVE_FRONTEND=/var/www/afro-proje
BACKUP_DIR=/root/afro-proje-yedek/deploy-backups
BRANCH=main

DO_FRONTEND=0
FORCE=0
ALLOW_API_CHANGE=0
for arg in "$@"; do
    case "$arg" in
        --frontend)         DO_FRONTEND=1 ;;
        --force)            FORCE=1 ;;
        --allow-api-change) ALLOW_API_CHANGE=1 ;;
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
BACKUP="$BACKUP_DIR/backend-$TS.tgz"

rollback() {
    echo "!! $1 - rolling back to ${OLD_SHA:0:12}"
    sudo find "$LIVE_BACKEND" -mindepth 1 -maxdepth 1 \
        ! -name venv ! -name uploads ! -name '.env' ! -name '*.log' -exec rm -rf {} +
    sudo tar xzf "$BACKUP" -C "$LIVE_BACKEND"
    sudo systemctl restart afro-backend
    git reset --hard "$OLD_SHA"
    exit 1
}

# ---- backend ----
echo ">> backend: syntax check"
find "$REPO/backend" -name '*.py' -print0 | xargs -0 -r sudo "$PYBIN" -m py_compile

if [ -f "$REPO/backend/requirements.txt" ]; then
    echo ">> backend: pip install -r requirements.txt"
    sudo "$LIVE_BACKEND/venv/bin/pip" install -q -r "$REPO/backend/requirements.txt"
fi

# pytest gate — staging venv (mongod var), izole afrogida_test DB
if [ -d "$REPO/backend/tests" ] && [ -x /opt/afrogida-staging/backend/venv/bin/python ]; then
    echo ">> backend: pytest"
    /opt/afrogida-staging/backend/venv/bin/pip install -q -r "$REPO/backend/requirements-test.txt"
    ( cd "$REPO/backend" && MONGO_URL="mongodb://localhost:27017" \
        /opt/afrogida-staging/backend/venv/bin/python -m pytest -q ) \
        || { echo "!! TESTS FAILED - deploy iptal (checkout değişmedi)"; git reset --hard "$OLD_SHA"; exit 1; }
fi

echo ">> backend: full backup -> $BACKUP"
sudo mkdir -p "$BACKUP_DIR"
sudo tar czf "$BACKUP" -C "$LIVE_BACKEND" \
    --exclude=venv --exclude=uploads --exclude='*.log' --exclude='__pycache__' .

echo ">> backend: sync + restart"
sudo rsync -a --delete \
    --exclude='.env' --exclude='venv/' --exclude='uploads/' --exclude='*.log' \
    --exclude='__pycache__/' --exclude='*bak*' --exclude='*.tgz' \
    --exclude='server_remote*.py' \
    "$REPO/backend/" "$LIVE_BACKEND/"
sudo systemctl restart afro-backend
sleep 4

echo ">> health check"
LOCAL=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/api/ || echo 000)
EDGE=$(curl -s -o /dev/null -w '%{http_code}' https://afrogida.com.tr/api/ || echo 000)
echo "   backend=$LOCAL  edge=$EDGE"
[ "$LOCAL" = "200" ] || rollback "HEALTH CHECK FAILED (HTTP $LOCAL)"

if [ "$ALLOW_API_CHANGE" -eq 0 ] && [ -f "$REPO/backend/openapi-baseline.json" ]; then
    echo ">> API contract check"
    BACKEND_URL=http://127.0.0.1:8000 bash "$REPO/infra/check-openapi.sh" || rollback "API CONTRACT DRIFT"
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

# keep the last 10 backups
sudo bash -c "ls -1t $BACKUP_DIR/backend-*.tgz 2>/dev/null | tail -n +11 | xargs -r rm -f"

echo ">> deployed ${NEW_SHA:0:12}  (health + contract OK)"
