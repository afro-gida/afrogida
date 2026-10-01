"""Kademeli kâr tablosu: satış fiyatı = alış (tedarikçi) fiyatı + sabit kâr.

Kullanıcı kararı (2026-09-29): kâr alış fiyatına göre OTOMATİK eklenir;
satış fiyatı elle girilmez. 350 TL ve üstü her alış fiyatına +200 (üst sınır
yok, 2026-10-01). Bkz. docs/YENI-MIMARI-KARARLAR.md "Satış fiyatı hesaplama".
"""
from typing import Optional

# (üst sınır — bu değerin ALTINDAKİ alış fiyatları, kâr TL). Son kademe 350 ve üstü.
PROFIT_TIERS = [
    (20.0, 15.0),    #   0,00 –  19,99
    (40.0, 25.0),    #  20,00 –  39,99
    (60.0, 35.0),    #  40,00 –  59,99   (2026-10-01: 30 -> 35)
    (90.0, 50.0),    #  60,00 –  89,99   (40 -> 50)
    (130.0, 70.0),   #  90,00 – 129,99   (60 -> 70)
    (180.0, 90.0),   # 130,00 – 179,99   (80 -> 90)
    (250.0, 110.0),  # 180,00 – 249,99
    (350.0, 150.0),  # 250,00 – 349,99
]
# 350,00 ve üstü: +200 (2026-10-01: üst sınır kaldırıldı, eskiden 500 TL üstü reddediliyordu)
LAST_TIER_MAX = float("inf")
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
    """Alış fiyatından tüm müşteri fiyatı alanlarını üretir. Alış fiyatı
    yoksa / 0 ise NoProfitTier fırlatır."""
    profit = profit_for(supplier_price)
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
