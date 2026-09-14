"""Afro güvenlik katmanı: oturum, kimlik doğrulama bağımlılıkları, hız sınırı,
hesap kilidi, güvenlik alarmı, yönetici oturum izleme + watchdog, rol yardımcıları.
"""
import asyncio
import hashlib
import logging
import secrets
from datetime import timedelta
from typing import List, Optional

import bcrypt
from fastapi import Depends, Header, HTTPException, Request
from pymongo import ReturnDocument

from core.config import (
    ADMIN_SESSION_HOURS, SESSION_DURATION_DAYS,
    SECURITY_ADMIN_PHONE, SECURITY_SMS_THROTTLE_MIN,
)
from core.crypto import hash_token
from core.db import db
from core.logs import _extract_request_meta, _insert_log, _log_sms_send, _mask_phone
from core.util import now_utc, to_aware, _afro_norm
from services.noshow import _maybe_expire_no_show
from services.sms import send_sms_verimor

logger = logging.getLogger("afro.security")


# ---- Güvenlik alarmı ----
_SECURITY_LABELS = {
    "order_tamper_attempt": "SIPARIS MANIPULASYONU",
    "coupon_abuse_attempt": "KUPON MANIPULASYONU",
    "payment_amount_mismatch": "ODEME TUTARI UYUSMAZLIGI",
    "admin_lockout": "YONETICI GIRISI KILITLENDI",
    "login_lockout": "HESAP GIRISI KILITLENDI",
    "fake_product_attempt": "SAHTE URUN DENEMESI",
    "order_price_mismatch": "FIYAT UYUSMAZLIGI",
    "admin_unverified_session": "DOGRULAMASIZ YONETICI OTURUMU TESPIT EDILDI",
    "admin_session_ip_change": "YONETICI OTURUMU FARKLI IP'DEN KULLANILDI",
    "admin_session_hijack": "YONETICI OTURUMU ELE GECIRILMIS OLABILIR",
    "admin_watchdog_purge": "GUVENLIK TARAMASI: SAHTE YONETICI OTURUMU IMHA EDILDI",
    "coupon_high_discount": "YUKSEK TUTARLI KUPON",
    "coupon_user_use_burst": "MUSTERI COK KUPON KULLANDI",
    "coupon_admin_burst": "ADMIN COK KUPON ISLEMI YAPTI",
    "coupon_daily_total_anomaly": "GUNLUK KUPON TOPLAMI ANORMAL",
    "coupon_anomaly_detection_toggled": "KUPON ANOMALI TESPITI ACILDI/KAPATILDI",
}


async def security_alarm(event_type: str, details: dict, request=None, user=None, severity: str = "critical",
                          notify: bool = True, bypass_throttle: bool = False):
    """Güvenlik olayını kaydeder, kullanıcıyı işaretler, yöneticiye SMS gönderir (10 dk'da 1 kez / olay tipi).

    bypass_throttle=True: bu 10 dk'lık kısıtlamayı atlar — SEYREK ve
    KESİNLİKLE KAÇIRILMAMASI gereken tek seferlik olaylar için (ör. bir
    güvenlik özelliğinin admin tarafından açılıp/kapatılması). Diğer tüm
    çağrılarda varsayılan (False) davranış DEĞİŞMEDİ."""
    meta = _extract_request_meta(request)
    uid = (user or {}).get("user_id")
    try:
        await _insert_log("log_security", {
            "event_type": event_type,
            "source_ip": meta["ip_address"],
            "user_id": uid,
            "details": details or {},
            "severity": severity,
            "resolved": False,
            "action_taken": "işlem iptal edildi" if severity in ("high", "critical") else "kaydedildi",
        }, request)
        if uid and severity in ("high", "critical"):
            await db.users.update_one(
                {"user_id": uid},
                {"$inc": {"security_flags": 1},
                 "$set": {"last_security_event": now_utc(), "last_security_event_type": event_type}},
            )
    except Exception as exc:
        logger.error(f"[GÜVENLİK] alarm kaydı hatası: {exc}")
    if not notify or not SECURITY_ADMIN_PHONE:
        return
    try:
        if not bypass_throttle:
            since = now_utc() - timedelta(minutes=SECURITY_SMS_THROTTLE_MIN)
            recent = await db.security_alarm_sms.find_one({"event_type": event_type, "sent_at": {"$gte": since}})
            if recent:
                return
        label = _SECURITY_LABELS.get(event_type, event_type.upper())
        who = (user or {}).get("name") or "bilinmiyor"
        phone_m = _mask_phone((user or {}).get("phone") or "") if user else ""
        short = str((details or {}).get("summary") or "")[:70]
        msg = f"AFRO GUVENLIK ALARMI: {label}. Kullanici: {who} {phone_m}. IP: {meta['ip_address']}. {short} Islem iptal edildi, panel > Guvenlik Loglari."
        sent = await asyncio.to_thread(send_sms_verimor, SECURITY_ADMIN_PHONE, msg)
        await db.security_alarm_sms.insert_one({"event_type": event_type, "sent_at": now_utc(), "sms_sent": bool(sent), "user_id": uid})
        await _log_sms_send(None, SECURITY_ADMIN_PHONE, "security_alarm", "guvenlik_alarmi_v1", bool(sent), request)
    except Exception as exc:
        logger.error(f"[GÜVENLİK] alarm SMS hatası: {exc}")


