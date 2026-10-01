"""Yönetim > Kâr Profilleri: Düşük / Orta / Yüksek kazanç kâr tabloları.

Bir profil aktiftir; yeni ürün ve alış fiyatı değişiklikleri onunla hesaplanır
(core/pricing.py). "Uygula" profili aktif yapar ve MEVCUT ürünlerin satış
fiyatını (onay bekleyen fiyat talepleri dahil) yeniden hesaplar.
"""
from fastapi import APIRouter, Depends, HTTPException, Request

from core.db import db
from core.logs import _insert_log
from core.pricing import (
    DEFAULT_ACTIVE, DEFAULT_PROFILES, PROFILE_IDS, auto_price_fields, clean_tiers, profit_for, refresh_active_tiers,
)
from core.security import _yonetici_only, get_current_admin
from core.util import now_utc

router = APIRouter(prefix="/api/admin/pricing")


async def _state() -> dict:
    doc = await db.pricing_profiles.find_one({"id": "pricing"}, {"_id": 0}) or {}
    saved = doc.get("profiles") or {}
    profiles = {pid: {**DEFAULT_PROFILES[pid], **(saved.get(pid) or {})} for pid in PROFILE_IDS}
    return {"active": doc.get("active") or DEFAULT_ACTIVE, "profiles": profiles, "updated_at": doc.get("updated_at")}


def _profile_or_404(pid: str):
    if pid not in PROFILE_IDS:
        raise HTTPException(status_code=404, detail="Böyle bir profil yok")


@router.get("")
async def get_pricing(admin=Depends(get_current_admin)):
    st = await _state()
    return {**st, "order": PROFILE_IDS}


@router.put("/profiles/{pid}")
async def save_profile(pid: str, data: dict, admin=Depends(get_current_admin), request: Request = None):
    """Profilin adını / tablosunu kaydeder. Aktif profil kaydedilirse yeni
    fiyatlamalar hemen bu tabloyu kullanır; mevcut ürünler için "Uygula"."""
    _yonetici_only(admin)
    _profile_or_404(pid)
    try:
        tiers = clean_tiers((data or {}).get("tiers"))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    name = str((data or {}).get("name") or DEFAULT_PROFILES[pid]["name"]).strip()[:40]
    await db.pricing_profiles.update_one(
        {"id": "pricing"},
        {"$set": {"id": "pricing", f"profiles.{pid}": {"name": name, "tiers": tiers}, "updated_at": now_utc()}},
        upsert=True,
    )
    await refresh_active_tiers(force=True)
    await _insert_log("log_admin", {"admin_id": admin["user_id"], "admin_name": admin.get("name", ""), "action": "pricing_profile_saved", "target_type": "pricing", "target_id": pid, "change_details": {"tiers": tiers}, "admin_note": ""}, request)
    return await _state()


async def _diff(tiers) -> dict:
    """Bu tabloyla mevcut ürünlerin fiyatı nasıl değişir?"""
    rows, changed = [], 0
    old_profit = new_profit = 0.0
    async for pr in db.products.find({"supplier_price": {"$gt": 0}}, {"_id": 0, "id": 1, "name": 1, "supplier_group": 1,
                                                                      "supplier_price": 1, "price": 1, "profit_margin_amount": 1}):
        new = profit_for(pr["supplier_price"], tiers)
        if new is None:
            continue
        old = float(pr.get("profit_margin_amount") or 0)
        old_profit += old
        new_profit += new
        new_price = round(float(pr["supplier_price"]) + new, 2)
        if round(float(pr.get("price") or 0), 2) != new_price or old != new:
            changed += 1
            rows.append({"name": pr.get("name"), "supplier_group": pr.get("supplier_group"),
                         "supplier_price": pr["supplier_price"], "old_price": pr.get("price"), "new_price": new_price,
                         "old_profit": old, "new_profit": new})
    rows.sort(key=lambda r: abs((r["new_price"] or 0) - (r["old_price"] or 0)), reverse=True)
    return {"changed": changed, "examples": rows[:30],
            "old_profit_total": round(old_profit, 2), "new_profit_total": round(new_profit, 2)}


@router.post("/preview")
async def preview(data: dict, admin=Depends(get_current_admin)):
    """Profil uygulanırsa kaç ürünün fiyatı değişir (hiçbir şey kaydedilmez).
    tiers verilirse kaydedilmemiş düzenleme ile hesaplar."""
    pid = str((data or {}).get("profile_id") or "")
    _profile_or_404(pid)
    try:
        tiers = clean_tiers(data["tiers"]) if (data or {}).get("tiers") else (await _state())["profiles"][pid]["tiers"]
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return await _diff(tiers)


@router.post("/apply")
async def apply_profile(data: dict, admin=Depends(get_current_admin), request: Request = None):
    """Profili aktif yap + mevcut ürünleri (ve onay bekleyen fiyat taleplerini)
    bu tabloyla yeniden fiyatla."""
    _yonetici_only(admin)
    pid = str((data or {}).get("profile_id") or "")
    _profile_or_404(pid)
    tiers = (await _state())["profiles"][pid]["tiers"]
    await db.pricing_profiles.update_one({"id": "pricing"}, {"$set": {"id": "pricing", "active": pid, "updated_at": now_utc()}}, upsert=True)
    await refresh_active_tiers(force=True)
    now = now_utc()
    updated = 0
    async for pr in db.products.find({"supplier_price": {"$gt": 0}}, {"_id": 0, "id": 1, "supplier_price": 1, "price": 1,
                                                                      "profit_margin_amount": 1, "pending_approval": 1}):
        set_doc = {}
        f = auto_price_fields(pr["supplier_price"], tiers)
        if round(float(pr.get("price") or 0), 2) != f["price"] or float(pr.get("profit_margin_amount") or 0) != f["profit_margin_amount"]:
            set_doc.update({k: v for k, v in f.items() if k != "supplier_price"})
        ch = (pr.get("pending_approval") or {}).get("changes") or {}
        if float(ch.get("supplier_price") or 0) > 0:
            pf = auto_price_fields(ch["supplier_price"], tiers)
            set_doc.update({f"pending_approval.changes.{k}": v for k, v in pf.items() if k != "supplier_price"})
        if set_doc:
            set_doc["updated_at"] = now
            await db.products.update_one({"id": pr["id"]}, {"$set": set_doc})
            updated += 1
    await _insert_log("log_admin", {"admin_id": admin["user_id"], "admin_name": admin.get("name", ""), "action": "pricing_profile_applied", "target_type": "pricing", "target_id": pid, "change_details": {"updated_products": updated}, "admin_note": ""}, request)
    return {"success": True, "active": pid, "updated": updated}
