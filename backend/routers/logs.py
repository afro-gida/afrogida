"""Admin log listeleme endpoint'leri: OpenClaw /admin/logs paneli sekmeleri
(işlemler, güvenlik, siparişler, durum geçmişi, ödemeler, iadeler, kuponlar,
üyelik, gel-al, sözleşme onayları) + genel koleksiyon listeleme."""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from core.config import _AFRO_DOC_NAME_TR
from core.crypto import dec_str
from core.db import db
from core.security import get_current_admin
from services.admin_logs import (
    _AFRO_SEVERITY_TR, _AFRO_AUTH_ACTION_TR, _AFRO_PAY_STATUS_TR,
    _afro_status_tr, _afro_mask_phone, _afro_iso, _afro_dt_tr, _afro_fetch_logs, _afro_user_map,
)
from services.orders import _compat_json_clean

router = APIRouter(prefix="/api/admin/logs")


@router.get("/actions")
async def compat_admin_action_logs(limit: int = 200, current_admin: dict = Depends(get_current_admin)):
    """Admin İşlemleri sekmesi — log_admin koleksiyonundan."""
    rows = await _afro_fetch_logs("log_admin", limit)
    out = []
    for r in rows:
        cd = r.get("change_details") or {}
        ts = _afro_iso(r.get("created_at")) or _afro_iso(r.get("timestamp"))
        if not ts:
            continue
        out.append({
            "action": r.get("action") or "işlem",
            "timestamp": ts,
            "admin_name": r.get("admin_name") or "",
            "admin_id": r.get("admin_id") or "",
            "target_id": r.get("target_id") or "",
            "note": r.get("admin_note") or r.get("note") or "",
            "ip": r.get("ip_address") or r.get("ip") or "",
            "user_agent": r.get("user_agent") or "",
            "old_value": (cd.get("old_value") if isinstance(cd, dict) else None) or r.get("old_value") or {},
            "new_value": (cd.get("new_value") if isinstance(cd, dict) else None) or r.get("new_value") or {},
        })
    return _compat_json_clean(out)


@router.get("/security")
async def compat_admin_security_logs(limit: int = 200, current_admin: dict = Depends(get_current_admin)):
    """Sistem & Güvenlik sekmesi — frontend tek 'log' string field'ı bekliyor."""
    rows = await _afro_fetch_logs("log_security", limit)
    out = []
    for r in rows:
        ts = _afro_dt_tr(r.get("created_at") or r.get("timestamp"))
        sev = _AFRO_SEVERITY_TR.get((r.get("severity") or "medium").lower(), "ORTA")
        event = r.get("event_type") or r.get("action") or "olay"
        if event == "unknown":
            det = r.get("details")
            if isinstance(det, str) and "Client:" in det and "Server:" in det:
                event = "sepet_tutari_uyusmazligi"
            else:
                event = "bilinmeyen_olay"
        ip = r.get("source_ip") or r.get("ip_address") or r.get("ip") or "-"
        details = r.get("details") or {}
        if isinstance(details, dict) and details:
            det_str = ", ".join(f"{k}={v}" for k, v in details.items())
        else:
            det_str = str(details) if details else "-"
        resolved = "Çözüldü" if r.get("resolved") else "Çözülmedi"
        out.append({"log": f"[{ts}] {sev} — {event} | IP: {ip} | Detay: {det_str} | Durum: {resolved}"})
    return out


