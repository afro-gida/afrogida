"""Tedarikçi fiyat görünürlüğü: tedarikçi sadece kendi (alış) fiyatını görür,
müşteri satış fiyatını ve platform kâr marjını göremez / değiştiremez."""
import uuid

HIDDEN = {"sale_price", "profit_margin_amount", "price", "gel_al_price", "eve_servis_price"}


def _supplier(make_user, sg):
    # ürün ekleme/düzenleme sözleşme onayı ister (services/contracts.py)
    return make_user(role="esnaf", supplier_group=sg,
                     supplier_contract_accepted_version="test-v1")


def sorumlu_for(db, make_user, sg):
    # onay pazar sorumlusunda (bkz. test_product_requests.py)
    from tests.test_product_requests import sorumlu_for as _f
    return _f(db, make_user, sg)


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

    _, admin = make_user(role="yonetici")
    base = {"name": "Test Domates", "category": "Domates", "subcategory": "Sebze", "unit": "Kg"}
    # müşteri fiyatını doğrudan düşürme denemesi -> yok sayılır, talep de açılmaz
    r = client.put(f"/api/admin/products/{pid}", headers=sup,
                   json={**base, "price": 1, "sale_price": 1, "gel_al_price": 1, "supplier_price": 50})
    assert r.status_code == 200, r.text
    assert not (HIDDEN & set(r.json()))
    doc = db.products.find_one({"id": pid})
    assert doc["price"] == 80.0 and doc["sale_price"] == 80.0 and doc["gel_al_price"] == 80.0
    # aynı supplier_price tekrar gönderildi -> fiyat değişikliği sayılmaz, kilit yok
    assert not doc.get("supplier_price_locked_until") and not doc.get("pending_approval")

    # alış fiyatı değişince onaya düşer; canlı fiyat onaya kadar aynı
    r = client.put(f"/api/admin/products/{pid}", headers=sup, json={**base, "supplier_price": 60})
    assert r.status_code == 200, r.text
    assert r.json()["supplier_price"] == 60 and r.json()["pending_approval"] == "update"
    doc = db.products.find_one({"id": pid})
    assert doc["supplier_price"] == 50 and doc["price"] == 80
    assert doc["pending_approval"]["changes"]["sale_price"] == 110

    # onayda satış = alış + kâr kademesi (60–89,99 -> +50), gün sonuna kilit
    assert client.post(f"/api/pazar-sorumlusu/product-requests/{pid}/approve", headers=sorumlu_for(db, make_user, sg)).status_code == 200
    doc = db.products.find_one({"id": pid})
    assert doc["supplier_price"] == 60 and doc["sale_price"] == 110 and doc["price"] == 110
    assert doc["profit_margin_amount"] == 50 and "pending_approval" not in doc
    assert doc["supplier_price_locked_until"]

    # stok değişikliği onay beklemez, kilide de takılmaz
    r = client.put(f"/api/admin/products/{pid}", headers=sup,
                   json={**base, "supplier_price": 60, "in_stock": False})
    assert r.status_code == 200, r.text
    doc = db.products.find_one({"id": pid})
    assert doc["in_stock"] is False and "pending_approval" not in doc
    # aynı gün ikinci fiyat değişikliği kilitli
    r = client.put(f"/api/admin/products/{pid}", headers=sup, json={**base, "supplier_price": 70})
    assert r.status_code == 400


