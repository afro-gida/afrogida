# Production yedekleri

## `afrogida-full-snapshot-2026-09-11.tar.gz`

Canlı sistemin (afrogida.com.tr) modülerizasyon ve frontend yeniden yazımı
başlamadan önceki **eksiksiz** anlık görüntüsü.

- **sha256:** `c09a0caa5b1c12462c44c716fa9737eb4229094d9fc4ffd4227d1d507ddc80dd`
- **Boyut:** 65 MB
- **Kopyalar:**
  - Sunucu: `afrogida-vps:/root/afrogida-full-snapshot-2026-09-11.tar.gz`
  - Yerel: `_archive/afrogida-full-snapshot-2026-09-11.tar.gz` (git'e dahil değil)
  - _(opsiyonel)_ GitHub Release asset olarak yüklenebilir

### İçindekiler (`/` köküne göre)

```
var/www/afro-proje/                      tüm statik site + 192 .bak dosyası
root/afro-proje-yedek/afro-proje/backend/  server.py + .env + uploads (venv HARİÇ)
etc/nginx/sites-available/, sites-enabled/
etc/systemd/system/afro-backend.service
```

### Geri yükleme (acil durum)

```bash
sudo systemctl stop afro-backend
sudo tar xzf afrogida-full-snapshot-2026-09-11.tar.gz -C /
cd /root/afro-proje-yedek/afro-proje/backend && python3 -m venv venv && \
  venv/bin/pip install -r /opt/afrogida/backend/requirements.txt
sudo systemctl daemon-reload && sudo systemctl start afro-backend
```

> `.env` arşivde var (gerçek secret'lar). Arşiv dosyasını herkese açık bir yere
> koymayın — GitHub Release kullanılacaksa repo **private** olmalı.

## Kod etiketleri

- `pristine-2026-09-11` → `99e7535` — sunucudan çekilen ilk hâli (modülerizasyon öncesi)
