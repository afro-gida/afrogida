"""Pazar Sorumlusu — kısıtlı yönetici rolü.

Tam admin ("admin"/"yonetici" — DB'de "yonetici" ZATEN tam admin anlamına
geliyor, gerçek üretim admin hesabı bu rolde, bkz. core/security.py notu)
ile KARIŞTIRILMAMALI: bu, sadece kendine atanmış pazar(lar)daki (managed_markets)
tedarikçileri denetleyip atayabilen/kaldırabilen, admin panelinin geri kalanına
HİÇ erişimi olmayan ayrı ve dar kapsamlı bir rol. Yetki sınırı her endpoint'te
ayrı ayrı kontrol edilir (sadece frontend'de gizlemek yetmez — güvenlik burada).
"""
from datetime import datetime, timedelta
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request

from core.crypto import dec_str, enc_str
from core.db import db
from core.logs import _insert_log
from core.security import get_current_pazar_sorumlusu, get_user_managed_markets
from core.util import _afro_norm, now_utc
from services.catalog import _read_catalog_config, _write_catalog_config
from services.push import send_push_to_courier_markets, send_push_to_users
from services.sms import _generate_sms_code, send_delivery_sms

SORUMLU_SETTABLE_STATUSES = {"hazirlik_bekliyor", "hazirlaniyor", "hazir"}
ORDER_FINAL_STATUSES = {"teslim_edildi", "iptal_edildi", "teslim_alinmadi", "musteri_gelmedi_iptal"}

router = APIRouter(prefix="/api/pazar-sorumlusu")


async def _managed_market_docs(user: dict) -> List[dict]:
    ids = get_user_managed_markets(user)
    if not ids:
        return []
    return await db.markets.find({"id": {"$in": ids}}, {"_id": 0}).to_list(200)


def _require_managed(market_id: str, managed_docs: List[dict]) -> dict:
    doc = next((m for m in managed_docs if m.get("id") == market_id), None)
    if not doc:
        raise HTTPException(status_code=403, detail="Bu pazar size atanmamış")
    return doc


@router.get("/markets")
async def pazar_sorumlusu_markets(user: dict = Depends(get_current_pazar_sorumlusu)):
    """Kendine atanmış pazar(lar)ın listesi."""
    return await _managed_market_docs(user)


@router.get("/suppliers")
async def pazar_sorumlusu_suppliers(user: dict = Depends(get_current_pazar_sorumlusu)):
    """Kendine atanmış pazar(lar)dan herhangi birinde çalışan tedarikçiler
    (catalog_config.supplier_markets'e göre)."""
    managed = await _managed_market_docs(user)
    managed_names = {_afro_norm(m.get("name") or "") for m in managed}
    if not managed_names:
        return []
    cfg = await _read_catalog_config()
    result = []
    for sg, mkts in ((cfg or {}).get("supplier_markets") or {}).items():
        matched = [m for m in (mkts or []) if _afro_norm(m) in managed_names]
        if matched:
            result.append({"supplier_group": sg, "markets": matched})
    return result


def _mask_phone(phone: str) -> str:
    digits = "".join(c for c in (phone or "") if c.isdigit())
    if len(digits) < 6:
        return phone or ""
    return f"{digits[:4]} *** **{digits[-2:]}"


