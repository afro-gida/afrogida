"""PayTR ödeme endpoint'leri: ödeme başlat, iframe token, callback (imza + tutar doğrulama), yönetici testi."""
from decimal import ROUND_HALF_UP

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse

from core.crypto import verify_order_signature
from core.db import db
from core.logs import _insert_log, _extract_request_meta
from core.money import money_d
from core.security import get_current_user, get_current_admin, security_alarm, rate_limit
from core.util import now_utc, new_id
from services.orders import (
    _customer_order_view, _prepare_order_payload, _consume_coupon_for_order,
    _log_order_agreement, _compat_json_clean, _as_float,
)
from services.payments import _paytr_keys_status, _init_paytr_token, paytr_callback_expected_hash

router = APIRouter(prefix="/api")


@router.post("/payments/init")
async def compat_payments_init(data: dict, request: Request, current_user: dict = Depends(get_current_user)):
    await rate_limit(f"order_user:{current_user.get('user_id')}", 12, 300, "Çok sık sipariş denemesi. Lütfen biraz bekleyin.")
    order = await _prepare_order_payload(data, current_user, request)
    await db.transactions.insert_one(order)
    # --- LOG: sipariş oluşturma ---
    _os_items = []
    for _oi in (order.get("items") or []):
        _os_items.append({"product_id": _oi.get("product_id",""), "name": _oi.get("name",""), "qty": _oi.get("qty",0), "unit": _oi.get("unit",""), "supplier_price": _oi.get("supplier_price",0), "sale_price": _oi.get("sale_price", _oi.get("price",0)), "customizations": _oi.get("customizations",[])})
    _os = {"items": _os_items, "subtotal": order.get("subtotal",0), "delivery_fee": order.get("delivery_fee",0), "discount": order.get("discount_amount",0), "coupon_code": order.get("coupon_code"), "total": order.get("total",0), "payment_method": order.get("payment_method",""), "delivery_type": order.get("delivery_type",""), "address": (order.get("delivery_address") or {}).get("full_address","") if isinstance(order.get("delivery_address"), dict) else str(order.get("delivery_address","")), "delivery_time_slot": order.get("delivery_time_slot",""), "customer_note": order.get("customer_note",""), "market_name": order.get("market_name",""), "supplier_group": order.get("supplier_group","")}
    await _insert_log("log_orders", {"order_id": order["tx_id"], "user_id": current_user["user_id"], "action": "order_created", "performed_by": "user", "admin_id": None, "admin_note": None, "order_snapshot": _os}, request)
    await _insert_log("log_payments", {"order_id": order["tx_id"], "user_id": current_user["user_id"], "payment_provider": "PayTR" if order["payment_method"]=="online_card" else "cash", "transaction_id": None, "action": "payment_initiated", "amount": order.get("total",0), "payment_method": order.get("payment_method",""), "card_last_four": None, "error_message": None, "paytr_hash_valid": None}, request)
    # Sipariş anındaki sözleşme onayını sipariş no ile logla ('Sözleşme Onayları' sekmesi).
    await _log_order_agreement(order, data, current_user, request)
    if order.get("coupon_code"):
        await _insert_log("log_coupons", {"coupon_id": order.get("coupon_id"), "coupon_code": order["coupon_code"], "user_id": current_user["user_id"], "action": "coupon_used", "order_id": order["tx_id"], "discount_amount": order.get("discount_amount",0), "discount_type": "fixed_amount", "original_total": order.get("subtotal",0)+order.get("delivery_fee",0), "final_total": order.get("total",0), "performed_by": "user", "admin_id": None, "admin_note": None}, request)
    if order["payment_method"] != "online_card":
        # Nakit/tezgah: sipariş kesinleşti -> kuponu şimdi tüket.
        await _consume_coupon_for_order(order, request)
        return {"success": True, "tx_id": order["tx_id"], "order": _compat_json_clean(_customer_order_view(order))}
    paytr = await _init_paytr_token(order, request, current_user.get("email"))
    await db.transactions.update_one({"tx_id": order["tx_id"]}, {"$set": {"merchant_oid": paytr.get("merchant_oid"), "paytr_init": paytr, "updated_at": now_utc()}})
    if not paytr.get("success"):
        raise HTTPException(status_code=503 if not paytr.get("configured") else 400, detail=paytr.get("message") or "PayTR ödeme başlatılamadı")
    return {"success": True, "tx_id": order["tx_id"], "payment_url": paytr.get("payment_url"), "token": paytr.get("token")}



