# Afro Gıda — Yönetici (Admin) Paneli — Yeni Uygulama Brifingi

Bu döküman, 4. uygulamayı (yönetici paneli) sıfırdan kurmaya başlayacak Claude
oturumu için hazırlandı. Müşteri uygulaması `mobile/`de, tasarım işi ayrı bir
oturumda ilerliyor — bu döküman SADECE admin paneli içindir.

## 1. Neden ayrı bir uygulama (ayrı klasör, ayrı paket)?

Güvenlik kararı (proje başında verildi, DEĞİŞMEDİ): **admin paneli asla
müşteri uygulamasıyla aynı pakette/bundle'da olmayacak.** Sebep: müşteri
uygulaması herkesin indirebileceği bir pakettir (web bundle veya app store) —
içine admin kodu/route'ları gömülürse, biri o paketi indirip inceleyerek
admin panelinin yapısını (endpoint'ler, ekranlar, iş mantığı) öğrenebilir.
Admin kodu **hiçbir public adreste barındırılmayacak** — güncellenen karar
için 2. bölüme bak (USB ile dağıtılan Windows/Android uygulaması). Ayrıca
admin paneli **hiçbir zaman** app store'a (Google Play / App Store) da
konulmayacak.

## 2. Teknik karar (ben verdim, gerekçesiyle) — GÜNCELLENDİ

**ÖNEMLİ DEĞİŞİKLİK (kullanıcı kararı):** Admin paneli **hiçbir public web
adresinde barındırılmayacak** (panel.afrogida.com.tr YOK, hiçbir yerde
duyurulmayacak/DNS'e konmayacak). Bunun yerine **masaüstü/tablet uygulaması
olarak paketlenip yalnızca USB flash bellekle elden ele dağıtılacak** —
mağazaya (Play Store vb.) da KESİNLİKLE konmayacak. Gerekçe: bir web adresi
olursa (izole/duyurulmamış bile olsa) taranıp bulunabilir; USB ile elden
dağıtımda ortada taranacak bir adres yok — fiziksel erişim olmadan uygulamanın
kendisine ulaşmak mümkün değil. Uygulamanın içindeki arayüz kodu görülse bile
(her uygulamada olduğu gibi kaçınılmaz), gerçek işlemler yine backend'deki
parola + SMS 2FA girişinden geçmeden yapılamıyor — bu kısım değişmedi.

- **Ayrı klasör:** `admin/` (repo kökünde, `backend/` ve `mobile/` ile
  kardeş) — bu, admin arayüzünün WEB KODU (React). Aşağıdaki iki "sarmalayıcı"
  bu kodu native uygulamaya çevirir, kendi kodunu yazmaz.
- **Web arayüz yığını: Vite + React + TypeScript.** Gerekçe: tablo/liste
  ağırlıklı bir yönetim panosu için standart, hızlı derlenen bir seçim; aynı
  kod hem Windows hem Android sarmalayıcısına beslenir (tek kod tabanı, iki
  paket).
- **Windows paketleme: Electron.** Gerekçe: proje zaten Node/npm tabanlı
  (mobile/ de öyle), Electron ek bir dil/araç zinciri (ör. Rust) gerektirmiyor,
  iyi belgelenmiş, taşınabilir tek `.exe` üretebiliyor (kurulum gerektirmeden
  USB'den çalıştırılabilir — "portable" build).
- **Android (tablet) paketleme: Capacitor.** Gerekçe: aynı Vite+React web
  kodunu gerçek bir Android APK'ya sarar, Play Store'a hiç uğramadan `.apk`
  dosyasını USB ile tablete kopyalayıp "bilinmeyen kaynaklardan yükle" ile
  kurmak yeterli.
- Uygulama yine de çalışırken gerçek backend'e (internet üzerinden, aynı API)
  bağlanacak — USB'de olan SADECE arayüz kodu/kurulum paketi, canlı veri için
  yine sunucuya bağlanması gerekiyor. Yani "tamamen offline" değil; "gizli
  dağıtım, normal (online) çalışma".
- Kod stili/dizin yapısı konusunda `mobile/`deki desenlerden (ör. tema
  sabitleri, API istemcisi yapısı) esinlenebilirsin ama birebir kopyalamak
  zorunda değilsin — bu ayrı bir proje.

## 3. Backend — admin uçları zaten hazır

Backend'i ben modülerleştirdim, admin'in kullanacağı uçların hepsi
`backend/routers/` altında (`GET/POST/PUT/DELETE`, hepsi `Depends(get_current_admin)`
veya `get_current_staff` ile korumalı):

- `admin_members.py` — üye listesi/arama, detay, işlem geçmişi, güncelle, sil,
  kapıda ödeme kısıtlaması kaldır/istisna.
- `admin_staff.py` — esnaf/kurye atama, `/admin/staff`, `/admin/courier*`,
  `/admin/supplier-groups`.
- `uploads.py` — resim yükleme (`/admin/upload`).

**Backend modülerleştirme tamamen bitti** (server.py 6888→224 satır),
push edildi — tüm admin uçları için tam liste `localhost:8000/docs`'ta.
- `admin_orders.py` — sipariş listesi/detay/güncelle/iade/teslim kodu.
- `logs.py` — admin log ekranları (sipariş/ödeme/güvenlik/auth logları).
- `catalog.py` — kategori/tedarikçi/pazar-tedarikçi eşlemesi (yönetici
  kataloğu).
- `complaints.py` — şikayet/sorun bildirimleri.
- `settings.py` — genel ayarlar (min tutar, teslimat saatleri vb.), SMS
  yapılandırma durumu, ziyaret raporu, yasal belge listesi.
- `legal.py` — sözleşme PDF yükleme, sözleşme onay istatistikleri/logları.
- `suppliers.py`, `coupons.py`, `products.py`, `markets.py`, `push.py` —
  bunlarda da `/admin/*` alt-uçları var (ör. `/admin/coupons`,
  `/admin/products`... değil, ürünlerde farklı olabilir, dosyaya bak).

Yerel test için: `cd backend && ../.venv/Scripts/python.exe run_dev_server.py`
→ `http://localhost:8000/api` — OpenAPI şemasını `http://localhost:8000/docs`
adresinden görebilirsin, tüm admin uçlarının tam listesi ve parametreleri
orada.

**Not:** Bu backend dev server'ı ben zaten şu an açık tutuyorum (SMS-OTP
debug için) — ikinci bir kopyasını başlatmaya çalışma, port 8000 çakışır.
İhtiyacın varsa bana haber ver.

## 4. Admin girişi / kimlik doğrulama

Yönetici girişi normal üye girişinden FARKLI ve daha güvenli:
- `POST /api/admin/login` (telefon + parola) → başarılıysa 2FA tetiklenir.
- Yönetici 2FA: HER girişte (cihazdan bağımsız) SMS kodu gönderilir
  (`ADMIN_2FA_PHONE`'a — güvenlik ekibinin telefonuna, giriş yapan kişiye
  değil). `POST /api/admin/2fa/verify` ile tamamlanır.
- Oturum süresi normalden kısa (`ADMIN_SESSION_HOURS`, varsayılan 12 saat).
- Tam akış için `routers/auth.py` içindeki admin login/2FA endpoint'lerine
  bak.

## 5. Sınırlar / kurallar

- **`backend/` ve `mobile/` klasörlerine dokunma** — onlar başka oturumlarda.
- Yeni `admin/` klasörü SENİN alanın, orada serbestçe ilerleyebilirsin.
- Büyük bir bağımlılık/araç kararı almadan önce (ör. bir UI kütüphanesi
  eklemek) durmana gerek yok, kendi kararını ver — kullanıcı teknik
  detaylarla uğraşmak istemiyor, sonucu görüp değerlendirecek.
- İlerledikçe kısa özetlerle kullanıcıya (ve gerekirse bana) rapor ver.
- Şu an sistemde bellek sıkışıklığı yaşadık (2 dev server aynı anda
  öldürüldü) — kalıcı bir dev server açık tutma, ihtiyaç oldukça aç/kapat.

## 6. Öncelikli ekranlar (ilk sürüm için mantıklı sıra — zorunlu değil)

1. Giriş (telefon + parola + SMS 2FA).
2. Üye listesi + üye detay/işlem geçmişi (`admin_members.py` zaten hazır).
3. Sipariş listesi + detay/durum güncelleme (`admin_orders.py`).
4. Ürün/kategori/kampanya yönetimi.
5. Esnaf/kurye atama, tedarikçi grupları.
6. Ayarlar (teslimat saatleri, minimum tutar vb. — gerçek DB alan adları
   için xxzar-47'ye gönderdiğim mesaja bak: market_hours, pickup_order_hours,
   delivery_order_hours, min_pickup_amount, min_delivery_amount).
7. Loglar (güvenlik, ödeme, sipariş, auth).

## 7. Paketleme (native uygulama) — Windows + Android

Önce `admin/` içinde normal bir Vite+React web uygulaması olarak çalışır
hale getir (tarayıcıda test edilebilir), paketleme EN SONA bırakılabilir —
ekran/akış işi bittikten sonra:

- **Windows:** Electron ile sar, "portable" (kurulumsuz, tek `.exe`) build
  al. Elden dağıtım USB'ye o `.exe` kopyalanarak yapılır.
- **Android:** Capacitor ile sar (`npx cap add android`), Android Studio ile
  `.apk` üret. USB'ye kopyalanıp tablette "bilinmeyen kaynaklardan yükle"
  ile kurulur.
- İkisi de AYNI `admin/` web koduna dayanır — ayrı ayrı yeniden yazmana
  gerek yok, sadece iki farklı "sarma" adımı.
- Hiçbir aşamada bir web sunucusuna (panel.afrogida.com.tr vb.) deploy
  ETME — sadece yerel derleme çıktıları (`.exe`, `.apk`) üretilecek, bunlar
  kullanıcıya elden/USB ile verilecek.
