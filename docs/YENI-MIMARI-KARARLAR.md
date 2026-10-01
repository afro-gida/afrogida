# Yeni Mimari — Kararlar ve Kurallar

Tek uygulamadan çok uygulamalı yapıya geçiş için kullanıcıyla netleştirilen kararlar.
Durum: **Tasarım aşaması — kod yazılmadı.** Son güncelleme: 2026-09-24

---

## 1. Genel Mimari

### Uygulama dağılımı (karar 2026-09-25)

| Uygulama | Kim | Nasıl dağıtılır |
|---|---|---|
| **Müşteri** | Müşteriler | **afrogida.com.tr** üzerinde web sitesi olarak (şu anki `mobile/` projesi, web derlemesi). Eski web sitesinin yerine geçer. |
| **Sorumlu** | Pazar sorumlusu | Ayrı uygulama |
| **Tedarikçi + Kurye** | Esnaf ve kuryeler | **Tek uygulama** (giriş yapan rolün ekranları açılır) |
| **Admin** | Sadece sistem sahibi | Ayrı uygulama; indirilebilir değil, sahibinin cihazlarına USB ile kurulur |

Sıra: önce müşteri tarafındaki eksikler tamamlanır, ardından afrogida.com.tr'ye kurulur.

- Uygulamalar: **Müşteri**, **Tedarikçi**, **Kurye**, **Sorumlu**, **Admin** (ayrı ayrı).
- Uygulamalar birbiriyle **doğrudan konuşmaz**; hepsi merkezi backend ile konuşur. Yetki kontrolü **her istekte sunucuda** yapılır (uygulamanın ayrı olması tek başına güvenlik değildir).
- Tüm trafik TLS ile şifreli. Hassas alanlar (telefon, adres vb.) veritabanında da şifreli saklanabilir.
- Kart bilgisi hiçbir zaman sistemde saklanmaz.
- Rol/yetki yapısı esnek kurulacak: ileride yeni rol (muhasebe, destek personeli) eklemek kod yeniden yazmadan yapılabilmeli.

## 2. Admin

- Tek admin: sistem sahibi. Başka kimse erişemez.
- ~~Admin ayrı bir web paneli olacak~~ → **Güncel karar (2026-09-25): Admin tek, ayrı bir UYGULAMA.** Hiçbir yerden indirilemez (mağazada da web'de de yok); sistem sahibi kendi cihazlarına **USB bellekle elle kurar**. Çok katmanlı güvenlik önlemleri olacak (bkz. aşağıdaki maddeler).
- Giriş: kullanıcı adı + şifre + ikinci doğrulama. Hedef: authenticator uygulaması veya donanım anahtarı ana yöntem, SMS yedek. Tek kullanımlık **yedek kodlar** verilecek (telefon kaybı için).
- **Admin hesabı dışarıdan oluşturulamaz**; "admin oluştur" endpoint'i olmayacak, sadece sunucuda elle tanımlanır.
- Kritik işlemlerde (iade, IBAN değişikliği, kullanıcı silme) oturum açık olsa bile **yeniden doğrulama**.
- Yeni cihazdan girişte bildirim; hareketsizlikte (15–30 dk) otomatik çıkış.
- **Silinemeyen işlem kaydı (audit log)**: admin dahil kimse silemez.
- Admin **her şeyi görür ama her şeyi doğrudan değiştiremez**:
  - YAPAMAZ: sipariş durumunu elle "teslim edildi" yapmak, geçmiş sipariş kaydını silmek/değiştirmek, tamamlanmış siparişin tutarını değiştirmek, kurye konum/teslim saatini düzeltmek.
  - YAPABİLİR (gerekçe yazarak, loglanarak): iptal, iade başlatma, kurye yeniden atama, not/şikayet kaydı ekleme.
  - Düzeltmeler eski kaydı silmez; üstüne "düzeltme" kaydı eklenir.
- Admin **sadece izler**; başka kullanıcının yerine geçip işlem yapma (impersonation) **olmayacak**.
- Muhasebe/destek için sınırlı yetkili hesap: **ileride**, şimdi kurulmayacak.

### Uygulama (2026-09-28) — `yonetim/`
- Sıfırdan Expo uygulaması. Şimdilik **Windows**'ta yerel başlatıcıyla
  (`yonetim/baslat.ps1`, sadece 127.0.0.1), MacBook alınınca **iPhone / iPad /
  Mac**'e Ad Hoc kurulum (Apple Developer hesabı, cihaz UDID kaydı; Windows'ta
  artık kullanılmayacak).
