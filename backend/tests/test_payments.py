"""PayTR callback — HMAC imza doğrulaması + tutar çapraz kontrolü."""
import base64
import hashlib
import hmac
import os

import pytest


def _valid_hash(oid, status, total):
    key = os.environ["PAYTR_MERCHANT_KEY"].encode()
    salt = os.environ["PAYTR_MERCHANT_SALT"]
    return base64.b64encode(
        hmac.new(key, f"{oid}{salt}{status}{total}".encode(), hashlib.sha256).digest()
    ).decode()


@pytest.fixture(autouse=True)
def _paytr_keys(monkeypatch):
    monkeypatch.setenv("PAYTR_MERCHANT_KEY", "test_key_123")
    monkeypatch.setenv("PAYTR_MERCHANT_SALT", "test_salt_456")


def _callback(client, oid, status, total, hash_val):
    # data= dict -> düzgün form-encode (hash base64'ünde + / = olabilir)
    return client.post(
        "/api/payments/paytr/callback",
        data={"merchant_oid": oid, "status": status, "total_amount": total, "hash": hash_val},
    )


def test_callback_rejects_bad_hash(client):
    r = _callback(client, "tx_x", "success", "5000", "TOTALLY_WRONG")
    assert r.status_code == 200
    assert r.text == "PAYTR_HASH_MISMATCH"


def test_callback_rejects_forged_amount(client, db):
    """Doğru imza ama sipariş tutarıyla uyuşmayan tutar -> suspicious, OK döner
    ama sipariş 'paid' OLMAZ."""
    db.transactions.insert_one({
        "tx_id": "tx_amt", "merchant_oid": "txamt", "user_id": "u1",
        "amount": 100.0, "payment_status": "pending", "order_status": "talep_alindi",
    })
    # saldırgan 1 TL (100 kuruş) ödeme bildiriyor, sipariş 100 TL
    h = _valid_hash("txamt", "success", "100")
    r = _callback(client, "txamt", "success", "100", h)
    assert r.status_code == 200
    assert r.text == "OK", r.text
    tx = db.transactions.find_one({"tx_id": "tx_amt"})
    assert tx["payment_status"] != "paid"
    assert tx.get("security_hold") is True


def test_callback_accepts_valid(client, db):
    db.transactions.insert_one({
        "tx_id": "tx_ok", "merchant_oid": "txok", "user_id": "u2",
        "amount": 50.0, "payment_status": "pending", "order_status": "talep_alindi",
    })
    h = _valid_hash("txok", "success", "5000")   # 50.00 TL = 5000 kuruş
    r = _callback(client, "txok", "success", "5000", h)
    assert r.status_code == 200
    assert r.text == "OK"
    tx = db.transactions.find_one({"tx_id": "tx_ok"})
    assert tx["payment_status"] == "paid"


def test_callback_missing_fields(client):
    h = _valid_hash("x", "success", "100")
    r = _callback(client, "", "success", "100", h)
    assert r.text == "PAYTR_MISSING_FIELDS"
