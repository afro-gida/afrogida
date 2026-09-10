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

## Kod inceleme bulguları (2026-09-10)

### Backend — `backend/server.py` (6888 satır, tek dosya)
- FastAPI + `motor` (async Mongo) + bcrypt + httpx. ~150 endpoint.
- Roller: **müşteri, tedarikçi (esnaf), kurye, admin/staff (yönetici)**.
- Modüller (mantıksal): auth (Google/telefon/OTP/2FA), ürün+kategori+kampanya,
  kupon (hoş geldin kuponu otomatik), market/pazar, sipariş + PayTR ödeme + iade,
  teslimat kodu doğrulama, tedarikçi satış/hakediş/ödeme, kurye atama/rota,
  şikayet/sorun, yasal sözleşme "gate"i, SMS (Verimor), web push (VAPID),
  kapsamlı denetim logları (`/api/admin/logs/*`).
- Güvenlik: Fernet alan şifreleme, HMAC sipariş imzası, token'lar DB'de hash'li,
  brute-force/OTP-abuse kontrolü, admin oturum watchdog.
- Sağlıklı ve API-merkezli → **olduğu gibi yeniden kullanılabilir.**
- `frontend/server_remote.py` = eski/küçük sürüm (1826 satır), önemsiz artefakt.

### Frontend — kritik durum
- Kaynak yok; elde 3.2 MB minified `entry-*.js` + elle yazılmış `index.html`.
- `index.html` içinde:
  - ~2000 satır elle yazılmış CSS override ("KULLANICI İSTEĞİ..." — koyu tema
    renk düzeltmeleri, duvar kağıdı, sepet/navpill/Android safe-area yamaları).
  - **15 `<script>` bloğu** — derlenmiş uygulamayı dışarıdan monkey-patch'leyen
    `fetch` interceptor'ları ve DOM hack'leri: pazar-bazlı ürün filtresi,
    web push kaydı, admin 2FA akışı, admin kimlik izleme, ürün seçim bottom-sheet,
    numpad, "Pazar" FAB butonu, alert onay düzeltmesi, vb.
- Her değişiklik yüksek riskli. Bu düzen **sürdürülemez.**

## Öneri (Claude)
**Frontend'i Expo ile yeniden kur, backend'i aynen kullan — aşamalı.**
- Uygulama zaten React Native (Expo Router). Doğal biçimi native app.
  WebView kabuğu = react-native-web build'ini tarayıcıda göstermek: mevcut
  kırılganlık + WebView tuhaflıkları + App Store 4.2 red riski.
- Backend ürünün ~%70'i ve sağlam; API üzerinden tamamen yeniden kullanılır.
- Aşamalar:
  - **Faz 0:** yerel ortam, prod'u dondur, API + tüm ekran/akışları çalışan
    uygulamadan çıkararak belgele.
  - **Faz 1:** temiz Expo projesi; müşteri akışı (gözat → sepet → ödeme/PayTR →
    sipariş takibi). Önce web'e (mevcut frontend'in yerine), sonra TestFlight /
    Play internal.
  - **Faz 2:** tedarikçi paneli, kurye app'i, admin (admin web-only kalabilir).
- Acil "mağazada app" gerekiyorsa: PWA kurulumu zaten ~%90 hazır (manifest+sw.js);
  Android için TWA. iOS ince kabukları reddettiği için iOS gerçekçi olarak
  yeniden kurulumu bekler.

## Diğer açık işler
1. Bundle-elle-düzenleme düzeninden çıkış (kaynak koda dönüş).
2. Backend `server.py`'yi modüllere bölmek (opsiyonel; çalışıyor).
3. Sunucuda git yok — deploy'u repo'dan yapacak akış kurmak.
4. `/root/afro-proje-yedek/...` isimlendirmesini düzeltmek.
