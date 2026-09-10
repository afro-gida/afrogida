#!/usr/bin/env bash
# Staging deploy: /opt/afrogida-staging'i güncelle ve afro-backend-staging'i yenile.
# Staging tek kullanımlıktır — rollback yok, sözleşme kontrolü yok, fix-forward.
#
#   deploy-staging.sh [branch]     (varsayılan: main)
set -euo pipefail

STAGE=/opt/afrogida-staging
STAGE_BACKEND=$STAGE/backend
BRANCH="${1:-main}"

cd "$STAGE"
git fetch -q origin "$BRANCH"
OLD=$(git rev-parse HEAD)
git reset --hard -q "origin/$BRANCH"
echo ">> ${OLD:0:12} -> $(git rev-parse --short HEAD)  (branch: $BRANCH)"

echo ">> syntax check"
find "$STAGE/backend" -name '*.py' -print0 | xargs -0 -r "$STAGE_BACKEND/venv/bin/python3" -m py_compile

if [ -f "$STAGE/backend/requirements.txt" ]; then
    "$STAGE_BACKEND/venv/bin/pip" install -q -r "$STAGE/backend/requirements.txt"
fi

# backend: checkout zaten /opt/afrogida-staging/backend — ayrıca sync gerekmez,
# ama .env / venv / uploads git reset'te korunur (git'te değiller).
sudo systemctl restart afro-backend-staging
sleep 3
systemctl is-active afro-backend-staging
curl -s -o /dev/null -w ">> staging backend :8001 -> HTTP %{http_code}\n" http://127.0.0.1:8001/api/
echo ">> staging deployed $(git rev-parse --short HEAD)"
