"""Kurye endpoint'leri: online/offline, istatistik, atanan siparişler, yola çıkma, teslimat kodu doğrulama."""
import hmac
from datetime import datetime, timezone

import pytz as _pytz
from fastapi import APIRouter, Depends, HTTPException

from core.crypto import dec_str
from core.db import db
from core.security import get_current_courier, get_user_courier_market, get_user_courier_markets, _afro_market_eq, rate_limit
from core.util import now_utc, new_id
from services.push import send_push_to_users

router = APIRouter(prefix="/api/courier")

COURIER_ACTIVE_STATUSES = ["talep_alindi", "hazirlik_bekliyor", "hazirlaniyor", "hazir", "yolda"]


def _courier_items_view(o: dict):
    out = []
    for it in (o.get("items") or []):
        out.append({
            "name": it.get("product_name_snapshot") or it.get("name") or it.get("product_name") or "Ürün",
            "qty": it.get("qty") or it.get("quantity") or 1,
            "unit": it.get("unit_snapshot") or it.get("unit") or "",
            "note": it.get("note") or it.get("customization_note") or "",
            "selected_options": it.get("selected_options") or [],
        })
    return out


def _courier_order_view(o: dict) -> dict:
    return {
        "tx_id": o.get("tx_id"),
        "order_status": o.get("order_status"),
        "payment_status": o.get("payment_status"),
        "payment_method": o.get("payment_method"),
        "delivery_type": o.get("delivery_type"),
        "market_name": o.get("market_name") or "",
        "amount": o.get("amount"),
        "delivery_fee": o.get("delivery_fee"),
        "address": dec_str(o.get("address")) or "",
        "delivery_neighborhood": o.get("delivery_neighborhood") or "",
        "user_name": o.get("user_name") or "",
        "customer_phone": o.get("user_phone") or "",  # liste ucunda gerçek telefonla değiştirilir
        "items": _courier_items_view(o),
        "created_at": o.get("created_at"),
        "delivery_slot_start": o.get("delivery_slot_start"),
        "delivery_slot_end": o.get("delivery_slot_end"),
        "delivered_at": o.get("delivered_at"),
        "departed_at": o.get("departed_at"),
        "courier_id": o.get("courier_id"),
        "courier_name": o.get("courier_name"),
        "delivery_code": dec_str(o.get("delivery_code")) if o.get("order_status") in ("hazir", "yolda") else None,
    }


async def _courier_resolve_phone(o: dict) -> str:
    """Kuryeye gerçek (maskesiz) müşteri telefonu ver — arayabilsin."""
    if o.get("user_id"):
        u = await db.users.find_one({"user_id": o["user_id"]}, {"_id": 0, "phone": 1})
        if u and u.get("phone"):
            return u["phone"]
    return o.get("customer_phone") or ""


def _courier_market_guard(current: dict, order: dict):
    """Kurye yalnızca kendi pazarlarının siparişine dokunabilir (yönetici serbest)."""
    if current.get("role") == "kurye":
        mkts = get_user_courier_markets(current)
        if mkts and not any(_afro_market_eq(order.get("market_name"), m) for m in mkts):
            raise HTTPException(status_code=403, detail="Bu sipariş sizin pazarlarınıza ait değil.")


@router.put("/toggle-online")
async def courier_toggle_online(payload: dict, current: dict = Depends(get_current_courier)):
    """Kurye kendi online/offline durumunu değiştirir."""
    is_online = bool(payload.get("is_online", True))
    await db.users.update_one(
        {"user_id": current.get("user_id")},
        {"$set": {"courier_is_online": is_online, "updated_at": now_utc()}}
    )
    return {"ok": True, "is_online": is_online}


