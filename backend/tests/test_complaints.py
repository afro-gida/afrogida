"""Müşteri şikayet/öneri gönderme — routers/complaints.py."""


def test_submit_complaint(client, make_user, db):
    uid, h = make_user(role="musteri", name="Şikayetçi Üye")
    r = client.post("/api/complaints", json={"message": "  Ürün geç geldi.  "}, headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["success"] is True
    assert body["id"]

    doc = db.complaints.find_one({"id": body["id"]})
    assert doc["user_id"] == uid
    assert doc["user_name"] == "Şikayetçi Üye"
    assert doc["message"] == "Ürün geç geldi."  # trim edilmiş
    assert doc["status"] == "pending"
    assert doc["created_at"] is not None


def test_submit_complaint_requires_message(client, make_user):
    uid, h = make_user(role="musteri")
    r = client.post("/api/complaints", json={"message": "   "}, headers=h)
    assert r.status_code == 400


def test_submit_complaint_requires_auth(client):
    r = client.post("/api/complaints", json={"message": "test"})
    assert r.status_code in (401, 403)


def test_admin_can_list_complaints(client, make_user):
    _, h = make_user(role="musteri")
    client.post("/api/complaints", json={"message": "listelenecek şikayet"}, headers=h)
    admin_uid, admin_h = make_user(role="yonetici")
    r = client.get("/api/admin/complaints", headers=admin_h)
    assert r.status_code == 200
    assert any(c["message"] == "listelenecek şikayet" for c in r.json())


def test_admin_complaint_status_is_validated(client, make_user):
    _, h = make_user(role="musteri")
    cid = client.post("/api/complaints", json={"message": "durum testi"}, headers=h).json()["id"]
    _, admin_h = make_user(role="yonetici")
    assert client.put(f"/api/admin/complaints/{cid}", json={"status": "hacked"}, headers=admin_h).status_code == 400
    r = client.put(f"/api/admin/complaints/{cid}", json={"status": "resolved"}, headers=admin_h)
    assert r.status_code == 200
    assert r.json()["status"] == "resolved"


def test_admin_return_requests_list_and_review(client, make_user, db):
    db.transactions.insert_one({"tx_id": "TX-IADE-1", "user_name": "Müşteri", "market_name": "Görükle",
                                "order_status": "teslim_edildi", "items": [],
                                "return_request": {"item_names": ["Domates"], "reason": "ezik",
                                                   "requested_at": "2026-09-29T10:00:00Z"}})
    db.transactions.insert_one({"tx_id": "TX-IADESIZ", "order_status": "teslim_edildi", "items": []})
    _, admin_h = make_user(role="yonetici")

    rows = client.get("/api/admin/return-requests", headers=admin_h).json()
    ids = [r["tx_id"] for r in rows]
    assert "TX-IADE-1" in ids and "TX-IADESIZ" not in ids
    assert "items" not in rows[ids.index("TX-IADE-1")]

    assert client.put("/api/admin/return-requests/TX-IADE-1", json={"status": "x"}, headers=admin_h).status_code == 400
    assert client.put("/api/admin/return-requests/TX-IADESIZ", json={"status": "resolved"}, headers=admin_h).status_code == 404
    assert client.put("/api/admin/return-requests/TX-IADE-1", json={"status": "resolved"}, headers=admin_h).status_code == 200
    assert db.transactions.find_one({"tx_id": "TX-IADE-1"})["return_request"]["status"] == "resolved"


def test_return_requests_admin_only(client, make_user):
    _, h = make_user(role="pazar_sorumlusu")
    assert client.get("/api/admin/return-requests", headers=h).status_code in (401, 403)
