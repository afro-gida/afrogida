"""Admin sipariş yönetimi: listeleme, durum güncelleme, kalem bazlı iade
(PayTR kart iadesi dahil), teslim kodu doğrulama."""
import hmac
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from core.crypto import dec_str, enc_str
from core.db import db
from core.logs import _insert_log, _log_sms_send
from core.security import get_current_admin
from core.util import now_utc, new_id
from services.noshow import _apply_no_show_penalty
from services.orders import _as_float, _dec_order, _dec_orders
from services.payments import _paytr_refund
from services.push import send_push_to_courier_markets
from services.sms import _generate_sms_code, send_delivery_sms

router = APIRouter(prefix="/api/admin/orders")


def _order_date_filter(filter_type: str):
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


@router.get("")
async def admin_list_orders(filter_type: str = "all_time", current_admin: dict = Depends(get_current_admin)):
    q = _order_date_filter(filter_type)
    return _dec_orders(await db.transactions.find(q, {"_id": 0}).sort("created_at", -1).to_list(3000))


@router.get("/{tx_id}")
async def admin_get_order(tx_id: str, current_admin: dict = Depends(get_current_admin)):
    order = await db.transactions.find_one({"tx_id": tx_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Sipariş bulunamadı")
    return _dec_order(order)


@router.put("/{tx_id}")
async def admin_update_order(tx_id: str, data: dict, current_admin: dict = Depends(get_current_admin), request: Request = None):
    allowed = {
        "order_status", "payment_status", "admin_note", "delivery_code",
        "delivered_at", "cancel_reason", "refund_status", "refund_amount"
    }
    updates = {k: v for k, v in data.items() if k in allowed}
    if not updates:
        raise HTTPException(status_code=400, detail="Güncellenecek alan bulunamadı")

    existing_order = await db.transactions.find_one({"tx_id": tx_id}, {"_id": 0})
    if not existing_order:
        raise HTTPException(status_code=404, detail="Sipariş bulunamadı")

    # Final durumlar: değişiklik yapılamaz
    final_statuses = {"teslim_edildi", "iptal_edildi", "teslim_alinmadi", "musteri_gelmedi_iptal"}
    current_status = str(existing_order.get("order_status") or "").strip().lower()
    if current_status in final_statuses:
        raise HTTPException(
            status_code=400,
            detail=f"Bu sipariş '{existing_order.get('order_status')}' durumunda. Final durumlarda değişiklik yapılamaz."
        )

    updates["updated_at"] = now_utc()
    if updates.get("order_status") == "teslim_edildi":
        if not updates.get("delivered_at"):
            updates["delivered_at"] = now_utc()
        # Teslim edilen sipariş ödemesi otomatik "ödendi" (iade edilmemişse)
        cur_pay = str(existing_order.get("payment_status") or "").strip().lower()
        if "payment_status" not in updates and cur_pay not in ("paid", "iade_edildi", "kismi_iade_edildi"):
            updates["payment_status"] = "paid"
        # Detay ekranındaki "SMS / Teslim Kodu" kutusunda gösterilecek mesaj
        updates["delivery_box_message"] = "Teslimat gerçekleşmiştir."

    ready_statuses = {"hazir", "hazır", "ready"}
    no_show_statuses = {"musteri_gelmedi_iptal", "teslim_alinmadi"}
    new_status = str(updates.get("order_status") or "").strip().lower()
    old_status = str(existing_order.get("order_status") or "").strip().lower()
    delivery_sms_sent = None

    # Teslim Alınmadı: no-show ceza sistemini uygula (her sipariş yalnızca 1 kez sayılır)
    if new_status in no_show_statuses and old_status not in no_show_statuses:
        if existing_order.get("no_show_counted"):
            # Bu sipariş daha önce sayılmış; tekrar sayma, mevcut mesajı koru
            updates["delivery_box_message"] = existing_order.get("delivery_box_message") or "Sipariş teslim alınmadı."
        else:
            penalty = await _apply_no_show_penalty(
                existing_order.get("user_id"), order=existing_order,
                admin_id=current_admin.get("user_id"),
            )
            updates["no_show_counted"] = True
            updates["no_show_level"] = penalty.get("level")
            updates["no_show_sms_sent"] = penalty.get("sms_sent")
            updates["delivery_box_message"] = "Sipariş teslim alınmadı. " + (penalty.get("message") or "")

    if new_status in ready_statuses and old_status not in ready_statuses:
        delivery_code = str(updates.get("delivery_code") or dec_str(existing_order.get("delivery_code")) or _generate_sms_code())
        delivery_expires_at = datetime.now().replace(hour=23, minute=59, second=0, microsecond=0)
        updates["delivery_code"] = enc_str(delivery_code)
        updates["delivery_code_expires_at"] = delivery_expires_at
        user_phone = None
        if existing_order.get("user_id"):
            user_doc = await db.users.find_one({"user_id": existing_order.get("user_id")}, {"_id": 0, "phone": 1})
            user_phone = (user_doc or {}).get("phone")
        if not user_phone:
            user_phone = existing_order.get("phone") or existing_order.get("customer_phone")
        delivery_sms_sent = send_delivery_sms(user_phone, tx_id, delivery_code) if user_phone else False
        updates["delivery_sms_sent"] = delivery_sms_sent
        updates["delivery_sms_sent_at"] = now_utc() if delivery_sms_sent else None
        # Frontend sipariş detay ekranı SMS durumunu bu alanlardan okur
        sms_state = "sent" if delivery_sms_sent else "failed"
        updates["sms_status"] = sms_state
        updates["pickup_sms_status"] = sms_state

    result = await db.transactions.update_one({"tx_id": tx_id}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Sipariş bulunamadı")
    await db.orders.update_one({"$or": [{"tx_id": tx_id}, {"order_id": tx_id}]}, {"$set": updates})
    await db.order_status_logs.insert_one({
        "id": new_id("olog"),
        "tx_id": tx_id,
        "updates": updates,
        "delivery_sms_sent": delivery_sms_sent,
        "admin_user_id": current_admin.get("user_id"),
        "admin_name": current_admin.get("name"),
        "created_at": now_utc(),
    })
    # --- LOG: sipariş durum değişikliği ---
    _oact_map = {"hazirlaniyor":"preparing","hazir":"ready","yola_cikti":"out_for_delivery","teslim_edildi":"delivered","teslim_alinmadi":"not_delivered","musteri_gelmedi_iptal":"not_delivered","iptal_edildi":"cancelled_by_admin"}
    _oact = _oact_map.get(new_status, f"status_{new_status}") if new_status else "status_update"
    await _insert_log("log_orders", {"order_id": tx_id, "user_id": existing_order.get("user_id"), "action": _oact, "performed_by": "admin", "admin_id": current_admin["user_id"], "admin_note": updates.get("admin_note",""), "order_snapshot": None}, request)
    await _insert_log("log_admin", {"admin_id": current_admin["user_id"], "admin_name": current_admin.get("name",""), "action": "order_status_changed", "target_type": "order", "target_id": tx_id, "change_details": {"field": "order_status", "old_value": existing_order.get("order_status"), "new_value": new_status or updates.get("order_status")}, "admin_note": updates.get("admin_note","")}, request)
    if new_status in no_show_statuses and old_status not in no_show_statuses:
        _ns_user = await db.users.find_one({"user_id": existing_order.get("user_id")})
        _ns_cnt = ((_ns_user or {}).get("no_show_count") or 0)
        _ns_lvl_map = {1:("level_1",60), 2:("level_2",180)}
        _ns_lvl, _ns_days = _ns_lvl_map.get(_ns_cnt, ("level_3", 365))
        await _insert_log("log_penalties", {"user_id": existing_order.get("user_id"), "order_id": tx_id, "action": "penalty_applied", "penalty_level": _ns_lvl, "reason": f"Sipariş #{tx_id} teslim alınmadı", "penalty_start": now_utc(), "penalty_end": now_utc()+timedelta(days=_ns_days), "previous_level": None, "performed_by": "system", "admin_id": None, "admin_note": None, "notification_sent": True}, request)
    if delivery_sms_sent is not None:
        await _log_sms_send(existing_order.get("user_id"), existing_order.get("phone") or "", "delivery_code", "teslim_kodu_v1", bool(delivery_sms_sent), request)

    # ── PUSH BİLDİRİM: Sipariş "hazir" → kuryelere bildir ──
    if new_status in ready_statuses and old_status not in ready_statuses:
        mkt = existing_order.get("market_name") or existing_order.get("stall_id") or ""
        mkt_list = [mkt] if mkt else []
        try:
            await send_push_to_courier_markets(
                mkt_list,
                title="🛵 Yeni Sipariş Hazır!",
                body=f"{mkt + ' — ' if mkt else ''}Teslim bekleyen yeni bir sipariş var.",
                data={"type": "new_order", "tx_id": tx_id, "url": "/courier-panel"},
            )
        except Exception:
            pass

    return await db.transactions.find_one({"tx_id": tx_id}, {"_id": 0})


@router.post("/{tx_id}/refund")
async def admin_refund_order(tx_id: str, data: dict, current_admin: dict = Depends(get_current_admin), request: Request = None):
    """Ürün (kalem) bazlı iade.

    Body: {"item_indices": [0, 2, ...]}  -> iade edilecek ürünlerin index'leri
          (siparişin items dizisindeki 0-tabanlı sıra numaraları).
    Davranış (idempotent - tam listeyi ayarlar):
      * Her kalem 'refunded' işaretiyle güncellenir.
      * refund_amount = iade edilen kalemlerin line_total toplamı.
      * refund_status: tüm kalemler iade -> 'iade_edildi', bir kısmı -> 'kismi_iade_edildi',
        hiçbiri -> '' (iade iptal). payment_status da buna göre ayarlanır.
      * Satış logu bu işaretleri kullanarak iade edilen ürünü ve parasını düşer.
    NOT: İade, teslim edilmiş (final) siparişlerde yapılır; bu endpoint final-durum
    kilidine takılmaz (admin_update_order'dan ayrı olduğu için).
    """
    order = await db.transactions.find_one({"tx_id": tx_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Sipariş bulunamadı")

    items = order.get("items") or []
    n = len(items)
    raw_idx = data.get("item_indices", data.get("items"))
    if not isinstance(raw_idx, list):
        raise HTTPException(status_code=400, detail="item_indices bir liste olmalı")
    sel = set()
    for x in raw_idx:
        try:
            ix = int(x)
        except Exception:
            continue
        if 0 <= ix < n:
            sel.add(ix)

    # Kalemleri işaretle + iade tutarını hesapla
    new_items = []
    refund_amount = 0.0
    for i, it in enumerate(items):
        it = dict(it or {})
        is_ref = i in sel
        it["refunded"] = is_ref
        if is_ref:
            lt = _as_float(it.get("line_total", it.get("total_price")), 0)
            it["refunded_amount"] = round(lt, 2)
            refund_amount += lt
        else:
            it["refunded_amount"] = 0.0
        new_items.append(it)
    refund_amount = round(refund_amount, 2)

    # ---- PayTR KART İADESİ ----
    # Online kart (PayTR) ile ödenen siparişlerde, sistemde iade işaretlemenin
    # yanı sıra gerçek para iadesi de karta yapılır. PayTR iade artımlıdır ve
    # GERİ ALINAMAZ; bu yüzden yalnızca "yeni eklenen" iade tutarı (delta) karta
    # gönderilir ve toplam kart iadesi altına inilmesine izin verilmez.
    payment_method = str(order.get("payment_method") or "").strip().lower()
    merchant_oid = order.get("merchant_oid")
    is_online = (payment_method == "online_card") and bool(merchant_oid)
    skip_card = bool(data.get("skip_card"))
    already_card = _as_float(order.get("paytr_refunded_amount"), 0)
    card_refund = {
        "eligible": is_online,
        "attempted": False,
        "success": False,
        "amount": 0.0,
        "already_refunded": round(already_card, 2),
        "message": "",
    }

    if is_online and not skip_card:
        delta = round(refund_amount - already_card, 2)
        if delta < -0.009:
            # Kart iadesi geri alınamaz: mevcut kart iadesinin altına inilemez
            raise HTTPException(
                status_code=400,
                detail=(f"Bu siparişte karta {already_card:.2f} TL zaten iade edildi. "
                        f"PayTR kart iadesi geri alınamaz; iade tutarını bu değerin altına indiremezsiniz."),
            )
        if delta > 0.009:
            res = await _paytr_refund(merchant_oid, delta)
            card_refund["attempted"] = True
            card_refund["amount"] = round(delta, 2)
            if res.get("success"):
                card_refund["success"] = True
                already_card = round(already_card + delta, 2)
                card_refund["already_refunded"] = already_card
                card_refund["message"] = f"Karta {delta:.2f} TL iade edildi (PayTR)."
            else:
                # PayTR iadesi başarısız -> hiçbir değişiklik kaydetme, hatayı bildir
                raise HTTPException(
                    status_code=400,
                    detail="PayTR kart iadesi başarısız: " + (res.get("message") or "bilinmeyen hata"),
                )
        else:
            # delta ~ 0: karta ek iade gerekmez (tutar zaten iade edilmiş)
            card_refund["success"] = True
            card_refund["message"] = "Kart iadesi tutarı değişmedi (ek iade yapılmadı)."
    elif is_online and skip_card:
        card_refund["message"] = "Kart iadesi atlandı (elle iade seçildi); yalnızca sistem kaydı güncellendi."

    # Durum belirle
    if len(sel) == 0:
        refund_status = ""
        payment_status = "paid"
    elif len(sel) >= n:
        refund_status = "iade_edildi"
        payment_status = "iade_edildi"
    else:
        refund_status = "kismi_iade_edildi"
        payment_status = "kismi_iade_edildi"

    updates = {
        "items": new_items,
        "refunded_items": sorted(sel),
        "refund_amount": refund_amount,
        "refund_status": refund_status,
        "payment_status": payment_status,
        "refunded_at": now_utc() if sel else None,
        "refunded_by": current_admin.get("name") if sel else None,
        "paytr_refunded_amount": round(already_card, 2),
        "card_refund_last": card_refund,
        "updated_at": now_utc(),
    }
    await db.transactions.update_one({"tx_id": tx_id}, {"$set": updates})
    await db.orders.update_one({"$or": [{"tx_id": tx_id}, {"order_id": tx_id}]}, {"$set": updates})
    await db.order_status_logs.insert_one({
        "id": new_id("olog"),
        "tx_id": tx_id,
        "action": "refund",
        "refunded_items": sorted(sel),
        "refund_amount": refund_amount,
        "refund_status": refund_status,
        "card_refund": card_refund,
        "admin_user_id": current_admin.get("user_id"),
        "admin_name": current_admin.get("name"),
        "created_at": now_utc(),
    })
    # --- LOG: iade ---
    _rf_action = "refund_full" if len(sel) >= n else "refund_partial"
    await _insert_log("log_orders", {"order_id": tx_id, "user_id": order.get("user_id"), "action": _rf_action, "performed_by": "admin", "admin_id": current_admin["user_id"], "admin_note": data.get("reason",""), "order_snapshot": None}, request)
    await _insert_log("log_payments", {"order_id": tx_id, "user_id": order.get("user_id"), "payment_provider": "PayTR" if is_online else "cash", "transaction_id": merchant_oid, "action": "refund_initiated", "amount": refund_amount, "payment_method": order.get("payment_method",""), "card_last_four": None, "error_message": None, "paytr_hash_valid": None}, request)
    await _insert_log("log_admin", {"admin_id": current_admin["user_id"], "admin_name": current_admin.get("name",""), "action": "refund_processed", "target_type": "order", "target_id": tx_id, "change_details": {"field": "refund", "old_value": None, "new_value": {"amount": refund_amount, "type": _rf_action}}, "admin_note": data.get("reason","")}, request)
    result_order = await db.transactions.find_one({"tx_id": tx_id}, {"_id": 0})
    if result_order is not None:
        result_order["card_refund"] = card_refund
    return result_order


@router.post("/{tx_id}/verify-delivery-code")
async def admin_verify_delivery_code(tx_id: str, data: dict, current_admin: dict = Depends(get_current_admin), request: Request = None):
    """Teslim kodunu (SMS ile giden pickup_code) doğrula ve siparişi 'teslim edildi' yap."""
    order = await db.transactions.find_one({"tx_id": tx_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Sipariş bulunamadı")

    submitted = str(data.get("pickup_code") or data.get("code") or data.get("delivery_code") or "").strip()
    if not submitted:
        raise HTTPException(status_code=400, detail="Lütfen teslim kodunu girin")

    expected = str(dec_str(order.get("delivery_code")) or "").strip()
    if not expected:
        raise HTTPException(status_code=400, detail="Bu sipariş için henüz teslim kodu oluşturulmadı. Önce siparişi 'Hazır' yapın.")

    if not hmac.compare_digest(submitted, expected):
        raise HTTPException(status_code=400, detail="Teslim kodu hatalı. Lütfen müşterinin SMS ile aldığı kodu girin.")

    # Kod geçerlilik süresi (akşam saatine kadar)
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
    }
    cur_pay = str(order.get("payment_status") or "").strip().lower()
    if cur_pay not in ("paid", "iade_edildi", "kismi_iade_edildi"):
        updates["payment_status"] = "paid"

    await db.transactions.update_one({"tx_id": tx_id}, {"$set": updates})
    await db.orders.update_one({"$or": [{"tx_id": tx_id}, {"order_id": tx_id}]}, {"$set": updates})
    await db.order_status_logs.insert_one({
        "id": new_id("olog"),
        "tx_id": tx_id,
        "updates": updates,
        "action": "verify_delivery_code",
        "admin_user_id": current_admin.get("user_id"),
        "admin_name": current_admin.get("name"),
        "created_at": now_utc(),
    })
    await _insert_log("log_orders", {"order_id": tx_id, "user_id": order.get("user_id"), "action": "delivered", "performed_by": "admin", "admin_id": current_admin["user_id"], "admin_note": "Teslim kodu doğrulandı", "order_snapshot": None}, request)
    await _insert_log("log_admin", {"admin_id": current_admin["user_id"], "admin_name": current_admin.get("name",""), "action": "delivery_code_verified", "target_type": "order", "target_id": tx_id, "change_details": None, "admin_note": "Teslim kodu doğrulandı"}, request)
    return await db.transactions.find_one({"tx_id": tx_id}, {"_id": 0})
