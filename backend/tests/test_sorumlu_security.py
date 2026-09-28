"""Pazar sorumlusu: yeni cihaz doğrulaması (SMS) + gizlilik (adres/telefon yok)."""
import re
import uuid
from datetime import datetime, timezone

import pytest

import routers.auth as auth_mod
from core.crypto import enc_str


@pytest.fixture
def sms(monkeypatch):
    """SMS göndermek yerine yakalar: [(telefon, mesaj)]."""
    sent = []
    monkeypatch.setattr(auth_mod, "send_sms_verimor", lambda phone, msg: sent.append((phone, msg)) or True)
    return sent


@pytest.fixture
def sorumlu(make_user, db):
    market_id = f"market_{uuid.uuid4().hex[:6]}"
    db.markets.insert_one({"id": market_id, "name": "Güvenlik Pazarı", "day": "Salı", "active": True})
    phone = "05" + str(uuid.uuid4().int)[:9]
    uid, h = make_user(role="pazar_sorumlusu", phone=phone, managed_markets=[market_id])
    yield {"uid": uid, "headers": h, "phone": phone, "market_id": market_id}
    db.markets.delete_one({"id": market_id})
    db.trusted_devices.delete_many({"user_id": uid})


def _code(sms):
    return re.search(r"kodu: (\d{6})", sms[-1][1]).group(1)


def test_new_device_requires_sms_then_trusted(client, sms, sorumlu):
    r = client.post("/api/auth/login", json={"phone": sorumlu["phone"], "password": "test1234"})
    assert r.status_code == 200, r.text
    ch = r.json()
    assert ch.get("requires_device_verification") and "token" not in ch
    assert sms[-1][0] == sorumlu["phone"]  # kod sorumlunun KENDİ telefonuna

    bad = client.post("/api/auth/device/verify", json={"challenge_id": ch["challenge_id"], "code": "000000"})
    assert bad.status_code == 401
    ok = client.post("/api/auth/device/verify", json={"challenge_id": ch["challenge_id"], "code": _code(sms), "remember": True})
    assert ok.status_code == 200, ok.text
    body = ok.json()
    assert body["token"] and body["device_token"]
    # Kod tek kullanımlık
    again = client.post("/api/auth/device/verify", json={"challenge_id": ch["challenge_id"], "code": _code(sms)})
    assert again.status_code == 410

    # Hatırlanan cihaz: sadece şifre
    n = len(sms)
    r = client.post("/api/auth/login", json={"phone": sorumlu["phone"], "password": "test1234"},
                    headers={"X-Device-Token": body["device_token"]})
    assert r.status_code == 200 and r.json()["token"]
    assert len(sms) == n
    # Başka / sahte cihaz anahtarı: yine SMS
    r = client.post("/api/auth/login", json={"phone": sorumlu["phone"], "password": "test1234"},
                    headers={"X-Device-Token": "sahte"})
    assert r.json().get("requires_device_verification")


def test_test_account_code_goes_to_owner_phone(client, sms, make_user, monkeypatch):
    """is_test hesabın numarası sahte -> kod sistem sahibinin numarasına gider."""
    monkeypatch.setattr(auth_mod, "ADMIN_2FA_PHONE", "05990000000")
    phone = "05" + str(uuid.uuid4().int)[:9]
    make_user(role="pazar_sorumlusu", phone=phone, is_test=True, name="Test1")
    r = client.post("/api/auth/login", json={"phone": phone, "password": "test1234"})
    assert r.json().get("requires_device_verification")
    assert sms[-1][0] == "05990000000" and "TEST HESABI" in sms[-1][1]
    # Gerçek hesapta kod kendi numarasına
    phone2 = "05" + str(uuid.uuid4().int)[:9]
    make_user(role="pazar_sorumlusu", phone=phone2)
    client.post("/api/auth/login", json={"phone": phone2, "password": "test1234"})
    assert sms[-1][0] == phone2


def test_member_login_has_no_device_step(client, sms, make_user):
    phone = "05" + str(uuid.uuid4().int)[:9]
    make_user(role="member", phone=phone)
    r = client.post("/api/auth/login", json={"phone": phone, "password": "test1234"})
    assert r.status_code == 200 and r.json()["token"]


def test_sorumlu_order_hides_customer_phone_and_address(client, db, sorumlu):
    tx = f"tx_{uuid.uuid4().hex[:8]}"
    db.transactions.insert_one({
        "tx_id": tx, "market_name": "Güvenlik Pazarı", "user_name": "Ayşe", "user_phone": "05321234567",
        "address": enc_str("Görükle Mah. Gizli Sk. No:5"), "delivery_type": "eve_servis",
        "delivery_neighborhood": "Görükle", "order_status": "talep_alindi", "items": [],
        "created_at": datetime.now(timezone.utc),
    })
    try:
        for path in (f"/api/pazar-sorumlusu/orders/{tx}", "/api/pazar-sorumlusu/orders?filter_type=all_time"):
            r = client.get(path, headers=sorumlu["headers"])
            assert r.status_code == 200, r.text
            text = r.text
            assert "Gizli Sk" not in text and "1234567" not in text and "customer_phone" not in text
        assert client.get(f"/api/pazar-sorumlusu/orders/{tx}", headers=sorumlu["headers"]).json()["delivery_neighborhood"] == "Görükle"
    finally:
        db.transactions.delete_one({"tx_id": tx})
