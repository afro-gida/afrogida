"""Pazar Sorumlusu — kısıtlı yönetici rolü.

Tam admin ("admin"/"yonetici" — DB'de "yonetici" ZATEN tam admin anlamına
geliyor, gerçek üretim admin hesabı bu rolde, bkz. core/security.py notu)
ile KARIŞTIRILMAMALI: bu, sadece kendine atanmış pazar(lar)daki (managed_markets)
tedarikçileri denetleyip atayabilen/kaldırabilen, admin panelinin geri kalanına
HİÇ erişimi olmayan ayrı ve dar kapsamlı bir rol. Yetki sınırı her endpoint'te
ayrı ayrı kontrol edilir (sadece frontend'de gizlemek yetmez — güvenlik burada).
"""
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request

from core.db import db
from core.logs import _insert_log
from core.security import get_current_pazar_sorumlusu, get_user_managed_markets
from core.util import _afro_norm
from services.catalog import _read_catalog_config, _write_catalog_config

router = APIRouter(prefix="/api/pazar-sorumlusu")


async def _managed_market_docs(user: dict) -> List[dict]:
    ids = get_user_managed_markets(user)
    if not ids:
        return []
    return await db.markets.find({"id": {"$in": ids}}, {"_id": 0}).to_list(200)


def _require_managed(market_id: str, managed_docs: List[dict]) -> dict:
    doc = next((m for m in managed_docs if m.get("id") == market_id), None)
    if not doc:
        raise HTTPException(status_code=403, detail="Bu pazar size atanmamış")
    return doc


@router.get("/markets")
async def pazar_sorumlusu_markets(user: dict = Depends(get_current_pazar_sorumlusu)):
    """Kendine atanmış pazar(lar)ın listesi."""
    return await _managed_market_docs(user)


@router.get("/suppliers")
async def pazar_sorumlusu_suppliers(user: dict = Depends(get_current_pazar_sorumlusu)):
    """Kendine atanmış pazar(lar)dan herhangi birinde çalışan tedarikçiler
    (catalog_config.supplier_markets'e göre)."""
    managed = await _managed_market_docs(user)
    managed_names = {_afro_norm(m.get("name") or "") for m in managed}
    if not managed_names:
        return []
    cfg = await _read_catalog_config()
    result = []
    for sg, mkts in ((cfg or {}).get("supplier_markets") or {}).items():
        matched = [m for m in (mkts or []) if _afro_norm(m) in managed_names]
        if matched:
            result.append({"supplier_group": sg, "markets": matched})
    return result


def _sorumlu_order_view(o: dict) -> dict:
    items = []
    for it in (o.get("items") or []):
        items.append({
            "name": it.get("product_name_snapshot") or it.get("name") or it.get("product_name") or "Ürün",
            "qty": it.get("qty") or it.get("quantity") or 1,
            "unit": it.get("unit_snapshot") or it.get("unit") or "",
        })
    return {
        "tx_id": o.get("tx_id"),
        "order_status": o.get("order_status"),
        "delivery_type": o.get("delivery_type"),
        "market_name": o.get("market_name") or "",
        "amount": o.get("amount"),
        "user_name": o.get("user_name") or "",
        "items": items,
        "created_at": o.get("created_at"),
    }


@router.get("/orders")
async def pazar_sorumlusu_orders(user: dict = Depends(get_current_pazar_sorumlusu)):
    """Sorumlunun pazar(lar)ındaki siparişler (salt okunur takip amaçlı,
    durum değiştirme yetkisi yok - o kurye/mutfak tarafında)."""
    managed = await _managed_market_docs(user)
    managed_names = {_afro_norm(m.get("name") or "") for m in managed}
    if not managed_names:
        return []
    orders = await db.transactions.find({}, {"_id": 0}).sort("created_at", -1).to_list(300)
    return [
        _sorumlu_order_view(o)
        for o in orders
        if _afro_norm(o.get("market_name") or "") in managed_names
    ]


@router.get("/couriers")
async def pazar_sorumlusu_couriers(user: dict = Depends(get_current_pazar_sorumlusu)):
    """Sorumlunun pazar(lar)ında çalışan kuryeler (salt okunur - atama/kaldırma admin işidir)."""
    managed = await _managed_market_docs(user)
    managed_names = {_afro_norm(m.get("name") or "") for m in managed}
    if not managed_names:
        return []
    couriers = await db.users.find(
        {"role": "kurye"},
        {"_id": 0, "user_id": 1, "name": 1, "phone": 1, "courier_is_online": 1, "courier_markets": 1, "courier_market": 1},
    ).to_list(500)
    result = []
    for c in couriers:
        mkts = c.get("courier_markets") or ([c.get("courier_market")] if c.get("courier_market") else [])
        if any(_afro_norm(m) in managed_names for m in mkts):
            result.append({
                "user_id": c.get("user_id"),
                "name": c.get("name") or "",
                "phone": c.get("phone") or "",
                "is_online": bool(c.get("courier_is_online")),
                "markets": mkts,
            })
    return result


