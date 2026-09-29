"""Ürün Talepleri: tedarikçinin açtığı / güncellediği ürün yönetici onayına
düşer — routers/products.py (/admin/product-requests)."""
import uuid

from tests.test_supplier_prices import _seed_product, _supplier

BASE = {"name": "Talep Biberi", "category": "Biber", "subcategory": "Sebze", "unit": "Kg"}


def _new_request(client, sup):
    r = client.post("/api/admin/products", headers=sup, json={**BASE, "supplier_price": 40, "active": True})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_new_product_waits_for_approval(client, make_user, db):
    sg = f"TestSup{uuid.uuid4().hex[:6]}"
    _, sup = _supplier(make_user, sg)
    _, admin = make_user(role="yonetici")
    pid = _new_request(client, sup)

    # müşteri sipariş veremez / listede gizli (active False), yönetici listesinde var
    assert db.products.find_one({"id": pid})["active"] is False
    rows = client.get("/api/admin/product-requests", headers=admin).json()
    assert any(p["id"] == pid and p["pending_approval"]["type"] == "new" for p in rows)

    # onaydan önceki düzeltme doğrudan ürüne yazılır, talep açık kalır
    r = client.put(f"/api/admin/products/{pid}", headers=sup, json={**BASE, "name": "Talep Biberi 2", "supplier_price": 45})
    assert r.status_code == 200, r.text
    doc = db.products.find_one({"id": pid})
    assert doc["name"] == "Talep Biberi 2" and doc["active"] is False and doc["pending_approval"]["type"] == "new"
    assert not doc.get("supplier_price_locked_until")

    assert client.post(f"/api/admin/product-requests/{pid}/approve", headers=admin).status_code == 200
    doc = db.products.find_one({"id": pid})
    assert doc["active"] is True and "pending_approval" not in doc


def test_reject_new_deletes_and_reject_update_keeps_live(client, make_user, db):
    sg = f"TestSup{uuid.uuid4().hex[:6]}"
    _, sup = _supplier(make_user, sg)
    _, admin = make_user(role="yonetici")
    pid = _new_request(client, sup)
    assert client.post(f"/api/admin/product-requests/{pid}/reject", headers=admin).status_code == 200
    assert db.products.find_one({"id": pid}) is None

    pid = _seed_product(db, sg)
    client.put(f"/api/admin/products/{pid}", headers=sup, json={"name": "Kötü Ad", "category": "Domates"})
    assert client.post(f"/api/admin/product-requests/{pid}/reject", headers=admin).status_code == 200
    doc = db.products.find_one({"id": pid})
    assert doc["name"] == "Test Domates" and "pending_approval" not in doc
    assert client.post(f"/api/admin/product-requests/{pid}/approve", headers=admin).status_code == 404


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


def test_supplier_cannot_reactivate_or_approve(client, make_user, db):
    sg = f"TestSup{uuid.uuid4().hex[:6]}"
    pid = _seed_product(db, sg, active=False)
    _, sup = _supplier(make_user, sg)
    client.put(f"/api/admin/products/{pid}", headers=sup, json={"name": "Test Domates", "category": "Domates", "active": True})
    assert db.products.find_one({"id": pid})["active"] is False
    assert client.get("/api/admin/product-requests", headers=sup).status_code in (401, 403)
    assert client.post(f"/api/admin/product-requests/{pid}/approve", headers=sup).status_code in (401, 403)
