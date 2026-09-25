"""Pazar (çıkılan pazar) endpoint'leri."""
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request

from core.db import db
from core.logs import _insert_log
from core.security import get_current_admin, get_current_staff
from core.util import _afro_norm
from models import Market, MarketInput
from services.catalog import _read_catalog_config

router = APIRouter(prefix="/api")


@router.get("/markets", response_model=List[Market])
async def list_markets():
    markets = await db.markets.find({"active": True}, {"_id": 0}).sort("created_at", 1).to_list(1000)
    return markets


@router.get("/admin/markets", response_model=List[Market])
async def admin_list_markets(staff=Depends(get_current_staff)):
    markets = await db.markets.find({}, {"_id": 0}).sort("created_at", 1).to_list(1000)
    return markets


@router.post("/admin/markets", response_model=Market)
async def create_market(payload: MarketInput, admin=Depends(get_current_admin)):
    market = Market(**payload.dict())
    await db.markets.insert_one(market.dict())
    return market


@router.put("/admin/markets/{market_id}", response_model=Market)
async def update_market(market_id: str, payload: MarketInput, admin=Depends(get_current_admin)):
    result = await db.markets.update_one({"id": market_id}, {"$set": payload.dict()})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Pazar bulunamadı")
    market = await db.markets.find_one({"id": market_id}, {"_id": 0})
    return market


@router.delete("/admin/markets/{market_id}")
async def delete_market(market_id: str, admin=Depends(get_current_admin)):
    result = await db.markets.delete_one({"id": market_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Pazar bulunamadı")
    return {"success": True}


@router.post("/admin/markets/{market_id}/reset-campaigns")
async def reset_market_campaigns(market_id: str, admin=Depends(get_current_admin), request: Request = None):
    """'İndirimleri Sıfırla' — PAZAR BAZLI hali. Global /admin/products/
    reset-campaigns TÜM ürünleri sıfırlıyordu; bu uç sadece bu pazarda
    aktif olan tedarikçilerin (catalog_config.supplier_markets'te bu
    pazarın adı geçen supplier_group'lar) ürünlerini sıfırlar."""
    market = await db.markets.find_one({"id": market_id}, {"_id": 0, "name": 1})
    if not market:
        raise HTTPException(status_code=404, detail="Pazar bulunamadı")
    target_norm = _afro_norm(market.get("name") or "")
    cfg = await _read_catalog_config()
    suppliers = [
        sg for sg, mkts in ((cfg or {}).get("supplier_markets") or {}).items()
        if any(_afro_norm(m) == target_norm for m in (mkts or []))
    ]
    if not suppliers:
        return {"success": True, "modified": 0, "suppliers": []}
    result = await db.products.update_many(
        {"supplier_group": {"$in": suppliers}},
        {"$set": {"campaign_discount_percent": 0, "campaign_min_qty": 0}},
    )
    modified = int(getattr(result, "modified_count", 0) or 0)
    await _insert_log("log_admin", {
        "admin_id": admin.get("user_id"), "admin_name": admin.get("name", ""),
        "action": "campaigns_reset_market", "target_type": "market", "target_id": market_id,
        "change_details": {"market_name": market.get("name"), "suppliers": suppliers, "modified": modified},
        "admin_note": "",
    }, request)
    return {"success": True, "modified": modified, "suppliers": suppliers}