@router.get("/orders")
async def compat_admin_order_logs(limit: int = 200, current_admin: dict = Depends(get_current_admin)):
    """Siparişler sekmesi — log_orders + users/transactions lookup."""
    rows = await _afro_fetch_logs("log_orders", limit)
    # Sadece gerçek sipariş kayıtları (durum değişimleri Durum Geçmişi sekmesinde)
    created_rows = [r for r in rows if r.get("action") == "order_created"]
    if created_rows:
        rows = created_rows
    umap = await _afro_user_map([r.get("user_id") for r in rows])
    # transactions'tan toplu sipariş detayı
    tx_ids = [r.get("order_id") for r in rows if r.get("order_id")]
    tx_rows = await db.transactions.find({"tx_id": {"$in": list(set(tx_ids))}}, {"_id": 0, "tx_id": 1, "delivery_type": 1, "payment_method": 1, "total": 1, "amount": 1, "subtotal": 1, "discount_amount": 1, "discount": 1}).to_list(len(tx_ids) or 1) if tx_ids else []
    tmap = {t["tx_id"]: t for t in tx_rows}
    out = []
    for r in rows:
        ts = _afro_iso(r.get("created_at"))
        if not ts:
            continue
        u = umap.get(r.get("user_id")) or {}
        snap = r.get("order_snapshot") or {}
        tx = tmap.get(r.get("order_id")) or {}
        out.append({
            "tx_id": r.get("order_id") or "",
            "user_name": u.get("name") or (snap.get("user_name") if isinstance(snap, dict) else "") or "",
            "user_phone": u.get("phone") or "",
            # Frontend: delivery_type=="pickup" -> "Gel-Al", aksi "Paket Servis"
            "delivery_type": ("pickup" if str((snap.get("delivery_type") if isinstance(snap, dict) else None) or tx.get("delivery_type") or "") in ("gel_al", "gelal", "pickup") else "delivery"),
            # Frontend: payment_method=="card" -> "Kredi Kartı", aksi "Tezgahta Ödeme"
            "payment_method": ("card" if str((snap.get("payment_method") if isinstance(snap, dict) else None) or tx.get("payment_method") or "") in ("online_card", "credit_card", "card", "paytr") else "cash"),
            "amount": (snap.get("total") if isinstance(snap, dict) else None) or (snap.get("subtotal") if isinstance(snap, dict) else None) or tx.get("total") or tx.get("amount") or tx.get("subtotal") or 0,
            "discount": (snap.get("discount_amount") if isinstance(snap, dict) else None) or tx.get("discount_amount") or tx.get("discount") or 0,
            "created_at": ts,
            "ip": r.get("ip_address") or "",
            "user_agent": r.get("user_agent") or "",
        })
    return out


@router.get("/order-status")
async def compat_admin_order_status_logs(limit: int = 200, current_admin: dict = Depends(get_current_admin)):
    """Durum Geçmişi sekmesi."""
    rows = await _afro_fetch_logs("log_orders", limit, {"$or": [
        {"action": {"$in": ["preparing", "ready", "out_for_delivery", "delivered", "not_delivered",
                             "order_status_changed", "order_confirmed", "cancelled"]}},
        {"action": {"$regex": "^status_"}},
    ]})
    # Eski->yeni sıraya koy: önceki durumdan old_status zinciri kur
    rows.sort(key=lambda r: str(_afro_iso(r.get("created_at")) or ""))
    last_status = {}
    out = []
    for r in rows:
        ts = _afro_iso(r.get("created_at"))
        if not ts:
            continue
        oid = r.get("order_id") or ""
        cd = r.get("change_details") or {}
        new_raw = (cd.get("new_value") if isinstance(cd, dict) else None) or r.get("action") or ""
        old_raw = (cd.get("old_value") if isinstance(cd, dict) else None) or last_status.get(oid) or ""
        last_status[oid] = new_raw
        out.append({
            "tx_id": oid,
            "changed_at": ts,
            "old_status": _afro_status_tr(old_raw) if old_raw else "",
            "new_status": _afro_status_tr(new_raw),
            "changed_by_type": r.get("performed_by") or "system",
            "changed_by_id": r.get("admin_id") or r.get("user_id") or "",
            "ip": r.get("ip_address") or "",
            "user_agent": r.get("user_agent") or "",
            "note": r.get("admin_note") or "",
        })
    out.sort(key=lambda x: x.get("changed_at") or "", reverse=True)
    return out


@router.get("/payments")
async def compat_admin_payment_logs(limit: int = 200, current_admin: dict = Depends(get_current_admin)):
    """Ödemeler (PayTR) sekmesi."""
    rows = await _afro_fetch_logs("log_payments", limit)
    # İade tutarlarını sipariş bazında topla (ödeme kartında "İade Durumu" olarak gösterilir)
    refund_by_order = {}
    for r in rows:
        act = r.get("action") or ""
        if act.startswith("refund"):
            oid = r.get("order_id") or ""
            try:
                refund_by_order[oid] = refund_by_order.get(oid, 0) + float(r.get("amount") or 0)
            except Exception:
                pass
    out = []
    for r in rows:
        ts = _afro_iso(r.get("created_at"))
        if not ts:
            continue
        action = r.get("action") or ""
        # Sadece gerçek PayTR sonuç kayıtları: başlatma kayıtları (hash yok, tutar 0)
        # ve iade kayıtları (İadeler sekmesinde) bu sekmede gösterilmez.
        if action not in ("payment_success", "payment_failed"):
            continue
        oid = r.get("order_id") or ""
        refunded = refund_by_order.get(oid)
        out.append({
            "merchant_oid": r.get("transaction_id") or oid or "",
            "callback_date": ts,
            "status": _AFRO_PAY_STATUS_TR.get(action, action),
            "amount": r.get("amount") or 0,
            "currency": "TL",
            "hash_verified": bool(r.get("paytr_hash_valid")),
            "refund_status": (f"İade Edildi (₺{refunded:.2f})" if refunded else ""),
            "payment_id": oid,
        })
    return out


