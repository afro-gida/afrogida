"""Üye (müşteri) yönetimi: listele/ara, detay, işlem geçmişi, güncelle, sil,
kapıda ödeme kısıtlaması (no-show) manuel kaldırma/istisna."""
from datetime import timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from core.db import db
from core.logs import _mask_phone, _insert_log, _log_payment_restriction
from core.security import get_current_admin, hash_password
from core.util import now_utc, new_id, _clean_text, _norm_limit
from models import MemberOut, MemberUpdateInput
from services.admin_logs import _afro_status_tr, _afro_iso, _afro_dt_tr
from services.noshow import (
    NO_SHOW_DAYS_LEVEL2, NO_SHOW_DAYS_LEVEL3, NO_SHOW_DAYS_LEVEL4,
    _evaluate_no_show_restriction,
)
from services.orders import _compat_json_clean

router = APIRouter(prefix="/api")


# ---------------- Member (customer) management ----------------
@router.post("/admin/users")
async def admin_create_user(data: dict, current_admin: dict = Depends(get_current_admin), request: Request = None):
    """Admin, hesabı olmayan biri için SMS-OTP doğrulaması OLMADAN çıplak bir
    üye hesabı açar — ör. tedarikçi/kurye onboarding'i sırasında (kişi zaten
    admin'in karşısında/telefonda, ayrıca SMS doğrulaması gereksiz).
    /auth/register ile AYNI hesap şeması (role: member) — tek fark OTP
    kontrolünün atlanması. Sonrasında admin/staff/assign veya
    admin/courier/assign ile esnaf/kurye rolü verilir (bu uç sadece çıplak
    hesabı açar, rol atamaz)."""
    name = _clean_text((data or {}).get("name") or "")
    phone = str((data or {}).get("phone") or "").strip()
    password = (data or {}).get("password") or None
    if not name:
        raise HTTPException(status_code=400, detail="Ad girin")
    if len(phone) < 7:
        raise HTTPException(status_code=400, detail="Geçerli bir telefon numarası girin")
    existing = await db.users.find_one({"phone": phone}, {"_id": 0, "user_id": 1})
    if existing:
        raise HTTPException(status_code=409, detail="Bu numara zaten kayıtlı")
    user_id = new_id("user")
    await db.users.insert_one({
        "user_id": user_id,
        "name": name,
        "email": None,
        "picture": None,
        "phone": phone,
        "role": "member",
        "auth_type": "phone",
        "password_hash": hash_password(password) if password else None,
        "created_at": now_utc(),
        "created_by_admin": current_admin["user_id"],
    })
    await _insert_log("log_admin", {
        "admin_id": current_admin["user_id"],
        "admin_name": current_admin.get("name", ""),
        "action": "user_created_by_admin",
        "target_type": "user",
        "target_id": user_id,
        "change_details": {"phone_masked": _mask_phone(phone), "name": name, "password_set": bool(password)},
        "admin_note": "OTP'siz elle hesap oluşturuldu (onboarding)",
    }, request)
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    return {"success": True, "user": user}


@router.get("/admin/members", response_model=List[MemberOut])
async def admin_list_members(search: Optional[str] = None, admin=Depends(get_current_admin)):
    query: dict = {"role": {"$in": ["musteri", "member"]}}
    if search and search.strip():
        rx = {"$regex": search.strip(), "$options": "i"}
        query["$or"] = [{"name": rx}, {"phone": rx}, {"email": rx}]
    members = await db.users.find(
        query, {"_id": 0, "password_hash": 0, "username": 0}
    ).sort("created_at", -1).to_list(2000)
    return members


@router.get("/admin/members/count")
async def admin_members_count(admin=Depends(get_current_admin)):
    count = await db.users.count_documents({"role": {"$in": ["musteri", "member"]}})
    return {"count": count}