@router.get("/stats")
async def courier_stats(date: str = "", current: dict = Depends(get_current_courier)):
    """Kurye kendi istatistiklerini görür (seçili gün + toplam)."""
    TR = _pytz.timezone("Europe/Istanbul")
    if date:
        try:
            day_tr = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=TR)
        except Exception:
            raise HTTPException(status_code=400, detail="Geçersiz tarih")
    else:
        day_tr = datetime.now(TR).replace(hour=0, minute=0, second=0, microsecond=0)
    day_start = day_tr.astimezone(timezone.utc)
    # day_end: İstanbul günü 23:59:59'u UTC'ye çevir
    day_end = day_tr.replace(hour=23, minute=59, second=59, microsecond=999999).astimezone(timezone.utc)
    uid = current.get("user_id")
    fee = float(current.get("courier_per_package_fee") or 0)

    total_delivered = await db.transactions.count_documents({
        "courier_id": uid, "order_status": "teslim_edildi"
    })
    day_delivered = await db.transactions.count_documents({
        "courier_id": uid, "order_status": "teslim_edildi",
        "delivered_at": {"$gte": day_start, "$lte": day_end}
    })
    return {
        "is_online": bool(current.get("courier_is_online")),
        "per_package_fee": fee,
        "total_delivered": total_delivered,
        "day_delivered": day_delivered,
        "day_earnings": round(day_delivered * fee, 2),
        "total_earnings": round(total_delivered * fee, 2),
        "date": day_tr.strftime("%Y-%m-%d"),
    }


@router.get("/me")
async def courier_me(current: dict = Depends(get_current_courier)):
    return {
        "user_id": current.get("user_id"),
        "name": current.get("name"),
        "role": current.get("role"),
        "courier_market": get_user_courier_market(current),
        "courier_markets": get_user_courier_markets(current),
    }


@router.get("/orders")
async def courier_list_orders(current: dict = Depends(get_current_courier)):
    """Kuryenin pazarlarındaki aktif (teslim edilmemiş) EVE SERVİS siparişleri."""
    mkts = get_user_courier_markets(current)
    mkt = mkts[0] if mkts else None
    is_admin = current.get("role") in ("admin", "yonetici")
    q = {"delivery_type": "eve_servis", "order_status": {"$in": COURIER_ACTIVE_STATUSES}}
    orders = await db.transactions.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    result = []
    for o in orders:
        if (not is_admin) and mkts and not any(_afro_market_eq(o.get("market_name"), m) for m in mkts):
            continue
        view = _courier_order_view(o)
        view["customer_phone"] = await _courier_resolve_phone(o)
        result.append(view)
    return {"market": mkt, "markets": mkts, "count": len(result), "orders": result}


@router.get("/orders/history")
async def courier_order_history(current: dict = Depends(get_current_courier)):
    """Kuryenin teslim ettiği geçmiş siparişler (yönetici: pazarındaki tüm teslimler)."""
    is_admin = current.get("role") in ("admin", "yonetici")
    q = {"delivery_type": "eve_servis", "order_status": "teslim_edildi"}
    if not is_admin:
        q["courier_id"] = current.get("user_id")
    orders = await db.transactions.find(q, {"_id": 0}).sort("delivered_at", -1).to_list(300)
    return {"orders": [_courier_order_view(o) for o in orders]}


