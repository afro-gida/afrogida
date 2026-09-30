"""Ürün Talepleri: tedarikçinin açtığı / güncellediği ürün, tedarikçinin
çalıştığı pazarın SORUMLUSUNUN onayına düşer (yönetici değil) —
routers/products.py + /api/pazar-sorumlusu/product-requests."""
import uuid

from tests.test_pazar_sorumlusu import _mk_market, _reset_catalog_cache
from tests.test_supplier_prices import _seed_product, _supplier

BASE = {"name": "Talep Biberi", "category": "Biber", "subcategory": "Sebze", "unit": "Kg"}
REQ = "/api/pazar-sorumlusu/product-requests"


def sorumlu_for(db, make_user, sg):
    """sg tedarikçisinin çalıştığı pazarın sorumlusu (oturum başlığı döner)."""
    mkt = _mk_market(db, f"Talep Pazarı {uuid.uuid4().hex[:6]}")
    db.catalog_config.update_one({}, {"$set": {f"supplier_markets.{sg}": [mkt["name"]]}}, upsert=True)
    _reset_catalog_cache()
    _, h = make_user(role="pazar_sorumlusu", managed_markets=[mkt["id"]])
    return h


def _new_request(client, sup):
    r = client.post("/api/admin/products", headers=sup, json={**BASE, "supplier_price": 40, "active": True})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_new_product_waits_for_sorumlu_approval(client, make_user, db):
    sg = f"TestSup{uuid.uuid4().hex[:6]}"
    _, sup = _supplier(make_user, sg)
    sor = sorumlu_for(db, make_user, sg)
    pid = _new_request(client, sup)

    # müşteri sipariş veremez / listede gizli (active False), sorumlunun listesinde var
    assert db.products.find_one({"id": pid})["active"] is False
    rows = client.get(REQ, headers=sor).json()
    assert any(p["id"] == pid and p["pending_approval"]["type"] == "new" for p in rows)

    # onaydan önceki düzeltme doğrudan ürüne yazılır, talep açık kalır
    r = client.put(f"/api/admin/products/{pid}", headers=sup, json={**BASE, "name": "Talep Biberi 2", "supplier_price": 45})
    assert r.status_code == 200, r.text
    doc = db.products.find_one({"id": pid})
    assert doc["name"] == "Talep Biberi 2" and doc["active"] is False and doc["pending_approval"]["type"] == "new"
    assert not doc.get("supplier_price_locked_until")

    assert client.post(f"{REQ}/{pid}/approve", headers=sor).status_code == 200
    doc = db.products.find_one({"id": pid})
    assert doc["active"] is True and "pending_approval" not in doc


def test_reject_new_deletes_and_reject_update_keeps_live(client, make_user, db):
    sg = f"TestSup{uuid.uuid4().hex[:6]}"
    _, sup = _supplier(make_user, sg)
    sor = sorumlu_for(db, make_user, sg)
    pid = _new_request(client, sup)
    assert client.post(f"{REQ}/{pid}/reject", headers=sor).status_code == 200
    assert db.products.find_one({"id": pid}) is None

    pid = _seed_product(db, sg)
    client.put(f"/api/admin/products/{pid}", headers=sup, json={"name": "Kötü Ad", "category": "Domates"})
    assert client.post(f"{REQ}/{pid}/reject", headers=sor).status_code == 200
    doc = db.products.find_one({"id": pid})
    assert doc["name"] == "Test Domates" and "pending_approval" not in doc
    assert client.post(f"{REQ}/{pid}/approve", headers=sor).status_code == 404


def test_other_markets_sorumlu_cannot_see_or_approve(client, make_user, db):
    sg = f"TestSup{uuid.uuid4().hex[:6]}"
    _, sup = _supplier(make_user, sg)
    sorumlu_for(db, make_user, sg)
    other = sorumlu_for(db, make_user, f"Baska{uuid.uuid4().hex[:6]}")
    pid = _new_request(client, sup)
    assert all(p["id"] != pid for p in client.get(REQ, headers=other).json())
    assert client.post(f"{REQ}/{pid}/approve", headers=other).status_code == 403
    assert db.products.find_one({"id": pid})["active"] is False


