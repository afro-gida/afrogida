"""catalog_config okuma/yazma + 60 sn bellek içi önbellek.

Route handler'ları server.py'de (ileride routers/). `supplier_markets`
(pazar-bazlı ürün filtresi) ve `supplier_contract` bu config'te tutulur.
"""
from datetime import datetime, timezone

from core.config import CATALOG_CACHE_TTL
from core.db import db

DEFAULT_CATALOG_CONFIG = {
    "categories": ["Sebze", "Meyve", "Yeşillik", "Kök Sebzeler", "Zeytin Ürünleri"],
    "subcategories": {
        "Sebze": ["Domates", "Biber", "Salatalık", "Kabak", "Patlıcan", "Diğer"],
        "Meyve": ["Elma-Armut", "Muz", "Narenciye", "Üzüm", "Mevsim Meyveleri"],
        "Yeşillik": ["Marul", "Maydanoz", "Roka", "Dereotu-Nane", "Diğer"],
        "Kök Sebzeler": ["Patates", "Soğan", "Havuç", "Turp", "Diğer"],
        "Zeytin Ürünleri": ["Zeytin", "Zeytinyağı", "Ezme", "Diğer"],
    },
    "suppliers": ["Zeytinci"],
    "supplier_markets": {},
}

_CACHE = None
_CACHE_TS = 0


async def _read_catalog_config():
    global _CACHE, _CACHE_TS
    now = datetime.now(timezone.utc).timestamp()
    if _CACHE and (now - _CACHE_TS) < CATALOG_CACHE_TTL:
        return _CACHE
    config = await db.catalog_config.find_one({}, {"_id": 0})
    _CACHE = config if config else DEFAULT_CATALOG_CONFIG
    _CACHE_TS = now
    return _CACHE


async def _write_catalog_config(data: dict):
    global _CACHE, _CACHE_TS
    await db.catalog_config.update_one({}, {"$set": data}, upsert=True)
    _CACHE = None
    _CACHE_TS = 0
    return await _read_catalog_config()