- İkinci doğrulama: **authenticator (TOTP)** — kullanıcı "hangisi daha güvenliyse"
  dedi. SMS sadece ilk giriş ve yedek; 8 tek kullanımlık yedek kod.
  Sırlar ayrı `admin_totp` koleksiyonunda şifreli; uygulamadan sıfırlanamaz.
- Yönetici hesabı: `infra/admin-olustur.ps1` (tek yönetici; şifre sohbete düşmez).
- Henüz yok (sonraki adımlar): kritik işlemlerde yeniden doğrulama, görsel
  yükleme, kâr kademe tablosu, görevlendirme (sorumlu→pazar→tarih), iade kararı,
  tedarikçi ödemeleri, kuponlar ekranı.

## 3. Pazar / Tedarikçi / Sorumlu Yapısı

- Model: semt pazarları. Her gün farklı yerde farklı pazar kurulur.
- **Her pazarın o gün tek sorumlusu** var. Bir sorumlu farklı günlerde farklı pazarları yönetir.
- Bir tedarikçi (esnaf) birden fazla pazarda bulunabilir (örn. Tedarikçi C → Pazar 1 ve Pazar 3).
- Ürünler: meyve, sebze, yeşillik vb. taze gıda.
- **Yetki kişiye değil göreve bağlı**: Admin "Görevlendirme" yapar → `Sorumlu X → Pazar Y → Tarih Z`. Sorumlu sadece o gün, sadece o pazarı ve o pazardaki tedarikçileri görür; gün bitince yetki kendiliğinden kapanır.
- Tedarikçi de sadece o gün katıldığı pazarın siparişlerini alır.
- Şimdilik **tek sorumlu** var; sistem çok sorumluyu destekleyecek şekilde kurulacak. Hedef şema (schema_v2): aynı gün farklı pazarlarda farklı sorumlular (örn. Pazartesi: Beşevler → Ali, Ataevler → Hasan).
- **Kuryeler de pazar + güne göre atanır** (örn. Pazartesi Beşevler: K1, K2, K6). Atamayı admin yapar.
- Sorumlu o gün görevli olduğu pazarda: **o pazarın tedarikçilerini** ve **admin'in o pazara atadığı kuryeleri** yönetir. Başka pazarın kuryesi/tedarikçisi görünmez.
- Sorumlu gelemezse admin **kendine bir günlük sorumlu görevi atar** (admin hesabıyla pazar işlemi yapılmaz).
- Görevlendirme: **sabit haftalık program** (örn. her salı Pazar 1) sistem tarafından otomatik uygulanır; admin tek tek günleri elle değiştirebilir.
- Sorumlu **sadece kendi yönettiği geçmiş günleri, salt okunur** görebilir.
- Sorumlu müşterinin **telefon ve adresini görmez**; sadece sipariş no, müşteri adı ve ürünleri görür. Müşteriye ulaşması gerekirse uygulama içinden numarayı görmeden arama/mesaj. Telefon + adres sadece kuryede, teslimat sırasında.

### Sorumlunun görevleri
- Siparişleri tedarikçilere dağıtır.
- Sipariş durumlarını günceller.
- Paketleri kuryeye teslim eder.
- İade gereken ürünler için **ürün bazında** talep açar, kanıt (fotoğraf) ekler, admine iletir.
- İade kararını **admin** verir: iade / kupon / ret.

## 3.1 Tedarikçi

- Tedarikçi = pazar esnafı (meyveci, sebzeci vb.). Kendi **ürün paneli** var.
- Tedarikçi ürününde şunları yönetir: **fiyat, görsel, kategori ve çeşit** (Sebze → domates, salatalık, kabak, patlıcan, biber...).
- **Fiyat her pazarda aynı** (tedarikçinin tek fiyat listesi). Tedarikçi fiyatını güncelleyebilir → onaya gider.

### Değişiklik onayı (sorumlu)
- Tedarikçi ürün ekler/değiştirir → "Kaydet" → **değişiklik raporu** oluşur → **sorumlu onaylar**. Sorun olursa sorumlu tezgaha gidip tedarikçiyle görüşür.
- Onay **ürün ürün** yapılır (5 değişiklikten 4'ü onaylanıp 1'i reddedilebilir). Ret gerekçesi tedarikçiye görünür.
- Onay bekleyen değişiklik yayını bozmaz: onaylanana kadar müşteri **eski hali** görür.
- Rapor formatı: "Domates: 30 TL → 35 TL", "Yeni ürün: Çarliston biber, 40 TL, görsel ekli".
- **Görseller de onaya tabi.**
- Her onay/ret kim + ne zaman ile loglanır.
- **İstisna — "Tükendi"**: tedarikçi onaysız, anında işaretleyebilir (ürünü satıştan kaldırmak risksiz).