def _sorumlu_order_view(o: dict, detailed: bool = False) -> dict:
    items = []
    for it in (o.get("items") or []):
        items.append({
            "name": it.get("product_name_snapshot") or it.get("name") or it.get("product_name") or "Ürün",
            "qty": it.get("qty") or it.get("quantity") or 1,
            "unit": it.get("unit_snapshot") or it.get("unit") or "",
            "note": it.get("note") or it.get("customization_note") or "",
            "selected_options": it.get("selected_options") or [],
            "supplier_group": it.get("supplier_group_snapshot") or it.get("supplier_group") or "",
        })
    out = {
        "tx_id": o.get("tx_id"),
        "order_status": o.get("order_status"),
        "payment_status": o.get("payment_status"),
        "payment_method": o.get("payment_method"),
        "delivery_type": o.get("delivery_type"),
        "market_name": o.get("market_name") or "",
        "amount": o.get("amount"),
        "delivery_fee": o.get("delivery_fee"),
        "user_name": o.get("user_name") or "",
        "customer_phone_masked": _mask_phone(o.get("user_phone") or o.get("customer_phone") or ""),
        "items": items,
        "created_at": o.get("created_at"),
        "delivery_slot_start": o.get("delivery_slot_start"),
        "delivery_slot_end": o.get("delivery_slot_end"),
        "delivered_at": o.get("delivered_at"),
        "courier_id": o.get("courier_id"),
        "courier_name": o.get("courier_name"),
        "refund_status": o.get("refund_status") or "",
        "refund_amount": o.get("refund_amount"),
        "cancel_reason": o.get("cancel_reason"),
        "return_request": o.get("return_request"),
    }
    if detailed:
        out["delivery_neighborhood"] = o.get("delivery_neighborhood") or ""
        out["address"] = dec_str(o.get("address")) if o.get("delivery_type") == "eve_servis" else None
    return out


def _order_date_filter(filter_type: str) -> dict:
    now = now_utc()
    if filter_type == "today":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif filter_type == "last_7_days":
        start = now - timedelta(days=7)
    elif filter_type == "last_1_month":
        start = now - timedelta(days=30)
    else:
        return {}
    return {"created_at": {"$gte": start}}


