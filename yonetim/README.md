# Afro GÄ±da YÃ¶netim (admin uygulamasÄ±)

Sadece sistem sahibi iÃ§indir. HiÃ§bir yerde yayÄ±nlanmaz (maÄŸaza / web yok).
AynÄ± kod: ÅŸimdi **Windows** (yerel baÅŸlatÄ±cÄ±), sonra **iPhone / iPad / Mac**
(Expo, Ad Hoc kurulum â€” yalnÄ±zca kayÄ±tlÄ± cihazlarda Ã§alÄ±ÅŸÄ±r).

## Windows'ta aÃ§mak

```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\xxzar\projem\yonetim\baslat.ps1          # aÃ§ar
powershell -ExecutionPolicy Bypass -File C:\Users\xxzar\projem\yonetim\baslat.ps1 -Yenile  # yeniden derleyip aÃ§ar
```

`baslat.py` uygulamayÄ± yalnÄ±zca bu bilgisayardan eriÅŸilebilen
`http://127.0.0.1:8765` adresinde aÃ§ar; `/api` isteklerini
`https://afrogida.com.tr`'ye iletir.

## GÃ¼venlik

- GiriÅŸ: kullanÄ±cÄ± adÄ± + ÅŸifre + **authenticator kodu** (TOTP). Ä°lk giriÅŸte SMS
  kodu gelir ve uygulama authenticator kurulumunu zorunlu tutar. Kurulumda 8
  tek kullanÄ±mlÄ±k **yedek kod** verilir (kÃ¢ÄŸÄ±da yazÄ±n). Yedek kod kullanÄ±lÄ±nca
  sahibine gÃ¼venlik SMS'i gider.
- Authenticator uygulamadan kapatÄ±lamaz / deÄŸiÅŸtirilemez; sÄ±fÄ±rlama sadece
  sunucuda (`admin_totp` koleksiyonu).
- YÃ¶netici hesabÄ± API'den oluÅŸturulamaz: `infra/admin-olustur.ps1` (kendi
  PowerShell pencerenizde Ã§alÄ±ÅŸtÄ±rÄ±n; tek yÃ¶netici kuralÄ±).
- Oturum: web'de pencere kapanÄ±nca biter (sessionStorage), uygulamada sadece
  bellekte; 60 dk hareketsizlikte otomatik Ã§Ä±kÄ±ÅŸ; sunucuda 12 saat Ã¼st sÄ±nÄ±r.
- SipariÅŸ: yÃ¶netici "teslim edildi" yapamaz, tutarÄ± deÄŸiÅŸtiremez; sadece
  gerekÃ§eli iptal ve not (sunucuda loglanÄ±r).

## Ekranlar

Ã–zet Â· SipariÅŸler (liste, detay, iptal, not) Â· Pazarlar (gÃ¼n, saatler,
minimum tutarlar, teslimat Ã¼creti, servis mahalleleri, Ã¶deme) Â· ÃœrÃ¼nler
(alÄ±ÅŸ/satÄ±ÅŸ fiyatÄ±, kÃ¢r, kategori, stok, kampanya, seÃ§enek gruplarÄ±) Â·
Personel (pazar sorumlularÄ± â†’ tedarikÃ§iâ€“pazar eÅŸleÅŸmesi â†’ tedarikÃ§i
hesaplarÄ± â†’ kuryeler) Â· Ãœyeler (detay, sipariÅŸleri, silme).

## Dikkat (sunucu davranÄ±ÅŸÄ±)

- Pazar ve Ã¼rÃ¼n gÃ¼ncelleme uÃ§larÄ± kaydÄ±n **tamamÄ±nÄ±** yazar; uygulama her zaman
  tam kaydÄ± gÃ¶nderir. ÃœrÃ¼nÃ¼n sadece stok/durumu deÄŸiÅŸirken fiyat alanlarÄ±
  gÃ¶nderilmez (sunucu fiyatÄ± korur).