# ---- Hız sınırı & hesap kilidi (Mongo tabanlı; tüm worker'lar için ortak) ----
async def rate_limit(key: str, limit: int, window_sec: int, detail: str = "Çok fazla deneme. Lütfen biraz sonra tekrar deneyin.") -> int:
    try:
        bucket = int(now_utc().timestamp() // window_sec)
        doc = await db.rate_limits.find_one_and_update(
            {"key": key, "bucket": bucket},
            {"$inc": {"count": 1}, "$setOnInsert": {"expires_at": now_utc() + timedelta(seconds=window_sec * 2)}},
            upsert=True, return_document=ReturnDocument.AFTER,
        )
        count = int((doc or {}).get("count") or 0)
    except Exception as exc:
        logger.error(f"[GÜVENLİK] rate_limit hatası: {exc}")
        return 0
    if count > limit:
        raise HTTPException(status_code=429, detail=detail)
    return count


async def check_lockout(key: str, detail: str = "Çok fazla hatalı deneme. Hesap 15 dakika kilitlendi."):
    doc = await db.login_lockouts.find_one({"key": key}, {"_id": 0})
    if doc and doc.get("locked_until") and to_aware(doc["locked_until"]) > now_utc():
        raise HTTPException(status_code=429, detail=detail)


async def register_failure(key: str, request=None, max_fail: int = 5, lock_minutes: int = 15, alarm_event: str = None, user=None, details: dict = None) -> bool:
    """Başarısız deneme sayar; eşik aşılırsa kilitler (ve istenirse alarm verir). Kilitlendiyse True."""
    now = now_utc()
    doc = await db.login_lockouts.find_one_and_update(
        {"key": key},
        {"$inc": {"fails": 1}, "$set": {"last_fail_at": now, "expires_at": now + timedelta(hours=24)},
         "$setOnInsert": {"first_fail_at": now}},
        upsert=True, return_document=ReturnDocument.AFTER,
    )
    first = to_aware(doc.get("first_fail_at") or now)
    fails = int(doc.get("fails") or 0)
    if now - first > timedelta(minutes=lock_minutes):
        await db.login_lockouts.update_one({"key": key}, {"$set": {"fails": 1, "first_fail_at": now}})
        return False
    if fails >= max_fail:
        await db.login_lockouts.update_one({"key": key}, {"$set": {"locked_until": now + timedelta(minutes=lock_minutes), "fails": 0, "first_fail_at": now}})
        if alarm_event:
            await security_alarm(alarm_event, {"key": key, "fails": fails, "lock_minutes": lock_minutes, "summary": f"{fails} hatali deneme", **(details or {})}, request, user, severity="high", notify=True)
        return True
    return False


async def clear_failures(key: str):
    try:
        await db.login_lockouts.delete_one({"key": key})
    except Exception:
        pass


# ---- Parola ----
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


# ---- Oturum ----
async def create_session(user_id: str, token: Optional[str] = None, request=None, twofa: bool = False) -> str:
    """Oturum token'ı istemciye verilir; DB'de yalnızca HMAC özeti saklanır.
    Yönetici/admin oturumları ADMIN_SESSION_HOURS (12 saat) sonra düşer."""
    session_token = token or secrets.token_hex(32)
    role = None
    try:
        _u = await db.users.find_one({"user_id": user_id}, {"_id": 0, "role": 1})
        role = (_u or {}).get("role")
    except Exception:
        pass
    is_admin = role in ("admin", "yonetici")
    if is_admin and not twofa:
        logger.error("[GÜVENLİK] 2FA'sız yönetici oturumu denemesi engellendi user_id=%s", user_id)
        raise HTTPException(status_code=403, detail="Yönetici girişi SMS doğrulaması gerektirir")
    ttl = timedelta(hours=ADMIN_SESSION_HOURS) if is_admin else timedelta(days=SESSION_DURATION_DAYS)
    meta = _extract_request_meta(request)
    await db.user_sessions.insert_one({
        "token_hash": hash_token(session_token),
        "user_id": user_id,
        "role": role,
        "is_admin": is_admin,
        "twofa_verified": bool(twofa),
        "ip_address": meta["ip_address"],
        "ua_hash": hashlib.sha256((meta["user_agent"] or "").encode("utf-8")).hexdigest()[:16],
        "created_at": now_utc(),
        "expires_at": now_utc() + ttl,
    })
    return session_token


def _session_query(token: str) -> dict:
    """Yeni (hash'li) ve eski (düz) oturum kayıtlarının ikisini de bulur."""
    return {"$or": [{"token_hash": hash_token(token)}, {"session_token": token}]}


async def get_current_user(authorization: Optional[str] = Header(None), request: Request = None):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Yetkilendirme gerekli")
    token = authorization.split(" ", 1)[1].strip()
    if not token or len(token) > 200:
        raise HTTPException(status_code=401, detail="Geçersiz oturum")
    session = await db.user_sessions.find_one(_session_query(token), {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Geçersiz oturum")
    if to_aware(session["expires_at"]) < now_utc():
        await db.user_sessions.delete_one(_session_query(token))
        raise HTTPException(status_code=401, detail="Oturum süresi doldu")
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Kullanıcı bulunamadı")
    if user.get("login_disabled"):
        raise HTTPException(status_code=403, detail="Hesap devre dışı")
    if user.get("role") in ("admin", "yonetici") and not session.get("twofa_verified"):
        await db.user_sessions.delete_one(_session_query(token))
        asyncio.ensure_future(security_alarm(
            "admin_unverified_session",
            {"summary": "SMS doğrulaması yapılmamış yönetici oturumu tespit edildi ve imha edildi."},
            None, user, severity="critical", notify=True,
        ))
        raise HTTPException(status_code=401, detail="Yönetici oturumu için SMS doğrulaması gerekli. Lütfen tekrar giriş yapın.")
    if user.get("role") in ("admin", "yonetici") and session.get("twofa_verified"):
        asyncio.ensure_future(_admin_session_track(session, request))
    user = await _maybe_expire_no_show(user)
    return user


async def get_current_user_optional(authorization: Optional[str] = Header(None)):
    """Optional auth - token yoksa veya geçersizse None döner (exception fırlatmaz)."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization.split(" ", 1)[1].strip()
    if not token or len(token) > 200:
        return None
    session = await db.user_sessions.find_one(_session_query(token), {"_id": 0})
    if not session:
        return None
    if to_aware(session["expires_at"]) < now_utc():
        await db.user_sessions.delete_one(_session_query(token))
        return None
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        return None
    if user.get("role") in ("admin", "yonetici") and not session.get("twofa_verified"):
        await db.user_sessions.delete_one(_session_query(token))
        return None
    user = await _maybe_expire_no_show(user)
    return user


# ─────────────────────────────────────────────────────────────────────────────
# YÖNETİCİ OTURUM İZLEME — IP takibi + watchdog
# ─────────────────────────────────────────────────────────────────────────────
async def _admin_session_track(session: dict, request=None):
    """Her admin isteğinde oturumun son görülme zamanını ve IP'sini günceller.
    IP giriş anındakinden farklıysa → SMS alarm (oturum çalınmış olabilir)."""
    try:
        meta = _extract_request_meta(request)
        cur_ip = meta.get("ip_address") or "unknown"
        login_ip = session.get("ip_address") or "unknown"
        token_hash = session.get("token_hash")
        now = now_utc()
        await db.user_sessions.update_one(
            {"token_hash": token_hash},
            {"$set": {"last_seen_at": now, "last_seen_ip": cur_ip}},
        )
        if cur_ip != "unknown" and login_ip != "unknown" and cur_ip != login_ip:
            ip_changes = int(session.get("ip_change_count") or 0) + 1
            await db.user_sessions.update_one(
                {"token_hash": token_hash},
                {"$set": {"ip_change_count": ip_changes, "last_foreign_ip": cur_ip}},
            )
            if ip_changes == 1:
                user_doc = await db.users.find_one({"user_id": session.get("user_id")}, {"_id": 0})
                await security_alarm(
                    "admin_session_ip_change",
                    {"login_ip": login_ip, "current_ip": cur_ip,
                     "summary": f"Yönetici oturumu giriş IP'si ({login_ip}) ile mevcut IP ({cur_ip}) farklı."},
                    request, user_doc, severity="high", notify=False,
                )
            elif ip_changes in (3, 8, 20):
                user_doc = await db.users.find_one({"user_id": session.get("user_id")}, {"_id": 0})
                await security_alarm(
                    "admin_session_ip_change",
                    {"login_ip": login_ip, "current_ip": cur_ip, "ip_changes": ip_changes,
                     "summary": f"Yonetici oturumu {ip_changes} farkli IP'den kullanildi (mobil ag olabilir)."},
                    request, user_doc, severity="high", notify=False,
                )
    except Exception as _e:
        logger.error("[GÜVENLİK] admin_session_track hatası: %s", _e)


async def _admin_watchdog_loop():
    """Her 2 dakikada bir tüm yönetici oturumlarını tarar; 2FA'sız oturumları imha eder."""
    await asyncio.sleep(30)
    while True:
        try:
            adm_ids = [u["user_id"] async for u in db.users.find(
                {"role": {"$in": ["admin", "yonetici"]}}, {"_id": 0, "user_id": 1}
            )]
            bad = db.user_sessions.find(
                {"user_id": {"$in": adm_ids}, "twofa_verified": {"$ne": True}},
                {"_id": 0, "token_hash": 1, "user_id": 1, "ip_address": 1, "created_at": 1},
            )
            async for sess in bad:
                await db.user_sessions.delete_one({"token_hash": sess.get("token_hash")})
                user_doc = await db.users.find_one({"user_id": sess.get("user_id")}, {"_id": 0})
                await security_alarm(
                    "admin_watchdog_purge",
                    {"summary": "Periyodik tarama: SMS doğrulamasız yönetici oturumu tespit edilip imha edildi.",
                     "session_ip": sess.get("ip_address"), "created_at": str(sess.get("created_at"))},
                    None, user_doc, severity="critical", notify=True,
                )
                logger.warning("[GÜVENLİK] watchdog: 2FA'sız yönetici oturumu imha edildi user_id=%s", sess.get("user_id"))
        except Exception as _e:
            logger.error("[GÜVENLİK] admin_watchdog_loop hatası: %s", _e)
        await asyncio.sleep(120)


# ---- Kimlik doğrulama bağımlılıkları (Depends) ----
async def get_current_admin(user=Depends(get_current_user)):
    if user.get("role") not in ("admin", "yonetici"):
        raise HTTPException(status_code=403, detail="Yönetici yetkisi gerekli")
    return user


PAZAR_SORUMLUSU_ROLES = ("pazar_sorumlusu",)


async def get_current_pazar_sorumlusu(user=Depends(get_current_user)):
    """Pazar Sorumlusu VEYA tam admin/yönetici erişebilir (admin denetim için
    — get_current_courier ile aynı desen). ÖNEMLİ: "yonetici" rolü DB'de
    zaten tam admin anlamına geliyor (gerçek üretim admin hesabı bu rolde) —
    bu YENİ kısıtlı rol bilerek ayrı bir string ("pazar_sorumlusu") kullanır,
    "yonetici" ile KARIŞTIRILMAMALI/birleştirilmemelidir."""
    if user.get("role") not in ("admin", "yonetici", "pazar_sorumlusu"):
        raise HTTPException(status_code=403, detail="Pazar sorumlusu yetkisi gerekli")
    return user


def is_pazar_sorumlusu_role(user: dict) -> bool:
    return (user or {}).get("role") in PAZAR_SORUMLUSU_ROLES


def get_user_managed_markets(user: dict) -> List[str]:
    """Pazar Sorumlusu'nun yönettiği pazar ID'leri (kurye'deki courier_markets
    ile aynı desen). Tam admin/yönetici için anlamsız (boş liste döner) —
    onlar zaten /admin/* uçlarını kısıtlamasız kullanır."""
    if not user:
        return []
    mkts = user.get("managed_markets")
    return [m for m in mkts if m] if isinstance(mkts, list) else []


async def get_current_supplier(user=Depends(get_current_user)):
    if user.get("role") not in ("esnaf", "supplier"):
        raise HTTPException(status_code=403, detail="Tedarikçi yetkisi gerekli")
    supplier_group = get_user_supplier_group(user)
    if not supplier_group:
        raise HTTPException(status_code=403, detail="Tedarikçi grubu atanmamış")
    return user


async def get_current_staff(user=Depends(get_current_user)):
    if user.get("role") not in ("admin", "yonetici", "esnaf", "supplier"):
        raise HTTPException(status_code=403, detail="Yetki gerekli")
    return user


def _yonetici_only(user: dict):
    """Bir `get_current_admin` sonucunu daha da daraltır: sadece admin/yonetici."""
    if user.get("role") not in ("admin", "yonetici"):
        raise HTTPException(status_code=403, detail="Bu işlem için yönetici yetkisi gerekli")


async def get_current_courier(user=Depends(get_current_user)):
    """Kurye VEYA yönetici erişebilir (yönetici test/denetim için)."""
    if user.get("role") not in ("admin", "yonetici", "kurye"):
        raise HTTPException(status_code=403, detail="Kurye yetkisi gerekli")
    return user


async def get_optional_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        return None
    try:
        return await get_current_user(authorization)
    except HTTPException:
        return None


# ---- Rol yardımcıları ----
SUPPLIER_ROLES = ("esnaf", "supplier")
COURIER_ROLES = ("kurye",)


def is_supplier_role(user: dict) -> bool:
    return (user or {}).get("role") in SUPPLIER_ROLES


def get_user_supplier_group(user: dict) -> Optional[str]:
    """Kullanıcının bağlı olduğu tedarikçi grubu (supplier_group veya supplier_name)."""
    if not user:
        return None
    return user.get("supplier_group") or user.get("supplier_name")


def is_courier_role(user: dict) -> bool:
    return (user or {}).get("role") in COURIER_ROLES


def get_user_courier_markets(user: dict) -> List[str]:
    """Kurye'nin atandığı pazar listesi (eski tek-pazar + yeni çok-pazar geriye uyumlu)."""
    if not user:
        return []
    mkts = user.get("courier_markets")
    if mkts and isinstance(mkts, list):
        return [m for m in mkts if m]
    single = user.get("courier_market")
    return [single] if single else []


def get_user_courier_market(user: dict) -> Optional[str]:
    """Geriye uyumluluk için ilk pazar (yoksa None)."""
    mkts = get_user_courier_markets(user)
    return mkts[0] if mkts else None


def _afro_market_eq(a, b) -> bool:
    """İki pazar adını büyük/küçük harf ve boşluk duyarsız karşılaştır."""
    return _afro_norm(a or "") == _afro_norm(b or "")
