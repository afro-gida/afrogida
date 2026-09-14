# Değişiklik / özellik istekleri — Afro Gıda

Yapı sabitlendikten (Faz B) ve bug turu bittikten sonra sırayla işlenecek.
Frontend'e dokunan değişiklikler ilgili uygulamanın yeniden yazımıyla birlikte
yapılabilir.

**Nasıl eklenir:** Hangi sistem (tedarikçi / admin / kurye / müşteri), ne
isteniyor, neden.

## Tedarikçi sistemi

| # | İstek | Neden | Durum |
|---|---|---|---|
| 1 | **Tek tedarikçi hesabı, çoklu pazar/tezgah.** Bir tedarikçi hesabı ürünlerini kategori bazlı ekler (sebze, meyve, yeşillik, patates, soğan vb.) ve bu ürünler **aynı gün birden fazla pazarda** satışta olabilir — tek pazara bağlı kalmıyor. | Kullanıcı bir kişiyi işe alıp başka bir pazarda görevlendirebilmek istiyor; aynı işletme/tedarikçi aynı gün birden fazla pazarda bulunabilsin. Detaylar (hesap altında alt-kullanıcı/personel var mı, ürün-pazar eşlemesi nasıl yönetilecek) sonra konuşulacak — kullanıcının notu (2026-09-14): "tek hesap tüm tezgahlarla olacak... ilerleyen zamanlarda tedarikçi sisteminde güncellemeler olcak, onu konuşuruz sonra." | açık — tasarım netleşmedi, backend'in mevcut `supplier_group` + `catalog_config.supplier_markets` yapısı muhtemelen buna göre gözden geçirilecek |
| _örnek_ | Tedarikçi kendi ürününe stok fotoğrafı ekleyebilsin | ... | açık |

## Admin / yönetici sistemi

| # | İstek | Neden | Durum |
|---|---|---|---|

## Kurye sistemi

| # | İstek | Neden | Durum |
|---|---|---|---|

## Müşteri uygulaması

| # | İstek | Neden | Durum |
|---|---|---|---|
