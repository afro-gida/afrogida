"""Ürün, kategori, kampanya endpoint'leri (public + admin/tedarikçi yönetimi)."""
import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

from core.config import ORDERED_CATEGORIES
from core.db import db
from core.logs import _insert_log
from core.security import (
    get_current_admin, get_current_staff, get_optional_user,
    is_supplier_role, get_user_supplier_group,
)
from core.util import now_utc, _afro_norm
from models import Product, ProductInput, Campaign, CampaignInput
from services.catalog import _read_catalog_config
from services.contracts import _afro_require_supplier_contract

logger = logging.getLogger("afro.routers.products")
logging = logger  # eski logging.warning(...) çağrıları için

router = APIRouter(prefix="/api")


# _afro_norm -> core/util.py


@router.get("/products", response_model=List[Product])
async def list_products(
    category: Optional[str] = None,
    search: Optional[str] = None,
    market: Optional[str] = None,
    show_all: Optional[str] = None,
):
    query = {}
    if category and category != "Tümü":
        query["category"] = category
    if search:
        query["name"] = {"$regex": search, "$options": "i"}
    products = await db.products.find(query, {"_id": 0}).to_list(1000)

    # PAZAR BAZLI TEDARİKÇİ FİLTRESİ: Bir ürün, ancak tedarikçisi (supplier_group)
    # catalog_config.supplier_markets içinde seçili pazara atanmışsa görünür.
    # - Tedarikçinin haritada kaydı varsa: KATI davran (sadece atanmış pazarlarda
    #   görünür; liste boşsa hiçbir pazarda görünmez).
    # - Tedarikçinin hiç kaydı yoksa: güvenli tarafta kal (her pazarda göster).
    # - market boşsa veya show_all istenmişse: filtreleme yok (geriye dönük uyumlu).
    _show_all = str(show_all).lower() in ("1", "true", "yes") if show_all is not None else False
    if market and market.strip() and not _show_all:
        target = _afro_norm(market)
        cfg = await _read_catalog_config()
        sm = (cfg or {}).get("supplier_markets") or {}
        norm_map = {}  # kayıtlı tedarikçiler -> izin verilen pazar kümeleri
        for sup, mkts in sm.items():
            mset = set(_afro_norm(x) for x in (mkts or []) if _afro_norm(x))
            # Tedarikçi supplier_markets'te kayıtlıysa (boş bile olsa) kısıtlıdır.
            # - Listesi boşsa: hiçbir pazarda görünmez.
            # - Listesi doluysa: sadece o pazarlarda görünür.
            norm_map[_afro_norm(sup)] = mset

        def _allowed(p):
            sg = _afro_norm(p.get("supplier_group") or "")
            if sg in norm_map:
                # Tedarikçi kayıtlı -> izin listesine bak (boş küme = hiçbir yerde yok)
                return target in norm_map[sg]
            return True  # yapılandırılmamış tedarikçi -> her pazarda göster (eski ürünler)

        products = [p for p in products if _allowed(p)]
    # Order by category (same top-to-bottom order as the category menu),
    # then in-stock first (out-of-stock sink to the bottom of each category), then name.
    cat_order = {c: i for i, c in enumerate(ORDERED_CATEGORIES)}
    products.sort(key=lambda p: (
        cat_order.get(p.get("category"), len(cat_order)),
        0 if p.get("in_stock") else 1,
        (p.get("name") or "").lower(),
    ))
    return products


@router.get("/products-meta")
async def products_meta():
    doc = await db.products.find_one({}, {"_id": 0, "updated_at": 1}, sort=[("updated_at", -1)])
    return {"last_updated": doc["updated_at"] if doc and doc.get("updated_at") else None}


@router.get("/categories", response_model=List[str])
async def list_categories():
    existing = await db.products.distinct("category")
    # Always show the fixed ordered categories first, then any extra
    # categories an admin may have added that aren't in the list.
    extras = [c for c in sorted(existing) if c not in ORDERED_CATEGORIES]
    return ORDERED_CATEGORIES + extras


@router.get("/products/{product_id}", response_model=Product)
async def get_product(product_id: str):
    product = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Ürün bulunamadı")
    return product


