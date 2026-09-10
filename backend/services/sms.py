"""Verimor SMS gönderimi + telefon/metin normalleştirme + teslim/no-show SMS'leri."""
import logging
import os
import random
from datetime import datetime
from typing import Optional

import httpx

logger = logging.getLogger("afro.sms")


def _tr_ascii(text: str) -> str:
    """Türkçe karakterleri ASCII'ye çevir (SMS GSM-7 uyumu / maliyet için)."""
    table = str.maketrans({
        "ç": "c", "Ç": "C", "ğ": "g", "Ğ": "G", "ı": "i", "İ": "I",
        "ö": "o", "Ö": "O", "ş": "s", "Ş": "S", "ü": "u", "Ü": "U",
    })
    return str(text or "").translate(table)


def _normalize_sms_phone(phone: str) -> str:
    """TR cep telefonu normalleştir ve doğrula.

    Geçerli formatlar: 05XXXXXXXXX, 5XXXXXXXXX, +905XXXXXXXXX
    05 ile başlamayanlar REDDEDİLİR. Döner: 905XXXXXXXXX veya "".
    """
    phone_clean = str(phone or "").replace(" ", "").replace("-", "").replace("(", "").replace(")", "").replace("+", "")
    if phone_clean.startswith("0"):
        phone_clean = phone_clean[1:]
    if phone_clean.startswith("90"):
        phone_clean = phone_clean[2:]
    if len(phone_clean) == 10 and phone_clean[0] == "5":
        return "90" + phone_clean
    return ""


def send_sms_verimor(phone: str, message: str) -> bool:
    """Verimor HTTP API ile SMS gönder."""
    username = os.environ.get("VERIMOR_USERNAME", "")
    password = os.environ.get("VERIMOR_PASSWORD", "")
    sender = os.environ.get("VERIMOR_SENDER", "AFROGIDA")

    if not username or not password:
        logger.error("[SMS] Verimor bilgileri eksik")
        return False

    phone_clean = _normalize_sms_phone(phone)
    if not phone_clean:
        logger.error("[SMS] Geçersiz telefon numarası (TR cep formatı değil veya 5 ile başlamıyor): %s", phone)
        return False

    payload = {
        "username": username,
        "password": password,
        "sender": sender,
        "messages": [{"msg": message, "dest": phone_clean}],
    }

    try:
        response = httpx.post("https://sms.verimor.com.tr/v2/send.json", json=payload, timeout=10)
        try:
            result = response.json()
        except Exception:
            result = {"raw": response.text[:300]}
        if response.status_code == 200:
            logger.info("[SMS] Başarıyla gönderildi: %s", phone_clean[-4:].rjust(len(phone_clean), "*"))
            return True
        logger.error("[SMS] Verimor hata status=%s response=%s", response.status_code, result)
        return False
    except Exception as exc:
        logger.error("[SMS] İstek hatası: %s", exc)
        return False


def _generate_sms_code() -> str:
    return f"{random.randint(0, 999999):06d}"


def send_delivery_sms(phone: str, order_id: str, delivery_code: str) -> bool:
    """Sipariş hazır olduğunda teslim kodu SMS'i gönder."""
    expiry_time = datetime.now().replace(hour=23, minute=59, second=0, microsecond=0)
    expiry_str = expiry_time.strftime("%d.%m.%Y 23:59")
    message = (
        "Afro Gida siparisiniz hazir!\n"
        f"Teslim kodu: {delivery_code}\n"
        f"Gecerlilik: {expiry_str}\n"
        f"Siparis No: {str(order_id)[:8].upper()}"
    )
    return send_sms_verimor(phone, message)


def _no_show_order_no(order: dict) -> str:
    """SMS'te gösterilecek kısa sipariş numarası."""
    if not order:
        return ""
    raw = order.get("order_number") or order.get("tx_id") or order.get("order_id") or ""
    return str(raw)[:8].upper()


def _send_no_show_sms(user: dict, order: dict, level: int, until: Optional[datetime]) -> Optional[bool]:
    """No-show cezası SMS'i gönder. level=1 uyarı, level>=2 kısıtlama.
    Döner: True/False (gönderim sonucu) veya None (telefon yok)."""
    phone = (user or {}).get("phone")
    if not phone:
        return None
    name = _tr_ascii((user or {}).get("name") or "Musterimiz")
    order_no = _no_show_order_no(order)
    if level <= 1:
        message = (
            f"Sayin {name}, #{order_no} numarali siparisiniz teslim alinmadi. "
            "Bu bir uyaridir. Tekrarinda kapida odeme seceneginiz kisitlanacaktir. - Afro Gida"
        )
    else:
        if level == 2:
            sure = "60 gun"
        elif level == 3:
            sure = "180 gun"
        else:
            sure = "1 yil"
        date_str = until.strftime("%d.%m.%Y") if until else ""
        message = (
            f"Sayin {name}, #{order_no} numarali siparisiniz teslim alinmadi. "
            f"Tekrari nedeniyle {sure} boyunca yalnizca online odeme ile siparis verebilirsiniz. "
            f"Kisitlama bitisi: {date_str}. - Afro Gida"
        )
    try:
        return send_sms_verimor(phone, message)
    except Exception as exc:
        logger.error("[NO-SHOW SMS] Gönderim hatası: %s", exc)
        return False
