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


def test_sorumlu_sees_all_suppliers_and_assigns_only_known(client, db, sorumlu):
    import services.catalog as cat
    cfg_before = db.catalog_config.find_one({}, {"_id": 0})
    db.catalog_config.update_one({}, {"$set": {"suppliers": ["Ali Sebze", "Veli Meyve"], "supplier_markets": {}}}, upsert=True)
    cat._CACHE = None
    cat._CACHE_TS = 0
    try:
        h = sorumlu["headers"]
        assert client.get("/api/pazar-sorumlusu/all-suppliers", headers=h).json() == ["Ali Sebze", "Veli Meyve"]
        r = client.post("/api/pazar-sorumlusu/suppliers/assign", headers=h, json={"supplier_group": "Uydurma", "market_id": sorumlu["market_id"]})
        assert r.status_code == 400
        r = client.post("/api/pazar-sorumlusu/suppliers/assign", headers=h, json={"supplier_group": "Ali Sebze", "market_id": sorumlu["market_id"]})
        assert r.status_code == 200, r.text
        mine = client.get("/api/pazar-sorumlusu/suppliers", headers=h).json()
        assert mine == [{"supplier_group": "Ali Sebze", "markets": ["Güvenlik Pazarı"]}]
        # Başkasının pazarına atayamaz
        r = client.post("/api/pazar-sorumlusu/suppliers/assign", headers=h, json={"supplier_group": "Ali Sebze", "market_id": "market_baskasi"})
        assert r.status_code == 403
    finally:
        db.catalog_config.delete_many({})
        if cfg_before:
            db.catalog_config.insert_one(cfg_before)
        cat._CACHE = None
        cat._CACHE_TS = 0


def test_order_status_only_moves_forward(client, db, sorumlu, monkeypatch):
    import routers.pazar_sorumlusu as ps
    monkeypatch.setattr(ps, "send_delivery_sms", lambda *a, **k: True)
    tx = f"tx_{uuid.uuid4().hex[:8]}"
    db.transactions.insert_one({"tx_id": tx, "market_name": "Güvenlik Pazarı", "order_status": "talep_alindi",
                                "delivery_type": "gel_al", "items": [], "created_at": datetime.now(timezone.utc)})
    h = sorumlu["headers"]
    url = f"/api/pazar-sorumlusu/orders/{tx}/status"
    try:
        assert client.post(url, headers=h, json={"order_status": "hazirlaniyor"}).status_code == 200
        # geri almak yasak
        r = client.post(url, headers=h, json={"order_status": "hazirlik_bekliyor"})
        assert r.status_code == 400 and "geri alınamaz" in r.json()["detail"]
        # aynı durum da yeniden ayarlanamaz; ileri gider
        assert client.post(url, headers=h, json={"order_status": "hazirlaniyor"}).status_code == 400
        assert client.post(url, headers=h, json={"order_status": "hazir"}).status_code == 200
        assert client.post(url, headers=h, json={"order_status": "hazirlaniyor"}).status_code == 400
        assert db.transactions.find_one({"tx_id": tx})["order_status"] == "hazir"
    finally:
        db.transactions.delete_one({"tx_id": tx})


def test_sorumlu_adds_and_removes_courier_in_own_market(client, db, make_user, sorumlu):
    h = sorumlu["headers"]
    phone = "05" + str(uuid.uuid4().int)[:9]
    uid, _ = make_user(role="member", phone=phone)
    r = client.post("/api/pazar-sorumlusu/couriers/assign", headers=h, json={"identifier": phone, "market_id": sorumlu["market_id"]})
    assert r.status_code == 200, r.text
    u = db.users.find_one({"user_id": uid})
    assert u["role"] == "kurye" and u["courier_markets"] == ["Güvenlik Pazarı"]
    names = [c["user_id"] for c in client.get("/api/pazar-sorumlusu/couriers", headers=h).json()]
    assert uid in names
    # başkasının pazarına ekleyemez
    assert client.post("/api/pazar-sorumlusu/couriers/assign", headers=h,
                       json={"identifier": phone, "market_id": "market_baskasi"}).status_code == 403
    # tedarikçi hesabı kurye yapılamaz
    sp = "05" + str(uuid.uuid4().int)[:9]
    make_user(role="esnaf", phone=sp, supplier_group="X")
    assert client.post("/api/pazar-sorumlusu/couriers/assign", headers=h,
                       json={"identifier": sp, "market_id": sorumlu["market_id"]}).status_code == 400
    # çıkarınca başka pazarı yoksa üyeye döner
    r = client.post("/api/pazar-sorumlusu/couriers/unassign", headers=h, json={"user_id": uid, "market_id": sorumlu["market_id"]})
    assert r.status_code == 200, r.text
    assert db.users.find_one({"user_id": uid})["role"] == "musteri"


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