@router.get("/admin/members/{user_id}")
async def admin_get_member(user_id: str, admin=Depends(get_current_admin), request: Request = None):
    """Üye Detayı ekranı için tek üyenin tüm (hassas olmayan) bilgilerini döndürür.
    Bu ekran üyenin adresini de gösterdiği için her görüntüleme KVKK/denetim
    amacıyla log_admin'e kaydedilir (Üye Detayı'ndaki İşlem Geçmişi'nde
    "Adres görüntülendi" olarak görünür)."""
    member = await db.users.find_one(
        {"user_id": user_id, "role": {"$in": ["musteri", "member"]}},
        {"_id": 0, "password_hash": 0, "username": 0},
    )
    if not member:
        raise HTTPException(status_code=404, detail="Üye bulunamadı")
    await _insert_log("log_admin", {
        "admin_id": admin["user_id"],
        "admin_name": admin.get("name", ""),
        "action": "member_address_viewed",
        "target_type": "user",
        "target_id": user_id,
        "change_details": None,
        "admin_note": "",
    }, request)
    # No-show ceza durumunu türet
    try:
        ns = _evaluate_no_show_restriction(member)
        member["no_show_status"] = {
            "count": ns["count"],
            "online_only": ns["online_only"],
            "indefinite": ns["indefinite"],
            "until": ns["until"].isoformat() if ns.get("until") else None,
            "message": ns["message"],
            "last_at": member.get("no_show_last_at").isoformat() if member.get("no_show_last_at") else None,
        }
    except Exception:
        member["no_show_status"] = None
    # Son ceza/kısıtlama log kayıtları (geçmiş)
    try:
        logs = await db.payment_restriction_logs.find(
            {"user_id": user_id}, {"_id": 0}
        ).sort("created_at", -1).limit(20).to_list(length=20)
        for lg in logs:
            if lg.get("created_at"):
                try:
                    lg["created_at"] = lg["created_at"].isoformat()
                except Exception:
                    pass
        member["no_show_logs"] = logs
    except Exception:
        member["no_show_logs"] = []
    return member


