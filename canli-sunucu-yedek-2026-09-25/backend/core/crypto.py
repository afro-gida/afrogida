"""Afro güvenlik primitifleri:
  - Uçtan uca şifreleme (Fernet) : enc_str / dec_str / is_encrypted
  - HMAC-SHA256                   : _hmac_hex
  - Oturum token'ı DB özeti       : hash_token
  - Sipariş bütünlük imzası       : order_signature / verify_order_signature

Anahtarlar core.config'ten gelir (AFRO_SECRET_KEY, AFRO_ENC_KEY). Anahtar
olmadan DB'deki şifreli alanlar OKUNAMAZ.
"""
import base64
import hashlib
import hmac
import json
import logging

from core.config import AFRO_SECRET_KEY, _AFRO_ENC_RAW, ENC_PREFIX
from core.money import D, money_d

logger = logging.getLogger("afro.crypto")

try:
    from cryptography.fernet import Fernet, InvalidToken
except Exception:  # pragma: no cover
    Fernet = None
    InvalidToken = Exception


def _afro_fernet():
    if Fernet is None:
        logger.error("[GÜVENLİK] cryptography modülü yok — şifreleme devre dışı!")
        return None
    key = base64.urlsafe_b64encode(hashlib.sha256(_AFRO_ENC_RAW.encode("utf-8")).digest())
    return Fernet(key)


_AFRO_FERNET = _afro_fernet()


def enc_str(value):
    """Metni şifreler -> 'enc:v1:<token>'. Boş/None aynen döner. Zaten şifreliyse dokunmaz."""
    if value is None or value == "":
        return value
    s = str(value)
    if s.startswith(ENC_PREFIX) or _AFRO_FERNET is None:
        return s
    try:
        return ENC_PREFIX + _AFRO_FERNET.encrypt(s.encode("utf-8")).decode("ascii")
    except Exception as exc:
        logger.error(f"[GÜVENLİK] şifreleme hatası: {exc}")
        return s


def dec_str(value):
    """Şifreli metni çözer. Şifreli değilse (eski kayıt) aynen döner."""
    if value is None or value == "":
        return value
    s = str(value)
    if not s.startswith(ENC_PREFIX):
        return s
    if _AFRO_FERNET is None:
        return "[şifreli]"
    try:
        return _AFRO_FERNET.decrypt(s[len(ENC_PREFIX):].encode("ascii")).decode("utf-8")
    except (InvalidToken, Exception):
        return "[şifre çözülemedi]"


def is_encrypted(value) -> bool:
    return isinstance(value, str) and value.startswith(ENC_PREFIX)


def _hmac_hex(data: str) -> str:
    return hmac.new(AFRO_SECRET_KEY.encode("utf-8"), data.encode("utf-8"), hashlib.sha256).hexdigest()


def hash_token(token: str) -> str:
    """Oturum token'ının DB'de saklanan tek yönlü özeti (DB sızsa bile token kullanılamaz)."""
    return _hmac_hex("session|" + str(token or ""))


def order_signature(order: dict) -> str:
    items = []
    for it in (order.get("items") or []):
        items.append([
            str(it.get("id") or ""),
            str(D(it.get("qty"))),
            str(money_d(it.get("price"))),
            str(money_d(it.get("options_fee"))),
            str(money_d(it.get("line_total"))),
        ])
    payload = json.dumps({
        "tx_id": order.get("tx_id"),
        "user_id": order.get("user_id"),
        "items": items,
        "subtotal": str(money_d(order.get("subtotal"))),
        "delivery_fee": str(money_d(order.get("delivery_fee"))),
        "discount": str(money_d(order.get("discount"))),
        "amount": str(money_d(order.get("amount"))),
        "coupon_code": order.get("coupon_code") or "",
        "delivery_type": order.get("delivery_type"),
        "payment_method": order.get("payment_method"),
    }, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return _hmac_hex("order|" + payload)


def verify_order_signature(order: dict) -> bool:
    sig = order.get("calc_signature")
    if not sig:
        return False
    return hmac.compare_digest(str(sig), order_signature(order))
