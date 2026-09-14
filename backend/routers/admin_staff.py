"""Esnaf (tedarikçi hesabı) ve kurye atama/yönetimi — yönetici uçları."""
from datetime import datetime, timezone as _tz
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException

import pytz as _pytz

from core.db import db
from core.security import get_current_admin, SUPPLIER_ROLES, _yonetici_only
from core.serializers import _public_user_doc
from core.util import now_utc, _afro_norm
from models import StaffAssignInput, StaffAssignByIdInput, CourierAssignInput
from services.catalog import _read_catalog_config

router = APIRouter(prefix="/api")


# ---------------- Esnaf (tedarikçi hesabı) yönetimi ----------------
# StaffAssignInput -> models.py ; _yonetici_only -> core/security.py


@router.get("/admin/staff")
async def admin_list_staff(admin=Depends(get_current_admin)):
    _yonetici_only(admin)
    staff = await db.users.find(
        {"role": {"$in": list(SUPPLIER_ROLES)}}, {"_id": 0, "password_hash": 0, "username": 0}
    ).sort("created_at", -1).to_list(500)
    return staff


@router.get("/admin/supplier-groups")
async def admin_supplier_groups(admin=Depends(get_current_admin)):
    """Tedarikçi (supplier_group) seçenekleri: SADECE katalog config'deki tedarikçiler.
    Eskiden ürünlerde kullanılan + suppliers koleksiyonu da birleştiriliyordu; bu yüzden
    silinmiş/eski tedarikçiler (Afro Sebze, Meyve, ...) listede görünmeye devam ediyordu.
    Artık yalnızca catalog_config.suppliers döndürülür ki yönetici listeyi tam kontrol etsin."""
    _yonetici_only(admin)
    cfg = await _read_catalog_config()
    groups = set()
    for g in (cfg.get("suppliers") or []):
        if g:
            groups.add(g)
    return sorted(groups)


async def _assign_staff_by_identifier(identifier: str, supplier_group: Optional[str]):
    """identifier user_id veya telefon olabilir.
    supplier_group verilirse üyeyi esnaf yapar ve tedarikçiyi atar;
    boş/None verilirse esnaf yetkisini kaldırıp normal üyeye (musteri) döndürür."""
    ident = (identifier or "").strip()
    if not ident:
        raise HTTPException(status_code=400, detail="Telefon veya user_id girin")
    sg = (supplier_group or "").strip() or None
    user = await db.users.find_one({"$or": [{"user_id": ident}, {"phone": ident}]})
    if not user:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
    if user.get("role") in ("admin", "yonetici"):
        raise HTTPException(status_code=400, detail="Yönetici hesabı tedarikçi olarak atanamaz")
    new_role = "esnaf" if sg else "musteri"
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"role": new_role, "supplier_group": sg}},
    )
    updated = await db.users.find_one(
        {"user_id": user["user_id"]}, {"_id": 0, "password_hash": 0, "username": 0}
    )
    return {"success": True, "user": _public_user_doc(updated)}


@router.put("/admin/staff/{user_id}")
async def admin_assign_staff(user_id: str, payload: StaffAssignInput, admin=Depends(get_current_admin)):
    _yonetici_only(admin)
    return await _assign_staff_by_identifier(user_id, payload.supplier_group)


@router.post("/admin/staff/assign")
async def admin_assign_staff_post(payload: StaffAssignByIdInput, admin=Depends(get_current_admin)):
    _yonetici_only(admin)
    return await _assign_staff_by_identifier(payload.identifier, payload.supplier_group)


# ---------------------------------------------------------------------
# KURYE ATAMA (yönetici) — esnaf atama ile aynı mantık: kullanıcıya 'kurye'
# rolü + bir PAZAR (courier_market) atanır. Boş market verilirse kuryelik
# kaldırılıp normal üyeye (musteri) döndürülür.
# ---------------------------------------------------------------------
async def _assign_courier_by_identifier(identifier: str, courier_markets_list: Optional[List[str]]):
    ident = (identifier or "").strip()
    if not ident:
        raise HTTPException(status_code=400, detail="Telefon veya user_id girin")
    mkts = [m.strip() for m in (courier_markets_list or []) if (m or "").strip()]
    user = await db.users.find_one({"$or": [{"user_id": ident}, {"phone": ident}]})
    if not user:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
    if user.get("role") in ("admin", "yonetici"):
        raise HTTPException(status_code=400, detail="Yönetici hesabı kurye olarak atanamaz")
    if user.get("role") in SUPPLIER_ROLES and mkts:
        raise HTTPException(status_code=400, detail="Bu hesap tedarikçi (esnaf). Önce tedarikçiliği kaldırın.")
    new_role = "kurye" if mkts else "musteri"
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {
            "role": new_role,
            "courier_markets": mkts,
            "courier_market": mkts[0] if mkts else None,  # geriye uyumluluk
        }},
    )
    updated = await db.users.find_one(
        {"user_id": user["user_id"]}, {"_id": 0, "password_hash": 0, "username": 0}
    )
    return {"success": True, "user": _public_user_doc(updated)}


