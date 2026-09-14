"""Sipariş hesaplama — SUNUCU tek doğruluk kaynağı.

Müşteriden gelen fiyat/indirim/tutar yalnızca karşılaştırılır; tahsilat sunucunun
hesabıyla yapılır. Manipülasyon -> işlem iptal + güvenlik alarmı.

Route handler'ları server.py'de (ileride routers/orders.py).
"""
import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from fastapi import HTTPException, Request

from core.config import _AFRO_DOC_NAME_TR
from core.crypto import enc_str, dec_str, order_signature
from core.db import db
from core.logs import _mask_phone
from core.money import D, money_d, _num_close, _MILLI
from core.security import security_alarm
from core.util import now_utc, to_aware, new_id, _clean_text
from services.coupon_anomaly import check_daily_coupon_total_anomaly, check_user_coupon_use_burst
from services.noshow import _evaluate_no_show_restriction

logger = logging.getLogger("afro.orders")

# Siparişin çıkış yollarında çözülen / gizlenen alanlar
ORDER_ENC_FIELDS = ("address", "delivery_code")
ORDER_INTERNAL_FIELDS = ("paytr_init", "paytr_callback", "calc_signature", "security_flags")


def _dec_order(o):
    if not isinstance(o, dict):
        return o
    out = dict(o)
    for f in ORDER_ENC_FIELDS:
        if f in out and out[f] is not None:
            out[f] = dec_str(out[f])
    return out


def _dec_orders(rows):
    return [_dec_order(o) for o in (rows or [])]


def _customer_order_view(o):
    """Müşteriye dönen sipariş: şifreler çözülür, iç alanlar gizlenir."""
    out = _dec_order(o)
    for f in ORDER_INTERNAL_FIELDS:
        out.pop(f, None)
    return out


def _normalize_delivery_type(data: dict) -> str:
    raw = str(data.get("delivery_type") or data.get("delivery_method") or "").strip().lower()
    if raw in ("pickup", "gel-al", "gel_al", "gelal", "pay_at_counter"):
        return "gel_al"
    if raw in ("home_delivery", "delivery", "eve_servis", "eveservis", "adres"):
        return "eve_servis"
    return raw or "gel_al"


def _normalize_payment_method(data: dict) -> str:
    raw = str(data.get("payment_method") or "").strip().lower()
    if raw in ("tezgah", "tezgahta", "counter", "pay_at_counter", "nakit/kredi kartı", "nakit/kredi k."):
        return "pay_at_counter"
    if raw in ("kapida", "kapıda", "cash", "cash_on_delivery", "kapida_nakit"):
        return "cash_on_delivery"
    if raw in ("online", "online_card", "kredi_karti", "credit_card", "card"):
        return "online_card"
    return raw or "pay_at_counter"


def _as_float(value, default=0.0) -> float:
    try:
        return float(value if value is not None else default)
    except Exception:
        return float(default)


def _resolve_selected_options(product: Optional[dict], raw: dict) -> tuple:
    """Müşterinin seçtiği özelleştirme seçeneklerini ürün tanımına göre doğrular.
    Fiyat farkını ürünün kendi tanımından alır (client'a güvenmez).
    Döner: (secili_liste, toplam_ek_ucret, not_metni)"""
    sel_in = raw.get("selected_options") or raw.get("options") or []
    note = _clean_text(raw.get("note") or raw.get("customization_note") or "")
    if note:
        note = note[:500]
    resolved = []
    fee = 0.0
    defined = (product or {}).get("customization_options") or []
    if not isinstance(sel_in, list):
        sel_in = []
    for sel in sel_in:
        if not isinstance(sel, dict):
            continue
        g_title = _clean_text(sel.get("title") or sel.get("group") or "")
        c_label = _clean_text(sel.get("label") or sel.get("choice") or "")
        if not c_label:
            continue
        delta = 0.0
        matched_label = c_label
        matched_title = g_title
        for grp in defined:
            if not isinstance(grp, dict):
                continue
            gt = _clean_text(grp.get("title") or "")
            if g_title and gt and gt.lower() != g_title.lower():
                continue
            for ch in (grp.get("choices") or []):
                if not isinstance(ch, dict):
                    continue
                if _clean_text(ch.get("label") or "").lower() == c_label.lower():
                    delta = _as_float(ch.get("price_delta"), 0)
                    matched_label = _clean_text(ch.get("label"))
                    matched_title = gt or g_title
                    break
            else:
                continue
            break
        fee += delta
        resolved.append({"title": matched_title, "label": matched_label, "price_delta": round(delta, 2)})
    return resolved, round(fee, 2), note