@router.get("/admin/members/{user_id}/coupons")
async def admin_get_member_coupons(user_id: str, admin=Depends(get_current_admin)):
    """Üye Detayı ekranı için o üyeye tanımlı/atanmış TÜM kuponlar (denetim
    amaçlı — otomatik verilen kuponlar (auto_issued, ör. eski Hoş Geldin
    Kuponu kayıtları) da dahil; admin_list_coupons bunları bilerek gizler
    ama burada gizlenmemeli). Her kupon için bu ÜYEYE ÖZEL kullanım hakkı/
    kullanım/kalan bilgisi de döner (admin_coupon_details'teki mantığın
    aynısı, kullanıcıdan kupona değil kupondan kullanıcıya bakıyor)."""
    member = await db.users.find_one(
        {"user_id": user_id, "role": {"$in": ["musteri", "member"]}}, {"_id": 0, "user_id": 1}
    )
    if not member:
        raise HTTPException(status_code=404, detail="Üye bulunamadı")
    coupons = await db.coupons.find({"assigned_user_ids": user_id}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    result = []
    for c in coupons:
        assignments = c.get("assignments") or []
        a = next((x for x in assignments if x.get("user_id") == user_id), None)
        if not a and user_id in (c.get("assigned_user_ids") or []):
            # Eski kayıtlar (yalnız assigned_user_ids var, assignments yok) için geriye dönük uyum
            a = {"limit": _norm_limit(c.get("per_user_limit"), 1), "used_count": 0, "last_used_at": None}
        lim = _norm_limit((a or {}).get("limit"), 1)
        used = int((a or {}).get("used_count") or 0)
        result.append({
            "coupon_id": c.get("id"),
            "code": c.get("code"),
            "title": c.get("title"),
            "discount_amount": c.get("discount_amount"),
            "discount_percent": c.get("discount_percent"),
            "min_amount": c.get("min_amount"),
            "active": c.get("active", True),
            "valid_until": c.get("valid_until"),
            "auto_issued": bool(c.get("auto_issued")),
            "single_use": bool(c.get("single_use")),
            "used": bool(c.get("used")),  # tek kullanımlık kuponlarda genel kullanım bayrağı
            "limit": lim,
            "used_count": used,
            "remaining": max(0, lim - used),
            "last_used_at": (a or {}).get("last_used_at"),
        })
    return result


# ----- Üye işlem geçmişi (birleşik log zaman çizelgesi) -----
_MEMBER_LOG_LABELS = {
    # Siparişler
    "order_created": "Sipariş oluşturuldu",
    "order_confirmed": "Sipariş onaylandı",
    "preparing": "Hazırlanıyor",
    "ready": "Hazır",
    "out_for_delivery": "Yola çıktı",
    "delivered": "Teslim edildi",
    "not_delivered": "Teslim edilemedi",
    "cancelled": "İptal edildi",
    "cancelled_by_admin": "İptal edildi (yönetici)",
    "refund_partial": "Kısmi iade yapıldı",
    "refund_full": "Tam iade yapıldı",
    # Kuponlar
    "coupon_used": "Kupon kullanıldı",
    "coupon_applied": "Kupon uygulandı",
    "coupon_created": "Kupon oluşturuldu",
    "coupon_assigned": "Kupon tanımlandı",
    "coupon_assigned_all": "Kupon tanımlandı (toplu)",
    # Ödemeler
    "payment_initiated": "Ödeme başlatıldı",
    "payment_success": "Ödeme başarılı",
    "payment_failed": "Ödeme başarısız",
    "refund_initiated": "İade başlatıldı",
    "refund_completed": "İade tamamlandı",
    # Oturum / hesap
    "register": "Üye kaydı oluşturuldu",
    "login_success": "Giriş yapıldı",
    "login_failed": "Giriş başarısız",
    "admin_login_failed": "Yönetici girişi başarısız",
    "logout": "Çıkış yapıldı",
    "account_closed": "Hesap kapatıldı",
    # Ceza / kısıtlama
    "cash_blocked": "Nakit ödeme kısıtlandı",
    "cash_unblocked": "Nakit kısıtlaması kaldırıldı",
    "undelivered_warning": "Teslim alınmadı uyarısı",
    # Yönetici işlemleri (log_admin, target_type=user) — KVKK/denetim
    "member_address_viewed": "Adres görüntülendi (yönetici)",
    "user_edited": "Üye bilgisi güncellendi (yönetici)",
    "user_deleted": "Üye hesabı kapatıldı (yönetici)",
    "penalty_manual_lift": "Ceza/kısıtlama kaldırıldı (yönetici)",
    "penalty_exception": "Mücbir sebep istisnası uygulandı (yönetici)",
}

def _member_log_label(action: str) -> str:
    a = str(action or "")
    if a in _MEMBER_LOG_LABELS:
        return _MEMBER_LOG_LABELS[a]
    if a.startswith("status_"):
        return _afro_status_tr(a)
    return a or "İşlem"


@router.get("/admin/members/{user_id}/logs")
async def admin_get_member_logs(user_id: str, limit: int = 300, admin=Depends(get_current_admin)):
    """Bir üyenin tüm loglarını (sipariş, kupon, ödeme, ceza, oturum, sözleşme)
    tek bir zaman çizelgesinde birleştirip döndürür (Üye Detayı ekranı için)."""
    member = await db.users.find_one(
        {"user_id": user_id, "role": {"$in": ["musteri", "member"]}}, {"_id": 0, "user_id": 1}
    )
    if not member:
        raise HTTPException(status_code=404, detail="Üye bulunamadı")

    limit = max(1, min(int(limit or 300), 1000))
    q = {"user_id": user_id}
    timeline = []

    def _ts(r):
        return r.get("created_at") or r.get("timestamp")

    def _add(category, r, extra=None):
        raw_ts = _ts(r)
        iso = _afro_iso(raw_ts)
        if not iso:
            return
        entry = {
            "category": category,
            "action": r.get("action") or "",
            "label": _member_log_label(r.get("action")),
            "timestamp": iso,
            "timestamp_tr": _afro_dt_tr(raw_ts),
            "order_id": r.get("order_id") or "",
            "note": r.get("admin_note") or "",
            "performed_by": r.get("performed_by") or "",
            "ip": r.get("ip_address") or r.get("ip") or "",
        }
        if extra:
            entry.update(extra)
        timeline.append(entry)

    # Siparişler
    for r in await db.log_orders.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit):
        _add("order", r)
    # Kuponlar
    for r in await db.log_coupons.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit):
        _add("coupon", r, {
            "coupon_code": r.get("coupon_code") or "",
            "discount_amount": r.get("discount_amount") or 0,
        })
    # Ödemeler
    for r in await db.log_payments.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit):
        _add("payment", r, {
            "amount": r.get("amount") or 0,
            "payment_provider": r.get("payment_provider") or "",
            "payment_method": r.get("payment_method") or "",
        })
    # Oturum / hesap
    for r in await db.log_auth.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit):
        _add("auth", r)
    # Ceza / kısıtlama
    for r in await db.payment_restriction_logs.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit):
        _add("penalty", r, {
            "label": r.get("action") and _member_log_label(r.get("action")) or (r.get("reason") or "Kısıtlama"),
            "reason": r.get("reason") or r.get("description") or "",
        })
    # Yönetici işlemleri (adres görüntüleme, bilgi güncelleme, ceza kaldırma vb. —
    # KVKK/denetim: "kim, hangi üyeye, ne zaman ne yaptı")
    admin_q = {"target_type": "user", "target_id": user_id}
    for r in await db.log_admin.find(admin_q, {"_id": 0}).sort("created_at", -1).to_list(limit):
        _add("admin_action", r, {"admin_name": r.get("admin_name") or ""})
    # Sözleşme onayları
    for r in await db.legal_agreement_logs.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit):
        _add("agreement", r, {
            "label": "Sözleşme onayı: " + (r.get("document_name") or r.get("document_code") or ""),
            "document_name": r.get("document_name") or "",
            "document_code": r.get("document_code") or "",
        })

    # Tarihe göre yeni->eski sırala
    timeline.sort(key=lambda x: x.get("timestamp") or "", reverse=True)
    timeline = timeline[:limit]

    counts = {}
    for t in timeline:
        counts[t["category"]] = counts.get(t["category"], 0) + 1

    return _compat_json_clean({"total": len(timeline), "counts": counts, "logs": timeline})


