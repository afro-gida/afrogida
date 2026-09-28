"""Yönetici authenticator (TOTP) doğrulaması + yedek kodlar."""
import time
import uuid

import pytest

from core import totp


def test_totp_rfc6238_vector():
    # RFC 6238 ek B: gizli "12345678901234567890", T=59 -> 94287082 (son 6 hane)
    secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
    assert totp.code_at(secret, 1) == "287082"
    assert totp.verify(secret, "287082", now=59) == 1
    assert totp.verify(secret, "287082", last_counter=1, now=59) is None  # tekrar kullanılamaz
    assert totp.verify(secret, "000000", now=59) is None


def test_backup_code_hash_ignores_format():
    assert totp.hash_backup("abcd-efgh") == totp.hash_backup("ABCDEFGH")
    codes = totp.new_backup_codes()
    assert len(codes) == 8 and len(set(codes)) == 8


def _now_counter():
    return int(time.time() // totp.STEP)


@pytest.fixture
def admin_with_totp(client, make_user, db):
    """Kullanıcı adı/şifresi olan yönetici; authenticator kurulmuş halde."""
    uname = f"adm_{uuid.uuid4().hex[:6]}"
    uid, h = make_user(role="admin", username=uname)
    r = client.post("/api/admin/2fa/totp/setup", headers=h)
    assert r.status_code == 200, r.text
    secret = r.json()["secret"]
    assert r.json()["otpauth_uri"].startswith("otpauth://totp/")
    r = client.post("/api/admin/2fa/totp/confirm", headers=h, json={"code": totp.code_at(secret, _now_counter())})
    assert r.status_code == 200, r.text
    codes = r.json()["backup_codes"]
    yield {"uid": uid, "headers": h, "username": uname, "secret": secret, "backup_codes": codes}
    db.admin_totp.delete_many({"user_id": uid})


def _login(client, uname):
    r = client.post("/api/auth/admin", json={"username": uname, "password": "test1234"})
    assert r.status_code == 200, r.text
    return r.json()


def test_setup_enables_totp_and_hides_secret(client, db, admin_with_totp):
    a = admin_with_totp
    assert len(a["backup_codes"]) == 8
    r = client.get("/api/admin/2fa/status", headers=a["headers"])
    assert r.json() == {"totp_enabled": True, "backup_codes_left": 8}
    # Sır kullanıcı kaydında durmaz; ayrı koleksiyonda şifreli
    user = db.users.find_one({"user_id": a["uid"]})
    assert not any(k.startswith("totp") for k in user)
    sec = db.admin_totp.find_one({"user_id": a["uid"]})
    assert a["secret"] not in str(sec)
    # Etkinken yeniden kurulum (2FA'yı başka telefona taşıma) yapılamaz
    assert client.post("/api/admin/2fa/totp/setup", headers=a["headers"]).status_code == 409


def test_setup_requires_admin(client, make_user):
    _, h = make_user(role="member")
    assert client.post("/api/admin/2fa/totp/setup", headers=h).status_code == 403


def test_confirm_rejects_wrong_code(client, make_user, db):
    uid, h = make_user(role="admin", username=f"adm_{uuid.uuid4().hex[:6]}")
    client.post("/api/admin/2fa/totp/setup", headers=h)
    r = client.post("/api/admin/2fa/totp/confirm", headers=h, json={"code": "000000"})
    assert r.status_code == 400
    assert client.get("/api/admin/2fa/status", headers=h).json()["totp_enabled"] is False
    db.admin_totp.delete_many({"user_id": uid})


def test_login_with_totp_no_sms_and_code_single_use(client, admin_with_totp):
    a = admin_with_totp
    ch = _login(client, a["username"])
    assert ch["requires_2fa"] and ch["method"] == "totp"
    # Kurulumda kullanılan adım yakıldı -> bir sonraki adımın kodu (pencere içinde)
    code = totp.code_at(a["secret"], _now_counter() + 1)
    r = client.post("/api/auth/admin/verify-2fa", json={"challenge_id": ch["challenge_id"], "code": code})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["token"] and body["user"]["totp_enabled"] is True
    assert not any("secret" in k or "hash" in k for k in body["user"])
    # Aynı kod yeni bir girişte ikinci kez kabul edilmez
    ch2 = _login(client, a["username"])
    r = client.post("/api/auth/admin/verify-2fa", json={"challenge_id": ch2["challenge_id"], "code": code})
    assert r.status_code == 401


def test_login_with_backup_code_once(client, admin_with_totp):
    a = admin_with_totp
    backup = a["backup_codes"][0]
    ch = _login(client, a["username"])
    r = client.post("/api/auth/admin/verify-2fa", json={"challenge_id": ch["challenge_id"], "code": backup.lower()})
    assert r.status_code == 200, r.text
    assert r.json()["user"]["backup_codes_left"] == 7
    ch2 = _login(client, a["username"])
    r = client.post("/api/auth/admin/verify-2fa", json={"challenge_id": ch2["challenge_id"], "code": backup})
    assert r.status_code == 401


def test_wrong_totp_counts_attempts(client, admin_with_totp):
    a = admin_with_totp
    ch = _login(client, a["username"])
    r = client.post("/api/auth/admin/verify-2fa", json={"challenge_id": ch["challenge_id"], "code": "123456"})
    assert r.status_code == 401
    assert "deneme kaldı" in r.json()["detail"]
