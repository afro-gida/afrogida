from fastapi import FastAPI, APIRouter, Header, HTTPException, Depends, Request, File, UploadFile
from fastapi.staticfiles import StaticFiles
from fastapi.responses import PlainTextResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import base64
from pywebpush import webpush, WebPushException
import os
import logging
import uuid
import base64
import hashlib
import re
import json
import bcrypt
import httpx
import io
from pathlib import Path
from pydantic import BaseModel, Field, field_validator
from typing import List, Optional
from datetime import datetime, timezone, timedelta


from core.util import now_utc, to_aware, new_id, _clean_text, _afro_norm, _norm_limit
from core.serializers import _public_user_doc
from core.config import (
    ROOT_DIR, EMERGENT_SESSION_API, SESSION_DURATION_DAYS, ORDERED_CATEGORIES,
    PRODUCT_SEED_VERSION, WELCOME_DISCOUNT_AMOUNT, WELCOME_MIN_AMOUNT, CATALOG_CACHE_TTL,
    AFRO_SECRET_KEY, _AFRO_ENC_RAW, SECURITY_ADMIN_PHONE, SECURITY_SMS_THROTTLE_MIN,
    ADMIN_SESSION_HOURS, ADMIN_2FA_PHONE, ADMIN_2FA_TTL_SEC, ADMIN_2FA_MAX_ATTEMPTS,
    ENC_PREFIX, _afro_key_material,
)
from services.admin_logs import _afro_status_tr, _afro_iso, _afro_dt_tr
from core.crypto import _AFRO_FERNET, hash_token
from core.db import client, db  # .env core.config import'unda yüklendi
from core.logs import _mask_phone, _insert_log, _log_payment_restriction
from services.noshow import (
    NO_SHOW_DAYS_LEVEL2, NO_SHOW_DAYS_LEVEL3, NO_SHOW_DAYS_LEVEL4,
    _evaluate_no_show_restriction,
)
from core.security import (
    _admin_watchdog_loop, get_current_admin, get_current_staff,
    SUPPLIER_ROLES, _yonetici_only,
)
from models import (
    Product, Campaign, Coupon, Market,
    MemberOut, MemberUpdateInput, StaffAssignInput, StaffAssignByIdInput, CourierAssignInput,
)
from services.catalog import _read_catalog_config
from services.orders import _compat_json_clean

app = FastAPI()
app.mount("/uploads", StaticFiles(directory=str(ROOT_DIR / "uploads")), name="uploads")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Sabitler -> core/config.py (EMERGENT_SESSION_API, SESSION_DURATION_DAYS,
# ORDERED_CATEGORIES, PRODUCT_SEED_VERSION, WELCOME_*, CATALOG_CACHE_TTL)

# catalog_config önbellek -> services/catalog.py

# ---------------- Helpers ----------------
# now_utc / to_aware / new_id -> core/util.py
# para (D/money/money_d/_num_close) -> core/money.py
# şifreleme + imzalar (enc_str/dec_str/_hmac_hex/hash_token/order_signature) -> core/crypto.py


# ============================================================
# AFRO GÜVENLİK KATMANI (v1)
#  - Uçtan uca şifreleme (Fernet/AES-128-CBC+HMAC) : enc_str / dec_str
#  - Sipariş bütünlük imzası (HMAC-SHA256)          : order_signature
#  - Oturum token'ları DB'de yalnızca HMAC özeti     : hash_token
#  - Güvenlik alarmı (log_security + yöneticiye SMS)  : security_alarm
#  - Hız sınırı / hesap kilidi (Mongo tabanlı)       : rate_limit / lockout
#  - Kuruş hassasiyetli para hesabı (Decimal)         : money / D
# Anahtarlar .env içindedir (AFRO_SECRET_KEY, AFRO_ENC_KEY). Anahtar
# olmadan DB'deki şifreli alanlar OKUNAMAZ.
# ============================================================
import asyncio
import secrets
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation
from pymongo import ReturnDocument

# Bu blok modüllere taşındı:
#   _afro_key_material, AFRO_SECRET_KEY, _AFRO_ENC_RAW, SECURITY_ADMIN_PHONE,
#   SECURITY_SMS_THROTTLE_MIN, ADMIN_SESSION_HOURS, ADMIN_2FA_*, ENC_PREFIX -> core/config.py
#   Fernet, InvalidToken, _afro_fernet, _AFRO_FERNET, enc_str, dec_str, is_encrypted,
#   _hmac_hex, hash_token, order_signature, verify_order_signature            -> core/crypto.py
#   _CENT, _MILLI, D, money, money_d, _num_close                              -> core/money.py
# (hepsi dosyanın başında import ediliyor)


# Sipariş çıkış görünümü (ORDER_ENC_FIELDS, _dec_order, _customer_order_view) -> services/orders.py


# Güvenlik katmanı (security_alarm, rate_limit, check_lockout, register_failure,
# clear_failures, hash_password, verify_password, create_session, _session_query,
# get_current_user(+_optional), _admin_session_track, _admin_watchdog_loop,
# get_current_admin/supplier/staff/courier, get_optional_user, rol yardımcıları)
# -> core/security.py  (dosya başında import ediliyor)


# Bildirim gönderimi (Expo + Web Push VAPID) -> services/push.py
# EXPO_PUSH_API, VAPID_*, send_push_to_users/all, send_push_to_courier_markets,
# _send_web_push_one, send_web_push_to_all/user  (dosya başında import ediliyor)

# Bildirim endpoint'leri (web-subscribe, vapid-key, heartbeat, push-token,
# admin push send/stats/web-send) -> routers/push.py


# Kurye/tedarikçi rol yardımcıları + get_current_courier + get_optional_user
# -> core/security.py


# Pydantic modelleri -> models.py (dosya başında import ediliyor)


# ---------------- Auth / adres / OTP / parola sıfırlama -> routers/auth.py ----------------


# Ürün / kategori / kampanya endpoint'leri -> routers/products.py


# Kupon endpoint'leri -> routers/coupons.py
# Pazar endpoint'leri  -> routers/markets.py


@api_router.get("/")
async def root():
    return {"message": "Pazar Uygulaması API"}


# ---------------- Member (customer) management ----------------
@api_router.get("/admin/members", response_model=List[MemberOut])
async def admin_list_members(search: Optional[str] = None, admin=Depends(get_current_admin)):
    query: dict = {"role": {"$in": ["musteri", "member"]}}
    if search and search.strip():
        rx = {"$regex": search.strip(), "$options": "i"}
        query["$or"] = [{"name": rx}, {"phone": rx}, {"email": rx}]
    members = await db.users.find(
        query, {"_id": 0, "password_hash": 0, "username": 0}
    ).sort("created_at", -1).to_list(2000)
    return members


@api_router.get("/admin/members/count")
async def admin_members_count(admin=Depends(get_current_admin)):
    count = await db.users.count_documents({"role": {"$in": ["musteri", "member"]}})
    return {"count": count}


@api_router.get("/admin/members/{user_id}")
async def admin_get_member(user_id: str, admin=Depends(get_current_admin)):
    """Üye Detayı ekranı için tek üyenin tüm (hassas olmayan) bilgilerini döndürür."""
    member = await db.users.find_one(
        {"user_id": user_id, "role": {"$in": ["musteri", "member"]}},
        {"_id": 0, "password_hash": 0, "username": 0},
    )
    if not member:
        raise HTTPException(status_code=404, detail="Üye bulunamadı")
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
}

