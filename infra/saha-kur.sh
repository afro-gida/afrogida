#!/usr/bin/env bash
# saha.afrogida.com.tr kurulum / güncelleme (sunucuda root ile).
#   /tmp/saha-web.tgz  : derlenmiş uygulama (EXPO_PUBLIC_API_URL=/api)
#   /tmp/saha-nginx.conf : infra/saha-nginx.conf
# İlk kurulumda SSL sertifikası alır; sonraki çalıştırmalarda sadece dosyaları
# günceller. nginx ayarı hatalıysa eski hale döner.
set -euo pipefail
HOST=saha.afrogida.com.tr
WEB=/var/www/afro-saha
CONF=/etc/nginx/sites-available/afro-saha.conf
TS=$(date +%Y%m%d-%H%M%S)

MYIP=$(curl -s --max-time 5 https://api.ipify.org || true)
DNSIP=$(getent hosts "$HOST" | awk '{print $1}' | head -1 || true)
if [ -z "$DNSIP" ]; then echo "HATA: $HOST DNS kaydi yok (A kaydi -> $MYIP eklenmeli)"; exit 1; fi
if [ -n "$MYIP" ] && [ "$DNSIP" != "$MYIP" ]; then echo "HATA: $HOST -> $DNSIP, bu sunucu $MYIP"; exit 1; fi

# 1) Uygulama dosyaları (atomik değişim, önceki sürüm yedekte)
NEW=${WEB}-yeni
rm -rf "$NEW"; mkdir -p "$NEW"
tar -xzf /tmp/saha-web.tgz -C "$NEW"
chown -R www-data:www-data "$NEW"
find "$NEW" -type d -exec chmod 755 {} +; find "$NEW" -type f -exec chmod 644 {} +
if [ -d "$WEB" ]; then mkdir -p /root/afro-proje-yedek/saha-surumler; mv "$WEB" "/root/afro-proje-yedek/saha-surumler/web-$TS"; fi
mv "$NEW" "$WEB"

# 2) SSL (yoksa) — 80. porttaki mevcut default_server acme isteklerini /var/www/html'den sunuyor
if [ ! -f "/etc/letsencrypt/live/$HOST/fullchain.pem" ]; then
  certbot certonly --webroot -w /var/www/html -d "$HOST" --non-interactive --agree-tos --keep-until-expiring
fi

# 3) nginx
[ -f "$CONF" ] && cp "$CONF" "/root/afro-proje-yedek/afro-saha.conf.$TS"
cp /tmp/saha-nginx.conf "$CONF"
ln -sf "$CONF" /etc/nginx/sites-enabled/afro-saha.conf
if nginx -t; then
  systemctl reload nginx
  echo "SAHA KURULDU: https://$HOST"
else
  echo "nginx -t HATA - geri aliniyor"
  if [ -f "/root/afro-proje-yedek/afro-saha.conf.$TS" ]; then cp "/root/afro-proje-yedek/afro-saha.conf.$TS" "$CONF"; else rm -f "$CONF" /etc/nginx/sites-enabled/afro-saha.conf; fi
  nginx -t && systemctl reload nginx
  exit 1
fi
rm -f /tmp/saha-web.tgz /tmp/saha-nginx.conf