### Ürün seçenekleri (Boyut, Şekil vb.)
- Seçenek grupları + seçenekler + ek fiyatları **sadece sorumlu** tanımlar; tedarikçi dokunamaz.
- Mevcut arayüz: grup (örn. "Boyut") → seçenekler ("Büyük +10", "Orta +10", "Küçük +10", "İstemiyorum +0"). Müşteri ekranında radyo buton olarak görünür.
- **Ek fiyat kilo başına eklenir**: ürün 50 TL/kg + seçim farkı 10 TL → 60 TL/kg, miktar ile çarpılır.
  - Örnek: Dolma biber 100 TL/kg, 0,5 kg, Büyük (+10) → 110 × 0,5 = 55 TL.
  - Birden fazla grupta ek fiyatlı seçim yapılırsa farklar toplanır (Büyük +10, 4 Burun +10 → 120 TL/kg). *(varsayım — teyit edilecek)*

### Fiyat güvenliği (teknik kural)
- Sepet/sipariş tutarı **her zaman sunucuda yeniden hesaplanır**; uygulamanın gönderdiği tutara asla güvenilmez.
- Siparişteki fiyat, sipariş anında **sabitlenir** (sonradan fiyat değişse de sipariş etkilenmez).

### Siparişin tedarikçiye iletilmesi (mevcut sistem)
- Sipariş detayında ürünler **tedarikçi listelerine** göre gruplanır (örn. "Afro Sebze Listesi"). Bir siparişte 3–4 tedarikçinin listesi olabilir.
- Her listenin kendi **"Paylaş"** butonu var → WhatsApp ile tedarikçiye gönderilir. Tedarikçi mesajla "hazırladık" der.
- **Paylaşılan metin sistem tarafından üretilir ve en az bilgiyi içerir**: sipariş no, ürün, miktar, seçenekler. Müşteri adı/telefon/adres ve platform satış fiyatı **asla** paylaşım metnine girmez. (Claude önerisi — WhatsApp sistem dışında olduğu için.)
- **Tartıda fazla miktar**: önemli değil, müşteriden ek ücret alınmaz. Tedarikçi ödemesi sipariş edilen miktar üzerinden.

### Fiyat ve para yapısı
- **Komisyon yok.** Her üründe iki fiyat var:
  - **Tedarikçi fiyatı (alış)**: tedarikçinin girdiği fiyat (örn. 50 TL). Onaya tabi.
  - **Satış fiyatı**: müşterinin gördüğü fiyat (örn. 80 TL). Fark platformun (admin) kazancı.
- **Seçenek ek ücretleri** (Boyut/Şekil farkı) tamamen platforma gelir, tedarikçiye gitmez.
- **Tedarikçi** sadece kendi fiyatını ve kendi fiyatı üzerinden kazancını görür. **Satış fiyatını ve platform marjını göremez** (sunucuda alan bazlı yetki). Müşteri de alış fiyatını asla göremez.
- Tedarikçiye ödeme **her akşam** yapılır; tedarikçi günlük kazanç raporunu uygulamada görür.

