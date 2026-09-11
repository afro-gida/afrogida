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
import hmac
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
from core.money import _CENT, _MILLI, D, money, money_d, _num_close
from core.crypto import (
    Fernet, InvalidToken, _afro_fernet, _AFRO_FERNET, enc_str, dec_str, is_encrypted,
    _hmac_hex, hash_token, order_signature, verify_order_signature,
)
from core.db import client, db  # .env core.config import'unda yüklendi
from core.logs import (
    _mask_phone, _extract_request_meta, _client_ip, _insert_log, _log_sms_send,
    _check_brute_force, _check_otp_abuse, _log_payment_restriction, _record_visit,
)
from services.sms import (
    _tr_ascii, _normalize_sms_phone, _generate_sms_code,
    send_delivery_sms, _no_show_order_no, _send_no_show_sms,
)
from services.noshow import (
    NO_SHOW_RESTRICTION_DAYS, NO_SHOW_DAYS_LEVEL2, NO_SHOW_DAYS_LEVEL3, NO_SHOW_DAYS_LEVEL4,
    _evaluate_no_show_restriction, _apply_no_show_penalty, _maybe_expire_no_show,
)
from core.security import (
    security_alarm, rate_limit, check_lockout, register_failure, clear_failures,
    hash_password, verify_password, create_session, _session_query,
    get_current_user, get_current_user_optional, _admin_session_track, _admin_watchdog_loop,
    get_current_admin, get_current_supplier, get_current_staff,
    get_optional_user, SUPPLIER_ROLES,
    _yonetici_only,
)
from models import (
    GoogleSessionInput, PhoneLoginInput, RegisterInput, LoginInput, AdminLoginInput,
    Admin2FAVerifyInput, UserOut, AuthResponse,
    ProductInput, Product, Campaign, CampaignInput, Coupon, CouponInput, RedeemInput,
    Market, MarketInput,
    MemberOut, MemberUpdateInput, StaffAssignInput, StaffAssignByIdInput, CourierAssignInput,
)
from services.push import (
    EXPO_PUSH_API, VAPID_PUBLIC_KEY, VAPID_PRIVATE_PEM, VAPID_CONTACT,
    send_push_to_users, send_push_to_all, send_push_to_courier_markets,
    _send_web_push_one, send_web_push_to_all, send_web_push_to_user,
)
from services.payments import (
    _paytr_keys_status, _clean_paytr_oid, _init_paytr_token, _paytr_refund,
    paytr_callback_expected_hash,
)
from services.catalog import _read_catalog_config
from services.orders import (
    ORDER_ENC_FIELDS, ORDER_INTERNAL_FIELDS, _dec_order, _dec_orders, _customer_order_view,
    _normalize_delivery_type, _normalize_payment_method, _as_float, _resolve_selected_options,
    _find_address_coordinates, _evaluate_coupon, _prepare_order_payload, _consume_coupon_for_order,
    _compat_json_clean,
)

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


# ---------------- Restored admin read endpoints (orders / complaints / issues / visits) ----------------
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


@app.get("/api/admin/orders")
async def admin_list_orders(filter_type: str = "all_time", current_admin: dict = Depends(get_current_admin)):
    q = _order_date_filter(filter_type)
    return _dec_orders(await db.transactions.find(q, {"_id": 0}).sort("created_at", -1).to_list(3000))


