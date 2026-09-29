"""Teslim kodu — müşteriye SMS ile gider, teslimde kuryeye / tezgaha söylenir.

Kural (kullanıcı kararı 2026-09-29):
  - Gel-Al: sipariş "Hazır" olunca üretilir.
  - Eve Servis: kurye "Yola Çıktım" deyince ("yolda") üretilir.
  - İkisinde de Türkiye saatiyle o GÜNÜN SONUNA (23:59:59) kadar geçerli.
Kod kuryeye / sorumluya gösterilmez; sadece müşteride.
"""
from datetime import datetime
from zoneinfo import ZoneInfo

from core.crypto import dec_str, enc_str
from core.db import db
from core.util import now_utc
from services.sms import _generate_sms_code, send_delivery_sms

IST = ZoneInfo("Europe/Istanbul")


def end_of_day_istanbul():
    """Bugünün 23:59:59'u (Türkiye saati), UTC'ye çevrilmiş."""
    now_ist = datetime.now(IST)
    return now_ist.replace(hour=23, minute=59, second=59, microsecond=0).astimezone(ZoneInfo("UTC"))


def code_due(order: dict, new_status: str) -> bool:
    """Bu durum geçişinde teslim kodu üretilmeli mi?"""
    eve = (order.get("delivery_type") or "") == "eve_servis"
    return new_status == ("yolda" if eve else "hazir")


async def issue_delivery_code(order: dict, tx_id: str) -> dict:
    """Kodu üretir (varsa aynısını korur), süresini gün sonu yapar, müşteriye
    SMS gönderir; sipariş kaydına yazılacak alanları döndürür."""
    code = dec_str(order.get("delivery_code")) or _generate_sms_code()
    phone = None
    if order.get("user_id"):
        u = await db.users.find_one({"user_id": order["user_id"]}, {"_id": 0, "phone": 1})
        phone = (u or {}).get("phone")
    phone = phone or order.get("phone") or order.get("customer_phone")
    sent = send_delivery_sms(phone, tx_id, code) if phone else False
    state = "sent" if sent else "failed"
    return {
        "delivery_code": enc_str(code),
        "delivery_code_expires_at": end_of_day_istanbul(),
        "delivery_sms_sent": sent,
        "delivery_sms_sent_at": now_utc() if sent else None,
        "sms_status": state,
        "pickup_sms_status": state,
    }