### Satış fiyatı hesaplama — kademeli kâr tablosu
- Satış fiyatı = tedarikçi fiyatı + **fiyat aralığına göre sabit kâr tutarı**. Tedarikçi fiyatı onaylandığında satış fiyatı otomatik hesaplanır ve yürürlüğe girer.
- **Güncel tablo (karar 2026-09-29, 4 kademe 2026-10-01'de güncellendi; sistemde uygulandı — `backend/core/pricing.py`):**
  satış fiyatı elle girilmez, alış fiyatı değişince (yönetici veya tedarikçi) otomatik hesaplanır.

| Alış (tedarikçi) fiyatı | Platform kârı |
|---|---|
| 0 – 19,99 TL | +15 TL |
| 20 – 39,99 TL | +25 TL |
| 40 – 59,99 TL | +35 TL |
| 60 – 89,99 TL | +50 TL |
| 90 – 129,99 TL | +70 TL |
| 130 – 179,99 TL | +90 TL |
| 180 – 249,99 TL | +110 TL |
| 250 – 349,99 TL | +150 TL |
| 350 TL ve üstü | +200 TL |

- **Üst sınır yok** (2026-10-01): 350 TL ve üstü her alış fiyatına +200 TL.
- **Kâr profilleri** (2026-10-01): tablo artık Yönetim > Kâr Profilleri'nden düzenlenir. Düşük / Orta / Yüksek kazanç profilleri var, biri aktif. Yukarıdaki tablo "Orta" profilin başlangıç değeridir. "Uygula" profili aktif yapıp mevcut ürünleri yeniden fiyatlar (önce önizleme gösterilir).
- Alış fiyatı olmayan eski ürünlerde satış fiyatı elle kalır (geçiş dönemi).

### IBAN değişikliği (Claude önerisi)
- Tedarikçi/kurye IBAN değişikliği **admin onayına** gider; eski kayıtlı telefona bildirim gönderilir. Onaylanana kadar ödemeler eski IBAN'a yapılır.
- Kâr tablosu değişiklikleri audit log'a yazılır; tabloyu sadece admin görür/değiştirir.

### İade ve tedarikçi hak edişi
- Ayıplı ürün iadesi onaylanırsa ürünün **tedarikçi (alış) bedeli her zaman tedarikçinin hak edişinden kesilir.**
- Kesinti tedarikçinin raporunda "Sipariş #…, iade, −X TL" olarak görünür.

### Tedarikçi ödemesi
- **Nakit (sorumlu elden verir) veya IBAN'a havale (admin)** — ikisi de olabilir.
- Sistem akşam her tedarikçi için **hak ediş listesi** çıkarır (satılan − iade kesintileri).
- Her ödeme kaydında: yöntem (nakit/havale), tutar, ödeyen kişi, zaman.
- **Nakit ödemede** tedarikçi uygulamadan **"aldım" onayı** verir (sorumlunun nakit hesabı kanıtlı olur).
- Havalede admin "ödendi" işaretler.

### Hesap açma / başvuru
- Tedarikçi, sorumlu ve kurye **başvuru yapar → admin onaylarsa** hesap o rolle aktifleşir.
- Rol bazlı başvuru bilgisi (**sadece gerekli olanı iste — KVKK veri minimizasyonu**):

| Bilgi | Tedarikçi | Kurye | Sorumlu/personel |
|---|---|---|---|
| Ad soyad + telefon (SMS doğrulamalı) | Zorunlu | Zorunlu | Zorunlu |
| TC kimlik no | Zorunlu | Zorunlu | Sadece bordro/SGK gerekiyorsa |
| IBAN | Zorunlu | Zorunlu | İstenmez |
| Belge | Vergi levhası / esnaf belgesi | Ehliyet fotoğrafı (mümkünse SRC) | Gerekmez |

- **TC kimlik, IBAN ve belgeler şifreli saklanır; erişim sadece admin'de.** Görüntülemeler audit log'a yazılır.
- Başvuru anında **KVKK aydınlatma metni** gösterilir ve onay alınır (onaylanan metin sürümü + zaman kaydedilir).

### Sonra konuşulacak (ekranlarda görülen)
- **Gel-Al** (müşteri pazardan kendisi alıyor, 11:00–19:00): kuryesiz akış.
- **İndirimli / "Çok al az öde" / %10 rozeti**: kampanya sistemi — kim tanımlıyor?

## 3.2 Kurye

### İş alma
- Kurye, admin'in o gün o pazara atadığı kuryelerden biridir (bkz. bölüm 3).
- **Teslimatta olmayan kurye boştaki siparişlerden kendisi seçer.** Teslimatı tamamlayınca yeni sipariş seçebilir (aynı anda tek aktif teslimat).
- Teknik: iki kurye aynı siparişe aynı anda basarsa **sadece biri alır** (sunucu garanti eder), diğerine "başkası aldı" denir.

### Kurye neyi görür
- **Görür:** müşteri adresi + konumu, sipariş içeriği, tutar.
- **Görmez:** müşterinin telefon numarası. "Ara" butonu ile **maskeli numara** üzerinden arar; iki taraf da birbirinin numarasını görmez. *(Maskeli arama sistemi sonra kurulacak.)*
- **Canlı konum takibi yok** (şimdilik gerek yok). Sadece "Teslim Alınmadı" işaretlenirken o anki konum kaydedilir (bkz. bölüm 4).

### Ödeme yöntemleri
- **Online:** PayTR. Siparişin "ödendi" sayılmasına **sadece PayTR'nin sunucuya gönderdiği imzalı bildirim** karar verir; uygulamanın "ödedim" demesine güvenilmez.
- **Kapıda:** şimdilik **sadece nakit**. Kapıda kredi kartı ileride eklenecek.
- **Gel-Al (tezgahtan teslim):** müşteri pazardan kendisi alır; ödeme tezgahta **nakit veya kredi kartı** ile yapılabilir. *(Akış müşteri bölümünde netleşecek.)*

### Sepet ve ödeme kuralları (hepsi admin panelinden ayarlanır)
| Ayar | Örnek | Kural |
|---|---|---|
| **Minimum sepet tutarı** | panelden | Altındaki sepetle sipariş verilemez |
| **Ücretsiz teslimat tutarı** | 1000 TL | Üstündeki siparişlerde teslimat ücreti alınmaz |
| **Sadece-online eşiği** | 1000 TL | Üstündeki siparişlerde kapıda ödeme ve tezgahta ödeme **kapalı**, sadece online (PayTR) |
| **Kupon** | — | Kupon kullanılan siparişte **sadece online ödeme** geçerli |

- Tüm bu kurallar **sunucuda** uygulanır; uygulamada buton gizlemek yeterli sayılmaz.
- Eşikler (minimum sepet, ücretsiz teslimat, sadece-online) **kupon indirimi SONRASI** tutara bakar. Örn. 1050 TL sepet − 100 TL kupon = 950 TL → ücretsiz teslimat yok.
- Kısmi iade sonrası tutar ücretsiz teslimat eşiğinin altına düşerse **geriye dönük teslimat ücreti alınmaz** (hak sipariş anında kazanılmıştır).
- Kuponlu siparişte iade üst sınırı müşterinin **fiilen ödediği** tutardır (kupon indirimi nakit olarak iade edilmez) — bkz. bölüm 6.2.

### Nakit yönetimi
- Kurye topladığı nakdi **her siparişten sonra veya toplu** olarak sorumluya teslim edebilir.
- Sistem her kuryenin **üzerindeki nakdi anlık** gösterir.
- **Nakit limiti**: tutarı admin panelden belirler. Limit aşılınca kurye, nakdi teslim edene kadar **yeni kapıda ödemeli sipariş alamaz** (online ödenmişleri alabilir).
- Teslimde **iki taraflı onay**: kurye "teslim ettim" + sorumlu "teslim aldım".
- **Gün sonu kapanışı**: pazar kapanınca her kuryenin nakit bakiyesi sıfırlanmış olmalı; kapanmayan hesap admine uyarı olarak düşer.

### Kurye ücreti
- **Paket başına** ödenir; tutar **mesafeye göre kademeli** (şimdilik). Kademe tablosu admin panelinden (örn. 0–3 km 40 TL, 3–6 km 60 TL).
- Mesafe (pazar → teslimat adresi) **sipariş anında sunucuda hesaplanır ve sabitlenir**; kurye sonradan değiştiremez. Hesaplama yöntemi (yol mesafesi / kuş uçuşu) teknik tercih — geliştirme aşamasında netleşecek.
- **İade toplama görevi de bir paket sayılır** ve aynı mesafe kademesiyle ücretlendirilir.
- Topladığı nakitten **düşülmez**; kurye nakdin tamamını teslim eder, paket ücretleri akşam **ayrıca** ödenir.
- Kurye kendi günlük paket sayısını ve hak edişini uygulamada görür.

### İade toplama görevi
- Sadece **admin** açar (bkz. bölüm 6.1).
- Kurye ürünü müşteriden alır → **pazara, sorumluya** teslim eder → sorumlu "teslim aldım" der.

### Kurye ekranları
- Kurye ekranları **yeniden tasarlanacak**.

## 4. Sipariş Durumları

```
Sipariş Alındı → Hazırlanıyor → Hazır → Yolda → Teslim Edildi
                                              ↘ Teslim Alınmadı
(uygun aşamalarda) → İptal Edildi
```

- Durumlar **sadece ileri** gider, geri alınamaz, atlanamaz.
- Her değişiklik kim + ne zaman ile loglanır.
- **Yolda**: kurye paketi teslim aldığında.
- **Teslim Edildi**: sadece kurye, müşteriye SMS ile giden **teslimat kodunu** girince (SMS altyapısı mevcut).
- **Teslim Alınmadı**: kurye protokolü (**en az 2 arama + adreste 10 dk bekleme**) tamamlanmadan buton açılmaz; konum, saat, arama kayıtları otomatik loglanır.

## 5. İptal Kuralları

| Durum | Kim iptal edebilir | Para |
|---|---|---|
| Sipariş Alındı | Müşteri, sorumlu, admin | Tam iade (ürün + teslimat) |
| Hazırlanıyor | Sorumlu, admin (müşteri **iptal edemez**) | Duruma göre |
| Hazır / Yolda | Sadece admin (gerekçeyle) | İade yok (işletme hatası değilse) |
| Teslim Edildi | İptal yok — sadece ayıplı ürün iadesi | Sadece iade edilen ürün bedeli |
| Teslim Alınmadı | — | Ürün + teslimat iade edilmez (kurye/işletme hatası değilse; hataysa tam iade) |

## 6. İade Kuralları

### 6.0 Temel ilke: TÜM İADELER TAM MANUEL
- **Otomatik iade YOK.** Tutar, süre, ürün fark etmeksizin her iade talebi admine düşer; admin onaylar veya reddeder.
- Otomatik pencere, eşik, minimum tutar, iade oranı sınırı, günlük tavan, müşteri bayrak/kara liste otomasyonu **YOK** (kaldırıldı).
- Hızlı iade (2 saatlik pencere) **şimdilik yok**; ileride tekrar değerlendirilecek.
- Küçük tutarlı siparişler de iade edilebilir (alt sınır yok).

### 6.1 Akış
1. **Müşteri** uygulamadan iade talebi oluşturur: iade edilecek ürünleri seçer + fotoğraf ekler. Talep admine **bildirim** olarak gelir.
2. (Mevcut karar, korunuyor) **Sorumlu** da kendi tespit ettiği sorunlar için ürün bazında, kanıtlı iade talebi açıp admine iletebilir.
3. **Admin** her talebi manuel inceler → **onayla / reddet / kupon ver**. Onaylarsa **iade tutarını admin belirler** (kısmi veya tam).
4. **İade toplama görevi** (ürünü müşteriden geri alma) de manuel: admin gerekli görürse (ürün sağlam + değeri kurye masrafını karşılıyor) kuryeye görevi kendisi açar. Otomatik tetiklenmez. Detayı kurye konuşulurken netleşecek.

### 6.2 Tek sert kural (sistem zorunlu kılar)
- **Bir siparişe yapılan iadelerin toplamı, müşterinin o sipariş için ödediği toplam tutarı (ürün + teslimat) asla geçemez.**
  - Örnek: 100 TL ürün + 20 TL teslimat = 120 TL ödendiyse iade en fazla 120 TL.
  - Aynı siparişe birden fazla kısmi iade yapılırsa **toplamları** bu sınırı geçemez.
- Sistem bu sınırı aşan bir tutarın girilmesine izin vermez (admin dahil).

### 6.3 Teslimat ücreti
- Kısmi ayıplı iadede teslimat ücreti iade edilmez (teslimat yapılmış sayılır).
- **Tüm ürünler ayıplıysa teslimat ücreti de iade edilir.** Bu kural öncelikli (müşteri lehine). Avukata teyit ettirilecek.

### 6.4 Fotoğraf / kanıt
- **Sadece uygulama içi kamera**; galeriden yükleme kapalı.
- Kanıt fotoğrafları gönderildikten sonra **değiştirilemez/silinemez**; sadece admin ve ilgili sorumlu görür.
- Fotoğraflar cihazda sıkıştırılır (~200–300 KB), ayrı dosya deposunda saklanır.
- Admin inceleme ekranında (sadece bilgi amaçlı, otomatik karar yok): fotoğrafın çekim zamanı, teslimat zamanı, müşterinin geçmiş iade talepleri listesi gösterilir. Değerlendirme tamamen admin'in gözüyle yapılır.

## 7. Yasal Çerçeve (avukata onaylatılacak)

- Taze/bozulabilir gıda → Mesafeli Sözleşmeler Yönetmeliği gereği **cayma hakkı yok**.
- **Ayıplı üründe** para iadesi reddedilemez; işletme hatasında teslimat ücreti kesilemez.
- Sözleşmede yazmayan kesinti uygulanamaz; fahiş iptal bedeli konulamaz.
- Ödeme öncesi **ön bilgilendirme + mesafeli satış sözleşmesi onayı**. Sistem her sipariş için onaylanan **sözleşme sürümünü ve zamanını** saklar.
- Dayanaklar: 6502 sayılı TKHK, Mesafeli Sözleşmeler Yönetmeliği, ayıplı mal hükümleri.

---

## 8. Mevcut Müşteri Uygulaması (`mobile/`) — İnceleme (2026-09-24)

Karar: **müşteri uygulaması olduğu gibi kalacak**, ufak değişiklikler yapılacak. Sadece okundu, kod değiştirilmedi.

### Zaten var ve kararlarla uyumlu
- Pazar seçimi → ürünler → sepet → sipariş akışı; Gel-Al / Eve Servis; saat dilimi seçimi.
- Tutarlar sunucuda yeniden hesaplanıyor (`backend/services/orders.py::_prepare_order_payload`), manipülasyon denemesinde güvenlik alarmı.
- Seçenek fiyat farkı birim (kg) başına ekleniyor.
- Minimum sepet (Gel-Al / Eve Servis ayrı), ücretsiz teslimat eşiği, nakit/tezgah limiti (üstü sadece online) — pazar bazlı ayarlar.
- Mesafeli satış sözleşmesi onay kutusu; PayTR hosted ödeme sayfası (kart bilgisi uygulamadan geçmiyor).
- Siparişte müşteri telefonu maskeli, adres şifreli saklanıyor.
- Teslim almama (no-show) sistemi mevcut: tekrar edenlere "sadece online ödeme" kısıtı.
- Tedarikçi çift fiyat (`supplier_price` + `profit_margin_amount` → `sale_price`) altyapısı mevcut.

### Kararlarla UYUMSUZ (değişmesi gereken)
1. **Kupon sadece online** kuralı sunucuda yok: `_evaluate_coupon` `payment_method` alıyor ama kontrol etmiyor. Ayrıca "tezgahta kupon okutma" endpoint'i var.
2. **Eşikler kupon SONRASI tutara bakmalı**: sunucuda ücretsiz teslimat ve minimum sepet **kupon öncesi** `subtotal` ile hesaplanıyor.
3. **Sipariş durumları**: kodda `hazirlik_bekliyor` var, `teslim_alinmadi` yok.
4. **İade talebi**: müşteri tarafında sadece yazılı "Şikayet ve Öneri" var; fotoğraflı (uygulama içi kamera), ürün seçmeli iade talebi yok.
5. **Kademeli kâr tablosu** yok; şu an ürün başına sabit `profit_margin_amount`.

### GÜVENLİK BULGULARI (öncelikli)
- **[KRİTİK] Tedarikçi alış fiyatı ve kâr marjı herkese açık**: `GET /api/products` ve `GET /api/products/{id}` giriş gerektirmiyor ve `Product` modelini olduğu gibi döndürüyor → `supplier_price`, `sale_price`, `profit_margin_amount` alanları herkes tarafından görülebiliyor. Canlıdaki backend bu sürümse şu an açık.
  - **Yerelde düzeltildi (2026-09-24):** `routers/products.py` — iki public uçta `response_model_exclude` ile bu alanlar yanıttan çıkarıldı; OpenAPI şeması değişmedi. Test: `tests/test_smoke.py::test_public_products_hide_supplier_price_and_margin`. 81/81 test geçti. Commit `ff5463d` — **push + deploy bekliyor.**
- **[YÜKSEK] Tedarikçi kendi ürünlerinde satış fiyatını ve kâr marjını görüyor**: `/api/admin/products` (tedarikçi rolüyle) ve `PUT /api/admin/products/{id}` yanıtı `sale_price` + `profit_margin_amount` döndürüyor; eski uygulamanın tedarikçi formu da satış fiyatını gösteriyor. Karar (bölüm 3.1) ile çelişiyor.
  - **Karar (2026-09-24): tedarikçi sadece kendi fiyatını (`supplier_price`) görür.** Yerelde düzeltildi: `/admin/products` GET/POST/PUT tedarikçiye `sale_price`, `profit_margin_amount`, `price`, `gel_al_price`, `eve_servis_price` döndürmüyor; tedarikçi bu müşteri fiyatı alanlarını gönderse bile yok sayılıyor (önceden saha tedarikçi ekranı `price` göndererek müşteri fiyatını marjı atlayıp doğrudan değiştirebiliyordu). Tedarikçinin eklediği yeni üründe marj 0 başlar (satış = alış) — admin marjı belirler. Aynı fırsatta düzeltilen iki eski hata: fiyatsız kayıt (stok vb.) günlük fiyat kilidini siliyordu; kilit kontrolü naive/aware tarih karşılaştırmasında 500 veriyordu. Saha tedarikçi ekranı artık `supplier_price` okuyup gönderiyor. Test: `tests/test_supplier_prices.py`.
  - Saha uygulamasında **sorumlu** da alış/satış/kâr görüyor (`saha/src/app/sorumlu/tedarikciler.tsx`) — sorumlunun marjı görüp görmemesi henüz karara bağlanmadı.
- **[ORTA] Mobil uygulama ekranda eski fiyatı gösterebilir**: `mobile/src/lib/products.ts` önce `gel_al_price`'ı kullanıyor, sunucu ise `price` üzerinden tahsil ediyor. Tedarikçi fiyat değiştirince `price` güncelleniyor, `gel_al_price` güncellenmiyor → ekrandaki fiyat ile alınan tutar farklı olabilir.
  - **Yerelde düzeltildi (2026-09-24, `ab0908a`):** mobil artık sunucuyla aynı sırada önce `price`'ı gösteriyor.
- **[YÜKSEK] Mobil uygulama siparişte `market_id` göndermiyor** (`mobile/src/lib/orders.ts::createOrder`). Sunucu pazarı bulamayınca pazar ayarlarını varsayılan (kapalı/0) kabul ediyor → bu uygulamadan verilen siparişlerde **teslimat ücreti, minimum sepet, nakit limiti, saat kısıtları uygulanmıyor**. Ayrıca uygulama ekranda genel `/settings` değerlerini gösteriyor, sunucu pazar ayarlarını kullanıyor → ekranda görülen ile alınan tutar farklı olabilir.
  - **Mobilde düzeltildi (2026-09-24, `ab0908a`):** sipariş `market_id` ile gidiyor; pazar ve sepet ekranları pazarın ayarlarını gösteriyor. Ayrıca kapıda nakit kapalı pazarda Eve Servis + `pay_at_counter` artık sunucuda reddediliyor (mobil "Kapıda Ödeme" için bunu gönderiyordu, kural atlanıyordu).
  - **AÇIK — karar bekliyor:** sunucu `market_id`'yi hâlâ zorunlu tutmuyor; bu alanı göndermeyen bir istemci pazar kurallarını atlayabilir. Canlıdaki eski web paketi `market_id` hiç göndermediği için zorunlu yapmak eski siteden siparişi kırar → eski web kapatılınca (veya mobil yayına alınınca) zorunlu yapılmalı.
- **[YÜKSEK] Müşteri siparişinde tedarikçi alış fiyatı görünüyordu**: `GET /api/orders` (ve sipariş oluşturma / online ödeme başlatma yanıtları) her ürün satırında `supplier_price_snapshot` (alış fiyatı) ve `supplier_group_snapshot` (tedarikçi adı) döndürüyordu → müşteri platform marjını hesaplayabiliyordu (örn. satış 50 ₺, alış 35 ₺). Karar (bölüm 3.1) ile çelişiyor.
  - **Yerelde düzeltildi (2026-09-25, `d034fd3`):** `services/orders.py::_customer_order_view` bu iki alanı satırlardan çıkarıyor; DB'de kalıyor (tedarikçi hak edişi bunlarla hesaplanıyor). Test: `tests/test_orders.py::test_customer_never_sees_supplier_price`. 89/89 test geçti. **Canlıya alındı (2026-09-25, deploy: sağlık + API sözleşmesi OK).**
- **[DÜŞÜK] `GET /api/coupons`** kupon kaydını tüm alanlarıyla döndürüyor; kişiye özel kuponlarda `assigned_user_ids` (diğer kullanıcıların id'leri) görünüyor.

---

## Açık Sorular (kullanıcıdan cevap bekleniyor)

1. Tüm ürünler ayıplıysa teslimat ücreti iadesi — avukata sorulacak.
2. Hızlı iade penceresi — ileride tekrar değerlendirilecek.
3. İade toplama görevinin detayı — kurye rolü konuşulurken.

## Henüz konuşulmayan roller
- Müşteri: Gel-Al akışı, kampanyalar (İndirimli, Çok al az öde), kupon kuralları, nakit ödemeli siparişte iadenin müşteriye nasıl yapılacağı.
- Müşteri
- Ödeme akışı (kart/kapıda, tedarikçi ve kurye hak edişleri)
- ~~Hangi uygulama mobil, hangisi web~~ → kararlaştırıldı, bkz. bölüm 1 "Uygulama dağılımı".
