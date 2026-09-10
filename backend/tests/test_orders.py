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
