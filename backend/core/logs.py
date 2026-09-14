"""Denetim log sistemi (11 koleksiyon) + istek meta bilgisi + telefon maskeleme.

Bu modül yalnızca DB'ye yazar; güvenlik/SMS katmanlarına bağımlı değildir
(onlar buraya bağımlıdır).
"""
import logging
from datetime import timedelta

from core.db import db
from core.util import now_utc, new_id

logger = logging.getLogger("afro.logs")


def _mask_phone(phone):
    phone = str(phone or "")
    if len(phone) < 6:
        return phone or None
    return phone[:4] + "****" + phone[-2:]


def _extract_request_meta(request) -> dict:
    """Request'ten IP adresi ve User-Agent bilgisini çıkarır."""
    if request is None:
        return {"ip_address": "unknown", "user_agent": "unknown"}
    ip = ""
    try:
        ip = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
        if not ip:
            ip = request.headers.get("x-real-ip", "")
        if not ip and request.client:
            ip = request.client.host
    except Exception:
        pass
    return {
        "ip_address": ip or "unknown",
        "user_agent": request.headers.get("user-agent", "unknown") if request else "unknown",
    }


def _client_ip(request) -> str:
    return _extract_request_meta(request)["ip_address"]


async def _insert_log(collection_name: str, doc: dict, request=None) -> None:
    """Tüm log koleksiyonlarına güvenli INSERT. Hata ana işlemi ASLA durdurmaz."""
    try:
        if "created_at" not in doc:
            doc["created_at"] = now_utc()
        if request is not None:
            meta = _extract_request_meta(request)
            doc.setdefault("ip_address", meta["ip_address"])
            doc.setdefault("user_agent", meta["user_agent"])
        doc.setdefault("ip_address", "unknown")
        doc.setdefault("user_agent", "unknown")
        await db[collection_name].insert_one(doc)
    except Exception as exc:
        logger.error(f"[LOG] {collection_name} INSERT hatası: {exc}")


async def _log_sms_send(user_id, phone, sms_type, template, success, request=None, error_msg=None):
    """SMS gönderimi sonrası log kaydı."""
    await _insert_log("log_sms", {
        "user_id": user_id or None,
        "phone_masked": _mask_phone(phone),
        "sms_type": sms_type,
        "provider": "Verimor",
        "provider_message_id": None,
        "status": "sent" if success else "failed",
        "template_used": template,
        "error_message": error_msg,
    }, request)


async def _check_brute_force(phone: str, request=None):
    """Son 5 dakikada 5+ başarısız giriş → güvenlik logu."""
    try:
        five_min_ago = now_utc() - timedelta(minutes=5)
        count = await db.log_auth.count_documents({
            "phone_masked": _mask_phone(phone),
            "action": "login_failed",
            "created_at": {"$gte": five_min_ago},
        })
        if count >= 5:
            ip = _extract_request_meta(request)["ip_address"]
            await _insert_log("log_security", {
                "event_type": "brute_force_detected",
                "source_ip": ip,
                "user_id": None,
                "details": {"failed_attempts": count, "time_window_minutes": 5, "phone_attempted": _mask_phone(phone)},
                "severity": "high",
                "resolved": False,
            }, request)
    except Exception:
        pass


async def _check_otp_abuse(phone: str, request=None):
    """Son 1 saatte 10+ OTP isteği → güvenlik logu."""
    try:
        one_hour_ago = now_utc() - timedelta(hours=1)
        count = await db.log_sms.count_documents({
            "phone_masked": _mask_phone(phone),
            "sms_type": {"$in": ["otp_register", "otp_login"]},
            "created_at": {"$gte": one_hour_ago},
        })
        if count >= 10:
            ip = _extract_request_meta(request)["ip_address"]
            await _insert_log("log_security", {
                "event_type": "otp_abuse_detected",
                "source_ip": ip,
                "user_id": None,
                "details": {"otp_requests": count, "time_window_hours": 1, "phone_attempted": _mask_phone(phone)},
                "severity": "high",
                "resolved": False,
            }, request)
    except Exception:
        pass


async def _log_payment_restriction(action: str, user_id: str, details: str,
                                   order_id=None, admin_id=None, admin_note=None,
                                   sms_sent=None):
    """payment_restriction log kaydı (yasal ispat için)."""
    try:
        await db.payment_restriction_logs.insert_one({
            "id": new_id("prlog"),
            "log_type": "payment_restriction",
            "action": action,  # undelivered_warning | cash_blocked | cash_unblocked | exception_applied
            "user_id": user_id,
            "order_id": order_id,
            "details": details,
            "admin_id": admin_id,
            "admin_note": admin_note,
            "sms_sent": sms_sent,
            "created_at": now_utc(),
        })
    except Exception as exc:
        logger.error("[NO-SHOW LOG] Kayıt hatası: %s", exc)


async def _record_visit(request_data=None, current_user=None):
    """Ziyaret kaydı. Personel rolleri (admin/esnaf/kurye vb.) hiç sayılmaz.
    Üyeler GÜNDE 1 KEZ sayılır (upsert — aynı gün tekrar ziyarette yeni kayıt
    oluşturmaz, sayıyı şişirmez); üye olmayan (misafir) ziyaretçiler ayrı ve
    ham (tekilleştirilmeden) sayılır. `/admin/visits/report` bu ikisini
    ayrı sütunlar olarak döner (ana sayaç = üyeler)."""
    role = current_user.get("role") if current_user else None
    if current_user and role not in ("member", "musteri"):
        return {"success": True, "skipped": True, "reason": "non_member_role"}

    today = now_utc().date().isoformat()
    if current_user:
        await db.daily_visits.update_one(
            {"user_id": current_user.get("user_id"), "date": today, "kind": "member"},
            {"$setOnInsert": {
                "id": new_id("visit"),
                "kind": "member",
                "date": today,
                "created_at": now_utc(),
                "user_id": current_user.get("user_id"),
                "role": role,
            }},
            upsert=True,
        )
    else:
        await db.daily_visits.insert_one({
            "id": new_id("visit"),
            "kind": "guest",
            "date": today,
            "created_at": now_utc(),
            "user_id": None,
            "role": None,
            "payload": request_data or {},
        })
    return {"success": True, "date": today}