def _member_log_label(action: str) -> str:
    a = str(action or "")
    if a in _MEMBER_LOG_LABELS:
        return _MEMBER_LOG_LABELS[a]
    if a.startswith("status_"):
        return _afro_status_tr(a)
    return a or "İşlem"


@api_router.get("/admin/members/{user_id}/logs")
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


@api_router.put("/admin/members/{user_id}")
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


@api_router.delete("/admin/members/{user_id}")
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


@api_router.post("/admin/members/{user_id}/no-show/clear")
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


@api_router.post("/admin/members/{user_id}/no-show/exception")
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


# ---------------- Esnaf (tedarikçi hesabı) yönetimi ----------------
# StaffAssignInput -> models.py ; _yonetici_only -> core/security.py


@api_router.get("/admin/staff")
async def admin_list_staff(admin=Depends(get_current_admin)):
    _yonetici_only(admin)
    staff = await db.users.find(
        {"role": {"$in": list(SUPPLIER_ROLES)}}, {"_id": 0, "password_hash": 0, "username": 0}
    ).sort("created_at", -1).to_list(500)
    return staff


@api_router.get("/admin/supplier-groups")
async def admin_supplier_groups(admin=Depends(get_current_admin)):
    """Tedarikçi (supplier_group) seçenekleri: SADECE katalog config'deki tedarikçiler.
    Eskiden ürünlerde kullanılan + suppliers koleksiyonu da birleştiriliyordu; bu yüzden
    silinmiş/eski tedarikçiler (Afro Sebze, Meyve, ...) listede görünmeye devam ediyordu.
    Artık yalnızca catalog_config.suppliers döndürülür ki yönetici listeyi tam kontrol etsin."""
    _yonetici_only(admin)
    cfg = await _read_catalog_config()
    groups = set()
    for g in (cfg.get("suppliers") or []):
        if g:
            groups.add(g)
    return sorted(groups)


# ---------------------------------------------------------------------
# TEDARİKÇİ SATIŞ LOGU
# Bir tedarikçinin (supplier_group) SATILAN (teslim edilen) ürünlerinden
# toplanan tutarı ve satış logunu döndürür. Sipariş kalemleri
# `supplier_group_snapshot` alanı ile tedarikçiye bağlanır.
# - Sadece order_status == "teslim_edildi" (satış tamamlandı) sayılır.
# - İade gerçekleşen siparişlerde ilgili kalemler "iade edildi" işaretlenir
#   ve tutar net toplamdan düşülür.
#   * Tam iade (refund_status/payment_status == "iade_edildi"): tedarikçinin
#     o siparişteki tüm tutarı düşülür.
#   * Kısmi iade ("kismi_iade_edildi"): iade tutarı, tedarikçinin siparişteki
#     payı oranında (orantılı) düşülür.
# ---------------------------------------------------------------------
# Satış "tamamlandı" (para toplandı) sayılan sipariş durumu
# Tedarikçi satış/hakediş hesaplaması (SUPPLIER_SOLD_STATUSES, _order_refund_info,
# _order_item_refunds, _build_cost_map, _item_unit_cost, _supplier_items_of_order)
# -> services/suppliers.py


