"""Tedarikçi endpoint'leri: satış/hakediş logu, fiyat kilidi, ödeme takibi,
tedarikçi CRUD (admin), sözleşme onayı."""
import hmac
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo as _AFRO_ZI

from fastapi import APIRouter, Depends, HTTPException, Request

from core.crypto import dec_str, enc_str
from core.db import db
from core.logs import _insert_log
from core.security import (
    get_current_admin, get_current_staff, get_current_supplier,
    get_user_supplier_group, SUPPLIER_ROLES, _yonetici_only,
)
from core.util import now_utc, new_id, to_aware, _afro_norm
from models import SupplierInput, AfroSupplierPayMark, AfroSupplierPayConfirm, AfroSupplierContractInput
from services.catalog import _write_catalog_config
from services.contracts import _afro_supplier_contract_cfg
from services.orders import _as_float
from services.sms import send_sms_verimor, _generate_sms_code
from services.suppliers import (
    SUPPLIER_SOLD_STATUSES, _order_refund_info, _order_item_refunds, _build_cost_map,
    _item_unit_cost, _supplier_items_of_order,
)

logger = logging.getLogger("afro.routers.suppliers")

router = APIRouter(prefix="/api")


@router.get("/supplier/my-sales")
async def supplier_my_sales(current_supplier: dict = Depends(get_current_supplier)):
    """Tedarikçinin kendi satış logu (tezgah fiyatından hesaplanan).

    Tedarikçi SADECE kendi ürünlerinin satışını görür:
    - Tarih, saat, ürün, miktar, birim fiyat (tezgah), tutar
    - Müşteri bilgisi GİZLİ (ad, telefon, adres gösterilmez)
    - Sipariş numarası GİZLİ
    - Satış fiyatı ve kâr marjı GİZLİ
    """
    supplier_group = get_user_supplier_group(current_supplier)
    if not supplier_group:
        raise HTTPException(status_code=403, detail="Tedarikçi grubu tanımlı değil")

    target = _afro_norm(supplier_group)
    orders = await db.transactions.find(
        {"order_status": {"$in": list(SUPPLIER_SOLD_STATUSES)}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(5000)

    cost_map = await _build_cost_map()
    log = []
    total_sold = 0.0
    total_refunded = 0.0

    for o in orders:
        sup_items, sup_subtotal, sup_ref_items, item_level = _supplier_items_of_order(o, target, cost_map)
        if not sup_items:
            continue
        total_sold += sup_subtotal

        refunded_amount = 0.0
        refund_label = ""
        if item_level:
            refunded_amount = round(sup_ref_items, 2)
            if refunded_amount > 0:
                refund_label = "İade edildi" if refunded_amount >= sup_subtotal - 0.001 else "Kısmi iade"
        else:
            full, partial, ramt = _order_refund_info(o)
            order_subtotal = _as_float(o.get("subtotal"), 0) or _as_float(o.get("amount"), 0)
            if partial and ramt > 0 and order_subtotal > 0:
                share = sup_subtotal / order_subtotal
                refunded_amount = round(min(sup_subtotal, ramt * share), 2)
                refund_label = "Kısmi iade"
        total_refunded += refunded_amount

        # Tedarikçiye döndürülen veri: müşteri/sipariş bilgisi GİZLİ
        log.append({
            "date": o.get("delivered_at") or o.get("created_at"),
            "delivery_type": o.get("delivery_type") or o.get("delivery_method") or "",
            "items": sup_items,
            "subtotal": sup_subtotal,
            "refunded": bool(refunded_amount > 0),
            "refunded_amount": round(refunded_amount, 2),
            "refund_label": refund_label,
            "net": round(sup_subtotal - refunded_amount, 2),
        })

    return {
        "supplier": supplier_group,
        "order_count": len(log),
        "total_sold": round(total_sold, 2),
        "total_refunded": round(total_refunded, 2),
        "net_total": round(total_sold - total_refunded, 2),
        "log": log,
    }


@router.get("/admin/supplier-sales")
async def admin_supplier_sales(supplier: str, current_admin: dict = Depends(get_current_admin)):
    """Tek bir tedarikçinin satış logu + toplam tutar (iadeler düşülmüş)."""
    target = _afro_norm(supplier)
    if not target:
        raise HTTPException(status_code=400, detail="Tedarikçi adı gerekli")

    # Sadece satılan (teslim edilen) siparişler
    orders = await db.transactions.find(
        {"order_status": {"$in": list(SUPPLIER_SOLD_STATUSES)}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(5000)

    cost_map = await _build_cost_map()

    log = []
    total_sold = 0.0        # iade öncesi brüt (bu tedarikçinin payı)
    total_refunded = 0.0    # bu tedarikçiye düşen iade tutarı
    order_count = 0

    for o in orders:
        sup_items, sup_subtotal, sup_ref_items, item_level = _supplier_items_of_order(o, target, cost_map)
        # Kalem varsa göster (alış fiyatı girilmemişse tutar 0 görünür, satış yine listelenir)
        if not sup_items:
            continue
        order_count += 1
        total_sold += sup_subtotal

        refunded_amount = 0.0
        refund_label = ""
        if item_level:
            # YENİ sistem: iade edilen ürünlerin tutarı birebir düşülür
            refunded_amount = round(sup_ref_items, 2)
            if refunded_amount > 0:
                refund_label = "İade edildi" if refunded_amount >= sup_subtotal - 0.001 else "Kısmi iade"
        else:
            # ESKİ kısmi iade: orantısal (pay bazlı) fallback
            full, partial, ramt = _order_refund_info(o)
            order_subtotal = _as_float(o.get("subtotal"), 0) or _as_float(o.get("amount"), 0)
            if partial and ramt > 0 and order_subtotal > 0:
                share = sup_subtotal / order_subtotal
                refunded_amount = round(min(sup_subtotal, ramt * share), 2)
                refund_label = "Kısmi iade"
        total_refunded += refunded_amount

        log.append({
            "tx_id": o.get("tx_id"),
            "date": o.get("delivered_at") or o.get("created_at"),
            "customer": o.get("user_name") or "Müşteri",
            "customer_phone": o.get("user_phone") or "",
            "delivery_type": o.get("delivery_type") or o.get("delivery_method") or "",
            "items": sup_items,
            "subtotal": sup_subtotal,           # bu tedarikçinin bu siparişteki brüt tutarı
            "refunded": bool(refunded_amount > 0),
            "refunded_amount": round(refunded_amount, 2),
            "refund_label": refund_label,
            "net": round(sup_subtotal - refunded_amount, 2),
        })

    return {
        "supplier": supplier,
        "order_count": order_count,
        "total_sold": round(total_sold, 2),         # iade öncesi brüt toplam
        "total_refunded": round(total_refunded, 2), # toplam iade
        "net_total": round(total_sold - total_refunded, 2),  # net (gösterilecek) tutar
        "log": log,
    }


@router.get("/admin/supplier-sales-summary")
async def admin_supplier_sales_summary(current_admin: dict = Depends(get_current_admin)):
    """Tüm tedarikçiler için özet: net toplam, brüt, iade ve sipariş sayısı.
    Tedarikçi listesinde her satırın yanında tutarı göstermek için tek çağrı."""
    orders = await db.transactions.find(
        {"order_status": {"$in": list(SUPPLIER_SOLD_STATUSES)}},
        {"_id": 0},
    ).to_list(5000)

    cost_map = await _build_cost_map()

    # supplier_norm -> aggregate
    agg = {}
    for o in orders:
        refunded_flags, item_level = _order_item_refunds(o)
        full, partial, ramt = _order_refund_info(o)
        order_subtotal = _as_float(o.get("subtotal"), 0) or _as_float(o.get("amount"), 0)
        # Bu siparişteki tedarikçi bazlı alt-toplamlar + kalem-bazlı iade
        # (tutarlar tedarikçinin kendi alış/tedarik fiyatı üzerinden)
        by_sup = {}
        for idx, it in enumerate(o.get("items") or []):
            raw_sg = it.get("supplier_group_snapshot") or ""
            key = _afro_norm(raw_sg)
            if not key:
                continue
            qty = _as_float(it.get("qty", it.get("quantity", 0)), 0)
            lt = round(_item_unit_cost(it, cost_map) * qty, 2)
            if key not in by_sup:
                by_sup[key] = {"display": raw_sg, "subtotal": 0.0, "ref_items": 0.0}
            by_sup[key]["subtotal"] += lt
            if item_level and idx < len(refunded_flags) and refunded_flags[idx]:
                by_sup[key]["ref_items"] += lt
        for key, info in by_sup.items():
            sub = round(info["subtotal"], 2)
            if sub <= 0:
                continue
            if item_level:
                # YENİ sistem: iade edilen ürünlerin tutarı birebir düşülür
                refunded = round(info["ref_items"], 2)
            elif partial and ramt > 0 and order_subtotal > 0:
                # ESKİ kısmi iade: orantısal fallback
                refunded = round(min(sub, ramt * (sub / order_subtotal)), 2)
            else:
                refunded = 0.0
            if key not in agg:
                agg[key] = {"supplier": info["display"], "total_sold": 0.0,
                            "total_refunded": 0.0, "order_count": 0}
            agg[key]["total_sold"] += sub
            agg[key]["total_refunded"] += refunded
            agg[key]["order_count"] += 1

    result = {}
    for key, v in agg.items():
        result[v["supplier"]] = {
            "total_sold": round(v["total_sold"], 2),
            "total_refunded": round(v["total_refunded"], 2),
            "net_total": round(v["total_sold"] - v["total_refunded"], 2),
            "order_count": v["order_count"],
        }
    return result


@router.get("/admin/all-supplier-sales")
async def admin_all_supplier_sales(current_admin: dict = Depends(get_current_admin)):
    """TÜM tedarikçilerin satış logu (tek çağrı).

    Her satış girdisi tedarikçi adı + tarih ile etiketlenir; böylece frontend:
      * tarihe göre filtreleyebilir,
      * tedarikçiye göre gruplayabilir,
      * genel (tüm tedarikçiler) toplamı hesaplayabilir.
    Mantık `supplier-sales` ile aynıdır; fark: tek tedarikçiye kısıtlamak yerine
    her siparişteki HER tedarikçi grubu için ayrı bir log girdisi üretir.
    """
    orders = await db.transactions.find(
        {"order_status": {"$in": list(SUPPLIER_SOLD_STATUSES)}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(5000)

    cost_map = await _build_cost_map()

    log = []
    suppliers_set = set()
    grand_sold = 0.0
    grand_refunded = 0.0
    grand_profit = 0.0        # toplam KÂR (yalnızca yöneticide gösterilir)
    unknown_cost_items = 0    # alış (tedarik) fiyatı bilinmeyen kalem sayısı

    for o in orders:
        refunded_flags, item_level = _order_item_refunds(o)
        full, partial, ramt = _order_refund_info(o)
        order_subtotal = _as_float(o.get("subtotal"), 0) or _as_float(o.get("amount"), 0)

        # Bu siparişteki tedarikçi grubu -> kalemler
        by_sup = {}
        for idx, it in enumerate(o.get("items") or []):
            raw_sg = it.get("supplier_group_snapshot") or ""
            key = _afro_norm(raw_sg)
            if not key:
                continue
            lt = _as_float(it.get("line_total", it.get("total_price")), 0)
            is_ref = bool(item_level and idx < len(refunded_flags) and refunded_flags[idx])
            qty = _as_float(it.get("qty", it.get("quantity", 0)), 0)
            unit_cost = _item_unit_cost(it, cost_map)          # alış (tedarik) birim fiyatı
            cost_total = round(unit_cost * qty, 2)             # maliyet
            item_profit = round(lt - cost_total, 2)            # kâr (satış - maliyet)
            cost_known = unit_cost > 0
            if not cost_known:
                unknown_cost_items += 1
            if key not in by_sup:
                by_sup[key] = {"display": raw_sg, "items": [], "subtotal": 0.0,
                               "ref_items": 0.0, "profit": 0.0}
            by_sup[key]["items"].append({
                "name": it.get("name") or it.get("product_name_snapshot") or "Ürün",
                "qty": qty,
                "unit": it.get("unit") or it.get("unit_snapshot") or "",
                "price": _as_float(it.get("price", it.get("unit_price_snapshot")), 0),
                "line_total": round(lt, 2),
                "cost": cost_total,
                "profit": item_profit,
                "cost_known": cost_known,
                "category": it.get("category_snapshot") or "",
                "refunded": is_ref,
            })
            by_sup[key]["subtotal"] += lt
            if is_ref:
                by_sup[key]["ref_items"] += lt
            else:
                # Kâr yalnızca iade EDİLMEMİŞ kalemler için sayılır
                by_sup[key]["profit"] += item_profit

        for key, info in by_sup.items():
            sub = round(info["subtotal"], 2)
            if sub <= 0:
                continue
            refunded_amount = 0.0
            refund_label = ""
            if item_level:
                # YENİ sistem: iade edilen ürünlerin tutarı birebir düşülür
                refunded_amount = round(info["ref_items"], 2)
                if refunded_amount > 0:
                    refund_label = "İade edildi" if refunded_amount >= sub - 0.001 else "Kısmi iade"
            elif partial and ramt > 0 and order_subtotal > 0:
                # ESKİ kısmi iade: orantısal fallback
                refunded_amount = round(min(sub, ramt * (sub / order_subtotal)), 2)
                refund_label = "Kısmi iade"

            order_profit = round(info["profit"], 2)
            suppliers_set.add(info["display"])
            grand_sold += sub
            grand_refunded += refunded_amount
            grand_profit += order_profit

            log.append({
                "tx_id": o.get("tx_id"),
                "supplier": info["display"],
                "date": o.get("delivered_at") or o.get("created_at"),
                "customer": o.get("user_name") or "Müşteri",
                "customer_phone": o.get("user_phone") or "",
                "delivery_type": o.get("delivery_type") or o.get("delivery_method") or "",
                "items": info["items"],
                "subtotal": sub,
                "refunded": bool(refunded_amount > 0),
                "refunded_amount": round(refunded_amount, 2),
                "refund_label": refund_label,
                "net": round(sub - refunded_amount, 2),
                "profit": order_profit,
            })

    return {
        "suppliers": sorted(suppliers_set),
        "order_count": len(log),
        "grand_sold": round(grand_sold, 2),
        "grand_refunded": round(grand_refunded, 2),
        "grand_net": round(grand_sold - grand_refunded, 2),
        "grand_profit": round(grand_profit, 2),
        "unknown_cost_items": unknown_cost_items,
        "log": log,
    }


# =====================================================================
# MADDE 6 — ADMIN MANUEL FİYAT KİLİDİ (aç / kapa)
# Tedarikçi supplier_price değiştirince ürün o gün için otomatik kilitlenir.
# OTOMATİK gece-yarısı cron YOKtur; yönetici kilidi manuel açar/kapatır.
# =====================================================================
_AFRO_IST_TZ = _AFRO_ZI("Europe/Istanbul")


def _afro_end_of_today_utc():
    now_ist = datetime.now(_AFRO_IST_TZ)
    eod = now_ist.replace(hour=23, minute=59, second=59, microsecond=999999)
    return eod.astimezone(timezone.utc)


def _afro_ist_day_key(val):
    """Bir tarih/datetime/ISO değerinden İstanbul saatine göre YYYY-MM-DD anahtarı."""
    if not val:
        return ""
    dt = val
    if isinstance(val, str):
        try:
            dt = datetime.fromisoformat(val.replace("Z", "+00:00"))
        except Exception:
            return val[:10] if len(val) >= 10 else ""
    try:
        dt = to_aware(dt)
        return dt.astimezone(_AFRO_IST_TZ).strftime("%Y-%m-%d")
    except Exception:
        return ""


async def _afro_set_supplier_lock(supplier_group, lock: bool):
    target = _afro_norm(supplier_group or "")
    if not target:
        raise HTTPException(status_code=400, detail="Tedarikçi belirtilmedi")
    prods = await db.products.find({}, {"_id": 0, "id": 1, "supplier_group": 1}).to_list(5000)
    ids = [p["id"] for p in prods
           if _afro_norm(p.get("supplier_group") or "") == target and p.get("id") is not None]
    val = _afro_end_of_today_utc() if lock else None
    if ids:
        await db.products.update_many({"id": {"$in": ids}},
                                      {"$set": {"supplier_price_locked_until": val}})
    return len(ids)


@router.get("/admin/supplier/{supplier_group}/lock-status")
async def admin_supplier_lock_status(supplier_group: str, current_admin: dict = Depends(get_current_admin)):
    _yonetici_only(current_admin)
    target = _afro_norm(supplier_group or "")
    prods = await db.products.find(
        {}, {"_id": 0, "supplier_group": 1, "supplier_price_locked_until": 1}
    ).to_list(5000)
    total = 0
    locked = 0
    now = now_utc()
    for p in prods:
        if _afro_norm(p.get("supplier_group") or "") != target:
            continue
        total += 1
        lu = p.get("supplier_price_locked_until")
        if isinstance(lu, str):
            try:
                lu = datetime.fromisoformat(lu.replace("Z", "+00:00"))
            except Exception:
                lu = None
        if lu and to_aware(lu) > now:
            locked += 1
    return {"supplier": supplier_group, "total": total, "locked": locked,
            "is_locked": locked > 0}


@router.post("/admin/supplier/{supplier_group}/unlock-prices")
async def admin_unlock_supplier_prices(supplier_group: str, current_admin: dict = Depends(get_current_admin), request: Request = None):
    _yonetici_only(current_admin)
    n = await _afro_set_supplier_lock(supplier_group, False)
    try:
        await db.admin_logs.insert_one({
            "id": new_id("log"), "log_type": "price_lock_override",
            "action": "unlock_prices", "supplier_group": supplier_group,
            "affected": n, "admin_id": current_admin.get("user_id"),
            "created_at": now_utc(),
        })
    except Exception:
        pass
    await _insert_log("log_admin", {"admin_id": current_admin["user_id"], "admin_name": current_admin.get("name",""), "action": "supplier_price_lock_override", "target_type": "supplier", "target_id": supplier_group, "change_details": {"field": "price_lock", "old_value": "locked", "new_value": "unlocked"}, "admin_note": ""}, request)
    return {"success": True, "supplier": supplier_group, "affected": n, "locked": False}


@router.post("/admin/supplier/{supplier_group}/lock-prices")
async def admin_lock_supplier_prices(supplier_group: str, current_admin: dict = Depends(get_current_admin), request: Request = None):
    _yonetici_only(current_admin)
    n = await _afro_set_supplier_lock(supplier_group, True)
    try:
        await db.admin_logs.insert_one({
            "id": new_id("log"), "log_type": "price_lock_override",
            "action": "lock_prices", "supplier_group": supplier_group,
            "affected": n, "admin_id": current_admin.get("user_id"),
            "created_at": now_utc(),
        })
    except Exception:
        pass
    await _insert_log("log_admin", {"admin_id": current_admin["user_id"], "admin_name": current_admin.get("name",""), "action": "supplier_price_lock_override", "target_type": "supplier", "target_id": supplier_group, "change_details": {"field": "price_lock", "old_value": "unlocked", "new_value": "locked"}, "admin_note": ""}, request)
    return {"success": True, "supplier": supplier_group, "affected": n, "locked": True}


# =====================================================================
# MADDE 8 — TEDARİKÇİ ÖDEME TAKİP SİSTEMİ
# Günlük tedarikçi bazlı hesaplaşma: tezgah (alış) fiyatından net tutar,
# iade kesintisi, ödendi/bekliyor durumu. Ödeme işaretleri
# `supplier_payments` koleksiyonunda (supplier_key + date) tutulur.
# =====================================================================
def _afro_tr_money(n) -> str:
    """1887.5 -> '1.887,50' (TR biçim, ASCII)."""
    try:
        s = f"{float(n):,.2f}"  # 1,887.50
    except Exception:
        return str(n)
    return s.replace(",", "X").replace(".", ",").replace("X", ".")


def _afro_date_tr(date_key: str) -> str:
    """YYYY-MM-DD -> dd.mm.yyyy"""
    try:
        y, m, d = (date_key or "").split("-")
        return f"{d}.{m}.{y}"
    except Exception:
        return date_key or ""


async def _afro_supplier_phones(supplier_key: str):
    """supplier_key (normalize) için esnaf kullanıcıların telefonlarını döndür.
    Dönüş: [{'phone':..., 'name':..., 'user_id':...}, ...]"""
    out = []
    seen = set()
    async for u in db.users.find(
        {"role": {"$in": list(SUPPLIER_ROLES)}},
        {"_id": 0, "phone": 1, "supplier_group": 1, "supplier_name": 1, "name": 1, "user_id": 1},
    ):
        sg = u.get("supplier_group") or u.get("supplier_name") or ""
        if _afro_norm(sg) != supplier_key:
            continue
        ph = (u.get("phone") or "").strip()
        if not ph or ph in seen:
            continue
        seen.add(ph)
        out.append({"phone": ph, "name": u.get("name") or "", "user_id": u.get("user_id")})
    return out


async def _afro_supplier_settlements_for_day(date_key):
    """Verilen gün (YYYY-MM-DD, İstanbul) için tedarikçi bazlı özet.
    Dönüş: { norm_key: {display, gross, refund, items:[...] } }"""
    orders = await db.transactions.find(
        {"order_status": {"$in": list(SUPPLIER_SOLD_STATUSES)}}, {"_id": 0}
    ).sort("created_at", -1).to_list(5000)
    cost_map = await _build_cost_map()
    agg = {}
    for o in orders:
        odate = o.get("delivered_at") or o.get("created_at")
        if _afro_ist_day_key(odate) != date_key:
            continue
        sgs = {}
        for it in (o.get("items") or []):
            k = _afro_norm(it.get("supplier_group_snapshot") or "")
            if k and k not in sgs:
                sgs[k] = it.get("supplier_group_snapshot") or ""
        for k, disp in sgs.items():
            sup_items, sub, ref_items, item_level = _supplier_items_of_order(o, k, cost_map)
            if not sup_items:
                continue
            refunded_amount = 0.0
            if item_level:
                refunded_amount = round(ref_items, 2)
            else:
                full, partial, ramt = _order_refund_info(o)
                osub = _as_float(o.get("subtotal"), 0) or _as_float(o.get("amount"), 0)
                if partial and ramt > 0 and osub > 0:
                    refunded_amount = round(min(sub, ramt * (sub / osub)), 2)
            if k not in agg:
                agg[k] = {"display": disp or k, "gross": 0.0, "refund": 0.0, "items": []}
            agg[k]["gross"] += sub
            agg[k]["refund"] += refunded_amount
            agg[k]["items"].extend(sup_items)
    return agg


@router.get("/admin/supplier-payments")
async def admin_supplier_payments(date: Optional[str] = None,
                                  current_admin: dict = Depends(get_current_admin)):
    """Belirli bir gün için tedarikçi bazlı ödeme tablosu (yönetici)."""
    _yonetici_only(current_admin)
    date_key = (date or "").strip() or _afro_ist_day_key(now_utc())
    agg = await _afro_supplier_settlements_for_day(date_key)
    markers = {}
    async for d in db.supplier_payments.find({"date": date_key}, {"_id": 0}):
        markers[d.get("supplier_key")] = d
    rows = []
    tot_gross = tot_ref = tot_net = 0.0
    for k, info in agg.items():
        gross = round(info["gross"], 2)
        refund = round(info["refund"], 2)
        net = round(gross - refund, 2)
        mk = markers.get(k) or {}
        rows.append({
            "supplier_key": k,
            "supplier": info["display"],
            "gross": gross,
            "refund": refund,
            "net": net,
            "status": mk.get("status") or "pending",
            "paid_at": mk.get("paid_at"),
            "note": mk.get("note") or "",
            "confirm_status": mk.get("confirm_status") or "pending",
            "confirmed_at": mk.get("confirmed_at"),
            "confirmed_by_phone": mk.get("confirmed_by_phone"),
            "confirm_sms_sent": bool(mk.get("confirm_sms_sent")),
            "items": info["items"],
        })
        tot_gross += gross
        tot_ref += refund
        tot_net += net
    rows.sort(key=lambda r: -r["net"])
    return {"date": date_key, "rows": rows,
            "total_gross": round(tot_gross, 2),
            "total_refund": round(tot_ref, 2),
            "total_net": round(tot_net, 2)}


@router.post("/admin/supplier-payments/mark-paid")
async def admin_supplier_payment_mark_paid(payload: AfroSupplierPayMark,
                                           current_admin: dict = Depends(get_current_admin), request: Request = None):
    _yonetici_only(current_admin)
    key = _afro_norm(payload.supplier_group or "")
    if not key or not (payload.date or "").strip():
        raise HTTPException(status_code=400, detail="Tedarikçi ve tarih gerekli")
    agg = await _afro_supplier_settlements_for_day(payload.date)
    info = agg.get(key) or {}
    net = round(_as_float(info.get("gross"), 0) - _as_float(info.get("refund"), 0), 2) if info else 0.0
    # Çift taraflı mutabakat: 6 haneli onay kodu üret + tedarikçiye SMS gönder
    code = _generate_sms_code()
    code_expires = now_utc() + timedelta(days=7)
    doc = {
        "supplier_key": key,
        "supplier": info.get("display") or payload.supplier_group,
        "date": payload.date,
        "status": "paid",
        "paid_at": now_utc(),
        "note": (payload.note or ""),
        "net_snapshot": net,
        "admin_id": current_admin.get("user_id"),
        # onay akışı
        "confirm_code": enc_str(code),
        "confirm_code_expires_at": code_expires,
        "confirm_status": "pending",
        "confirm_attempts": 0,
        "confirmed_at": None,
        "confirmed_by_phone": None,
        "confirmed_by_user_id": None,
    }
    await db.supplier_payments.update_one(
        {"supplier_key": key, "date": payload.date}, {"$set": doc}, upsert=True
    )
    # SMS gönder (tedarikçi telefon(lar)ına)
    phones = await _afro_supplier_phones(key)
    date_tr = _afro_date_tr(payload.date)
    money = _afro_tr_money(net)
    message = (
        "Afro Gida\n"
        f"{date_tr} tarihli {money} TL odemeniz yapildi.\n"
        f"Onay kodu: {code}\n"
        "Satislarim panelinden bu kodu girerek odemeyi onaylayin."
    )
    sms_ok = False
    for p in phones:
        try:
            if send_sms_verimor(p["phone"], message):
                sms_ok = True
        except Exception as exc:
            logger.error("[SUPPLIER-PAY] SMS hatasi %s: %s", p.get("phone"), exc)
    await db.supplier_payments.update_one(
        {"supplier_key": key, "date": payload.date},
        {"$set": {"confirm_sms_sent": bool(sms_ok), "confirm_sms_at": now_utc()}},
    )
    await _insert_log("log_admin", {"admin_id": current_admin["user_id"], "admin_name": current_admin.get("name",""), "action": "supplier_payment_marked", "target_type": "payment", "target_id": f"{key}_{payload.date}", "change_details": {"field": "payment_status", "old_value": "unpaid", "new_value": "paid", "sms_sent": bool(sms_ok), "phones": len(phones)}, "admin_note": payload.note or ""}, request)
    return {"success": True, "status": "paid", "net": net,
            "sms_sent": bool(sms_ok), "phone_count": len(phones)}


@router.post("/admin/supplier-payments/mark-unpaid")
async def admin_supplier_payment_mark_unpaid(payload: AfroSupplierPayMark,
                                             current_admin: dict = Depends(get_current_admin), request: Request = None):
    _yonetici_only(current_admin)
    key = _afro_norm(payload.supplier_group or "")
    if not key or not (payload.date or "").strip():
        raise HTTPException(status_code=400, detail="Tedarikçi ve tarih gerekli")
    await db.supplier_payments.update_one(
        {"supplier_key": key, "date": payload.date},
        {"$set": {"status": "pending", "unpaid_at": now_utc(),
                  "admin_id": current_admin.get("user_id"),
                  "confirm_status": "pending", "confirm_code": None,
                  "confirm_code_expires_at": None, "confirmed_at": None,
                  "confirmed_by_phone": None, "confirmed_by_user_id": None}},
        upsert=True,
    )
    await _insert_log("log_admin", {"admin_id": current_admin["user_id"], "admin_name": current_admin.get("name",""), "action": "supplier_payment_unmarked", "target_type": "payment", "target_id": f"{key}_{payload.date}", "change_details": {"field": "payment_status", "old_value": "paid", "new_value": "pending"}, "admin_note": ""}, request)
    return {"success": True, "status": "pending"}


@router.post("/supplier/my-payments/confirm")
async def supplier_confirm_payment(payload: AfroSupplierPayConfirm,
                                   current_supplier: dict = Depends(get_current_supplier),
                                   request: Request = None):
    """Tedarikçi, SMS ile gelen onay kodunu girerek ödemeyi onaylar.
    Bu, çift taraflı mutabakatı (idari 'ödendi' + tedarikçi 'aldım') oluşturur."""
    sg = get_user_supplier_group(current_supplier)
    if not sg:
        raise HTTPException(status_code=403, detail="Tedarikçi grubu tanımlı değil")
    key = _afro_norm(sg)
    date_key = (payload.date or "").strip()
    code = (payload.code or "").strip()
    if not date_key or not code:
        raise HTTPException(status_code=400, detail="Tarih ve onay kodu gerekli")
    mk = await db.supplier_payments.find_one({"supplier_key": key, "date": date_key}, {"_id": 0})
    if not mk or mk.get("status") != "paid":
        raise HTTPException(status_code=404, detail="Bu tarih için işaretlenmiş bir ödeme bulunamadı")
    if mk.get("confirm_status") == "confirmed":
        return {"success": True, "already": True, "confirm_status": "confirmed",
                "confirmed_at": mk.get("confirmed_at")}
    if not mk.get("confirm_code"):
        raise HTTPException(status_code=400, detail="Onay kodu bulunamadı, lütfen yöneticiden yeni kod isteyin")
    attempts = int(mk.get("confirm_attempts") or 0)
    if attempts >= 5:
        raise HTTPException(status_code=429, detail="Çok fazla hatalı deneme. Lütfen yöneticiden yeni kod isteyin")
    exp = mk.get("confirm_code_expires_at")
    try:
        if exp and now_utc() > exp:
            raise HTTPException(status_code=400, detail="Onay kodunun süresi dolmuş, yöneticiden yeni kod isteyin")
    except HTTPException:
        raise
    except Exception:
        pass
    if not hmac.compare_digest(str(code), str(dec_str(mk.get("confirm_code")))):
        await db.supplier_payments.update_one(
            {"supplier_key": key, "date": date_key},
            {"$inc": {"confirm_attempts": 1}},
        )
        raise HTTPException(status_code=400, detail="Onay kodu hatalı")
    phone = (current_supplier.get("phone") or "").strip()
    await db.supplier_payments.update_one(
        {"supplier_key": key, "date": date_key},
        {"$set": {"confirm_status": "confirmed", "confirmed_at": now_utc(),
                  "confirmed_by_phone": phone,
                  "confirmed_by_user_id": current_supplier.get("user_id")}},
    )
    await _insert_log("log_admin", {"admin_id": current_supplier.get("user_id"), "admin_name": current_supplier.get("name",""), "action": "supplier_payment_confirmed", "target_type": "payment", "target_id": f"{key}_{date_key}", "change_details": {"field": "confirm_status", "old_value": "pending", "new_value": "confirmed", "confirmed_by_phone": phone}, "admin_note": ""}, request)
    return {"success": True, "confirm_status": "confirmed", "confirmed_at": now_utc()}


@router.post("/admin/supplier-payments/resend-code")
async def admin_supplier_payment_resend_code(payload: AfroSupplierPayMark,
                                             current_admin: dict = Depends(get_current_admin), request: Request = None):
    """Yeni onay kodu üretip tedarikçiye tekrar SMS gönderir (ödeme zaten 'paid' olmalı)."""
    _yonetici_only(current_admin)
    key = _afro_norm(payload.supplier_group or "")
    if not key or not (payload.date or "").strip():
        raise HTTPException(status_code=400, detail="Tedarikçi ve tarih gerekli")
    mk = await db.supplier_payments.find_one({"supplier_key": key, "date": payload.date}, {"_id": 0})
    if not mk or mk.get("status") != "paid":
        raise HTTPException(status_code=400, detail="Önce ödemeyi 'Ödendi' olarak işaretleyin")
    if mk.get("confirm_status") == "confirmed":
        raise HTTPException(status_code=400, detail="Ödeme zaten tedarikçi tarafından onaylanmış")
    code = _generate_sms_code()
    net = _as_float(mk.get("net_snapshot"), 0)
    await db.supplier_payments.update_one(
        {"supplier_key": key, "date": payload.date},
        {"$set": {"confirm_code": enc_str(code), "confirm_code_expires_at": now_utc() + timedelta(days=7),
                  "confirm_status": "pending", "confirm_attempts": 0}},
    )
    phones = await _afro_supplier_phones(key)
    message = (
        "Afro Gida\n"
        f"{_afro_date_tr(payload.date)} tarihli {_afro_tr_money(net)} TL odemeniz yapildi.\n"
        f"Onay kodu: {code}\n"
        "Satislarim panelinden bu kodu girerek odemeyi onaylayin."
    )
    sms_ok = False
    for p in phones:
        try:
            if send_sms_verimor(p["phone"], message):
                sms_ok = True
        except Exception as exc:
            logger.error("[SUPPLIER-PAY] resend SMS hatasi %s: %s", p.get("phone"), exc)
    await db.supplier_payments.update_one(
        {"supplier_key": key, "date": payload.date},
        {"$set": {"confirm_sms_sent": bool(sms_ok), "confirm_sms_at": now_utc()}},
    )
    await _insert_log("log_admin", {"admin_id": current_admin["user_id"], "admin_name": current_admin.get("name",""), "action": "supplier_payment_code_resent", "target_type": "payment", "target_id": f"{key}_{payload.date}", "change_details": {"sms_sent": bool(sms_ok), "phones": len(phones)}, "admin_note": ""}, request)
    return {"success": True, "sms_sent": bool(sms_ok), "phone_count": len(phones)}


@router.get("/supplier/my-payments")
async def supplier_my_payments(current_supplier: dict = Depends(get_current_supplier)):
    """Tedarikçinin kendi günlük ödeme durumu (✅ Ödendi / ⏳ Bekliyor).
    Tezgah fiyatından net tutar gösterilir; kâr/müşteri bilgisi YOKtur."""
    sg = get_user_supplier_group(current_supplier)
    if not sg:
        raise HTTPException(status_code=403, detail="Tedarikçi grubu tanımlı değil")
    key = _afro_norm(sg)
    orders = await db.transactions.find(
        {"order_status": {"$in": list(SUPPLIER_SOLD_STATUSES)}}, {"_id": 0}
    ).sort("created_at", -1).to_list(5000)
    cost_map = await _build_cost_map()
    days = {}
    for o in orders:
        sup_items, sub, ref_items, item_level = _supplier_items_of_order(o, key, cost_map)
        if not sup_items:
            continue
        dk = _afro_ist_day_key(o.get("delivered_at") or o.get("created_at"))
        if not dk:
            continue
        refunded_amount = 0.0
        if item_level:
            refunded_amount = round(ref_items, 2)
        else:
            full, partial, ramt = _order_refund_info(o)
            osub = _as_float(o.get("subtotal"), 0) or _as_float(o.get("amount"), 0)
            if partial and ramt > 0 and osub > 0:
                refunded_amount = round(min(sub, ramt * (sub / osub)), 2)
        d = days.setdefault(dk, {"gross": 0.0, "refund": 0.0})
        d["gross"] += sub
        d["refund"] += refunded_amount
    markers = {}
    async for m in db.supplier_payments.find({"supplier_key": key}, {"_id": 0}):
        markers[m.get("date")] = m
    rows = []
    for dk in sorted(days.keys(), reverse=True):
        gross = round(days[dk]["gross"], 2)
        refund = round(days[dk]["refund"], 2)
        net = round(gross - refund, 2)
        mk = markers.get(dk) or {}
        rows.append({"date": dk, "gross": gross, "refund": refund, "net": net,
                     "status": mk.get("status") or "pending", "paid_at": mk.get("paid_at"),
                     "confirm_status": mk.get("confirm_status") or "pending",
                     "confirmed_at": mk.get("confirmed_at"),
                     "confirm_sms_sent": bool(mk.get("confirm_sms_sent"))})
    total_pending = round(sum(r["net"] for r in rows if r["status"] != "paid"), 2)
    total_paid = round(sum(r["net"] for r in rows if r["status"] == "paid"), 2)
    return {"supplier": sg, "rows": rows,
            "total_pending": total_pending, "total_paid": total_paid}


# ---------- Admin: Tedarikçi listesi ----------
@router.get("/admin/suppliers")
async def admin_get_suppliers(current_admin: dict = Depends(get_current_staff)):
    suppliers = []
    async for s in db.suppliers.find():
        s["id"] = str(s["_id"])
        s.pop("_id", None)
        suppliers.append(s)
    return suppliers

# ---------- Admin: Yeni tedarikçi ekle ----------
@router.post("/admin/suppliers")
async def admin_create_supplier(data: SupplierInput, current_admin: dict = Depends(get_current_admin)):
    from datetime import datetime
    doc = data.dict()
    doc["created_at"] = datetime.utcnow().isoformat()
    result = await db.suppliers.insert_one(doc)
    doc["id"] = str(result.inserted_id)
    doc.pop("_id", None)
    return doc

# ---------- Admin: Tedarikçi güncelle ----------
@router.put("/admin/suppliers/{supplier_id}")
async def admin_update_supplier(supplier_id: str, data: SupplierInput, current_admin: dict = Depends(get_current_admin)):
    from bson import ObjectId
    try:
        oid = ObjectId(supplier_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Geçersiz ID")
    update_data = {k: v for k, v in data.dict().items() if v is not None}
    result = await db.suppliers.update_one({"_id": oid}, {"$set": update_data})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Tedarikçi bulunamadı")
    updated = await db.suppliers.find_one({"_id": oid})
    updated["id"] = str(updated["_id"])
    updated.pop("_id", None)
    return updated

# ---------- Admin: Tedarikçi sil ----------
@router.delete("/admin/suppliers/{supplier_id}")
async def admin_delete_supplier(supplier_id: str, current_admin: dict = Depends(get_current_admin)):
    from bson import ObjectId
    try:
        oid = ObjectId(supplier_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Geçersiz ID")
    result = await db.suppliers.delete_one({"_id": oid})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Tedarikçi bulunamadı")
    return {"message": "Tedarikçi silindi"}

# ---------- Public: Tedarikçi listesi ----------
@router.get("/suppliers")
async def get_suppliers():
    suppliers = []
    async for s in db.suppliers.find({"is_active": True}):
        s["id"] = str(s["_id"])
        s.pop("_id", None)
        suppliers.append(s)
    return suppliers


def _afro_client_ip(request):
    try:
        xff = request.headers.get("x-forwarded-for") or ""
        if xff:
            return xff.split(",")[0].strip()
        return request.client.host if request.client else ""
    except Exception:
        return ""


# ---- Aktif sözleşmeyi getir (tedarikçi + herkes okuyabilir) ----
@router.get("/supplier-contract")
async def afro_get_supplier_contract():
    return await _afro_supplier_contract_cfg()


# ---- Admin: aktif sözleşmeyi ayarla (yeni PDF + sürüm) ----
@router.post("/admin/supplier-contract")
async def afro_set_supplier_contract(payload: AfroSupplierContractInput, current_admin: dict = Depends(get_current_admin)):
    _yonetici_only(current_admin)
    url = (payload.url or "").strip()
    version = (payload.version or "").strip()
    if not url or not version:
        raise HTTPException(status_code=400, detail="url ve version zorunludur")
    sc = {"url": url, "version": version, "title": (payload.title or "Tedarikçi Sözleşmesi").strip(),
          "updated_at": now_utc(), "updated_by": current_admin.get("user_id")}
    await _write_catalog_config({"supplier_contract": sc})
    try:
        await db.admin_logs.insert_one({
            "action": "supplier_contract_updated", "url": url, "version": version,
            "admin_id": current_admin.get("user_id"), "created_at": now_utc(),
        })
    except Exception:
        pass
    return await _afro_supplier_contract_cfg()


# ---- Tedarikçi: kendi onay durumu ----
@router.get("/supplier/contract-status")
async def afro_supplier_contract_status(current_supplier: dict = Depends(get_current_supplier)):
    cfg = await _afro_supplier_contract_cfg()
    cur = cfg.get("version")
    accepted_ver = current_supplier.get("supplier_contract_accepted_version")
    accepted_at = current_supplier.get("supplier_contract_accepted_at")
    return {
        "contract": cfg,
        "current_version": cur,
        "accepted": bool(cur and accepted_ver == cur),
        "accepted_version": accepted_ver,
        "accepted_at": accepted_at.isoformat() if hasattr(accepted_at, "isoformat") else accepted_at,
    }


# ---- Tedarikçi: sözleşmeyi onayla (consent logu düşer) ----
@router.post("/supplier/accept-contract")
async def afro_supplier_accept_contract(request: Request, current_supplier: dict = Depends(get_current_supplier)):
    cfg = await _afro_supplier_contract_cfg()
    cur = cfg.get("version")
    if not cur:
        raise HTTPException(status_code=400, detail="Aktif tedarikçi sözleşmesi tanımlı değil")
    ts = now_utc()
    uid = current_supplier.get("user_id")
    await db.users.update_one(
        {"user_id": uid},
        {"$set": {"supplier_contract_accepted_version": cur, "supplier_contract_accepted_at": ts}},
    )
    log_doc = {
        "user_id": uid,
        "name": current_supplier.get("name"),
        "phone": current_supplier.get("phone"),
        "supplier_group": get_user_supplier_group(current_supplier),
        "consent_type": "tedarikci_sozlesmesi",
        "contract_version": cur,
        "contract_url": cfg.get("url"),
        "accepted_at": ts,
        "ip": _afro_client_ip(request),
        "user_agent": request.headers.get("user-agent", ""),
    }
    try:
        await db.consent_logs.insert_one(dict(log_doc))
    except Exception:
        pass
    await _insert_log("log_consents", {"user_id": uid, "consent_type": "tedarikci_sozlesmesi", "action": "accepted", "document_version": cur, "document_name": "Tedarikçi Sözleşmesi", "document_url": cfg.get("url","")}, request)
    return {"success": True, "version": cur, "accepted_at": ts.isoformat()}


# ---- Admin: onay loglarını listele ----
@router.get("/admin/contract-consents")
async def afro_admin_contract_consents(current_admin: dict = Depends(get_current_admin)):
    _yonetici_only(current_admin)
    logs = await db.consent_logs.find(
        {"consent_type": "tedarikci_sozlesmesi"}, {"_id": 0}
    ).sort("accepted_at", -1).to_list(1000)
    for l in logs:
        aa = l.get("accepted_at")
        if hasattr(aa, "isoformat"):
            l["accepted_at"] = aa.isoformat()
    return logs
