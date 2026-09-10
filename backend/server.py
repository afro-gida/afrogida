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


from core.util import now_utc, to_aware, new_id, _clean_text, _afro_norm
from core.config import (
    ROOT_DIR, EMERGENT_SESSION_API, SESSION_DURATION_DAYS, ORDERED_CATEGORIES,
    PRODUCT_SEED_VERSION, WELCOME_DISCOUNT_AMOUNT, WELCOME_MIN_AMOUNT, CATALOG_CACHE_TTL,
    AFRO_SECRET_KEY, _AFRO_ENC_RAW, SECURITY_ADMIN_PHONE, SECURITY_SMS_THROTTLE_MIN,
    ADMIN_SESSION_HOURS, ADMIN_2FA_PHONE, ADMIN_2FA_TTL_SEC, ADMIN_2FA_MAX_ATTEMPTS,
    ENC_PREFIX, _afro_key_material,
)
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
    _tr_ascii, _normalize_sms_phone, _generate_sms_code, send_sms_verimor,
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
    get_current_admin, get_current_supplier, get_current_staff, get_current_courier,
    get_optional_user, SUPPLIER_ROLES, is_supplier_role, get_user_supplier_group,
    COURIER_ROLES, is_courier_role, get_user_courier_markets, get_user_courier_market,
    _afro_market_eq, _yonetici_only,
)
from models import (
    GoogleSessionInput, PhoneLoginInput, RegisterInput, LoginInput, AdminLoginInput,
    Admin2FAVerifyInput, UserOut, AuthResponse,
    ProductInput, Product, Campaign, CampaignInput, Coupon, CouponInput, RedeemInput,
    Market, MarketInput,
    MemberOut, MemberUpdateInput, StaffAssignInput, StaffAssignByIdInput, CourierAssignInput,
    SupplierInput, Supplier, AfroSupplierPayMark, AfroSupplierPayConfirm,
    AfroSupplierContractInput,
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

app = FastAPI()
app.mount("/uploads", StaticFiles(directory=str(ROOT_DIR / "uploads")), name="uploads")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Sabitler -> core/config.py (EMERGENT_SESSION_API, SESSION_DURATION_DAYS,
# ORDERED_CATEGORIES, PRODUCT_SEED_VERSION, WELCOME_*, CATALOG_CACHE_TTL)

# catalog_config bellek içi önbellek (TTL -> core/config.CATALOG_CACHE_TTL)
_CATALOG_CACHE = None
_CATALOG_CACHE_TS = 0

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


# ---- Şifreli alanların okunması (çıkış yollarında) ----
ORDER_ENC_FIELDS = ("address", "delivery_code")
ORDER_INTERNAL_FIELDS = ("paytr_init", "paytr_callback", "calc_signature", "security_flags")


def _dec_order(o):
    if not isinstance(o, dict):
        return o
    out = dict(o)
    for f in ORDER_ENC_FIELDS:
        if f in out and out[f] is not None:
            out[f] = dec_str(out[f])
    return out


def _dec_orders(rows):
    return [_dec_order(o) for o in (rows or [])]


def _customer_order_view(o):
    """Müşteriye dönen sipariş: şifreler çözülür, iç alanlar (PayTR ham verisi, imza) gizlenir."""
    out = _dec_order(o)
    for f in ORDER_INTERNAL_FIELDS:
        out.pop(f, None)
    return out


# Güvenlik katmanı (security_alarm, rate_limit, check_lockout, register_failure,
# clear_failures, hash_password, verify_password, create_session, _session_query,
# get_current_user(+_optional), _admin_session_track, _admin_watchdog_loop,
# get_current_admin/supplier/staff/courier, get_optional_user, rol yardımcıları)
# -> core/security.py  (dosya başında import ediliyor)


# Bildirim gönderimi (Expo + Web Push VAPID) -> services/push.py
# EXPO_PUSH_API, VAPID_*, send_push_to_users/all, send_push_to_courier_markets,
# _send_web_push_one, send_web_push_to_all/user  (dosya başında import ediliyor)

# ── Web Push abonelik kayıt/sil endpointleri ─────────────────────────────────

@app.post("/api/push/web-subscribe")
async def web_push_subscribe(data: dict, user=Depends(get_current_user_optional), request: Request = None):
    """Tarayıcıdan gelen PushSubscription nesnesini saklar."""
    endpoint = (data.get("endpoint") or "").strip()
    keys = data.get("keys") or {}
    if not endpoint or not keys.get("p256dh") or not keys.get("auth"):
        raise HTTPException(status_code=400, detail="Eksik abonelik bilgisi")
    doc = {
        "endpoint": endpoint,
        "keys": {"p256dh": keys["p256dh"], "auth": keys["auth"]},
        "user_id": (user or {}).get("user_id"),
        "ts": now_utc(),
    }
    await db.web_push_subs.update_one(
        {"endpoint": endpoint},
        {"$set": doc},
        upsert=True,
    )
    return {"ok": True}


@app.delete("/api/push/web-subscribe")
async def web_push_unsubscribe(data: dict, user=Depends(get_current_user_optional)):
    """Tarayıcıdan gelen aboneliği siler."""
    endpoint = (data.get("endpoint") or "").strip()
    if endpoint:
        await db.web_push_subs.delete_one({"endpoint": endpoint})
    return {"ok": True}


@app.get("/api/push/vapid-public-key")
async def get_vapid_public_key():
    """Frontend'e VAPID public key'i döner."""
    return {"key": VAPID_PUBLIC_KEY}


# ── Yönetici oturum kalp atışı (frontend heartbeat) ──────────────────────────
@app.get("/api/auth/admin/heartbeat")
async def admin_heartbeat(user=Depends(get_current_user)):
    """Her 90 sn'de frontend tarafından çağrılır.
    Oturum geçerliyse {ok:true} döner; geçersiz/2FA'sız ise get_current_user 401 fırlatır.
    Böylece çalınmış/geçersiz oturumlar frontend'de anında fark edilir."""
    if not user or user.get("role") not in ("admin", "yonetici"):
        raise HTTPException(status_code=403, detail="Yönetici yetkisi gerekli")
    return {"ok": True, "user_id": user.get("user_id"), "ts": now_utc().isoformat()}


# ── Admin: toplu web push gönder ─────────────────────────────────────────────

@api_router.post("/admin/push/web-send")
async def admin_web_push_send(payload: dict, admin=Depends(get_current_admin)):
    """Admin: tüm web push abonelerine anlık bildirim gönderir."""
    _yonetici_only(admin)
    title = str(payload.get("title") or "Afro Gıda").strip()
    body  = str(payload.get("body")  or "").strip()
    if not body:
        raise HTTPException(status_code=400, detail="Mesaj boş olamaz")
    n = await send_web_push_to_all(title, body, payload.get("data"))
    return {"sent": n}


# Kurye/tedarikçi rol yardımcıları + get_current_courier + get_optional_user
# -> core/security.py


# Pydantic modelleri -> models.py (dosya başında import ediliyor)


# ---------------- Auth Routes ----------------
@api_router.post("/auth/google")
async def auth_google(payload: GoogleSessionInput, request: Request = None):
    # GÜVENLİK: Uygulama bu yolu kullanmıyor; üçüncü taraf oturum servisi kapatıldı.
    raise HTTPException(status_code=410, detail="Bu giriş yöntemi güvenlik nedeniyle kapatıldı")
    async with httpx.AsyncClient(timeout=20) as http:
        resp = await http.get(EMERGENT_SESSION_API, headers={"X-Session-ID": payload.session_id})
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Google oturumu doğrulanamadı")
    data = resp.json()
    email = data.get("email")
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
    else:
        user_id = new_id("user")
        await db.users.insert_one({
            "user_id": user_id,
            "name": data.get("name") or "Üye",
            "email": email,
            "picture": data.get("picture"),
            "phone": None,
            "role": "member",
            "auth_type": "google",
            "created_at": now_utc(),
        })
    token = await create_session(user_id, token=data.get("session_token"))
    _gaction = "register" if not existing else "login_success"
    await _insert_log("log_auth", {"user_id": user_id, "phone_masked": "", "action": _gaction, "change_details": {"auth_type": "google"}}, request)
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return {"token": token, "user": _public_user_doc(user)}


@api_router.post("/auth/phone")
async def auth_phone(payload: PhoneLoginInput, request: Request = None):
    # GÜVENLİK: Şifresiz telefonla giriş (hesap ele geçirme riski) kapatıldı.
    raise HTTPException(status_code=410, detail="Bu giriş yöntemi güvenlik nedeniyle kapatıldı")
    phone = payload.phone.strip()
    if len(phone) < 7:
        raise HTTPException(status_code=400, detail="Geçerli bir telefon numarası girin")
    existing = await db.users.find_one({"phone": phone}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        if payload.name.strip():
            await db.users.update_one({"user_id": user_id}, {"$set": {"name": payload.name.strip()}})
    else:
        user_id = new_id("user")
        await db.users.insert_one({
            "user_id": user_id,
            "name": payload.name.strip() or "Üye",
            "email": None,
            "picture": None,
            "phone": phone,
            "role": "member",
            "auth_type": "phone",
            "created_at": now_utc(),
        })
    token = await create_session(user_id)
    _paction = "register" if not existing else "login_success"
    await _insert_log("log_auth", {"user_id": user_id, "phone_masked": _mask_phone(phone), "action": _paction, "change_details": {"auth_type": "phone"}}, request)
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return {"token": token, "user": _public_user_doc(user)}


async def issue_welcome_coupon(user_id: str) -> str:
    """Auto-issue a single-use welcome coupon to a new member. Returns coupon code."""
    _wc_code = f"HG{uuid.uuid4().hex[:6].upper()}"
    coupon = Coupon(
        code=_wc_code,
        title="Hoş Geldin Kuponu",
        description="İlk alışverişinizde 500₺ ve üzeri için 50₺ indirim. Kodu tezgahta gösterin.",
        discount_percent=0,
        discount_amount=WELCOME_DISCOUNT_AMOUNT,
        min_amount=WELCOME_MIN_AMOUNT,
        members_only=True,
        assigned_user_ids=[user_id],
        single_use=True,
        used=False,
        auto_issued=True,
        active=True,
    )
    await db.coupons.insert_one(coupon.dict())
    return _wc_code


@api_router.post("/auth/register")
async def auth_register(payload: RegisterInput, request: Request = None):
    phone = payload.phone.strip()
    name = payload.name.strip()
    if len(phone) < 7:
        raise HTTPException(status_code=400, detail="Geçerli bir telefon numarası girin")
    if not name:
        raise HTTPException(status_code=400, detail="Lütfen adınızı girin")
    await rate_limit(f"register_ip:{_client_ip(request)}", 10, 3600, "Çok fazla kayıt denemesi. Lütfen daha sonra tekrar deneyin.")
    existing = await db.users.find_one({"phone": phone}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=409, detail="Bu numara zaten kayıtlı. Lütfen giriş yapın.")

    # SMS doğrulama kodunu kontrol et (send-phone-otp ile gönderilen kod)
    otp_code = str(payload.otp_code or "").strip()
    if not otp_code:
        raise HTTPException(status_code=400, detail="Lütfen SMS ile gelen 6 haneli doğrulama kodunu girin.")
    otp_doc = await db.otp_codes.find_one(
        {"phone": phone, "purpose": "registration", "used": False},
        sort=[("created_at", -1)],
    )
    _otp_hash = hashlib.sha256(otp_code.encode("utf-8")).hexdigest()
    _otp_ok = bool(otp_doc) and bool(otp_doc.get("code_hash")) and hmac.compare_digest(
        str(otp_doc.get("code_hash")), _otp_hash
    )
    if not _otp_ok:
        raise HTTPException(status_code=400, detail="Doğrulama kodu hatalı. Lütfen SMS ile gelen 6 haneli kodu girin.")
    exp = otp_doc.get("expires_at")
    if exp is not None:
        exp_cmp = exp if getattr(exp, "tzinfo", None) else exp.replace(tzinfo=timezone.utc)
        if now_utc() > exp_cmp:
            raise HTTPException(status_code=400, detail="Doğrulama kodunun süresi doldu. Lütfen yeni kod isteyin.")

    user_id = new_id("user")
    await db.users.insert_one({
        "user_id": user_id,
        "name": name or "Üye",
        "email": None,
        "picture": None,
        "phone": phone,
        "role": "member",
        "auth_type": "phone",
        "password_hash": hash_password(payload.password) if payload.password else None,
        "created_at": now_utc(),
    })
    # Kullanılan OTP kodunu işaretle (tekrar kullanılamasın)
    await db.otp_codes.update_one({"_id": otp_doc["_id"]}, {"$set": {"used": True}})
    _wc_code = await issue_welcome_coupon(user_id)
    # --- LOG: auth register ---
    await _insert_log("log_auth", {"user_id": user_id, "phone_masked": _mask_phone(phone), "action": "register", "change_details": None}, request)
    for _ct, _dn in [("kvkk_aydinlatma","KVKK Aydınlatma Metni"),("gizlilik_politikasi","Gizlilik Politikası"),("uyelik_sozlesmesi","Üyelik Sözleşmesi")]:
        await _insert_log("log_consents", {"user_id": user_id, "consent_type": _ct, "action": "accepted", "document_version": "initial", "document_name": _dn, "document_url": ""}, request)
    # Ticari ileti izni OPSIYONEL — sadece kullanici gercekten izin verdiyse 'accepted' loglanir
    _mk = getattr(payload, "marketing_consent", None)
    if _mk is not None:
        await _insert_log("log_consents", {"user_id": user_id, "consent_type": "ticari_ileti_izni", "action": "accepted" if _mk else "declined", "document_version": "initial", "document_name": "Ticari İleti İzni", "document_url": ""}, request)
    await _insert_log("log_coupons", {"coupon_id": None, "coupon_code": _wc_code, "user_id": user_id, "action": "coupon_created", "order_id": None, "discount_amount": WELCOME_DISCOUNT_AMOUNT, "discount_type": "fixed_amount", "original_total": None, "final_total": None, "performed_by": "system", "admin_id": None, "admin_note": "Hoş geldin kuponu otomatik verildi"}, request)
    # Ayarlarda "yeni üyelere tanımlanacak kupon" seçiliyse, belirlenen kullanım hakkıyla ata
    try:
        _st = await db.settings.find_one({"id": "global_settings"}, {"_id": 0}) or {}
        _nm_id = _st.get("new_member_coupon_id")
        if _nm_id:
            _nm_limit = _norm_limit(_st.get("new_member_coupon_limit"), 1)
            _nm = await db.coupons.find_one({"id": _nm_id}, {"_id": 0})
            if _nm:
                _asg = _nm.get("assignments") or []
                if not any(a.get("user_id") == user_id for a in _asg):
                    _asg.append({"user_id": user_id, "limit": _nm_limit, "used_count": 0, "last_used_at": None})
                    await db.coupons.update_one(
                        {"id": _nm_id},
                        {"$set": {"assignments": _asg,
                                  "assigned_user_ids": [a["user_id"] for a in _asg],
                                  "members_only": True}},
                    )
    except Exception as _e:
        logging.warning(f"Yeni üye kupon ataması başarısız: {_e}")
    token = await create_session(user_id)
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return {"token": token, "user": _public_user_doc(user)}


# ======================================================================
# YÖNETİCİ SMS 2FA — parola doğru olsa bile oturum verilmez; kod sahibin
# telefonuna (ADMIN_2FA_PHONE) gider, /auth/admin/verify-2fa ile tamamlanır.
# ======================================================================
def _is_admin_role(u: dict) -> bool:
    return (u or {}).get("role") in ("admin", "yonetici")


async def _start_admin_2fa(user: dict, request, via: str) -> dict:
    """Parola doğrulandı; oturum yerine 2FA meydan okuması başlat ve SMS gönder."""
    code = _generate_sms_code()
    cid = secrets.token_urlsafe(24)
    meta = _extract_request_meta(request)
    now = now_utc()
    label = user.get("username") or _mask_phone(user.get("phone") or "") or user.get("name") or "yonetici"
    await db.admin_2fa.insert_one({
        "challenge_id": cid,
        "user_id": user["user_id"],
        "code_hash": _hmac_hex("admin2fa|" + cid + "|" + code),
        "via": via,
        "ip_address": meta["ip_address"],
        "ua_hash": hashlib.sha256((meta["user_agent"] or "").encode("utf-8")).hexdigest()[:16],
        "attempts": 0,
        "created_at": now,
        "expires_at": now + timedelta(seconds=ADMIN_2FA_TTL_SEC),
    })
    msg = (f"AfroGida yonetici girisi dogrulama kodu: {code}. Hesap: {label}, IP: {meta['ip_address']}. "
           f"Kod {ADMIN_2FA_TTL_SEC // 60} dk gecerli. Bu girisi siz yapmadiysaniz sifrenizi hemen degistirin.")
    sent = await asyncio.to_thread(send_sms_verimor, ADMIN_2FA_PHONE, msg)
    await _insert_log("log_auth", {"user_id": user["user_id"], "phone_masked": _mask_phone(user.get("phone") or ""),
                                   "action": "admin_2fa_sent", "change_details": {"via": via, "sms_sent": bool(sent)}}, request)
    await _insert_log("log_security", {"event_type": "admin_2fa_challenge", "source_ip": meta["ip_address"],
                                       "user_id": user["user_id"], "details": {"via": via, "sms_sent": bool(sent)},
                                       "severity": "low", "resolved": True}, request)
    if not sent:
        await db.admin_2fa.delete_one({"challenge_id": cid})
        raise HTTPException(status_code=503, detail="Doğrulama SMS'i gönderilemedi. Lütfen tekrar deneyin.")
    return {
        "requires_2fa": True,
        "challenge_id": cid,
        "expires_in": ADMIN_2FA_TTL_SEC,
        "message": f"Yönetici girişi için doğrulama kodu {_mask_phone(ADMIN_2FA_PHONE)} numarasına gönderildi.",
    }


@api_router.post("/auth/admin/verify-2fa")
async def auth_admin_verify_2fa(payload: Admin2FAVerifyInput, request: Request = None):
    _ip = _client_ip(request)
    await rate_limit(f"admin_2fa_ip:{_ip}", 20, 300, "Çok fazla doğrulama denemesi. 5 dakika bekleyin.")
    cid = str(payload.challenge_id or "").strip()[:64]
    code = re.sub(r"\D", "", str(payload.code or ""))[:6]
    if not cid or len(code) != 6:
        raise HTTPException(status_code=400, detail="Geçersiz doğrulama kodu")
    ch = await db.admin_2fa.find_one({"challenge_id": cid})
    if not ch or to_aware(ch.get("expires_at")) < now_utc():
        if ch:
            await db.admin_2fa.delete_one({"challenge_id": cid})
        raise HTTPException(status_code=410, detail="Doğrulama süresi doldu. Lütfen tekrar giriş yapın.")
    _ua_now = hashlib.sha256((_extract_request_meta(request)["user_agent"] or "").encode("utf-8")).hexdigest()[:16]
    if ch.get("ua_hash") and ch.get("ua_hash") != _ua_now:
        # Kod, giriş denemesinin yapıldığı cihaz/tarayıcıdan girilmeli (meydan okuma çalınamaz)
        await db.admin_2fa.delete_one({"_id": ch["_id"]})
        _u = await db.users.find_one({"user_id": ch.get("user_id")}, {"_id": 0})
        await security_alarm("admin_2fa_device_mismatch", {"via": ch.get("via")}, request, _u, severity="high", notify=True)
        raise HTTPException(status_code=403, detail="Doğrulama, giriş yapılan cihazdan tamamlanmalı. Lütfen tekrar giriş yapın.")
    if ch.get("code_hash") != _hmac_hex("admin2fa|" + cid + "|" + code):
        attempts = int(ch.get("attempts") or 0) + 1
        await _insert_log("log_auth", {"user_id": ch.get("user_id"), "phone_masked": "", "action": "admin_2fa_failed",
                                       "change_details": {"attempts": attempts}}, request)
        if attempts >= ADMIN_2FA_MAX_ATTEMPTS:
            await db.admin_2fa.delete_one({"challenge_id": cid})
            _u = await db.users.find_one({"user_id": ch.get("user_id")}, {"_id": 0})
            await security_alarm("admin_2fa_bruteforce", {"attempts": attempts, "via": ch.get("via")}, request, _u, severity="high", notify=True)
            raise HTTPException(status_code=429, detail="Çok fazla hatalı kod. Lütfen tekrar giriş yapın.")
        await db.admin_2fa.update_one({"_id": ch["_id"]}, {"$set": {"attempts": attempts}})
        raise HTTPException(status_code=401, detail=f"Doğrulama kodu hatalı ({ADMIN_2FA_MAX_ATTEMPTS - attempts} deneme kaldı)")
    # Başarılı: tek kullanımlık — meydan okumayı sil, oturum ver
    await db.admin_2fa.delete_one({"_id": ch["_id"]})
    admin = await db.users.find_one({"user_id": ch["user_id"]}, {"_id": 0})
    if not admin or admin.get("login_disabled") or not _is_admin_role(admin):
        raise HTTPException(status_code=403, detail="Hesap devre dışı")
    token = await create_session(admin["user_id"], request=request, twofa=True)
    await _insert_log("log_auth", {"user_id": admin["user_id"], "phone_masked": _mask_phone(admin.get("phone") or ""),
                                   "action": "admin_login", "change_details": {"via": ch.get("via"), "2fa": True}}, request)
    await _insert_log("log_security", {"event_type": "admin_login", "source_ip": _ip, "user_id": admin["user_id"],
                                       "details": {"via": ch.get("via"), "2fa": True}, "severity": "low", "resolved": True}, request)
    user = await db.users.find_one({"user_id": admin["user_id"]}, {"_id": 0, "password_hash": 0, "username": 0})
    return {"token": token, "user": _public_user_doc(user)}


@api_router.post("/auth/login")
async def auth_login(payload: LoginInput, request: Request = None):
    phone = payload.phone.strip()
    if len(phone) < 7:
        raise HTTPException(status_code=400, detail="Geçerli bir telefon numarası girin")
    _ip = _client_ip(request)
    await rate_limit(f"login_ip:{_ip}", 30, 300)
    await check_lockout(f"login:{phone}")
    existing = await db.users.find_one({"phone": phone}, {"_id": 0})
    if not existing:
        await register_failure(f"login:{phone}", request, max_fail=8, lock_minutes=15)
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı. Lütfen önce üye olun.")
    if existing.get("login_disabled"):
        raise HTTPException(status_code=403, detail="Hesap devre dışı bırakılmış")
    stored_hash = existing.get("password_hash")
    if not stored_hash:
        # GÜVENLİK: Şifresi olmayan eski hesaba ilk girişte şifre atamak hesap ele geçirmeye açıktı.
        raise HTTPException(status_code=403, detail="Hesabınız için şifre belirlenmemiş. Lütfen 'Şifremi Unuttum' ile SMS doğrulamalı şifre oluşturun.")
    if not payload.password or not verify_password(payload.password, stored_hash):
        await _insert_log("log_auth", {"user_id": existing["user_id"], "phone_masked": _mask_phone(phone), "action": "login_failed", "change_details": None}, request)
        await _check_brute_force(phone, request)
        _is_priv = existing.get("role") in ("admin", "yonetici")
        locked = await register_failure(f"login:{phone}", request, max_fail=5, lock_minutes=15,
                                        alarm_event="login_lockout" if _is_priv else None, user=existing,
                                        details={"phone_masked": _mask_phone(phone), "role": existing.get("role")})
        if locked:
            raise HTTPException(status_code=429, detail="Çok fazla hatalı deneme. Hesap 15 dakika kilitlendi.")
        raise HTTPException(status_code=401, detail="Telefon numarası veya şifre hatalı")
    await clear_failures(f"login:{phone}")
    if _is_admin_role(existing):
        return await _start_admin_2fa(existing, request, via="phone")
    token = await create_session(existing["user_id"], request=request)
    await _insert_log("log_auth", {"user_id": existing["user_id"], "phone_masked": _mask_phone(phone), "action": "login_success", "change_details": None}, request)
    user = await db.users.find_one({"user_id": existing["user_id"]}, {"_id": 0})
    return {"token": token, "user": _public_user_doc(user)}


@api_router.post("/auth/admin")
async def auth_admin(payload: AdminLoginInput, request: Request = None):
    _ip = _client_ip(request)
    _uname = str(payload.username or "").strip()[:64]
    await rate_limit(f"admin_login_ip:{_ip}", 10, 300, "Çok fazla yönetici giriş denemesi. 5 dakika bekleyin.")
    await check_lockout(f"admin:{_uname}", "Yönetici girişi geçici olarak kilitlendi (15 dk).")
    await check_lockout(f"admin_ip:{_ip}", "Yönetici girişi geçici olarak kilitlendi (15 dk).")
    admin = await db.users.find_one({"role": {"$in": ["admin", "yonetici"]}, "username": _uname})
    if admin and admin.get("login_disabled"):
        admin = None
    if not admin or not verify_password(payload.password, admin.get("password_hash", "")):
        await _insert_log("log_auth", {"user_id": None, "phone_masked": "", "action": "admin_login_failed", "change_details": {"attempted_username": _uname}}, request)
        await _insert_log("log_security", {"event_type": "admin_login_failed", "source_ip": _ip, "user_id": None, "details": {"attempted_username": _uname}, "severity": "high", "resolved": False}, request)
        locked = await register_failure(f"admin:{_uname}", request, max_fail=5, lock_minutes=15, alarm_event="admin_lockout", details={"attempted_username": _uname})
        locked_ip = await register_failure(f"admin_ip:{_ip}", request, max_fail=8, lock_minutes=15, alarm_event="admin_lockout", details={"attempted_username": _uname, "by": "ip"})
        if locked or locked_ip:
            raise HTTPException(status_code=429, detail="Çok fazla hatalı deneme. Yönetici girişi 15 dakika kilitlendi.")
        raise HTTPException(status_code=401, detail="Kullanıcı adı veya şifre hatalı")
    await clear_failures(f"admin:{_uname}")
    return await _start_admin_2fa(admin, request, via="username")
    token = await create_session(admin["user_id"], request=request)
    await _insert_log("log_auth", {"user_id": admin["user_id"], "phone_masked": _mask_phone(admin.get("phone","")), "action": "admin_login", "change_details": None}, request)
    await _insert_log("log_security", {"event_type": "admin_login", "source_ip": _extract_request_meta(request)["ip_address"], "user_id": admin["user_id"], "details": {}, "severity": "low", "resolved": True}, request)
    user = await db.users.find_one({"user_id": admin["user_id"]}, {"_id": 0, "password_hash": 0, "username": 0})
    return {"token": token, "user": _public_user_doc(user)}


@api_router.get("/auth/me")
async def auth_me(user=Depends(get_current_user)):
    return _public_user_doc(user)


@api_router.post("/auth/logout")
async def auth_logout(authorization: Optional[str] = Header(None), request: Request = None):
    _logout_uid = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        _sess = await db.user_sessions.find_one(_session_query(token))
        if _sess:
            _logout_uid = _sess.get("user_id")
        await db.user_sessions.delete_one(_session_query(token))
    if _logout_uid:
        await _insert_log("log_auth", {"user_id": _logout_uid, "phone_masked": "", "action": "logout", "change_details": None}, request)
    return {"success": True}


# ---------------- Customer profile / address compatibility routes ----------------
# _clean_text -> core/util.py


# SMS yardımcıları (_normalize_sms_phone, send_sms_verimor, _generate_sms_code,
# send_delivery_sms, _tr_ascii, _no_show_order_no, _send_no_show_sms) -> services/sms.py


# No-show ceza sistemi (_evaluate_no_show_restriction, _apply_no_show_penalty,
# _maybe_expire_no_show, NO_SHOW_* sabitleri) -> services/noshow.py


def _normalize_address_payload(data: dict, user_id: str, existing_id: Optional[str] = None) -> dict:
    address_id = existing_id or data.get("id") or new_id("addr")
    title = _clean_text(data.get("title") or data.get("type") or "Evim")
    address = {
        "id": address_id,
        "user_id": user_id,
        "title": title,
        "city": _clean_text(data.get("city") or data.get("il") or "Bursa"),
        "district": _clean_text(data.get("district") or data.get("ilce") or ""),
        "neighborhood": _clean_text(data.get("neighborhood") or data.get("mahalle") or ""),
        "street": _clean_text(data.get("street") or data.get("sokak") or data.get("cadde") or ""),
        "building_no": _clean_text(data.get("building_no") or data.get("bina_no") or data.get("building") or ""),
        "floor": _clean_text(data.get("floor") or data.get("kat") or ""),
        "apartment_no": _clean_text(data.get("apartment_no") or data.get("daire") or data.get("door") or ""),
        "site_name": _clean_text(data.get("site_name") or data.get("site_adi") or ""),
        "description": _clean_text(data.get("description") or data.get("adres_tarifi") or ""),
        "details": data.get("details"),
        "lat": data.get("lat"),
        "lng": data.get("lng"),
        "is_default": bool(data.get("is_default", False)),
        "updated_at": now_utc(),
    }
    if not existing_id:
        address["created_at"] = now_utc()
    return address


def _validate_address_payload(address: dict):
    missing = []
    if not _clean_text(address.get("neighborhood")):
        missing.append("mahalle")
    if not _clean_text(address.get("street")):
        missing.append("sokak/cadde")
    if not _clean_text(address.get("building_no")):
        missing.append("bina no")
    if missing:
        raise HTTPException(
            status_code=400,
            detail="Adres kaydı için zorunlu alanlar eksik: " + ", ".join(missing)
        )


def _public_user_doc(user: dict) -> dict:
    doc = {k: v for k, v in user.items() if k not in ("_id", "password_hash", "username")}
    # No-show ceza durumunu türet (uygulama kapıda/tezgah ödeme seçeneklerini gizleyebilsin)
    try:
        ns = _evaluate_no_show_restriction(user)
        doc["online_only"] = ns["online_only"]
        doc["online_only_indefinite"] = ns["indefinite"]
        doc["no_show_count"] = ns["count"]
        doc["online_only_message"] = ns["message"]
        doc["online_only_until"] = ns["until"].isoformat() if ns.get("until") else None
    except Exception:
        pass
    # marketing_consent: bundle {accepted: bool} bekliyor; DB'de bool veya dict olabilir
    mc = doc.get("marketing_consent")
    if mc is None:
        doc["marketing_consent"] = {"accepted": False}
    elif isinstance(mc, bool):
        doc["marketing_consent"] = {"accepted": mc}
    elif isinstance(mc, dict) and "accepted" not in mc:
        doc["marketing_consent"] = {"accepted": False}
    # dict ve "accepted" anahtarı varsa olduğu gibi bırak
    return doc


@api_router.put("/auth/profile")
async def update_auth_profile(data: dict, current_user: dict = Depends(get_current_user), request: Request = None):
    updates = {}
    if "name" in data:
        name = str(data.get("name") or "").strip()
        if name:
            updates["name"] = name
    if "marketing_consent" in data:
        updates["marketing_consent"] = bool(data.get("marketing_consent"))
    if updates:
        updates["updated_at"] = now_utc()
        _prof_before = await db.users.find_one({"user_id": current_user["user_id"]}, {"_id": 0})
        await db.users.update_one({"user_id": current_user["user_id"]}, {"$set": updates})
        for _pf in ["name", "marketing_consent"]:
            _ov = (_prof_before or {}).get(_pf)
            _nv = updates.get(_pf)
            if _nv is not None and _ov != _nv:
                await _insert_log("log_auth", {"user_id": current_user["user_id"], "phone_masked": _mask_phone(current_user.get("phone","")), "action": "profile_updated", "change_details": {"field": _pf, "old_value": _ov, "new_value": _nv}}, request)
    user = await db.users.find_one({"user_id": current_user["user_id"]}, {"_id": 0, "password_hash": 0, "username": 0})
    return _public_user_doc(user or {})


@api_router.post("/auth/password")
async def change_auth_password(data: dict, current_user: dict = Depends(get_current_user), request: Request = None):
    """Kullanıcının kendi şifresini değiştirir.
    Mevcut şifresi varsa doğrulanır; yoksa (telefon/Google kaydı) yeni şifre doğrudan atanır."""
    current_password = str(data.get("current_password") or "")
    new_password = str(data.get("new_password") or "").strip()
    _min_len = 8 if current_user.get("role") in ("admin", "yonetici") else 6
    if len(new_password) < _min_len:
        raise HTTPException(status_code=400, detail=f"Yeni şifre en az {_min_len} karakter olmalıdır.")
    if len(new_password) > 128:
        raise HTTPException(status_code=400, detail="Şifre çok uzun.")
    user = await db.users.find_one({"user_id": current_user["user_id"]})
    if not user:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
    stored_hash = user.get("password_hash")
    if stored_hash:
        if not current_password or not verify_password(current_password, stored_hash):
            raise HTTPException(status_code=400, detail="Mevcut şifreniz hatalı.")
    await db.users.update_one(
        {"user_id": current_user["user_id"]},
        {"$set": {"password_hash": hash_password(new_password), "updated_at": now_utc()}},
    )
    await _insert_log("log_auth", {"user_id": current_user["user_id"], "phone_masked": _mask_phone(current_user.get("phone","")), "action": "profile_updated", "change_details": {"field": "password", "old_value": "[masked]", "new_value": "[masked]"}}, request)
    return {"success": True, "message": "Şifreniz güncellendi."}


@api_router.get("/auth/addresses")
async def list_auth_addresses(current_user: dict = Depends(get_current_user)):
    user = await db.users.find_one({"user_id": current_user["user_id"]}, {"_id": 0, "addresses": 1})
    addresses = user.get("addresses", []) if user else []
    if not addresses:
        addresses = await db.addresses.find({"user_id": current_user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return addresses


@api_router.post("/auth/addresses")
async def create_auth_address(data: dict, current_user: dict = Depends(get_current_user), request: Request = None):
    address = _normalize_address_payload(data, current_user["user_id"])
    _validate_address_payload(address)
    user = await db.users.find_one({"user_id": current_user["user_id"]}, {"_id": 0, "addresses": 1})
    current_addresses = user.get("addresses", []) if user else []
    if not current_addresses or address.get("is_default"):
        for addr in current_addresses:
            addr["is_default"] = False
        address["is_default"] = True
    current_addresses.append(address)
    await db.users.update_one({"user_id": current_user["user_id"]}, {"$set": {"addresses": current_addresses, "updated_at": now_utc()}})
    await db.addresses.update_one({"id": address["id"], "user_id": current_user["user_id"]}, {"$set": address}, upsert=True)
    await _insert_log("log_auth", {"user_id": current_user["user_id"], "phone_masked": _mask_phone(current_user.get("phone","")), "action": "address_added", "change_details": {"address_id": address["id"]}}, request)
    user_doc = await db.users.find_one({"user_id": current_user["user_id"]}, {"_id": 0, "password_hash": 0, "username": 0})
    return {"success": True, "address": address, "user": user_doc}


@api_router.put("/auth/addresses/{address_id}")
async def update_auth_address(address_id: str, data: dict, current_user: dict = Depends(get_current_user), request: Request = None):
    user = await db.users.find_one({"user_id": current_user["user_id"]}, {"_id": 0, "addresses": 1})
    addresses = user.get("addresses", []) if user else []
    found = False
    updated_address = None
    for idx, addr in enumerate(addresses):
        if addr.get("id") == address_id:
            updated_address = _normalize_address_payload({**addr, **data}, current_user["user_id"], existing_id=address_id)
            _validate_address_payload(updated_address)
            addresses[idx] = updated_address
            found = True
            break
    if not found:
        existing = await db.addresses.find_one({"id": address_id, "user_id": current_user["user_id"]}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Adres bulunamadı")
        updated_address = _normalize_address_payload({**existing, **data}, current_user["user_id"], existing_id=address_id)
        _validate_address_payload(updated_address)
        addresses.append(updated_address)
    if updated_address and updated_address.get("is_default"):
        for addr in addresses:
            if addr.get("id") != address_id:
                addr["is_default"] = False
    await db.users.update_one({"user_id": current_user["user_id"]}, {"$set": {"addresses": addresses, "updated_at": now_utc()}})
    await db.addresses.update_one({"id": address_id, "user_id": current_user["user_id"]}, {"$set": updated_address}, upsert=True)
    await _insert_log("log_auth", {"user_id": current_user["user_id"], "phone_masked": _mask_phone(current_user.get("phone","")), "action": "address_updated", "change_details": {"address_id": address_id}}, request)
    return {"success": True, "address": updated_address}


@api_router.delete("/auth/addresses/{address_id}")
async def delete_auth_address(address_id: str, current_user: dict = Depends(get_current_user), request: Request = None):
    user = await db.users.find_one({"user_id": current_user["user_id"]}, {"_id": 0, "addresses": 1})
    addresses = user.get("addresses", []) if user else []
    new_addresses = [addr for addr in addresses if addr.get("id") != address_id]
    if len(new_addresses) == len(addresses):
        existing = await db.addresses.find_one({"id": address_id, "user_id": current_user["user_id"]})
        if not existing:
            raise HTTPException(status_code=404, detail="Adres bulunamadı")
    if new_addresses and not any(addr.get("is_default") for addr in new_addresses):
        new_addresses[0]["is_default"] = True
    await db.users.update_one({"user_id": current_user["user_id"]}, {"$set": {"addresses": new_addresses, "updated_at": now_utc()}})
    await db.addresses.delete_one({"id": address_id, "user_id": current_user["user_id"]})
    await _insert_log("log_auth", {"user_id": current_user["user_id"], "phone_masked": _mask_phone(current_user.get("phone","")), "action": "address_deleted", "change_details": {"address_id": address_id}}, request)
    return {"success": True}


@api_router.patch("/auth/addresses/{address_id}/default")
async def set_default_auth_address(address_id: str, current_user: dict = Depends(get_current_user)):
    user = await db.users.find_one({"user_id": current_user["user_id"]}, {"_id": 0, "addresses": 1})
    addresses = user.get("addresses", []) if user else []
    found = False
    for addr in addresses:
        is_target = addr.get("id") == address_id
        addr["is_default"] = is_target
        found = found or is_target
    if not found:
        raise HTTPException(status_code=404, detail="Adres bulunamadı")
    await db.users.update_one({"user_id": current_user["user_id"]}, {"$set": {"addresses": addresses, "updated_at": now_utc()}})
    await db.addresses.update_many({"user_id": current_user["user_id"]}, {"$set": {"is_default": False}})
    await db.addresses.update_one({"id": address_id, "user_id": current_user["user_id"]}, {"$set": {"is_default": True, "updated_at": now_utc()}})
    return {"success": True}


# Backward-compatible aliases if any screen calls /api/addresses directly.
@api_router.get("/addresses")
async def compat_list_addresses(current_user: dict = Depends(get_current_user)):
    return await list_auth_addresses(current_user)


@api_router.post("/addresses")
async def compat_create_address(data: dict, current_user: dict = Depends(get_current_user)):
    return await create_auth_address(data, current_user)


@api_router.put("/addresses/{address_id}")
async def compat_update_address(address_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    return await update_auth_address(address_id, data, current_user)


@api_router.delete("/addresses/{address_id}")
async def compat_delete_address(address_id: str, current_user: dict = Depends(get_current_user)):
    return await delete_auth_address(address_id, current_user)


@api_router.patch("/addresses/{address_id}/default")
async def compat_set_default_address(address_id: str, current_user: dict = Depends(get_current_user)):
    return await set_default_auth_address(address_id, current_user)


# ---------------- Product Routes ----------------
# _afro_norm -> core/util.py


@api_router.get("/products", response_model=List[Product])
async def list_products(
    category: Optional[str] = None,
    search: Optional[str] = None,
    market: Optional[str] = None,
    show_all: Optional[str] = None,
):
    query = {}
    if category and category != "Tümü":
        query["category"] = category
    if search:
        query["name"] = {"$regex": search, "$options": "i"}
    products = await db.products.find(query, {"_id": 0}).to_list(1000)

    # PAZAR BAZLI TEDARİKÇİ FİLTRESİ: Bir ürün, ancak tedarikçisi (supplier_group)
    # catalog_config.supplier_markets içinde seçili pazara atanmışsa görünür.
    # - Tedarikçinin haritada kaydı varsa: KATI davran (sadece atanmış pazarlarda
    #   görünür; liste boşsa hiçbir pazarda görünmez).
    # - Tedarikçinin hiç kaydı yoksa: güvenli tarafta kal (her pazarda göster).
    # - market boşsa veya show_all istenmişse: filtreleme yok (geriye dönük uyumlu).
    _show_all = str(show_all).lower() in ("1", "true", "yes") if show_all is not None else False
    if market and market.strip() and not _show_all:
        target = _afro_norm(market)
        cfg = await _read_catalog_config()
        sm = (cfg or {}).get("supplier_markets") or {}
        norm_map = {}  # kayıtlı tedarikçiler -> izin verilen pazar kümeleri
        for sup, mkts in sm.items():
            mset = set(_afro_norm(x) for x in (mkts or []) if _afro_norm(x))
            # Tedarikçi supplier_markets'te kayıtlıysa (boş bile olsa) kısıtlıdır.
            # - Listesi boşsa: hiçbir pazarda görünmez.
            # - Listesi doluysa: sadece o pazarlarda görünür.
            norm_map[_afro_norm(sup)] = mset

        def _allowed(p):
            sg = _afro_norm(p.get("supplier_group") or "")
            if sg in norm_map:
                # Tedarikçi kayıtlı -> izin listesine bak (boş küme = hiçbir yerde yok)
                return target in norm_map[sg]
            return True  # yapılandırılmamış tedarikçi -> her pazarda göster (eski ürünler)

        products = [p for p in products if _allowed(p)]
    # Order by category (same top-to-bottom order as the category menu),
    # then in-stock first (out-of-stock sink to the bottom of each category), then name.
    cat_order = {c: i for i, c in enumerate(ORDERED_CATEGORIES)}
    products.sort(key=lambda p: (
        cat_order.get(p.get("category"), len(cat_order)),
        0 if p.get("in_stock") else 1,
        (p.get("name") or "").lower(),
    ))
    return products


@api_router.get("/products-meta")
async def products_meta():
    doc = await db.products.find_one({}, {"_id": 0, "updated_at": 1}, sort=[("updated_at", -1)])
    return {"last_updated": doc["updated_at"] if doc and doc.get("updated_at") else None}


@api_router.get("/categories", response_model=List[str])
async def list_categories():
    existing = await db.products.distinct("category")
    # Always show the fixed ordered categories first, then any extra
    # categories an admin may have added that aren't in the list.
    extras = [c for c in sorted(existing) if c not in ORDERED_CATEGORIES]
    return ORDERED_CATEGORIES + extras


@api_router.get("/products/{product_id}", response_model=Product)
async def get_product(product_id: str):
    product = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Ürün bulunamadı")
    return product


@api_router.get("/admin/products")
async def admin_list_products(staff=Depends(get_current_staff)):
    query = {}
    if is_supplier_role(staff):
        sg = get_user_supplier_group(staff)
        if not sg:
            return []
        query["supplier_group"] = sg
    products = await db.products.find(query, {"_id": 0}).to_list(5000)
    cat_order = {c: i for i, c in enumerate(ORDERED_CATEGORIES)}
    products.sort(key=lambda p: (
        (p.get("supplier_group") or "").lower(),
        cat_order.get(p.get("category"), len(cat_order)),
        (p.get("name") or "").lower(),
    ))
    return products


# Yeni çift-fiyat alanları: mevcut UI bunları göndermezse migrasyon değerleri korunmalı.
DUAL_PRICE_FIELDS = ("supplier_price", "sale_price", "profit_margin_amount",
                     "price_updated_at", "price_updated_by")


@api_router.post("/admin/products", response_model=Product)
async def create_product(payload: ProductInput, staff=Depends(get_current_staff), request: Request = None):
    data = payload.dict()
    # Tedarikçi (esnaf/supplier) sadece kendi tedarikçisine ürün ekleyebilir
    if is_supplier_role(staff):
        sg = get_user_supplier_group(staff)
        if not sg:
            raise HTTPException(status_code=403, detail="Hesabınıza tedarikçi atanmamış")
        await _afro_require_supplier_contract(staff)
        data["supplier_group"] = sg
    if not data.get("price"):
        data["price"] = data.get("gel_al_price") or 0
    # sale_price gönderilmemişse müşteri fiyatı (price) ile başlat
    if data.get("sale_price") is None:
        data["sale_price"] = data.get("price")
    product = Product(**data)
    await db.products.insert_one(product.dict())
    await _insert_log("log_admin", {"admin_id": staff["user_id"], "admin_name": staff.get("name",""), "action": "product_created", "target_type": "product", "target_id": product.id, "change_details": {"field": "new_product", "old_value": None, "new_value": {"name": data.get("name"), "sale_price": data.get("sale_price")}}, "admin_note": ""}, request)
    return product


# ÖNEMLİ: Bu STATİK yol ("/reset-campaigns"), aşağıdaki dinamik
# "/admin/products/{product_id}" (PUT/DELETE) yolundan ÖNCE tanımlanır.
# "İndirimleri Sıfırla" butonu (Eve Servis Ayarları) bu endpoint'i çağırır;
# tüm ürünlerin kampanya indirimi alanlarını (Kampanya İndirimi % ve
# Minimum Miktar) 0'a çeker. Eskiden endpoint YOKTU -> POST, dinamik
# {product_id} pattern'ine düşüp 405 dönüyordu (buton çalışmıyordu).
@api_router.post("/admin/products/reset-campaigns")
async def reset_product_campaigns(admin=Depends(get_current_admin), request: Request = None):
    result = await db.products.update_many(
        {},
        {"$set": {"campaign_discount_percent": 0, "campaign_min_qty": 0}},
    )
    try:
        await _insert_log("log_admin", {"admin_id": admin.get("user_id"), "admin_name": admin.get("name", ""), "action": "campaigns_reset", "target_type": "product", "target_id": None, "change_details": {"field": "campaign_discount_percent+campaign_min_qty", "old_value": "various", "new_value": 0}, "admin_note": ""}, request)
    except Exception:
        pass
    return {"success": True, "modified": int(getattr(result, "modified_count", 0) or 0)}


@api_router.put("/admin/products/{product_id}", response_model=Product)
async def update_product(product_id: str, payload: ProductInput, staff=Depends(get_current_staff), request: Request = None):
    existing = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Ürün bulunamadı")
    sent = payload.dict(exclude_unset=True)   # sadece client'ın gerçekten gönderdiği alanlar
    updates = payload.dict()
    is_supplier = is_supplier_role(staff)
    
    # Tedarikçi (esnaf/supplier) sadece kendi tedarikçisinin ürünlerini düzenleyebilir
    if is_supplier:
        sg = get_user_supplier_group(staff)
        if not sg or existing.get("supplier_group") != sg:
            raise HTTPException(status_code=403, detail="Bu ürünü düzenleme yetkiniz yok")
        await _afro_require_supplier_contract(staff)
        updates["supplier_group"] = sg
        
        # TEDARİKÇİ KISITLARI (Faz 1):
        # - Sadece supplier_price + temel bilgiler (name, description, image, stock, unit) güncelleyebilir
        # - sale_price, profit_margin_amount, campaign, quality gibi admin alanlarını DEĞİŞTİREMEZ
        # - supplier_price değiştirirse sale_price otomatik hesaplanır (= supplier_price + profit_margin_amount)
        protected_from_supplier = [
            "profit_margin_amount", "sale_price", "price_updated_by",
            "campaign_discount_percent", "campaign_min_qty", "quality",
            "hidden", "active_gel_al", "active_eve_servis",
        ]
        for f in protected_from_supplier:
            if f in updates:
                updates[f] = existing.get(f)  # mevcut değeri koru
        
        # supplier_price güncelleniyorsa sale_price'ı yeniden hesapla
        if "supplier_price" in sent:
            # Fiyat kilidi kontrolü
            locked_until = existing.get("supplier_price_locked_until")
            if locked_until:
                # Tarih string ise parse et
                if isinstance(locked_until, str):
                    try:
                        locked_until = datetime.fromisoformat(locked_until.replace("Z", "+00:00"))
                    except:
                        locked_until = None
                # Kilit hâlâ geçerliyse engelle
                if locked_until and locked_until > now_utc():
                    raise HTTPException(
                        status_code=400,
                        detail=f"Fiyat değişikliği bugün için kilitlenmiştir. Yeni fiyatınız yarın (00:00) itibarıyla güncellenebilir."
                    )
            
            new_supp_price = updates.get("supplier_price") or 0
            margin = existing.get("profit_margin_amount") or 0
            updates["sale_price"] = new_supp_price + margin
            updates["price"] = updates["sale_price"]  # müşteri fiyatı = sale_price
            updates["price_updated_at"] = now_utc()
            updates["price_updated_by"] = "supplier"
            
            # Bugünün sonuna kadar kilitle (Istanbul TZ 23:59:59)
            from datetime import timezone as tz
            from zoneinfo import ZoneInfo
            ist = ZoneInfo("Europe/Istanbul")
            now_ist = datetime.now(ist)
            end_of_today = now_ist.replace(hour=23, minute=59, second=59, microsecond=999999)
            updates["supplier_price_locked_until"] = end_of_today.astimezone(timezone.utc)
        else:
            # supplier_price değişmiyorsa çift-fiyat alanlarını koru
            for f in DUAL_PRICE_FIELDS:
                if f not in sent:
                    updates[f] = existing.get(f)
    else:
        # ADMIN GÜNCELLEMESI: her şeyi değiştirebilir
        # profit_margin veya sale_price değişirse diğeri otomatik hesaplanır
        
        # Çift-fiyat alanları gönderilmediyse mevcut değerleri koru
        for f in DUAL_PRICE_FIELDS:
            if f not in sent:
                updates[f] = existing.get(f)
        
        # Admin profit_margin_amount değiştiriyorsa → sale_price yeniden hesapla
        if "profit_margin_amount" in sent:
            supp_price = updates.get("supplier_price") or existing.get("supplier_price") or 0
            margin = updates.get("profit_margin_amount") or 0
            updates["sale_price"] = supp_price + margin
            updates["price"] = updates["sale_price"]
            updates["price_updated_at"] = now_utc()
            updates["price_updated_by"] = "admin"
        # Admin sale_price doğrudan değiştiriyorsa → profit_margin_amount yeniden hesapla
        elif "sale_price" in sent:
            supp_price = updates.get("supplier_price") or existing.get("supplier_price") or 0
            sale = updates.get("sale_price") or 0
            updates["profit_margin_amount"] = max(0, sale - supp_price)
            updates["price"] = sale
            updates["price_updated_at"] = now_utc()
            updates["price_updated_by"] = "admin"
        # Admin supplier_price değiştiriyorsa → sale_price yeniden hesapla (margin korunur)
        elif "supplier_price" in sent:
            new_supp_price = updates.get("supplier_price") or 0
            margin = existing.get("profit_margin_amount") or 0
            updates["sale_price"] = new_supp_price + margin
            updates["price"] = updates["sale_price"]
            updates["price_updated_at"] = now_utc()
            updates["price_updated_by"] = "admin"
    
    if not updates.get("price"):
        updates["price"] = updates.get("gel_al_price") or 0
    
    updates["updated_at"] = now_utc()
    result = await db.products.update_one({"id": product_id}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Ürün bulunamadı")
    product = await db.products.find_one({"id": product_id}, {"_id": 0})
    # --- LOG: product_updated ---
    _pchanged = []
    for _pf in ["sale_price", "supplier_price", "name", "active", "profit_margin_amount"]:
        _pov = existing.get(_pf)
        _pnv = updates.get(_pf)
        if _pov != _pnv and _pnv is not None:
            _pchanged.append({"field": _pf, "old_value": _pov, "new_value": _pnv})
    if _pchanged:
        await _insert_log("log_admin", {"admin_id": staff["user_id"], "admin_name": staff.get("name",""), "action": "product_updated", "target_type": "product", "target_id": product_id, "change_details": _pchanged[0] if len(_pchanged)==1 else {"fields": _pchanged}, "admin_note": ""}, request)
    return product


@api_router.delete("/admin/products/{product_id}")
async def delete_product(product_id: str, staff=Depends(get_current_staff), request: Request = None):
    # Tedarikçi (esnaf/supplier) sadece kendi tedarikçisinin ürünlerini silebilir
    if is_supplier_role(staff):
        sg = get_user_supplier_group(staff)
        existing = await db.products.find_one({"id": product_id}, {"_id": 0, "supplier_group": 1})
        if not existing:
            raise HTTPException(status_code=404, detail="Ürün bulunamadı")
        if not sg or existing.get("supplier_group") != sg:
            raise HTTPException(status_code=403, detail="Bu ürünü silme yetkiniz yok")
        await _afro_require_supplier_contract(staff)
    _del_prod = await db.products.find_one({"id": product_id}, {"_id": 0, "name": 1})
    result = await db.products.delete_one({"id": product_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Ürün bulunamadı")
    await _insert_log("log_admin", {"admin_id": staff["user_id"], "admin_name": staff.get("name",""), "action": "product_deleted", "target_type": "product", "target_id": product_id, "change_details": {"field": "deleted", "old_value": (_del_prod or {}).get("name"), "new_value": None}, "admin_note": ""}, request)
    return {"success": True}


# ---------------- Campaign Routes ----------------
@api_router.get("/campaigns", response_model=List[Campaign])
async def list_campaigns(user=Depends(get_optional_user)):
    query = {"active": True}
    if not user:
        query["members_only"] = False
    campaigns = await db.campaigns.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return campaigns


@api_router.get("/admin/campaigns", response_model=List[Campaign])
async def admin_list_campaigns(admin=Depends(get_current_admin)):
    campaigns = await db.campaigns.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return campaigns


@api_router.post("/admin/campaigns", response_model=Campaign)
async def create_campaign(payload: CampaignInput, admin=Depends(get_current_admin)):
    campaign = Campaign(**payload.dict())
    await db.campaigns.insert_one(campaign.dict())
    # ── PUSH BİLDİRİM: Yeni kampanya → tüm kullanıcılara ──
    try:
        push_body = (payload.description or "")[:80] or "Kaçırmayın, süre sınırlı!"
        await send_push_to_all(
            title=f"🎉 {payload.title}",
            body=push_body,
            data={"type": "campaign", "campaign_id": campaign.id, "url": "/"},
        )
    except Exception:
        pass
    return campaign


@api_router.put("/admin/campaigns/{campaign_id}", response_model=Campaign)
async def update_campaign(campaign_id: str, payload: CampaignInput, admin=Depends(get_current_admin)):
    result = await db.campaigns.update_one({"id": campaign_id}, {"$set": payload.dict()})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Kampanya bulunamadı")
    campaign = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})
    return campaign


@api_router.delete("/admin/campaigns/{campaign_id}")
async def delete_campaign(campaign_id: str, admin=Depends(get_current_admin)):
    result = await db.campaigns.delete_one({"id": campaign_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Kampanya bulunamadı")
    return {"success": True}


# ---------------- Coupon Routes ----------------
@api_router.get("/coupons", response_model=List[Coupon])
async def list_coupons(user=Depends(get_optional_user)):
    coupons = await db.coupons.find({"active": True}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    result = []
    for c in coupons:
        # Tek kullanımlık kuponlar zaten kullanılmışsa genel olarak gizle
        if c.get("single_use") and c.get("used"):
            continue
        assigned = c.get("assigned_user_ids") or []
        if user:
            # Members see: coupons assigned to them, OR general (unassigned) coupons
            if assigned:
                if user["user_id"] in assigned:
                    # Kullanıcıya özel kalan hak kontrolü: 0 ise gizle
                    ua = next((a for a in (c.get("assignments") or []) if a.get("user_id") == user["user_id"]), None)
                    if ua:
                        used = int(ua.get("used_count") or 0)
                        limit = int(ua.get("limit") or c.get("per_user_limit") or 1)
                        if used >= limit:
                            continue  # Kalan hak 0, listeye ekleme
                    result.append(c)
            else:
                result.append(c)
        else:
            # Guests see only public, unassigned coupons
            if not assigned and not c.get("members_only", True):
                result.append(c)
    return result


@api_router.post("/coupons/validate")
async def validate_coupon(data: dict, user=Depends(get_optional_user), request: Request = None):
    """Sepet kupon önizlemesi. İndirim, siparişteki ile AYNI fonksiyonla (_evaluate_coupon) hesaplanır."""
    await rate_limit(f"coupon_ip:{_client_ip(request)}", 40, 300, "Çok fazla kupon denemesi. Lütfen biraz bekleyin.")
    if user:
        await rate_limit(f"coupon_user:{user.get('user_id')}", 30, 300, "Çok fazla kupon denemesi. Lütfen biraz bekleyin.")
    code = str(data.get("code") or "").upper().strip()[:40]
    total = money_d(data.get("total", data.get("cart_total", 0)) or 0)
    payment_method = str(data.get("payment_method") or "")
    ev = await _evaluate_coupon(code, user, total, payment_method)
    coupon = ev["coupon"]
    discount = float(ev["discount"])
    discount_type = ev["discount_type"]
    return {
        "success": True,
        "id": coupon.get("id"),
        "coupon_id": coupon.get("id"),
        "code": coupon.get("code"),
        "title": coupon.get("title"),
        "discount_type": discount_type,
        "discount_percent": coupon.get("discount_percent"),
        "discount_value": coupon.get("discount_amount") if discount_type == "fixed" else coupon.get("discount_percent"),
        "discount": discount,
        "discount_amount": discount,
        "min_amount": float(ev["min_amount"]),
        "payment_method": payment_method,
        "message": f"{discount:.2f}₺ indirim uygulandı",
    }


@api_router.get("/admin/coupons", response_model=List[Coupon])
async def admin_list_coupons(admin=Depends(get_current_admin)):
    # Exclude per-member auto-issued welcome coupons to keep the admin list clean.
    coupons = await db.coupons.find({"auto_issued": {"$ne": True}}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return coupons


@api_router.post("/admin/coupons/redeem")
async def admin_redeem_coupon(payload: RedeemInput, admin=Depends(get_current_admin), request: Request = None):
    code = payload.code.upper().strip()
    coupon = await db.coupons.find_one({"code": code}, {"_id": 0})
    if not coupon:
        raise HTTPException(status_code=404, detail="Kupon bulunamadı")
    if not coupon.get("active", True):
        raise HTTPException(status_code=400, detail="Bu kupon pasif durumda")
    if coupon.get("single_use") and coupon.get("used"):
        raise HTTPException(status_code=400, detail="Bu kupon daha önce kullanılmış")
    # Per-user kullanım hakkı takibi: kupon belirli bir üye için kullanılıyorsa sayacı artır.
    target_uid = (payload.user_id or "").strip() or None
    assignments = coupon.get("assignments") or []
    if not target_uid and len(assignments) == 1:
        # Kupon tek bir üyeye tanımlıysa otomatik o üyeye say
        target_uid = assignments[0].get("user_id")
    if target_uid and assignments:
        ua = next((a for a in assignments if a.get("user_id") == target_uid), None)
        if ua:
            _lim = int(ua.get("limit") or 1)
            _used = int(ua.get("used_count") or 0)
            if _used >= _lim:
                raise HTTPException(status_code=400, detail="Bu üyenin kupon kullanım hakkı dolmuş")
            ua["used_count"] = _used + 1
            ua["last_used_at"] = now_utc()
            await db.coupons.update_one({"id": coupon["id"]}, {"$set": {"assignments": assignments}})
            await db.coupon_usage_logs.insert_one({
                "coupon_id": coupon["id"], "code": code, "title": coupon.get("title"),
                "user_id": target_uid, "discount_amount": coupon.get("discount_amount"),
                "used_at": now_utc(),
            })
    await db.coupons.update_one({"id": coupon["id"]}, {"$set": {"used": True, "used_at": now_utc()}})
    # LOG: kupon kullanıldı (tezgahta admin tarafından)
    await _insert_log("log_coupons", {
        "coupon_id": coupon.get("id"),
        "coupon_code": code,
        "user_id": target_uid,
        "action": "coupon_used",
        "order_id": None,
        "discount_amount": coupon.get("discount_amount"),
        "discount_type": "percentage" if coupon.get("discount_percent") else "fixed_amount",
        "original_total": None,
        "final_total": None,
        "performed_by": "admin",
        "admin_id": admin.get("user_id"),
        "admin_note": "Tezgahta kupon okutuldu",
    }, request)
    return {"success": True, "code": code, "title": coupon.get("title"),
            "discount_amount": coupon.get("discount_amount"),
            "discount_percent": coupon.get("discount_percent"),
            "min_amount": coupon.get("min_amount", 0)}


def _norm_limit(value, default=1):
    """Kullanım hakkı (limit) değerini pozitif tam sayıya normalize eder."""
    try:
        n = int(float(value))
    except (TypeError, ValueError):
        n = default
    return n if n >= 1 else 1


@api_router.post("/admin/coupons/assign-all")
async def admin_assign_coupon_all(data: dict, admin=Depends(get_current_admin), request: Request = None):
    """Seçili kuponu tüm mevcut üyelere, verilen kullanım hakkı (limit) ile tanımlar."""
    coupon_id = str(data.get("coupon_id") or "").strip()
    limit = _norm_limit(data.get("limit"), 1)
    if not coupon_id:
        raise HTTPException(status_code=400, detail="Kupon seçilmedi")
    coupon = await db.coupons.find_one({"id": coupon_id}, {"_id": 0})
    if not coupon:
        raise HTTPException(status_code=404, detail="Kupon bulunamadı")
    members = await db.users.find(
        {"role": {"$in": ["musteri", "member", "yonetici", "admin"]}}, {"_id": 0, "user_id": 1}
    ).to_list(5000)
    # Mevcut kullanım sayaçlarını koru
    prev = {a.get("user_id"): a for a in (coupon.get("assignments") or [])}
    assignments = []
    for m in members:
        uid = m.get("user_id")
        if not uid:
            continue
        old = prev.get(uid) or {}
        assignments.append({
            "user_id": uid,
            "limit": limit,
            "used_count": int(old.get("used_count") or 0),
            "last_used_at": old.get("last_used_at"),
        })
    user_ids = [a["user_id"] for a in assignments]
    await db.coupons.update_one(
        {"id": coupon_id},
        {"$set": {"assignments": assignments, "assigned_user_ids": user_ids,
                  "members_only": True, "per_user_limit": limit}},
    )
    # LOG: kupon tüm üyelere tanımlandı
    await _insert_log("log_admin", {
        "admin_id": admin["user_id"],
        "admin_name": admin.get("name", ""),
        "action": "coupon_assigned_all",
        "target_type": "coupon",
        "target_id": coupon_id,
        "change_details": {"coupon_code": coupon.get("code", ""), "member_count": len(user_ids), "limit": limit},
        "admin_note": "",
    }, request)
    return {"success": True, "count": len(user_ids),
            "message": f"Kupon {len(user_ids)} üyeye {limit} kullanım hakkıyla tanımlandı"}


@api_router.post("/admin/coupons/assign-member")
async def admin_assign_coupon_member(data: dict, admin=Depends(get_current_admin), request: Request = None):
    """Seçili kuponu tek bir üyeye, verilen kullanım hakkı (limit) ile tanımlar."""
    coupon_id = str(data.get("coupon_id") or "").strip()
    user_id = str(data.get("user_id") or "").strip()
    limit = _norm_limit(data.get("limit"), 1)
    if not coupon_id or not user_id:
        raise HTTPException(status_code=400, detail="Kupon ve üye seçilmelidir")
    coupon = await db.coupons.find_one({"id": coupon_id}, {"_id": 0})
    if not coupon:
        raise HTTPException(status_code=404, detail="Kupon bulunamadı")
    member = await db.users.find_one(
        {"user_id": user_id, "role": {"$in": ["musteri", "member"]}},
        {"_id": 0, "name": 1, "phone": 1},
    )
    if not member:
        raise HTTPException(status_code=404, detail="Üye bulunamadı")
    assignments = coupon.get("assignments") or []
    found = False
    for a in assignments:
        if a.get("user_id") == user_id:
            a["limit"] = limit
            found = True
            break
    if not found:
        assignments.append({"user_id": user_id, "limit": limit, "used_count": 0, "last_used_at": None})
    user_ids = [a["user_id"] for a in assignments]
    await db.coupons.update_one(
        {"id": coupon_id},
        {"$set": {"assignments": assignments, "assigned_user_ids": user_ids, "members_only": True}},
    )
    # LOG: kupon tek üyeye tanımlandı
    await _insert_log("log_admin", {
        "admin_id": admin["user_id"],
        "admin_name": admin.get("name", ""),
        "action": "coupon_assigned_member",
        "target_type": "coupon",
        "target_id": coupon_id,
        "change_details": {"coupon_code": coupon.get("code", ""), "user_id": user_id, "limit": limit},
        "admin_note": "",
    }, request)
    return {"success": True,
            "message": f"Kupon {member.get('name', 'üye')} adlı üyeye {limit} kullanım hakkıyla tanımlandı"}


@api_router.post("/admin/coupons/unassign-member")
async def admin_unassign_coupon_member(data: dict, admin=Depends(get_current_admin), request: Request = None):
    """Seçili kuponu tek bir üyeden geri alır."""
    coupon_id = str(data.get("coupon_id") or "").strip()
    user_id = str(data.get("user_id") or "").strip()
    if not coupon_id or not user_id:
        raise HTTPException(status_code=400, detail="Kupon ve üye seçilmelidir")
    coupon = await db.coupons.find_one({"id": coupon_id}, {"_id": 0})
    if not coupon:
        raise HTTPException(status_code=404, detail="Kupon bulunamadı")
    assignments = [a for a in (coupon.get("assignments") or []) if a.get("user_id") != user_id]
    user_ids = [a["user_id"] for a in assignments]
    await db.coupons.update_one(
        {"id": coupon_id},
        {"$set": {"assignments": assignments, "assigned_user_ids": user_ids}},
    )
    # LOG: kupon üyeden geri alındı
    await _insert_log("log_admin", {
        "admin_id": admin["user_id"],
        "admin_name": admin.get("name", ""),
        "action": "coupon_unassigned_member",
        "target_type": "coupon",
        "target_id": coupon_id,
        "change_details": {"coupon_code": coupon.get("code", ""), "user_id": user_id},
        "admin_note": "",
    }, request)
    return {"success": True, "message": "Kupon üyeden geri alındı"}


@api_router.post("/admin/coupons/unassign-all")
async def admin_unassign_coupon_all(data: dict, admin=Depends(get_current_admin), request: Request = None):
    """Seçili kuponun tüm üye tanımlamalarını geri alır (assignments + assigned_user_ids temizlenir)."""
    coupon_id = str(data.get("coupon_id") or "").strip()
    if not coupon_id:
        raise HTTPException(status_code=400, detail="Kupon seçilmedi")
    coupon = await db.coupons.find_one({"id": coupon_id}, {"_id": 0})
    if not coupon:
        raise HTTPException(status_code=404, detail="Kupon bulunamadı")
    await db.coupons.update_one(
        {"id": coupon_id}, {"$set": {"assigned_user_ids": [], "assignments": []}}
    )
    # LOG: kupon tüm üyelerden geri alındı
    await _insert_log("log_admin", {
        "admin_id": admin["user_id"],
        "admin_name": admin.get("name", ""),
        "action": "coupon_unassigned_all",
        "target_type": "coupon",
        "target_id": coupon_id,
        "change_details": {"coupon_code": coupon.get("code", "")},
        "admin_note": "",
    }, request)
    return {"success": True, "message": "Kupon tüm üyelerden geri alındı"}


@api_router.get("/admin/coupons/{coupon_id}/details")
async def admin_coupon_details(coupon_id: str, admin=Depends(get_current_admin)):
    """Kupon detay ekranı: tanımlı kişiler (kullanım hakkı/kullanım/kalan) ve kullanım geçmişi."""
    coupon = await db.coupons.find_one({"id": coupon_id}, {"_id": 0})
    if not coupon:
        raise HTTPException(status_code=404, detail="Kupon bulunamadı")
    assignments = coupon.get("assignments") or []
    # Eski kayıtlar (yalnız assigned_user_ids var, assignments yok) için geriye dönük uyum
    if not assignments and coupon.get("assigned_user_ids"):
        default_limit = _norm_limit(coupon.get("per_user_limit"), 1)
        assignments = [{"user_id": uid, "limit": default_limit, "used_count": 0, "last_used_at": None}
                       for uid in coupon.get("assigned_user_ids") or []]
    assigned_users = []
    total_uses = 0
    for a in assignments:
        uid = a.get("user_id")
        u = await db.users.find_one({"user_id": uid}, {"_id": 0, "name": 1, "phone": 1}) if uid else None
        lim = _norm_limit(a.get("limit"), 1)
        used = int(a.get("used_count") or 0)
        total_uses += used
        assigned_users.append({
            "user_id": uid,
            "user_name": (u or {}).get("name") or "Bilinmiyor",
            "phone": (u or {}).get("phone"),
            "limit": lim,
            "used_count": used,
            "remaining": max(0, lim - used),
            "last_used_at": a.get("last_used_at"),
        })
    logs = await db.coupon_usage_logs.find(
        {"coupon_id": coupon_id}, {"_id": 0}
    ).sort("used_at", -1).to_list(200)
    return {
        "coupon": coupon,
        "assigned_count": len(assigned_users),
        "total_uses": total_uses,
        "assigned_users": assigned_users,
        "usage_logs": logs,
    }


@api_router.post("/admin/coupons", response_model=Coupon)
async def create_coupon(payload: CouponInput, admin=Depends(get_current_admin), request: Request = None):
    coupon = Coupon(**payload.dict())
    coupon.code = coupon.code.upper().strip()
    await db.coupons.insert_one(coupon.dict())
    await _insert_log("log_coupons", {"coupon_id": coupon.id, "coupon_code": coupon.code, "user_id": None, "action": "coupon_created", "order_id": None, "discount_amount": coupon.discount_amount, "discount_type": "fixed_amount", "original_total": None, "final_total": None, "performed_by": "admin", "admin_id": admin["user_id"], "admin_note": ""}, request)
    await _insert_log("log_admin", {"admin_id": admin["user_id"], "admin_name": admin.get("name",""), "action": "coupon_created", "target_type": "coupon", "target_id": coupon.id, "change_details": {"coupon_code": coupon.code, "discount_amount": coupon.discount_amount}, "admin_note": ""}, request)
    return coupon


@api_router.put("/admin/coupons/{coupon_id}", response_model=Coupon)
async def update_coupon(coupon_id: str, payload: CouponInput, admin=Depends(get_current_admin), request: Request = None):
    updates = payload.dict()
    updates["code"] = updates["code"].upper().strip()
    result = await db.coupons.update_one({"id": coupon_id}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Kupon bulunamadı")
    coupon = await db.coupons.find_one({"id": coupon_id}, {"_id": 0})
    return coupon


@api_router.delete("/admin/coupons/{coupon_id}")
async def delete_coupon(coupon_id: str, admin=Depends(get_current_admin), request: Request = None):
    _del_cpn = await db.coupons.find_one({"id": coupon_id}, {"_id": 0, "code": 1})
    result = await db.coupons.delete_one({"id": coupon_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Kupon bulunamadı")
    await _insert_log("log_coupons", {"coupon_id": coupon_id, "coupon_code": (_del_cpn or {}).get("code",""), "user_id": None, "action": "coupon_cancelled", "order_id": None, "discount_amount": None, "discount_type": None, "original_total": None, "final_total": None, "performed_by": "admin", "admin_id": admin["user_id"], "admin_note": "Admin tarafından silindi"}, request)
    await _insert_log("log_admin", {"admin_id": admin["user_id"], "admin_name": admin.get("name",""), "action": "coupon_deleted", "target_type": "coupon", "target_id": coupon_id, "change_details": {"coupon_code": (_del_cpn or {}).get("code","")}, "admin_note": ""}, request)
    return {"success": True}


# ---------------- Market (çıkılan pazarlar) Routes ----------------
@api_router.get("/markets", response_model=List[Market])
async def list_markets():
    markets = await db.markets.find({"active": True}, {"_id": 0}).sort("created_at", 1).to_list(1000)
    return markets


@api_router.get("/admin/markets", response_model=List[Market])
async def admin_list_markets(staff=Depends(get_current_staff)):
    markets = await db.markets.find({}, {"_id": 0}).sort("created_at", 1).to_list(1000)
    return markets


@api_router.post("/admin/markets", response_model=Market)
async def create_market(payload: MarketInput, admin=Depends(get_current_admin)):
    market = Market(**payload.dict())
    await db.markets.insert_one(market.dict())
    return market


@api_router.put("/admin/markets/{market_id}", response_model=Market)
async def update_market(market_id: str, payload: MarketInput, admin=Depends(get_current_admin)):
    result = await db.markets.update_one({"id": market_id}, {"$set": payload.dict()})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Pazar bulunamadı")
    market = await db.markets.find_one({"id": market_id}, {"_id": 0})
    return market


@api_router.delete("/admin/markets/{market_id}")
async def delete_market(market_id: str, admin=Depends(get_current_admin)):
    result = await db.markets.delete_one({"id": market_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Pazar bulunamadı")
    return {"success": True}


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
SUPPLIER_SOLD_STATUSES = {"teslim_edildi"}


def _order_refund_info(order: dict):
    """Siparişin iade durumunu döndürür: (tam_iade, kismi_iade, iade_tutari)."""
    rs = str(order.get("refund_status") or "").strip().lower()
    ps = str(order.get("payment_status") or "").strip().lower()
    ramt = _as_float(order.get("refund_amount"), 0)
    full = (rs == "iade_edildi") or (ps == "iade_edildi")
    partial = (rs == "kismi_iade_edildi") or (ps == "kismi_iade_edildi")
    return full, partial, ramt


def _order_item_refunds(order: dict):
    """Siparişin HER kalemi için iade edilip edilmediğini döndürür.

    Dönüş: (refunded_flags: list[bool] (items ile paralel), item_level: bool)
      * item_level=True  -> iadeler ürün (kalem) bazında biliniyor (YENİ sistem
        veya tam iade). Satış logunda tam olarak o ürünün tutarı düşülür.
      * item_level=False -> kalem bilgisi yok (ESKİ kısmi iade). Çağıran taraf
        eski orantısal (pay bazlı) hesaba düşer.
    Geriye dönük uyum:
      - Kalemlerde 'refunded' işareti varsa onu kullan (yeni sistem).
      - order.refunded_items (index listesi) varsa onu kullan (yeni sistem).
      - Yoksa order seviyesi tam iade -> tüm kalemler iade.
      - Yalnızca eski kısmi iade varsa -> item_level False (orantısal fallback).
    """
    items = order.get("items") or []
    n = len(items)
    # 1) Kalemlerde doğrudan 'refunded' işareti (yeni sistem)
    if any(("refunded" in (it or {})) for it in items):
        return [bool((it or {}).get("refunded")) for it in items], True
    # 2) order.refunded_items = iade edilen kalemlerin index listesi (yeni sistem)
    ri = order.get("refunded_items")
    if isinstance(ri, list):
        s = set()
        for x in ri:
            try:
                s.add(int(x))
            except Exception:
                pass
        return [(i in s) for i in range(n)], True
    # 3) Eski sistem: order seviyesinde TAM iade -> tüm kalemler iade
    full, partial, ramt = _order_refund_info(order)
    if full:
        return [True] * n, True
    # 4) Eski kısmi iade: kalem bilgisi yok -> orantısal fallback
    return [False] * n, False


async def _build_cost_map():
    """product id -> supplier_price (tedarikçinin girdiği alış/tedarik birim fiyatı)."""
    prods = await db.products.find(
        {}, {"_id": 0, "id": 1, "supplier_price": 1}
    ).to_list(5000)
    m = {}
    for p in prods:
        pid = p.get("id")
        if pid is None:
            continue
        m[pid] = _as_float(p.get("supplier_price"), 0)
    return m


def _item_unit_cost(it: dict, cost_map: dict) -> float:
    """Kalemin birim maliyeti: tedarikçi fiyatı (supplier_price) tercih edilir;
    GİRİLMEMİŞSE (0 veya null) satış fiyatına (unit_price_snapshot / price)
    düşülür — böylece Satışlarım panelinde Birim Fiyat, Tutar ve İade
    kutucukları 0,00 ₺ yerine gerçek tutarı gösterir.

    FİYAT SABİTLEME (snapshot): Satış hangi fiyattan yapıldıysa o an DONAR.
    Katalogda fiyat sonradan değiştirilse bile GEÇMİŞ siparişler yeniden
    hesaplanmaz. Bu yüzden güncel katalog (cost_map) YALNIZCA hiç snapshot'ı
    olmayan çok eski siparişler için son çare olarak kullanılır.

    Öncelik sırası:
      1) supplier_price_snapshot (sipariş anında kaydedilen tedarikçi alış fiyatı — DONMUŞ)
      2) unit_price_snapshot     (sipariş anında kaydedilen satış fiyatı — DONMUŞ fallback)
      3) price                   (kalemin siparişteki birim fiyatı — DONMUŞ fallback)
      4) cost_map[product_id]    (SADECE hiç snapshot'ı olmayan eski siparişlerde güncel supplier_price)
      5) 0.0                     (hiçbiri yoksa)
    """
    # 1) sipariş anındaki tedarikçi fiyatı (DONMUŞ)
    snap = it.get("supplier_price_snapshot")
    if snap is not None:
        c = _as_float(snap, 0)
        if c > 0:
            return c
    # Bu kalem sipariş anında herhangi bir fiyat snapshot'ı içeriyor mu?
    # (Yeni siparişler her zaman içerir; içeriyorsa güncel kataloğa ASLA düşülmez.)
    has_order_snapshot = (
        it.get("supplier_price_snapshot") is not None
        or it.get("unit_price_snapshot") is not None
        or it.get("price") is not None
    )
    # 2-3) FALLBACK: sipariş anındaki satış fiyatı (DONMUŞ). supplier_price
    #       girilmemiş ürünlerde Satışlarım paneli 0,00 ₺ göstermesini engeller
    #       ve katalog düzenlemesi bu değeri DEĞİŞTİRMEZ.
    ups = _as_float(it.get("unit_price_snapshot"), 0)
    if ups > 0:
        return ups
    pr = _as_float(it.get("price"), 0)
    if pr > 0:
        return pr
    # 4) SON ÇARE: yalnızca hiç snapshot'ı olmayan çok eski siparişlerde güncel katalog
    if not has_order_snapshot:
        pid = it.get("id") or it.get("product_id")
        if pid is not None and pid in cost_map:
            cp = _as_float(cost_map.get(pid), 0)
            if cp > 0:
                return cp
    return 0.0


def _supplier_items_of_order(order: dict, target_norm: str, cost_map: dict):
    """Siparişin hedef tedarikçiye ait kalemleri, alt-toplamı ve iade bilgisi.

    ÖNEMLİ: Tedarikçi (per-supplier) logunda tutarlar TEDARİKÇİNİN KENDİ girdiği
    alış (tedarik) fiyatı üzerinden hesaplanır — müşteri satış fiyatı değil.

    Dönüş: (sup_items, sup_subtotal, sup_refunded_from_items, item_level)
      * sup_refunded_from_items: kalem-bazlı iade toplamı (yeni sistem).
      * item_level: iade bilgisi kalem bazlı mı (True) yoksa eski kısmi mi (False).
    """
    refunded_flags, item_level = _order_item_refunds(order)
    items = order.get("items") or []
    sup_items = []
    sup_subtotal = 0.0
    sup_refunded_items = 0.0
    for idx, it in enumerate(items):
        sg = _afro_norm(it.get("supplier_group_snapshot") or "")
        if sg != target_norm:
            continue
        qty = _as_float(it.get("qty", it.get("quantity", 0)), 0)
        unit_cost = _item_unit_cost(it, cost_map)      # tedarikçinin kendi birim fiyatı
        lt = round(unit_cost * qty, 2)                 # tedarikçi tutarı
        is_ref = bool(refunded_flags[idx]) if idx < len(refunded_flags) else False
        sup_items.append({
            "name": it.get("name") or it.get("product_name_snapshot") or "Ürün",
            "qty": qty,
            "unit": it.get("unit") or it.get("unit_snapshot") or "",
            "price": unit_cost,
            "line_total": lt,
            "category": it.get("category_snapshot") or "",
            "refunded": is_ref,
        })
        sup_subtotal += lt
        if is_ref:
            sup_refunded_items += lt
    return sup_items, round(sup_subtotal, 2), round(sup_refunded_items, 2), item_level


@app.get("/api/user/me")
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


@app.get("/api/supplier/my-sales")
async def supplier_my_sales(current_supplier: dict = Depends(get_current_supplier)):
    """Tedarikçinin kendi satış logu (tezgah fiyatından hesaplanan).
    
    Tedarikçi SADECE kendi ürünlerinin satışını görür:
    - Tarih, saat, ürün, miktar, birim fiyat (tezgah), tutar
    - Müşteri bilgisi GİZLİ (ad, telefon, adres gösterilmez)
    - Sipariş numarası GİZLİ
    - Satış fiyatı ve kâr marjı GİZLİ
    """
    supplier_group = get_user_supplier_group(current_supplier)
    if not supplier_group:
        raise HTTPException(status_code=403, detail="Tedarikçi grubu tanımlı değil")
    
    target = _afro_norm(supplier_group)
    orders = await db.transactions.find(
        {"order_status": {"$in": list(SUPPLIER_SOLD_STATUSES)}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(5000)

    cost_map = await _build_cost_map()
    log = []
    total_sold = 0.0
    total_refunded = 0.0

    for o in orders:
        sup_items, sup_subtotal, sup_ref_items, item_level = _supplier_items_of_order(o, target, cost_map)
        if not sup_items:
            continue
        total_sold += sup_subtotal

        refunded_amount = 0.0
        refund_label = ""
        if item_level:
            refunded_amount = round(sup_ref_items, 2)
            if refunded_amount > 0:
                refund_label = "İade edildi" if refunded_amount >= sup_subtotal - 0.001 else "Kısmi iade"
        else:
            full, partial, ramt = _order_refund_info(o)
            order_subtotal = _as_float(o.get("subtotal"), 0) or _as_float(o.get("amount"), 0)
            if partial and ramt > 0 and order_subtotal > 0:
                share = sup_subtotal / order_subtotal
                refunded_amount = round(min(sup_subtotal, ramt * share), 2)
                refund_label = "Kısmi iade"
        total_refunded += refunded_amount

        # Tedarikçiye döndürülen veri: müşteri/sipariş bilgisi GİZLİ
        log.append({
            "date": o.get("delivered_at") or o.get("created_at"),
            "delivery_type": o.get("delivery_type") or o.get("delivery_method") or "",
            "items": sup_items,
            "subtotal": sup_subtotal,
            "refunded": bool(refunded_amount > 0),
            "refunded_amount": round(refunded_amount, 2),
            "refund_label": refund_label,
            "net": round(sup_subtotal - refunded_amount, 2),
        })

    return {
        "supplier": supplier_group,
        "order_count": len(log),
        "total_sold": round(total_sold, 2),
        "total_refunded": round(total_refunded, 2),
        "net_total": round(total_sold - total_refunded, 2),
        "log": log,
    }


@app.get("/api/admin/supplier-sales")
async def admin_supplier_sales(supplier: str, current_admin: dict = Depends(get_current_admin)):
    """Tek bir tedarikçinin satış logu + toplam tutar (iadeler düşülmüş)."""
    target = _afro_norm(supplier)
    if not target:
        raise HTTPException(status_code=400, detail="Tedarikçi adı gerekli")

    # Sadece satılan (teslim edilen) siparişler
    orders = await db.transactions.find(
        {"order_status": {"$in": list(SUPPLIER_SOLD_STATUSES)}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(5000)

    cost_map = await _build_cost_map()

    log = []
    total_sold = 0.0        # iade öncesi brüt (bu tedarikçinin payı)
    total_refunded = 0.0    # bu tedarikçiye düşen iade tutarı
    order_count = 0

    for o in orders:
        sup_items, sup_subtotal, sup_ref_items, item_level = _supplier_items_of_order(o, target, cost_map)
        # Kalem varsa göster (alış fiyatı girilmemişse tutar 0 görünür, satış yine listelenir)
        if not sup_items:
            continue
        order_count += 1
        total_sold += sup_subtotal

        refunded_amount = 0.0
        refund_label = ""
        if item_level:
            # YENİ sistem: iade edilen ürünlerin tutarı birebir düşülür
            refunded_amount = round(sup_ref_items, 2)
            if refunded_amount > 0:
                refund_label = "İade edildi" if refunded_amount >= sup_subtotal - 0.001 else "Kısmi iade"
        else:
            # ESKİ kısmi iade: orantısal (pay bazlı) fallback
            full, partial, ramt = _order_refund_info(o)
            order_subtotal = _as_float(o.get("subtotal"), 0) or _as_float(o.get("amount"), 0)
            if partial and ramt > 0 and order_subtotal > 0:
                share = sup_subtotal / order_subtotal
                refunded_amount = round(min(sup_subtotal, ramt * share), 2)
                refund_label = "Kısmi iade"
        total_refunded += refunded_amount

        log.append({
            "tx_id": o.get("tx_id"),
            "date": o.get("delivered_at") or o.get("created_at"),
            "customer": o.get("user_name") or "Müşteri",
            "customer_phone": o.get("user_phone") or "",
            "delivery_type": o.get("delivery_type") or o.get("delivery_method") or "",
            "items": sup_items,
            "subtotal": sup_subtotal,           # bu tedarikçinin bu siparişteki brüt tutarı
            "refunded": bool(refunded_amount > 0),
            "refunded_amount": round(refunded_amount, 2),
            "refund_label": refund_label,
            "net": round(sup_subtotal - refunded_amount, 2),
        })

    return {
        "supplier": supplier,
        "order_count": order_count,
        "total_sold": round(total_sold, 2),         # iade öncesi brüt toplam
        "total_refunded": round(total_refunded, 2), # toplam iade
        "net_total": round(total_sold - total_refunded, 2),  # net (gösterilecek) tutar
        "log": log,
    }


@app.get("/api/admin/supplier-sales-summary")
async def admin_supplier_sales_summary(current_admin: dict = Depends(get_current_admin)):
    """Tüm tedarikçiler için özet: net toplam, brüt, iade ve sipariş sayısı.
    Tedarikçi listesinde her satırın yanında tutarı göstermek için tek çağrı."""
    orders = await db.transactions.find(
        {"order_status": {"$in": list(SUPPLIER_SOLD_STATUSES)}},
        {"_id": 0},
    ).to_list(5000)

    cost_map = await _build_cost_map()

    # supplier_norm -> aggregate
    agg = {}
    for o in orders:
        refunded_flags, item_level = _order_item_refunds(o)
        full, partial, ramt = _order_refund_info(o)
        order_subtotal = _as_float(o.get("subtotal"), 0) or _as_float(o.get("amount"), 0)
        # Bu siparişteki tedarikçi bazlı alt-toplamlar + kalem-bazlı iade
        # (tutarlar tedarikçinin kendi alış/tedarik fiyatı üzerinden)
        by_sup = {}
        for idx, it in enumerate(o.get("items") or []):
            raw_sg = it.get("supplier_group_snapshot") or ""
            key = _afro_norm(raw_sg)
            if not key:
                continue
            qty = _as_float(it.get("qty", it.get("quantity", 0)), 0)
            lt = round(_item_unit_cost(it, cost_map) * qty, 2)
            if key not in by_sup:
                by_sup[key] = {"display": raw_sg, "subtotal": 0.0, "ref_items": 0.0}
            by_sup[key]["subtotal"] += lt
            if item_level and idx < len(refunded_flags) and refunded_flags[idx]:
                by_sup[key]["ref_items"] += lt
        for key, info in by_sup.items():
            sub = round(info["subtotal"], 2)
            if sub <= 0:
                continue
            if item_level:
                # YENİ sistem: iade edilen ürünlerin tutarı birebir düşülür
                refunded = round(info["ref_items"], 2)
            elif partial and ramt > 0 and order_subtotal > 0:
                # ESKİ kısmi iade: orantısal fallback
                refunded = round(min(sub, ramt * (sub / order_subtotal)), 2)
            else:
                refunded = 0.0
            if key not in agg:
                agg[key] = {"supplier": info["display"], "total_sold": 0.0,
                            "total_refunded": 0.0, "order_count": 0}
            agg[key]["total_sold"] += sub
            agg[key]["total_refunded"] += refunded
            agg[key]["order_count"] += 1

    result = {}
    for key, v in agg.items():
        result[v["supplier"]] = {
            "total_sold": round(v["total_sold"], 2),
            "total_refunded": round(v["total_refunded"], 2),
            "net_total": round(v["total_sold"] - v["total_refunded"], 2),
            "order_count": v["order_count"],
        }
    return result


@app.get("/api/admin/all-supplier-sales")
async def admin_all_supplier_sales(current_admin: dict = Depends(get_current_admin)):
    """TÜM tedarikçilerin satış logu (tek çağrı).

    Her satış girdisi tedarikçi adı + tarih ile etiketlenir; böylece frontend:
      * tarihe göre filtreleyebilir,
      * tedarikçiye göre gruplayabilir,
      * genel (tüm tedarikçiler) toplamı hesaplayabilir.
    Mantık `supplier-sales` ile aynıdır; fark: tek tedarikçiye kısıtlamak yerine
    her siparişteki HER tedarikçi grubu için ayrı bir log girdisi üretir.
    """
    orders = await db.transactions.find(
        {"order_status": {"$in": list(SUPPLIER_SOLD_STATUSES)}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(5000)

    cost_map = await _build_cost_map()

    log = []
    suppliers_set = set()
    grand_sold = 0.0
    grand_refunded = 0.0
    grand_profit = 0.0        # toplam KÂR (yalnızca yöneticide gösterilir)
    unknown_cost_items = 0    # alış (tedarik) fiyatı bilinmeyen kalem sayısı

    for o in orders:
        refunded_flags, item_level = _order_item_refunds(o)
        full, partial, ramt = _order_refund_info(o)
        order_subtotal = _as_float(o.get("subtotal"), 0) or _as_float(o.get("amount"), 0)

        # Bu siparişteki tedarikçi grubu -> kalemler
        by_sup = {}
        for idx, it in enumerate(o.get("items") or []):
            raw_sg = it.get("supplier_group_snapshot") or ""
            key = _afro_norm(raw_sg)
            if not key:
                continue
            lt = _as_float(it.get("line_total", it.get("total_price")), 0)
            is_ref = bool(item_level and idx < len(refunded_flags) and refunded_flags[idx])
            qty = _as_float(it.get("qty", it.get("quantity", 0)), 0)
            unit_cost = _item_unit_cost(it, cost_map)          # alış (tedarik) birim fiyatı
            cost_total = round(unit_cost * qty, 2)             # maliyet
            item_profit = round(lt - cost_total, 2)            # kâr (satış - maliyet)
            cost_known = unit_cost > 0
            if not cost_known:
                unknown_cost_items += 1
            if key not in by_sup:
                by_sup[key] = {"display": raw_sg, "items": [], "subtotal": 0.0,
                               "ref_items": 0.0, "profit": 0.0}
            by_sup[key]["items"].append({
                "name": it.get("name") or it.get("product_name_snapshot") or "Ürün",
                "qty": qty,
                "unit": it.get("unit") or it.get("unit_snapshot") or "",
                "price": _as_float(it.get("price", it.get("unit_price_snapshot")), 0),
                "line_total": round(lt, 2),
                "cost": cost_total,
                "profit": item_profit,
                "cost_known": cost_known,
                "category": it.get("category_snapshot") or "",
                "refunded": is_ref,
            })
            by_sup[key]["subtotal"] += lt
            if is_ref:
                by_sup[key]["ref_items"] += lt
            else:
                # Kâr yalnızca iade EDİLMEMİŞ kalemler için sayılır
                by_sup[key]["profit"] += item_profit

        for key, info in by_sup.items():
            sub = round(info["subtotal"], 2)
            if sub <= 0:
                continue
            refunded_amount = 0.0
            refund_label = ""
            if item_level:
                # YENİ sistem: iade edilen ürünlerin tutarı birebir düşülür
                refunded_amount = round(info["ref_items"], 2)
                if refunded_amount > 0:
                    refund_label = "İade edildi" if refunded_amount >= sub - 0.001 else "Kısmi iade"
            elif partial and ramt > 0 and order_subtotal > 0:
                # ESKİ kısmi iade: orantısal fallback
                refunded_amount = round(min(sub, ramt * (sub / order_subtotal)), 2)
                refund_label = "Kısmi iade"

            order_profit = round(info["profit"], 2)
            suppliers_set.add(info["display"])
            grand_sold += sub
            grand_refunded += refunded_amount
            grand_profit += order_profit

            log.append({
                "tx_id": o.get("tx_id"),
                "supplier": info["display"],
                "date": o.get("delivered_at") or o.get("created_at"),
                "customer": o.get("user_name") or "Müşteri",
                "customer_phone": o.get("user_phone") or "",
                "delivery_type": o.get("delivery_type") or o.get("delivery_method") or "",
                "items": info["items"],
                "subtotal": sub,
                "refunded": bool(refunded_amount > 0),
                "refunded_amount": round(refunded_amount, 2),
                "refund_label": refund_label,
                "net": round(sub - refunded_amount, 2),
                "profit": order_profit,
            })

    return {
        "suppliers": sorted(suppliers_set),
        "order_count": len(log),
        "grand_sold": round(grand_sold, 2),
        "grand_refunded": round(grand_refunded, 2),
        "grand_net": round(grand_sold - grand_refunded, 2),
        "grand_profit": round(grand_profit, 2),
        "unknown_cost_items": unknown_cost_items,
        "log": log,
    }


# =====================================================================
# MADDE 6 — ADMIN MANUEL FİYAT KİLİDİ (aç / kapa)
# Tedarikçi supplier_price değiştirince ürün o gün için otomatik kilitlenir.
# OTOMATİK gece-yarısı cron YOKtur; yönetici kilidi manuel açar/kapatır.
# =====================================================================
from zoneinfo import ZoneInfo as _AFRO_ZI
_AFRO_IST_TZ = _AFRO_ZI("Europe/Istanbul")


def _afro_end_of_today_utc():
    now_ist = datetime.now(_AFRO_IST_TZ)
    eod = now_ist.replace(hour=23, minute=59, second=59, microsecond=999999)
    return eod.astimezone(timezone.utc)


def _afro_ist_day_key(val):
    """Bir tarih/datetime/ISO değerinden İstanbul saatine göre YYYY-MM-DD anahtarı."""
    if not val:
        return ""
    dt = val
    if isinstance(val, str):
        try:
            dt = datetime.fromisoformat(val.replace("Z", "+00:00"))
        except Exception:
            return val[:10] if len(val) >= 10 else ""
    try:
        dt = to_aware(dt)
        return dt.astimezone(_AFRO_IST_TZ).strftime("%Y-%m-%d")
    except Exception:
        return ""


async def _afro_set_supplier_lock(supplier_group, lock: bool):
    target = _afro_norm(supplier_group or "")
    if not target:
        raise HTTPException(status_code=400, detail="Tedarikçi belirtilmedi")
    prods = await db.products.find({}, {"_id": 0, "id": 1, "supplier_group": 1}).to_list(5000)
    ids = [p["id"] for p in prods
           if _afro_norm(p.get("supplier_group") or "") == target and p.get("id") is not None]
    val = _afro_end_of_today_utc() if lock else None
    if ids:
        await db.products.update_many({"id": {"$in": ids}},
                                      {"$set": {"supplier_price_locked_until": val}})
    return len(ids)


@app.get("/api/admin/supplier/{supplier_group}/lock-status")
async def admin_supplier_lock_status(supplier_group: str, current_admin: dict = Depends(get_current_admin)):
    _yonetici_only(current_admin)
    target = _afro_norm(supplier_group or "")
    prods = await db.products.find(
        {}, {"_id": 0, "supplier_group": 1, "supplier_price_locked_until": 1}
    ).to_list(5000)
    total = 0
    locked = 0
    now = now_utc()
    for p in prods:
        if _afro_norm(p.get("supplier_group") or "") != target:
            continue
        total += 1
        lu = p.get("supplier_price_locked_until")
        if isinstance(lu, str):
            try:
                lu = datetime.fromisoformat(lu.replace("Z", "+00:00"))
            except Exception:
                lu = None
        if lu and to_aware(lu) > now:
            locked += 1
    return {"supplier": supplier_group, "total": total, "locked": locked,
            "is_locked": locked > 0}


@app.post("/api/admin/supplier/{supplier_group}/unlock-prices")
async def admin_unlock_supplier_prices(supplier_group: str, current_admin: dict = Depends(get_current_admin), request: Request = None):
    _yonetici_only(current_admin)
    n = await _afro_set_supplier_lock(supplier_group, False)
    try:
        await db.admin_logs.insert_one({
            "id": new_id("log"), "log_type": "price_lock_override",
            "action": "unlock_prices", "supplier_group": supplier_group,
            "affected": n, "admin_id": current_admin.get("user_id"),
            "created_at": now_utc(),
        })
    except Exception:
        pass
    await _insert_log("log_admin", {"admin_id": current_admin["user_id"], "admin_name": current_admin.get("name",""), "action": "supplier_price_lock_override", "target_type": "supplier", "target_id": supplier_group, "change_details": {"field": "price_lock", "old_value": "locked", "new_value": "unlocked"}, "admin_note": ""}, request)
    return {"success": True, "supplier": supplier_group, "affected": n, "locked": False}


@app.post("/api/admin/supplier/{supplier_group}/lock-prices")
async def admin_lock_supplier_prices(supplier_group: str, current_admin: dict = Depends(get_current_admin), request: Request = None):
    _yonetici_only(current_admin)
    n = await _afro_set_supplier_lock(supplier_group, True)
    try:
        await db.admin_logs.insert_one({
            "id": new_id("log"), "log_type": "price_lock_override",
            "action": "lock_prices", "supplier_group": supplier_group,
            "affected": n, "admin_id": current_admin.get("user_id"),
            "created_at": now_utc(),
        })
    except Exception:
        pass
    await _insert_log("log_admin", {"admin_id": current_admin["user_id"], "admin_name": current_admin.get("name",""), "action": "supplier_price_lock_override", "target_type": "supplier", "target_id": supplier_group, "change_details": {"field": "price_lock", "old_value": "unlocked", "new_value": "locked"}, "admin_note": ""}, request)
    return {"success": True, "supplier": supplier_group, "affected": n, "locked": True}


# =====================================================================
# MADDE 8 — TEDARİKÇİ ÖDEME TAKİP SİSTEMİ
# Günlük tedarikçi bazlı hesaplaşma: tezgah (alış) fiyatından net tutar,
# iade kesintisi, ödendi/bekliyor durumu. Ödeme işaretleri
# `supplier_payments` koleksiyonunda (supplier_key + date) tutulur.
# =====================================================================
def _afro_tr_money(n) -> str:
    """1887.5 -> '1.887,50' (TR biçim, ASCII)."""
    try:
        s = f"{float(n):,.2f}"  # 1,887.50
    except Exception:
        return str(n)
    return s.replace(",", "X").replace(".", ",").replace("X", ".")


def _afro_date_tr(date_key: str) -> str:
    """YYYY-MM-DD -> dd.mm.yyyy"""
    try:
        y, m, d = (date_key or "").split("-")
        return f"{d}.{m}.{y}"
    except Exception:
        return date_key or ""


async def _afro_supplier_phones(supplier_key: str):
    """supplier_key (normalize) için esnaf kullanıcıların telefonlarını döndür.
    Dönüş: [{'phone':..., 'name':..., 'user_id':...}, ...]"""
    out = []
    seen = set()
    async for u in db.users.find(
        {"role": {"$in": list(SUPPLIER_ROLES)}},
        {"_id": 0, "phone": 1, "supplier_group": 1, "supplier_name": 1, "name": 1, "user_id": 1},
    ):
        sg = u.get("supplier_group") or u.get("supplier_name") or ""
        if _afro_norm(sg) != supplier_key:
            continue
        ph = (u.get("phone") or "").strip()
        if not ph or ph in seen:
            continue
        seen.add(ph)
        out.append({"phone": ph, "name": u.get("name") or "", "user_id": u.get("user_id")})
    return out


async def _afro_supplier_settlements_for_day(date_key):
    """Verilen gün (YYYY-MM-DD, İstanbul) için tedarikçi bazlı özet.
    Dönüş: { norm_key: {display, gross, refund, items:[...] } }"""
    orders = await db.transactions.find(
        {"order_status": {"$in": list(SUPPLIER_SOLD_STATUSES)}}, {"_id": 0}
    ).sort("created_at", -1).to_list(5000)
    cost_map = await _build_cost_map()
    agg = {}
    for o in orders:
        odate = o.get("delivered_at") or o.get("created_at")
        if _afro_ist_day_key(odate) != date_key:
            continue
        sgs = {}
        for it in (o.get("items") or []):
            k = _afro_norm(it.get("supplier_group_snapshot") or "")
            if k and k not in sgs:
                sgs[k] = it.get("supplier_group_snapshot") or ""
        for k, disp in sgs.items():
            sup_items, sub, ref_items, item_level = _supplier_items_of_order(o, k, cost_map)
            if not sup_items:
                continue
            refunded_amount = 0.0
            if item_level:
                refunded_amount = round(ref_items, 2)
            else:
                full, partial, ramt = _order_refund_info(o)
                osub = _as_float(o.get("subtotal"), 0) or _as_float(o.get("amount"), 0)
                if partial and ramt > 0 and osub > 0:
                    refunded_amount = round(min(sub, ramt * (sub / osub)), 2)
            if k not in agg:
                agg[k] = {"display": disp or k, "gross": 0.0, "refund": 0.0, "items": []}
            agg[k]["gross"] += sub
            agg[k]["refund"] += refunded_amount
            agg[k]["items"].extend(sup_items)
    return agg


@app.get("/api/admin/supplier-payments")
async def admin_supplier_payments(date: Optional[str] = None,
                                  current_admin: dict = Depends(get_current_admin)):
    """Belirli bir gün için tedarikçi bazlı ödeme tablosu (yönetici)."""
    _yonetici_only(current_admin)
    date_key = (date or "").strip() or _afro_ist_day_key(now_utc())
    agg = await _afro_supplier_settlements_for_day(date_key)
    markers = {}
    async for d in db.supplier_payments.find({"date": date_key}, {"_id": 0}):
        markers[d.get("supplier_key")] = d
    rows = []
    tot_gross = tot_ref = tot_net = 0.0
    for k, info in agg.items():
        gross = round(info["gross"], 2)
        refund = round(info["refund"], 2)
        net = round(gross - refund, 2)
        mk = markers.get(k) or {}
        rows.append({
            "supplier_key": k,
            "supplier": info["display"],
            "gross": gross,
            "refund": refund,
            "net": net,
            "status": mk.get("status") or "pending",
            "paid_at": mk.get("paid_at"),
            "note": mk.get("note") or "",
            "confirm_status": mk.get("confirm_status") or "pending",
            "confirmed_at": mk.get("confirmed_at"),
            "confirmed_by_phone": mk.get("confirmed_by_phone"),
            "confirm_sms_sent": bool(mk.get("confirm_sms_sent")),
            "items": info["items"],
        })
        tot_gross += gross
        tot_ref += refund
        tot_net += net
    rows.sort(key=lambda r: -r["net"])
    return {"date": date_key, "rows": rows,
            "total_gross": round(tot_gross, 2),
            "total_refund": round(tot_ref, 2),
            "total_net": round(tot_net, 2)}


@app.post("/api/admin/supplier-payments/mark-paid")
async def admin_supplier_payment_mark_paid(payload: AfroSupplierPayMark,
                                           current_admin: dict = Depends(get_current_admin), request: Request = None):
    _yonetici_only(current_admin)
    key = _afro_norm(payload.supplier_group or "")
    if not key or not (payload.date or "").strip():
        raise HTTPException(status_code=400, detail="Tedarikçi ve tarih gerekli")
    agg = await _afro_supplier_settlements_for_day(payload.date)
    info = agg.get(key) or {}
    net = round(_as_float(info.get("gross"), 0) - _as_float(info.get("refund"), 0), 2) if info else 0.0
    # Çift taraflı mutabakat: 6 haneli onay kodu üret + tedarikçiye SMS gönder
    code = _generate_sms_code()
    code_expires = now_utc() + timedelta(days=7)
    doc = {
        "supplier_key": key,
        "supplier": info.get("display") or payload.supplier_group,
        "date": payload.date,
        "status": "paid",
        "paid_at": now_utc(),
        "note": (payload.note or ""),
        "net_snapshot": net,
        "admin_id": current_admin.get("user_id"),
        # onay akışı
        "confirm_code": enc_str(code),
        "confirm_code_expires_at": code_expires,
        "confirm_status": "pending",
        "confirm_attempts": 0,
        "confirmed_at": None,
        "confirmed_by_phone": None,
        "confirmed_by_user_id": None,
    }
    await db.supplier_payments.update_one(
        {"supplier_key": key, "date": payload.date}, {"$set": doc}, upsert=True
    )
    # SMS gönder (tedarikçi telefon(lar)ına)
    phones = await _afro_supplier_phones(key)
    date_tr = _afro_date_tr(payload.date)
    money = _afro_tr_money(net)
    message = (
        "Afro Gida\n"
        f"{date_tr} tarihli {money} TL odemeniz yapildi.\n"
        f"Onay kodu: {code}\n"
        "Satislarim panelinden bu kodu girerek odemeyi onaylayin."
    )
    sms_ok = False
    for p in phones:
        try:
            if send_sms_verimor(p["phone"], message):
                sms_ok = True
        except Exception as exc:
            logger.error("[SUPPLIER-PAY] SMS hatasi %s: %s", p.get("phone"), exc)
    await db.supplier_payments.update_one(
        {"supplier_key": key, "date": payload.date},
        {"$set": {"confirm_sms_sent": bool(sms_ok), "confirm_sms_at": now_utc()}},
    )
    await _insert_log("log_admin", {"admin_id": current_admin["user_id"], "admin_name": current_admin.get("name",""), "action": "supplier_payment_marked", "target_type": "payment", "target_id": f"{key}_{payload.date}", "change_details": {"field": "payment_status", "old_value": "unpaid", "new_value": "paid", "sms_sent": bool(sms_ok), "phones": len(phones)}, "admin_note": payload.note or ""}, request)
    return {"success": True, "status": "paid", "net": net,
            "sms_sent": bool(sms_ok), "phone_count": len(phones)}


@app.post("/api/admin/supplier-payments/mark-unpaid")
async def admin_supplier_payment_mark_unpaid(payload: AfroSupplierPayMark,
                                             current_admin: dict = Depends(get_current_admin), request: Request = None):
    _yonetici_only(current_admin)
    key = _afro_norm(payload.supplier_group or "")
    if not key or not (payload.date or "").strip():
        raise HTTPException(status_code=400, detail="Tedarikçi ve tarih gerekli")
    await db.supplier_payments.update_one(
        {"supplier_key": key, "date": payload.date},
        {"$set": {"status": "pending", "unpaid_at": now_utc(),
                  "admin_id": current_admin.get("user_id"),
                  "confirm_status": "pending", "confirm_code": None,
                  "confirm_code_expires_at": None, "confirmed_at": None,
                  "confirmed_by_phone": None, "confirmed_by_user_id": None}},
        upsert=True,
    )
    await _insert_log("log_admin", {"admin_id": current_admin["user_id"], "admin_name": current_admin.get("name",""), "action": "supplier_payment_unmarked", "target_type": "payment", "target_id": f"{key}_{payload.date}", "change_details": {"field": "payment_status", "old_value": "paid", "new_value": "pending"}, "admin_note": ""}, request)
    return {"success": True, "status": "pending"}


@app.post("/api/supplier/my-payments/confirm")
async def supplier_confirm_payment(payload: AfroSupplierPayConfirm,
                                   current_supplier: dict = Depends(get_current_supplier),
                                   request: Request = None):
    """Tedarikçi, SMS ile gelen onay kodunu girerek ödemeyi onaylar.
    Bu, çift taraflı mutabakatı (idari 'ödendi' + tedarikçi 'aldım') oluşturur."""
    sg = get_user_supplier_group(current_supplier)
    if not sg:
        raise HTTPException(status_code=403, detail="Tedarikçi grubu tanımlı değil")
    key = _afro_norm(sg)
    date_key = (payload.date or "").strip()
    code = (payload.code or "").strip()
    if not date_key or not code:
        raise HTTPException(status_code=400, detail="Tarih ve onay kodu gerekli")
    mk = await db.supplier_payments.find_one({"supplier_key": key, "date": date_key}, {"_id": 0})
    if not mk or mk.get("status") != "paid":
        raise HTTPException(status_code=404, detail="Bu tarih için işaretlenmiş bir ödeme bulunamadı")
    if mk.get("confirm_status") == "confirmed":
        return {"success": True, "already": True, "confirm_status": "confirmed",
                "confirmed_at": mk.get("confirmed_at")}
    if not mk.get("confirm_code"):
        raise HTTPException(status_code=400, detail="Onay kodu bulunamadı, lütfen yöneticiden yeni kod isteyin")
    attempts = int(mk.get("confirm_attempts") or 0)
    if attempts >= 5:
        raise HTTPException(status_code=429, detail="Çok fazla hatalı deneme. Lütfen yöneticiden yeni kod isteyin")
    exp = mk.get("confirm_code_expires_at")
    try:
        if exp and now_utc() > exp:
            raise HTTPException(status_code=400, detail="Onay kodunun süresi dolmuş, yöneticiden yeni kod isteyin")
    except HTTPException:
        raise
    except Exception:
        pass
    if not hmac.compare_digest(str(code), str(dec_str(mk.get("confirm_code")))):
        await db.supplier_payments.update_one(
            {"supplier_key": key, "date": date_key},
            {"$inc": {"confirm_attempts": 1}},
        )
        raise HTTPException(status_code=400, detail="Onay kodu hatalı")
    phone = (current_supplier.get("phone") or "").strip()
    await db.supplier_payments.update_one(
        {"supplier_key": key, "date": date_key},
        {"$set": {"confirm_status": "confirmed", "confirmed_at": now_utc(),
                  "confirmed_by_phone": phone,
                  "confirmed_by_user_id": current_supplier.get("user_id")}},
    )
    await _insert_log("log_admin", {"admin_id": current_supplier.get("user_id"), "admin_name": current_supplier.get("name",""), "action": "supplier_payment_confirmed", "target_type": "payment", "target_id": f"{key}_{date_key}", "change_details": {"field": "confirm_status", "old_value": "pending", "new_value": "confirmed", "confirmed_by_phone": phone}, "admin_note": ""}, request)
    return {"success": True, "confirm_status": "confirmed", "confirmed_at": now_utc()}


@app.post("/api/admin/supplier-payments/resend-code")
async def admin_supplier_payment_resend_code(payload: AfroSupplierPayMark,
                                             current_admin: dict = Depends(get_current_admin), request: Request = None):
    """Yeni onay kodu üretip tedarikçiye tekrar SMS gönderir (ödeme zaten 'paid' olmalı)."""
    _yonetici_only(current_admin)
    key = _afro_norm(payload.supplier_group or "")
    if not key or not (payload.date or "").strip():
        raise HTTPException(status_code=400, detail="Tedarikçi ve tarih gerekli")
    mk = await db.supplier_payments.find_one({"supplier_key": key, "date": payload.date}, {"_id": 0})
    if not mk or mk.get("status") != "paid":
        raise HTTPException(status_code=400, detail="Önce ödemeyi 'Ödendi' olarak işaretleyin")
    if mk.get("confirm_status") == "confirmed":
        raise HTTPException(status_code=400, detail="Ödeme zaten tedarikçi tarafından onaylanmış")
    code = _generate_sms_code()
    net = _as_float(mk.get("net_snapshot"), 0)
    await db.supplier_payments.update_one(
        {"supplier_key": key, "date": payload.date},
        {"$set": {"confirm_code": enc_str(code), "confirm_code_expires_at": now_utc() + timedelta(days=7),
                  "confirm_status": "pending", "confirm_attempts": 0}},
    )
    phones = await _afro_supplier_phones(key)
    message = (
        "Afro Gida\n"
        f"{_afro_date_tr(payload.date)} tarihli {_afro_tr_money(net)} TL odemeniz yapildi.\n"
        f"Onay kodu: {code}\n"
        "Satislarim panelinden bu kodu girerek odemeyi onaylayin."
    )
    sms_ok = False
    for p in phones:
        try:
            if send_sms_verimor(p["phone"], message):
                sms_ok = True
        except Exception as exc:
            logger.error("[SUPPLIER-PAY] resend SMS hatasi %s: %s", p.get("phone"), exc)
    await db.supplier_payments.update_one(
        {"supplier_key": key, "date": payload.date},
        {"$set": {"confirm_sms_sent": bool(sms_ok), "confirm_sms_at": now_utc()}},
    )
    await _insert_log("log_admin", {"admin_id": current_admin["user_id"], "admin_name": current_admin.get("name",""), "action": "supplier_payment_code_resent", "target_type": "payment", "target_id": f"{key}_{payload.date}", "change_details": {"sms_sent": bool(sms_ok), "phones": len(phones)}, "admin_note": ""}, request)
    return {"success": True, "sms_sent": bool(sms_ok), "phone_count": len(phones)}


@app.get("/api/supplier/my-payments")
async def supplier_my_payments(current_supplier: dict = Depends(get_current_supplier)):
    """Tedarikçinin kendi günlük ödeme durumu (✅ Ödendi / ⏳ Bekliyor).
    Tezgah fiyatından net tutar gösterilir; kâr/müşteri bilgisi YOKtur."""
    sg = get_user_supplier_group(current_supplier)
    if not sg:
        raise HTTPException(status_code=403, detail="Tedarikçi grubu tanımlı değil")
    key = _afro_norm(sg)
    orders = await db.transactions.find(
        {"order_status": {"$in": list(SUPPLIER_SOLD_STATUSES)}}, {"_id": 0}
    ).sort("created_at", -1).to_list(5000)
    cost_map = await _build_cost_map()
    days = {}
    for o in orders:
        sup_items, sub, ref_items, item_level = _supplier_items_of_order(o, key, cost_map)
        if not sup_items:
            continue
        dk = _afro_ist_day_key(o.get("delivered_at") or o.get("created_at"))
        if not dk:
            continue
        refunded_amount = 0.0
        if item_level:
            refunded_amount = round(ref_items, 2)
        else:
            full, partial, ramt = _order_refund_info(o)
            osub = _as_float(o.get("subtotal"), 0) or _as_float(o.get("amount"), 0)
            if partial and ramt > 0 and osub > 0:
                refunded_amount = round(min(sub, ramt * (sub / osub)), 2)
        d = days.setdefault(dk, {"gross": 0.0, "refund": 0.0})
        d["gross"] += sub
        d["refund"] += refunded_amount
    markers = {}
    async for m in db.supplier_payments.find({"supplier_key": key}, {"_id": 0}):
        markers[m.get("date")] = m
    rows = []
    for dk in sorted(days.keys(), reverse=True):
        gross = round(days[dk]["gross"], 2)
        refund = round(days[dk]["refund"], 2)
        net = round(gross - refund, 2)
        mk = markers.get(dk) or {}
        rows.append({"date": dk, "gross": gross, "refund": refund, "net": net,
                     "status": mk.get("status") or "pending", "paid_at": mk.get("paid_at"),
                     "confirm_status": mk.get("confirm_status") or "pending",
                     "confirmed_at": mk.get("confirmed_at"),
                     "confirm_sms_sent": bool(mk.get("confirm_sms_sent"))})
    total_pending = round(sum(r["net"] for r in rows if r["status"] != "paid"), 2)
    total_paid = round(sum(r["net"] for r in rows if r["status"] == "paid"), 2)
    return {"supplier": sg, "rows": rows,
            "total_pending": total_pending, "total_paid": total_paid}

# =====================================================================
# MADDE 6 & 8 EKLERİ SONU
# =====================================================================



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


@app.put("/api/courier/toggle-online")
async def courier_toggle_online(payload: dict, current: dict = Depends(get_current_courier)):
    """Kurye kendi online/offline durumunu değiştirir."""
    is_online = bool(payload.get("is_online", True))
    await db.users.update_one(
        {"user_id": current.get("user_id")},
        {"$set": {"courier_is_online": is_online, "updated_at": now_utc()}}
    )
    return {"ok": True, "is_online": is_online}


@app.get("/api/courier/stats")
async def courier_stats(date: str = "", current: dict = Depends(get_current_courier)):
    """Kurye kendi istatistiklerini görür (seçili gün + toplam)."""
    from datetime import timezone as _tz
    import pytz as _pytz
    TR = _pytz.timezone("Europe/Istanbul")
    if date:
        try:
            day_tr = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=TR)
        except Exception:
            raise HTTPException(status_code=400, detail="Geçersiz tarih")
    else:
        day_tr = datetime.now(TR).replace(hour=0, minute=0, second=0, microsecond=0)
    day_start = day_tr.astimezone(_tz.utc)
    # day_end: İstanbul günü 23:59:59'u UTC'ye çevir
    day_end = day_tr.replace(hour=23, minute=59, second=59, microsecond=999999).astimezone(_tz.utc)
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


app.include_router(api_router)

# ─────────────────────────────────────────────────────────────────────────────
# PUSH TOKEN KAYIT ENDPOINT
# Uygulama açılınca native taraf Expo push token'ını bu endpoint'e gönderir.
# ─────────────────────────────────────────────────────────────────────────────
@app.post("/api/push-token")
async def register_push_token(data: dict, user=Depends(get_current_user)):
    token = str(data.get("push_token") or "").strip()
    if not token or not token.startswith("ExponentPushToken"):
        raise HTTPException(status_code=400, detail="Geçerli bir ExponentPushToken gerekli")
    platform = str(data.get("platform") or "android").strip()
    await db.push_tokens.update_one(
        {"user_id": user["user_id"]},
        {"$set": {
            "user_id": user["user_id"],
            "push_token": token,
            "platform": platform,
            "updated_at": now_utc(),
        }},
        upsert=True,
    )
    return {"ok": True}






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

# ============================================================
# SUPPLIER ENDPOINTS — eklenecek blok
# ============================================================

# SupplierInput / Supplier -> models.py

# ---------- Admin: Tedarikçi listesi ----------
@app.get("/api/admin/suppliers")
async def admin_get_suppliers(current_admin: dict = Depends(get_current_staff)):
    suppliers = []
    async for s in db.suppliers.find():
        s["id"] = str(s["_id"])
        s.pop("_id", None)
        suppliers.append(s)
    return suppliers

# ---------- Admin: Yeni tedarikçi ekle ----------
@app.post("/api/admin/suppliers")
async def admin_create_supplier(data: SupplierInput, current_admin: dict = Depends(get_current_admin)):
    from datetime import datetime
    doc = data.dict()
    doc["created_at"] = datetime.utcnow().isoformat()
    result = await db.suppliers.insert_one(doc)
    doc["id"] = str(result.inserted_id)
    doc.pop("_id", None)
    return doc

# ---------- Admin: Tedarikçi güncelle ----------
@app.put("/api/admin/suppliers/{supplier_id}")
async def admin_update_supplier(supplier_id: str, data: SupplierInput, current_admin: dict = Depends(get_current_admin)):
    from bson import ObjectId
    try:
        oid = ObjectId(supplier_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Geçersiz ID")
    update_data = {k: v for k, v in data.dict().items() if v is not None}
    result = await db.suppliers.update_one({"_id": oid}, {"$set": update_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Tedarikçi bulunamadı")
    updated = await db.suppliers.find_one({"_id": oid})
    updated["id"] = str(updated["_id"])
    updated.pop("_id", None)
    return updated

# ---------- Admin: Tedarikçi sil ----------
@app.delete("/api/admin/suppliers/{supplier_id}")
async def admin_delete_supplier(supplier_id: str, current_admin: dict = Depends(get_current_admin)):
    from bson import ObjectId
    try:
        oid = ObjectId(supplier_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Geçersiz ID")
    result = await db.suppliers.delete_one({"_id": oid})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Tedarikçi bulunamadı")
    return {"message": "Tedarikçi silindi"}

# ---------- Public: Tedarikçi listesi ----------
@app.get("/api/suppliers")
async def get_suppliers():
    suppliers = []
    async for s in db.suppliers.find({"is_active": True}):
        s["id"] = str(s["_id"])
        s.pop("_id", None)
        suppliers.append(s)
    return suppliers



# ---------- Catalog Config ----------
DEFAULT_CATALOG_CONFIG = {
    "categories": ["Sebze", "Meyve", "Yeşillik", "Kök Sebzeler", "Zeytin Ürünleri"],
    "subcategories": {
        "Sebze": ["Domates", "Biber", "Salatalık", "Kabak", "Patlıcan", "Diğer"],
        "Meyve": ["Elma-Armut", "Muz", "Narenciye", "Üzüm", "Mevsim Meyveleri"],
        "Yeşillik": ["Marul", "Maydanoz", "Roka", "Dereotu-Nane", "Diğer"],
        "Kök Sebzeler": ["Patates", "Soğan", "Havuç", "Turp", "Diğer"],
        "Zeytin Ürünleri": ["Zeytin", "Zeytinyağı", "Ezme", "Diğer"],
    },
    "suppliers": ["Zeytinci"],
    "supplier_markets": {},
}

async def _read_catalog_config():
    global _CATALOG_CACHE, _CATALOG_CACHE_TS
    now = datetime.now(timezone.utc).timestamp()
    # Cache hit: return immediately (60s TTL)
    if _CATALOG_CACHE and (now - _CATALOG_CACHE_TS) < CATALOG_CACHE_TTL:
        return _CATALOG_CACHE
    # Cache miss/expired: fetch from DB
    config = await db.catalog_config.find_one({}, {"_id": 0})
    _CATALOG_CACHE = config if config else DEFAULT_CATALOG_CONFIG
    _CATALOG_CACHE_TS = now
    return _CATALOG_CACHE

async def _write_catalog_config(data: dict):
    global _CATALOG_CACHE, _CATALOG_CACHE_TS
    await db.catalog_config.update_one({}, {"$set": data}, upsert=True)
    # Invalidate cache so next read fetches fresh data
    _CATALOG_CACHE = None
    _CATALOG_CACHE_TS = 0
    return await _read_catalog_config()

@app.get("/api/catalog-config")
async def get_catalog_config():
    return await _read_catalog_config()

@app.get("/api/admin/catalog-config")
async def admin_get_catalog_config(current_admin: dict = Depends(get_current_staff)):
    return await _read_catalog_config()

@app.put("/api/catalog-config")
async def update_catalog_config(data: dict, current_admin: dict = Depends(get_current_admin)):
    return await _write_catalog_config(data)

@app.put("/api/admin/catalog-config")
async def admin_update_catalog_config(data: dict, current_admin: dict = Depends(get_current_admin)):
    return await _write_catalog_config(data)



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


@app.get("/api/courier/me")
async def courier_me(current: dict = Depends(get_current_courier)):
    return {
        "user_id": current.get("user_id"),
        "name": current.get("name"),
        "role": current.get("role"),
        "courier_market": get_user_courier_market(current),
        "courier_markets": get_user_courier_markets(current),
    }


@app.get("/api/courier/orders")
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


@app.get("/api/courier/orders/history")
async def courier_order_history(current: dict = Depends(get_current_courier)):
    """Kuryenin teslim ettiği geçmiş siparişler (yönetici: pazarındaki tüm teslimler)."""
    is_admin = current.get("role") in ("admin", "yonetici")
    q = {"delivery_type": "eve_servis", "order_status": "teslim_edildi"}
    if not is_admin:
        q["courier_id"] = current.get("user_id")
    orders = await db.transactions.find(q, {"_id": 0}).sort("delivered_at", -1).to_list(300)
    return {"orders": [_courier_order_view(o) for o in orders]}


@app.post("/api/courier/orders/{tx_id}/depart")
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


@app.post("/api/courier/orders/{tx_id}/verify-delivery-code")
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

@app.get("/api/orders")
async def compat_list_my_orders(current_user: dict = Depends(get_current_user)):
    rows = await db.transactions.find({"user_id": current_user.get("user_id")}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [_customer_order_view(o) for o in rows]

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


# --- AFRO COMPAT LOG ENDPOINTS (auto-patched) ---
# OpenClaw built-in /admin/logs sayfasi bu endpoint'leri cagiriyor.
# Compiled React bundle'in her sekmede bekledigi TAM field semasina gore
# yeni log_* koleksiyonlarindan okuyup transform ediyoruz.

_AFRO_SEVERITY_TR = {"low": "DÜŞÜK", "medium": "ORTA", "high": "YÜKSEK", "critical": "KRİTİK"}
_AFRO_AUTH_ACTION_TR = {
    "login_success": "Giriş başarılı",
    "login_failed": "Başarısız giriş denemesi",
    "login_success_google": "Google ile giriş",
    "login_success_phone": "Telefonla giriş",
    "register": "Kayıt oldu",
    "register_google": "Google ile kayıt",
    "admin_login": "Admin girişi",
    "admin_login_failed": "Başarısız admin girişi",
    "logout": "Çıkış yaptı",
    "otp_sent": "OTP kodu gönderildi",
    "profile_updated": "Profil güncellendi",
    "address_added": "Adres eklendi",
    "address_updated": "Adres güncellendi",
    "address_deleted": "Adres silindi",
    "account_closed": "Hesap kapatıldı",
}
_AFRO_DOC_NAME_TR = {
    "kvkk": "KVKK Aydınlatma Metni",
    "privacy": "Gizlilik Politikası",
    "membership": "Üyelik Sözleşmesi",
    "refundComplaintPolicy": "İade ve Şikayet Politikası",
    "couponTerms": "Kupon Koşulları",
    "pickupTerms": "Gel-Al Koşulları",
    "homeDeliveryTerms": "Eve Servis Koşulları",
    "tedarikci_sozlesmesi": "Tedarikçi Sözleşmesi",
    "delivery_terms": "Eve Servis Koşulları",
    "home_delivery": "Eve Servis Koşulları",
    "eve-servis-mesafeli-sat-s-zle-mesi": "Eve Servis Mesafeli Satış Sözleşmesi",
    "pickup_terms": "Gel-Al Koşulları",
    "pickup": "Gel-Al Koşulları",
    "kvkk_aydinlatma": "KVKK Aydınlatma Metni",
    "gizlilik_politikasi": "Gizlilik Politikası",
    "uyelik_sozlesmesi": "Üyelik Sözleşmesi",
    "ticari_ileti_izni": "Ticari İleti İzni",
    "mesafeli_satis": "Mesafeli Satış Sözleşmesi",
    "on_bilgilendirme": "Ön Bilgilendirme Formu",
    "gel_al": "Gel-Al Koşulları",
}
_AFRO_PAY_STATUS_TR = {
    "payment_success": "Başarılı",
    "payment_failed": "Başarısız",
    "payment_initiated": "Başlatıldı",
    "refund_initiated": "İade Başlatıldı",
    "refund_completed": "İade Tamamlandı",
}
_AFRO_ORDER_STATUS_TR = {
    "order_created": "Sipariş Oluşturuldu",
    "order_confirmed": "Onaylandı",
    "preparing": "Hazırlanıyor",
    "ready": "Hazır",
    "out_for_delivery": "Yolda",
    "delivered": "Teslim Edildi",
    "not_delivered": "Teslim Edilemedi",
    "cancelled": "İptal Edildi",
    "refund_partial": "Kısmi İade",
    "refund_full": "Tam İade",
    "status_talep_alindi": "Talep Alındı",
    "status_hazirlik_bekliyor": "Hazırlık Bekliyor",
    "status_preparing": "Hazırlanıyor",
    "status_ready": "Hazır",
    "status_delivered": "Teslim Edildi",
}

def _afro_status_tr(v):
    v = str(v or "")
    return _AFRO_ORDER_STATUS_TR.get(v, v)

def _afro_mask_phone(p):
    """Telefonu 0538****77 formatında maskele."""
    digits = "".join(ch for ch in str(p or "") if ch.isdigit())
    if len(digits) >= 7:
        return digits[:4] + "****" + digits[-2:]
    return str(p or "") or ""


def _afro_iso(v):
    """Date degerini ISO string'e cevir; None ise None doner."""
    try:
        from datetime import datetime as _dt, date as _d
        if isinstance(v, (_dt, _d)):
            return v.isoformat()
        if isinstance(v, str) and v:
            return v
    except Exception:
        pass
    return None

def _afro_dt_tr(v):
    """Date degerini tr-TR okunur formata cevir (guvenlik log stringi icin).
    UTC timestamp'i Europe/Istanbul (Türkiye) saatine çevirir."""
    try:
        from datetime import datetime as _dt, timezone as _tz
        from zoneinfo import ZoneInfo
        if isinstance(v, str):
            v = _dt.fromisoformat(v.replace("Z", "+00:00"))
        if hasattr(v, "strftime"):
            # UTC'den Europe/Istanbul'a çevir
            if v.tzinfo is None:
                v = v.replace(tzinfo=_tz.utc)
            turkey_dt = v.astimezone(ZoneInfo("Europe/Istanbul"))
            return turkey_dt.strftime("%d.%m.%Y %H:%M")
    except Exception:
        pass
    return str(v or "")

async def _afro_fetch_logs(collection_name: str, limit: int, extra_filter: dict = None):
    limit = max(1, min(int(limit or 200), 1000))
    query = extra_filter or {}
    return await db[collection_name].find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)

async def _afro_user_map(user_ids):
    """user_id -> {name, phone} toplu lookup (tek sorgu)."""
    ids = [u for u in set(user_ids) if u]
    if not ids:
        return {}
    rows = await db.users.find({"user_id": {"$in": ids}}, {"_id": 0, "user_id": 1, "name": 1, "phone": 1}).to_list(len(ids))
    return {r["user_id"]: r for r in rows}


@app.get("/api/admin/logs/actions")
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


@app.get("/api/admin/logs/security")
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


@app.get("/api/admin/logs/orders")
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


@app.get("/api/admin/logs/order-status")
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


@app.get("/api/admin/logs/payments")
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


@app.get("/api/admin/logs/refunds")
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


@app.get("/api/admin/logs/coupons")
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


@app.get("/api/admin/logs/members")
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


@app.get("/api/admin/logs/pickup")
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


@app.get("/api/admin/logs/agreements")
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

# --- END AFRO COMPAT LOG ENDPOINTS ---


# _record_visit / _mask_phone -> core/logs.py


# ---------------- Payment / order compatibility endpoints ----------------
def _normalize_delivery_type(data: dict) -> str:
    raw = str(data.get("delivery_type") or data.get("delivery_method") or "").strip().lower()
    if raw in ("pickup", "gel-al", "gel_al", "gelal", "pay_at_counter"):
        return "gel_al"
    if raw in ("home_delivery", "delivery", "eve_servis", "eveservis", "adres"):
        return "eve_servis"
    return raw or "gel_al"


def _normalize_payment_method(data: dict) -> str:
    raw = str(data.get("payment_method") or "").strip().lower()
    if raw in ("tezgah", "tezgahta", "counter", "pay_at_counter", "nakit/kredi kartı", "nakit/kredi k."):
        return "pay_at_counter"
    if raw in ("kapida", "kapıda", "cash", "cash_on_delivery", "kapida_nakit"):
        return "cash_on_delivery"
    if raw in ("online", "online_card", "kredi_karti", "credit_card", "card"):
        return "online_card"
    return raw or "pay_at_counter"


def _as_float(value, default=0.0) -> float:
    try:
        return float(value if value is not None else default)
    except Exception:
        return float(default)


def _resolve_selected_options(product: Optional[dict], raw: dict) -> tuple:
    """Müşterinin seçtiği özelleştirme seçeneklerini ürün tanımına göre doğrular.
    Fiyat farkını ürünün kendi tanımından alır (client'a güvenmez).
    Döner: (secili_liste, toplam_ek_ucret, not_metni)
    """
    sel_in = raw.get("selected_options") or raw.get("options") or []
    note = _clean_text(raw.get("note") or raw.get("customization_note") or "")
    if note:
        note = note[:500]
    resolved = []
    fee = 0.0
    defined = (product or {}).get("customization_options") or []
    if not isinstance(sel_in, list):
        sel_in = []
    for sel in sel_in:
        if not isinstance(sel, dict):
            continue
        g_title = _clean_text(sel.get("title") or sel.get("group") or "")
        c_label = _clean_text(sel.get("label") or sel.get("choice") or "")
        if not c_label:
            continue
        # Ürün tanımında bu grup+seçeneği bul, yetkili fiyat farkını al
        delta = 0.0
        matched_label = c_label
        matched_title = g_title
        for grp in defined:
            if not isinstance(grp, dict):
                continue
            gt = _clean_text(grp.get("title") or "")
            if g_title and gt and gt.lower() != g_title.lower():
                continue
            for ch in (grp.get("choices") or []):
                if not isinstance(ch, dict):
                    continue
                if _clean_text(ch.get("label") or "").lower() == c_label.lower():
                    delta = _as_float(ch.get("price_delta"), 0)
                    matched_label = _clean_text(ch.get("label"))
                    matched_title = gt or g_title
                    break
            else:
                continue
            break
        fee += delta
        resolved.append({"title": matched_title, "label": matched_label, "price_delta": round(delta, 2)})
    return resolved, round(fee, 2), note


async def _find_address_coordinates(user_id: str, order_address_text: str) -> tuple:
    """
    Kullanıcının kayıtlı adreslerinden (addresses koleksiyonu + users.addresses)
    siparişin adres metniyle eşleşeni bul, koordinatını döndür.
    Eşleştirme: mahalle + sokak + bina no üzerinden normalize edilmiş karşılaştırma.
    Return: (lat, lng) veya (None, None) eşleşme yoksa.
    """
    def normalize(s):
        if not s:
            return ""
        # Türkçe karakterleri ASCII'ye dönüştür, küçült, boşluk/noktalama temizle
        import unicodedata
        s = s.lower().strip()
        s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode('ascii')
        # sadece harf/rakam bırak
        return ''.join(c for c in s if c.isalnum())

    # Sipariş adresinden mahalle/sokak/bina no çıkar (frontend "Mah. Sok. No:" formatında gönderiyor)
    import re
    order_norm = normalize(order_address_text)
    # "Görükle Mah. Safran Sk. yıldızkent No:5" → mahalle=Görükle, sokak=Safran, bino=5
    mah_match = re.search(r'(\w+)\s*(?:mah|mahalle)', order_address_text, re.IGNORECASE)
    sok_match = re.search(r'(\w+)\s*(?:sk|sokak|cad|cadde)', order_address_text, re.IGNORECASE)
    bno_match = re.search(r'no:?\s*(\w+)', order_address_text, re.IGNORECASE)
    order_mah = normalize(mah_match.group(1)) if mah_match else ""
    order_sok = normalize(sok_match.group(1)) if sok_match else ""
    order_bno = normalize(bno_match.group(1)) if bno_match else ""

    # Adres kaynaklarını topla: addresses koleksiyonu + users.addresses gömülü
    candidates = []
    # 1. addresses koleksiyonu
    async for a in db.addresses.find({"user_id": user_id}, {"_id": 0, "lat": 1, "lng": 1, "neighborhood": 1, "street": 1, "building_no": 1}):
        candidates.append(a)
    # 2. users.addresses gömülü
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "addresses": 1})
    if user and user.get("addresses"):
        candidates.extend(user["addresses"])

    # Eşleştirme: mahalle + sokak + bina no benzerlikleri
    for addr in candidates:
        lat, lng = addr.get("lat"), addr.get("lng")
        if lat is None or lng is None:
            continue
        a_mah = normalize(addr.get("neighborhood") or "")
        a_sok = normalize(addr.get("street") or "")
        a_bno = normalize(addr.get("building_no") or "")
        # Üçü de eşleşirse kesin match
        if order_mah and order_sok and order_bno:
            if a_mah == order_mah and a_sok == order_sok and a_bno == order_bno:
                return (lat, lng)
        # Mahalle + sokak eşleşirse (bina no yoksa / farklıysa) yine kabul et
        if order_mah and order_sok:
            if a_mah == order_mah and a_sok == order_sok:
                return (lat, lng)
        # Fallback: mahalle eşleşip sokak/bino substring içeriyorsa
        if order_mah and a_mah == order_mah:
            if (order_sok and order_sok in a_sok) or (order_bno and order_bno in a_bno):
                return (lat, lng)
    return (None, None)


async def _evaluate_coupon(code: str, user: Optional[dict], subtotal, payment_method: str = "") -> dict:
    """Kuponu TÜM kurallara göre doğrular ve indirimi SUNUCUDA hesaplar.
    Sepet önizlemesi (/coupons/validate) ve gerçek sipariş aynı fonksiyonu kullanır;
    böylece önizleme ile tahsilat asla farklı çıkmaz. Hata -> HTTPException."""
    code = str(code or "").upper().strip()
    total = money_d(subtotal)
    if not code:
        raise HTTPException(status_code=400, detail="Kupon kodu gerekli")
    coupon = await db.coupons.find_one({"code": code}, {"_id": 0})
    if not coupon:
        raise HTTPException(status_code=404, detail="Kupon bulunamadı")
    if not coupon.get("active", True):
        raise HTTPException(status_code=400, detail="Bu kupon pasif durumda")
    if coupon.get("single_use") and coupon.get("used"):
        raise HTTPException(status_code=400, detail="Bu kupon daha önce kullanılmış")
    assigned = coupon.get("assigned_user_ids") or []
    if assigned and (not user or user.get("user_id") not in assigned):
        raise HTTPException(status_code=403, detail="Bu kupon hesabınıza tanımlı değil")
    if user:
        ua = next((a for a in (coupon.get("assignments") or []) if a.get("user_id") == user.get("user_id")), None)
        if ua:
            _lim = int(ua.get("limit") or 1)
            _used = int(ua.get("used_count") or 0)
            if _used >= _lim:
                raise HTTPException(status_code=400, detail="Bu kupon için kullanım hakkınız doldu")
    if coupon.get("members_only", True) and not user:
        raise HTTPException(status_code=401, detail="Kupon kullanmak için giriş yapmalısınız")
    valid_until = coupon.get("valid_until")
    if valid_until:
        try:
            expires = datetime.fromisoformat(str(valid_until).replace("Z", "+00:00"))
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=timezone.utc)
            if expires < now_utc():
                raise HTTPException(status_code=400, detail="Kupon süresi dolmuş")
        except HTTPException:
            raise
        except Exception:
            pass
    min_amount = money_d(coupon.get("min_amount", 0) or 0)
    if total < min_amount:
        raise HTTPException(status_code=400, detail=f"Minimum sipariş tutarı: {min_amount:.0f}₺")
    discount_amount = coupon.get("discount_amount")
    if discount_amount is not None and D(discount_amount) > 0:
        discount = money_d(discount_amount)
        discount_type = "fixed"
    else:
        percent = D(coupon.get("discount_percent", 0) or 0)
        if percent < 0 or percent > 100:
            percent = Decimal("0")
        discount = money_d(total * percent / Decimal("100"))
        discount_type = "percentage"
    if discount < 0:
        discount = Decimal("0")
    if discount > total:
        discount = total
    return {
        "coupon": coupon,
        "discount": discount,          # Decimal
        "discount_type": discount_type,
        "min_amount": min_amount,
        "payment_method": payment_method,
    }


async def _prepare_order_payload(data: dict, current_user: dict, request=None) -> dict:
    """SİPARİŞ HESAPLAMA — TEK DOĞRULUK KAYNAĞI SUNUCUDUR.
    Müşteri tarafından gelen fiyat / ara toplam / teslimat ücreti / indirim / toplam
    yalnızca KARŞILAŞTIRMA için kullanılır; tahsilat sunucunun hesabıyla yapılır.
    Müşteri lehine oynanmış bir değer tespit edilirse işlem iptal edilir ve
    güvenlik alarmı (log + yöneticiye SMS) tetiklenir.

    Fiyat kaynağı: ürünün `price` alanı (uygulamada müşteriye GÖSTERİLEN fiyat, admin
    panelindeki satış fiyatı ile aynı). `price` yoksa/0 ise teslimat tipine göre
    gel_al_price / eve_servis_price kullanılır. Böylece "ekranda görünen = tahsil edilen".
    """
    delivery_type = _normalize_delivery_type(data)
    payment_method = _normalize_payment_method(data)
    items_in = data.get("items") or data.get("cart_items") or []
    if not isinstance(items_in, list) or not items_in:
        raise HTTPException(status_code=400, detail="Sepet boş")
    if len(items_in) > 60:
        raise HTTPException(status_code=400, detail="Sepette çok fazla kalem var")

    tamper = []     # müşteri lehine manipülasyon sinyalleri (alarm + iptal)
    stale = []      # müşteri aleyhine/nötr uyumsuzluk (bayat sepet; sadece log)

    items = []
    subtotal = Decimal("0")
    price_type = "gel_al_price" if delivery_type == "gel_al" else "eve_servis_price"
    for raw in items_in:
        if not isinstance(raw, dict):
            raise HTTPException(status_code=400, detail="Sepet kalemi geçersiz")
        product_id = raw.get("id") or raw.get("product_id")
        if not product_id or not isinstance(product_id, str) or len(product_id) > 80:
            tamper.append({"type": "missing_product_id", "raw_id": str(product_id)[:80]})
            continue
        product = await db.products.find_one({"id": product_id}, {"_id": 0})
        if not product:
            tamper.append({"type": "unknown_product", "product_id": product_id, "client_price": raw.get("price")})
            continue
        if not product.get("active", True) or product.get("hidden", False) or not product.get("in_stock", True):
            raise HTTPException(status_code=400, detail=f"{product.get('name', 'Ürün')} şu anda satışa uygun değil")

        # Miktar: 0 < qty <= 200, en fazla 3 ondalık
        qty = D(raw.get("qty", raw.get("quantity", 1)), "0")
        if qty <= 0 or qty > 200 or qty != qty.quantize(_MILLI, rounding=ROUND_HALF_UP):
            if qty <= 0 or qty > 200:
                tamper.append({"type": "invalid_qty", "product_id": product_id, "qty": str(qty)})
                continue
            qty = qty.quantize(_MILLI, rounding=ROUND_HALF_UP)

        # Fiyat kaynağı: price (gösterilen) -> teslimat tipine özel fiyat
        server_price = None
        for cand in (product.get("price"), product.get(price_type)):
            if cand is not None and D(cand) > 0:
                server_price = money_d(cand)
                break
        if server_price is None:
            raise HTTPException(status_code=400, detail=f"{product.get('name', 'Ürün')} için fiyat tanımlı değil")

        # Müşterinin gönderdiği birim fiyat yalnızca karşılaştırılır
        client_price = raw.get("price")
        if client_price is not None and not _num_close(client_price, server_price):
            cp = money_d(client_price)
            if cp < server_price:
                # Fiyat kısa süre önce (24 saat) yönetici tarafından değiştiyse bayat sepet olabilir
                upd = product.get("price_updated_at") or product.get("updated_at")
                recent_change = False
                try:
                    recent_change = bool(upd) and (now_utc() - to_aware(upd)) < timedelta(hours=24)
                except Exception:
                    recent_change = False
                entry = {"type": "unit_price_low", "product_id": product_id, "name": product.get("name"), "client_price": str(cp), "server_price": str(server_price)}
                (stale if recent_change else tamper).append(entry)
            else:
                stale.append({"type": "unit_price_high", "product_id": product_id, "client_price": str(cp), "server_price": str(server_price)})

        sel_options, options_fee_unit, cust_note = _resolve_selected_options(product, raw)
        options_fee_unit_d = money_d(options_fee_unit)
        options_fee = money_d(options_fee_unit_d * qty)
        line_total = money_d(server_price * qty + options_fee)
        subtotal += line_total
        items.append({
            "id": product_id,
            "name": product.get("name") or raw.get("name") or "Ürün",
            "qty": float(qty),
            "quantity": float(qty),
            "price": float(server_price),
            "unit": product.get("unit") or raw.get("unit"),
            "selected_options": sel_options,
            "options_fee_unit": float(options_fee_unit_d),
            "options_fee": float(options_fee),
            "customization_note": cust_note,
            "total_price": float(line_total),
            "line_total": float(line_total),
            "unit_price_snapshot": float(server_price),
            "price_type": "price" if product.get("price") is not None and D(product.get("price")) > 0 else price_type,
            "product_name_snapshot": product.get("name") or raw.get("name"),
            "category_snapshot": product.get("category"),
            "supplier_group_snapshot": product.get("supplier_group"),
            "unit_snapshot": product.get("unit") or raw.get("unit"),
            "quality_snapshot": product.get("quality"),
            "supplier_price_snapshot": product.get("supplier_price"),
        })

    if tamper:
        await security_alarm(
            "order_tamper_attempt",
            {"summary": tamper[0].get("type", "manipulasyon"), "signals": tamper[:10], "stage": "items", "delivery_type": delivery_type},
            request, current_user, severity="critical", notify=True,
        )
        raise HTTPException(status_code=400, detail="İşlem güvenlik nedeniyle iptal edildi. Lütfen sepetinizi yenileyip tekrar deneyin. (GV-01)")
    if not items:
        raise HTTPException(status_code=400, detail="Sepet boş")

    subtotal = money_d(subtotal)
    settings = await db.settings.find_one({"id": "global_settings"}, {"_id": 0}) or {}

    # --- Teslimat ücreti: SUNUCU kuralı (uygulamadaki kuralla aynı) ---
    delivery_fee = Decimal("0")
    if delivery_type == "eve_servis" and subtotal > 0:
        fee_cfg = money_d(settings.get("delivery_fee") or 0)
        free_min = money_d(settings.get("free_delivery_min_amount") or 0)
        if fee_cfg > 0 and (free_min <= 0 or subtotal < free_min):
            delivery_fee = fee_cfg

    # --- Kupon / indirim: SUNUCU hesaplar ---
    _cc = str(data.get("coupon_code") or "").strip().upper()
    _coupon_doc = None
    discount = Decimal("0")
    if _cc:
        try:
            ev = await _evaluate_coupon(_cc, current_user, subtotal, payment_method)
        except HTTPException as exc:
            # Uygulama geçersiz kuponu sepete EKLEMEZ; sipariş gövdesinde geçersiz kupon = müdahale şüphesi.
            # Süre dolumu / min tutar gibi doğal durumlar (400) sadece kaydedilir, SMS gitmez.
            natural = exc.status_code == 400
            await security_alarm(
                "coupon_abuse_attempt",
                {"summary": f"kupon {_cc}: {exc.detail}", "coupon_code": _cc, "reason": exc.detail, "client_discount": data.get("discount")},
                request, current_user, severity="medium" if natural else "critical", notify=not natural,
            )
            raise HTTPException(status_code=exc.status_code, detail=f"Kupon uygulanamadı: {exc.detail}")
        _coupon_doc = ev["coupon"]
        discount = ev["discount"]
    if discount > subtotal:
        discount = subtotal

    # --- Müşteri gövdesindeki finansal alanları KARŞILAŞTIR (tahsilatta kullanılmaz) ---
    c_discount = data.get("discount", data.get("discount_amount"))
    c_fee = data.get("delivery_fee")
    c_subtotal = data.get("subtotal")
    c_amount = data.get("amount", data.get("total"))
    if c_discount is not None and not _num_close(c_discount, discount):
        if money_d(c_discount) > discount:
            if not _cc:
                tamper.append({"type": "discount_without_coupon", "client_discount": str(money_d(c_discount))})
            else:
                # Kuponun verebileceği azami indirimden fazlası istenmiş mi? (bayat sepetle açıklanamaz)
                max_possible = discount
                if _coupon_doc is not None:
                    if D(_coupon_doc.get("discount_amount") or 0) > 0:
                        max_possible = money_d(_coupon_doc.get("discount_amount"))
                    else:
                        base = max(subtotal, money_d(c_subtotal or 0))
                        max_possible = money_d(base * D(_coupon_doc.get("discount_percent") or 0) / Decimal("100"))
                if money_d(c_discount) > max_possible + Decimal("0.011"):
                    tamper.append({"type": "discount_inflated", "client_discount": str(money_d(c_discount)), "server_discount": str(discount), "max_possible": str(max_possible)})
                else:
                    stale.append({"type": "discount_high_stale", "client_discount": str(money_d(c_discount)), "server_discount": str(discount)})
        else:
            stale.append({"type": "discount_low", "client_discount": str(money_d(c_discount)), "server_discount": str(discount)})
    if c_fee is not None and not _num_close(c_fee, delivery_fee):
        cf = money_d(c_fee)
        if cf < delivery_fee:
            # Müşterinin kendi ara toplamı ücretsiz teslimat eşiğini geçmiyorsa 0 ücret iddiası = manipülasyon
            free_min = money_d(settings.get("free_delivery_min_amount") or 0)
            cs = money_d(c_subtotal) if c_subtotal is not None else subtotal
            if free_min > 0 and cs >= free_min:
                stale.append({"type": "fee_low_stale", "client_fee": str(cf), "server_fee": str(delivery_fee), "client_subtotal": str(cs)})
            else:
                tamper.append({"type": "delivery_fee_low", "client_fee": str(cf), "server_fee": str(delivery_fee), "client_subtotal": str(cs)})
        else:
            stale.append({"type": "fee_high", "client_fee": str(cf), "server_fee": str(delivery_fee)})
    if c_subtotal is not None and not _num_close(c_subtotal, subtotal):
        stale.append({"type": "subtotal_diff", "client": str(money_d(c_subtotal)), "server": str(subtotal)})
    amount = money_d(subtotal + delivery_fee - discount)
    if amount < 0:
        amount = Decimal("0")
    if c_amount is not None and not _num_close(c_amount, amount):
        ca = money_d(c_amount)
        # Müşterinin KENDİ rakamları kendi içinde tutarsızsa (toplam < ara toplam + ücret - indirim) -> müdahale
        try:
            own = money_d(c_subtotal if c_subtotal is not None else subtotal) + money_d(c_fee if c_fee is not None else delivery_fee) - money_d(c_discount if c_discount is not None else discount)
            if own < 0:
                own = Decimal("0")
            if payment_method == "online_card" and own < 1:
                own = Decimal("1")
        except Exception:
            own = amount
        if ca < own - Decimal("0.011"):
            tamper.append({"type": "amount_inconsistent", "client_amount": str(ca), "client_formula": str(own), "server_amount": str(amount)})
        else:
            stale.append({"type": "amount_diff", "client_amount": str(ca), "server_amount": str(amount)})

    if tamper:
        await security_alarm(
            "order_tamper_attempt",
            {"summary": tamper[0].get("type", "manipulasyon"), "signals": tamper[:10], "stale": stale[:10], "stage": "totals",
             "server": {"subtotal": str(subtotal), "delivery_fee": str(delivery_fee), "discount": str(discount), "amount": str(amount)}},
            request, current_user, severity="critical", notify=True,
        )
        raise HTTPException(status_code=400, detail="İşlem güvenlik nedeniyle iptal edildi. Lütfen sepetinizi yenileyip tekrar deneyin. (GV-02)")
    if stale:
        # Bayat sepet: sunucu doğru tutarla devam eder, olay yalnızca kaydedilir (SMS yok)
        await security_alarm(
            "order_price_mismatch",
            {"summary": stale[0].get("type", "uyumsuzluk"), "signals": stale[:10], "server": {"subtotal": str(subtotal), "delivery_fee": str(delivery_fee), "discount": str(discount), "amount": str(amount)}},
            request, current_user, severity="low", notify=False,
        )

    if amount <= 0:
        raise HTTPException(status_code=400, detail="Ödenecek tutar hesaplanamadı. Lütfen sepetinizi kontrol edin.")
    if payment_method == "online_card" and amount < 1:
        raise HTTPException(status_code=400, detail="Online ödeme için tutar en az 1₺ olmalıdır")

    min_amount = money_d(settings.get("min_pickup_amount" if delivery_type == "gel_al" else "min_delivery_amount") or 0)
    # Minimum sipariş kontrolü ÜRÜN TUTARINA (subtotal) göre yapılır; kupon indirimi
    # müşteriyi minimumun altına düşürmez (uygulama da min-gate'i Ara Toplam üzerinden yapar).
    if subtotal < min_amount:
        raise HTTPException(status_code=400, detail=f"Minimum sipariş tutarı: {min_amount:.0f}₺")

    if delivery_type == "eve_servis" and not _clean_text(data.get("address")):
        raise HTTPException(status_code=400, detail="Eve servis siparişi için teslimat adresi zorunludur")

    # No-show ceza kontrolü: cezalı müşteri yalnızca online ödeme kullanabilir
    if payment_method in ("cash_on_delivery", "pay_at_counter"):
        fresh_user = await db.users.find_one({"user_id": current_user.get("user_id")}, {"_id": 0}) or current_user
        no_show = _evaluate_no_show_restriction(fresh_user)
        if no_show["online_only"]:
            raise HTTPException(
                status_code=403,
                detail=no_show["message"] or "Hesabınız yalnızca online ödeme kullanabilir. Lütfen online ödeme seçin.",
            )

    if payment_method in ("cash_on_delivery", "pay_at_counter") and settings.get("cash_payment_limit_enabled"):
        max_cash = money_d(settings.get("cash_payment_max_amount") or 0)
        if max_cash > 0 and amount > max_cash:
            raise HTTPException(status_code=400, detail=f"Bu tutar için yalnızca online ödeme kabul edilir. Nakit/tezgah ödeme limiti: {max_cash:.0f}₺")

    # Eve servis siparişi için adrese koordinat ekle (kurye "Haritada Göster" butonunda pin açabilsin)
    final_address = _clean_text(data.get("address") or "")[:600] or ("Tezgah" if delivery_type == "gel_al" else "")
    if delivery_type == "eve_servis" and final_address and "Konum:" not in final_address:
        lat, lng = await _find_address_coordinates(current_user.get("user_id"), final_address)
        if lat is not None and lng is not None:
            final_address += f"\nKonum: https://www.google.com/maps?q={lat},{lng}"

    tx_id = new_id("tx")
    order = {
        "tx_id": tx_id,
        "user_id": current_user.get("user_id"),
        "user_name": current_user.get("name"),
        "user_phone": _mask_phone(current_user.get("phone")),
        "amount": float(amount),
        "subtotal": float(subtotal),
        "delivery_fee": float(delivery_fee),
        "discount": float(discount),
        "status": "pending",
        "order_status": "talep_alindi",
        "payment_status": "pending" if payment_method == "online_card" else "unpaid",
        "payment_method": payment_method,
        "delivery_method": "pickup" if delivery_type == "gel_al" else "home_delivery",
        "delivery_type": delivery_type,
        "items": items,
        "coupon_code": _cc or None,
        "coupon_id": (_coupon_doc or {}).get("id"),
        "coupon_consumed": False,
        # Adres DB'de ŞİFRELİ saklanır (dec_str ile okunur)
        "address": enc_str(final_address) if final_address else final_address,
        "delivery_neighborhood": _clean_text(data.get("delivery_neighborhood") or "")[:120],
        "market_id": data.get("market_id") or data.get("stall_id"),
        "stall_id": data.get("stall_id") or data.get("market_id"),
        "market_name": _clean_text(data.get("market_name")) or "",
        "pickup_time": data.get("pickup_time") or None,
        "delivery_slot_start": data.get("delivery_slot_start") or None,
        "delivery_slot_end": data.get("delivery_slot_end") or None,
        "document_acceptances": data.get("document_acceptances") or [],
        "agreements_accepted": bool(data.get("agreements_accepted") or data.get("legal_accepted")),
        "agreements_versions": data.get("agreements_versions") or {},
        "pricing_version": 2,
        "server_calculated": True,
        "client_claimed": {
            "subtotal": c_subtotal, "delivery_fee": c_fee, "discount": c_discount, "amount": c_amount,
        },
        "created_at": now_utc(),
        "updated_at": now_utc(),
    }
    order["calc_signature"] = order_signature(order)
    return order


# PayTR entegrasyonu (_paytr_keys_status, _clean_paytr_oid, _init_paytr_token,
# _paytr_refund, paytr_callback_expected_hash) -> services/payments.py


async def _consume_coupon_for_order(order: dict, request: Request = None):
    """Sipariş TAMAMLANDIĞINDA kuponun per-user kullanım sayacını (used_count)
    artırır ve tek kullanımlıksa kuponu 'used' işaretler. Idempotent: aynı sipariş
    için iki kez sayılmaz (transaction.coupon_consumed bayrağı). Nakit/tezgah
    siparişlerde sipariş oluşturulunca, online kartta PayTR başarı callback'inde
    çağrılır (başarısız ödemede sayaç artmasın)."""
    try:
        code = (order.get("coupon_code") or "").strip()
        if not code or order.get("coupon_consumed"):
            return
        uid = order.get("user_id")
        coupon = await db.coupons.find_one({"code": code}, {"_id": 0})
        if not coupon:
            return
        assignments = coupon.get("assignments") or []
        setu = {}
        if uid and assignments:
            ua = next((a for a in assignments if a.get("user_id") == uid), None)
            if ua:
                ua["used_count"] = int(ua.get("used_count") or 0) + 1
                ua["last_used_at"] = now_utc()
                setu["assignments"] = assignments
        if coupon.get("single_use"):
            setu["used"] = True
            setu["used_at"] = now_utc()
        if setu:
            await db.coupons.update_one({"id": coupon["id"]}, {"$set": setu})
        # Siparişi işaretle (çift sayımı önle — callback birden çok kez gelebilir)
        await db.transactions.update_one({"tx_id": order.get("tx_id")}, {"$set": {"coupon_consumed": True}})
    except Exception as _e:
        logging.warning(f"Kupon kullanım sayacı güncellenemedi: {_e}")


async def _log_order_agreement(order: dict, data: dict, current_user: dict, request: Request = None):
    """Sipariş anında kabul edilen sözleşmeyi (mesafeli satış / ön bilgilendirme /
    Gel-Al / Eve Servis koşulları) legal_agreement_logs'a yazar; böylece 'Sözleşme
    Onayları' sekmesinde SİPARİŞ NUMARASIYLA görünür. Frontend her siparişte
    agreements_accepted + agreements_versions + legal_document_type gönderir; eskiden
    bu kabul transaction'a yazılıyor ama onay loguna HİÇ düşmüyordu (sipariş
    sözleşmeleri eksik görünüyordu)."""
    try:
        accepted = bool(data.get("agreements_accepted") or data.get("legal_accepted"))
        if not accepted:
            return
        versions = data.get("agreements_versions") or {}
        if not isinstance(versions, dict):
            versions = {}
        doc_type = data.get("legal_document_type") or order.get("delivery_type") or ""
        # Belge kodu: agreements_versions anahtarı > legal_document_type
        doc_code = (next(iter(versions.keys()), None) if versions else None) or doc_type or "mesafeli_satis"
        doc_version = str(next(iter(versions.values()), "") or "") if versions else ""
        doc_name = _AFRO_DOC_NAME_TR.get(doc_code) or _AFRO_DOC_NAME_TR.get(doc_type) or "Mesafeli Satış Sözleşmesi"
        ts = now_utc().isoformat()
        ip = "unknown"; ua = "unknown"
        if request is not None:
            ip = request.headers.get("x-forwarded-for", request.headers.get("x-real-ip", "unknown"))
            ua = request.headers.get("user-agent", "unknown")
        await db.legal_agreement_logs.insert_one({
            "user_id": current_user.get("user_id"),
            "accepted": True,
            "gate_type": "order",
            "document_code": doc_code,
            "document_name": doc_name,
            "document_version": doc_version,
            "document_type": doc_code,
            "document_hash": data.get("agreement_hash", ""),
            "versions": versions if versions else {doc_code: doc_version},
            "timestamp": ts,
            "accepted_at": ts,
            "ip": ip,
            "user_agent": ua,
            "user_name": current_user.get("name", ""),
            "user_phone": current_user.get("phone", ""),
            "order_id": order.get("tx_id"),
        })
    except Exception as _e:
        logging.warning(f"Sipariş sözleşme logu yazılamadı: {_e}")


@app.post("/api/orders")
async def compat_create_order(data: dict, current_user: dict = Depends(get_current_user), request: Request = None):
    await rate_limit(f"order_user:{current_user.get('user_id')}", 12, 300, "Çok sık sipariş denemesi. Lütfen biraz bekleyin.")
    order = await _prepare_order_payload(data, current_user, request)
    await db.transactions.insert_one(order)
    # Sipariş anındaki sözleşme onayını sipariş no ile logla.
    await _log_order_agreement(order, data, current_user, request)
    # Ödeme adımı olmayan doğrudan sipariş -> kuponu hemen tüket.
    await _consume_coupon_for_order(order)
    return {"success": True, "tx_id": order["tx_id"], "order": _compat_json_clean(_customer_order_view(order))}


@app.post("/api/payments/init")
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



@app.post("/api/payment/paytr/iframe-token")
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

@app.post("/api/payment/paytr/callback")
@app.post("/api/payments/paytr/callback")
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

@app.post("/api/payment/paytr")
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

@app.get("/api/visit")
async def compat_get_visit(current_user: Optional[dict] = Depends(get_current_user_optional)):
    return await _record_visit({"method": "GET"}, current_user)

@app.post("/api/visit")
async def compat_post_visit(data: dict = None, current_user: Optional[dict] = Depends(get_current_user_optional)):
    return await _record_visit(data or {"method": "POST"}, current_user)

@app.post("/api/auth/send-phone-otp")
async def compat_send_phone_otp(data: dict, request: Request = None):
    phone = str(data.get("phone") or data.get("phone_number") or "").strip()
    purpose = str(data.get("purpose") or "registration").strip() or "registration"
    
    # TR cep telefonu kontrolü (05XX... formatında olmalı)
    phone_normalized = _normalize_sms_phone(phone)
    if not phone_normalized:
        raise HTTPException(
            status_code=400,
            detail="Geçersiz telefon numarası. TR cep telefonu formatı kullanın (örn: 05XX XXX XX XX)"
        )
    await rate_limit(f"otp_ip:{_client_ip(request)}", 15, 3600, "Çok fazla SMS isteği. Lütfen daha sonra tekrar deneyin.")
    await rate_limit(f"otp_phone:{phone}", 5, 3600, "Bu numara için çok fazla SMS isteği. 1 saat sonra tekrar deneyin.")
    if purpose not in ("registration", "password_reset", "login"):
        purpose = "registration"
    # Kayıt akışında zaten üye olan numaraya SMS gönderme; kullanıcıyı erkenden yönlendir
    if purpose == "registration":
        existing_user = await db.users.find_one({"phone": phone}, {"_id": 1})
        if existing_user:
            raise HTTPException(status_code=409, detail="Bu numara zaten kayıtlı. Lütfen giriş yapın.")
    code = _generate_sms_code()
    expires_at = now_utc() + timedelta(minutes=5)
    await db.otp_codes.delete_many({"phone": phone, "purpose": purpose})
    await db.otp_codes.insert_one({
        "phone": phone,
        "purpose": purpose,
        "code_hash": hashlib.sha256(code.encode("utf-8")).hexdigest(),
        "created_at": now_utc(),
        "expires_at": expires_at,
        "used": False,
    })
    message = f"Afro Gida dogrulama kodunuz: {code}\nKod 5 dakika gecerlidir."
    sms_sent = send_sms_verimor(phone, message)
    await db.otp_requests_log.insert_one({
        "phone": _mask_phone(phone),
        "purpose": purpose,
        "requested_at": now_utc(),
        "sms_sent": sms_sent,
        "sms_provider": "verimor",
        "expires_at": expires_at,
    })
    # --- LOG: OTP ---
    _otp_uid = None
    _otp_user = await db.users.find_one({"phone": phone}, {"_id": 0, "user_id": 1})
    if _otp_user:
        _otp_uid = _otp_user.get("user_id")
    await _insert_log("log_auth", {"user_id": _otp_uid, "phone_masked": _mask_phone(phone), "action": "otp_sent", "change_details": {"purpose": purpose}}, request)
    _otp_sms_type = "otp_register" if purpose == "registration" else "otp_login"
    await _log_sms_send(_otp_uid, phone, _otp_sms_type, f"otp_{purpose}_v1", sms_sent, request)
    await _check_otp_abuse(phone, request)
    return {"success": True, "sms_sent": sms_sent, "expires_in": 300}


def _compat_json_clean(value):
    from datetime import datetime, date
    if isinstance(value, list):
        return [_compat_json_clean(v) for v in value]
    if isinstance(value, dict):
        return {k: _compat_json_clean(v) for k, v in value.items() if k != "_id"}
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if value.__class__.__name__ == "ObjectId":
        return str(value)
    return value


# =====================================================================
# TEDARİKÇİ SÖZLEŞMESİ — yükleme + onay (consent) + panel erişim kilidi
# - Admin bir PDF yükler ve sürüm belirler (catalog_config.supplier_contract)
# - Tedarikçi panele girmeden sözleşmeyi onaylamak ZORUNDA
# - Onay consent_logs koleksiyonuna IP + cihaz + sürüm ile loglanır
# - Onaylamayan tedarikçi ürün ekley/düzenleyemez (backend kilidi)
# @app.* ile tanımlanır (include_router'dan sonra @api_router kaydolmaz)
# =====================================================================

# Varsayılan (henüz admin yüklemediyse) — sisteme konan test PDF'i
_AFRO_DEFAULT_SUPPLIER_CONTRACT = {
    "url": "/legal/afrogida_05_tedarikci_sozlesmesi_test.pdf",
    "version": "test-v1",
    "title": "Tedarikçi Sözleşmesi",
}


async def _afro_supplier_contract_cfg():
    """Aktif tedarikçi sözleşmesi ayarını döndürür (url, version, title)."""
    try:
        cfg = await _read_catalog_config()
    except Exception:
        cfg = None
    sc = (cfg or {}).get("supplier_contract")
    if not sc or not sc.get("url") or not sc.get("version"):
        return dict(_AFRO_DEFAULT_SUPPLIER_CONTRACT)
    return {
        "url": sc.get("url"),
        "version": sc.get("version"),
        "title": sc.get("title") or "Tedarikçi Sözleşmesi",
    }


async def _afro_require_supplier_contract(user):
    """Tedarikçi aktif sözleşme sürümünü onaylamadıysa 403 fırlatır."""
    cfg = await _afro_supplier_contract_cfg()
    cur = (cfg or {}).get("version")
    if not cur:
        return
    if (user or {}).get("supplier_contract_accepted_version") != cur:
        raise HTTPException(
            status_code=403,
            detail="Tedarikçi sözleşmesini onaylamadan işlem yapamazsınız. Lütfen panelde sözleşmeyi kabul edin.",
        )


def _afro_client_ip(request):
    try:
        xff = request.headers.get("x-forwarded-for") or ""
        if xff:
            return xff.split(",")[0].strip()
        return request.client.host if request.client else ""
    except Exception:
        return ""


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


# ---- Aktif sözleşmeyi getir (tedarikçi + herkes okuyabilir) ----
@app.get("/api/supplier-contract")
async def afro_get_supplier_contract():
    return await _afro_supplier_contract_cfg()


# ---- Admin: aktif sözleşmeyi ayarla (yeni PDF + sürüm) ----
@app.post("/api/admin/supplier-contract")
async def afro_set_supplier_contract(payload: AfroSupplierContractInput, current_admin: dict = Depends(get_current_admin)):
    _yonetici_only(current_admin)
    url = (payload.url or "").strip()
    version = (payload.version or "").strip()
    if not url or not version:
        raise HTTPException(status_code=400, detail="url ve version zorunludur")
    sc = {"url": url, "version": version, "title": (payload.title or "Tedarikçi Sözleşmesi").strip(),
          "updated_at": now_utc(), "updated_by": current_admin.get("user_id")}
    await _write_catalog_config({"supplier_contract": sc})
    try:
        await db.admin_logs.insert_one({
            "action": "supplier_contract_updated", "url": url, "version": version,
            "admin_id": current_admin.get("user_id"), "created_at": now_utc(),
        })
    except Exception:
        pass
    return await _afro_supplier_contract_cfg()


# ---- Tedarikçi: kendi onay durumu ----
@app.get("/api/supplier/contract-status")
async def afro_supplier_contract_status(current_supplier: dict = Depends(get_current_supplier)):
    cfg = await _afro_supplier_contract_cfg()
    cur = cfg.get("version")
    accepted_ver = current_supplier.get("supplier_contract_accepted_version")
    accepted_at = current_supplier.get("supplier_contract_accepted_at")
    return {
        "contract": cfg,
        "current_version": cur,
        "accepted": bool(cur and accepted_ver == cur),
        "accepted_version": accepted_ver,
        "accepted_at": accepted_at.isoformat() if hasattr(accepted_at, "isoformat") else accepted_at,
    }


# ---- Tedarikçi: sözleşmeyi onayla (consent logu düşer) ----
@app.post("/api/supplier/accept-contract")
async def afro_supplier_accept_contract(request: Request, current_supplier: dict = Depends(get_current_supplier)):
    cfg = await _afro_supplier_contract_cfg()
    cur = cfg.get("version")
    if not cur:
        raise HTTPException(status_code=400, detail="Aktif tedarikçi sözleşmesi tanımlı değil")
    ts = now_utc()
    uid = current_supplier.get("user_id")
    await db.users.update_one(
        {"user_id": uid},
        {"$set": {"supplier_contract_accepted_version": cur, "supplier_contract_accepted_at": ts}},
    )
    log_doc = {
        "user_id": uid,
        "name": current_supplier.get("name"),
        "phone": current_supplier.get("phone"),
        "supplier_group": get_user_supplier_group(current_supplier),
        "consent_type": "tedarikci_sozlesmesi",
        "contract_version": cur,
        "contract_url": cfg.get("url"),
        "accepted_at": ts,
        "ip": _afro_client_ip(request),
        "user_agent": request.headers.get("user-agent", ""),
    }
    try:
        await db.consent_logs.insert_one(dict(log_doc))
    except Exception:
        pass
    await _insert_log("log_consents", {"user_id": uid, "consent_type": "tedarikci_sozlesmesi", "action": "accepted", "document_version": cur, "document_name": "Tedarikçi Sözleşmesi", "document_url": cfg.get("url","")}, request)
    return {"success": True, "version": cur, "accepted_at": ts.isoformat()}


# ---- Admin: onay loglarını listele ----
@app.get("/api/admin/contract-consents")
async def afro_admin_contract_consents(current_admin: dict = Depends(get_current_admin)):
    _yonetici_only(current_admin)
    logs = await db.consent_logs.find(
        {"consent_type": "tedarikci_sozlesmesi"}, {"_id": 0}
    ).sort("accepted_at", -1).to_list(1000)
    for l in logs:
        aa = l.get("accepted_at")
        if hasattr(aa, "isoformat"):
            l["accepted_at"] = aa.isoformat()
    return logs



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


# ============================================================
# LOG SİSTEMİ — Admin Log Listeleme API Endpoint'leri
# ============================================================

@app.get("/api/admin/logs/stats/overview")
async def afro_log_stats_overview(current_admin: dict = Depends(get_current_admin)):
    """Çözülmemiş güvenlik uyarıları + açık destek ticket sayısı."""
    unresolved = await db.log_security.count_documents({"resolved": False, "severity": {"$in": ["high","critical"]}})
    open_support = await db.log_support.count_documents({"action": {"$nin": ["closed","resolved"]}})
    return {"unresolved_security_alerts": unresolved, "open_support_tickets": open_support}


@app.get("/api/admin/logs/{collection_name}")
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


# ─────────────────────────────────────────────────────────────
#  PUSH BİLDİRİMİ GÖNDER (Admin)
# ─────────────────────────────────────────────────────────────

@app.post("/api/admin/push/send")
async def admin_send_push(request: Request, current_admin: dict = Depends(get_current_admin)):
    """
    Admin'in tarayıcıdan push bildirimi göndermesini sağlar.
    Hedef: 'all' → tüm kayıtlı tokenlar, 'users' → belirtilen user_id listesi.
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Geçersiz JSON")

    title = str(body.get("title", "")).strip()[:100]
    msg   = str(body.get("body",  "")).strip()[:300]
    target = str(body.get("target", "all"))          # 'all' | 'users'
    user_ids = body.get("user_ids", [])               # hedef 'users' ise
    url_path = str(body.get("url", "")).strip()[:200]  # isteğe bağlı deep-link

    if not title or not msg:
        raise HTTPException(status_code=422, detail="Başlık ve mesaj zorunludur")

    data_payload = {}
    if url_path:
        data_payload["url"] = url_path

    if target == "users" and user_ids:
        sent = await send_push_to_users(list(user_ids), title, msg, data=data_payload)
    else:
        sent = await send_push_to_all(title, msg, data=data_payload)

    await _insert_log("log_admin", {
        "action": "push_send",
        "admin_id": current_admin.get("user_id"),
        "title": title, "body": msg, "target": target,
        "sent_count": sent
    }, request)

    return {"ok": True, "sent": sent}


@app.get("/api/admin/push/stats")
async def admin_push_stats(current_admin: dict = Depends(get_current_admin)):
    """Kayıtlı push token sayısı ve platform dağılımını döner."""
    total = await db.push_tokens.count_documents({"push_token": {"$exists": True, "$ne": ""}})
    android = await db.push_tokens.count_documents({"platform": "android"})
    ios = await db.push_tokens.count_documents({"platform": "ios"})
    return {"total": total, "android": android, "ios": ios}


    return {"ok": True}


# ─────────────────────────────────────────────────────────────────
# SIFREMI UNUTTUM: OTP ile dogrulama -> yeni sifre
# ─────────────────────────────────────────────────────────────────
@app.post("/api/auth/reset-password")
async def reset_password_with_otp(data: dict, request: Request = None):
    phone = str(data.get("phone") or "").strip()
    otp_code = str(data.get("otp_code") or "").strip()
    new_password = str(data.get("new_password") or "").strip()
    if not phone or len(phone) < 7:
        raise HTTPException(status_code=400, detail="Gecerli bir telefon numarasi girin.")
    if not otp_code or len(otp_code) != 6:
        raise HTTPException(status_code=400, detail="6 haneli SMS kodunu girin.")
    if not new_password or len(new_password) < 6:
        raise HTTPException(status_code=400, detail="Yeni sifre en az 6 karakter olmalidir.")
    await rate_limit(f"pwreset:{phone}", 6, 900, "Çok fazla deneme. 15 dakika sonra tekrar deneyin.")
    user = await db.users.find_one({"phone": phone}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="Bu telefon numarasina kayitli hesap bulunamadi.")
    if user.get("role") in ("admin", "yonetici") and len(new_password) < 8:
        raise HTTPException(status_code=400, detail="Yönetici şifresi en az 8 karakter olmalıdır.")
    otp_doc = await db.otp_codes.find_one(
        {"phone": phone, "purpose": "password_reset", "used": False},
        sort=[("created_at", -1)],
    )
    _rp_hash = hashlib.sha256(otp_code.encode("utf-8")).hexdigest()
    _rp_ok = bool(otp_doc) and bool(otp_doc.get("code_hash")) and hmac.compare_digest(
        str(otp_doc.get("code_hash")), _rp_hash
    )
    if not _rp_ok:
        raise HTTPException(status_code=400, detail="SMS kodu hatali veya gecersiz.")
    exp = otp_doc.get("expires_at")
    if exp is not None:
        from datetime import timezone as _tz
        exp_cmp = exp if getattr(exp, "tzinfo", None) else exp.replace(tzinfo=_tz.utc)
        if now_utc() > exp_cmp:
            raise HTTPException(status_code=400, detail="SMS kodunun suresi doldu. Yeni kod isteyin.")
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"password_hash": hash_password(new_password), "updated_at": now_utc()}},
    )
    await db.otp_codes.update_one({"_id": otp_doc["_id"]}, {"$set": {"used": True}})
    # Şifre değişti -> tüm eski oturumları düşür
    await db.user_sessions.delete_many({"user_id": user["user_id"]})
    await _insert_log("log_auth", {
        "user_id": user["user_id"], "phone_masked": _mask_phone(phone),
        "action": "profile_updated",
        "change_details": {"field": "password", "old_value": "[reset_via_sms]", "new_value": "[masked]"}
    }, request)
    return {"success": True, "message": "Sifreniz basariyla guncellendi. Giris yapabilirsiniz."}