@router.put("/admin/members/{user_id}")
async def admin_update_member(
    user_id: str, payload: MemberUpdateInput, admin=Depends(get_current_admin), request: Request = None
):
    """Üye bilgilerini / kısıtlama durumunu günceller (Üye Detayı ekranından)."""
    member = await db.users.find_one(
        {"user_id": user_id, "role": {"$in": ["musteri", "member"]}}
    )
    if not member:
        raise HTTPException(status_code=404, detail="Üye bulunamadı")
    update: dict = {}
    if payload.name is not None:
        update["name"] = payload.name.strip() or member.get("name") or "Üye"
    if payload.phone is not None:
        update["phone"] = payload.phone.strip()
    if payload.is_restricted is not None:
        update["is_restricted"] = bool(payload.is_restricted)
        if payload.is_restricted:
            update["restriction_reason"] = payload.restriction_reason
            update["restriction_until"] = payload.restriction_until
        else:
            # Kısıtlama kaldırıldığında sebep/süre temizlenir
            update["restriction_reason"] = None
            update["restriction_until"] = None
    if update:
        await db.users.update_one({"user_id": user_id}, {"$set": update})
        for _mf, _mnv in update.items():
            _mov = member.get(_mf)
            if _mov != _mnv:
                await _insert_log("log_admin", {"admin_id": admin["user_id"], "admin_name": admin.get("name",""), "action": "user_edited", "target_type": "user", "target_id": user_id, "change_details": {"field": _mf, "old_value": _mov, "new_value": _mnv}, "admin_note": ""}, request)
    updated = await db.users.find_one(
        {"user_id": user_id}, {"_id": 0, "password_hash": 0, "username": 0}
    )
    return updated


