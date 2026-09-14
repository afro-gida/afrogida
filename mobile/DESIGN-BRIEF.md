# Afro Gıda Mobil Uygulama — Tasarım Görevi Brifingi

Bu döküman, kullanıcının ekran görüntüsü/tasarım paylaşarak görsel düzeltmeler
yaptıracağı Claude oturumu için hazırlandı. Backend (API) tarafı ayrı bir
oturumda yazılıyor — bu brifing SADECE görünüm/tasarım (`mobile/` klasörü)
içindir.

## 1. Proje bağlamı

Afro Gıda (afrogida.com.tr) bir sebze/pazar market uygulaması. Eski
uygulamanın kaynak kodu kayıp — sadece derlenmiş (minified) web bundle'ı
hayatta. Bu yüzden mobil uygulama (`mobile/`) SIFIRDAN, Expo Router (SDK 57)
+ React Native + TypeScript ile yeniden yazılıyor. Şu an sadece MÜŞTERİ
tarafı yazılıyor (tedarikçi/kurye/admin uygulamaları ayrı, sonraki aşama).

## 2. Teknik ortam

- Kod: `mobile/src/app/*.tsx` (ekranlar, dosya-tabanlı yönlendirme —
  expo-router), `mobile/src/components/*` (paylaşılan bileşenler),
  `mobile/src/constants/theme.ts` (renkler, boşluk birimleri, genişlik
  sabitleri).
- Önizleme (Windows PowerShell):
  ```
  cd mobile
  npx expo start --web --port 8081
  ```
  Sonra tarayıcıda `http://localhost:8081`.
- Değişiklik yaptıktan sonra terminalde hata/kırmızı ekran olup olmadığını
  MUTLAKA kontrol et (Metro loglarında `ERROR` ara).
- `mobile/AGENTS.md`: "Expo HAS CHANGED" uyarısı var — SDK 57 bazı API'leri
  değiştirdi (ör. `@react-navigation/bottom-tabs`'ın `sceneContainerStyle`'ı
  artık `sceneStyle`). Emin olmadığın bir prop için
  `node_modules/expo-router/build/react-navigation/*/types.d.ts` dosyalarına
  bakıp gerçek tip tanımını doğrula, hafızandaki eski Expo bilgisine güvenme.

## 3. ZATEN KURULU tasarım sistemi — değiştirmeden önce oku

### 3.1 Duvar kağıdı (wallpaper)

Gerçek site (afrogida.com.tr) her zaman aynı sebze desenli duvar kağıdını
sabit (fixed) arka plan olarak kullanıyor. Bizim uygulamada:

- Resimler: `mobile/assets/brand/wallpaper-light.jpg` (açık mod),
  `wallpaper-dark.jpg` (koyu mod) — bunlar gerçek sitenin dosyalarıyla
  hash-birebir aynı, KAYNAK OLARAK DOĞRU, değiştirme/değiştirtme.