def test_partial_update_keeps_image_and_options(client, make_user, db):
    """Kısmi güncelleme (tedarikçi sadece ad/stok gönderir) resmi, açıklamayı ve
    seçenekleri silmez; yönetici için de aynı."""
    sg = f"TestSup{uuid.uuid4().hex[:6]}"
    opts = [{"title": "Boyut", "choices": [{"label": "Büyük", "price_delta": 10}]}]
    pid = _seed_product(db, sg, image_url="https://afrogida.com.tr/uploads/x.webp",
                        description="Taze", customization_options=opts)
    _, sup = _supplier(make_user, sg)
    r = client.put(f"/api/admin/products/{pid}", headers=sup,
                   json={"name": "Yeni Ad", "category": "Domates", "in_stock": False})
    assert r.status_code == 200, r.text
    doc = db.products.find_one({"id": pid})
    assert doc["name"] == "Test Domates" and doc["in_stock"] is False  # stok anında, ad onayda
    assert doc["pending_approval"]["changes"] == {"name": "Yeni Ad"}
    _, admin = make_user(role="yonetici")
    assert client.post(f"/api/pazar-sorumlusu/product-requests/{pid}/approve", headers=sorumlu_for(db, make_user, sg)).status_code == 200
    doc = db.products.find_one({"id": pid})
    assert doc["name"] == "Yeni Ad" and doc["in_stock"] is False
    assert doc["image_url"] == "https://afrogida.com.tr/uploads/x.webp"
    assert doc["description"] == "Taze" and doc["customization_options"] == opts
    assert doc["supplier_group"] == sg and doc["price"] == 80.0

    _, admin = make_user(role="yonetici")
    r = client.put(f"/api/admin/products/{pid}", headers=admin, json={"name": "Admin Adı", "category": "Domates"})
    assert r.status_code == 200, r.text
    doc = db.products.find_one({"id": pid})
    assert doc["image_url"] and doc["customization_options"] == opts and doc["supplier_group"] == sg
    assert doc["unit"] == "Kg" and doc["price"] == 80.0


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
    # gönderdiği satış fiyatı / kâr yok sayılır; 40–59,99 -> +35
    assert doc["profit_margin_amount"] == 35
    assert doc["sale_price"] == 75 and doc["price"] == 75
    # yönetici onaylayana kadar satışta değil
    assert doc["active"] is False and doc["pending_approval"]["type"] == "new"
    assert body["pending_approval"] == "new"


import pytest  # noqa: E402

from core.pricing import profit_for  # noqa: E402


@pytest.mark.parametrize("supp,profit", [
    (0.01, 15), (19.99, 15), (20, 25), (39.99, 25), (40, 35), (59.99, 35), (60, 50), (89.99, 50),
    (90, 70), (129.99, 70), (130, 90), (179.99, 90), (180, 110), (249.99, 110), (250, 150),
    (349.99, 150), (350, 200), (500, 200), (500.01, None), (0, None),
])
def test_profit_tiers(supp, profit):
    assert profit_for(supp) == profit


def test_supplier_price_must_be_multiple_of_5(client, make_user, db):
    sg = f"TestSup{uuid.uuid4().hex[:6]}"
    _, sup = _supplier(make_user, sg)
    base = {"name": "Biber", "category": "Biber", "unit": "Kg"}
    for bad in (19, 29, 39.5, 12.25):
        r = client.post("/api/admin/products", headers=sup, json={**base, "supplier_price": bad})
        assert r.status_code == 400 and "5 TL" in r.json()["detail"], (bad, r.text)
    r = client.post("/api/admin/products", headers=sup, json={**base, "supplier_price": 35})
    assert r.status_code == 200, r.text
    # eski (5'in katı olmayan) alış fiyatlı ürün, fiyatı değişmeden kaydedilebilir
    pid = _seed_product(db, sg, supplier_price=23.0)
    _, admin = make_user(role="yonetici")
    r = client.put(f"/api/admin/products/{pid}", headers=admin, json={**base, "supplier_price": 23, "in_stock": False})
    assert r.status_code == 200, r.text
    r = client.put(f"/api/admin/products/{pid}", headers=admin, json={**base, "supplier_price": 27})
    assert r.status_code == 400


def test_admin_price_is_automatic_and_out_of_table_rejected(client, make_user, db):
    sg = f"TestSup{uuid.uuid4().hex[:6]}"
    pid = _seed_product(db, sg)
    _, admin = make_user(role="yonetici")
    base = {"name": "Test Domates", "category": "Domates", "unit": "Kg"}
    # yönetici satış fiyatı / kâr gönderse de kademe uygulanır (135 -> +90 = 225)
    r = client.put(f"/api/admin/products/{pid}", headers=admin,
                   json={**base, "supplier_price": 135, "sale_price": 999, "profit_margin_amount": 1})
    assert r.status_code == 200, r.text
    doc = db.products.find_one({"id": pid})
    assert (doc["sale_price"], doc["price"], doc["profit_margin_amount"]) == (225, 225, 90)
    # tablo dışı (500 TL üstü) reddedilir, fiyat değişmez
    r = client.put(f"/api/admin/products/{pid}", headers=admin, json={**base, "supplier_price": 650})
    assert r.status_code == 400 and "kademesi yok" in r.json()["detail"]
    assert db.products.find_one({"id": pid})["price"] == 225
