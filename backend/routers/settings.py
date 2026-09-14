"""Genel sistem ayarları, ziyaret raporu, SMS sağlayıcı durumu, yasal belge listesi (okuma)."""
import os

from fastapi import APIRouter, Depends, Request

from core.db import db
from core.logs import _insert_log
from core.security import get_current_admin
from core.util import now_utc

router = APIRouter(prefix="/api")


@router.get("/admin/visits/report")
async def admin_visits_report(current_admin: dict = Depends(get_current_admin)):
    """Günlük ziyaret raporu — üyeler (ana sayaç, günde 1 kez sayılır) ve
    misafirler (ham sayı) ayrı sütunlarda. `kind` alanı olmayan eski kayıtlar
    (bu özellik eklenmeden önce yazılmış) `role`'e göre sınıflandırılır."""
    pipeline = [
        {"$addFields": {
            "_kind": {"$ifNull": [
                "$kind",
                {"$cond": [{"$in": ["$role", ["member", "musteri"]]}, "member", "guest"]},
            ]},
        }},
        {"$group": {"_id": {"date": "$date", "kind": "$_kind"}, "count": {"$sum": 1}}},
        {"$sort": {"_id.date": -1}},
    ]
    rows = await db.daily_visits.aggregate(pipeline).to_list(4000)
    by_date: dict = {}
    for r in rows:
        d = (r.get("_id") or {}).get("date")
        if not d:
            continue
        entry = by_date.setdefault(d, {"date": d, "member_count": 0, "guest_count": 0, "count": 0})
        kind = (r.get("_id") or {}).get("kind")
        if kind == "member":
            entry["member_count"] = r["count"]
        else:
            entry["guest_count"] = r["count"]
        entry["count"] = entry["member_count"] + entry["guest_count"]
    return sorted(by_date.values(), key=lambda x: x["date"], reverse=True)


@router.get("/settings")
async def compat_get_settings():
    settings = await db.settings.find_one({"id": "global_settings"}, {"_id": 0})
    if not settings:
        settings = await db.settings.find_one({}, {"_id": 0})
    return settings or {}


@router.put("/admin/settings")
async def compat_update_admin_settings(data: dict, current_admin: dict = Depends(get_current_admin), request: Request = None):
    _old_settings = await db.settings.find_one({"id": "global_settings"}, {"_id": 0}) or {}
    data = {k: v for k, v in data.items() if k != "_id"}
    data["id"] = data.get("id", "global_settings")
    data["updated_at"] = now_utc()
    await db.settings.update_one({"id": "global_settings"}, {"$set": data}, upsert=True)
    for _sf, _snv in data.items():
        if _sf in ("_id", "id", "updated_at"): continue
        _sov = _old_settings.get(_sf)
        if _sov != _snv:
            await _insert_log("log_admin", {"admin_id": current_admin["user_id"], "admin_name": current_admin.get("name",""), "action": "system_settings_changed", "target_type": "system", "target_id": "global_settings", "change_details": {"field": _sf, "old_value": _sov, "new_value": _snv}, "admin_note": ""}, request)
    return {"success": True, "settings": await db.settings.find_one({"id": "global_settings"}, {"_id": 0})}


@router.get("/admin/legal-docs")
async def compat_admin_legal_docs(current_admin: dict = Depends(get_current_admin)):
    return await db.legal_documents.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)


@router.get("/admin/sms/config")
async def compat_admin_sms_config(current_admin: dict = Depends(get_current_admin)):
    """SMS sağlayıcı durumunu döndür. Env var'lardan gerçek yapılandırmayı kontrol eder."""
    username = os.environ.get("VERIMOR_USERNAME", "")
    password = os.environ.get("VERIMOR_PASSWORD", "")
    sender = os.environ.get("VERIMOR_SENDER", "AFROGIDA")

    is_configured = bool(username and password)

    cfg = await db.sms_config.find_one({}, {"_id": 0, "password": 0, "api_key": 0, "token": 0})
    if not cfg:
        cfg = {}

    # Gerçek durumu env'lerden belirle ve override et (frontend'in okuduğu alan adları)
    cfg["provider"] = "verimor"
    cfg["enabled"] = is_configured
    cfg["configured"] = is_configured
    cfg["sender"] = sender if is_configured else ""
    cfg["username"] = (username[:3] + "***") if username else ""  # Güvenlik: ilk 3 karakter
    # Frontend SMS Ayarları ekranının okuduğu alanlar:
    cfg["username_masked"] = (username[:3] + "***") if username else "-"
    cfg["source_addr_masked"] = sender if is_configured else "Panel/API ile doğrulanmalı"
    cfg["base_url"] = "https://sms.verimor.com.tr/v2/send.json" if is_configured else "-"
    cfg["timeout_seconds"] = 15
    cfg["note"] = "SMS gönderimi backend `.env` ile yönetiliyor." if is_configured else "-"

    if is_configured:
        cfg["message"] = "Verimor bağlantısı aktif. SMS gönderimi çalışıyor."
    else:
        cfg["message"] = "Verimor kimlik bilgileri eksik. SMS gönderilemez."

    return cfg
