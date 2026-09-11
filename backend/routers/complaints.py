"""Müşteri şikayetleri ve sipariş sorunları (admin listeleme/güncelleme/silme)."""
from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.security import get_current_admin
from core.util import now_utc

router = APIRouter(prefix="/api/admin")


@router.get("/complaints")
async def admin_list_complaints(current_admin: dict = Depends(get_current_admin)):
    return await db.complaints.find({}, {"_id": 0}).sort("created_at", -1).to_list(3000)


@router.put("/complaints/{complaint_id}")
async def admin_update_complaint(complaint_id: str, data: dict, current_admin: dict = Depends(get_current_admin)):
    updates = {k: v for k, v in data.items() if k in ("status", "admin_response")}
    updates["updated_at"] = now_utc()
    result = await db.complaints.update_one({"id": complaint_id}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı")
    return await db.complaints.find_one({"id": complaint_id}, {"_id": 0})


@router.delete("/complaints/{complaint_id}")
async def admin_delete_complaint(complaint_id: str, current_admin: dict = Depends(get_current_admin)):
    result = await db.complaints.delete_one({"id": complaint_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı")
    return {"success": True}


@router.get("/issues")
async def admin_list_issues(current_admin: dict = Depends(get_current_admin)):
    return await db.order_issues.find({}, {"_id": 0}).sort("created_at", -1).to_list(3000)


@router.put("/issues/{issue_id}")
async def admin_update_issue(issue_id: str, data: dict, current_admin: dict = Depends(get_current_admin)):
    updates = {k: v for k, v in data.items() if k in ("status", "admin_note")}
    updates["updated_at"] = now_utc()
    result = await db.order_issues.update_one({"id": issue_id}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı")
    return await db.order_issues.find_one({"id": issue_id}, {"_id": 0})
