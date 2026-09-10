#!/usr/bin/env bash
# pytest suite'ini sunucuda çalıştırır (staging venv + yerel mongod, afrogida_test DB).
# Prod/staging DB'sine dokunmaz.
#
#   bash /opt/afrogida-staging/infra/run-tests.sh
set -euo pipefail

STAGE=/opt/afrogida-staging
VENV="$STAGE/backend/venv"

"$VENV/bin/pip" install -q -r "$STAGE/backend/requirements-test.txt"

MONGO_URL=$(grep -oP '(?<=^MONGO_URL=).*' "$STAGE/backend/.env" | tr -d '\r')
export MONGO_URL

cd "$STAGE/backend"
"$VENV/bin/python" -m pytest "$@"
