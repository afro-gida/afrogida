"""Bildirim gönderimi:
  - Expo Push (native iOS/Android)  : send_push_to_users / send_push_to_all
  - Web Push (VAPID)                 : send_web_push_to_all / send_web_push_to_user
  - Kurye pazarlarına Expo push      : send_push_to_courier_markets

Abonelik kayıt/sorgu endpoint'leri server.py'de (ileride routers/push.py).
"""
import json
import logging
import os

import httpx
from pywebpush import WebPushException, webpush

from core.db import db

logger = logging.getLogger("afro.push")

EXPO_PUSH_API = "https://exp.host/--/api/v2/push/send"
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_PEM = os.getenv("VAPID_PRIVATE_PEM", "").replace("\\n", "\n")
VAPID_CONTACT = os.getenv("VAPID_CONTACT", "mailto:info@afrogida.com.tr")


# ---------------- Expo Push ----------------
async def send_push_to_users(user_ids: list, title: str, body: str, data: dict = None, badge: int = 1) -> int:
    """Verilen user_id listesindeki kullanıcılara Expo push. Gönderilen mesaj sayısı."""
    if not user_ids:
        return 0
    tokens_cursor = db.push_tokens.find(
        {"user_id": {"$in": list(user_ids)}, "push_token": {"$exists": True, "$ne": ""}},
        {"_id": 0, "push_token": 1},
    )
    tokens = [doc["push_token"] async for doc in tokens_cursor]
    if not tokens:
        return 0

    messages = [
        {
            "to": token, "title": title, "body": body, "data": data or {},
            "sound": "default", "badge": badge, "priority": "high",
        }
        for token in tokens
        if token and token.startswith("ExponentPushToken")
    ]
    if not messages:
        return 0

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                EXPO_PUSH_API, json=messages,
                headers={"Accept": "application/json", "Content-Type": "application/json"},
            )
            resp.raise_for_status()
        return len(messages)
    except Exception as e:
        logger.warning("[push] Expo push gönderme hatası: %s", e)
        return 0


async def send_push_to_all(title: str, body: str, data: dict = None) -> int:
    """Tüm kayıtlı push token'larına bildirim (kampanya vb.)."""
    tokens_cursor = db.push_tokens.find(
        {"push_token": {"$exists": True, "$ne": ""}}, {"_id": 0, "push_token": 1}
    )
    tokens = [doc["push_token"] async for doc in tokens_cursor]
    if not tokens:
        return 0
    messages = [
        {"to": t, "title": title, "body": body, "data": data or {}, "sound": "default", "priority": "high"}
        for t in tokens if t and t.startswith("ExponentPushToken")
    ]
    if not messages:
        return 0
    try:
        sent = 0
        async with httpx.AsyncClient(timeout=20) as client:
            for i in range(0, len(messages), 100):  # Expo API max 100 mesaj/istek
                chunk = messages[i:i + 100]
                resp = await client.post(
                    EXPO_PUSH_API, json=chunk,
                    headers={"Accept": "application/json", "Content-Type": "application/json"},
                )
                resp.raise_for_status()
                sent += len(chunk)
        return sent
    except Exception as e:
        logger.warning("[push] Toplu push hatası: %s", e)
        return 0


async def send_push_to_courier_markets(market_names: list, title: str, body: str, data: dict = None) -> int:
    """Belirli pazarlara atanmış kuryelere Expo push."""
    if not market_names:
        return 0
    couriers = await db.users.find(
        {
            "role": "kurye",
            "$or": [
                {"courier_markets": {"$in": market_names}},
                {"courier_market": {"$in": market_names}},
            ],
        },
        {"_id": 0, "user_id": 1},
    ).to_list(200)
    courier_ids = [c["user_id"] for c in couriers if c.get("user_id")]
    return await send_push_to_users(courier_ids, title, body, data)


# ---------------- Web Push (VAPID) ----------------
async def _send_web_push_one(sub: dict, title: str, body: str, data: dict = None) -> bool:
    """Tek aboneye web push. Başarısızlıkta (410/404) aboneliği siler."""
    if not VAPID_PUBLIC_KEY or not VAPID_PRIVATE_PEM:
        return False
    payload = json.dumps({
        "title": title, "body": body, "data": data or {},
        "icon": "/afro-logo.png", "badge": "/afro-logo.png",
    })
    sub_info = {"endpoint": sub["endpoint"], "keys": sub.get("keys", {})}
    try:
        webpush(
            subscription_info=sub_info,
            data=payload,
            vapid_private_key=VAPID_PRIVATE_PEM,
            vapid_claims={"sub": VAPID_CONTACT},
        )
        return True
    except WebPushException as e:
        code = (e.response.status_code if e.response is not None else 0)
        if code in (404, 410):
            await db.web_push_subs.delete_one({"endpoint": sub["endpoint"]})
            logger.debug("[webpush] abonelik sona erdi, silindi: %s", sub["endpoint"][:60])
        else:
            logger.warning("[webpush] gönderim hatası %s: %s", code, str(e)[:120])
        return False
    except Exception as e:
        logger.warning("[webpush] webpush hatası: %s", str(e)[:120])
        return False


async def send_web_push_to_all(title: str, body: str, data: dict = None) -> int:
    subs = [doc async for doc in db.web_push_subs.find({}, {"_id": 0})]
    ok = 0
    for sub in subs:
        if await _send_web_push_one(sub, title, body, data):
            ok += 1
    return ok


async def send_web_push_to_user(user_id: str, title: str, body: str, data: dict = None) -> int:
    subs = [doc async for doc in db.web_push_subs.find({"user_id": user_id}, {"_id": 0})]
    ok = 0
    for sub in subs:
        if await _send_web_push_one(sub, title, body, data):
            ok += 1
    return ok
