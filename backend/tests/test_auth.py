"""Kayıt / giriş akışı — routers/auth.py."""
import hashlib
from datetime import datetime, timezone, timedelta


def _put_otp(db, phone, code="123456", purpose="registration"):
    db.otp_codes.insert_one({
        "phone": phone, "purpose": purpose,
        "code_hash": hashlib.sha256(code.encode()).hexdigest(),
        "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=5),
        "used": False,
    })


def test_register_then_login(client, db):
    phone = "05559998877"
    _put_otp(db, phone)
    r = client.post("/api/auth/register", json={
        "name": "Deniz", "phone": phone, "password": "sifre123", "otp_code": "123456",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["token"]
    assert body["user"]["name"] == "Deniz"
    assert "password_hash" not in body["user"]
    # yeni üye kuponu TAMAMEN admin ayarına bağlı (global_settings.new_member_coupon_id);
    # ayar yoksa (bu testte yok) hiçbir kupon verilmez
    assert db.coupons.count_documents({"assigned_user_ids": body["user"]["user_id"]}) == 0

    # aynı numarayla tekrar kayıt -> 409
    _put_otp(db, phone)
    assert client.post("/api/auth/register", json={
        "name": "X", "phone": phone, "password": "x", "otp_code": "123456"}).status_code == 409

    # giriş
    r2 = client.post("/api/auth/login", json={"phone": phone, "password": "sifre123"})
    assert r2.status_code == 200
    assert r2.json()["token"]

    # yanlış şifre -> 401
    assert client.post("/api/auth/login", json={"phone": phone, "password": "yanlis"}).status_code == 401


def test_register_assigns_configured_coupon(client, db):
    """Admin global_settings.new_member_coupon_id ayarlarsa, yeni üye o
    kupona (yeni oluşturmadan, mevcut kupona) verilen limitle atanır."""
    db.coupons.insert_one({
        "id": "coup_test_newmember", "code": "TESTKUPON", "title": "Test",
        "discount_amount": 25.0, "min_amount": 100.0, "active": True,
        "single_use": False, "assignments": [], "assigned_user_ids": [],
    })
    db.settings.update_one(
        {"id": "global_settings"},
        {"$set": {"id": "global_settings", "new_member_coupon_id": "coup_test_newmember", "new_member_coupon_limit": 3}},
        upsert=True,
    )
    phone = "05557778899"
    _put_otp(db, phone)
    r = client.post("/api/auth/register", json={
        "name": "Kuponlu Üye", "phone": phone, "password": "sifre123", "otp_code": "123456",
    })
    assert r.status_code == 200, r.text
    uid = r.json()["user"]["user_id"]
    coupon = db.coupons.find_one({"id": "coup_test_newmember"})
    assert uid in coupon["assigned_user_ids"]
    assignment = next(a for a in coupon["assignments"] if a["user_id"] == uid)
    assert assignment["limit"] == 3
    assert assignment["used_count"] == 0


def test_register_bad_otp(client, db):
    phone = "05551112233"
    _put_otp(db, phone, code="111111")
    r = client.post("/api/auth/register", json={
        "name": "A", "phone": phone, "password": "p", "otp_code": "999999"})
    assert r.status_code == 400


def test_login_unknown_phone_404(client):
    assert client.post("/api/auth/login", json={"phone": "05550000000", "password": "x"}).status_code == 404


def test_admin_login_wrong_creds_401(client):
    r = client.post("/api/auth/admin", json={"username": "nope", "password": "nope"})
    assert r.status_code == 401


def test_logout_clears_session(client, make_user, db):
    uid, h = make_user()
    assert client.get("/api/auth/me", headers=h).status_code == 200
    assert client.post("/api/auth/logout", headers=h).status_code == 200
    assert client.get("/api/auth/me", headers=h).status_code == 401


def test_deprecated_login_methods_gone(client):
    assert client.post("/api/auth/google", json={"session_id": "x"}).status_code == 410
    assert client.post("/api/auth/phone", json={"phone": "0555", "name": "x"}).status_code == 410


def test_delete_me_removes_account_and_session(client, make_user, db):
    uid, h = make_user(role="musteri")
    assert client.get("/api/auth/me", headers=h).status_code == 200
    r = client.delete("/api/auth/me", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["success"] is True
    assert db.users.find_one({"user_id": uid}) is None
    assert db.user_sessions.count_documents({"user_id": uid}) == 0
    # oturum artık geçersiz
    assert client.get("/api/auth/me", headers=h).status_code == 401


def test_delete_me_blocked_for_staff_roles(client, make_user, db):
    uid, h = make_user(role="esnaf")
    r = client.delete("/api/auth/me", headers=h)
    assert r.status_code == 403
    # silinmedi
    assert db.users.find_one({"user_id": uid}) is not None