# /api/user/me -> routers/orders.py


# supplier my-sales / admin-supplier-sales(-summary) / all-supplier-sales,
# fiyat kilidi (MADDE 6) ve tedarikci odeme takibi (MADDE 8) -> routers/suppliers.py



async def _assign_staff_by_identifier(identifier: str, supplier_group: Optional[str]):
    """identifier user_id veya telefon olabilir.
    supplier_group verilirse üyeyi esnaf yapar ve tedarikçiyi atar;
    boş/None verilirse esnaf yetkisini kaldırıp normal üyeye (musteri) döndürür."""
    ident = (identifier or "").strip()
    if not ident:
        raise HTTPException(status_code=400, detail="Telefon veya user_id girin")
    sg = (supplier_group or "").strip() or None
    user = await db.users.find_one({"$or": [{"user_id": ident}, {"phone": ident}]})
    if not user:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
    if user.get("role") in ("admin", "yonetici"):
        raise HTTPException(status_code=400, detail="Yönetici hesabı tedarikçi olarak atanamaz")
    new_role = "esnaf" if sg else "musteri"
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"role": new_role, "supplier_group": sg}},
    )
    updated = await db.users.find_one(
        {"user_id": user["user_id"]}, {"_id": 0, "password_hash": 0, "username": 0}
    )
    return {"success": True, "user": _public_user_doc(updated)}


@api_router.put("/admin/staff/{user_id}")
async def admin_assign_staff(user_id: str, payload: StaffAssignInput, admin=Depends(get_current_admin)):
    _yonetici_only(admin)
    return await _assign_staff_by_identifier(user_id, payload.supplier_group)


@api_router.post("/admin/staff/assign")
async def admin_assign_staff_post(payload: StaffAssignByIdInput, admin=Depends(get_current_admin)):
    _yonetici_only(admin)
    return await _assign_staff_by_identifier(payload.identifier, payload.supplier_group)


# ---------------------------------------------------------------------
# KURYE ATAMA (yönetici) — esnaf atama ile aynı mantık: kullanıcıya 'kurye'
# rolü + bir PAZAR (courier_market) atanır. Boş market verilirse kuryelik
# kaldırılıp normal üyeye (musteri) döndürülür.
# ---------------------------------------------------------------------
async def _assign_courier_by_identifier(identifier: str, courier_markets_list: Optional[List[str]]):
    ident = (identifier or "").strip()
    if not ident:
        raise HTTPException(status_code=400, detail="Telefon veya user_id girin")
    mkts = [m.strip() for m in (courier_markets_list or []) if (m or "").strip()]
    user = await db.users.find_one({"$or": [{"user_id": ident}, {"phone": ident}]})
    if not user:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
    if user.get("role") in ("admin", "yonetici"):
        raise HTTPException(status_code=400, detail="Yönetici hesabı kurye olarak atanamaz")
    if user.get("role") in SUPPLIER_ROLES and mkts:
        raise HTTPException(status_code=400, detail="Bu hesap tedarikçi (esnaf). Önce tedarikçiliği kaldırın.")
    new_role = "kurye" if mkts else "musteri"
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {
            "role": new_role,
            "courier_markets": mkts,
            "courier_market": mkts[0] if mkts else None,  # geriye uyumluluk
        }},
    )
    updated = await db.users.find_one(
        {"user_id": user["user_id"]}, {"_id": 0, "password_hash": 0, "username": 0}
    )
    return {"success": True, "user": _public_user_doc(updated)}


@api_router.post("/admin/courier/assign")
async def admin_assign_courier_post(payload: CourierAssignInput, admin=Depends(get_current_admin)):
    _yonetici_only(admin)
    mkts = payload.courier_markets
    if mkts is None and payload.courier_market is not None:
        mkts = [payload.courier_market] if payload.courier_market else []
    return await _assign_courier_by_identifier(payload.identifier, mkts)


@api_router.get("/admin/couriers")
async def admin_list_couriers(admin=Depends(get_current_admin)):
    """Tüm kurye hesapları (yönetici görünümü)."""
    couriers = await db.users.find(
        {"role": "kurye"},
        {"_id": 0, "password_hash": 0, "username": 0},
    ).to_list(500)
    return [_public_user_doc(c) for c in couriers]


