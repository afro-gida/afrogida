"""Kademeli kâr tablosu: satış fiyatı = alış (tedarikçi) fiyatı + sabit kâr.

Kullanıcı kararı (2026-09-29): kâr alış fiyatına göre OTOMATİK eklenir;
satış fiyatı elle girilmez. Tabloda karşılığı olmayan fiyat (500 TL üstü)
otomatik fiyatlanmaz — kayıt reddedilir, yönetici tabloya kademe ekler
(bkz. docs/YENI-MIMARI-KARARLAR.md "Satış fiyatı hesaplama").
"""
from typing import Optional

# (üst sınır — bu değerin ALTINDAKİ alış fiyatları, kâr TL). Son kademe 500,00 dahil.
PROFIT_TIERS = [
    (20.0, 15.0),    #   0,00 –  19,99
    (40.0, 25.0),    #  20,00 –  39,99
    (60.0, 30.0),    #  40,00 –  59,99
    (90.0, 40.0),    #  60,00 –  89,99
    (130.0, 60.0),   #  90,00 – 129,99
    (180.0, 80.0),   # 130,00 – 179,99
    (250.0, 110.0),  # 180,00 – 249,99
    (350.0, 150.0),  # 250,00 – 349,99
]
LAST_TIER_MAX = 500.0     # 350,00 – 500,00
LAST_TIER_PROFIT = 200.0


def profit_for(supplier_price) -> Optional[float]:
    """Alış fiyatına karşılık gelen kâr; alış yoksa/0 veya tablo dışıysa None."""
    try:
        p = round(float(supplier_price or 0), 2)
    except (TypeError, ValueError):
        return None
    if p <= 0:
        return None
    for upper, profit in PROFIT_TIERS:
        if p < upper:
            return profit
    if p <= LAST_TIER_MAX:
        return LAST_TIER_PROFIT
    return None


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


def auto_price_fields(supplier_price) -> dict:
    """Alış fiyatından tüm müşteri fiyatı alanlarını üretir. Kademe yoksa
    NoProfitTier fırlatır (500 TL üstü)."""
    profit = profit_for(supplier_price)
    if profit is None:
        raise NoProfitTier(
            f"{float(supplier_price or 0):.2f} TL alış fiyatı için kâr kademesi yok "
            f"(tablo 0–{LAST_TIER_MAX:.0f} TL). Yönetici tabloya kademe eklemeli."
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