async def _find_address_coordinates(user_id: str, order_address_text: str) -> tuple:
    """Kullanıcının kayıtlı adreslerinden sipariş adresiyle eşleşeni bulup koordinatını döndürür.
    Return: (lat, lng) veya (None, None)."""
    import re
    import unicodedata

    def normalize(s):
        if not s:
            return ""
        s = s.lower().strip()
        s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode('ascii')
        return ''.join(c for c in s if c.isalnum())

    mah_match = re.search(r'(\w+)\s*(?:mah|mahalle)', order_address_text, re.IGNORECASE)
    sok_match = re.search(r'(\w+)\s*(?:sk|sokak|cad|cadde)', order_address_text, re.IGNORECASE)
    bno_match = re.search(r'no:?\s*(\w+)', order_address_text, re.IGNORECASE)
    order_mah = normalize(mah_match.group(1)) if mah_match else ""
    order_sok = normalize(sok_match.group(1)) if sok_match else ""
    order_bno = normalize(bno_match.group(1)) if bno_match else ""

    candidates = []
    async for a in db.addresses.find({"user_id": user_id},
                                     {"_id": 0, "lat": 1, "lng": 1, "neighborhood": 1, "street": 1, "building_no": 1}):
        candidates.append(a)
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "addresses": 1})
    if user and user.get("addresses"):
        candidates.extend(user["addresses"])

    for addr in candidates:
        lat, lng = addr.get("lat"), addr.get("lng")
        if lat is None or lng is None:
            continue
        a_mah = normalize(addr.get("neighborhood") or "")
        a_sok = normalize(addr.get("street") or "")
        a_bno = normalize(addr.get("building_no") or "")
        if order_mah and order_sok and order_bno:
            if a_mah == order_mah and a_sok == order_sok and a_bno == order_bno:
                return (lat, lng)
        if order_mah and order_sok:
            if a_mah == order_mah and a_sok == order_sok:
                return (lat, lng)
        if order_mah and a_mah == order_mah:
            if (order_sok and order_sok in a_sok) or (order_bno and order_bno in a_bno):
                return (lat, lng)
    return (None, None)


