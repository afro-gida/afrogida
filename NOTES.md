# Afro Gıda — proje notları

## Ne olduğu
`afrogida.com.tr` — sebze/gıda için müşteri + tedarikçi (esnaf) pazaryeri.
Müşteri alışverişi, tedarikçi paneli, admin paneli, kuponlar, PayTR ödeme,
Verimor SMS/OTP, web push bildirimleri, MongoDB.

## Mimari (production sunucu: 54.38.26.227 / OVH VPS, Ubuntu 22.04)

| Katman | Konum | Çalıştırma |
|---|---|---|
| Frontend | `/var/www/afro-proje` | nginx statik servis |
| Backend | `/root/afro-proje-yedek/afro-proje/backend` | systemd `afro-backend.service` → `uvicorn server:app` @ `127.0.0.1:8000`, 3 worker |
| DB | MongoDB | systemd `mongod`, `/etc/mongod.conf` |
| Proxy/TLS | nginx + certbot | `/etc/nginx/sites-enabled/`, `/api/` ve `/uploads/` → backend |

> Dizin adı "yedek" ama **canlı olan bu**. Kafa karıştırıcı, ileride düzeltilmeli.

## Frontend'in gerçeği (ÖNEMLİ)
- Uygulama aslında bir **Expo Router + React Native Web** projesi (web export).
- **Kaynak kod (App, ekranlar, package.json, app.json) sunucuda YOK.**
  Sadece derlenmiş çıktı var: `index.html` + `_expo/static/js/web/entry-*.js` (~3.2 MB minified bundle).
- Ekip aylardır **minified bundle'ı ve index.html'i elle düzenlemiş** (yüzlerce `.bak` dosyası — repoya alınmadı).
- PWA altyapısı kurulu: `manifest.json`, `sw.js` (web push).
- Adres seçimi Google Maps ile (`map-picker.html`).

## Backend
- Tek dosya `server.py` (~374 KB). FastAPI + motor (async Mongo) + bcrypt + httpx.
- Güvenlik katmanı: Fernet şifreleme, HMAC sipariş imzası, token'lar DB'de hash'li.
- Entegrasyonlar: PayTR, Verimor SMS, pywebpush (VAPID).
- `.env` anahtarları `backend/.env.example`'da (değerler sunucuda, repoda değil).
- Emergent.sh ile başlatılmış (kodda `emergentagent.com` oturum API'si izleri var).

## Yerel kopya (bu repo)
- `frontend/` — sunucudaki statik dizin (`.bak` ve `node_modules` hariç)
- `backend/`  — `server.py` + `.env.example` + `uploads/` (uploads gitignore'da)
- Git burada başlatıldı; sunucuda VCS yoktu.

## SSH erişimi
- `ssh ubuntu@54.38.26.227` — session anahtarı kuruldu (scratchpad `projem_key`).
  Kalıcı kullanım için anahtarı `~/.ssh`'ye taşımak gerek.

## Açık kararlar
1. **Mobil uygulama yolu** — kaynak kod olmadığı için:
   a. Mevcut siteyi native kabuğa sarmak (Capacitor / TWA) — hızlı.
   b. Frontend'i Expo ile sıfırdan/yeniden kurmak, backend'i aynen kullanmak — temiz ama uzun.
2. Bundle-elle-düzenleme düzeninden çıkış (kaynak koda dönüş).
3. Backend `server.py`'yi modüllere bölmek.
