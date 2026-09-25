# Canlı sunucu yedeği — 25 Eylül 2026

`afrogida.com.tr` sunucusunun (54.38.26.227) 25.09.2026 akşamındaki hâli.
Yeni uygulamalara (mobile/, saha/, admin/) geçmeden önce çalışan **eski sitenin**
ve backend'in birebir kopyası. Sadece yedek. Burada geliştirme yapılmaz.

| Klasör | Sunucudaki yeri | İçerik |
|---|---|---|
| `web/` | `/var/www/afro-proje` | Canlıdaki eski web sitesi: derlenmiş Expo paketi (`_expo/…/entry-ef19….js`), elle yamanmış `index.html`, görseller, `legal/`, sunucuda elle alınmış tüm `.bak` yedekleri |
| `backend/` | `/root/afro-proje-yedek/afro-proje/backend` | O gün çalışan backend kodu (commit `d034fd3`) + sunucudaki eski `server.py` yedekleri + `uploads/` (ürün/pazar görselleri) |
| `sistem/nginx-afrogida.conf` | `/etc/nginx/sites-available/afrogida.conf` | nginx site ayarı |
| `sistem/afro-backend.service` | `/etc/systemd/system/afro-backend.service` | backend systemd servisi |

## Bilerek DAHİL EDİLMEYENLER

- `backend/.env`: gerçek PayTR, Verimor ve şifreleme anahtarları ile veritabanı bağlantısı. Sadece sunucuda durur; anahtar adları `backend/.env.example` dosyasında.
- `backend/venv/`: Python paketleri (124 MB), `requirements.txt` ile yeniden kurulur.
- `backend/backend.log`: müşteri telefonu, IP gibi kişisel veri içerebilir (KVKK).
- `backend/uploads/contract_*.pdf`: tedarikçi sözleşme belgeleri (kişisel veri olabilir).
- `/root/afro-proje-yedek/deploy-backups/`: `.env` içerebilir.
- **MongoDB veritabanı**: müşteri verisi GitHub'a konmaz, ayrıca yedeklenmeli.
- TLS sertifikaları (`/etc/letsencrypt`): certbot ile yeniden alınır.

Not: `web/test.html`, `web/map-picker.html` ve Expo paketindeki Google Haritalar
tarayıcı anahtarı (`AIza…`) canlı sitede zaten herkese açık. Yeni bir gizli bilgi
değil, ama Google Cloud'da alan adı kısıtı olduğundan emin olunmalı.

## Geri yükleme (özet)

1. `web/` → `/var/www/afro-proje` (sahibi `www-data`).
2. `backend/` → `/root/afro-proje-yedek/afro-proje/backend`, ardından `python3 -m venv venv && venv/bin/pip install -r requirements.txt`; `.env` elle geri konur.
3. `sistem/` dosyaları yerlerine kopyalanır → `systemctl daemon-reload && systemctl restart afro-backend && nginx -t && systemctl reload nginx`.