@router.get("/refunds")
async def compat_admin_refund_logs(limit: int = 200, current_admin: dict = Depends(get_current_admin)):
    """İadeler sekmesi — log_payments + log_orders refund kayıtları."""
    refund_actions = {"$in": ["refund_initiated", "refund_approved", "refund_completed",
                               "partial_refund", "full_refund", "refund_partial", "refund_full"]}
    pay_rows = await _afro_fetch_logs("log_payments", limit, {"action": refund_actions})
    ord_rows = await _afro_fetch_logs("log_orders", limit, {"action": refund_actions})
    # admin adlarını log_admin refund kayıtlarından topla
    adm_rows = await _afro_fetch_logs("log_admin", limit, {"action": "refund_processed"})
    adm_by_order = {a.get("target_id"): a for a in adm_rows}
    out = []
    for r in pay_rows + ord_rows:
        ts = _afro_iso(r.get("created_at"))
        if not ts:
            continue
        oid = r.get("order_id") or ""
        adm = adm_by_order.get(oid) or {}
        cd = adm.get("change_details") or {}
        nv = cd.get("new_value") if isinstance(cd, dict) else {}
        raw_type = str((nv.get("type") if isinstance(nv, dict) else None) or r.get("action") or "")
        # Frontend: refund_type=="tam" -> "Tam İade", aksi "Kısmi İade"
        refund_type = "tam" if ("full" in raw_type or "tam" in raw_type) else "kismi"
        amount = r.get("amount") or (nv.get("amount") if isinstance(nv, dict) else 0) or 0
        reason = ((nv.get("reason") if isinstance(nv, dict) else None)
                  or adm.get("admin_note") or r.get("admin_note") or "Belirtilmedi")
        out.append({
            "order_id": oid,
            "timestamp": ts,
            "refund_type": refund_type,
            "amount": amount,
            "reason": reason,
            "admin_name": adm.get("admin_name") or "",
            "admin_id": adm.get("admin_id") or r.get("admin_id") or "",
            "paytr_reference": r.get("transaction_id") or "",
            "paytr_result": r.get("error_message") or "Başarılı",
            "ip": r.get("ip_address") or "",
            "note": adm.get("admin_note") or r.get("admin_note") or "",
        })
    # Aynı iade hem log_payments hem log_orders'ta olabilir -> dedupe (sipariş+tutar+dakika)
    seen = set()
    deduped = []
    for x in sorted(out, key=lambda x: x.get("timestamp") or "", reverse=True):
        key = (x["order_id"], round(float(x["amount"] or 0), 2), str(x["timestamp"])[:16])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(x)
    return deduped[:max(1, min(int(limit or 200), 1000))]


@router.get("/coupons")
async def compat_admin_coupon_logs(limit: int = 200, current_admin: dict = Depends(get_current_admin)):
    """Kuponlar sekmesi."""
    rows = await _afro_fetch_logs("log_coupons", limit)
    out = []
    for r in rows:
        ts = _afro_iso(r.get("created_at"))
        if not ts:
            continue
        action = r.get("action") or ""
        user_id = r.get("user_id") or ""
        if not user_id:
            if action == "coupon_assigned_all":
                user_id = "Tüm kullanıcılar"
            elif action in ("coupon_created", "coupon_deleted", "coupon_updated"):
                user_id = f"Admin: {r.get('admin_id') or '-'}"
            else:
                user_id = "-"
        out.append({
            "code": r.get("coupon_code") or "",
            "used_at": ts,
            "user_id": user_id,
            "tx_id": r.get("order_id") or "-",
            "action": action,
            "discount": r.get("discount_amount") or 0,
        })
    return out


