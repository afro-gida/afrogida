"""Teslim kodu: Gel-Al'da "Hazır"da, Eve Servis'te kurye yola çıkınca üretilir;
Türkiye saatiyle gün sonuna kadar geçerli; kuryeye gösterilmez."""
import uuid
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pytest

import services.delivery_code as dc
from core.crypto import dec_str


@pytest.fixture
def sms(monkeypatch):
    sent = []
    monkeypatch.setattr(dc, "send_delivery_sms", lambda phone, tx, code: sent.append((phone, tx, code)) or True)
    return sent


@pytest.fixture
def setup(make_user, db):
    mid = f"market_{uuid.uuid4().hex[:6]}"
    db.markets.insert_one({"id": mid, "name": "Kod Pazarı", "day": "Salı", "active": True})
    _, sh = make_user(role="pazar_sorumlusu", managed_markets=[mid])
    _, kh = make_user(role="kurye", courier_markets=["Kod Pazarı"])
    cust_phone = "05" + str(uuid.uuid4().int)[:9]
    cust, _ = make_user(role="member", phone=cust_phone)
    created = []

    def order(delivery_type, status="hazirlaniyor"):
        tx = f"tx_{uuid.uuid4().hex[:8]}"
        db.transactions.insert_one({"tx_id": tx, "user_id": cust, "market_name": "Kod Pazarı", "order_status": status,
                                    "delivery_type": delivery_type, "items": [], "created_at": datetime.now(timezone.utc)})
        created.append(tx)
        return tx

    yield {"sh": sh, "kh": kh, "order": order, "phone": cust_phone}
    db.transactions.delete_many({"tx_id": {"$in": created}})
    db.markets.delete_one({"id": mid})


def test_end_of_day_is_istanbul_2359():
    local = dc.end_of_day_istanbul().astimezone(ZoneInfo("Europe/Istanbul"))
    assert (local.hour, local.minute, local.second) == (23, 59, 59)


def test_gel_al_code_on_ready_until_end_of_day(client, db, sms, setup):
    tx = setup["order"]("gel_al")
    r = client.post(f"/api/pazar-sorumlusu/orders/{tx}/status", headers=setup["sh"], json={"order_status": "hazir"})
    assert r.status_code == 200, r.text
    doc = db.transactions.find_one({"tx_id": tx})
    assert dec_str(doc["delivery_code"]) and sms[-1][0] == setup["phone"]
    exp = doc["delivery_code_expires_at"].replace(tzinfo=timezone.utc).astimezone(ZoneInfo("Europe/Istanbul"))
    assert (exp.hour, exp.minute) == (23, 59)


def test_eve_servis_code_only_when_courier_departs(client, db, sms, setup):
    tx = setup["order"]("eve_servis")
    assert client.post(f"/api/pazar-sorumlusu/orders/{tx}/status", headers=setup["sh"],
                       json={"order_status": "hazir"}).status_code == 200
    assert not db.transactions.find_one({"tx_id": tx}).get("delivery_code")  # hazırda kod YOK
    # kod yokken teslim doğrulanamaz
    r = client.post(f"/api/courier/orders/{tx}/verify-delivery-code", headers=setup["kh"], json={"code": "123456"})
    assert r.status_code == 400
    # yola çıkınca kod üretilir, müşteriye SMS
    r = client.post(f"/api/courier/orders/{tx}/depart", headers=setup["kh"])
    assert r.status_code == 200, r.text
    code = dec_str(db.transactions.find_one({"tx_id": tx})["delivery_code"])
    assert code and sms[-1][0] == setup["phone"]
    # kurye listesinde kod görünmez
    listing = client.get("/api/courier/orders", headers=setup["kh"]).text
    assert code not in listing and "delivery_code" not in listing
    r = client.post(f"/api/courier/orders/{tx}/verify-delivery-code", headers=setup["kh"], json={"code": code})
    assert r.status_code == 200, r.text
    assert db.transactions.find_one({"tx_id": tx})["order_status"] == "teslim_edildi"
