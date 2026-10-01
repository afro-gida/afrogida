"""Kademeli kâr: satış fiyatı = alış (tedarikçi) fiyatı + sabit kâr.

Kullanıcı kararı (2026-09-29): kâr alış fiyatına göre OTOMATİK eklenir; satış
fiyatı elle girilmez. 2026-10-01: kâr tabloları yönetimden düzenlenen
PROFİLLER oldu (Düşük / Orta / Yüksek kazanç); biri AKTİFTİR. Profiller
pricing_profiles koleksiyonunda {"id": "pricing"} belgesinde durur (herkese açık /settings'ten ayrı) (routers/pricing.py);
belge yoksa aşağıdaki varsayılanlar geçerlidir.

Tablo biçimi: [{"from": alt sınır TL, "profit": kâr TL}, …] artan sırada, ilki
0'dan başlar. Alış fiyatı, alt sınırı kendisinden küçük/eşit en büyük satırın
kârını alır; son satırın üst sınırı yoktur.
"""
import time
from typing import List, Optional

# Orta = 2026-10-01'de kullanıcının verdiği tablo. Düşük / Yüksek başlangıç
# önerisidir (yönetim değiştirir).
_BOUNDS = [0, 20, 40, 60, 90, 130, 180, 250, 350]
DEFAULT_PROFILES = {
    "dusuk": {"name": "Düşük kazanç", "tiers": [{"from": f, "profit": p} for f, p in zip(_BOUNDS, [10, 20, 25, 35, 50, 65, 90, 120, 160])]},
    "orta": {"name": "Orta kazanç", "tiers": [{"from": f, "profit": p} for f, p in zip(_BOUNDS, [15, 25, 35, 50, 70, 90, 110, 150, 200])]},
    "yuksek": {"name": "Yüksek kazanç", "tiers": [{"from": f, "profit": p} for f, p in zip(_BOUNDS, [20, 30, 45, 65, 90, 115, 140, 190, 250])]},
}
PROFILE_IDS = list(DEFAULT_PROFILES)
DEFAULT_ACTIVE = "orta"

# Aktif tablo önbelleği (birden çok sunucu işçisi kısa sürede tutarlı olsun)
_CACHE_TTL = 10.0
_active_tiers: List[dict] = DEFAULT_PROFILES[DEFAULT_ACTIVE]["tiers"]
_active_loaded_at = 0.0


def clean_tiers(tiers) -> List[dict]:
    """Yönetimden gelen tabloyu doğrular; hatalıysa ValueError (mesaj kullanıcıya)."""
    if not isinstance(tiers, list) or not 1 <= len(tiers) <= 25:
        raise ValueError("Tabloda 1-25 satır olmalı")
    out = []
    for t in tiers:
        try:
            f = round(float((t or {}).get("from")), 2)
            p = round(float((t or {}).get("profit")), 2)
        except (TypeError, ValueError):
            raise ValueError("Aralık ve kâr rakam olmalı")
        if f < 0 or p < 0:
            raise ValueError("Aralık ve kâr negatif olamaz")
        out.append({"from": f, "profit": p})
    out.sort(key=lambda t: t["from"])
    if out[0]["from"] != 0:
        raise ValueError("İlk aralık 0 ₺'den başlamalı")
    if len({t["from"] for t in out}) != len(out):
        raise ValueError("Aynı başlangıçlı iki aralık olamaz")
    return out


async def refresh_active_tiers(force: bool = False) -> List[dict]:
    """Aktif profilin tablosunu veritabanından (kısa önbellekle) yükler."""
    global _active_tiers, _active_loaded_at
    if not force and time.monotonic() - _active_loaded_at < _CACHE_TTL:
        return _active_tiers
    from core.db import db  # döngüsel içe aktarmayı önle
    doc = await db.pricing_profiles.find_one({"id": "pricing"}, {"_id": 0}) or {}
    profiles = doc.get("profiles") or {}
    active = doc.get("active") or DEFAULT_ACTIVE
    tiers = (profiles.get(active) or DEFAULT_PROFILES.get(active) or DEFAULT_PROFILES[DEFAULT_ACTIVE])["tiers"]
    try:
        _active_tiers = clean_tiers(tiers)
    except ValueError:
        _active_tiers = DEFAULT_PROFILES[DEFAULT_ACTIVE]["tiers"]
    _active_loaded_at = time.monotonic()
    return _active_tiers


def profit_for(supplier_price, tiers: Optional[List[dict]] = None) -> Optional[float]:
    """Alış fiyatına karşılık gelen kâr; alış yoksa/0 ise None."""
    try:
        p = round(float(supplier_price or 0), 2)
    except (TypeError, ValueError):
        return None
    if p <= 0:
        return None
    profit = None
    for t in tiers or _active_tiers:
        if p >= t["from"]:
            profit = t["profit"]
    return profit


class NoProfitTier(ValueError):
    pass


# Alış fiyatı 5 TL'nin katı olmalı (5, 10, 15 ...): tedarikçiler 19 / 29 / 39
# gibi kademe sınırının hemen altındaki fiyatlarla kâr tablosunu zorlamasın.
PRICE_STEP = 5


def validate_price_step(supplier_price) -> None:
    """Geçersizse ValueError (mesaj kullanıcıya gösterilir)."""
    try:
        p = round(float(supplier_price or 0), 2)
    except (TypeError, ValueError):
        raise ValueError("Alış fiyatını rakamla girin.")
    if p > 0 and round(p * 100) % (PRICE_STEP * 100) != 0:
        raise ValueError(f"Alış fiyatı {PRICE_STEP} TL'nin katı olmalı (5, 10, 15, 20 ...). Girilen: {p:g} TL")


def auto_price_fields(supplier_price, tiers: Optional[List[dict]] = None) -> dict:
    """Alış fiyatından tüm müşteri fiyatı alanlarını üretir (aktif profil ya da
    verilen tablo). Alış fiyatı yoksa / 0 ise NoProfitTier fırlatır."""
    profit = profit_for(supplier_price, tiers)
    if profit is None:
        raise NoProfitTier(
            f"{float(supplier_price or 0):.2f} TL alış fiyatı için kâr hesaplanamadı. Alış fiyatını girin."
        )
    supp = round(float(supplier_price), 2)
    sale = round(supp + profit, 2)
    return {
        "supplier_price": supp,
        "profit_margin_amount": profit,
        "sale_price": sale,
        "price": sale,
        "gel_al_price": sale,
        "eve_servis_price": sale,
    }