@router.get("/members")
async def compat_admin_member_logs(limit: int = 200, current_admin: dict = Depends(get_current_admin)):
    """Üyelik sekmesi — frontend: phone, deleted_at(Date), is_restricted, restriction_reason."""
    rows = await _afro_fetch_logs("log_auth", limit)
    umap = await _afro_user_map([r.get("user_id") for r in rows])
    out = []
    for r in rows:
        ts = _afro_iso(r.get("created_at"))
        if not ts:
            continue
        u = umap.get(r.get("user_id")) or {}
        action = r.get("action") or ""
        phone = r.get("phone_masked") or _afro_mask_phone(u.get("phone"))
        if not phone:
            cd = r.get("change_details") or {}
            attempted = cd.get("attempted_username") if isinstance(cd, dict) else None
            phone = f"Admin: {attempted}" if attempted else "-"
        out.append({
            "phone": phone,
            "deleted_at": ts,
            "is_restricted": action == "account_closed",
            "restriction_reason": _AFRO_AUTH_ACTION_TR.get(action, action),
        })
    return out


@router.get("/pickup")
async def compat_admin_pickup_logs(limit: int = 200, current_admin: dict = Depends(get_current_admin)):
    """Gel-Al Teslimat sekmesi."""
    rows = await _afro_fetch_logs("log_orders", limit, {
        "action": {"$in": ["pickup_ready", "picked_up", "delivered", "delivery_code_verified"]}
    })
    # Sipariş detayları (telefon + şube) transactions'tan toplu lookup
    tx_ids = list({r.get("order_id") for r in rows if r.get("order_id")})
    tx_rows = await db.transactions.find(
        {"tx_id": {"$in": tx_ids}},
        {"_id": 0, "tx_id": 1, "user_id": 1, "user_phone": 1, "address": 1}
    ).to_list(len(tx_ids) or 1) if tx_ids else []
    tmap = {t["tx_id"]: t for t in tx_rows}
    # Teslim kodu SMS'leri kullanıcı bazında (log_sms)
    user_ids = list({t.get("user_id") for t in tx_rows if t.get("user_id")} | {r.get("user_id") for r in rows if r.get("user_id")})
    sms_rows = await db.log_sms.find(
        {"sms_type": "delivery_code", "user_id": {"$in": user_ids}},
        {"_id": 0, "user_id": 1, "status": 1, "provider": 1, "provider_message_id": 1, "created_at": 1}
    ).sort("created_at", -1).to_list(500) if user_ids else []
    sms_by_user = {}
    for smx in sms_rows:
        sms_by_user.setdefault(smx.get("user_id"), []).append(smx)
    out = []
    for r in rows:
        ts = _afro_iso(r.get("created_at"))
        if not ts:
            continue
        is_verified = r.get("action") in ("delivered", "delivery_code_verified", "picked_up")
        tx = tmap.get(r.get("order_id")) or {}
        uid = tx.get("user_id") or r.get("user_id")
        # Bu doğrulamadan önceki en yakın teslim kodu SMS'ini bul
        sms = None
        for smx in sms_by_user.get(uid, []):
            sts = _afro_iso(smx.get("created_at")) or ""
            if sts <= ts:
                sms = smx
                break
        branch = str(dec_str(tx.get("address")) or "")
        if branch.startswith("Tezgah:"):
            branch = branch.replace("Tezgah:", "").strip()
        out.append({
            "order_id": r.get("order_id") or "",
            "sms_sent_at": _afro_iso(sms.get("created_at")) if sms else ts,
            "masked_phone": tx.get("user_phone") or "",
            "sms_sent": bool(sms and sms.get("status") == "sent"),
            "sms_provider_id": (sms.get("provider_message_id") or sms.get("provider") or "") if sms else "",
            "manual_override": False,
            "manual_reason": "",
            "manual_desc": "",
            "verified_by_admin_id": r.get("admin_id") or "",
            "verified_at": ts,
            "verification_ip": r.get("ip_address") or "",
            "verification_device": r.get("user_agent") or "",
            "code_verified": is_verified,
            "branch_info": branch,
        })
    return out


