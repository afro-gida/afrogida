"""Admin log okuma/bicimlendirme yardimcilari: TR etiket sozlukleri, tarih/durum
bicimlendirme, coklu koleksiyon sorgulama. Yazma tarafi icin core/logs.py'ye bakin."""
from core.db import db

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