@router.post("/orders/{tx_id}/depart")
async def courier_depart(tx_id: str, current: dict = Depends(get_current_courier)):
    """Kurye 'Yola Çıktım' -> durum 'yolda'. Sipariş 'hazir' olmalıdır."""
    order = await db.transactions.find_one({"tx_id": tx_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Sipariş bulunamadı")
    _courier_market_guard(current, order)
    cur = str(order.get("order_status") or "").strip().lower()
    if cur == "yolda":
        return await db.transactions.find_one({"tx_id": tx_id}, {"_id": 0})  # idempotent
    if cur != "hazir":
        raise HTTPException(status_code=400, detail="Sipariş 'Hazır' olduğunda yola çıkabilirsiniz.")
    updates = {
        "order_status": "yolda",
        "updated_at": now_utc(),
        "departed_at": now_utc(),
        "courier_id": current.get("user_id"),
        "courier_name": current.get("name"),
    }
    await db.transactions.update_one({"tx_id": tx_id}, {"$set": updates})
    await db.orders.update_one({"$or": [{"tx_id": tx_id}, {"order_id": tx_id}]}, {"$set": updates})
    await db.order_status_logs.insert_one({
        "id": new_id("olog"), "tx_id": tx_id, "updates": updates,
        "action": "courier_depart",
        "admin_user_id": current.get("user_id"), "admin_name": current.get("name"),
        "created_at": now_utc(),
    })

    # ── PUSH BİLDİRİM: Kurye yola çıktı → müşteriye bildir ──
    customer_id = order.get("user_id")
    if customer_id:
        try:
            courier_name = current.get("name") or "Kurye"
            await send_push_to_users(
                [customer_id],
                title="🛵 Siparişiniz Yola Çıktı!",
                body=f"{courier_name} siparişinizi teslim etmeye geliyor.",
                data={"type": "order_shipped", "tx_id": tx_id, "url": "/my-orders"},
            )
        except Exception:
            pass

    return await db.transactions.find_one({"tx_id": tx_id}, {"_id": 0})


@router.post("/orders/{tx_id}/verify-delivery-code")
async def courier_verify_delivery_code(tx_id: str, data: dict, current: dict = Depends(get_current_courier)):
    """Kurye 'Teslim Ettim' -> müşterinin SMS ile aldığı teslim kodunu doğrula -> teslim_edildi."""
    order = await db.transactions.find_one({"tx_id": tx_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Sipariş bulunamadı")
    _courier_market_guard(current, order)

    submitted = str(data.get("pickup_code") or data.get("code") or data.get("delivery_code") or "").strip()
    if not submitted:
        raise HTTPException(status_code=400, detail="Lütfen teslim kodunu girin")
    expected = str(dec_str(order.get("delivery_code")) or "").strip()
    if not expected:
        raise HTTPException(status_code=400, detail="Bu sipariş için henüz teslim kodu oluşturulmadı. Sipariş 'Hazır' olmalı.")
    await rate_limit(f"courier_verify:{current.get('user_id')}", 15, 600, "Çok fazla hatalı kod denemesi. 10 dakika bekleyin.")
    if not hmac.compare_digest(submitted, expected):
        raise HTTPException(status_code=400, detail="Teslim kodu hatalı. Müşterinin SMS ile aldığı 6 haneli kodu girin.")
    exp = order.get("delivery_code_expires_at")
    if exp is not None:
        try:
            exp_cmp = exp if getattr(exp, "tzinfo", None) else exp.replace(tzinfo=timezone.utc)
            if now_utc() > exp_cmp:
                raise HTTPException(status_code=400, detail="Teslim kodunun süresi doldu.")
        except HTTPException:
            raise
        except Exception:
            pass

    updates = {
        "order_status": "teslim_edildi",
        "delivered_at": now_utc(),
        "delivery_verified": True,
        "updated_at": now_utc(),
        "courier_id": order.get("courier_id") or current.get("user_id"),
        "courier_name": order.get("courier_name") or current.get("name"),
    }
    cur_pay = str(order.get("payment_status") or "").strip().lower()
    if cur_pay not in ("paid", "iade_edildi", "kismi_iade_edildi"):
        updates["payment_status"] = "paid"
    await db.transactions.update_one({"tx_id": tx_id}, {"$set": updates})
    await db.orders.update_one({"$or": [{"tx_id": tx_id}, {"order_id": tx_id}]}, {"$set": updates})
    await db.order_status_logs.insert_one({
        "id": new_id("olog"), "tx_id": tx_id, "updates": updates,
        "action": "courier_verify_delivery_code",
        "admin_user_id": current.get("user_id"), "admin_name": current.get("name"),
        "created_at": now_utc(),
    })
    return await db.transactions.find_one({"tx_id": tx_id}, {"_id": 0})
