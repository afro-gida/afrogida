#!/usr/bin/env bash
# Staging ortamını kurar (certbot HARİÇ — o DNS yayıldıktan sonra ayrı).
# Sunucuda 'ubuntu' olarak çalıştır. Idempotent.
#
#   bash infra/staging/setup-staging.sh
#
# Kurar:
#   /opt/afrogida-staging            -> repo checkout (main)
#   /opt/afrogida-staging/backend    -> venv + .env (DB_NAME=afrogida_staging, PAYTR_TEST_MODE=1)
#   /opt/afrogida-staging/frontend   -> repo frontend/ kopyası
#   MongoDB afrogida_staging         -> test_database'in kopyası
#   systemd afro-backend-staging     -> uvicorn :8001
#   nginx staging.afrogida.com.tr    -> basic-auth, :8001 proxy (HTTP-only, certbot sonra)
set -euo pipefail

REPO=/opt/afrogida
STAGE=/opt/afrogida-staging
PROD_BACKEND=/root/afro-proje-yedek/afro-proje/backend
STAGE_BACKEND=$STAGE/backend
DOMAIN=staging.afrogida.com.tr
HTPASSWD=/etc/nginx/afrogida-staging.htpasswd
PROD_DB=test_database
STAGE_DB=afrogida_staging

echo "== 1/8  repo checkout =="
if [ ! -d "$STAGE/.git" ]; then
    git clone -q github-afrogida:afro-gida/afrogida.git "$STAGE"
else
    git -C "$STAGE" fetch -q origin && git -C "$STAGE" reset --hard -q origin/main
fi
git -C "$STAGE" log --oneline -1

echo "== 2/8  python venv + deps =="
if [ ! -x "$STAGE_BACKEND/venv/bin/python3" ]; then
    python3 -m venv "$STAGE_BACKEND/venv"
fi
"$STAGE_BACKEND/venv/bin/pip" install -q --upgrade pip
"$STAGE_BACKEND/venv/bin/pip" install -q -r "$STAGE/backend/requirements.txt"

echo "== 3/8  .env (prod'dan kopya + staging override) =="
if [ ! -f "$STAGE_BACKEND/.env" ]; then
    sudo cp "$PROD_BACKEND/.env" "$STAGE_BACKEND/.env"
    sudo chown "$(id -u):$(id -g)" "$STAGE_BACKEND/.env"
    chmod 600 "$STAGE_BACKEND/.env"
fi
# override'lar (idempotent: satır varsa değiştir, yoksa ekle)
set_env() {
    local key="$1" val="$2"
    if grep -q "^${key}=" "$STAGE_BACKEND/.env"; then
        sed -i "s|^${key}=.*|${key}=${val}|" "$STAGE_BACKEND/.env"
    else
        echo "${key}=${val}" >> "$STAGE_BACKEND/.env"
    fi
}
set_env DB_NAME "$STAGE_DB"
set_env PAYTR_TEST_MODE "1"
set_env AFRO_ALLOWED_ORIGINS "https://${DOMAIN},http://localhost,http://localhost:8081,http://localhost:19006,capacitor://localhost"
set_env AFRO_ENV "staging"
set_env SECURITY_SMS_THROTTLE_MIN "1440"   # staging: alarm SMS'i günde en fazla 1
echo "   .env hazır (DB_NAME=$STAGE_DB, PAYTR_TEST_MODE=1)"

echo "== 4/8  frontend + uploads =="
# frontend/ zaten checkout'un içinde (repo'nun parçası); nginx root oraya bakıyor.
mkdir -p "$STAGE_BACKEND/uploads"
# prod uploads'ı staging'e kopyala (resimler görünsün)
sudo rsync -a "$PROD_BACKEND/uploads/" "$STAGE_BACKEND/uploads/" 2>/dev/null || true
sudo chown -R "$(id -u):$(id -g)" "$STAGE_BACKEND/uploads"

echo "== 5/8  MongoDB $PROD_DB -> $STAGE_DB kopyası =="
if ! command -v mongodump >/dev/null; then
    echo "   mongodb-database-tools kuruluyor..."
    sudo apt-get install -y -q mongodb-database-tools
fi
TMP=$(mktemp -d)
mongodump --quiet --db "$PROD_DB" --out "$TMP"
mongorestore --quiet --drop --nsFrom "${PROD_DB}.*" --nsTo "${STAGE_DB}.*" "$TMP/$PROD_DB"
rm -rf "$TMP"
echo "   $STAGE_DB koleksiyon sayısı: $(mongosh --quiet --eval "db.getSiblingDB('$STAGE_DB').getCollectionNames().length")"

echo "== 6/8  basic-auth kullanıcısı =="
if [ ! -f "$HTPASSWD" ]; then
    PW=$(openssl rand -base64 12)
    if ! command -v htpasswd >/dev/null; then sudo apt-get install -y -q apache2-utils; fi
    printf '%s' "$PW" | sudo htpasswd -i -c "$HTPASSWD" afro
    echo "   >>> STAGING GİRİŞİ:  kullanıcı: afro   parola: $PW   <<<"
    echo "   (bu parolayı kaydet — tekrar gösterilmez)"
else
    echo "   $HTPASSWD zaten var (parolayı değiştirmek için: sudo htpasswd $HTPASSWD afro)"
fi

echo "== 7/8  systemd servisi =="
sudo cp "$STAGE/infra/staging/afro-backend-staging.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable -q afro-backend-staging
sudo systemctl restart afro-backend-staging
sleep 3
systemctl is-active afro-backend-staging
curl -s -o /dev/null -w "   staging backend :8001 -> HTTP %{http_code}\n" http://127.0.0.1:8001/api/

echo "== 8/8  nginx (HTTP-only; certbot ayrı) =="
# certbot öncesi TLS satırları olmadan geçici config
sudo tee /etc/nginx/sites-available/afrogida-staging >/dev/null <<'NGINX'
server {
    server_name staging.afrogida.com.tr;
    listen 80;
    location ~ /\.well-known/acme-challenge/ { allow all; root /var/www/html; }
    auth_basic "Afro Gida - Staging";
    auth_basic_user_file /etc/nginx/afrogida-staging.htpasswd;
    add_header X-Robots-Tag "noindex, nofollow" always;
    root /opt/afrogida-staging/frontend;
    index index.html;
    location = /robots.txt { add_header Content-Type text/plain; return 200 "User-agent: *\nDisallow: /\n"; }
    location / { try_files $uri $uri/ /index.html; add_header Cache-Control "no-store"; }
    location /api/ {
        proxy_pass http://127.0.0.1:8001/api/;
        proxy_http_version 1.1; proxy_set_header Connection ""; proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto $scheme;
    }
    location /uploads/ { proxy_pass http://127.0.0.1:8001/uploads/; proxy_set_header Host $host; }
    location = /api/payments/paytr/callback { auth_basic off; proxy_pass http://127.0.0.1:8001; proxy_set_header Host $host; }
}
NGINX
sudo ln -sfn /etc/nginx/sites-available/afrogida-staging /etc/nginx/sites-enabled/afrogida-staging
sudo nginx -t && sudo systemctl reload nginx

echo
echo "TAMAM. Sıradaki (DNS yayılınca):"
echo "  sudo certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m blackmesa161@gmail.com"
echo "Sonra: infra/staging/nginx-staging.conf içeriğini kalıcı config olarak koy (certbot TLS satırlarını ekler)."