@api_router.get("/admin/courier-markets")
async def admin_courier_market_options(admin=Depends(get_current_admin)):
    """Kurye atamak için seçilebilir pazar adları:
    markets koleksiyonu + catalog_config.supplier_markets'teki tüm pazar adlarının birleşimi."""
    names = []
    seen = set()
    def _add(n):
        n = (n or "").strip()
        if n and _afro_norm(n) not in seen:
            seen.add(_afro_norm(n))
            names.append(n)
    for m in await db.markets.find({}, {"_id": 0, "name": 1}).to_list(200):
        _add(m.get("name"))
    cfg = await _read_catalog_config()
    for _sg, mkts in ((cfg or {}).get("supplier_markets") or {}).items():
        for n in (mkts or []):
            _add(n)
    names.sort(key=lambda x: x.lower())
    return {"markets": names}


# =====================================================================
# KURYE DETAY & İSTATİSTİK ENDPOİNTLERİ
# =====================================================================

@api_router.get("/admin/courier/{user_id}/stats")
async def admin_courier_stats(user_id: str, date: str = "", admin=Depends(get_current_admin)):
    """Bir kuryenin belirli bir güne ait istatistikleri (teslim sayısı, kazanç).
    date parametresi 'YYYY-MM-DD' formatında. Boşsa bugün (TR saati) kullanılır."""
    from datetime import timezone as _tz
    import pytz as _pytz
    TR = _pytz.timezone("Europe/Istanbul")
    if date:
        try:
            day_tr = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=TR)
        except Exception:
            raise HTTPException(status_code=400, detail="Geçersiz tarih formatı (YYYY-MM-DD)")
    else:
        day_tr = datetime.now(TR).replace(hour=0, minute=0, second=0, microsecond=0)
    day_start = day_tr.astimezone(_tz.utc)
    # day_end: İstanbul günü 23:59:59'u UTC'ye çevir (day_start.replace hatası değil)
    day_end = day_tr.replace(hour=23, minute=59, second=59, microsecond=999999).astimezone(_tz.utc)

    courier = await db.users.find_one(
        {"user_id": user_id},
        {"_id": 0, "name": 1, "phone": 1, "courier_is_online": 1,
         "courier_markets": 1, "courier_market": 1, "courier_per_package_fee": 1}
    )
    if not courier:
        raise HTTPException(status_code=404, detail="Kurye bulunamadı")

    # Tüm zamanlar toplamı
    total_delivered = await db.transactions.count_documents({
        "courier_id": user_id, "order_status": "teslim_edildi"
    })
    # Seçilen gün
    day_delivered = await db.transactions.count_documents({
        "courier_id": user_id, "order_status": "teslim_edildi",
        "delivered_at": {"$gte": day_start, "$lte": day_end}
    })
    # Aktif (elimde) teslimat var mı
    active_count = await db.transactions.count_documents({
        "courier_id": user_id,
        "order_status": {"$in": ["yolda", "hazir"]},
        "delivery_type": "eve_servis"
    })
    fee = float(courier.get("courier_per_package_fee") or 0)
    return {
        "user_id": user_id,
        "name": courier.get("name"),
        "phone": courier.get("phone"),
        "is_online": bool(courier.get("courier_is_online")),
        "per_package_fee": fee,
        "courier_markets": courier.get("courier_markets") or ([courier.get("courier_market")] if courier.get("courier_market") else []),
        "is_busy": active_count > 0,
        "active_count": active_count,
        "total_delivered": total_delivered,
        "day_delivered": day_delivered,
        "day_earnings": round(day_delivered * fee, 2),
        "total_earnings": round(total_delivered * fee, 2),
        "date": day_tr.strftime("%Y-%m-%d"),
    }


@api_router.put("/admin/courier/{user_id}/settings")
async def admin_courier_update_settings(user_id: str, payload: dict, admin=Depends(get_current_admin)):
    """Admin: kuryenin paket başı ücretini ve/veya online durumunu güncelle."""
    _yonetici_only(admin)
    upd = {}
    if "per_package_fee" in payload:
        try:
            upd["courier_per_package_fee"] = float(payload["per_package_fee"])
        except Exception:
            raise HTTPException(status_code=400, detail="Geçersiz ücret değeri")
    if "is_online" in payload:
        upd["courier_is_online"] = bool(payload["is_online"])
    if not upd:
        raise HTTPException(status_code=400, detail="Güncellenecek alan yok")
    upd["updated_at"] = now_utc()
    res = await db.users.update_one({"user_id": user_id}, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Kurye bulunamadı")
    return {"ok": True}


# /api/courier/toggle-online, /api/courier/stats -> routers/courier.py


# ---------------------------------------------------------------------
# Resim yukleme (urun / kampanya panelleri kamera veya galeri yuklemesi)
# Frontend blob'u FormData 'file' olarak /api/admin/upload'a POST eder.
# Buraya kadar endpoint yoktu -> yukleme basarisiz oluyor, urun/kampanya
# fotografi uygulanmiyordu. Dosyayi uploads/ klasorune kaydedip kalici
# URL (/uploads/<ad>) donuyoruz. Bu URL nginx tarafindan servis edilir.
# ---------------------------------------------------------------------
_UPLOAD_EXT_BY_CTYPE = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/heic": ".jpg",
    "image/heif": ".jpg",
}
_UPLOAD_MAX_BYTES = 12 * 1024 * 1024  # 12 MB

