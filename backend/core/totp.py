"""Authenticator (TOTP, RFC 6238) ve tek kullanımlık yedek kodlar.

Google Authenticator / Apple Şifreler / Microsoft Authenticator ile uyumlu:
SHA1, 30 sn, 6 hane. Dış kütüphane yok (stdlib hmac).
"""
import base64
import hashlib
import hmac
import secrets
import struct
import time
from typing import Optional
from urllib.parse import quote

STEP = 30
DIGITS = 6
# Saat kayması için ± bir adım (toplam ~90 sn pencere)
WINDOW = 1


def new_secret() -> str:
    """160 bit rastgele gizli anahtar (base32, '=' dolgusuz)."""
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def _key(secret: str) -> bytes:
    s = secret.strip().replace(" ", "").upper()
    return base64.b32decode(s + "=" * (-len(s) % 8))


def code_at(secret: str, counter: int) -> str:
    digest = hmac.new(_key(secret), struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(value % (10 ** DIGITS)).zfill(DIGITS)


def verify(secret: str, code: str, last_counter: Optional[int] = None, now: Optional[float] = None) -> Optional[int]:
    """Kod geçerliyse kullanılan zaman adımını döndürür, değilse None.
    last_counter verilirse o adım ve öncekiler reddedilir (aynı kod iki kez
    kullanılamaz — tekrar saldırısı)."""
    code = "".join(ch for ch in str(code or "") if ch.isdigit())
    if len(code) != DIGITS or not secret:
        return None
    current = int((time.time() if now is None else now) // STEP)
    for counter in range(current - WINDOW, current + WINDOW + 1):
        if last_counter is not None and counter <= last_counter:
            continue
        if hmac.compare_digest(code_at(secret, counter), code):
            return counter
    return None


def provisioning_uri(secret: str, account: str, issuer: str = "Afro Gida Yonetim") -> str:
    label = quote(f"{issuer}:{account}")
    return f"otpauth://totp/{label}?secret={secret}&issuer={quote(issuer)}&algorithm=SHA1&digits={DIGITS}&period={STEP}"


# ---- Yedek kodlar (telefon kaybı için) ----

def new_backup_codes(n: int = 8) -> list:
    """'ABCD-EFGH' biçiminde n kod; kullanıcıya YALNIZCA bir kez gösterilir."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # karışan 0/O, 1/I yok
    out = []
    for _ in range(n):
        raw = "".join(secrets.choice(alphabet) for _ in range(8))
        out.append(f"{raw[:4]}-{raw[4:]}")
    return out


def normalize_backup(code: str) -> str:
    return "".join(ch for ch in str(code or "").upper() if ch.isalnum())


def hash_backup(code: str) -> str:
    return hashlib.sha256(("afro-backup|" + normalize_backup(code)).encode("utf-8")).hexdigest()