@router.post("/payment/paytr/iframe-token")
async def get_paytr_iframe_token(data: dict, request: Request, current_user: dict = Depends(get_current_admin)):
    """PayTR iFrame token (yalnızca yönetici testi). Uygulama gerçek ödemede /api/payments/init kullanır;
    serbest tutarlı bu uç GÜVENLİK gereği yönetici oturumuna kilitlendi."""
    keys = _paytr_keys_status()
    if not all(keys.values()):
        return {"success": False, "configured": False, "keys": keys, "message": "PayTR API anahtarları backend .env içinde tanımlı değil"}

    merchant_oid = str(data.get("order_id") or data.get("merchant_oid") or new_id("tx"))
    amount = _as_float(data.get("amount"), 0)
    raw_basket = data.get("basket") or data.get("items") or []
    items = []
    for item in raw_basket:
        qty = _as_float(item.get("qty") or item.get("quantity"), 1)
        price = _as_float(item.get("price") or item.get("unit_price") or item.get("line_total") or item.get("total_price"), 0)
        items.append({
            "name": str(item.get("name") or item.get("product_name") or "Ürün"),
            "qty": qty,
            "line_total": price * qty if not item.get("line_total") and not item.get("total_price") else price,
        })
    if not items:
        items = [{"name": "Test Ürün", "qty": 1, "line_total": amount}]

    user = current_user or {}
    order = {
        "tx_id": merchant_oid,
        "merchant_oid": merchant_oid,
        "amount": amount,
        "user_id": user.get("user_id") or "paytr_test",
        "user_name": data.get("user_name") or user.get("name") or "Afro Gıda Müşteri",
        "user_phone": data.get("user_phone") or user.get("phone") or "+905380557577",
        "address": data.get("user_address") or data.get("address") or "Bursa",
        "items": items,
    }
    email = data.get("email") or data.get("user_email") or user.get("email") or "musteri@afrogida.com.tr"
    paytr = await _init_paytr_token(order, request, email)
    if paytr.get("success"):
        paytr_merchant_oid = paytr.get("merchant_oid") or merchant_oid
        await db.transactions.update_one(
            {"tx_id": merchant_oid},
            {"$setOnInsert": {"tx_id": merchant_oid, "created_at": now_utc()}, "$set": {"merchant_oid": paytr_merchant_oid, "amount": amount, "payment_method": "online_card", "payment_status": "pending", "paytr_init": paytr, "updated_at": now_utc()}},
            upsert=True,
        )
        return {"success": True, "token": paytr.get("token"), "iframe_url": paytr.get("payment_url"), "payment_url": paytr.get("payment_url")}
    raise HTTPException(status_code=503 if not paytr.get("configured") else 400, detail=paytr.get("message") or "PayTR token alınamadı")