# --- Otomatik gorsel optimizasyonu ------------------------------------
# Panelden yuklenen her fotograf, siteyi yormamasi icin sunucuda otomatik
# olarak: (1) EXIF donusune gore duzeltilir, (2) en uzun kenari
# _IMG_MAX_EDGE pikseli asiyorsa oranli kucultulur, (3) WebP formatina
# cevrilir (kalite _IMG_WEBP_QUALITY). Boylece 3-5 MB'lik telefon
# fotograflari ~20-60 KB'lik WebP'ye duser; 100-150 urunlu sayfa cok
# daha hizli acilir. Animasyonlu GIF ve PIL'in isleyemedigi dosyalar
# oldugu gibi (ham) kaydedilir; hata durumunda da sisteme zarar vermez.
_IMG_MAX_EDGE = 600            # en uzun kenar (px) - mobil kartlar icin optimize (detay korunur)
_IMG_WEBP_QUALITY = 78         # 0-100; 78 = detay korunur, dosya boyutu kucuk


def _optimize_to_webp(content: bytes):
    """Ham bayt -> optimize edilmis WebP bayt. Basarisizsa (None, None)."""
    try:
        from PIL import Image, ImageOps, ImageSequence  # lazy import
    except Exception:
        return None, None
    try:
        img = Image.open(io.BytesIO(content))
        # Animasyonlu GIF/WebP -> dokunma (kareler bozulmasin)
        n_frames = getattr(img, "n_frames", 1)
        if n_frames and n_frames > 1:
            return None, None
        # EXIF donus bilgisine gore dik cevir (telefon fotograflari)
        img = ImageOps.exif_transpose(img)
        # Renk modu: seffaflik varsa RGBA (WebP destekler), yoksa RGB
        if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
            img = img.convert("RGBA")
        else:
            img = img.convert("RGB")
        # Oranli kucultme (yalnizca buyukse)
        w, h = img.size
        longest = max(w, h)
        if longest > _IMG_MAX_EDGE:
            scale = _IMG_MAX_EDGE / float(longest)
            img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
        out = io.BytesIO()
        img.save(out, format="WEBP", quality=_IMG_WEBP_QUALITY, method=6)
        return out.getvalue(), ".webp"
    except Exception:
        return None, None


@api_router.post("/admin/upload")
async def admin_upload_image(file: UploadFile = File(...), staff=Depends(get_current_staff)):
    # Tedarikçiler (esnaf/supplier) de ürün resmi yükleyebilir. Bu endpoint yalnızca
    # dosyayı kaydedip URL döner; ürün sahiplik kontrolü update_product içinde yapılır.
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Bos dosya")
    if len(content) > _UPLOAD_MAX_BYTES:
        raise HTTPException(status_code=400, detail="Dosya cok buyuk (en fazla 12 MB)")

    # Once optimize etmeyi dene (yeniden boyutlandir + WebP'ye cevir)
    optimized, opt_ext = _optimize_to_webp(content)
    if optimized is not None:
        content = optimized
        ext = opt_ext
    else:
        # Optimizasyon yapilamadi (animasyon / desteklenmeyen / hata) -> ham kaydet
        ctype = (file.content_type or "").lower().strip()
        ext = _UPLOAD_EXT_BY_CTYPE.get(ctype)
        if not ext:
            name = (file.filename or "").lower()
            for e in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
                if name.endswith(e):
                    ext = ".jpg" if e == ".jpeg" else e
                    break
        if not ext:
            ext = ".jpg"

    uploads_dir = ROOT_DIR / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    fname = f"{uuid.uuid4().hex}{ext}"
    (uploads_dir / fname).write_bytes(content)
    return {"url": f"/uploads/{fname}"}


from routers.push import router as _push_router
from routers.auth import router as _auth_router
from routers.products import router as _products_router
from routers.coupons import router as _coupons_router
from routers.markets import router as _markets_router
from routers.orders import router as _orders_router
from routers.payments import router as _payments_router
from routers.courier import router as _courier_router
from routers.suppliers import router as _suppliers_router
from routers.logs import router as _logs_router
from routers.catalog import router as _catalog_router
from routers.complaints import router as _complaints_router
from routers.admin_orders import router as _admin_orders_router
from routers.settings import router as _settings_router
from routers.legal import router as _legal_router
app.include_router(api_router)
app.include_router(_push_router)
app.include_router(_auth_router)
app.include_router(_products_router)
app.include_router(_coupons_router)
app.include_router(_markets_router)
app.include_router(_orders_router)
app.include_router(_payments_router)
app.include_router(_courier_router)
app.include_router(_suppliers_router)
app.include_router(_logs_router)
app.include_router(_catalog_router)
app.include_router(_complaints_router)
app.include_router(_admin_orders_router)
app.include_router(_settings_router)
app.include_router(_legal_router)




