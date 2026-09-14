"""Sipariş hesaplama — SUNUCU tek doğruluk kaynağı, manipülasyon reddedilir."""
import pytest


@pytest.fixture
def product(db):
    """Seed edilmiş bir ürünü döndürür (startup() 'Salkım Domates' 24.90 ekler)."""
    p = db.products.find_one({"name": "Salkım Domates"})
    assert p, "seed ürünü bulunamadı"
    return p


def _order(client, headers, items, **extra):
    body = {"items": items, "delivery_type": "gel_al", "payment_method": "pay_at_counter"}
    body.update(extra)
    return client.post("/api/orders", json=body, headers=headers)


def test_order_uses_server_price(client, make_user, product):
    _, h = make_user()
    r = _order(client, h, [{"id": product["id"], "qty": 2}])
    assert r.status_code == 200, r.text
    order = r.json()["order"]
    assert order["amount"] == pytest.approx(product["price"] * 2)
    assert order["items"][0]["price"] == pytest.approx(product["price"])


def test_order_low_price_fresh_product_charged_server(client, make_user, product):
    """Ürün son 24 saatte güncellendiyse düşük fiyat = bayat sepet:
    sipariş geçer ama SUNUCU fiyatı tahsil edilir (manipülasyon değil)."""
    _, h = make_user()
    r = _order(client, h, [{"id": product["id"], "qty": 1, "price": 1.00}])
    assert r.status_code == 200
    assert r.json()["order"]["amount"] == pytest.approx(product["price"])


def test_order_low_price_stale_product_is_tampering(client, make_user, db, product):
    """Ürün uzun süredir değişmediyse düşük fiyat iddiası = manipülasyon -> 400."""
    from datetime import datetime, timezone, timedelta
    old = datetime.now(timezone.utc) - timedelta(days=40)
    db.products.update_one({"id": product["id"]},
                           {"$set": {"updated_at": old, "price_updated_at": old}})
    try:
        _, h = make_user()
        r = _order(client, h, [{"id": product["id"], "qty": 1, "price": 1.00}])
        assert r.status_code == 400
        assert "güvenlik" in r.text.lower() or "GV-01" in r.text
    finally:
        now = datetime.now(timezone.utc)
        db.products.update_one({"id": product["id"]},
                               {"$set": {"updated_at": now, "price_updated_at": now}})


def test_order_client_higher_price_still_charged_server(client, make_user, product):
    _, h = make_user()
    # daha yüksek iddia = bayat sepet, işlem geçer ama sunucu fiyatı tahsil edilir
    r = _order(client, h, [{"id": product["id"], "qty": 1, "price": 999.0}])
    assert r.status_code == 200
    assert r.json()["order"]["amount"] == pytest.approx(product["price"])


def test_order_rejects_excessive_qty(client, make_user, product):
    _, h = make_user()
    r = _order(client, h, [{"id": product["id"], "qty": 500}])
    assert r.status_code == 400


def test_order_rejects_unknown_product(client, make_user):
    _, h = make_user()
    r = _order(client, h, [{"id": "prod_does_not_exist", "qty": 1}])
    assert r.status_code == 400


def test_order_empty_cart(client, make_user):
    _, h = make_user()
    r = _order(client, h, [])
    assert r.status_code == 400


def test_order_requires_auth(client, product):
    r = client.post("/api/orders", json={"items": [{"id": product["id"], "qty": 1}]})
    assert r.status_code == 401


def test_order_inactive_product_blocked(client, make_user, db, product):
    _, h = make_user()
    db.products.update_one({"id": product["id"]}, {"$set": {"in_stock": False}})
    try:
        r = _order(client, h, [{"id": product["id"], "qty": 1}])
        assert r.status_code == 400
    finally:
        db.products.update_one({"id": product["id"]}, {"$set": {"in_stock": True}})


# ---------------- Pazar bazlı ayarlar (Market.gel_al_min_tutar vb.) ----------------
# Eve Servis/Gel-Al/ödeme ayarları artık global_settings'te DEĞİL, her pazarın
# kendi dokümanında (bkz. CHANGES.md, Admin sistemi #1). market_id gönderilmezse
# (yukarıdaki testler gibi) Market modelinin varsayılanları (hepsi 0/kapalı)
# kullanılır — bu yüzden eski testler hiç etkilenmedi.

@pytest.fixture
def market_with_limits(db):
    doc = {
        "id": "market_test_limits",
        "name": "Test Pazarı", "day": "Pazartesi",
        "active": True, "orders_enabled": True, "delivery_enabled": True,
        "active_eve_servis": True, "active_gel_al": True,
        "gel_al_min_tutar": 50.0,
        "eve_servis_min_tutar": 100.0,
        "teslimat_ucreti": 20.0,
        "ucretsiz_teslimat_alt_limiti": 200.0,
        "nakit_tezgah_limit_enabled": True,
        "nakit_tezgah_maksimum_tutari": 30.0,
    }
    db.markets.delete_one({"id": doc["id"]})
    db.markets.insert_one(doc)
    yield doc
    db.markets.delete_one({"id": doc["id"]})


def test_market_min_amount_gel_al_enforced(client, make_user, product, market_with_limits):
    _, h = make_user()
    # ürün fiyatı (24.90) < pazarın gel_al_min_tutar (50) -> reddedilir
    r = _order(client, h, [{"id": product["id"], "qty": 1}], market_id="market_test_limits")
    assert r.status_code == 400
    assert "minimum" in r.text.lower()


def test_market_min_amount_does_not_affect_other_markets(client, make_user, product, market_with_limits):
    """Aynı sepet, market_id verilmeden (veya farklı bir pazarla) hâlâ geçmeli —
    bir pazarın limiti başka pazarları/market_id'siz siparişleri etkilemiyor."""
    _, h = make_user()
    r = _order(client, h, [{"id": product["id"], "qty": 1}])  # market_id yok
    assert r.status_code == 200, r.text


def test_market_delivery_fee_and_free_threshold(client, make_user, product, market_with_limits):
    _, h = make_user()
    # subtotal (5 adet) pazarın eve_servis_min_tutar (100) şartını geçer ama
    # ücretsiz teslimat eşiğinin (200) altında kalır -> teslimat ücreti (20) eklenir
    qty = 5
    subtotal = product["price"] * qty
    assert 100 < subtotal < 200  # test varsayımını doğrula
    r = _order(client, h, [{"id": product["id"], "qty": qty}],
               market_id="market_test_limits", delivery_type="eve_servis", address="Test Mah. Test Sk. No:1",
               payment_method="online_card")
    assert r.status_code == 200, r.text
    order = r.json()["order"]
    assert order["delivery_fee"] == pytest.approx(20.0)
    assert order["amount"] == pytest.approx(subtotal + 20.0)


def test_market_cash_limit_enforced(client, make_user, db, product, market_with_limits):
    _, h = make_user()
    # 3 adet: pazarın gel_al_min_tutar'ını (50) geçer AMA nakit limitini (30) de aşar
    qty = 3
    subtotal = product["price"] * qty
    assert 50 < subtotal  # min tutarı geçiyor
    r = _order(client, h, [{"id": product["id"], "qty": qty}],
               market_id="market_test_limits", payment_method="pay_at_counter")
    assert r.status_code == 400
    assert "nakit" in r.text.lower() or "online" in r.text.lower()

    # aynı sepet market_id olmadan (limit yok) geçmeli
    r2 = _order(client, h, [{"id": product["id"], "qty": qty}])
    assert r2.status_code == 200, r2.text
