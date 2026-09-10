# Güvenlik Denetimi — Afro Gıda Backend

**Tarih:** 2026-09-10
**Kapsam:** `backend/server.py` (6888 satır) statik inceleme + nginx yapılandırması.
**Yöntem:** Kaynak kod okuması. Çalışan sunucuda sızma testi yapılmadı, MongoDB'ye
erişilmedi, `.env` değerleri görülmedi. Tüm dosya satır satır okunmadı; yüksek riskli
akışlar (auth, oturum, ödeme, sipariş hesaplama, yetkilendirme, dosya yükleme,
OTP/parola) hedefli incelendi.

---

## Genel değerlendirme

**Backend'in güvenlik olgunluğu ortalamanın belirgin şekilde üstünde.** Kritik
akışlar doğru kurgulanmış:

- Yönetici girişi **sunucu tarafında zorunlu SMS 2FA** — istemci atlatamaz
  (`create_session` `twofa=False` ise admin oturumunu reddeder;
  `get_current_user` doğrulanmamış admin oturumunu imha edip alarm üretir).
- Oturum token'ları DB'de yalnızca **HMAC özeti** olarak; cihaza bağlı (UA hash),
  12 saat TTL, IP değişiminde SMS alarmı, 2 dakikada bir watchdog taraması.
- **Sipariş tutarı tamamen sunucuda** yeniden hesaplanır; istemciden gelen
  fiyat/indirim/ücret yalnızca karşılaştırılır, manipülasyonda işlem iptal +
  kritik alarm. Sipariş bütünlüğü HMAC imzalı (`calc_signature`).
- **PayTR callback**: HMAC imza + ödenen tutarın sipariş tutarıyla çapraz kontrolü
  + sipariş imzası doğrulaması.
- Parola: `bcrypt`. Kod karşılaştırmaları `hmac.compare_digest` (timing-safe).
- Tüm `/api/admin/*` uçları rol korumalı (`get_current_admin`/`get_current_staff`);
  yalnızca 2 giriş ucu korumasız — beklenen durum.
- Rate limit + hesap/IP kilidi tüm auth yollarında. Alan şifreleme (Fernet):
  adres, teslim kodu.
- Frontend bundle'ında gömülü API anahtarı / secret **bulunamadı**.

**"Bir bug'dan felakete" durumu yok.** Aşağıdaki bulgular gerçek ama çoğu
ikincil savunma katmanıyla sınırlanmış durumda.

---

## Bulgular

| # | Önem | Konu | Konum |
|---|---|---|---|
| 1 | **YÜKSEK** | Sabit varsayılan admin parolası `admin` / `pazar2026` | `server.py:4708` |
| 2 | **ORTA** | Pazarı atanmamış kurye, pazar kısıtını atlar (tüm sipariş + gerçek müşteri telefonu) | `server.py:5330`, `:5359` |
| 3 | **ORTA** | Kimliksiz ReDoS: `GET /api/products?search=` — kaçışsız `$regex`, uzunluk sınırı yok | `server.py:2165` |
| 4 | **DÜŞÜK** | `rate_limit` hata durumunda **fail-open** (0 döner = izin ver) | `server.py:328` |
| 5 | **DÜŞÜK** | Üretim CORS varsayılanı `http://localhost*` + `capacitor://localhost` içeriyor; regex her subdomain'e izin veriyor | `server.py:4630` |
| 6 | **DÜŞÜK** | Parola sıfırlamada `check_lockout`/`register_failure` ve IP bazlı limit yok; admin sıfırlaması sabit 2FA telefonunu değil hesap telefonunu kullanıyor | `server.py:7679` |
| 7 | **DÜŞÜK** | OTP kodları tuzsuz SHA-256 ile saklanıyor (admin 2FA `_hmac_hex` kullanıyor) | `server.py:7019` |
| 8 | **DÜŞÜK** | Eski düz-metin oturum token'ı desteği hâlâ kodda (`_session_query` + non-sparse indeks) | `server.py:523`, `:4666` |
| 9 | **DÜŞÜK** | `update_product` admin yolunda `payload.dict()` (exclude_unset değil) → kısmi güncelleme gönderilmeyen alanları Pydantic varsayılanına sıfırlar | `server.py:2298` |
| 10 | BİLGİ | `admin_verify_delivery_code` (admin yolu) deneme sayacı yok (kurye yolunda var) | `server.py:5218` |
| 11 | BİLGİ | Hesap sayımı (enumeration): kayıtlı numara 409, kayıtsız giriş 404 | `server.py:7012`, `:1460` |
| 12 | BİLGİ | `catalog_config` / `settings` ham `dict` `$set` ile yazılıyor (admin-only mass-assignment) | `server.py:4900`, `:5534` |
| 13 | BİLGİ | API yanıtlarında CSP / güvenlik başlıkları sınırlı (statik sitede nginx bazılarını koyuyor) | nginx |