@app.get("/api/admin/orders/{tx_id}")
async def admin_get_order(tx_id: str, current_admin: dict = Depends(get_current_admin)):
    order = await db.transactions.find_one({"tx_id": tx_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Sipariş bulunamadı")
    return _dec_order(order)


@app.put("/api/admin/orders/{tx_id}")
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


@app.post("/api/admin/orders/{tx_id}/refund")
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


@app.post("/api/admin/orders/{tx_id}/verify-delivery-code")
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


# =====================================================================
# KURYE UÇLARI
# Kurye, atandığı PAZARDAN (courier_market) verilen EVE SERVİS siparişlerini
# görür ve yönetir. Akış: ... -> hazir -> [Yola Çıktım] -> yolda ->
# [Teslim kodu doğrula] -> teslim_edildi. SMS bildirimi YOK (yalnızca durum).
# =====================================================================
# COURIER_ACTIVE_STATUSES, _courier_*, /api/courier/{me,orders,orders/history,
# orders/{tx_id}/depart,orders/{tx_id}/verify-delivery-code} -> routers/courier.py


@app.get("/api/admin/complaints")
async def admin_list_complaints(current_admin: dict = Depends(get_current_admin)):
    return await db.complaints.find({}, {"_id": 0}).sort("created_at", -1).to_list(3000)


@app.put("/api/admin/complaints/{complaint_id}")
async def admin_update_complaint(complaint_id: str, data: dict, current_admin: dict = Depends(get_current_admin)):
    updates = {k: v for k, v in data.items() if k in ("status", "admin_response")}
    updates["updated_at"] = now_utc()
    result = await db.complaints.update_one({"id": complaint_id}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı")
    return await db.complaints.find_one({"id": complaint_id}, {"_id": 0})


@app.delete("/api/admin/complaints/{complaint_id}")
async def admin_delete_complaint(complaint_id: str, current_admin: dict = Depends(get_current_admin)):
    result = await db.complaints.delete_one({"id": complaint_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı")
    return {"success": True}


@app.get("/api/admin/issues")
async def admin_list_issues(current_admin: dict = Depends(get_current_admin)):
    return await db.order_issues.find({}, {"_id": 0}).sort("created_at", -1).to_list(3000)


@app.put("/api/admin/issues/{issue_id}")
async def admin_update_issue(issue_id: str, data: dict, current_admin: dict = Depends(get_current_admin)):
    updates = {k: v for k, v in data.items() if k in ("status", "admin_note")}
    updates["updated_at"] = now_utc()
    result = await db.order_issues.update_one({"id": issue_id}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı")
    return await db.order_issues.find_one({"id": issue_id}, {"_id": 0})


@app.get("/api/admin/visits/report")
async def admin_visits_report(current_admin: dict = Depends(get_current_admin)):
    pipeline = [
        {"$group": {"_id": "$date", "count": {"$sum": 1}}},
        {"$sort": {"_id": -1}},
    ]
    rows = await db.daily_visits.aggregate(pipeline).to_list(2000)
    return [{"date": r["_id"], "count": r["count"]} for r in rows if r.get("_id")]

# ---------------- Abacus patch: frontend compatibility endpoints (2026-07-27) ----------------
@app.get("/api/settings")
async def compat_get_settings():
    settings = await db.settings.find_one({"id": "global_settings"}, {"_id": 0})
    if not settings:
        settings = await db.settings.find_one({}, {"_id": 0})
    return settings or {}

@app.put("/api/admin/settings")
async def compat_update_admin_settings(data: dict, current_admin: dict = Depends(get_current_admin), request: Request = None):
    _old_settings = await db.settings.find_one({"id": "global_settings"}, {"_id": 0}) or {}
    data = {k: v for k, v in data.items() if k != "_id"}
    data["id"] = data.get("id", "global_settings")
    data["updated_at"] = now_utc()
    await db.settings.update_one({"id": "global_settings"}, {"$set": data}, upsert=True)
    for _sf, _snv in data.items():
        if _sf in ("_id", "id", "updated_at"): continue
        _sov = _old_settings.get(_sf)
        if _sov != _snv:
            await _insert_log("log_admin", {"admin_id": current_admin["user_id"], "admin_name": current_admin.get("name",""), "action": "system_settings_changed", "target_type": "system", "target_id": "global_settings", "change_details": {"field": _sf, "old_value": _sov, "new_value": _snv}, "admin_note": ""}, request)
    return {"success": True, "settings": await db.settings.find_one({"id": "global_settings"}, {"_id": 0})}

# /api/orders (GET) -> routers/orders.py

@app.get("/api/admin/legal-docs")
async def compat_admin_legal_docs(current_admin: dict = Depends(get_current_admin)):
    return await db.legal_documents.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)

@app.get("/api/admin/sms/config")
async def compat_admin_sms_config(current_admin: dict = Depends(get_current_admin)):
    """SMS sağlayıcı durumunu döndür. Env var'lardan gerçek yapılandırmayı kontrol eder."""
    username = os.environ.get("VERIMOR_USERNAME", "")
    password = os.environ.get("VERIMOR_PASSWORD", "")
    sender = os.environ.get("VERIMOR_SENDER", "AFROGIDA")
    
    is_configured = bool(username and password)
    
    cfg = await db.sms_config.find_one({}, {"_id": 0, "password": 0, "api_key": 0, "token": 0})
    if not cfg:
        cfg = {}
    
    # Gerçek durumu env'lerden belirle ve override et (frontend'in okuduğu alan adları)
    cfg["provider"] = "verimor"
    cfg["enabled"] = is_configured
    cfg["configured"] = is_configured
    cfg["sender"] = sender if is_configured else ""
    cfg["username"] = (username[:3] + "***") if username else ""  # Güvenlik: ilk 3 karakter
    # Frontend SMS Ayarları ekranının okuduğu alanlar:
    cfg["username_masked"] = (username[:3] + "***") if username else "-"
    cfg["source_addr_masked"] = sender if is_configured else "Panel/API ile doğrulanmalı"
    cfg["base_url"] = "https://sms.verimor.com.tr/v2/send.json" if is_configured else "-"
    cfg["timeout_seconds"] = 15
    cfg["note"] = "SMS gönderimi backend `.env` ile yönetiliyor." if is_configured else "-"

    if is_configured:
        cfg["message"] = "Verimor bağlantısı aktif. SMS gönderimi çalışıyor."
    else:
        cfg["message"] = "Verimor kimlik bilgileri eksik. SMS gönderilemez."
    
    return cfg


# admin/logs/{actions,security,orders,order-status,payments,refunds,coupons,
# members,pickup,agreements} + TR etiket sozlukleri/yardimcilari (_afro_status_tr,
# _afro_iso, _afro_dt_tr, _afro_fetch_logs, _afro_user_map, ...) -> routers/logs.py
# + services/admin_logs.py


# _record_visit / _mask_phone -> core/logs.py


# ---------------- Payment / order compatibility endpoints ----------------
# Sipariş hesaplama katmanı -> services/orders.py  (dosya başında import ediliyor):
#   _normalize_delivery_type, _normalize_payment_method, _as_float,
#   _resolve_selected_options, _find_address_coordinates, _evaluate_coupon,
#   _prepare_order_payload, _consume_coupon_for_order


# PayTR entegrasyonu (_paytr_keys_status, _clean_paytr_oid, _init_paytr_token,
# _paytr_refund, paytr_callback_expected_hash) -> services/payments.py


# _log_order_agreement -> services/orders.py
# /api/orders (POST) -> routers/orders.py
# /api/payments/init -> routers/payments.py


# /api/payment/paytr/iframe-token -> routers/payments.py
# /api/payment/paytr/callback (+ /api/payments/paytr/callback) -> routers/payments.py
# /api/payment/paytr -> routers/payments.py
# /api/visit (GET/POST) -> routers/orders.py

# telefon OTP + parola sıfırlama endpoint'leri -> routers/auth.py




# _compat_json_clean -> services/orders.py


# TEDARİKÇİ SÖZLEŞMESİ (onay/consent akışı) + _afro_client_ip -> routers/suppliers.py

# ---- PDF yükleme (sözleşme için) ----
@app.post("/api/admin/upload-pdf")
async def afro_admin_upload_pdf(file: UploadFile = File(...), current_admin: dict = Depends(get_current_admin)):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Boş dosya")
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Dosya çok büyük (en fazla 20 MB)")
    head = content[:5]
    if not head.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="Sadece PDF dosyası yükleyebilirsiniz")
    uploads_dir = ROOT_DIR / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    fname = f"contract_{uuid.uuid4().hex}.pdf"
    (uploads_dir / fname).write_bytes(content)
    return {"url": f"/uploads/{fname}"}


# /api/supplier-contract, /api/admin/supplier-contract, /api/supplier/contract-status,
# /api/supplier/accept-contract, /api/admin/contract-consents -> routers/suppliers.py



# ============================================================
# ABACUS PATCH (2026-08): Legal belge KAYDET endpoint'leri
# ------------------------------------------------------------
# Frontend "PDF Yükle" akışı bir PDF'i /admin/upload-pdf'e yükler,
# ardından belgeyi POST /admin/legal-docs (yeni) veya
# PUT /admin/legal-docs/{id} (güncelle) ile kaydeder.
# Bu endpoint'ler backend'de eksikti (405/404) -> yükleme kaydedilmiyordu.
# Bu blok o eksiği tamamlar. legal_documents koleksiyonuna yazar.
# ============================================================
def _afro_clean_doc(data: dict) -> dict:
    """Gelen belge gövdesini temizle; izinli alanları koru."""
    allowed = {
        "name", "content", "content_html", "version", "active", "is_active",
        "document_code", "service_type", "document_type", "status",
        "change_reason", "pdf_url", "firm_metadata", "title", "sourceName",
    }
    out = {k: v for k, v in (data or {}).items() if k in allowed}
    return out


@app.post("/api/admin/legal-docs")
async def afro_create_legal_doc(data: dict, current_admin: dict = Depends(get_current_admin), request: Request = None):
    _yonetici_only(current_admin)
    doc = _afro_clean_doc(data)
    now = now_utc()
    doc_id = "doc_" + uuid.uuid4().hex[:12]
    doc["id"] = doc_id
    doc["active"] = bool(doc.get("active", True))
    doc["is_active"] = doc["active"]
    doc["status"] = doc.get("status") or "published"
    doc["created_at"] = now
    doc["updated_at"] = now
    doc["published_at"] = now
    doc["revision_date"] = now
    doc.setdefault("created_by", current_admin.get("user_id"))
    doc.setdefault("published_by", current_admin.get("user_id"))
    await db.legal_documents.insert_one(dict(doc))
    try:
        await db.admin_logs.insert_one({
            "action": "legal_doc_created",
            "doc_id": doc_id,
            "document_code": doc.get("document_code"),
            "version": doc.get("version"),
            "pdf_url": doc.get("pdf_url"),
            "admin_id": current_admin.get("user_id"),
            "created_at": now,
        })
    except Exception:
        pass
    await _insert_log("log_admin", {"admin_id": current_admin["user_id"], "admin_name": current_admin.get("name",""), "action": "legal_document_uploaded", "target_type": "legal", "target_id": doc_id, "change_details": {"document_type": doc.get("document_code"), "version": doc.get("version")}, "admin_note": ""}, request)
    return await db.legal_documents.find_one({"id": doc_id}, {"_id": 0})


@app.put("/api/admin/legal-docs/{doc_id}")
async def afro_update_legal_doc(doc_id: str, data: dict, current_admin: dict = Depends(get_current_admin), request: Request = None):
    _yonetici_only(current_admin)
    doc = _afro_clean_doc(data)
    now = now_utc()
    doc["updated_at"] = now
    if "active" in doc:
        doc["active"] = bool(doc.get("active", True))
        doc["is_active"] = doc["active"]
    # PDF güncellendiyse yayın/rev tarihini tazele
    if doc.get("pdf_url"):
        doc["published_at"] = now
        doc["revision_date"] = now
        doc.setdefault("status", "published")
    result = await db.legal_documents.update_one({"id": doc_id}, {"$set": doc})
    if result.matched_count == 0:
        # Belge yoksa oluştur (upsert davranışı)
        doc["id"] = doc_id
        doc.setdefault("created_at", now)
        doc.setdefault("published_at", now)
        doc.setdefault("revision_date", now)
        doc.setdefault("status", "published")
        doc["active"] = bool(doc.get("active", True))
        doc["is_active"] = doc["active"]
        await db.legal_documents.insert_one(dict(doc))
    try:
        await db.admin_logs.insert_one({
            "action": "legal_doc_updated",
            "doc_id": doc_id,
            "document_code": doc.get("document_code"),
            "version": doc.get("version"),
            "pdf_url": doc.get("pdf_url"),
            "admin_id": current_admin.get("user_id"),
            "created_at": now,
        })
    except Exception:
        pass
    _ld_existing = await db.legal_documents.find_one({"id": doc_id}, {"_id": 0, "version": 1})
    await _insert_log("log_admin", {"admin_id": current_admin["user_id"], "admin_name": current_admin.get("name",""), "action": "legal_document_uploaded", "target_type": "legal", "target_id": doc_id, "change_details": {"field": "version", "old_value": (_ld_existing or {}).get("version"), "new_value": doc.get("version")}, "admin_note": ""}, request)
    return await db.legal_documents.find_one({"id": doc_id}, {"_id": 0})

# ============================================================
# SÖZLEŞME GATE SİSTEMİ — Login bazlı onay kontrolü
# Tarih: 17 Ağustos 2026
# Eklenecek yer: server.py'nin sonuna
# ============================================================

# --- Login Gate: Hangi sözleşmelerin login gate'de gösterilecegi ---
# document_code -> hedef roller
LOGIN_GATE_CONTRACTS = {
    "kvkk":              {"roles": ["musteri", "esnaf"], "required": True},
    "privacy":           {"roles": ["musteri", "esnaf"], "required": True},
    "membership":        {"roles": ["musteri"],          "required": True},
    "refundComplaintPolicy": {"roles": ["musteri"],      "required": True},
    "couponTerms":       {"roles": ["musteri"],          "required": True},
    # pickupTerms ve homeDeliveryTerms -> checkout gate (sipariş anında), login gate'de gösterilmez
    # tedarikci_sozlesmesi -> mevcut consent_logs sistemi ile çalışıyor
}


# ---- Kullanıcının onay bekleyen sözleşmeleri ----
@app.get("/api/contracts/pending")
async def afro_contracts_pending(current_user: dict = Depends(get_current_user)):
    """
    Login sonrası çağrılır. Kullanıcının rolüne göre
    onay bekleyen sözleşmeleri döndürür.
    """
    user_id = current_user.get("user_id")
    user_role = current_user.get("role", "musteri")

    # Yöneticiye gate uygulanmaz
    if user_role in ("yonetici", "admin"):
        return {"pending_contracts": []}

    # Aktif ve yayınlanmış sözleşmeleri al
    active_docs = await db.legal_documents.find(
        {"is_active": True, "status": "published", "document_code": {"$exists": True}},
        {"_id": 0, "document_code": 1, "name": 1, "version": 1, "pdf_url": 1}
    ).to_list(50)

    # Bu kullanıcının rolüne uygun login-gate sözleşmelerini filtrele
    relevant = []
    for doc in active_docs:
        code = doc.get("document_code")
        gate_cfg = LOGIN_GATE_CONTRACTS.get(code)
        if not gate_cfg:
            continue
        if user_role not in gate_cfg["roles"]:
            continue
        relevant.append(doc)

    if not relevant:
        return {"pending_contracts": []}

    # Kullanıcının daha önce onayladığı sürümleri al
    accepted_logs = await db.legal_agreement_logs.find(
        {"user_id": user_id, "gate_type": "login", "accepted": True},
        {"_id": 0, "document_code": 1, "document_version": 1}
    ).to_list(200)

    # document_code -> en son onaylanan version map'i
    accepted_map = {}
    for log in accepted_logs:
        code = log.get("document_code")
        ver = log.get("document_version")
        if code and ver:
            accepted_map[code] = ver

    # Onaylanmamış veya sürümü eskimiş olanları bul
    pending = []
    for doc in relevant:
        code = doc.get("document_code")
        current_ver = doc.get("version")
        accepted_ver = accepted_map.get(code)

        if accepted_ver != current_ver:
            pending.append({
                "document_code": code,
                "name": doc.get("name"),
                "version": current_ver,
                "pdf_url": doc.get("pdf_url"),
            })

    return {"pending_contracts": pending}


# ---- Sözleşme kabul et (login gate) ----
@app.post("/api/contracts/accept")
async def afro_contracts_accept(request: Request, current_user: dict = Depends(get_current_user)):
    """
    Kullanıcı login gate'de sözleşmeyi kabul eder.
    Her onay ayrı kayıt olarak loglanır.
    """
    user_id = current_user.get("user_id")
    user_role = current_user.get("role", "musteri")

    body = await request.json()
    doc_code = body.get("document_code")
    doc_version = body.get("document_version")

    if not doc_code or not doc_version:
        raise HTTPException(status_code=400, detail="document_code ve document_version gerekli")

    # Sözleşmenin gerçekten aktif olduğunu doğrula
    doc = await db.legal_documents.find_one(
        {"document_code": doc_code, "version": doc_version, "is_active": True, "status": "published"}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Sözleşme bulunamadı veya aktif değil")

    ts = datetime.now(timezone.utc).isoformat()
    ip = request.headers.get("x-forwarded-for", request.headers.get("x-real-ip", "unknown"))
    ua = request.headers.get("user-agent", "unknown")

    # legal_agreement_logs'a kayıt (mevcut yapıyla uyumlu)
    log_entry = {
        "user_id": user_id,
        "accepted": True,
        "gate_type": "login",                       # login gate onayı
        "document_code": doc_code,
        "document_name": doc.get("name"),
        "document_version": doc_version,
        "document_type": doc.get("document_type", doc.get("name")),
        "document_hash": doc.get("sha256_hash", ""),
        "pdf_url": doc.get("pdf_url", ""),
        "checkbox_text_snapshot": f"{doc.get('name')} sözleşmesini okudum ve kabul ediyorum.",
        "versions": {doc_code: doc_version},
        "timestamp": ts,
        "accepted_at": ts,
        "ip": ip,
        "user_agent": ua,
        "user_role": user_role,
        "user_name": current_user.get("name", ""),
        "user_phone": current_user.get("phone", ""),
        "order_id": None,                           # login gate — sipariş yok
        "device_platform": None,
        "device_id": None,
        "app_version": None,
    }

    await db.legal_agreement_logs.insert_one(log_entry)

    await _insert_log("log_consents", {"user_id": user_id, "consent_type": doc_code, "action": "accepted", "document_version": doc_version, "document_name": doc.get("name",""), "document_url": doc.get("pdf_url","")}, request)
    return {"status": "accepted", "document_code": doc_code, "version": doc_version}


# ---- Admin: Sözleşme onay istatistikleri ----
@app.get("/api/admin/contract-gate-stats")
async def afro_admin_contract_gate_stats(current_admin: dict = Depends(get_current_admin)):
    """
    Her sözleşme için kaç kullanıcı onaylamış / bekliyor istatistiği.
    """
    # Aktif sözleşmeleri al
    active_docs = await db.legal_documents.find(
        {"is_active": True, "status": "published", "document_code": {"$exists": True}},
        {"_id": 0, "document_code": 1, "name": 1, "version": 1}
    ).to_list(50)

    # Toplam musteri ve esnaf sayıları
    musteri_count = await db.users.count_documents({"role": "musteri"})
    esnaf_count = await db.users.count_documents({"role": "esnaf"})

    stats = []
    for doc in active_docs:
        code = doc.get("document_code")
        gate_cfg = LOGIN_GATE_CONTRACTS.get(code)
        if not gate_cfg:
            continue

        ver = doc.get("version")

        # Bu sürümü onaylayanları say
        accepted_count = await db.legal_agreement_logs.count_documents({
            "document_code": code,
            "document_version": ver,
            "gate_type": "login",
            "accepted": True
        })

        # Hedef kitle sayısı
        target = 0
        if "musteri" in gate_cfg["roles"]:
            target += musteri_count
        if "esnaf" in gate_cfg["roles"]:
            target += esnaf_count

        stats.append({
            "document_code": code,
            "name": doc.get("name"),
            "version": ver,
            "target_roles": gate_cfg["roles"],
            "target_count": target,
            "accepted_count": accepted_count,
            "pending_count": max(0, target - accepted_count),
        })

    return {"stats": stats}


# ---- Admin: Login gate onay logları ----
@app.get("/api/admin/contract-gate-logs")
async def afro_admin_contract_gate_logs(
    document_code: Optional[str] = None,
    current_admin: dict = Depends(get_current_admin)
):
    """
    Login gate onay loglarını listeler. document_code ile filtrelenebilir.
    """
    query = {"gate_type": "login"}
    if document_code:
        query["document_code"] = document_code

    logs = await db.legal_agreement_logs.find(
        query, {"_id": 0}
    ).sort("accepted_at", -1).to_list(500)

    return {"logs": logs, "total": len(logs)}


# admin/logs/stats/overview + admin/logs/{collection_name} -> routers/logs.py