async def _evaluate_coupon(code: str, user: Optional[dict], subtotal, payment_method: str = "") -> dict:
    """Kuponu TÜM kurallara göre doğrular ve indirimi SUNUCUDA hesaplar.
    Sepet önizlemesi (/coupons/validate) ve gerçek sipariş aynı fonksiyonu kullanır."""
    code = str(code or "").upper().strip()
    total = money_d(subtotal)
    if not code:
        raise HTTPException(status_code=400, detail="Kupon kodu gerekli")
    coupon = await db.coupons.find_one({"code": code}, {"_id": 0})
    if not coupon:
        raise HTTPException(status_code=404, detail="Kupon bulunamadı")
    if not coupon.get("active", True):
        raise HTTPException(status_code=400, detail="Bu kupon pasif durumda")
    if coupon.get("single_use") and coupon.get("used"):
        raise HTTPException(status_code=400, detail="Bu kupon daha önce kullanılmış")
    assigned = coupon.get("assigned_user_ids") or []
    if assigned and (not user or user.get("user_id") not in assigned):
        raise HTTPException(status_code=403, detail="Bu kupon hesabınıza tanımlı değil")
    if user:
        ua = next((a for a in (coupon.get("assignments") or []) if a.get("user_id") == user.get("user_id")), None)
        if ua:
            _lim = int(ua.get("limit") or 1)
            _used = int(ua.get("used_count") or 0)
            if _used >= _lim:
                raise HTTPException(status_code=400, detail="Bu kupon için kullanım hakkınız doldu")
    if coupon.get("members_only", True) and not user:
        raise HTTPException(status_code=401, detail="Kupon kullanmak için giriş yapmalısınız")
    valid_until = coupon.get("valid_until")
    if valid_until:
        try:
            expires = datetime.fromisoformat(str(valid_until).replace("Z", "+00:00"))
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=timezone.utc)
            if expires < now_utc():
                raise HTTPException(status_code=400, detail="Kupon süresi dolmuş")
        except HTTPException:
            raise
        except Exception:
            pass
    min_amount = money_d(coupon.get("min_amount", 0) or 0)
    if total < min_amount:
        raise HTTPException(status_code=400, detail=f"Minimum sipariş tutarı: {min_amount:.0f}₺")
    discount_amount = coupon.get("discount_amount")
    if discount_amount is not None and D(discount_amount) > 0:
        discount = money_d(discount_amount)
        discount_type = "fixed"
    else:
        percent = D(coupon.get("discount_percent", 0) or 0)
        if percent < 0 or percent > 100:
            percent = Decimal("0")
        discount = money_d(total * percent / Decimal("100"))
        discount_type = "percentage"
    if discount < 0:
        discount = Decimal("0")
    if discount > total:
        discount = total
    return {
        "coupon": coupon,
        "discount": discount,          # Decimal
        "discount_type": discount_type,
        "min_amount": min_amount,
        "payment_method": payment_method,
    }