- Web derlemesi için aynı dosyalar `mobile/public/wallpaper-light.jpg` ve
  `wallpaper-dark.jpg` olarak da duruyor (sabit URL'den servis edilmesi
  için — Expo'nun `public/` klasörü aynen web köküne kopyalanıyor).
- Uygulama: `mobile/src/components/screen.tsx` — HER SAYFA bu `Screen`
  bileşenini kullanmalı. Web'de her ekran kendi içinde `position: fixed`
  bir katman olarak duvar kağıdını basıyor (native'de `ImageBackground` ile).

  **KIRILGAN NOKTA:** Daha önce "gezinme kütüphanesinin (React Navigation)
  ekran kapsayıcısını şeffaf yap, duvar kağıdı `<body>`'den görünsün" diye
  bir yöntem denendi — bu, ekrandan ekrana geçerken ÖNCEKİ ekranların
  görünmeye devam etmesine (üst üste binmesine) yol açtı, çünkü React
  Navigation önceki ekranı gizlemek için kendi kapsayıcısının OPAK
  olmasına güveniyor. O yüzden: **Stack/Tabs `screenOptions`'a
  `contentStyle`/`sceneStyle` ile `backgroundColor: 'transparent'` EKLEME.**
  Duvar kağıdı ihtiyacı varsa `Screen` bileşenini kullan, o zaten hallediyor.

### 3.2 Renk kuralı

`mobile/src/constants/theme.ts` → `Colors.light` / `Colors.dark`:

| Tema | Aksan rengi (`tint`) | Kullanım |
|---|---|---|
| Açık mod | `#fb8c3c` (turuncu, rgb 251,140,60) | Butonlar, aktif sekme, linkler, kenarlıklar |
| Koyu mod | `#14B67E` (yeşil, rgb 20,182,126) | Aynısı |

Bu, gerçek sitenin renk kuralıyla birebir aynı olacak şekilde ayarlandı.
Yeni bir renk eklerken bu tabloyla çelişmemeye dikkat et — açık modda
turuncu, koyu modda yeşil ağırlıklı.

### 3.3 Web'de içerik genişliği

Masaüstü tarayıcıda (geniş pencere) içerik telefon genişliğinde ortalanmış
tek bir sütunda durur — `theme.ts` içindeki `MaxContentWidth` sabiti (şu an
800px) ile. `Screen` bileşeni ve sekme çubuğu (`pazar/[id]/_layout.tsx`)
bunu zaten uyguluyor. Yeni tam-genişlik bir bileşen eklersen aynı sabiti
kullan, yeni bir sayı uydurma.

## 4. Referans: eski sitenin görsel detayları

Kullanıcı, eski (canlı) afrogida.com.tr'nin CSS/JS ile yaptığı görsel
efektleri anlatan bir teknik döküman paylaştı. ÖNEMLİ: o dökümandaki
yöntem (120ms'de bir tüm sayfayı tarayıp `data-*` etiketi yapıştırma) SADECE
derlenmiş/düzenlenemeyen eski koda dışarıdan yama yapmak için gerekliydi.
Bizim yeni kodumuzda ihtiyaç YOK — aynı GÖRÜNÜMÜ doğrudan bileşen
stilleriyle (StyleSheet, inline style) yazıyoruz. Ama o dökümandaki GÖRSEL
kurallar (efektlerin nasıl göründüğü) hâlâ hedef:

- **Buzlu cam (frosted glass) kart efekti** — açık modda soluk/beyaz kartlar
  yarı şeffaf + `backdrop-filter: blur(14px) saturate(1.3)` ile arkadan
  duvar kağıdı bulanık görünsün. (Henüz uygulanmadı.)
- **Bölüm başlığı bantları** (ör. "Domates", "Biber" kategori başlıkları) —
  hafif blur + turuncu (açık) / yeşil (koyu) ince kenarlık. (Henüz
  uygulanmadı.)
- **Alt menü "yüzen ada" (floating pill)** görünümü — sekme çubuğu ekranın
  alt kenarına yapışık değil, kenarlardan biraz boşluklu, yuvarlak köşeli,
  "yüzen" bir şerit gibi durur. (Henüz uygulanmadı — şu an düz/yapışık.)
- **Sepet sayfası özel stilleri** — dolu turuncu/yeşil butonlar yerine
  şeffaf-buzlu outline butonlar, "Sipariş Oluştur" butonu her zaman yeşil.
  (Henüz uygulanmadı.)

Bu dört madde şu an YOK — kullanıcı ekran görüntüsü gönderdikçe bunları
(ve başka spesifik istekleri) sırayla ekleyebilirsin. Öncelik kullanıcının
gösterdiği ekran görüntüsüne göre değişebilir, yukarıdaki sıralama zorunlu
değil.

## 5. Sınırlar / kurallar

- **`backend/` klasörüne dokunma** — orada başka bir Claude oturumu
  backend'i modülerleştiriyor/geliştiriyor.
- **`frontend/` ve `projem/` klasörleri eski/referans** (derlenmiş eski
  bundle + orijinal Expo proje kopyası) — canlı geliştirme sadece `mobile/`
  altında.
- Bu repoda aynı anda başka Claude oturumları da çalışıyor olabilir.
  Büyük/yapısal bir değişiklik yapmadan önce (dosya taşıma, ortak bileşen
  yeniden yazma vb.) `ListAgents` ile kontrol et; çakışma ihtimali varsa
  `SendMessage` ile haber ver.
- Her değişiklikten sonra dev server'ı (`npx expo start --web --port 8081`)
  hatasız derlediğini doğrula, sonra kullanıcıdan kontrol etmesini iste.
- `Screen` bileşenini atlayıp yeni bir sayfa/ekran için kendi arka planını
  elle yazma — duvar kağıdı + ortalama sistemini bozar.

## 6. Nasıl ilerlenir

1. Kullanıcı bir ekran görüntüsü + ne değişsin istediğini anlatır.
2. İlgili dosyayı bul (`mobile/src/app/...` veya `mobile/src/components/...`).
3. Değişikliği yap, dev server'ın hatasız derlediğini kontrol et.
4. Kullanıcıya "tarayıcıyı yenile, kontrol et" de.
5. Küçük, tek-tek, geri alınabilir adımlarla ilerle — büyük toplu tasarım
   değişikliği yerine kullanıcının gösterdiği şeye odaklan.