---

## Detaylar ve öneriler

### 1. YÜKSEK — Sabit varsayılan admin parolası

`startup()` içinde, `role: "admin"` olan kullanıcı yoksa şu hesap oluşturuluyor:

```python
"username": "admin",
"password_hash": hash_password("pazar2026"),
```

**Risk:** Bu parola artık kaynak kodda (ve çektiğimiz kopyada) açık. Saldırgan
public bundle'dan admin giriş ucunu (`/api/auth/admin`) biliyor. `admin` /
`pazar2026` tahmini bedava. Tek engel: sabit admin telefonuna giden SMS 2FA.
Yani doğrudan ele geçirme değil — ama:
- Saldırgan geçerli parolayla admin telefonuna **SMS yağdırabilir** (rahatsızlık,
  maliyet, sosyal mühendislik: "kodu okur musun").
- 2FA telefon yapılandırması bozulursa tek savunma çöker.

**Yapılacak (öncelikli):**
1. Üretimdeki admin hesabının parolasını **hemen** güçlü bir değerle değiştir.
2. Seed'i kaldır ya da parolayı `secrets.token_urlsafe()` ile rastgele üret,
   log'a yazma, ilk girişte parola değiştirmeyi zorunlu kıl.
3. Seed kontrolünü `role: {"$in": ["admin","yonetici"]}` yap.

### 2. ORTA — Pazarı atanmamış kurye pazar kısıtını atlıyor

```python
def _courier_market_guard(current, order):
    if current.get("role") == "kurye":
        mkts = get_user_courier_markets(current)
        if mkts and not any(_afro_market_eq(order.get("market_name"), m) for m in mkts):
            raise HTTPException(403, ...)
```

`mkts` boşsa (kuryeye hiç pazar atanmamışsa) **hiçbir kısıt uygulanmıyor**.
Aynı desen `courier_list_orders`'ta: pazarsız kurye **tüm eve-servis siparişlerini
ve maskesiz müşteri telefonlarını** görür, herhangi bir siparişi "yola çıktı" /
"teslim edildi" yapabilir.

**Yapılacak:** `mkts` boşsa **default-deny** — pazar atanmamış kuryeye 403 /
boş liste dön.

### 3. ORTA — `GET /api/products?search=` üzerinden kimliksiz ReDoS

```python
if search:
    query["name"] = {"$regex": search, "$options": "i"}
```

`search` kimlik doğrulaması olmadan, kaçışsız ve uzunluk sınırsız olarak regex'e
giriyor. Kötü niyetli bir desen ~1000 ürün adına karşı CPU'yu tırmandırabilir.
Aynı desen `admin_list_members` (`:2890`) ve `admin logs ip_address` (`:7586`) —
bunlar admin-only, düşük risk.

**Yapılacak:** `re.escape(search)` (zaten alt-dize eşleşmesi isteniyor) + uzunluk
sınırı (örn. 64). Daha iyisi: `name` üzerinde MongoDB text index.

### 4. DÜŞÜK — `rate_limit` fail-open

```python
except Exception as exc:
    logger.error(...)
    return 0          # <- hata = "limit aşılmadı"
```

MongoDB yavaşlar/hata verirse tüm hız sınırları ve giriş/OTP throttle'ları devre
dışı kalır. `[(key,1),(bucket,1)]` unique indeksinde yarış → DuplicateKey → o
istek için fail-open.

