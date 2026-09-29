"""Müşteri şikayetleri ve sipariş sorunları — müşteri tarafı (gönder) +
admin tarafı (listeleme/güncelleme/silme)."""
from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.security import get_current_admin, get_current_user
from core.util import now_utc, new_id, _clean_text

router = APIRouter(prefix="/api")


@router.post("/complaints")
async def submit_complaint(data: dict, current_user: dict = Depends(get_current_user)):
    """Müşteri profilinden şikayet/öneri gönderir — admin panelindeki
    Şikayet/Öneri listesine (db.complaints) düşer. Alan adları, canlıdaki
    eski (kayıp kaynak koddan kalma) gerçek verilerle birebir aynı tutuldu:
    id/user_id/user_name/message/status/created_at."""
    message = _clean_text((data or {}).get("message") or "")[:1000]
    if not message:
        raise HTTPException(status_code=400, detail="Mesaj boş olamaz")
    doc = {
        "id": new_id("cmpl"),
        "user_id": current_user.get("user_id"),
        "user_name": current_user.get("name") or "",
        "message": message,
        "status": "pending",
        "created_at": now_utc(),
    }
    await db.complaints.insert_one(doc)
    return {"success": True, "id": doc["id"]}


@router.get("/admin/complaints")
async def admin_list_complaints(current_admin: dict = Depends(get_current_admin)):
    return await db.complaints.find({}, {"_id": 0}).sort("created_at", -1).to_list(3000)


SUPPORT_STATUSES = ("pending", "resolved")


@router.put("/admin/complaints/{complaint_id}")
async def admin_update_complaint(complaint_id: str, data: dict, current_admin: dict = Depends(get_current_admin)):
    updates = {k: v for k, v in (data or {}).items() if k in ("status", "admin_response")}
    if "status" in updates and updates["status"] not in SUPPORT_STATUSES:
        raise HTTPException(status_code=400, detail="Geçersiz durum")
    if "admin_response" in updates:
        updates["admin_response"] = _clean_text(str(updates["admin_response"] or ""))[:1000]
    updates["updated_at"] = now_utc()
    result = await db.complaints.update_one({"id": complaint_id}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı")
    return await db.complaints.find_one({"id": complaint_id}, {"_id": 0})


@router.delete("/admin/complaints/{complaint_id}")
async def admin_delete_complaint(complaint_id: str, current_admin: dict = Depends(get_current_admin)):
    result = await db.complaints.delete_one({"id": complaint_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı")
    return {"success": True}


@router.get("/admin/return-requests")
async def admin_list_return_requests(current_admin: dict = Depends(get_current_admin)):
    """Yönetim "Destek" ekranı: sorumluların açtığı iade talepleri (en yeni
    üstte). Karar (iade / kupon / ret) sipariş detayında verilir; burada
    sadece liste + "incelendi" işareti var."""
    rows = await db.transactions.find(
        {"return_request": {"$ne": None}},
        {"_id": 0, "tx_id": 1, "user_name": 1, "market_name": 1, "order_status": 1,
         "refund_status": 1, "created_at": 1, "return_request": 1},
    ).sort("return_request.requested_at", -1).to_list(1000)
    return [r for r in rows if isinstance(r.get("return_request"), dict)]


@router.put("/admin/return-requests/{tx_id}")
async def admin_update_return_request(tx_id: str, data: dict, current_admin: dict = Depends(get_current_admin)):
    status = (data or {}).get("status")
    if status not in SUPPORT_STATUSES:
        raise HTTPException(status_code=400, detail="Geçersiz durum")
    result = await db.transactions.update_one(
        {"tx_id": tx_id, "return_request": {"$type": "object"}},
        {"$set": {"return_request.status": status, "return_request.reviewed_at": now_utc(),
                  "return_request.reviewed_by": current_admin.get("user_id")}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="İade talebi bulunamadı")
    return {"success": True}


@router.get("/admin/issues")
async def admin_list_issues(current_admin: dict = Depends(get_current_admin)):
    return await db.order_issues.find({}, {"_id": 0}).sort("created_at", -1).to_list(3000)


@router.put("/admin/issues/{issue_id}")
async def admin_update_issue(issue_id: str, data: dict, current_admin: dict = Depends(get_current_admin)):
    updates = {k: v for k, v in data.items() if k in ("status", "admin_note")}
    updates["updated_at"] = now_utc()
    result = await db.order_issues.update_one({"id": issue_id}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı")
    return await db.order_issues.find_one({"id": issue_id}, {"_id": 0})