_AFRO_ORIGINS = [o.strip() for o in (os.environ.get("AFRO_ALLOWED_ORIGINS") or
                 "https://afrogida.com.tr,https://www.afrogida.com.tr,http://localhost:3000,http://localhost:8081,http://localhost:19006,capacitor://localhost,http://localhost").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=_AFRO_ORIGINS,
    allow_origin_regex=r"^https://([a-z0-9-]+\.)?afrogida\.com\.tr$",
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------- Startup: indexes + seed ----------------
@app.on_event("startup")
async def startup():
    await db.users.create_index("user_id", unique=True)

    async def _safe_index(coll, keys, **opts):
        """Çok işçili (multi-worker) başlatmada eşzamanlı indeks kurulumları birbirini iptal
        edebilir (IndexBuildAborted); başlatmayı çökertmeden yeniden dener."""
        for _try in range(4):
            try:
                await coll.create_index(keys, **opts)
                return
            except Exception as _ix_exc:
                logger.warning(f"[GÜVENLİK] indeks {getattr(coll, 'name', '')}:{keys} deneme {_try+1}: {_ix_exc}")
                await asyncio.sleep(0.5 + _try)

    # Oturumlar: eski düz token indeksi (unique, sparse OLMAYAN) yeni hash'li kayıtlarla çakışır -> kaldır
    try:
        _sess_idx = await db.user_sessions.index_information()
        _old = _sess_idx.get("session_token_1")
        if _old and not _old.get("sparse"):
            await db.user_sessions.drop_index("session_token_1")
    except Exception as _di_exc:
        logger.warning(f"[GÜVENLİK] session_token indeksi kaldırılamadı (başka işçi hallediyor olabilir): {_di_exc}")
    await _safe_index(db.user_sessions, "session_token", unique=True, sparse=True)
    await _safe_index(db.user_sessions, "token_hash", unique=True, sparse=True)
    await _safe_index(db.user_sessions, "expires_at", expireAfterSeconds=0)
    # Mevcut düz token'ları tek seferlik hash'e çevir (DB sızıntısında oturum çalınamasın)
    try:
        async for _s in db.user_sessions.find({"session_token": {"$exists": True, "$ne": None}}, {"_id": 1, "session_token": 1}):
            await db.user_sessions.update_one({"_id": _s["_id"]}, {"$set": {"token_hash": hash_token(_s["session_token"])}, "$unset": {"session_token": ""}})
    except Exception as _mig_exc:
        logger.error(f"[GÜVENLİK] oturum migrasyonu hatası: {_mig_exc}")
    await _safe_index(db.rate_limits, "expires_at", expireAfterSeconds=0)
    await _safe_index(db.rate_limits, [("key", 1), ("bucket", 1)], unique=True)
    await _safe_index(db.login_lockouts, "key", unique=True)
    await _safe_index(db.login_lockouts, "expires_at", expireAfterSeconds=0)
    await _safe_index(db.security_alarm_sms, "sent_at", expireAfterSeconds=86400)
    await _safe_index(db.admin_2fa, "challenge_id", unique=True)
    await _safe_index(db.admin_2fa, "expires_at", expireAfterSeconds=0)
    try:
        _adm_ids = [u["user_id"] async for u in db.users.find({"role": {"$in": ["admin", "yonetici"]}}, {"_id": 0, "user_id": 1})]
        _dr = await db.user_sessions.delete_many({"user_id": {"$in": _adm_ids}, "twofa_verified": {"$ne": True}})
        if _dr.deleted_count:
            logger.warning("[GÜVENLİK] SMS doğrulamasız %s yönetici oturumu düşürüldü", _dr.deleted_count)
    except Exception as _e:
        logger.error("[GÜVENLİK] yönetici oturum temizliği hatası: %s", _e)
    if _AFRO_FERNET is None:
        logger.error("[GÜVENLİK] cryptography yok — venv'e 'pip install cryptography' gerekli!")
    # Yönetici oturum güvenlik watchdog'unu başlat (her 2 dk'da bir tarama)
    asyncio.create_task(_admin_watchdog_loop())
    logger.info("[GÜVENLİK] Admin watchdog başlatıldı (2 dk'da bir tarama)")
    await db.products.create_index("id", unique=True)
    # Aynı kullanıcı adının çok işçili başlatmada birden çok kez oluşmasını engelle.
    await _safe_index(db.users, "username", unique=True, sparse=True)

    # NOT: Sabit parolalı "admin" / "pazar2026" seed hesabı GÜVENLİK nedeniyle
    # kaldırıldı (2026-09-10 denetimi, bulgu #1). Yönetici hesabı artık yalnızca
    # elle (DB'de) oluşturulur; canlıda `yonetici` rollü gerçek bir hesap mevcut.

    # Seed / migrate products to the fixed category structure (runs once per version)
    meta = await db.meta.find_one({"key": "product_seed"})
    current_version = meta["version"] if meta else 0
    if current_version < PRODUCT_SEED_VERSION:
        sample_products = [
            # Domates
            {"name": "Salkım Domates", "category": "Domates", "price": 24.90, "unit": "kg", "description": "Taze salkım domates", "image_url": "https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=400&q=80"},
            {"name": "Pembe Domates", "category": "Domates", "price": 29.90, "unit": "kg", "description": "Tatlı pembe domates", "image_url": "https://images.unsplash.com/photo-1607305387299-a3d9611cd469?w=400&q=80"},
            {"name": "Çeri Domates", "category": "Domates", "price": 39.90, "unit": "kg", "description": "Atıştırmalık çeri domates", "image_url": "https://images.unsplash.com/photo-1546470427-e26264be0b0d?w=400&q=80"},
            # Salata
            {"name": "Kıvırcık Marul", "category": "Salata", "price": 12.00, "unit": "adet", "description": "Çıtır kıvırcık marul", "image_url": "https://images.unsplash.com/photo-1622206151226-18ca2c9ab4a1?w=400&q=80"},
            {"name": "Göbek Salata", "category": "Salata", "price": 15.00, "unit": "adet", "description": "Taze göbek salata", "image_url": "https://images.unsplash.com/photo-1640958904159-51ae08bd3412?w=400&q=80"},
            {"name": "Roka", "category": "Salata", "price": 8.00, "unit": "demet", "description": "Taze roka", "image_url": "https://images.unsplash.com/photo-1515872474884-c6dd0f2f3a2f?w=400&q=80"},
            {"name": "Maydanoz", "category": "Salata", "price": 6.00, "unit": "demet", "description": "Taze maydanoz", "image_url": "https://images.unsplash.com/photo-1535189043414-47a3c49a0bed?w=400&q=80"},
            # Kabak
            {"name": "Sakız Kabağı", "category": "Kabak", "price": 22.00, "unit": "kg", "description": "Taze sakız kabağı", "image_url": "https://images.unsplash.com/photo-1596199388524-13d1bb6e8b34?w=400&q=80"},
            {"name": "Bal Kabağı", "category": "Kabak", "price": 18.00, "unit": "kg", "description": "Tatlı bal kabağı", "image_url": "https://images.unsplash.com/photo-1570586437263-ab629fccc818?w=400&q=80"},
            # Patlıcan
            {"name": "Kemer Patlıcan", "category": "Patlıcan", "price": 27.90, "unit": "kg", "description": "İnce kabuklu kemer patlıcan", "image_url": "https://images.unsplash.com/photo-1659261200833-ec8761558af7?w=400&q=80"},
            {"name": "Bostan Patlıcan", "category": "Patlıcan", "price": 24.90, "unit": "kg", "description": "Dolmalık bostan patlıcan", "image_url": "https://images.unsplash.com/photo-1605196560547-b2f7281b7355?w=400&q=80"},
            # Biber
            {"name": "Çarliston Biber", "category": "Biber", "price": 34.00, "unit": "kg", "description": "Tatlı çarliston biber", "image_url": "https://images.unsplash.com/photo-1563565375-f3fdfdbefa83?w=400&q=80"},
            {"name": "Sivri Biber", "category": "Biber", "price": 36.00, "unit": "kg", "description": "Acı sivri biber", "image_url": "https://images.unsplash.com/photo-1583119022894-919a68a3d0e3?w=400&q=80"},
            {"name": "Dolmalık Biber", "category": "Biber", "price": 32.00, "unit": "kg", "description": "Renkli dolmalık biber", "image_url": "https://images.unsplash.com/photo-1525607551316-4a8e16d1f9ba?w=400&q=80"},
            {"name": "Kapya Biber", "category": "Biber", "price": 38.00, "unit": "kg", "description": "Közlemelik kapya biber", "image_url": "https://images.unsplash.com/photo-1601648764658-cf37e8c89b70?w=400&q=80"},
            # Çeşitler
            {"name": "Salatalık", "category": "Çeşitler", "price": 19.50, "unit": "kg", "description": "Çıtır taze salatalık", "image_url": "https://images.unsplash.com/photo-1604977042946-1eecc30f269e?w=400&q=80"},
            {"name": "Patates", "category": "Çeşitler", "price": 14.00, "unit": "kg", "description": "Yerli patates", "image_url": "https://images.unsplash.com/photo-1518977676601-b53f82aba655?w=400&q=80"},
            {"name": "Soğan", "category": "Çeşitler", "price": 12.50, "unit": "kg", "description": "Kuru soğan", "image_url": "https://images.unsplash.com/photo-1508747703725-719777637510?w=400&q=80"},
            {"name": "Havuç", "category": "Çeşitler", "price": 16.00, "unit": "kg", "description": "Taze havuç", "image_url": "https://images.unsplash.com/photo-1598170845058-32b9d6a5da37?w=400&q=80"},
            {"name": "Limon", "category": "Çeşitler", "price": 21.00, "unit": "kg", "description": "Sulu limon", "image_url": "https://images.unsplash.com/photo-1590502593747-42a996133562?w=400&q=80"},
        ]
        await db.products.delete_many({})
        docs = [Product(**p).dict() for p in sample_products]
        await db.products.insert_many(docs)
        await db.meta.update_one(
            {"key": "product_seed"},
            {"$set": {"key": "product_seed", "version": PRODUCT_SEED_VERSION}},
            upsert=True,
        )
        logger.info("Seeded/migrated %d products to v%d", len(docs), PRODUCT_SEED_VERSION)

    # Seed campaigns
    if await db.campaigns.count_documents({}) == 0:
        sample_campaigns = [
            {"title": "Üyelere Özel Hafta Sonu İndirimi", "description": "Cumartesi-Pazar tüm meyvelerde üyelere %15 indirim! Üyelik kartınızı tezgahta gösterin.", "discount_text": "%15 İndirim", "members_only": True, "image_url": "https://images.pexels.com/photos/18452311/pexels-photo-18452311.jpeg?auto=compress&cs=tinysrgb&w=800", "valid_until": "2026-12-31"},
            {"title": "Mevsim Sebzelerinde Büyük Fırsat", "description": "Tüm mevsim sebzelerinde uygun fiyatlar. Taze ve doğal ürünler tezgahta sizleri bekliyor.", "discount_text": "Uygun Fiyat", "members_only": False, "image_url": "https://images.unsplash.com/photo-1542838132-92c53300491e?w=800&q=80", "valid_until": "2026-12-31"},
            {"title": "Üye Ol, İlk Alışverişte Kazan", "description": "Üye olan müşterilerimize ilk alışverişlerinde özel sürpriz indirim. Hemen üye olun!", "discount_text": "Hoş Geldin Hediyesi", "members_only": True, "image_url": "https://images.pexels.com/photos/36377439/pexels-photo-36377439.jpeg?auto=compress&cs=tinysrgb&w=800", "valid_until": "2026-12-31"},
        ]
        docs = [Campaign(**c).dict() for c in sample_campaigns]
        await db.campaigns.insert_many(docs)
        logger.info("Seeded %d campaigns", len(docs))

    # Seed coupons
    if await db.coupons.count_documents({}) == 0:
        sample_coupons = [
            {"code": "TAZE10", "title": "Tüm Ürünlerde %10 İndirim", "description": "Tezgahta bu kodu gösterin, tüm alışverişinizde %10 indirim kazanın.", "discount_percent": 10, "members_only": True, "valid_until": "2026-12-31"},
            {"code": "MEYVE20", "title": "Meyvelerde %20 İndirim", "description": "Üyelere özel tüm meyvelerde %20 indirim kuponu.", "discount_percent": 20, "members_only": True, "valid_until": "2026-12-31"},
            {"code": "HOSGELDIN15", "title": "Hoş Geldin Kuponu %15", "description": "Yeni üyelere özel ilk alışverişte %15 indirim.", "discount_percent": 15, "members_only": True, "valid_until": "2026-12-31"},
        ]
        docs = [Coupon(**c).dict() for c in sample_coupons]
        await db.coupons.insert_many(docs)
        logger.info("Seeded %d coupons", len(docs))

    # Seed markets (çıkılan pazarlar)
    if await db.markets.count_documents({}) == 0:
        sample_markets = [
            {"name": "Mudanya Güzelyalı Pazarı", "day": "Perşembe", "location": "Güzelyalı, Mudanya / Bursa", "note": "Sabah erken taze ürünlerle tezgahtayız.", "image_url": "https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=800&q=80"},
            {"name": "Mudanya Cumartesi Pazarı", "day": "Cumartesi", "location": "Mudanya Merkez / Bursa", "note": "Mevsim sebze ve meyveleri.", "image_url": "https://images.unsplash.com/photo-1542838132-92c53300491e?w=800&q=80"},
        ]
        docs = [Market(**m).dict() for m in sample_markets]
        await db.markets.insert_many(docs)
        logger.info("Seeded %d markets", len(docs))


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

# SUPPLIER ENDPOINTS (admin CRUD /api/admin/suppliers*, public /api/suppliers)
# -> routers/suppliers.py

# Catalog Config (get/set) -> routers/catalog.py


# admin/orders (list/get/update/refund/verify-delivery-code) -> routers/admin_orders.py


# =====================================================================
# KURYE UÇLARI
# Kurye, atandığı PAZARDAN (courier_market) verilen EVE SERVİS siparişlerini
# görür ve yönetir. Akış: ... -> hazir -> [Yola Çıktım] -> yolda ->
# [Teslim kodu doğrula] -> teslim_edildi. SMS bildirimi YOK (yalnızca durum).
# =====================================================================
# COURIER_ACTIVE_STATUSES, _courier_*, /api/courier/{me,orders,orders/history,
# orders/{tx_id}/depart,orders/{tx_id}/verify-delivery-code} -> routers/courier.py


# admin/complaints, admin/issues -> routers/complaints.py

# admin/visits/report, settings (get/set), admin/legal-docs (get), admin/sms/config
# -> routers/settings.py
# admin/upload-pdf, admin/legal-docs (post/put), contracts/pending,
# contracts/accept, admin/contract-gate-stats, admin/contract-gate-logs
# -> routers/legal.py


# admin/logs/stats/overview + admin/logs/{collection_name} -> routers/logs.py