async def _sorumlu_order_or_404(tx_id: str, managed_names: set) -> dict:
    order = await db.transactions.find_one({"tx_id": tx_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Sipariş bulunamadı")
    if _afro_norm(order.get("market_name") or "") not in managed_names:
        raise HTTPException(status_code=403, detail="Bu sipariş sizin pazarınıza ait değil")
    return order


@router.get("/orders")
async def pazar_sorumlusu_orders(filter_type: str = "today", user: dict = Depends(get_current_pazar_sorumlusu)):
    """Sorumlunun pazar(lar)ındaki siparişler (takip amaçlı liste)."""
    managed = await _managed_market_docs(user)
    managed_names = {_afro_norm(m.get("name") or "") for m in managed}
    if not managed_names:
        return []
    q = _order_date_filter(filter_type)
    orders = await db.transactions.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [
        _sorumlu_order_view(o)
        for o in orders
        if _afro_norm(o.get("market_name") or "") in managed_names
    ]


@router.get("/orders/{tx_id}")
async def pazar_sorumlusu_order_detail(tx_id: str, user: dict = Depends(get_current_pazar_sorumlusu)):
    """Sorumlunun kendi pazarındaki bir siparişin tam detayı."""
    managed = await _managed_market_docs(user)
    managed_names = {_afro_norm(m.get("name") or "") for m in managed}
    order = await _sorumlu_order_or_404(tx_id, managed_names)
    return _sorumlu_order_view(order, detailed=True)


@router.post("/orders/{tx_id}/status")
async def pazar_sorumlusu_update_order_status(tx_id: str, data: dict, user: dict = Depends(get_current_pazar_sorumlusu), request: Request = None):
    """Sorumlu, kendi pazarındaki bir siparişi hazırlık aşamaları arasında
    ilerletebilir (Hazırlık Bekliyor / Hazırlanıyor / Hazır). Yolda/Teslim
    Edildi/İptal gibi durumlar KASITLI olarak dışarıda tutuldu — kurye kendi
    teslim akışını (teslim kodu doğrulama) atlamasın, para/iade ile ilgili
    kararlar (iptal, teslim alınmadı) admin'de kalsın."""
    new_status = str((data or {}).get("order_status") or "").strip().lower()
    if new_status not in SORUMLU_SETTABLE_STATUSES:
        raise HTTPException(status_code=400, detail="Sorumlu sadece Hazırlık Bekliyor / Hazırlanıyor / Hazır durumlarını ayarlayabilir")

    managed = await _managed_market_docs(user)
    managed_names = {_afro_norm(m.get("name") or "") for m in managed}
    order = await _sorumlu_order_or_404(tx_id, managed_names)

    current_status = str(order.get("order_status") or "").strip().lower()
    if current_status in ORDER_FINAL_STATUSES:
        raise HTTPException(status_code=400, detail=f"Bu sipariş '{order.get('order_status')}' durumunda, değişiklik yapılamaz.")

    updates = {"order_status": new_status, "updated_at": now_utc()}
    delivery_sms_sent = None

    # "Hazır" işaretlenince kurye teslim kodu üretilip müşteriye SMS'le
    # gönderilir - admin panelindeki akışla aynı (bkz. admin_orders.py).
    if new_status == "hazir" and current_status != "hazir":
        delivery_code = dec_str(order.get("delivery_code")) or _generate_sms_code()
        delivery_expires_at = datetime.now().replace(hour=23, minute=59, second=0, microsecond=0)
        updates["delivery_code"] = enc_str(delivery_code)
        updates["delivery_code_expires_at"] = delivery_expires_at
        user_phone = None
        if order.get("user_id"):
            user_doc = await db.users.find_one({"user_id": order.get("user_id")}, {"_id": 0, "phone": 1})
            user_phone = (user_doc or {}).get("phone")
        if not user_phone:
            user_phone = order.get("phone") or order.get("customer_phone")
        delivery_sms_sent = send_delivery_sms(user_phone, tx_id, delivery_code) if user_phone else False
        updates["delivery_sms_sent"] = delivery_sms_sent
        updates["delivery_sms_sent_at"] = now_utc() if delivery_sms_sent else None
        sms_state = "sent" if delivery_sms_sent else "failed"
        updates["sms_status"] = sms_state
        updates["pickup_sms_status"] = sms_state

    await db.transactions.update_one({"tx_id": tx_id}, {"$set": updates})
    await db.orders.update_one({"$or": [{"tx_id": tx_id}, {"order_id": tx_id}]}, {"$set": updates})

    await _insert_log("log_orders", {
        "order_id": tx_id, "user_id": order.get("user_id"),
        "action": f"status_{new_status}", "performed_by": "pazar_sorumlusu",
        "admin_id": user.get("user_id"), "admin_note": "", "order_snapshot": None,
    }, request)
    await _insert_log("log_admin", {
        "admin_id": user.get("user_id"), "admin_name": user.get("name", ""),
        "action": "pazar_sorumlusu_order_status_changed", "target_type": "order", "target_id": tx_id,
        "change_details": {"field": "order_status", "old_value": current_status, "new_value": new_status},
        "admin_note": "",
    }, request)
    if delivery_sms_sent is not None:
        try:
            from core.logs import _log_sms_send
            await _log_sms_send(order.get("user_id"), order.get("phone") or "", "delivery_code", "teslim_kodu_v1", bool(delivery_sms_sent), request)
        except Exception:
            pass

    # "Hazır" olunca pazardaki kuryelere push bildirimi (admin akışıyla aynı).
    if new_status == "hazir" and current_status != "hazir":
        mkt = order.get("market_name") or ""
        try:
            await send_push_to_courier_markets(
                [mkt] if mkt else [],
                title="🛵 Yeni Sipariş Hazır!",
                body=f"{mkt + ' — ' if mkt else ''}Teslim bekleyen yeni bir sipariş var.",
                data={"type": "new_order", "tx_id": tx_id, "url": "/courier-panel"},
            )
        except Exception:
            pass

    return {"success": True}


@router.post("/orders/{tx_id}/return-request")
async def pazar_sorumlusu_request_return(tx_id: str, data: dict, user: dict = Depends(get_current_pazar_sorumlusu), request: Request = None):
    """Sorumlu doğrudan iade YAPAMAZ (para hareketi admin işidir) - sadece
    hangi ürünler için, neden iade istendiğini işaretleyen bir TALEP oluşturur.
    Admin bu talebi Loglar'dan görüp gerçek iadeyi kendisi işler."""
    managed = await _managed_market_docs(user)
    managed_names = {_afro_norm(m.get("name") or "") for m in managed}
    order = await _sorumlu_order_or_404(tx_id, managed_names)

    item_indices = [int(i) for i in ((data or {}).get("item_indices") or [])]
    reason = str((data or {}).get("reason") or "").strip()
    if not item_indices:
        raise HTTPException(status_code=400, detail="İade istenecek en az bir ürün seçilmelidir")

    items = order.get("items") or []
    item_names = [
        (items[i].get("product_name_snapshot") or items[i].get("name") or "Ürün")
        for i in item_indices if 0 <= i < len(items)
    ]
    return_request = {
        "item_indices": item_indices,
        "item_names": item_names,
        "reason": reason,
        "requested_by": user.get("user_id"),
        "requested_by_name": user.get("name") or "",
        "requested_at": now_utc(),
    }
    await db.transactions.update_one({"tx_id": tx_id}, {"$set": {"return_request": return_request}})

    await _insert_log("log_admin", {
        "admin_id": user.get("user_id"), "admin_name": user.get("name", ""),
        "action": "pazar_sorumlusu_return_requested", "target_type": "order", "target_id": tx_id,
        "change_details": {"items": item_names, "reason": reason},
        "admin_note": "Sorumlu iade talebi oluşturdu - gerçek iade admin tarafından yapılmalı.",
    }, request)
    return {"success": True}


@router.post("/orders/{tx_id}/notify-courier")
async def pazar_sorumlusu_notify_courier(tx_id: str, data: dict, user: dict = Depends(get_current_pazar_sorumlusu), request: Request = None):
    """Sorumlu bir siparişi doğrudan bir kuryeye ATAMAZ (kurye kendi pazarındaki
    hazır siparişleri kendisi 'yola çıkar' ile üstlenir) - sadece o kuryeye bu
    sipariş için bir bildirim göndererek yönlendirebilir."""
    managed = await _managed_market_docs(user)
    managed_names = {_afro_norm(m.get("name") or "") for m in managed}
    order = await _sorumlu_order_or_404(tx_id, managed_names)

    courier_id = str((data or {}).get("courier_user_id") or "").strip()
    if not courier_id:
        raise HTTPException(status_code=400, detail="Kurye seçilmelidir")
    courier = await db.users.find_one({"user_id": courier_id, "role": "kurye"}, {"_id": 0, "courier_markets": 1, "courier_market": 1, "name": 1})
    if not courier:
        raise HTTPException(status_code=404, detail="Kurye bulunamadı")
    mkts = courier.get("courier_markets") or ([courier.get("courier_market")] if courier.get("courier_market") else [])
    if not any(_afro_norm(m) in managed_names for m in mkts):
        raise HTTPException(status_code=403, detail="Bu kurye sizin pazarınızda değil")

    sent = await send_push_to_users(
        [courier_id],
        "Sipariş bekliyor",
        f"{order.get('market_name') or ''} pazarında bir sipariş sizi bekliyor (₺{order.get('amount') or 0}).",
        {"type": "order_notify", "tx_id": tx_id},
    )

    await _insert_log("log_admin", {
        "admin_id": user.get("user_id"), "admin_name": user.get("name", ""),
        "action": "pazar_sorumlusu_notified_courier", "target_type": "order", "target_id": tx_id,
        "change_details": {"courier_id": courier_id, "courier_name": courier.get("name") or "", "push_sent": sent > 0},
        "admin_note": "",
    }, request)
    return {"success": True, "push_sent": sent > 0}


@router.get("/couriers")
async def pazar_sorumlusu_couriers(user: dict = Depends(get_current_pazar_sorumlusu)):
    """Sorumlunun pazar(lar)ında çalışan kuryeler (salt okunur - atama/kaldırma admin işidir)."""
    managed = await _managed_market_docs(user)
    managed_names = {_afro_norm(m.get("name") or "") for m in managed}
    if not managed_names:
        return []
    couriers = await db.users.find(
        {"role": "kurye"},
        {"_id": 0, "user_id": 1, "name": 1, "phone": 1, "courier_is_online": 1, "courier_markets": 1, "courier_market": 1},
    ).to_list(500)
    result = []
    for c in couriers:
        mkts = c.get("courier_markets") or ([c.get("courier_market")] if c.get("courier_market") else [])
        if any(_afro_norm(m) in managed_names for m in mkts):
            result.append({
                "user_id": c.get("user_id"),
                "name": c.get("name") or "",
                "phone": c.get("phone") or "",
                "is_online": bool(c.get("courier_is_online")),
                "markets": mkts,
            })
    return result


@router.get("/suppliers/{supplier_group}/products")
async def pazar_sorumlusu_supplier_products(supplier_group: str, user: dict = Depends(get_current_pazar_sorumlusu)):
    """Bir tedarikçinin ürünleri — SADECE o tedarikçi çağıranın atandığı
    pazarlardan birinde çalışıyorsa (salt okunur, denetim amaçlı)."""
    managed = await _managed_market_docs(user)
    managed_names = {_afro_norm(m.get("name") or "") for m in managed}
    cfg = await _read_catalog_config()
    supplier_markets = (cfg or {}).get("supplier_markets") or {}
    sg_markets = supplier_markets.get(supplier_group) or []
    if not any(_afro_norm(m) in managed_names for m in sg_markets):
        raise HTTPException(status_code=403, detail="Bu tedarikçi sizin pazarlarınızda değil")
    return await db.products.find({"supplier_group": supplier_group}, {"_id": 0}).sort("name", 1).to_list(2000)


@router.post("/suppliers/assign")
async def pazar_sorumlusu_assign_supplier(data: dict, user: dict = Depends(get_current_pazar_sorumlusu), request: Request = None):
    """Bir tedarikçiyi KENDİ pazarına ekler (catalog_config.supplier_markets'e
    bu pazarın adını ekler) — başka bir pazar sorumlusunun pazarına dokunamaz."""
    supplier_group = str((data or {}).get("supplier_group") or "").strip()
    market_id = str((data or {}).get("market_id") or "").strip()
    if not supplier_group or not market_id:
        raise HTTPException(status_code=400, detail="Tedarikçi ve pazar seçilmelidir")
    managed = await _managed_market_docs(user)
    market = _require_managed(market_id, managed)
    market_name = market.get("name") or ""

    cfg = dict(await _read_catalog_config())
    supplier_markets = dict(cfg.get("supplier_markets") or {})
    current = list(supplier_markets.get(supplier_group) or [])
    if not any(_afro_norm(m) == _afro_norm(market_name) for m in current):
        current.append(market_name)
    supplier_markets[supplier_group] = current
    cfg["supplier_markets"] = supplier_markets
    suppliers_list = list(cfg.get("suppliers") or [])
    if supplier_group not in suppliers_list:
        suppliers_list.append(supplier_group)
    cfg["suppliers"] = suppliers_list
    await _write_catalog_config(cfg)

    await _insert_log("log_admin", {
        "admin_id": user.get("user_id"), "admin_name": user.get("name", ""),
        "action": "pazar_sorumlusu_supplier_assigned", "target_type": "market", "target_id": market_id,
        "change_details": {"market_name": market_name, "supplier_group": supplier_group},
        "admin_note": "",
    }, request)
    return {"success": True}


@router.post("/suppliers/unassign")
async def pazar_sorumlusu_unassign_supplier(data: dict, user: dict = Depends(get_current_pazar_sorumlusu), request: Request = None):
    """Bir tedarikçiyi KENDİ pazarından kaldırır — başka bir pazar
    sorumlusunun pazarındaki atamaya dokunamaz."""
    supplier_group = str((data or {}).get("supplier_group") or "").strip()
    market_id = str((data or {}).get("market_id") or "").strip()
    if not supplier_group or not market_id:
        raise HTTPException(status_code=400, detail="Tedarikçi ve pazar seçilmelidir")
    managed = await _managed_market_docs(user)
    market = _require_managed(market_id, managed)
    market_name = market.get("name") or ""

    cfg = dict(await _read_catalog_config())
    supplier_markets = dict(cfg.get("supplier_markets") or {})
    current = list(supplier_markets.get(supplier_group) or [])
    new_list = [m for m in current if _afro_norm(m) != _afro_norm(market_name)]
    supplier_markets[supplier_group] = new_list
    cfg["supplier_markets"] = supplier_markets
    await _write_catalog_config(cfg)

    await _insert_log("log_admin", {
        "admin_id": user.get("user_id"), "admin_name": user.get("name", ""),
        "action": "pazar_sorumlusu_supplier_unassigned", "target_type": "market", "target_id": market_id,
        "change_details": {"market_name": market_name, "supplier_group": supplier_group},
        "admin_note": "",
    }, request)
    return {"success": True}
