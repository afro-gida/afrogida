#!/usr/bin/env bash
# Staging DB'yi production'ın güncel kopyasıyla yeniler.
#   bash infra/staging/refresh-staging-db.sh
set -euo pipefail
MONGO_URL=$(grep -oP '(?<=^MONGO_URL=).*' /opt/afrogida-staging/backend/.env | tr -d '\r')
PROD_DB=test_database
STAGE_DB=afrogida_staging

TMP=$(mktemp -d)
mongosh "$MONGO_URL" --quiet --eval "db.getSiblingDB('$STAGE_DB').dropDatabase()"
mongodump --uri="$MONGO_URL" --db="$PROD_DB" --out="$TMP" --quiet
mongorestore --uri="$MONGO_URL" --db="$STAGE_DB" --quiet "$TMP/$PROD_DB"
rm -rf "$TMP"

mongosh "$MONGO_URL" --quiet --eval "
  const s = db.getSiblingDB('$STAGE_DB');
  print('$STAGE_DB yenilendi: '+s.getCollectionNames().length+' koleksiyon, '
        +s.users.countDocuments()+' kullanıcı, '+s.transactions.countDocuments()+' sipariş');
"
sudo systemctl restart afro-backend-staging
sleep 2
curl -s -o /dev/null -w "staging :8001 -> HTTP %{http_code}\n" http://127.0.0.1:8001/api/