@router.post("/admin/courier/assign")
async def admin_assign_courier_post(payload: CourierAssignInput, admin=Depends(get_current_admin)):
    _yonetici_only(admin)
    mkts = payload.courier_markets
    if mkts is None and payload.courier_market is not None:
        mkts = [payload.courier_market] if payload.courier_market else []
    return await _assign_courier_by_identifier(payload.identifier, mkts)


@router.get("/admin/couriers")
async def admin_list_couriers(admin=Depends(get_current_admin)):
    """Tüm kurye hesapları (yönetici görünümü)."""
    couriers = await db.users.find(
        {"role": "kurye"},
        {"_id": 0, "password_hash": 0, "username": 0},
    ).to_list(500)
    return [_public_user_doc(c) for c in couriers]


@router.get("/admin/courier-markets")
async def admin_courier_market_options(admin=Depends(get_current_admin)):
    """Kurye atamak için seçilebilir pazar adları:
    markets koleksiyonu + catalog_config.supplier_markets'teki tüm pazar adlarının birleşimi."""
    names = []
    seen = set()
    def _add(n):
        n = (n or "").strip()
        if n and _afro_norm(n) not in seen:
            seen.add(_afro_norm(n))
            names.append(n)
    for m in await db.markets.find({}, {"_id": 0, "name": 1}).to_list(200):
        _add(m.get("name"))
    cfg = await _read_catalog_config()
    for _sg, mkts in ((cfg or {}).get("supplier_markets") or {}).items():
        for n in (mkts or []):
            _add(n)
    names.sort(key=lambda x: x.lower())
    return {"markets": names}


# =====================================================================
# KURYE DETAY & İSTATİSTİK ENDPOİNTLERİ
# =====================================================================

@router.get("/admin/courier/{user_id}/stats")
async def admin_courier_stats(user_id: str, date: str = "", admin=Depends(get_current_admin)):
    """Bir kuryenin belirli bir güne ait istatistikleri (teslim sayısı, kazanç).
    date parametresi 'YYYY-MM-DD' formatında. Boşsa bugün (TR saati) kullanılır."""
    TR = _pytz.timezone("Europe/Istanbul")
    if date:
        try:
            day_tr = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=TR)
        except Exception:
            raise HTTPException(status_code=400, detail="Geçersiz tarih formatı (YYYY-MM-DD)")
    else:
        day_tr = datetime.now(TR).replace(hour=0, minute=0, second=0, microsecond=0)
    day_start = day_tr.astimezone(_tz.utc)
    # day_end: İstanbul günü 23:59:59'u UTC'ye çevir (day_start.replace hatası değil)
    day_end = day_tr.replace(hour=23, minute=59, second=59, microsecond=999999).astimezone(_tz.utc)

    courier = await db.users.find_one(
        {"user_id": user_id},
        {"_id": 0, "name": 1, "phone": 1, "courier_is_online": 1,
         "courier_markets": 1, "courier_market": 1, "courier_per_package_fee": 1}
    )
    if not courier:
        raise HTTPException(status_code=404, detail="Kurye bulunamadı")

    # Tüm zamanlar toplamı
    total_delivered = await db.transactions.count_documents({
        "courier_id": user_id, "order_status": "teslim_edildi"
    })
    # Seçilen gün
    day_delivered = await db.transactions.count_documents({
        "courier_id": user_id, "order_status": "teslim_edildi",
        "delivered_at": {"$gte": day_start, "$lte": day_end}
    })
    # Aktif (elimde) teslimat var mı
    active_count = await db.transactions.count_documents({
        "courier_id": user_id,
        "order_status": {"$in": ["yolda", "hazir"]},
        "delivery_type": "eve_servis"
    })
    fee = float(courier.get("courier_per_package_fee") or 0)
    return {
        "user_id": user_id,
        "name": courier.get("name"),
        "phone": courier.get("phone"),
        "is_online": bool(courier.get("courier_is_online")),
        "per_package_fee": fee,
        "courier_markets": courier.get("courier_markets") or ([courier.get("courier_market")] if courier.get("courier_market") else []),
        "is_busy": active_count > 0,
        "active_count": active_count,
        "total_delivered": total_delivered,
        "day_delivered": day_delivered,
        "day_earnings": round(day_delivered * fee, 2),
        "total_earnings": round(total_delivered * fee, 2),
        "date": day_tr.strftime("%Y-%m-%d"),
    }


@router.put("/admin/courier/{user_id}/settings")
async def admin_courier_update_settings(user_id: str, payload: dict, admin=Depends(get_current_admin)):
    """Admin: kuryenin paket başı ücretini ve/veya online durumunu güncelle."""
    _yonetici_only(admin)
    upd = {}
    if "per_package_fee" in payload:
        try:
            upd["courier_per_package_fee"] = float(payload["per_package_fee"])
        except Exception:
            raise HTTPException(status_code=400, detail="Geçersiz ücret değeri")
    if "is_online" in payload:
        upd["courier_is_online"] = bool(payload["is_online"])
    if not upd:
        raise HTTPException(status_code=400, detail="Güncellenecek alan yok")
    upd["updated_at"] = now_utc()
    res = await db.users.update_one({"user_id": user_id}, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Kurye bulunamadı")
    return {"ok": True}
