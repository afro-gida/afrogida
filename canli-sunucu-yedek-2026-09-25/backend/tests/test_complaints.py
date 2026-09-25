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
