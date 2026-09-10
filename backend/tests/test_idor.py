"""IDOR / yetki izolasyonu — A kullanıcısı B'nin verisine erişememeli."""


def test_orders_scoped_to_user(client, make_user, db):
    a_uid, a = make_user()
    b_uid, b = make_user()
    db.transactions.insert_one({
        "tx_id": "tx_a_secret", "user_id": a_uid, "amount": 100,
        "order_status": "talep_alindi", "items": [],
    })
    # B kendi siparişlerini isterse A'nınkini GÖRMEMELİ
    r = client.get("/api/orders", headers=b)
    assert r.status_code == 200
    assert all(o.get("tx_id") != "tx_a_secret" for o in r.json())
    # A görmeli
    r2 = client.get("/api/orders", headers=a)
    assert any(o.get("tx_id") == "tx_a_secret" for o in r2.json())


def test_address_update_scoped_to_user(client, make_user, db):
    a_uid, a = make_user()
    b_uid, b = make_user()
    db.addresses.insert_one({"id": "addr_a", "user_id": a_uid,
                             "neighborhood": "X", "street": "Y", "building_no": "1"})
    db.users.update_one({"user_id": a_uid}, {"$set": {"addresses": [
        {"id": "addr_a", "user_id": a_uid, "neighborhood": "X", "street": "Y", "building_no": "1"}
    ]}})
    # B, A'nın adres id'siyle güncelleme denerse 404 almalı
    r = client.put("/api/auth/addresses/addr_a",
                   json={"neighborhood": "HACK", "street": "Y", "building_no": "1"}, headers=b)
    assert r.status_code == 404
    # A'nın adresi değişmemeli
    assert db.addresses.find_one({"id": "addr_a"})["neighborhood"] == "X"


def test_supplier_endpoint_blocks_member(client, make_user):
    _, member = make_user(role="member")
    assert client.get("/api/supplier/my-sales", headers=member).status_code == 403


def test_courier_endpoint_blocks_member(client, make_user):
    _, member = make_user(role="member")
    assert client.get("/api/courier/orders", headers=member).status_code == 403


def test_supplier_without_group_blocked(client, make_user):
    # esnaf rolü ama supplier_group atanmamış -> 403
    _, h = make_user(role="esnaf")
    assert client.get("/api/supplier/my-sales", headers=h).status_code == 403


def test_expired_session_rejected(client, make_user, db):
    from datetime import datetime, timezone, timedelta
    uid, h = make_user()
    db.user_sessions.update_many(
        {"user_id": uid},
        {"$set": {"expires_at": datetime.now(timezone.utc) - timedelta(hours=1)}},
    )
    assert client.get("/api/auth/me", headers=h).status_code == 401
