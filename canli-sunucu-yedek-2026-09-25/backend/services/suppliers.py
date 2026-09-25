"""Tedarikçi satış / hakediş hesaplaması.

Tutarlar tedarikçinin KENDİ girdiği alış (tedarik) birim fiyatı üzerinden
hesaplanır — müşteri satış fiyatı değil. Fiyat sipariş anında DONAR (snapshot);
katalog sonradan değişse bile geçmiş siparişler yeniden hesaplanmaz.
"""
from core.db import db
from core.util import _afro_norm
from services.orders import _as_float

# Satış "tamamlandı" (para toplandı) sayılan sipariş durumu
SUPPLIER_SOLD_STATUSES = {"teslim_edildi"}


def _order_refund_info(order: dict):
    """Siparişin iade durumu: (tam_iade, kismi_iade, iade_tutari)."""
    rs = str(order.get("refund_status") or "").strip().lower()
    ps = str(order.get("payment_status") or "").strip().lower()
    ramt = _as_float(order.get("refund_amount"), 0)
    full = (rs == "iade_edildi") or (ps == "iade_edildi")
    partial = (rs == "kismi_iade_edildi") or (ps == "kismi_iade_edildi")
    return full, partial, ramt


def _order_item_refunds(order: dict):
    """Siparişin her kalemi için iade edilip edilmediği.
    Dönüş: (refunded_flags: list[bool], item_level: bool)."""
    items = order.get("items") or []
    n = len(items)
    if any(("refunded" in (it or {})) for it in items):
        return [bool((it or {}).get("refunded")) for it in items], True
    ri = order.get("refunded_items")
    if isinstance(ri, list):
        s = set()
        for x in ri:
            try:
                s.add(int(x))
            except Exception:
                pass
        return [(i in s) for i in range(n)], True
    full, partial, ramt = _order_refund_info(order)
    if full:
        return [True] * n, True
    return [False] * n, False


async def _build_cost_map():
    """product id -> supplier_price (tedarikçinin girdiği alış birim fiyatı)."""
    prods = await db.products.find({}, {"_id": 0, "id": 1, "supplier_price": 1}).to_list(5000)
    m = {}
    for p in prods:
        pid = p.get("id")
        if pid is None:
            continue
        m[pid] = _as_float(p.get("supplier_price"), 0)
    return m


def _item_unit_cost(it: dict, cost_map: dict) -> float:
    """Kalemin birim maliyeti. Öncelik:
      1) supplier_price_snapshot (sipariş anı, DONMUŞ)
      2) unit_price_snapshot     (sipariş anı satış fiyatı, DONMUŞ fallback)
      3) price                   (kalemin siparişteki birim fiyatı, DONMUŞ fallback)
      4) cost_map[product_id]    (SADECE hiç snapshot'ı olmayan eski siparişlerde)
      5) 0.0
    """
    snap = it.get("supplier_price_snapshot")
    if snap is not None:
        c = _as_float(snap, 0)
        if c > 0:
            return c
    has_order_snapshot = (
        it.get("supplier_price_snapshot") is not None
        or it.get("unit_price_snapshot") is not None
        or it.get("price") is not None
    )
    ups = _as_float(it.get("unit_price_snapshot"), 0)
    if ups > 0:
        return ups
    pr = _as_float(it.get("price"), 0)
    if pr > 0:
        return pr
    if not has_order_snapshot:
        pid = it.get("id") or it.get("product_id")
        if pid is not None and pid in cost_map:
            cp = _as_float(cost_map.get(pid), 0)
            if cp > 0:
                return cp
    return 0.0


def _supplier_items_of_order(order: dict, target_norm: str, cost_map: dict):
    """Siparişin hedef tedarikçiye ait kalemleri, alt-toplamı ve iade bilgisi.
    Dönüş: (sup_items, sup_subtotal, sup_refunded_from_items, item_level)."""
    refunded_flags, item_level = _order_item_refunds(order)
    items = order.get("items") or []
    sup_items = []
    sup_subtotal = 0.0
    sup_refunded_items = 0.0
    for idx, it in enumerate(items):
        sg = _afro_norm(it.get("supplier_group_snapshot") or "")
        if sg != target_norm:
            continue
        qty = _as_float(it.get("qty", it.get("quantity", 0)), 0)
        unit_cost = _item_unit_cost(it, cost_map)
        lt = round(unit_cost * qty, 2)
        is_ref = bool(refunded_flags[idx]) if idx < len(refunded_flags) else False
        sup_items.append({
            "name": it.get("name") or it.get("product_name_snapshot") or "Ürün",
            "qty": qty,
            "unit": it.get("unit") or it.get("unit_snapshot") or "",
            "price": unit_cost,
            "line_total": lt,
            "category": it.get("category_snapshot") or "",
            "refunded": is_ref,
        })
        sup_subtotal += lt
        if is_ref:
            sup_refunded_items += lt
    return sup_items, round(sup_subtotal, 2), round(sup_refunded_items, 2), item_level