def test_supplier_sees_own_pending_values_and_can_revert(client, make_user, db):
    sg = f"TestSup{uuid.uuid4().hex[:6]}"
    pid = _seed_product(db, sg)
    _, sup = _supplier(make_user, sg)
    client.put(f"/api/admin/products/{pid}", headers=sup, json={"name": "Yeni Ad", "category": "Domates"})
    mine = [p for p in client.get("/api/admin/products", headers=sup).json() if p["id"] == pid][0]
    assert mine["name"] == "Yeni Ad" and mine["pending_approval"] == "update"

    # eski değere geri dönünce talep kapanır
    client.put(f"/api/admin/products/{pid}", headers=sup, json={"name": "Test Domates", "category": "Domates"})
    assert "pending_approval" not in db.products.find_one({"id": pid})


def test_supplier_options_and_campaign_go_to_approval(client, make_user, db):
    sg = f"TestSup{uuid.uuid4().hex[:6]}"
    pid = _seed_product(db, sg)
    _, sup = _supplier(make_user, sg)
    sor = sorumlu_for(db, make_user, sg)
    opts = [{"title": " Boyut ", "choices": [{"label": "İstemiyorum", "price_delta": 0}, {"label": "Büyük", "price_delta": 10}]}]
    r = client.put(f"/api/admin/products/{pid}", headers=sup, json={
        "name": "Test Domates", "category": "Domates",
        "customization_options": opts, "campaign_discount_percent": 150, "campaign_min_qty": 3,
    })
    assert r.status_code == 200, r.text
    ch = db.products.find_one({"id": pid})["pending_approval"]["changes"]
    assert ch["customization_options"][0]["title"] == "Boyut"
    assert ch["campaign_discount_percent"] == 90 and ch["campaign_min_qty"] == 3  # %90 üst sınır
    assert client.post(f"{REQ}/{pid}/approve", headers=sor).status_code == 200
    doc = db.products.find_one({"id": pid})
    assert doc["customization_options"][0]["choices"][1] == {"label": "Büyük", "price_delta": 10}
    assert doc["campaign_discount_percent"] == 90

    # boş seçenek adı reddedilir
    r = client.put(f"/api/admin/products/{pid}", headers=sup, json={
        "name": "Test Domates", "category": "Domates",
        "customization_options": [{"title": "Şekil", "choices": [{"label": " "}]}],
    })
    assert r.status_code == 400


def test_sorumlu_edits_options_directly(client, make_user, db):
    sg = f"TestSup{uuid.uuid4().hex[:6]}"
    pid = _seed_product(db, sg)
    _, sup = _supplier(make_user, sg)
    sor = sorumlu_for(db, make_user, sg)
    other = sorumlu_for(db, make_user, f"Baska{uuid.uuid4().hex[:6]}")
    # tedarikçinin bekleyen talebinde ad + seçenek değişikliği var
    client.put(f"/api/admin/products/{pid}", headers=sup, json={
        "name": "Yeni Ad", "category": "Domates",
        "customization_options": [{"title": "Eski", "choices": [{"label": "A"}]}],
    })
    opts = [{"title": "Boyut", "choices": [{"label": "İstemiyorum", "price_delta": 0}, {"label": "Büyük", "price_delta": 10}]}]
    url = f"/api/pazar-sorumlusu/products/{pid}/options"
    assert client.put(url, headers=other, json={"customization_options": opts}).status_code == 403
    assert client.put(url, headers=sor, json={"customization_options": [{"title": "", "choices": []}]}).status_code == 400
    r = client.put(url, headers=sor, json={"customization_options": opts})
    assert r.status_code == 200, r.text
    doc = db.products.find_one({"id": pid})
    assert doc["customization_options"][0]["title"] == "Boyut"
    # talepten seçenek düştü, ad değişikliği bekliyor
    assert doc["pending_approval"]["changes"] == {"name": "Yeni Ad"}
    # tüm seçenekleri kaldırma
    assert client.put(url, headers=sor, json={"customization_options": []}).status_code == 200
    assert db.products.find_one({"id": pid})["customization_options"] is None


def test_supplier_cannot_reactivate_or_approve(client, make_user, db):
    sg = f"TestSup{uuid.uuid4().hex[:6]}"
    pid = _seed_product(db, sg, active=False)
    _, sup = _supplier(make_user, sg)
    client.put(f"/api/admin/products/{pid}", headers=sup, json={"name": "Test Domates", "category": "Domates", "active": True})
    assert db.products.find_one({"id": pid})["active"] is False
    assert client.get(REQ, headers=sup).status_code in (401, 403)
    assert client.post(f"{REQ}/{pid}/approve", headers=sup).status_code in (401, 403)