async def _prepare_order_payload(data: dict, current_user: dict, request=None) -> dict:
    """SİPARİŞ HESAPLAMA — TEK DOĞRULUK KAYNAĞI SUNUCUDUR."""
    delivery_type = _normalize_delivery_type(data)
    payment_method = _normalize_payment_method(data)
    items_in = data.get("items") or data.get("cart_items") or []
    if not isinstance(items_in, list) or not items_in:
        raise HTTPException(status_code=400, detail="Sepet boş")
    if len(items_in) > 60:
        raise HTTPException(status_code=400, detail="Sepette çok fazla kalem var")

    tamper = []
    stale = []

    items = []
    subtotal = Decimal("0")
    price_type = "gel_al_price" if delivery_type == "gel_al" else "eve_servis_price"
    for raw in items_in:
        if not isinstance(raw, dict):
            raise HTTPException(status_code=400, detail="Sepet kalemi geçersiz")
        product_id = raw.get("id") or raw.get("product_id")
        if not product_id or not isinstance(product_id, str) or len(product_id) > 80:
            tamper.append({"type": "missing_product_id", "raw_id": str(product_id)[:80]})
            continue
        product = await db.products.find_one({"id": product_id}, {"_id": 0})
        if not product:
            tamper.append({"type": "unknown_product", "product_id": product_id, "client_price": raw.get("price")})
            continue
        if not product.get("active", True) or product.get("hidden", False) or not product.get("in_stock", True):
            raise HTTPException(status_code=400, detail=f"{product.get('name', 'Ürün')} şu anda satışa uygun değil")

        qty = D(raw.get("qty", raw.get("quantity", 1)), "0")
        if qty <= 0 or qty > 200 or qty != qty.quantize(_MILLI, rounding=ROUND_HALF_UP):
            if qty <= 0 or qty > 200:
                tamper.append({"type": "invalid_qty", "product_id": product_id, "qty": str(qty)})
                continue
            qty = qty.quantize(_MILLI, rounding=ROUND_HALF_UP)

        server_price = None
        for cand in (product.get("price"), product.get(price_type)):
            if cand is not None and D(cand) > 0:
                server_price = money_d(cand)
                break
        if server_price is None:
            raise HTTPException(status_code=400, detail=f"{product.get('name', 'Ürün')} için fiyat tanımlı değil")

        client_price = raw.get("price")
        if client_price is not None and not _num_close(client_price, server_price):
            cp = money_d(client_price)
            if cp < server_price:
                upd = product.get("price_updated_at") or product.get("updated_at")
                recent_change = False
                try:
                    recent_change = bool(upd) and (now_utc() - to_aware(upd)) < timedelta(hours=24)
                except Exception:
                    recent_change = False
                entry = {"type": "unit_price_low", "product_id": product_id, "name": product.get("name"),
                         "client_price": str(cp), "server_price": str(server_price)}
                (stale if recent_change else tamper).append(entry)
            else:
                stale.append({"type": "unit_price_high", "product_id": product_id,
                              "client_price": str(cp), "server_price": str(server_price)})

        sel_options, options_fee_unit, cust_note = _resolve_selected_options(product, raw)
        options_fee_unit_d = money_d(options_fee_unit)
        options_fee = money_d(options_fee_unit_d * qty)
        line_total = money_d(server_price * qty + options_fee)
        subtotal += line_total
        items.append({
            "id": product_id,
            "name": product.get("name") or raw.get("name") or "Ürün",
            "qty": float(qty),
            "quantity": float(qty),
            "price": float(server_price),
            "unit": product.get("unit") or raw.get("unit"),
            "selected_options": sel_options,
            "options_fee_unit": float(options_fee_unit_d),
            "options_fee": float(options_fee),
            "customization_note": cust_note,
            "total_price": float(line_total),
            "line_total": float(line_total),
            "unit_price_snapshot": float(server_price),
            "price_type": "price" if product.get("price") is not None and D(product.get("price")) > 0 else price_type,
            "product_name_snapshot": product.get("name") or raw.get("name"),
            "category_snapshot": product.get("category"),
            "supplier_group_snapshot": product.get("supplier_group"),
            "unit_snapshot": product.get("unit") or raw.get("unit"),
            "quality_snapshot": product.get("quality"),
            "supplier_price_snapshot": product.get("supplier_price"),
        })

    if tamper:
        await security_alarm(
            "order_tamper_attempt",
            {"summary": tamper[0].get("type", "manipulasyon"), "signals": tamper[:10], "stage": "items", "delivery_type": delivery_type},
            request, current_user, severity="critical", notify=True,
        )
        raise HTTPException(status_code=400, detail="İşlem güvenlik nedeniyle iptal edildi. Lütfen sepetinizi yenileyip tekrar deneyin. (GV-01)")
    if not items:
        raise HTTPException(status_code=400, detail="Sepet boş")

    subtotal = money_d(subtotal)
    settings = await db.settings.find_one({"id": "global_settings"}, {"_id": 0}) or {}

    delivery_fee = Decimal("0")
    if delivery_type == "eve_servis" and subtotal > 0:
        fee_cfg = money_d(settings.get("delivery_fee") or 0)
        free_min = money_d(settings.get("free_delivery_min_amount") or 0)
        if fee_cfg > 0 and (free_min <= 0 or subtotal < free_min):
            delivery_fee = fee_cfg

    _cc = str(data.get("coupon_code") or "").strip().upper()
    _coupon_doc = None
    discount = Decimal("0")
    if _cc:
        try:
            ev = await _evaluate_coupon(_cc, current_user, subtotal, payment_method)
        except HTTPException as exc:
            natural = exc.status_code == 400
            await security_alarm(
                "coupon_abuse_attempt",
                {"summary": f"kupon {_cc}: {exc.detail}", "coupon_code": _cc, "reason": exc.detail, "client_discount": data.get("discount")},
                request, current_user, severity="medium" if natural else "critical", notify=not natural,
            )
            raise HTTPException(status_code=exc.status_code, detail=f"Kupon uygulanamadı: {exc.detail}")
        _coupon_doc = ev["coupon"]
        discount = ev["discount"]
    if discount > subtotal:
        discount = subtotal

    c_discount = data.get("discount", data.get("discount_amount"))
    c_fee = data.get("delivery_fee")
    c_subtotal = data.get("subtotal")
    c_amount = data.get("amount", data.get("total"))
    if c_discount is not None and not _num_close(c_discount, discount):
        if money_d(c_discount) > discount:
            if not _cc:
                tamper.append({"type": "discount_without_coupon", "client_discount": str(money_d(c_discount))})
            else:
                max_possible = discount
                if _coupon_doc is not None:
                    if D(_coupon_doc.get("discount_amount") or 0) > 0:
                        max_possible = money_d(_coupon_doc.get("discount_amount"))
                    else:
                        base = max(subtotal, money_d(c_subtotal or 0))
                        max_possible = money_d(base * D(_coupon_doc.get("discount_percent") or 0) / Decimal("100"))
                if money_d(c_discount) > max_possible + Decimal("0.011"):
                    tamper.append({"type": "discount_inflated", "client_discount": str(money_d(c_discount)),
                                   "server_discount": str(discount), "max_possible": str(max_possible)})
                else:
                    stale.append({"type": "discount_high_stale", "client_discount": str(money_d(c_discount)),
                                  "server_discount": str(discount)})
        else:
            stale.append({"type": "discount_low", "client_discount": str(money_d(c_discount)), "server_discount": str(discount)})
    if c_fee is not None and not _num_close(c_fee, delivery_fee):
        cf = money_d(c_fee)
        if cf < delivery_fee:
            free_min = money_d(settings.get("free_delivery_min_amount") or 0)
            cs = money_d(c_subtotal) if c_subtotal is not None else subtotal
            if free_min > 0 and cs >= free_min:
                stale.append({"type": "fee_low_stale", "client_fee": str(cf), "server_fee": str(delivery_fee), "client_subtotal": str(cs)})
            else:
                tamper.append({"type": "delivery_fee_low", "client_fee": str(cf), "server_fee": str(delivery_fee), "client_subtotal": str(cs)})
        else:
            stale.append({"type": "fee_high", "client_fee": str(cf), "server_fee": str(delivery_fee)})
    if c_subtotal is not None and not _num_close(c_subtotal, subtotal):
        stale.append({"type": "subtotal_diff", "client": str(money_d(c_subtotal)), "server": str(subtotal)})
    amount = money_d(subtotal + delivery_fee - discount)
    if amount < 0:
        amount = Decimal("0")
    if c_amount is not None and not _num_close(c_amount, amount):
        ca = money_d(c_amount)
        try:
            own = money_d(c_subtotal if c_subtotal is not None else subtotal) + money_d(c_fee if c_fee is not None else delivery_fee) - money_d(c_discount if c_discount is not None else discount)
            if own < 0:
                own = Decimal("0")
            if payment_method == "online_card" and own < 1:
                own = Decimal("1")
        except Exception:
            own = amount
        if ca < own - Decimal("0.011"):
            tamper.append({"type": "amount_inconsistent", "client_amount": str(ca), "client_formula": str(own), "server_amount": str(amount)})
        else:
            stale.append({"type": "amount_diff", "client_amount": str(ca), "server_amount": str(amount)})

    if tamper:
        await security_alarm(
            "order_tamper_attempt",
            {"summary": tamper[0].get("type", "manipulasyon"), "signals": tamper[:10], "stale": stale[:10], "stage": "totals",
             "server": {"subtotal": str(subtotal), "delivery_fee": str(delivery_fee), "discount": str(discount), "amount": str(amount)}},
            request, current_user, severity="critical", notify=True,
        )
        raise HTTPException(status_code=400, detail="İşlem güvenlik nedeniyle iptal edildi. Lütfen sepetinizi yenileyip tekrar deneyin. (GV-02)")
    if stale:
        await security_alarm(
            "order_price_mismatch",
            {"summary": stale[0].get("type", "uyumsuzluk"), "signals": stale[:10],
             "server": {"subtotal": str(subtotal), "delivery_fee": str(delivery_fee), "discount": str(discount), "amount": str(amount)}},
            request, current_user, severity="low", notify=False,
        )

    if amount <= 0:
        raise HTTPException(status_code=400, detail="Ödenecek tutar hesaplanamadı. Lütfen sepetinizi kontrol edin.")
    if payment_method == "online_card" and amount < 1:
        raise HTTPException(status_code=400, detail="Online ödeme için tutar en az 1₺ olmalıdır")

    min_amount = money_d(settings.get("min_pickup_amount" if delivery_type == "gel_al" else "min_delivery_amount") or 0)
    if subtotal < min_amount:
        raise HTTPException(status_code=400, detail=f"Minimum sipariş tutarı: {min_amount:.0f}₺")

    if delivery_type == "eve_servis" and not _clean_text(data.get("address")):
        raise HTTPException(status_code=400, detail="Eve servis siparişi için teslimat adresi zorunludur")

    if payment_method in ("cash_on_delivery", "pay_at_counter"):
        fresh_user = await db.users.find_one({"user_id": current_user.get("user_id")}, {"_id": 0}) or current_user
        no_show = _evaluate_no_show_restriction(fresh_user)
        if no_show["online_only"]:
            raise HTTPException(
                status_code=403,
                detail=no_show["message"] or "Hesabınız yalnızca online ödeme kullanabilir. Lütfen online ödeme seçin.",
            )

    if payment_method in ("cash_on_delivery", "pay_at_counter") and settings.get("cash_payment_limit_enabled"):
        max_cash = money_d(settings.get("cash_payment_max_amount") or 0)
        if max_cash > 0 and amount > max_cash:
            raise HTTPException(status_code=400, detail=f"Bu tutar için yalnızca online ödeme kabul edilir. Nakit/tezgah ödeme limiti: {max_cash:.0f}₺")

    final_address = _clean_text(data.get("address") or "")[:600] or ("Tezgah" if delivery_type == "gel_al" else "")
    if delivery_type == "eve_servis" and final_address and "Konum:" not in final_address:
        lat, lng = await _find_address_coordinates(current_user.get("user_id"), final_address)
        if lat is not None and lng is not None:
            final_address += f"\nKonum: https://www.google.com/maps?q={lat},{lng}"

    tx_id = new_id("tx")
    order = {
        "tx_id": tx_id,
        "user_id": current_user.get("user_id"),
        "user_name": current_user.get("name"),
        "user_phone": _mask_phone(current_user.get("phone")),
        "amount": float(amount),
        "subtotal": float(subtotal),
        "delivery_fee": float(delivery_fee),
        "discount": float(discount),
        "status": "pending",
        "order_status": "talep_alindi",
        "payment_status": "pending" if payment_method == "online_card" else "unpaid",
        "payment_method": payment_method,
        "delivery_method": "pickup" if delivery_type == "gel_al" else "home_delivery",
        "delivery_type": delivery_type,
        "items": items,
        "coupon_code": _cc or None,
        "coupon_id": (_coupon_doc or {}).get("id"),
        "coupon_consumed": False,
        "address": enc_str(final_address) if final_address else final_address,
        "delivery_neighborhood": _clean_text(data.get("delivery_neighborhood") or "")[:120],
        "market_id": data.get("market_id") or data.get("stall_id"),
        "stall_id": data.get("stall_id") or data.get("market_id"),
        "market_name": _clean_text(data.get("market_name")) or "",
        "pickup_time": data.get("pickup_time") or None,
        "delivery_slot_start": data.get("delivery_slot_start") or None,
        "delivery_slot_end": data.get("delivery_slot_end") or None,
        "document_acceptances": data.get("document_acceptances") or [],
        "agreements_accepted": bool(data.get("agreements_accepted") or data.get("legal_accepted")),
        "agreements_versions": data.get("agreements_versions") or {},
        "pricing_version": 2,
        "server_calculated": True,
        "client_claimed": {
            "subtotal": c_subtotal, "delivery_fee": c_fee, "discount": c_discount, "amount": c_amount,
        },
        "created_at": now_utc(),
        "updated_at": now_utc(),
    }
    order["calc_signature"] = order_signature(order)
    return order


