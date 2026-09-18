# Bug listesi — Afro Gıda

Modülerizasyon (Faz B) bittikten sonra sırayla işlenecek. Kritik/güvenlik
buglar beklemez — onları hemen ele alırız ve buraya "ÇÖZÜLDÜ" olarak işaretleriz.

**Nasıl eklenir:** Her madde için — hangi rol/ekran, ne bekliyordun, ne oldu,
(varsa) nasıl tekrarlanır.

| # | Rol / Ekran | Beklenen | Olan | Durum | Not |
|---|---|---|---|---|---|
| _örnek_ | Müşteri / Sepet | Kupon uygulanınca toplam düşmeli | Toplam değişmiyor, sayfa yenileyince düzeliyor | açık | — |
| 1 | Müşteri / Pazar ürün listesi | Pazara girince kategori bazlı tüm ürünler görünmeli | Neredeyse hiç ürün görünmüyor, sadece indirimli ürünler (ör. "Dolma Biber") görünüyor | **ÇÖZÜLDÜ** (2026-09-18) | Kök neden: `products.category`/`subcategory` alanları TÜM ürünlerde ters kaydedilmiş (category=ana kategori "Sebze", olması gereken alt/yaprak kategori "Domates"). Kod tarafı zaten doğru (category=alt/leaf, subcategory=ana kategori bekliyor). Kullanıcı canlıdaki 43 etkilenen ürünü otomatik düzeltme yerine TAMAMEN SİLMEYİ tercih etti ("ürünleri kaldır, gerekirse tekrardan yerleştiririz") — 2026-09-18'de `test_database` (canlı) üzerinde uygulandı: 43/43 ürün silindi, önce tam yedek alındı (bkz. bu oturumdaki scratchpad `prod_swapped_products_backup.json`). Yeniden eklenecek ürünler admin panelinden doğru kategori/alt kategoriyle (ProductEdit.tsx) elle girilmeli. |

<!-- Yeni bugları buraya ekle -->
