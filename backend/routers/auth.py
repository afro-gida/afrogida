"""Kimlik doğrulama endpoint'leri: kayıt, giriş, yönetici 2FA, oturum,
profil/parola, adresler, telefon OTP, parola sıfırlama.

Yardımcılar: issue_welcome_coupon, _is_admin_role, _start_admin_2fa,
_normalize_address_payload/_validate_address_payload (adres) — hepsi burada.
"""
import asyncio
import hashlib
import hmac
import logging
import re
import secrets
import uuid
from datetime import timedelta, timezone
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request

from core.config import (
    EMERGENT_SESSION_API, WELCOME_DISCOUNT_AMOUNT, WELCOME_MIN_AMOUNT,
    ADMIN_2FA_PHONE, ADMIN_2FA_TTL_SEC, ADMIN_2FA_MAX_ATTEMPTS,
)
from core.crypto import _hmac_hex
from core.db import db
from core.logs import (
    _client_ip, _extract_request_meta, _insert_log, _log_sms_send, _mask_phone,
    _check_brute_force, _check_otp_abuse,
)
from core.security import (
    get_current_user, rate_limit, check_lockout, register_failure, clear_failures,
    create_session, _session_query, hash_password, verify_password, security_alarm,
)
from core.serializers import _public_user_doc
from core.util import now_utc, to_aware, new_id, _clean_text, _norm_limit
from models import (
    GoogleSessionInput, PhoneLoginInput, RegisterInput, LoginInput, AdminLoginInput,
    Admin2FAVerifyInput, Coupon,
)
from services.sms import send_sms_verimor, _normalize_sms_phone, _generate_sms_code

logger = logging.getLogger("afro.routers.auth")
logging = logger  # eski `logging.warning(...)` çağrıları için

router = APIRouter(prefix="/api")


@router.post("/auth/google")
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


@router.post("/auth/phone")
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


@router.post("/auth/register")
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


@router.post("/auth/admin/verify-2fa")
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


@router.post("/auth/login")
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


@router.post("/auth/admin")
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


@router.get("/auth/me")
async def auth_me(user=Depends(get_current_user)):
    return _public_user_doc(user)


@router.post("/auth/logout")
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


@router.put("/auth/profile")
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


@router.post("/auth/password")
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


@router.get("/auth/addresses")
async def list_auth_addresses(current_user: dict = Depends(get_current_user)):
    user = await db.users.find_one({"user_id": current_user["user_id"]}, {"_id": 0, "addresses": 1})
    addresses = user.get("addresses", []) if user else []
    if not addresses:
        addresses = await db.addresses.find({"user_id": current_user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return addresses


@router.post("/auth/addresses")
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


@router.put("/auth/addresses/{address_id}")
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


@router.delete("/auth/addresses/{address_id}")
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


@router.patch("/auth/addresses/{address_id}/default")
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
@router.get("/addresses")
async def compat_list_addresses(current_user: dict = Depends(get_current_user)):
    return await list_auth_addresses(current_user)


@router.post("/addresses")
async def compat_create_address(data: dict, current_user: dict = Depends(get_current_user)):
    return await create_auth_address(data, current_user)


@router.put("/addresses/{address_id}")
async def compat_update_address(address_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    return await update_auth_address(address_id, data, current_user)


@router.delete("/addresses/{address_id}")
async def compat_delete_address(address_id: str, current_user: dict = Depends(get_current_user)):
    return await delete_auth_address(address_id, current_user)


@router.patch("/addresses/{address_id}/default")
async def compat_set_default_address(address_id: str, current_user: dict = Depends(get_current_user)):
    return await set_default_auth_address(address_id, current_user)


# --- telefon OTP (kayıt/giriş/parola sıfırlama öncesi) ---
@router.post("/auth/send-phone-otp")
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


# --- Şifremi Unuttum: OTP ile doğrulama -> yeni şifre ---

# ─────────────────────────────────────────────────────────────────
# SIFREMI UNUTTUM: OTP ile dogrulama -> yeni sifre
# ─────────────────────────────────────────────────────────────────
@router.post("/auth/reset-password")
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
