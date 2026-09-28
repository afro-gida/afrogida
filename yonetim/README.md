# Afro Gıda Yönetim (admin uygulaması)

Sadece sistem sahibi içindir. Hiçbir yerde yayınlanmaz (mağaza / web yok).
Aynı kod: şimdi **Windows** (yerel başlatıcı), sonra **iPhone / iPad / Mac**
(Expo, Ad Hoc kurulum — yalnızca kayıtlı cihazlarda çalışır).

## Windows'ta açmak

```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\xxzar\projem\yonetim\baslat.ps1          # açar
powershell -ExecutionPolicy Bypass -File C:\Users\xxzar\projem\yonetim\baslat.ps1 -Yenile  # yeniden derleyip açar
```

`baslat.py` uygulamayı yalnızca bu bilgisayardan erişilebilen
`http://127.0.0.1:8765` adresinde açar; `/api` isteklerini
`https://afrogida.com.tr`'ye iletir.

## Güvenlik

- Giriş: kullanıcı adı + şifre + **authenticator kodu** (TOTP). İlk girişte SMS
  kodu gelir ve uygulama authenticator kurulumunu zorunlu tutar. Kurulumda 8
  tek kullanımlık **yedek kod** verilir (kâğıda yazın). Yedek kod kullanılınca
  sahibine güvenlik SMS'i gider.
- Authenticator uygulamadan kapatılamaz / değiştirilemez; sıfırlama sadece
  sunucuda (`admin_totp` koleksiyonu).
- Yönetici hesabı API'den oluşturulamaz: `infra/admin-olustur.ps1` (kendi
  PowerShell pencerenizde çalıştırın; tek yönetici kuralı).
- Oturum: web'de pencere kapanınca biter (sessionStorage), uygulamada sadece
  bellekte; 60 dk hareketsizlikte otomatik çıkış; sunucuda 12 saat üst sınır.
- Sipariş: yönetici "teslim edildi" yapamaz, tutarı değiştiremez; sadece
  gerekçeli iptal ve not (sunucuda loglanır).

## Ekranlar

Özet · Siparişler (liste, detay, iptal, not) · Pazarlar (gün, saatler,
minimum tutarlar, teslimat ücreti, servis mahalleleri, ödeme) · Ürünler
(alış/satış fiyatı, kâr, kategori, stok, kampanya, seçenek grupları) ·
Personel (pazar sorumluları → tedarikçi–pazar eşleşmesi → tedarikçi
hesapları → kuryeler) · Üyeler (detay, siparişleri, silme).

## Dikkat (sunucu davranışı)

- Pazar ve ürün güncelleme uçları kaydın **tamamını** yazar; uygulama her zaman
  tam kaydı gönderir. Ürünün sadece stok/durumu değişirken fiyat alanları
  gönderilmez (sunucu fiyatı korur).
