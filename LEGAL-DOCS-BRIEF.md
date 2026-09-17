# Sözleşme / Yasal Belge Sistemi — genel yapı (ileride tamamlanacak)

**Durum (2026-09-18):** Kullanıcı bu dökümanı, sistemin tamamını anlatmak için
paylaştı ama açıkça ertelendi: *"log sistemini uygulama tamamlanınca
tamamlarız sözleşme sistemini de uygulama bitince gözden geçiririz."* Yani bu
döküman **şimdi uygulanmayacak** — mobil/admin uygulamaları bitince buraya
dönülecek. Şu an sadece admin panelinde `SupplierContract.tsx` (tedarikçi
sözleşmesi, tek belge) ve `Logs.tsx` (10 log sekmesi, salt-okunur) var.

Eski sistemin (canlı site) gerçek ekran görüntüleri:
`docs/legal-docs-reference/admin-legal-list-1.png`, `-2.png`, `-3.png` —
basit kart listesi: başlık, sürüm, "Aktif belge", dosya yolu, "PDF Yükle"
düğmesi + harici link ikonu. Aynı tasarım deseni tekrarlanabilir.

## 1) Kayıt (üye olma) sırasında

| Onay | Backend parametresi |
|---|---|
| Üyelik Sözleşmesi + KVKK kabul | `terms_accepted`, `terms_version`, `kvkk_notice_version`, `membership_agreement_accepted`/`version` |
| Kampanya/bildirim açık rıza | `marketing_consent` |

## 2) Sipariş tamamlama (checkout) sırasında

| Sipariş türü | Gösterilen sözleşme | PDF dosyası |
|---|---|---|
| Gel-Al | Gel-Al Mesafeli Satış Sözleşmesi | `/legal/afrogida_03_gel_al_sozlesmesi.pdf` |
| Eve Servis | Eve Servis Mesafeli Satış Sözleşmesi | `/legal/afrogida_04_eve_servis_sozlesmesi_v2.pdf` |

Checkbox işaretlenmeden sipariş oluşturulamaz. Onay bilgisi siparişle
gönderilir: `legal_accepted`, `legal_document_type`, `agreements_versions`.

## 3) Admin paneli → "Gizlilik ve Sözleşmeler" (`/admin/legal-documents`) — henüz yok

Yönetici 6 belgeyi yönetir (PDF yükle, sürüm güncelle):

| # | Belge | `document_code` | PDF dosyası | Sürüm |
|---|---|---|---|---|
| 1 | KVKK Aydınlatma Metni | `kvkk` | afrogida_01_kvkk_gizlilik_v2.pdf | 2026-07-v2 |
| 2 | Gizlilik Politikası | `privacy` | afrogida_01_kvkk_gizlilik_v2.pdf | 2026-07-v2 |
| 3 | Üyelik Sözleşmesi | `membership` | afrogida_02_uyelik_sozlesmesi.pdf | 2026-07-v1 |
| 4 | İade & Şikayet Sözleşmesi | `refundComplaintPolicy` | afrogida_02_uyelik_sozlesmesi.pdf | 2026-07-v1 |
| 5 | Kupon Kullanım Koşulları | `couponTerms` | afrogida_02_uyelik_sozlesmesi.pdf | 2026-07-v1 |
| 6 | Eve Servis Mesafeli Satış Sözleşmesi | `homeDeliveryTerms` | afrogida_04_eve_servis_sozlesmesi_v2.pdf | 2026-07-v2 |

Ayrıca overlay ile eklenen 7. kart: **Tedarikçi Sözleşmesi** (bu artık ayrı
bir sayfa: `SupplierContract.tsx`, `/api/admin/supplier-contract`).

API'ler (zaten backend'de hazır — bkz. `backend/routers/legal.py`):
- `GET /api/admin/legal-docs` → belge listesi
- `PUT /api/admin/legal-docs/{id}` → güncelle
- `POST /api/admin/legal-docs` → yeni belge
- `POST /api/admin/upload-pdf` → PDF yükle (zaten `SupplierContract.tsx`'te kullanılıyor)

## 4) Tedarikçi (esnaf) sözleşme kapısı — admin tarafı YAPILDI

- `GET /api/supplier/contract-status` → esnaf onaylamış mı?
- Onaylamadan panele giremez (backend 403 de döner, sadece arayüz değil)
- `POST /api/admin/supplier-contract` → yeni PDF + sürüm yayınla (✅ `SupplierContract.tsx`)
- `GET /api/admin/contract-consents` (backend/routers/suppliers.py) → kim ne
  zaman onayladı logları (`consent_logs` koleksiyonu) — backend hazır, admin
  arayüzünde henüz yok. İleride Logs.tsx'e "Tedarikçi Onayları" sekmesi
  olarak eklenebilir (diğer 10 sekmeyle aynı desen).

## 5) Müşteri tarafı okuma sayfaları (mobile/ — henüz yok)

| Route | İçerik |
|---|---|
| `/kvkk` | KVKK Aydınlatma Metni |
| `/privacy` | Gizlilik Politikası |
| `/terms` | Üyelik Sözleşmesi |
| `/marketing` | Kampanya/Bildirim Açık Rıza + Kupon Koşulları |
| `/support` | İade & Şikayet Sözleşmesi |
| `/gel-al-terms` | Gel-Al Mesafeli Satış + Ön Bilgilendirme + Hazırlık Talebi |
| `/distance-sales` | Eve Servis Mesafeli Satış + Ön Bilgilendirme |
| `/pre-info` | Ön Bilgilendirme Formu |
| `/legal-documents` | Tüm belgeleri listeleyen ana sayfa |

## Yapılacaklar (uygulama bitince)

1. Admin: `/admin/legal-documents` sayfası — `SupplierContract.tsx` ile
   birebir aynı desen, 6 belge için tekrarlanmış hali (tek bir liste,
   her satırda kendi upload formu).
2. Mobile: yukarıdaki okuma sayfaları + kayıt sırasında KVKK/üyelik
   checkbox'ları + checkout sırasında Gel-Al/Eve Servis sözleşme onayı.
3. Logs.tsx'e "Tedarikçi Onayları" (`/admin/contract-consents`) sekmesi.