@router.get("/agreements")
async def compat_admin_agreement_logs(limit: int = 200, current_admin: dict = Depends(get_current_admin)):
    """Sözleşme Onayları sekmesi — legal_agreement_logs (canlı sistem) + log_consents birleşik."""
    limit_n = max(1, min(int(limit or 200), 1000))
    lal = await db.legal_agreement_logs.find({}, {"_id": 0}).sort("timestamp", -1).to_list(limit_n)
    lcs = await db.log_consents.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit_n)
    out = []
    for r in lal:
        ts = _afro_iso(r.get("timestamp")) or _afro_iso(r.get("created_at"))
        if not ts:
            continue
        code = r.get("document_code") or r.get("document_type") or ""
        _vers = r.get("versions")
        _dname = r.get("document_name") or _AFRO_DOC_NAME_TR.get(code)
        if not _dname and isinstance(_vers, dict) and _vers:
            _dname = ", ".join(_AFRO_DOC_NAME_TR.get(k, k) for k in _vers.keys())
        out.append({
            "order_id": r.get("order_id") or "",
            "timestamp": ts,
            "user_id": r.get("user_id") or "",
            "accepted": bool(r.get("accepted", True)),
            "document_name": _dname or (code or "Sözleşme"),
            "document_type": code,
            "document_version": r.get("document_version") or "",
            "versions": _vers if isinstance(_vers, dict) else None,
            "ip": r.get("ip") or r.get("ip_address") or "",
            "user_agent": r.get("user_agent") or "",
        })
    for r in lcs:
        ts = _afro_iso(r.get("created_at"))
        if not ts:
            continue
        code = r.get("consent_type") or r.get("document_type") or ""
        _acc = r.get("action")
        out.append({
            "order_id": r.get("order_id") or "",
            "timestamp": ts,
            "user_id": r.get("user_id") or "",
            "accepted": (_acc != "declined") if _acc else bool(r.get("accepted", True)),
            "document_name": r.get("document_name") or _AFRO_DOC_NAME_TR.get(code, code or "Sözleşme"),
            "document_type": code,
            "document_version": r.get("document_version") or "",
            "versions": None,
            "ip": r.get("ip_address") or "",
            "user_agent": r.get("user_agent") or "",
        })
    out.sort(key=lambda x: x.get("timestamp") or "", reverse=True)
    return out[:limit_n]


@router.get("/stats/overview")
async def afro_log_stats_overview(current_admin: dict = Depends(get_current_admin)):
    """Çözülmemiş güvenlik uyarıları + açık destek ticket sayısı."""
    unresolved = await db.log_security.count_documents({"resolved": False, "severity": {"$in": ["high","critical"]}})
    open_support = await db.log_support.count_documents({"action": {"$nin": ["closed","resolved"]}})
    return {"unresolved_security_alerts": unresolved, "open_support_tickets": open_support}


@router.get("/{collection_name}")
async def afro_get_logs(
    collection_name: str,
    request: Request,
    current_admin: dict = Depends(get_current_admin),
    page: int = 1,
    per_page: int = 20,
    action: Optional[str] = None,
    user_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    ip_address: Optional[str] = None,
    severity: Optional[str] = None,
    resolved: Optional[str] = None,
    consent_type: Optional[str] = None,
    sms_type: Optional[str] = None,
    category: Optional[str] = None,
    priority: Optional[str] = None,
    order_id: Optional[str] = None,
):
    """Genel log listeleme endpoint'i — 11 koleksiyon."""
    valid = ["log_consents","log_auth","log_orders","log_payments","log_sms","log_admin","log_security","log_data_deletion","log_coupons","log_support","log_penalties"]
    if collection_name not in valid:
        raise HTTPException(status_code=400, detail="Geçersiz koleksiyon adı")
    query = {}
    if action:
        query["action"] = {"$in": action.split(",")} if "," in action else action
    if user_id:
        query["user_id"] = user_id
    if order_id:
        query["order_id"] = order_id
    if ip_address:
        query["ip_address"] = {"$regex": ip_address}
    if date_from:
        try:
            query.setdefault("created_at", {})["$gte"] = datetime.fromisoformat(date_from.replace("Z","+00:00"))
        except Exception:
            pass
    if date_to:
        try:
            query.setdefault("created_at", {})["$lte"] = datetime.fromisoformat(date_to.replace("Z","+00:00"))
        except Exception:
            pass
    if severity:
        query["severity"] = severity
    if resolved is not None and resolved != "":
        query["resolved"] = resolved.lower() in ("true","1","yes")
    if consent_type:
        query["consent_type"] = consent_type
    if sms_type:
        query["sms_type"] = sms_type
    if category:
        query["category"] = category
    if priority:
        query["priority"] = priority
    skip = (page - 1) * per_page
    total = await db[collection_name].count_documents(query)
    cursor = db[collection_name].find(query, {"_id": 0}).sort("created_at", -1).skip(skip).limit(per_page)
    logs = await cursor.to_list(length=per_page)
    # Datetime'ları ISO string'e çevir
    for lg in logs:
        for _k, _v in lg.items():
            if isinstance(_v, datetime):
                lg[_k] = _v.isoformat()
    return {"logs": logs, "total": total, "page": page, "per_page": per_page, "total_pages": (total + per_page - 1) // per_page}
