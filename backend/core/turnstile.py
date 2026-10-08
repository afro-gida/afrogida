"""Robot doğrulaması (Cloudflare Turnstile).

SMS gönderen uçlarda istemci, sayfadaki Turnstile kutusunun verdiği tek
kullanımlık token'ı `turnstile_token` olarak yollar; sunucu Cloudflare'e sorar.

TURNSTILE_SECRET_KEY tanımlı değilse doğrulama KAPALIDIR (anahtar alınana kadar
site eskisi gibi çalışır). Cloudflare'e ulaşılamazsa istek geçirilir (hız
sınırları yine geçerli) — Cloudflare kesintisinde kimse üye olamaz hale gelmesin.
"""
import logging
import os
from typing import Optional

import httpx
from fastapi import HTTPException

logger = logging.getLogger("afro.turnstile")

VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


def turnstile_enabled() -> bool:
    return bool((os.environ.get("TURNSTILE_SECRET_KEY") or "").strip())


async def verify_turnstile(token: Optional[str], ip: Optional[str] = None) -> None:
    secret = (os.environ.get("TURNSTILE_SECRET_KEY") or "").strip()
    if not secret:
        return
    token = (token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="Lütfen robot doğrulamasını tamamlayın.")
    data = {"secret": secret, "response": token}
    if ip and ip != "unknown":
        data["remoteip"] = ip
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            res = await client.post(VERIFY_URL, data=data)
            body = res.json()
    except Exception as exc:  # noqa: BLE001
        logger.error(f"[GÜVENLİK] Turnstile'a ulaşılamadı, istek geçirildi: {exc!r}")
        return
    if not body.get("success"):
        logger.warning(f"[GÜVENLİK] Turnstile reddetti: {body.get('error-codes')}")
        raise HTTPException(status_code=400, detail="Robot doğrulaması başarısız. Kutuyu yeniden işaretleyip tekrar deneyin.")