async def _consume_coupon_for_order(order: dict, request=None):
    """Sipariş TAMAMLANDIĞINDA kuponun per-user kullanım sayacını artırır; tek
    kullanımlıksa 'used' işaretler. Idempotent (transaction.coupon_consumed)."""
    try:
        code = (order.get("coupon_code") or "").strip()
        if not code or order.get("coupon_consumed"):
            return
        uid = order.get("user_id")
        coupon = await db.coupons.find_one({"code": code}, {"_id": 0})
        if not coupon:
            return
        assignments = coupon.get("assignments") or []
        setu = {}
        if uid and assignments:
            ua = next((a for a in assignments if a.get("user_id") == uid), None)
            if ua:
                ua["used_count"] = int(ua.get("used_count") or 0) + 1
                ua["last_used_at"] = now_utc()
                setu["assignments"] = assignments
        if coupon.get("single_use"):
            setu["used"] = True
            setu["used_at"] = now_utc()
        if setu:
            await db.coupons.update_one({"id": coupon["id"]}, {"$set": setu})
        await db.transactions.update_one({"tx_id": order.get("tx_id")}, {"$set": {"coupon_consumed": True}})
        # Kupon anomali kontrolleri (yalnız bildirim; sipariş asla engellenmez)
        await check_user_coupon_use_burst({"user_id": uid, "name": order.get("user_name")}, request)
        await check_daily_coupon_total_anomaly(request)
    except Exception as _e:
        logger.warning("Kupon kullanım sayacı güncellenemedi: %s", _e)


