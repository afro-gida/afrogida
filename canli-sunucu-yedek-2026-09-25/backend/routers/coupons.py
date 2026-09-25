"""Kupon endpoint'leri: kullanıcı önizleme/liste + admin yönetim/atama/tezgahta okutma."""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from core.db import db
from core.logs import _client_ip, _insert_log
from core.money import money_d
from core.security import get_current_admin, get_optional_user, rate_limit
from core.util import now_utc, _norm_limit
from models import Coupon, CouponInput, RedeemInput
from services.coupon_anomaly import (
    check_admin_coupon_burst, check_daily_coupon_total_anomaly,
    check_high_value_coupon, check_user_coupon_use_burst,
)
from services.orders import _evaluate_coupon

router = APIRouter(prefix="/api")


@router.get("/coupons", response_model=List[Coupon])
async def list_coupons(user=Depends(get_optional_user)):
    coupons = await db.coupons.find({"active": True}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    result = []
    for c in coupons:
        # Tek kullanımlık kuponlar zaten kullanılmışsa genel olarak gizle
        if c.get("single_use") and c.get("used"):
            continue
        assigned = c.get("assigned_user_ids") or []
        if user:
            # Members see: coupons assigned to them, OR general (unassigned) coupons
            if assigned:
                if user["user_id"] in assigned:
                    # Kullanıcıya özel kalan hak kontrolü: 0 ise gizle
                    ua = next((a for a in (c.get("assignments") or []) if a.get("user_id") == user["user_id"]), None)
                    if ua:
                        used = int(ua.get("used_count") or 0)
                        limit = int(ua.get("limit") or c.get("per_user_limit") or 1)
                        if used >= limit:
                            continue  # Kalan hak 0, listeye ekleme
                    result.append(c)
            else:
                result.append(c)
        else:
            # Guests see only public, unassigned coupons
            if not assigned and not c.get("members_only", True):
                result.append(c)
    return result


@router.post("/coupons/validate")
async def validate_coupon(data: dict, user=Depends(get_optional_user), request: Request = None):
    """Sepet kupon önizlemesi. İndirim, siparişteki ile AYNI fonksiyonla (_evaluate_coupon) hesaplanır."""
    await rate_limit(f"coupon_ip:{_client_ip(request)}", 40, 300, "Çok fazla kupon denemesi. Lütfen biraz bekleyin.")
    if user:
        await rate_limit(f"coupon_user:{user.get('user_id')}", 30, 300, "Çok fazla kupon denemesi. Lütfen biraz bekleyin.")
    code = str(data.get("code") or "").upper().strip()[:40]
    total = money_d(data.get("total", data.get("cart_total", 0)) or 0)
    payment_method = str(data.get("payment_method") or "")
    ev = await _evaluate_coupon(code, user, total, payment_method)
    coupon = ev["coupon"]
    discount = float(ev["discount"])
    discount_type = ev["discount_type"]
    return {
        "success": True,
        "id": coupon.get("id"),
        "coupon_id": coupon.get("id"),
        "code": coupon.get("code"),
        "title": coupon.get("title"),
        "discount_type": discount_type,
        "discount_percent": coupon.get("discount_percent"),
        "discount_value": coupon.get("discount_amount") if discount_type == "fixed" else coupon.get("discount_percent"),
        "discount": discount,
        "discount_amount": discount,
        "min_amount": float(ev["min_amount"]),
        "payment_method": payment_method,
        "message": f"{discount:.2f}₺ indirim uygulandı",
    }


@router.get("/admin/coupons", response_model=List[Coupon])
async def admin_list_coupons(admin=Depends(get_current_admin)):
    # Exclude per-member auto-issued welcome coupons to keep the admin list clean.
    coupons = await db.coupons.find({"auto_issued": {"$ne": True}}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return coupons


@router.post("/admin/coupons/redeem")
async def admin_redeem_coupon(payload: RedeemInput, admin=Depends(get_current_admin), request: Request = None):
    code = payload.code.upper().strip()
    coupon = await db.coupons.find_one({"code": code}, {"_id": 0})
    if not coupon:
        raise HTTPException(status_code=404, detail="Kupon bulunamadı")
    if not coupon.get("active", True):
        raise HTTPException(status_code=400, detail="Bu kupon pasif durumda")
    if coupon.get("single_use") and coupon.get("used"):
        raise HTTPException(status_code=400, detail="Bu kupon daha önce kullanılmış")
    # Per-user kullanım hakkı takibi: kupon belirli bir üye için kullanılıyorsa sayacı artır.
    target_uid = (payload.user_id or "").strip() or None
    assignments = coupon.get("assignments") or []
    if not target_uid and len(assignments) == 1:
        # Kupon tek bir üyeye tanımlıysa otomatik o üyeye say
        target_uid = assignments[0].get("user_id")
    if target_uid and assignments:
        ua = next((a for a in assignments if a.get("user_id") == target_uid), None)
        if ua:
            _lim = int(ua.get("limit") or 1)
            _used = int(ua.get("used_count") or 0)
            if _used >= _lim:
                raise HTTPException(status_code=400, detail="Bu üyenin kupon kullanım hakkı dolmuş")
            ua["used_count"] = _used + 1
            ua["last_used_at"] = now_utc()
            await db.coupons.update_one({"id": coupon["id"]}, {"$set": {"assignments": assignments}})
            await db.coupon_usage_logs.insert_one({
                "coupon_id": coupon["id"], "code": code, "title": coupon.get("title"),
                "user_id": target_uid, "discount_amount": coupon.get("discount_amount"),
                "used_at": now_utc(),
            })
    await db.coupons.update_one({"id": coupon["id"]}, {"$set": {"used": True, "used_at": now_utc()}})
    # LOG: kupon kullanıldı (tezgahta admin tarafından)
    await _insert_log("log_coupons", {
        "coupon_id": coupon.get("id"),
        "coupon_code": code,
        "user_id": target_uid,
        "action": "coupon_used",
        "order_id": None,
        "discount_amount": coupon.get("discount_amount"),
        "discount_type": "percentage" if coupon.get("discount_percent") else "fixed_amount",
        "original_total": None,
        "final_total": None,
        "performed_by": "admin",
        "admin_id": admin.get("user_id"),
        "admin_note": "Tezgahta kupon okutuldu",
    }, request)
    if target_uid:
        _tu = await db.users.find_one({"user_id": target_uid}, {"_id": 0, "user_id": 1, "name": 1, "phone": 1})
        await check_user_coupon_use_burst(_tu or {"user_id": target_uid}, request)
    await check_daily_coupon_total_anomaly(request)
    return {"success": True, "code": code, "title": coupon.get("title"),
            "discount_amount": coupon.get("discount_amount"),
            "discount_percent": coupon.get("discount_percent"),
            "min_amount": coupon.get("min_amount", 0)}


# _norm_limit -> core/util.py


@router.post("/admin/coupons/assign-all")
async def admin_assign_coupon_all(data: dict, admin=Depends(get_current_admin), request: Request = None):
    """Seçili kuponu tüm mevcut üyelere, verilen kullanım hakkı (limit) ile tanımlar."""
    coupon_id = str(data.get("coupon_id") or "").strip()
    limit = _norm_limit(data.get("limit"), 1)
    if not coupon_id:
        raise HTTPException(status_code=400, detail="Kupon seçilmedi")
    coupon = await db.coupons.find_one({"id": coupon_id}, {"_id": 0})
    if not coupon:
        raise HTTPException(status_code=404, detail="Kupon bulunamadı")
    members = await db.users.find(
        {"role": {"$in": ["musteri", "member", "yonetici", "admin"]}}, {"_id": 0, "user_id": 1}
    ).to_list(5000)
    # Mevcut kullanım sayaçlarını koru
    prev = {a.get("user_id"): a for a in (coupon.get("assignments") or [])}
    assignments = []
    for m in members:
        uid = m.get("user_id")
        if not uid:
            continue
        old = prev.get(uid) or {}
        assignments.append({
            "user_id": uid,
            "limit": limit,
            "used_count": int(old.get("used_count") or 0),
            "last_used_at": old.get("last_used_at"),
        })
    user_ids = [a["user_id"] for a in assignments]
    await db.coupons.update_one(
        {"id": coupon_id},
        {"$set": {"assignments": assignments, "assigned_user_ids": user_ids,
                  "members_only": True, "per_user_limit": limit}},
    )
    # LOG: kupon tüm üyelere tanımlandı
    await _insert_log("log_admin", {
        "admin_id": admin["user_id"],
        "admin_name": admin.get("name", ""),
        "action": "coupon_assigned_all",
        "target_type": "coupon",
        "target_id": coupon_id,
        "change_details": {"coupon_code": coupon.get("code", ""), "member_count": len(user_ids), "limit": limit},
        "admin_note": "",
    }, request)
    await check_admin_coupon_burst(admin, request)
    return {"success": True, "count": len(user_ids),
            "message": f"Kupon {len(user_ids)} üyeye {limit} kullanım hakkıyla tanımlandı"}


@router.post("/admin/coupons/assign-member")
async def admin_assign_coupon_member(data: dict, admin=Depends(get_current_admin), request: Request = None):
    """Seçili kuponu tek bir üyeye, verilen kullanım hakkı (limit) ile tanımlar."""
    coupon_id = str(data.get("coupon_id") or "").strip()
    user_id = str(data.get("user_id") or "").strip()
    limit = _norm_limit(data.get("limit"), 1)
    if not coupon_id or not user_id:
        raise HTTPException(status_code=400, detail="Kupon ve üye seçilmelidir")
    coupon = await db.coupons.find_one({"id": coupon_id}, {"_id": 0})
    if not coupon:
        raise HTTPException(status_code=404, detail="Kupon bulunamadı")
    member = await db.users.find_one(
        {"user_id": user_id, "role": {"$in": ["musteri", "member"]}},
        {"_id": 0, "name": 1, "phone": 1},
    )
    if not member:
        raise HTTPException(status_code=404, detail="Üye bulunamadı")
    assignments = coupon.get("assignments") or []
    found = False
    for a in assignments:
        if a.get("user_id") == user_id:
            a["limit"] = limit
            found = True
            break
    if not found:
        assignments.append({"user_id": user_id, "limit": limit, "used_count": 0, "last_used_at": None})
    user_ids = [a["user_id"] for a in assignments]
    await db.coupons.update_one(
        {"id": coupon_id},
        {"$set": {"assignments": assignments, "assigned_user_ids": user_ids, "members_only": True}},
    )
    # LOG: kupon tek üyeye tanımlandı
    await _insert_log("log_admin", {
        "admin_id": admin["user_id"],
        "admin_name": admin.get("name", ""),
        "action": "coupon_assigned_member",
        "target_type": "coupon",
        "target_id": coupon_id,
        "change_details": {"coupon_code": coupon.get("code", ""), "user_id": user_id, "limit": limit},
        "admin_note": "",
    }, request)
    await check_admin_coupon_burst(admin, request)
    return {"success": True,
            "message": f"Kupon {member.get('name', 'üye')} adlı üyeye {limit} kullanım hakkıyla tanımlandı"}


@router.post("/admin/coupons/unassign-member")
async def admin_unassign_coupon_member(data: dict, admin=Depends(get_current_admin), request: Request = None):
    """Seçili kuponu tek bir üyeden geri alır."""
    coupon_id = str(data.get("coupon_id") or "").strip()
    user_id = str(data.get("user_id") or "").strip()
    if not coupon_id or not user_id:
        raise HTTPException(status_code=400, detail="Kupon ve üye seçilmelidir")
    coupon = await db.coupons.find_one({"id": coupon_id}, {"_id": 0})
    if not coupon:
        raise HTTPException(status_code=404, detail="Kupon bulunamadı")
    assignments = [a for a in (coupon.get("assignments") or []) if a.get("user_id") != user_id]
    user_ids = [a["user_id"] for a in assignments]
    await db.coupons.update_one(
        {"id": coupon_id},
        {"$set": {"assignments": assignments, "assigned_user_ids": user_ids}},
    )
    # LOG: kupon üyeden geri alındı
    await _insert_log("log_admin", {
        "admin_id": admin["user_id"],
        "admin_name": admin.get("name", ""),
        "action": "coupon_unassigned_member",
        "target_type": "coupon",
        "target_id": coupon_id,
        "change_details": {"coupon_code": coupon.get("code", ""), "user_id": user_id},
        "admin_note": "",
    }, request)
    return {"success": True, "message": "Kupon üyeden geri alındı"}


@router.post("/admin/coupons/unassign-all")
async def admin_unassign_coupon_all(data: dict, admin=Depends(get_current_admin), request: Request = None):
    """Seçili kuponun tüm üye tanımlamalarını geri alır (assignments + assigned_user_ids temizlenir)."""
    coupon_id = str(data.get("coupon_id") or "").strip()
    if not coupon_id:
        raise HTTPException(status_code=400, detail="Kupon seçilmedi")
    coupon = await db.coupons.find_one({"id": coupon_id}, {"_id": 0})
    if not coupon:
        raise HTTPException(status_code=404, detail="Kupon bulunamadı")
    await db.coupons.update_one(
        {"id": coupon_id}, {"$set": {"assigned_user_ids": [], "assignments": []}}
    )
    # LOG: kupon tüm üyelerden geri alındı
    await _insert_log("log_admin", {
        "admin_id": admin["user_id"],
        "admin_name": admin.get("name", ""),
        "action": "coupon_unassigned_all",
        "target_type": "coupon",
        "target_id": coupon_id,
        "change_details": {"coupon_code": coupon.get("code", "")},
        "admin_note": "",
    }, request)
    return {"success": True, "message": "Kupon tüm üyelerden geri alındı"}


@router.get("/admin/coupons/{coupon_id}/details")
async def admin_coupon_details(coupon_id: str, admin=Depends(get_current_admin)):
    """Kupon detay ekranı: tanımlı kişiler (kullanım hakkı/kullanım/kalan) ve kullanım geçmişi."""
    coupon = await db.coupons.find_one({"id": coupon_id}, {"_id": 0})
    if not coupon:
        raise HTTPException(status_code=404, detail="Kupon bulunamadı")
    assignments = coupon.get("assignments") or []
    # Eski kayıtlar (yalnız assigned_user_ids var, assignments yok) için geriye dönük uyum
    if not assignments and coupon.get("assigned_user_ids"):
        default_limit = _norm_limit(coupon.get("per_user_limit"), 1)
        assignments = [{"user_id": uid, "limit": default_limit, "used_count": 0, "last_used_at": None}
                       for uid in coupon.get("assigned_user_ids") or []]
    assigned_users = []
    total_uses = 0
    for a in assignments:
        uid = a.get("user_id")
        u = await db.users.find_one({"user_id": uid}, {"_id": 0, "name": 1, "phone": 1}) if uid else None
        lim = _norm_limit(a.get("limit"), 1)
        used = int(a.get("used_count") or 0)
        total_uses += used
        assigned_users.append({
            "user_id": uid,
            "user_name": (u or {}).get("name") or "Bilinmiyor",
            "phone": (u or {}).get("phone"),
            "limit": lim,
            "used_count": used,
            "remaining": max(0, lim - used),
            "last_used_at": a.get("last_used_at"),
        })
    logs = await db.coupon_usage_logs.find(
        {"coupon_id": coupon_id}, {"_id": 0}
    ).sort("used_at", -1).to_list(200)
    return {
        "coupon": coupon,
        "assigned_count": len(assigned_users),
        "total_uses": total_uses,
        "assigned_users": assigned_users,
        "usage_logs": logs,
    }


@router.post("/admin/coupons", response_model=Coupon)
async def create_coupon(payload: CouponInput, admin=Depends(get_current_admin), request: Request = None):
    coupon = Coupon(**payload.dict())
    coupon.code = coupon.code.upper().strip()
    await db.coupons.insert_one(coupon.dict())
    await _insert_log("log_coupons", {"coupon_id": coupon.id, "coupon_code": coupon.code, "user_id": None, "action": "coupon_created", "order_id": None, "discount_amount": coupon.discount_amount, "discount_type": "fixed_amount", "original_total": None, "final_total": None, "performed_by": "admin", "admin_id": admin["user_id"], "admin_note": ""}, request)
    await _insert_log("log_admin", {"admin_id": admin["user_id"], "admin_name": admin.get("name",""), "action": "coupon_created", "target_type": "coupon", "target_id": coupon.id, "change_details": {"coupon_code": coupon.code, "discount_amount": coupon.discount_amount}, "admin_note": ""}, request)
    await check_high_value_coupon(coupon.dict(), admin, request, action="coupon_created")
    await check_admin_coupon_burst(admin, request)
    return coupon


@router.put("/admin/coupons/{coupon_id}", response_model=Coupon)
async def update_coupon(coupon_id: str, payload: CouponInput, admin=Depends(get_current_admin), request: Request = None):
    updates = payload.dict()
    updates["code"] = updates["code"].upper().strip()
    result = await db.coupons.update_one({"id": coupon_id}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Kupon bulunamadı")
    coupon = await db.coupons.find_one({"id": coupon_id}, {"_id": 0})
    await check_high_value_coupon(coupon, admin, request, action="coupon_updated")
    return coupon


@router.delete("/admin/coupons/{coupon_id}")
async def delete_coupon(coupon_id: str, admin=Depends(get_current_admin), request: Request = None):
    _del_cpn = await db.coupons.find_one({"id": coupon_id}, {"_id": 0, "code": 1})
    result = await db.coupons.delete_one({"id": coupon_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Kupon bulunamadı")
    await _insert_log("log_coupons", {"coupon_id": coupon_id, "coupon_code": (_del_cpn or {}).get("code",""), "user_id": None, "action": "coupon_cancelled", "order_id": None, "discount_amount": None, "discount_type": None, "original_total": None, "final_total": None, "performed_by": "admin", "admin_id": admin["user_id"], "admin_note": "Admin tarafından silindi"}, request)
    await _insert_log("log_admin", {"admin_id": admin["user_id"], "admin_name": admin.get("name",""), "action": "coupon_deleted", "target_type": "coupon", "target_id": coupon_id, "change_details": {"coupon_code": (_del_cpn or {}).get("code","")}, "admin_note": ""}, request)
    return {"success": True}
