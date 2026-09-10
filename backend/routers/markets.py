"""Pazar (çıkılan pazar) endpoint'leri."""
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from core.db import db
from core.security import get_current_admin, get_current_staff
from models import Market, MarketInput

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