@router.get("/suppliers/{supplier_group}/products")
async def pazar_sorumlusu_supplier_products(supplier_group: str, user: dict = Depends(get_current_pazar_sorumlusu)):
    """Bir tedarikçinin ürünleri — SADECE o tedarikçi çağıranın atandığı
    pazarlardan birinde çalışıyorsa (salt okunur, denetim amaçlı)."""
    managed = await _managed_market_docs(user)
    managed_names = {_afro_norm(m.get("name") or "") for m in managed}
    cfg = await _read_catalog_config()
    supplier_markets = (cfg or {}).get("supplier_markets") or {}
    sg_markets = supplier_markets.get(supplier_group) or []
    if not any(_afro_norm(m) in managed_names for m in sg_markets):
        raise HTTPException(status_code=403, detail="Bu tedarikçi sizin pazarlarınızda değil")
    return await db.products.find({"supplier_group": supplier_group}, {"_id": 0}).sort("name", 1).to_list(2000)


@router.post("/suppliers/assign")
async def pazar_sorumlusu_assign_supplier(data: dict, user: dict = Depends(get_current_pazar_sorumlusu), request: Request = None):
    """Bir tedarikçiyi KENDİ pazarına ekler (catalog_config.supplier_markets'e
    bu pazarın adını ekler) — başka bir pazar sorumlusunun pazarına dokunamaz."""
    supplier_group = str((data or {}).get("supplier_group") or "").strip()
    market_id = str((data or {}).get("market_id") or "").strip()
    if not supplier_group or not market_id:
        raise HTTPException(status_code=400, detail="Tedarikçi ve pazar seçilmelidir")
    managed = await _managed_market_docs(user)
    market = _require_managed(market_id, managed)
    market_name = market.get("name") or ""

    cfg = dict(await _read_catalog_config())
    supplier_markets = dict(cfg.get("supplier_markets") or {})
    current = list(supplier_markets.get(supplier_group) or [])
    if not any(_afro_norm(m) == _afro_norm(market_name) for m in current):
        current.append(market_name)
    supplier_markets[supplier_group] = current
    cfg["supplier_markets"] = supplier_markets
    suppliers_list = list(cfg.get("suppliers") or [])
    if supplier_group not in suppliers_list:
        suppliers_list.append(supplier_group)
    cfg["suppliers"] = suppliers_list
    await _write_catalog_config(cfg)

    await _insert_log("log_admin", {
        "admin_id": user.get("user_id"), "admin_name": user.get("name", ""),
        "action": "pazar_sorumlusu_supplier_assigned", "target_type": "market", "target_id": market_id,
        "change_details": {"market_name": market_name, "supplier_group": supplier_group},
        "admin_note": "",
    }, request)
    return {"success": True}


@router.post("/suppliers/unassign")
async def pazar_sorumlusu_unassign_supplier(data: dict, user: dict = Depends(get_current_pazar_sorumlusu), request: Request = None):
    """Bir tedarikçiyi KENDİ pazarından kaldırır — başka bir pazar
    sorumlusunun pazarındaki atamaya dokunamaz."""
    supplier_group = str((data or {}).get("supplier_group") or "").strip()
    market_id = str((data or {}).get("market_id") or "").strip()
    if not supplier_group or not market_id:
        raise HTTPException(status_code=400, detail="Tedarikçi ve pazar seçilmelidir")
    managed = await _managed_market_docs(user)
    market = _require_managed(market_id, managed)
    market_name = market.get("name") or ""

    cfg = dict(await _read_catalog_config())
    supplier_markets = dict(cfg.get("supplier_markets") or {})
    current = list(supplier_markets.get(supplier_group) or [])
    new_list = [m for m in current if _afro_norm(m) != _afro_norm(market_name)]
    supplier_markets[supplier_group] = new_list
    cfg["supplier_markets"] = supplier_markets
    await _write_catalog_config(cfg)

    await _insert_log("log_admin", {
        "admin_id": user.get("user_id"), "admin_name": user.get("name", ""),
        "action": "pazar_sorumlusu_supplier_unassigned", "target_type": "market", "target_id": market_id,
        "change_details": {"market_name": market_name, "supplier_group": supplier_group},
        "admin_note": "",
    }, request)
    return {"success": True}
