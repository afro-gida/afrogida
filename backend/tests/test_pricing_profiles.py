"""Yönetim > Kâr Profilleri: Düşük / Orta / Yüksek tablolar, kaydetme
denetimi, önizleme ve uygulama (mevcut ürünleri yeniden fiyatlama)."""
import uuid

import pytest

import core.pricing as pricing
from tests.test_supplier_prices import _seed_product, _supplier

URL = "/api/admin/pricing"


def _reset_cache():
    # Varsayılan (Orta) tablo; bir sonraki istek veritabanından yeniden okur
    pricing._active_tiers = pricing.DEFAULT_PROFILES[pricing.DEFAULT_ACTIVE]["tiers"]
    pricing._active_loaded_at = 0.0


@pytest.fixture(autouse=True)
def _reset_pricing(db):
    db.pricing_profiles.delete_many({})
    _reset_cache()
    yield
    # diğer testler varsayılan (Orta) tabloyu bekler
    db.pricing_profiles.delete_many({})
    _reset_cache()


def _tiers(*pairs):
    return [{"from": f, "profit": p} for f, p in pairs]


def test_defaults_and_validation(client, make_user):
    _, admin = make_user(role="yonetici")
    st = client.get(URL, headers=admin).json()
    assert st["active"] == "orta" and st["order"] == ["dusuk", "orta", "yuksek"]
    assert [t["profit"] for t in st["profiles"]["orta"]["tiers"]] == [15, 25, 35, 50, 70, 90, 110, 150, 200]
    put = lambda t: client.put(f"{URL}/profiles/dusuk", json={"tiers": t}, headers=admin)  # noqa: E731
    assert put(_tiers((10, 5))).status_code == 400            # 0'dan başlamalı
    assert put(_tiers((0, 5), (0, 9))).status_code == 400     # aynı başlangıç
    assert put(_tiers((0, -1))).status_code == 400            # negatif
    assert put([]).status_code == 400
    r = put(_tiers((100, 30), (0, 10)))                        # sırasız gelse de sıralanır
    assert r.status_code == 200
    assert r.json()["profiles"]["dusuk"]["tiers"] == _tiers((0, 10), (100, 30))
    assert client.put(f"{URL}/profiles/yokboyle", json={"tiers": _tiers((0, 1))}, headers=admin).status_code == 404


def test_preview_and_apply_reprices_products(client, make_user, db):
    _, admin = make_user(role="yonetici")
    sg = f"TestSup{uuid.uuid4().hex[:6]}"
    pid = _seed_product(db, sg, supplier_price=50.0, price=85.0, sale_price=85.0, gel_al_price=85.0, profit_margin_amount=35.0)
    # yüksek: 0+ -> 40 kâr
    assert client.put(f"{URL}/profiles/yuksek", json={"name": "Yüksek", "tiers": _tiers((0, 40))}, headers=admin).status_code == 200
    pv = client.post(f"{URL}/preview", json={"profile_id": "yuksek"}, headers=admin).json()
    ex = next(e for e in pv["examples"] if e["name"] == "Test Domates" and e["supplier_price"] == 50)
    assert ex["new_price"] == 90 and pv["changed"] >= 1
    assert db.products.find_one({"id": pid})["price"] == 85  # önizleme bir şey değiştirmez

    r = client.post(f"{URL}/apply", json={"profile_id": "yuksek"}, headers=admin)
    assert r.status_code == 200 and r.json()["active"] == "yuksek"
    doc = db.products.find_one({"id": pid})
    assert (doc["price"], doc["sale_price"], doc["profit_margin_amount"]) == (90, 90, 40)

    # aktif profil yeni fiyatlamada da kullanılır
    _, sup = _supplier(make_user, sg)
    r = client.post("/api/admin/products", headers=sup, json={"name": "Yeni Biber", "category": "Biber", "unit": "Kg", "supplier_price": 100})
    assert r.status_code == 200, r.text
    assert db.products.find_one({"id": r.json()["id"]})["price"] == 140


def test_pricing_admin_only(client, make_user):
    for role in ("pazar_sorumlusu", "member", "esnaf"):
        _, h = make_user(role=role)
        assert client.get(URL, headers=h).status_code in (401, 403)
        assert client.post(f"{URL}/apply", json={"profile_id": "yuksek"}, headers=h).status_code in (401, 403)