@router.delete("/admin/members/{user_id}")
async def admin_delete_member(user_id: str, admin=Depends(get_current_admin), request: Request = None):
    _del_member = await db.users.find_one({"user_id": user_id, "role": {"$in": ["musteri", "member"]}}, {"_id": 0, "phone": 1})
    result = await db.users.delete_one({"user_id": user_id, "role": {"$in": ["musteri", "member"]}})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Üye bulunamadı")
    await db.user_sessions.delete_many({"user_id": user_id})
    await _insert_log("log_auth", {"user_id": user_id, "phone_masked": _mask_phone((_del_member or {}).get("phone","")), "action": "account_closed", "change_details": {"reason": "admin_initiated"}}, request)
    await _insert_log("log_data_deletion", {"user_id_anonymized": f"DELETED_USER_{user_id[-4:]}", "request_type": "admin_initiated", "action_taken": "partial_anonymized", "data_categories_deleted": ["name","phone","address"], "data_categories_retained": ["anonymized_order_records","payment_records"], "retention_reason": "Vergi Usul Kanunu gereği mali kayıtlar 10 yıl saklanır", "performed_by": "admin", "admin_id": admin["user_id"]}, request)
    await _insert_log("log_admin", {"admin_id": admin["user_id"], "admin_name": admin.get("name",""), "action": "user_deleted", "target_type": "user", "target_id": user_id, "change_details": None, "admin_note": "Hesap kapatıldı"}, request)
    return {"success": True}


@router.post("/admin/members/{user_id}/no-show/clear")
async def admin_no_show_clear(user_id: str, data: dict, admin=Depends(get_current_admin), request: Request = None):
    """Kapıda ödeme kısıtlamasını manuel kaldır (admin notu zorunlu).
    Sayaç korunur; sadece aktif kısıtlama kaldırılır."""
    note = _clean_text((data or {}).get("admin_note") or "")
    if not note:
        raise HTTPException(status_code=400, detail="Admin notu zorunludur.")
    member = await db.users.find_one({"user_id": user_id, "role": {"$in": ["musteri", "member"]}}, {"_id": 0})
    if not member:
        raise HTTPException(status_code=404, detail="Üye bulunamadı")
    clear_fields = {
        "online_only_until": None,
        "online_only_indefinite": False,
        "updated_at": now_utc(),
    }
    # No-show kaynaklı is_restricted kısıtlamasını da kaldır (elle konulmuşsa dokunma)
    if str(member.get("restriction_source") or "") == "no_show":
        clear_fields["is_restricted"] = False
        clear_fields["restriction_reason"] = None
        clear_fields["restriction_until"] = None
        clear_fields["restriction_source"] = None
    await db.users.update_one({"user_id": user_id}, {"$set": clear_fields})
    await _log_payment_restriction(
        action="cash_unblocked", user_id=user_id,
        details="Kapıda ödeme kısıtlaması admin tarafından manuel kaldırıldı",
        admin_id=admin.get("user_id"), admin_note=note, sms_sent=None,
    )
    await _insert_log("log_penalties", {"user_id": user_id, "order_id": None, "action": "penalty_lifted_admin", "penalty_level": member.get("no_show_penalty_level","level_1"), "reason": "Admin tarafından manuel kaldırıldı", "penalty_start": None, "penalty_end": None, "previous_level": member.get("no_show_penalty_level"), "performed_by": "admin", "admin_id": admin.get("user_id"), "admin_note": note, "notification_sent": False}, request)
    await _insert_log("log_admin", {"admin_id": admin["user_id"], "admin_name": admin.get("name",""), "action": "penalty_manual_lift", "target_type": "user", "target_id": user_id, "change_details": {"penalty_level": member.get("no_show_penalty_level"), "action": "lifted"}, "admin_note": note}, request)
    updated = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0, "username": 0})
    return {"success": True, "user": updated}