**Yapılacak:** Kritik yollarda (admin giriş, OTP, parola sıfırlama) hata durumunda
**fail-closed** (429) ya da en azından ikinci bir katman (IP başına sabit pencere).

### 5. DÜŞÜK — Üretim CORS varsayılanı

`AFRO_ALLOWED_ORIGINS` env tanımlı değilse `http://localhost:3000/8081/19006`,
`capacitor://localhost`, `http://localhost` `allow_credentials=True` ile kabul
ediliyor. Ayrıca `allow_origin_regex = ^https://([a-z0-9-]+\.)?afrogida\.com\.tr$`
**her** subdomain'e güveniyor (subdomain devralma riski).

**Yapılacak:** Üretimde `AFRO_ALLOWED_ORIGINS`'i yalnızca gerçek alan adlarıyla
set et (doğrula — sunucuda kontrol edemedik). Regex'i kaldır ya da bilinen
subdomain listesine indir (`panel.`, `tedarikci.`, `kurye.`).

### 6. DÜŞÜK — Parola sıfırlama savunma katmanı

`reset_password_with_otp`: yalnızca `pwreset:{phone}` 6/15dk limiti var;
`check_lockout`/`register_failure` yok, IP bazlı limit yok. Brute-force pratikte
sınırlı ama giriş akışındaki kadar sağlam değil. Ayrıca **admin** parola
sıfırlaması sabit `ADMIN_2FA_PHONE`'a değil, hesabın `phone` alanına OTP
gönderiyor.

**Yapılacak:** IP bazlı limit + `register_failure` ekle. Admin rollerinde parola
sıfırlamayı sabit 2FA telefonuna kilitle ya da tamamen devre dışı bırak.

### 7. DÜŞÜK — OTP hash'i

`otp_codes.code_hash = sha256(code)` — tuzsuz. Kısa TTL + deneme limitleri
kabul edilebilir kılıyor ama admin 2FA'daki `_hmac_hex` (secret'lı) ile tutarsız.

**Yapılacak:** `_hmac_hex` kullan.

### 8. DÜŞÜK — Eski oturum token'ı desteği

`_session_query` hem `token_hash` hem düz `session_token` arıyor; startup'ta
migrasyon var ama fallback ve `session_token` (sparse) unique indeksi kodda kalmış.

**Yapılacak:** Migrasyonun tamamlandığını doğrula (`session_token` alanı olan
kayıt sayısı = 0), sonra fallback'i ve indeksi kaldır.

### 9. DÜŞÜK — `update_product` kısmi güncelleme

Admin yolunda `updates = payload.dict()` tüm alanları döndürür; istemci kısmi
gönderirse gönderilmeyen alanlar `ProductInput` varsayılanına iner (fiyatı
sıfırlayabilir). Güvenlikten çok veri bütünlüğü.

**Yapılacak:** `payload.dict(exclude_unset=True)` ile birleştir.

---

## İyi yapılmış (korunmalı)

- Sunucu-otoriter sipariş hesaplama + tamper alarmları
- Sunucu tarafı zorunlu admin 2FA + cihaz bağlama + watchdog
- PayTR HMAC + tutar çapraz kontrol
- `hmac.compare_digest` her yerde
- Oturum token'ı DB'de hash'li, TTL indeksli
- Dosya yükleme: uuid isim (path traversal yok), boyut sınırı, PIL yeniden kodlama,
  PDF magic-byte kontrolü
- Kupon kötüye kullanım tespiti + alarm
- Tedarikçi ürün düzenlemede alan bazlı kısıt + sahiplik kontrolü
- Kapsamlı denetim logları

---

## Önerilen sıra

1. **Bugün:** Bulgu 1 (admin parolası) — üretimde değiştir.
2. **Bu hafta:** Bulgu 2 (kurye default-deny), Bulgu 3 (`re.escape`), Bulgu 5
   (üretim CORS env doğrula).
3. **Modülerizasyon sırasında:** Bulgu 4, 6, 7, 8, 9 — yeni `security/` ve
   `rate_limit` modüllerine taşınırken düzelt.
4. **Sızma testi:** Bu statik denetim çalışan sistemde IDOR/enjeksiyon/oturum
   testleriyle doğrulanmalı (ayrı iş).
