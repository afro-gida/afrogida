"""Admin tarafından OTP'siz hesap oluşturma — POST /api/admin/users
(tedarikçi/kurye onboarding'i için)."""


def test_admin_create_user_no_password(client, make_user, db):
    admin_uid, admin_h = make_user(role="yonetici")
    r = client.post("/api/admin/users", json={"name": "Yeni Esnaf", "phone": "05551234500"}, headers=admin_h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["success"] is True
    assert body["user"]["name"] == "Yeni Esnaf"
    assert body["user"]["role"] == "member"
    assert "password_hash" not in body["user"]

    doc = db.users.find_one({"user_id": body["user"]["user_id"]})
    assert doc["password_hash"] is None  # şifresiz açıldı, üye daha sonra "şifremi unuttum" ile belirler
    assert doc["created_by_admin"] == admin_uid


def test_admin_create_user_with_password(client, make_user, db):
    _, admin_h = make_user(role="yonetici")
    r = client.post(
        "/api/admin/users",
        json={"name": "Yeni Kurye", "phone": "05551234501", "password": "sifre123"},
        headers=admin_h,
    )
    assert r.status_code == 200, r.text
    uid = r.json()["user"]["user_id"]
    doc = db.users.find_one({"user_id": uid})
    assert doc["password_hash"] is not None

    # yeni hesapla normal girişte çalışmalı
    r2 = client.post("/api/auth/login", json={"phone": "05551234501", "password": "sifre123"})
    assert r2.status_code == 200, r2.text


def test_admin_create_user_duplicate_phone_409(client, make_user):
    _, admin_h = make_user(role="yonetici")
    client.post("/api/admin/users", json={"name": "A", "phone": "05551234502"}, headers=admin_h)
    r = client.post("/api/admin/users", json={"name": "B", "phone": "05551234502"}, headers=admin_h)
    assert r.status_code == 409


def test_admin_create_user_requires_admin(client, make_user):
    _, member_h = make_user(role="musteri")
    r = client.post("/api/admin/users", json={"name": "X", "phone": "05551234503"}, headers=member_h)
    assert r.status_code == 403


def test_admin_create_user_then_assign_staff(client, make_user, db):
    """Onboarding akışının bütünü: hesap aç -> esnaf rolü ver."""
    _, admin_h = make_user(role="yonetici")
    r = client.post("/api/admin/users", json={"name": "Yeni Tedarikçi", "phone": "05551234504"}, headers=admin_h)
    uid = r.json()["user"]["user_id"]
    r2 = client.put(f"/api/admin/staff/{uid}", json={"supplier_group": "Test Grubu"}, headers=admin_h)
    assert r2.status_code == 200, r2.text
    assert db.users.find_one({"user_id": uid})["role"] == "esnaf"