@router.post("/admin/members/{user_id}/no-show/exception")
async def admin_no_show_exception(user_id: str, data: dict, admin=Depends(get_current_admin), request: Request = None):
    """Mücbir sebep istisnası: teslim alınmama sayacından 1 düş (admin notu zorunlu).
    Yeni sayaca göre kısıtlama güncellenir/kaldırılır."""
    note = _clean_text((data or {}).get("admin_note") or "")
    if not note:
        raise HTTPException(status_code=400, detail="Admin notu zorunludur.")
    member = await db.users.find_one({"user_id": user_id, "role": {"$in": ["musteri", "member"]}}, {"_id": 0})
    if not member:
        raise HTTPException(status_code=404, detail="Üye bulunamadı")
    old_count = int(member.get("no_show_count") or 0)
    if old_count <= 0:
        raise HTTPException(status_code=400, detail="Bu üyenin düşürülecek teslim alınmama kaydı yok.")
    new_count = old_count - 1

    set_fields = {"no_show_count": new_count, "online_only_indefinite": False, "updated_at": now_utc()}
    is_no_show_src = str(member.get("restriction_source") or "") == "no_show"
    # Yeni sayaca göre kısıtlamayı yeniden hesapla
    if new_count <= 1:
        set_fields["online_only_until"] = None  # 0 veya 1 -> kısıt yok
        # No-show kaynaklı kısıtlamayı kaldır
        if is_no_show_src:
            set_fields["is_restricted"] = False
            set_fields["restriction_reason"] = None
            set_fields["restriction_until"] = None
            set_fields["restriction_source"] = None
    else:
        if new_count == 2:
            days = NO_SHOW_DAYS_LEVEL2
        elif new_count == 3:
            days = NO_SHOW_DAYS_LEVEL3
        else:
            days = NO_SHOW_DAYS_LEVEL4
        # Son teslim alınmama tarihini baz al; yoksa şimdi
        base = member.get("no_show_last_at") or now_utc()
        try:
            base = base if getattr(base, "tzinfo", None) else base.replace(tzinfo=timezone.utc)
        except Exception:
            base = now_utc()
        new_until = base + timedelta(days=days)
        # Süre geçmişse kısıt kalkar
        if new_until > now_utc():
            set_fields["online_only_until"] = new_until
            if is_no_show_src:
                date_str = new_until.strftime("%d.%m.%Y")
                set_fields["is_restricted"] = True
                set_fields["restriction_reason"] = (
                    f"Teslim alınmayan siparişiniz nedeniyle {date_str} tarihine kadar yalnızca "
                    "online kredi kartı ile sipariş verebilirsiniz."
                )
                set_fields["restriction_until"] = new_until.isoformat()
        else:
            set_fields["online_only_until"] = None
            if is_no_show_src:
                set_fields["is_restricted"] = False
                set_fields["restriction_reason"] = None
                set_fields["restriction_until"] = None
                set_fields["restriction_source"] = None

    await db.users.update_one({"user_id": user_id}, {"$set": set_fields})
    await _log_payment_restriction(
        action="exception_applied", user_id=user_id,
        details=f"Mücbir sebep istisnası uygulandı - sayaç {old_count} -> {new_count}",
        admin_id=admin.get("user_id"), admin_note=note, sms_sent=None,
    )
    # LOG: ceza istisnası (yeni log sistemi)
    await _insert_log("log_penalties", {
        "user_id": user_id,
        "order_id": None,
        "action": "penalty_lifted_admin",
        "penalty_level": f"level_{min(old_count, 4)}",
        "reason": f"Mücbir sebep istisnası - sayaç {old_count} -> {new_count}",
        "penalty_start": None,
        "penalty_end": None,
        "previous_level": f"level_{min(old_count, 4)}",
        "performed_by": "admin",
        "admin_id": admin.get("user_id"),
        "admin_note": note,
        "notification_sent": False,
    }, request)
    await _insert_log("log_admin", {
        "admin_id": admin["user_id"],
        "admin_name": admin.get("name", ""),
        "action": "penalty_exception",
        "target_type": "user",
        "target_id": user_id,
        "change_details": {"field": "no_show_count", "old_value": old_count, "new_value": new_count},
        "admin_note": note,
    }, request)
    updated = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0, "username": 0})
    return {"success": True, "user": updated}
