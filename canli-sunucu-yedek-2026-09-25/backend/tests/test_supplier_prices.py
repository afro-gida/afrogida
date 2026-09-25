"""Tedarikçi fiyat görünürlüğü: tedarikçi sadece kendi (alış) fiyatını görür,
müşteri satış fiyatını ve platform kâr marjını göremez / değiştiremez."""
import uuid

HIDDEN = {"sale_price", "profit_margin_amount", "price", "gel_al_price", "eve_servis_price"}


def _supplier(make_user, sg):
    # ürün ekleme/düzenleme sözleşme onayı ister (services/contracts.py)
    return make_user(role="esnaf", supplier_group=sg,
                     supplier_contract_accepted_version="test-v1")


def _seed_product(db, sg, **fields):
    pid = f"prod_test_{uuid.uuid4().hex[:8]}"
    doc = {
        "id": pid, "name": "Test Domates", "category": "Domates",
        "subcategory": "Sebze", "supplier_group": sg, "unit": "Kg",
        "supplier_price": 50.0, "profit_margin_amount": 30.0,
        "sale_price": 80.0, "price": 80.0, "gel_al_price": 80.0,
        "in_stock": True, "active": True,
    }
    doc.update(fields)
    db.products.insert_one(doc)
    return pid


def test_supplier_list_hides_sale_price_and_margin(client, make_user, db):
    sg = f"TestSup{uuid.uuid4().hex[:6]}"
    pid = _seed_product(db, sg)
    _, sup = _supplier(make_user, sg)

    items = client.get("/api/admin/products", headers=sup).json()
    mine = [p for p in items if p["id"] == pid]
    assert mine and mine[0]["supplier_price"] == 50.0
    assert not (HIDDEN & set(mine[0]))

    # admin hâlâ her şeyi görür
    _, admin = make_user(role="yonetici")
    full = [p for p in client.get("/api/admin/products", headers=admin).json() if p["id"] == pid][0]
    assert full["sale_price"] == 80.0 and full["profit_margin_amount"] == 30.0


def test_supplier_cannot_set_customer_price(client, make_user, db):
    sg = f"TestSup{uuid.uuid4().hex[:6]}"
    pid = _seed_product(db, sg)
    _, sup = _supplier(make_user, sg)

    base = {"name": "Test Domates", "category": "Domates", "subcategory": "Sebze", "unit": "Kg"}
    # müşteri fiyatını doğrudan düşürme denemesi -> yok sayılır
    r = client.put(f"/api/admin/products/{pid}", headers=sup,
                   json={**base, "price": 1, "sale_price": 1, "gel_al_price": 1, "supplier_price": 50})
    assert r.status_code == 200, r.text
    assert not (HIDDEN & set(r.json()))
    doc = db.products.find_one({"id": pid})
    assert doc["price"] == 80.0 and doc["sale_price"] == 80.0 and doc["gel_al_price"] == 80.0
    # aynı supplier_price tekrar gönderildi -> fiyat değişikliği sayılmaz, kilit yok
    assert not doc.get("supplier_price_locked_until")

    # alış fiyatı değişince satış = alış + marj
    r = client.put(f"/api/admin/products/{pid}", headers=sup, json={**base, "supplier_price": 60})
    assert r.status_code == 200, r.text
    doc = db.products.find_one({"id": pid})
    assert doc["supplier_price"] == 60 and doc["sale_price"] == 90 and doc["price"] == 90

    # stok değişikliği gibi fiyatsız kayıtlar kilide takılmaz
    r = client.put(f"/api/admin/products/{pid}", headers=sup,
                   json={**base, "supplier_price": 60, "in_stock": False})
    assert r.status_code == 200, r.text
    # aynı gün ikinci fiyat değişikliği kilitli
    r = client.put(f"/api/admin/products/{pid}", headers=sup, json={**base, "supplier_price": 70})
    assert r.status_code == 400


def test_supplier_create_uses_supplier_price(client, make_user, db):
    sg = f"TestSup{uuid.uuid4().hex[:6]}"
    _, sup = _supplier(make_user, sg)
    r = client.post("/api/admin/products", headers=sup, json={
        "name": "Yeni Biber", "category": "Biber", "subcategory": "Sebze", "unit": "Kg",
        "supplier_price": 40, "price": 5, "sale_price": 5, "profit_margin_amount": 99,
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["supplier_price"] == 40
    assert not (HIDDEN & set(body))
    doc = db.products.find_one({"id": body["id"]})
    assert doc["supplier_group"] == sg
    assert doc["profit_margin_amount"] == 0
    assert doc["sale_price"] == 40 and doc["price"] == 40