@router.get("/admin/products")
async def admin_list_products(staff=Depends(get_current_staff)):
    query = {}
    if is_supplier_role(staff):
        sg = get_user_supplier_group(staff)
        if not sg:
            return []
        query["supplier_group"] = sg
    products = await db.products.find(query, {"_id": 0}).to_list(5000)
    cat_order = {c: i for i, c in enumerate(ORDERED_CATEGORIES)}
    products.sort(key=lambda p: (
        (p.get("supplier_group") or "").lower(),
        cat_order.get(p.get("category"), len(cat_order)),
        (p.get("name") or "").lower(),
    ))
    return products


# Yeni çift-fiyat alanları: mevcut UI bunları göndermezse migrasyon değerleri korunmalı.
DUAL_PRICE_FIELDS = ("supplier_price", "sale_price", "profit_margin_amount",
                     "price_updated_at", "price_updated_by")


@router.post("/admin/products", response_model=Product)
async def create_product(payload: ProductInput, staff=Depends(get_current_staff), request: Request = None):
    data = payload.dict()
    # Tedarikçi (esnaf/supplier) sadece kendi tedarikçisine ürün ekleyebilir
    if is_supplier_role(staff):
        sg = get_user_supplier_group(staff)
        if not sg:
            raise HTTPException(status_code=403, detail="Hesabınıza tedarikçi atanmamış")
        await _afro_require_supplier_contract(staff)
        data["supplier_group"] = sg
    if not data.get("price"):
        data["price"] = data.get("gel_al_price") or 0
    # sale_price gönderilmemişse müşteri fiyatı (price) ile başlat
    if data.get("sale_price") is None:
        data["sale_price"] = data.get("price")
    product = Product(**data)
    await db.products.insert_one(product.dict())
    await _insert_log("log_admin", {"admin_id": staff["user_id"], "admin_name": staff.get("name",""), "action": "product_created", "target_type": "product", "target_id": product.id, "change_details": {"field": "new_product", "old_value": None, "new_value": {"name": data.get("name"), "sale_price": data.get("sale_price")}}, "admin_note": ""}, request)
    return product


# ÖNEMLİ: Bu STATİK yol ("/reset-campaigns"), aşağıdaki dinamik
# "/admin/products/{product_id}" (PUT/DELETE) yolundan ÖNCE tanımlanır.
# "İndirimleri Sıfırla" butonu (Eve Servis Ayarları) bu endpoint'i çağırır;
# tüm ürünlerin kampanya indirimi alanlarını (Kampanya İndirimi % ve
# Minimum Miktar) 0'a çeker. Eskiden endpoint YOKTU -> POST, dinamik
# {product_id} pattern'ine düşüp 405 dönüyordu (buton çalışmıyordu).
@router.post("/admin/products/reset-campaigns")
async def reset_product_campaigns(admin=Depends(get_current_admin), request: Request = None):
    result = await db.products.update_many(
        {},
        {"$set": {"campaign_discount_percent": 0, "campaign_min_qty": 0}},
    )
    try:
        await _insert_log("log_admin", {"admin_id": admin.get("user_id"), "admin_name": admin.get("name", ""), "action": "campaigns_reset", "target_type": "product", "target_id": None, "change_details": {"field": "campaign_discount_percent+campaign_min_qty", "old_value": "various", "new_value": 0}, "admin_note": ""}, request)
    except Exception:
        pass
    return {"success": True, "modified": int(getattr(result, "modified_count", 0) or 0)}


