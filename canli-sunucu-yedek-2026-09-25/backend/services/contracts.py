"""Tedarikçi sözleşmesi (contract gate) — aktif sürüm + zorunluluk kontrolü.

Onaylamayan tedarikçi ürün ekleyip düzenleyemez (backend kilidi). Sözleşme
metni/sürümü catalog_config.supplier_contract altında tutulur.
"""
from fastapi import HTTPException

from services.catalog import _read_catalog_config

# Varsayılan (henüz admin yüklemediyse) — sisteme konan test PDF'i
_AFRO_DEFAULT_SUPPLIER_CONTRACT = {
    "url": "/legal/afrogida_05_tedarikci_sozlesmesi_test.pdf",
    "version": "test-v1",
    "title": "Tedarikçi Sözleşmesi",
}


async def _afro_supplier_contract_cfg():
    """Aktif tedarikçi sözleşmesi ayarı (url, version, title)."""
    try:
        cfg = await _read_catalog_config()
    except Exception:
        cfg = None
    sc = (cfg or {}).get("supplier_contract")
    if not sc or not sc.get("url") or not sc.get("version"):
        return dict(_AFRO_DEFAULT_SUPPLIER_CONTRACT)
    return {
        "url": sc.get("url"),
        "version": sc.get("version"),
        "title": sc.get("title") or "Tedarikçi Sözleşmesi",
    }


async def _afro_require_supplier_contract(user):
    """Tedarikçi aktif sözleşme sürümünü onaylamadıysa 403 fırlatır."""
    cfg = await _afro_supplier_contract_cfg()
    cur = (cfg or {}).get("version")
    if not cur:
        return
    if (user or {}).get("supplier_contract_accepted_version") != cur:
        raise HTTPException(
            status_code=403,
            detail="Tedarikçi sözleşmesini onaylamadan işlem yapamazsınız. Lütfen panelde sözleşmeyi kabul edin.",
        )
