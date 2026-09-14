# Değişiklik / özellik istekleri — Afro Gıda

Yapı sabitlendikten (Faz B) ve bug turu bittikten sonra sırayla işlenecek.
Frontend'e dokunan değişiklikler ilgili uygulamanın yeniden yazımıyla birlikte
yapılabilir.

**Nasıl eklenir:** Hangi sistem (tedarikçi / admin / kurye / müşteri), ne
isteniyor, neden.

## Tedarikçi sistemi

| # | İstek | Neden | Durum |
|---|---|---|---|
| 1 | **Tek tedarikçi hesabı, çoklu pazar/tezgah — ama her pazarda TEK tedarikçi.** Bir tedarikçi hesabı ürünlerini kategori bazlı ekler (sebze, meyve, yeşillik, patates, soğan vb.) ve bu ürünler **aynı gün birden fazla pazarda** satışta olabilir (bir tedarikçi → birden fazla pazar). Ama her pazarın kendisi yalnızca TEK bir tedarikçiye ait olacak (bir pazar → yalnızca bir tedarikçi; pazarlar tedarikçiler arasında paylaşılmıyor). | Kullanıcı bir kişiyi işe alıp başka bir pazarda görevlendirebilmek istiyor; aynı işletme/tedarikçi aynı gün birden fazla pazarda bulunabilsin, ama karışıklık olmasın diye bir pazarda iki farklı tedarikçi aynı anda olmayacak. Kullanıcının notu (2026-09-14): "tek hesap tüm tezgahlarla olacak... tek pazar tek tedarikçi olcak sistemde... ilerleyen zamanlarda tedarikçi sisteminde güncellemeler olcak, onu konuşuruz sonra." | açık — tasarım netleşmedi. Backend'in mevcut `catalog_config.supplier_markets` yapısı (tedarikçi adı → pazar listesi) buna zaten yakın; eklenmesi gereken kural: bir pazar adı aynı anda yalnızca bir tedarikçinin listesinde olabilir (validasyon) |
| _örnek_ | Tedarikçi kendi ürününe stok fotoğrafı ekleyebilsin | ... | açık |

## Admin / yönetici sistemi

| # | İstek | Neden | Durum |
|---|---|---|---|
| 1 | **Eve Servis ayarlarını pazar bazlı yap.** Şu an teslimat saati, minimum sepet tutarı, pazar saati, gel-al saati TEK bir global ayar (`global_settings` — `market_hours`, `pickup_order_hours`, `delivery_order_hours`, `min_pickup_amount`, `min_delivery_amount`) — hepsi tüm pazarlar için aynı değeri paylaşıyor. Kullanıcı bunun her pazarda AYRI ayarlanabilmesini istiyor. | Farklı pazarların farklı çalışma saatleri/minimum tutarları olabilir. | **kısmen tamam (2026-09-15):** `Market`/`MarketInput` modeline 11 yeni alan eklendi (eve_servis_min_tutar, gel_al_min_tutar, teslimat_ucreti, ucretsiz_teslimat_alt_limiti, nakit_tezgah_limit_enabled/maksimum_tutari, pazar_saati, gel_al_saati, eve_servis_saati, eve_servis_urun_gorunurlugu, kapida_nakit_odeme_enabled). `services/orders.py`'deki sipariş kabul mantığı (min tutar, teslimat ücreti/eşik, nakit limiti) artık pazar bazlı okuyor. **Açık kalanlar:** saat aralığı alanları (pazar_saati vb.) ve kapida_nakit_odeme_enabled henüz sadece SAKLANIYOR, gerçekten sipariş reddetmiyor/ödeme yöntemi kısıtlamıyor — bunun için kullanıcı onayı bekleniyor (yeni bir kısıtlayıcı davranış, mevcut olanı taşımak değil). Pazar bazlı "İndirimleri Sıfırla" ucu da henüz eklenmedi. |

## Kurye sistemi

| # | İstek | Neden | Durum |
|---|---|---|---|

## Müşteri uygulaması

| # | İstek | Neden | Durum |
|---|---|---|---|