@router.post("/payment/paytr/callback")
@router.post("/payments/paytr/callback")
async def paytr_callback(request: Request):
    from urllib.parse import parse_qs
    body = (await request.body()).decode("utf-8", errors="ignore")
    parsed = parse_qs(body, keep_blank_values=True)
    form_data = {k: (v[0] if isinstance(v, list) and v else "") for k, v in parsed.items()}
    merchant_oid = form_data.get("merchant_oid")
    status = form_data.get("status")
    total_amount = form_data.get("total_amount")
    hash_val = form_data.get("hash")

    expected = paytr_callback_expected_hash(merchant_oid, status, total_amount)
    if expected is None:
        return PlainTextResponse("PAYTR_CONFIG_MISSING")
    if not merchant_oid or not status or not total_amount or not hash_val:
        return PlainTextResponse("PAYTR_MISSING_FIELDS")

    if hash_val != expected:
        await _insert_log("log_security", {"event_type": "unauthorized_access", "source_ip": _extract_request_meta(request)["ip_address"], "user_id": None, "details": {"reason": "PayTR hash doğrulama başarısız", "merchant_oid": merchant_oid}, "severity": "critical", "resolved": False}, request)
        return PlainTextResponse("PAYTR_HASH_MISMATCH")

    update = {
        "paytr_callback": dict(form_data),
        "paytr_total_amount": total_amount,
        "updated_at": now_utc(),
    }
    # GÜVENLİK: PayTR'ın bildirdiği tutar (kuruş) sipariş tutarıyla eşleşmeli; ayrıca imza kontrolü
    _cb_order = await db.transactions.find_one({"$or": [{"merchant_oid": merchant_oid}, {"tx_id": merchant_oid}]}, {"_id": 0})
    if status == "success" and _cb_order and _cb_order.get("amount") is not None:
        try:
            _paid_kurus = int(str(total_amount).strip())
        except Exception:
            _paid_kurus = -1
        _expected_kurus = int((money_d(_cb_order.get("amount")) * 100).to_integral_value(rounding=ROUND_HALF_UP))
        _sig_ok = verify_order_signature(_cb_order) if _cb_order.get("calc_signature") else True
        if _paid_kurus != _expected_kurus or not _sig_ok:
            await security_alarm(
                "payment_amount_mismatch",
                {"summary": f"odenen {_paid_kurus} krs, beklenen {_expected_kurus} krs", "merchant_oid": merchant_oid, "tx_id": _cb_order.get("tx_id"),
                 "paid_kurus": _paid_kurus, "expected_kurus": _expected_kurus, "signature_ok": _sig_ok},
                request, {"user_id": _cb_order.get("user_id"), "name": _cb_order.get("user_name")}, severity="critical", notify=True,
            )
            update.update({"payment_status": "suspicious", "status": "payment_amount_mismatch", "order_status": "iptal",
                           "security_hold": True, "security_note": f"PayTR tutarı ({_paid_kurus} krş) sipariş tutarıyla ({_expected_kurus} krş) uyuşmuyor"})
            await db.transactions.update_one({"$or": [{"merchant_oid": merchant_oid}, {"tx_id": merchant_oid}]}, {"$set": update})
            await _insert_log("log_payments", {"order_id": _cb_order.get("tx_id"), "user_id": _cb_order.get("user_id"), "payment_provider": "PayTR", "transaction_id": merchant_oid, "action": "payment_amount_mismatch", "amount": _paid_kurus / 100, "payment_method": "credit_card", "card_last_four": None, "error_message": update["security_note"], "paytr_hash_valid": True}, request)
            return PlainTextResponse("OK")
    if status == "success":
        # Online ödeme onaylandığında ödeme "Ödendi" olur ama sipariş iş akışı durumu
        # nakit siparişlerle AYNI şekilde "Talep Alındı"da kalır (esnaf yeni talebi görüp
        # onaylasın). Eskiden otomatik "hazirlik_bekliyor"a atlıyordu; kaldırıldı.
        update.update({"payment_status": "paid", "status": "confirmed", "order_status": "talep_alindi"})
    else:
        update.update({"payment_status": "failed", "status": "payment_failed", "paytr_failed_reason": form_data.get("failed_reason_msg") or form_data.get("failed_reason_code")})

    await db.transactions.update_one({"$or": [{"merchant_oid": merchant_oid}, {"tx_id": merchant_oid}]}, {"$set": update})
    await db.orders.update_one({"$or": [{"merchant_oid": merchant_oid}, {"tx_id": merchant_oid}, {"order_id": merchant_oid}]}, {"$set": update})
    # --- LOG: PayTR callback ---
    _pt_order = await db.transactions.find_one({"$or": [{"merchant_oid": merchant_oid}, {"tx_id": merchant_oid}]}, {"_id": 0, "tx_id": 1, "user_id": 1, "coupon_code": 1, "coupon_consumed": 1})
    _pt_uid = (_pt_order or {}).get("user_id")
    _pt_txid = (_pt_order or {}).get("tx_id", merchant_oid)
    if status == "success":
        await _insert_log("log_payments", {"order_id": _pt_txid, "user_id": _pt_uid, "payment_provider": "PayTR", "transaction_id": merchant_oid, "action": "payment_success", "amount": _as_float(total_amount,0)/100, "payment_method": "credit_card", "card_last_four": None, "error_message": None, "paytr_hash_valid": True}, request)
        await _insert_log("log_orders", {"order_id": _pt_txid, "user_id": _pt_uid, "action": "order_confirmed", "performed_by": "system", "admin_id": None, "admin_note": None, "order_snapshot": None}, request)
        # Online kart ödemesi BAŞARILI -> kuponu şimdi tüket (başarısız ödemede sayaç artmaz).
        if _pt_order:
            await _consume_coupon_for_order(_pt_order, request)
    else:
        await _insert_log("log_payments", {"order_id": _pt_txid, "user_id": _pt_uid, "payment_provider": "PayTR", "transaction_id": merchant_oid, "action": "payment_failed", "amount": _as_float(total_amount,0)/100, "payment_method": "credit_card", "card_last_four": None, "error_message": f"PayTR status: {status}", "paytr_hash_valid": True}, request)
    return PlainTextResponse("OK")

@router.post("/payment/paytr")
async def compat_payment_paytr(data: dict, request: Request, current_user: dict = Depends(get_current_admin)):
    """Yalnızca yönetici testi (serbest tutar). Müşteri akışı /api/payments/init."""
    keys = _paytr_keys_status()
    if not all(keys.values()):
        return {"success": False, "configured": False, "keys": keys, "message": "PayTR API anahtarları backend .env içinde tanımlı değil"}
    order = {
        "tx_id": str(data.get("order_id") or new_id("tx")),
        "amount": _as_float(data.get("amount"), 0),
        "user_id": "paytr_test",
        "user_name": data.get("user_name") or "Test Kullanıcı",
        "user_phone": data.get("user_phone") or "+905380557577",
        "address": data.get("user_address") or "Bursa",
        "items": [{"name": "Test Sipariş", "line_total": _as_float(data.get("amount"), 0), "qty": 1}],
    }
    paytr = await _init_paytr_token(order, request, data.get("user_email"))
    return {"success": bool(paytr.get("success")), "configured": True, **paytr}
