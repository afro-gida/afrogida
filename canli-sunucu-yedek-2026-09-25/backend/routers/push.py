"""Bildirim endpoint'leri — web push abonelik, VAPID key, admin push gönderimi,
push token kaydı, yönetici oturum kalp atışı.

Gönderim mantığı services/push.py'de; bu dosya sadece HTTP yüzeyi.
"""
from fastapi import APIRouter, Depends, HTTPException, Request

from core.db import db
from core.logs import _insert_log
from core.security import (
    get_current_user, get_current_user_optional, get_current_admin, _yonetici_only,
)
from core.util import now_utc
from services.push import (
    VAPID_PUBLIC_KEY, send_push_to_users, send_push_to_all, send_web_push_to_all,
)

router = APIRouter()


@router.post("/api/push/web-subscribe")
async def web_push_subscribe(data: dict, user=Depends(get_current_user_optional), request: Request = None):
    """Tarayıcıdan gelen PushSubscription nesnesini saklar."""
    endpoint = (data.get("endpoint") or "").strip()
    keys = data.get("keys") or {}
    if not endpoint or not keys.get("p256dh") or not keys.get("auth"):
        raise HTTPException(status_code=400, detail="Eksik abonelik bilgisi")
    doc = {
        "endpoint": endpoint,
        "keys": {"p256dh": keys["p256dh"], "auth": keys["auth"]},
        "user_id": (user or {}).get("user_id"),
        "ts": now_utc(),
    }
    await db.web_push_subs.update_one({"endpoint": endpoint}, {"$set": doc}, upsert=True)
    return {"ok": True}


@router.delete("/api/push/web-subscribe")
async def web_push_unsubscribe(data: dict, user=Depends(get_current_user_optional)):
    """Tarayıcıdan gelen aboneliği siler."""
    endpoint = (data.get("endpoint") or "").strip()
    if endpoint:
        await db.web_push_subs.delete_one({"endpoint": endpoint})
    return {"ok": True}


@router.get("/api/push/vapid-public-key")
async def get_vapid_public_key():
    return {"key": VAPID_PUBLIC_KEY}


@router.get("/api/auth/admin/heartbeat")
async def admin_heartbeat(user=Depends(get_current_user)):
    """Frontend her 90 sn'de çağırır; geçersiz/2FA'sız oturum anında fark edilsin diye."""
    if not user or user.get("role") not in ("admin", "yonetici"):
        raise HTTPException(status_code=403, detail="Yönetici yetkisi gerekli")
    return {"ok": True, "user_id": user.get("user_id"), "ts": now_utc().isoformat()}


@router.post("/api/admin/push/web-send")
async def admin_web_push_send(payload: dict, admin=Depends(get_current_admin)):
    """Admin: tüm web push abonelerine anlık bildirim gönderir."""
    _yonetici_only(admin)
    title = str(payload.get("title") or "Afro Gıda").strip()
    body = str(payload.get("body") or "").strip()
    if not body:
        raise HTTPException(status_code=400, detail="Mesaj boş olamaz")
    n = await send_web_push_to_all(title, body, payload.get("data"))
    return {"sent": n}


@router.post("/api/push-token")
async def register_push_token(data: dict, user=Depends(get_current_user)):
    token = str(data.get("push_token") or "").strip()
    if not token or not token.startswith("ExponentPushToken"):
        raise HTTPException(status_code=400, detail="Geçerli bir ExponentPushToken gerekli")
    platform = str(data.get("platform") or "android").strip()
    await db.push_tokens.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"user_id": user["user_id"], "push_token": token,
                  "platform": platform, "updated_at": now_utc()}},
        upsert=True,
    )
    return {"ok": True}


@router.post("/api/admin/push/send")
async def admin_send_push(request: Request, current_admin: dict = Depends(get_current_admin)):
    """Admin push bildirimi: target 'all' | 'users'."""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Geçersiz JSON")

    title = str(body.get("title", "")).strip()[:100]
    msg = str(body.get("body", "")).strip()[:300]
    target = str(body.get("target", "all"))
    user_ids = body.get("user_ids", [])
    url_path = str(body.get("url", "")).strip()[:200]

    if not title or not msg:
        raise HTTPException(status_code=422, detail="Başlık ve mesaj zorunludur")

    data_payload = {}
    if url_path:
        data_payload["url"] = url_path

    if target == "users" and user_ids:
        sent = await send_push_to_users(list(user_ids), title, msg, data=data_payload)
    else:
        sent = await send_push_to_all(title, msg, data=data_payload)

    await _insert_log("log_admin", {
        "action": "push_send", "admin_id": current_admin.get("user_id"),
        "title": title, "body": msg, "target": target, "sent_count": sent,
    }, request)
    return {"ok": True, "sent": sent}


@router.get("/api/admin/push/stats")
async def admin_push_stats(current_admin: dict = Depends(get_current_admin)):
    total = await db.push_tokens.count_documents({"push_token": {"$exists": True, "$ne": ""}})
    android = await db.push_tokens.count_documents({"platform": "android"})
    ios = await db.push_tokens.count_documents({"platform": "ios"})
    return {"total": total, "android": android, "ios": ios}