@router.put("/admin/products/{product_id}", response_model=Product)
async def update_product(product_id: str, payload: ProductInput, staff=Depends(get_current_staff), request: Request = None):
    existing = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Ürün bulunamadı")
    sent = payload.dict(exclude_unset=True)   # sadece client'ın gerçekten gönderdiği alanlar
    updates = payload.dict()
    is_supplier = is_supplier_role(staff)
    
    # Tedarikçi (esnaf/supplier) sadece kendi tedarikçisinin ürünlerini düzenleyebilir
    if is_supplier:
        sg = get_user_supplier_group(staff)
        if not sg or existing.get("supplier_group") != sg:
            raise HTTPException(status_code=403, detail="Bu ürünü düzenleme yetkiniz yok")
        await _afro_require_supplier_contract(staff)
        updates["supplier_group"] = sg
        
        # TEDARİKÇİ KISITLARI (Faz 1):
        # - Sadece supplier_price + temel bilgiler (name, description, image, stock, unit) güncelleyebilir
        # - sale_price, profit_margin_amount, campaign, quality gibi admin alanlarını DEĞİŞTİREMEZ
        # - supplier_price değiştirirse sale_price otomatik hesaplanır (= supplier_price + profit_margin_amount)
        protected_from_supplier = [
            "profit_margin_amount", "sale_price", "price_updated_by",
            "campaign_discount_percent", "campaign_min_qty", "quality",
            "hidden", "active_gel_al", "active_eve_servis",
        ]
        for f in protected_from_supplier:
            if f in updates:
                updates[f] = existing.get(f)  # mevcut değeri koru
        
        # supplier_price güncelleniyorsa sale_price'ı yeniden hesapla
        if "supplier_price" in sent:
            # Fiyat kilidi kontrolü
            locked_until = existing.get("supplier_price_locked_until")
            if locked_until:
                # Tarih string ise parse et
                if isinstance(locked_until, str):
                    try:
                        locked_until = datetime.fromisoformat(locked_until.replace("Z", "+00:00"))
                    except:
                        locked_until = None
                # Kilit hâlâ geçerliyse engelle
                if locked_until and locked_until > now_utc():
                    raise HTTPException(
                        status_code=400,
                        detail=f"Fiyat değişikliği bugün için kilitlenmiştir. Yeni fiyatınız yarın (00:00) itibarıyla güncellenebilir."
                    )
            
            new_supp_price = updates.get("supplier_price") or 0
            margin = existing.get("profit_margin_amount") or 0
            updates["sale_price"] = new_supp_price + margin
            updates["price"] = updates["sale_price"]  # müşteri fiyatı = sale_price
            updates["price_updated_at"] = now_utc()
            updates["price_updated_by"] = "supplier"
            
            # Bugünün sonuna kadar kilitle (Istanbul TZ 23:59:59)
            from datetime import timezone as tz
            from zoneinfo import ZoneInfo
            ist = ZoneInfo("Europe/Istanbul")
            now_ist = datetime.now(ist)
            end_of_today = now_ist.replace(hour=23, minute=59, second=59, microsecond=999999)
            updates["supplier_price_locked_until"] = end_of_today.astimezone(timezone.utc)
        else:
            # supplier_price değişmiyorsa çift-fiyat alanlarını koru
            for f in DUAL_PRICE_FIELDS:
                if f not in sent:
                    updates[f] = existing.get(f)
    else:
        # ADMIN GÜNCELLEMESI: her şeyi değiştirebilir
        # profit_margin veya sale_price değişirse diğeri otomatik hesaplanır
        
        # Çift-fiyat alanları gönderilmediyse mevcut değerleri koru
        for f in DUAL_PRICE_FIELDS:
            if f not in sent:
                updates[f] = existing.get(f)
        
        # Admin profit_margin_amount değiştiriyorsa → sale_price yeniden hesapla
        if "profit_margin_amount" in sent:
            supp_price = updates.get("supplier_price") or existing.get("supplier_price") or 0
            margin = updates.get("profit_margin_amount") or 0
            updates["sale_price"] = supp_price + margin
            updates["price"] = updates["sale_price"]
            updates["price_updated_at"] = now_utc()
            updates["price_updated_by"] = "admin"
        # Admin sale_price doğrudan değiştiriyorsa → profit_margin_amount yeniden hesapla
        elif "sale_price" in sent:
            supp_price = updates.get("supplier_price") or existing.get("supplier_price") or 0
            sale = updates.get("sale_price") or 0
            updates["profit_margin_amount"] = max(0, sale - supp_price)
            updates["price"] = sale
            updates["price_updated_at"] = now_utc()
            updates["price_updated_by"] = "admin"
        # Admin supplier_price değiştiriyorsa → sale_price yeniden hesapla (margin korunur)
        elif "supplier_price" in sent:
            new_supp_price = updates.get("supplier_price") or 0
            margin = existing.get("profit_margin_amount") or 0
            updates["sale_price"] = new_supp_price + margin
            updates["price"] = updates["sale_price"]
            updates["price_updated_at"] = now_utc()
            updates["price_updated_by"] = "admin"
    
    if not updates.get("price"):
        updates["price"] = updates.get("gel_al_price") or 0
    
    updates["updated_at"] = now_utc()
    result = await db.products.update_one({"id": product_id}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Ürün bulunamadı")
    product = await db.products.find_one({"id": product_id}, {"_id": 0})
    # --- LOG: product_updated ---
    _pchanged = []
    for _pf in ["sale_price", "supplier_price", "name", "active", "profit_margin_amount"]:
        _pov = existing.get(_pf)
        _pnv = updates.get(_pf)
        if _pov != _pnv and _pnv is not None:
            _pchanged.append({"field": _pf, "old_value": _pov, "new_value": _pnv})
    if _pchanged:
        await _insert_log("log_admin", {"admin_id": staff["user_id"], "admin_name": staff.get("name",""), "action": "product_updated", "target_type": "product", "target_id": product_id, "change_details": _pchanged[0] if len(_pchanged)==1 else {"fields": _pchanged}, "admin_note": ""}, request)
    return product


@router.delete("/admin/products/{product_id}")
async def delete_product(product_id: str, staff=Depends(get_current_staff), request: Request = None):
    # Tedarikçi (esnaf/supplier) sadece kendi tedarikçisinin ürünlerini silebilir
    if is_supplier_role(staff):
        sg = get_user_supplier_group(staff)
        existing = await db.products.find_one({"id": product_id}, {"_id": 0, "supplier_group": 1})
        if not existing:
            raise HTTPException(status_code=404, detail="Ürün bulunamadı")
        if not sg or existing.get("supplier_group") != sg:
            raise HTTPException(status_code=403, detail="Bu ürünü silme yetkiniz yok")
        await _afro_require_supplier_contract(staff)
    _del_prod = await db.products.find_one({"id": product_id}, {"_id": 0, "name": 1})
    result = await db.products.delete_one({"id": product_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Ürün bulunamadı")
    await _insert_log("log_admin", {"admin_id": staff["user_id"], "admin_name": staff.get("name",""), "action": "product_deleted", "target_type": "product", "target_id": product_id, "change_details": {"field": "deleted", "old_value": (_del_prod or {}).get("name"), "new_value": None}, "admin_note": ""}, request)
    return {"success": True}


# ---------------- Campaign Routes ----------------
@router.get("/campaigns", response_model=List[Campaign])
async def list_campaigns(user=Depends(get_optional_user)):
    query = {"active": True}
    if not user:
        query["members_only"] = False
    campaigns = await db.campaigns.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return campaigns


@router.get("/admin/campaigns", response_model=List[Campaign])
async def admin_list_campaigns(admin=Depends(get_current_admin)):
    campaigns = await db.campaigns.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return campaigns


@router.post("/admin/campaigns", response_model=Campaign)
async def create_campaign(payload: CampaignInput, admin=Depends(get_current_admin)):
    campaign = Campaign(**payload.dict())
    await db.campaigns.insert_one(campaign.dict())
    # ── PUSH BİLDİRİM: Yeni kampanya → tüm kullanıcılara ──
    try:
        push_body = (payload.description or "")[:80] or "Kaçırmayın, süre sınırlı!"
        await send_push_to_all(
            title=f"🎉 {payload.title}",
            body=push_body,
            data={"type": "campaign", "campaign_id": campaign.id, "url": "/"},
        )
    except Exception:
        pass
    return campaign


@router.put("/admin/campaigns/{campaign_id}", response_model=Campaign)
async def update_campaign(campaign_id: str, payload: CampaignInput, admin=Depends(get_current_admin)):
    result = await db.campaigns.update_one({"id": campaign_id}, {"$set": payload.dict()})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Kampanya bulunamadı")
    campaign = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})
    return campaign


@router.delete("/admin/campaigns/{campaign_id}")
async def delete_campaign(campaign_id: str, admin=Depends(get_current_admin)):
    result = await db.campaigns.delete_one({"id": campaign_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Kampanya bulunamadı")
    return {"success": True}
