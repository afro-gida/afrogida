"""Müşteri sipariş endpoint'leri: kullanıcı bilgisi, sipariş oluştur/listele, ziyaret kaydı."""
from typing import Optional

from fastapi import APIRouter, Depends, Request

from core.db import db
from core.logs import _record_visit
from core.security import get_current_user, get_current_user_optional, rate_limit
from services.orders import (
    _customer_order_view, _prepare_order_payload, _consume_coupon_for_order,
    _log_order_agreement, _compat_json_clean,
)

router = APIRouter(prefix="/api")


@router.get("/user/me")
async def get_user_me(user: dict = Depends(get_current_user)):
    """Mevcut kullanıcının bilgilerini döndürür (hassas bilgiler filtrelenmiş)."""
    return {
        "user_id": user.get("user_id"),
        "name": user.get("name"),
        "phone": user.get("phone"),
        "email": user.get("email"),
        "role": user.get("role"),
        "supplier_group": user.get("supplier_group") or user.get("supplier_name"),
    }


@router.get("/orders")
async def compat_list_my_orders(current_user: dict = Depends(get_current_user)):
    rows = await db.transactions.find({"user_id": current_user.get("user_id")}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [_customer_order_view(o) for o in rows]


@router.post("/orders")
async def compat_create_order(data: dict, current_user: dict = Depends(get_current_user), request: Request = None):
    await rate_limit(f"order_user:{current_user.get('user_id')}", 12, 300, "Çok sık sipariş denemesi. Lütfen biraz bekleyin.")
    order = await _prepare_order_payload(data, current_user, request)
    await db.transactions.insert_one(order)
    # Sipariş anındaki sözleşme onayını sipariş no ile logla.
    await _log_order_agreement(order, data, current_user, request)
    # Ödeme adımı olmayan doğrudan sipariş -> kuponu hemen tüket.
    await _consume_coupon_for_order(order)
    return {"success": True, "tx_id": order["tx_id"], "order": _compat_json_clean(_customer_order_view(order))}


@router.get("/visit")
async def compat_get_visit(current_user: Optional[dict] = Depends(get_current_user_optional)):
    return await _record_visit({"method": "GET"}, current_user)


@router.post("/visit")
async def compat_post_visit(data: dict = None, current_user: Optional[dict] = Depends(get_current_user_optional)):
    return await _record_visit(data or {"method": "POST"}, current_user)