async def _log_order_agreement(order: dict, data: dict, current_user: dict, request: Request = None):
    """Sipariş anında kabul edilen sözleşmeyi (mesafeli satış / ön bilgilendirme /
    Gel-Al / Eve Servis koşulları) legal_agreement_logs'a yazar; böylece 'Sözleşme
    Onayları' sekmesinde SİPARİŞ NUMARASIYLA görünür. Frontend her siparişte
    agreements_accepted + agreements_versions + legal_document_type gönderir; eskiden
    bu kabul transaction'a yazılıyor ama onay loguna HİÇ düşmüyordu (sipariş
    sözleşmeleri eksik görünüyordu)."""
    try:
        accepted = bool(data.get("agreements_accepted") or data.get("legal_accepted"))
        if not accepted:
            return
        versions = data.get("agreements_versions") or {}
        if not isinstance(versions, dict):
            versions = {}
        doc_type = data.get("legal_document_type") or order.get("delivery_type") or ""
        # Belge kodu: agreements_versions anahtarı > legal_document_type
        doc_code = (next(iter(versions.keys()), None) if versions else None) or doc_type or "mesafeli_satis"
        doc_version = str(next(iter(versions.values()), "") or "") if versions else ""
        doc_name = _AFRO_DOC_NAME_TR.get(doc_code) or _AFRO_DOC_NAME_TR.get(doc_type) or "Mesafeli Satış Sözleşmesi"
        ts = now_utc().isoformat()
        ip = "unknown"; ua = "unknown"
        if request is not None:
            ip = request.headers.get("x-forwarded-for", request.headers.get("x-real-ip", "unknown"))
            ua = request.headers.get("user-agent", "unknown")
        await db.legal_agreement_logs.insert_one({
            "user_id": current_user.get("user_id"),
            "accepted": True,
            "gate_type": "order",
            "document_code": doc_code,
            "document_name": doc_name,
            "document_version": doc_version,
            "document_type": doc_code,
            "document_hash": data.get("agreement_hash", ""),
            "versions": versions if versions else {doc_code: doc_version},
            "timestamp": ts,
            "accepted_at": ts,
            "ip": ip,
            "user_agent": ua,
            "user_name": current_user.get("name", ""),
            "user_phone": current_user.get("phone", ""),
            "order_id": order.get("tx_id"),
        })
    except Exception as _e:
        logging.warning(f"Sipariş sözleşme logu yazılamadı: {_e}")


def _compat_json_clean(value):
    from datetime import datetime, date
    if isinstance(value, list):
        return [_compat_json_clean(v) for v in value]
    if isinstance(value, dict):
        return {k: _compat_json_clean(v) for k, v in value.items() if k != "_id"}
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if value.__class__.__name__ == "ObjectId":
        return str(value)
    return value
