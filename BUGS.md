# Bug listesi — Afro Gıda

Modülerizasyon (Faz B) bittikten sonra sırayla işlenecek. Kritik/güvenlik
buglar beklemez — onları hemen ele alırız ve buraya "ÇÖZÜLDÜ" olarak işaretleriz.

**Nasıl eklenir:** Her madde için — hangi rol/ekran, ne bekliyordun, ne oldu,
(varsa) nasıl tekrarlanır.

| # | Rol / Ekran | Beklenen | Olan | Durum | Not |
|---|---|---|---|---|---|
| _örnek_ | Müşteri / Sepet | Kupon uygulanınca toplam düşmeli | Toplam değişmiyor, sayfa yenileyince düzeliyor | açık | — |
| 1 | Müşteri / Pazar ürün listesi | Pazara girince kategori bazlı tüm ürünler görünmeli | Neredeyse hiç ürün görünmüyor, sadece indirimli ürünler (ör. "Dolma Biber") görünüyor | **CANLIDA DA VAR, DÜZELTİLMEDİ** (2026-09-18) | Kök neden: `products.category`/`subcategory` alanları TÜM ürünlerde ters kaydedilmiş (category=ana kategori "Sebze", olması gereken alt/yaprak kategori "Domates" — müşteri uygulaması `p.category === alt_kategori` ile filtreliyor, hiç eşleşmiyor). Test ortamında (afrogida_devtest) 43 ürünün hepsi düzeltildi ve doğrulandı — kullanıcı canlıyı henüz düzeltmek istemedi, "diğer değişikliklerle birlikte topluca" uygulanacak. Düzeltme script'i: `category`/`subcategory` alanlarını `catalog_config.categories` listesiyle karşılaştırıp (hangisi ana kategori ise) iki alanı birbiriyle değiştir (bkz. bu oturumdaki `fix_category_swap.py` mantığı, backend/routers/products.py + admin/ProductsBySupplier.tsx'teki düzeltmeyle aynı yöne hizalı). |

<!-- Yeni bugları buraya ekle -->
