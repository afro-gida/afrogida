"""PayTR ödeme entegrasyonu — token alma, kart iadesi, callback imza doğrulama.

Callback route'unun kendisi server.py'de (ileride routers/payments.py); buradaki
`paytr_callback_expected_hash` onun imza kontrolünü sağlar.
"""
import base64
import hashlib
import hmac
import json
import os
import uuid

import httpx

from core.crypto import dec_str
from core.util import new_id


def _env(*names, default=None):
    for n in names:
        v = os.getenv(n)
        if v:
            return v
    return default


def _paytr_keys_status() -> dict:
    return {
        "merchant_id": bool(_env("PAYTR_MERCHANT_ID", "merchant_id")),
        "merchant_key": bool(_env("PAYTR_MERCHANT_KEY", "merchant_key")),
        "merchant_salt": bool(_env("PAYTR_MERCHANT_SALT", "merchant_salt")),
    }


def _clean_paytr_oid(value: str) -> str:
    cleaned = "".join(ch for ch in str(value or "") if ch.isalnum())
    return (cleaned[:64] if cleaned else uuid.uuid4().hex[:16])


def paytr_callback_expected_hash(merchant_oid: str, status: str, total_amount: str) -> str | None:
    """PayTR callback bildiriminin doğrulanması gereken HMAC imzası.
    Anahtarlar yoksa None döner."""
    merchant_key = _env("PAYTR_MERCHANT_KEY", "merchant_key")
    merchant_salt = _env("PAYTR_MERCHANT_SALT", "merchant_salt")
    if not merchant_key or not merchant_salt:
        return None
    hash_str = f"{merchant_oid}{merchant_salt}{status}{total_amount}"
    return base64.b64encode(
        hmac.new(merchant_key.encode(), hash_str.encode(), hashlib.sha256).digest()
    ).decode()


async def _init_paytr_token(order: dict, request, user_email: str | None = None) -> dict:
    merchant_id = _env("PAYTR_MERCHANT_ID", "merchant_id")
    merchant_key = _env("PAYTR_MERCHANT_KEY", "merchant_key")
    merchant_salt = _env("PAYTR_MERCHANT_SALT", "merchant_salt")
    if not merchant_id or not merchant_key or not merchant_salt:
        return {"success": False, "configured": False,
                "message": "PayTR merchant_id / merchant_key / merchant_salt ayarları eksik"}

    email = user_email or f"{order.get('user_id')}@afrogida.local"
    user_ip = request.client.host if request and request.client else "127.0.0.1"
    merchant_oid = _clean_paytr_oid(order.get("merchant_oid") or order.get("tx_id") or new_id("tx"))
    order["merchant_oid"] = merchant_oid
    payment_amount = str(int(round(float(order.get("amount", 0)) * 100)))
    basket = [
        [i.get("name") or "Ürün",
         f"{float(i.get('line_total') or i.get('total_price') or 0):.2f}",
         int(max(1, round(float(i.get("qty") or i.get("quantity") or 1))))]
        for i in order.get("items", [])
    ]
    user_basket = base64.b64encode(json.dumps(basket, ensure_ascii=False).encode()).decode()
    no_installment = "0"
    max_installment = "0"
    currency = "TL"
    test_mode = os.getenv("PAYTR_TEST_MODE", "1")
    hash_str = (merchant_id + user_ip + merchant_oid + email + payment_amount + user_basket
                + no_installment + max_installment + currency + test_mode + merchant_salt)
    paytr_token = base64.b64encode(
        hmac.new(merchant_key.encode(), hash_str.encode(), hashlib.sha256).digest()
    ).decode()
    payload = {
        "merchant_id": merchant_id,
        "user_ip": user_ip,
        "merchant_oid": merchant_oid,
        "email": email,
        "payment_amount": payment_amount,
        "paytr_token": paytr_token,
        "user_basket": user_basket,
        "debug_on": os.getenv("PAYTR_DEBUG_ON", "1"),
        "no_installment": no_installment,
        "max_installment": max_installment,
        "user_name": order.get("user_name") or "Afro Gıda Müşteri",
        "user_address": (dec_str(order.get("address")) or "Bursa")[:300],
        "user_phone": str(order.get("user_phone") or ""),
        "merchant_ok_url": os.getenv("PAYTR_OK_URL", "https://afrogida.com.tr/my-orders"),
        "merchant_fail_url": os.getenv("PAYTR_FAIL_URL", "https://afrogida.com.tr/cart"),
        "timeout_limit": os.getenv("PAYTR_TIMEOUT_LIMIT", "30"),
        "currency": currency,
        "test_mode": test_mode,
        "lang": "tr",
    }
    async with httpx.AsyncClient(timeout=20) as http:
        resp = await http.post("https://www.paytr.com/odeme/api/get-token", data=payload)
    try:
        result = resp.json()
    except Exception:
        return {"success": False, "configured": True,
                "message": "PayTR yanıtı okunamadı", "status_code": resp.status_code}
    if result.get("status") == "success" and result.get("token"):
        return {"success": True, "configured": True, "merchant_oid": merchant_oid,
                "token": result["token"],
                "payment_url": f"https://www.paytr.com/odeme/guvenli/{result['token']}"}
    return {"success": False, "configured": True, "merchant_oid": merchant_oid,
            "message": result.get("reason") or "PayTR token alınamadı", "paytr_response": result}


async def _paytr_refund(merchant_oid: str, return_amount: float) -> dict:
    """PayTR karta iade. Artımlıdır (aynı sipariş için birden çok kısmi iade),
    GERİ ALINAMAZ. Dönüş: {success, configured, amount, message, paytr_response}."""
    merchant_id = _env("PAYTR_MERCHANT_ID", "merchant_id")
    merchant_key = _env("PAYTR_MERCHANT_KEY", "merchant_key")
    merchant_salt = _env("PAYTR_MERCHANT_SALT", "merchant_salt")
    if not merchant_id or not merchant_key or not merchant_salt:
        return {"success": False, "configured": False,
                "message": "PayTR merchant_id / merchant_key / merchant_salt ayarları eksik"}
    if not merchant_oid:
        return {"success": False, "configured": True,
                "message": "Bu siparişte PayTR merchant_oid yok (online ödeme değil)"}
    amount_str = f"{float(return_amount):.2f}"
    hash_str = str(merchant_id) + str(merchant_oid) + amount_str + str(merchant_salt)
    token = base64.b64encode(
        hmac.new(merchant_key.encode(), hash_str.encode(), hashlib.sha256).digest()
    ).decode()
    payload = {
        "merchant_id": merchant_id,
        "merchant_oid": merchant_oid,
        "return_amount": amount_str,
        "paytr_token": token,
    }
    try:
        async with httpx.AsyncClient(timeout=20) as http:
            resp = await http.post("https://www.paytr.com/odeme/iade", data=payload)
        result = resp.json()
    except Exception as e:
        return {"success": False, "configured": True, "message": f"PayTR iade isteği başarısız: {e}"}
    if result.get("status") == "success":
        return {"success": True, "configured": True, "amount": float(return_amount), "paytr_response": result}
    return {
        "success": False,
        "configured": True,
        "message": result.get("err_msg") or result.get("reason") or "PayTR iade reddedildi",
        "paytr_response": result,
    }
