"""Katalog ayarları (kategoriler/kampanya vitrini gibi genel ayarlar) okuma/yazma."""
from fastapi import APIRouter, Depends

from core.security import get_current_admin, get_current_staff
from services.catalog import _read_catalog_config, _write_catalog_config

router = APIRouter(prefix="/api")


@router.get("/catalog-config")
async def get_catalog_config():
    return await _read_catalog_config()


@router.get("/admin/catalog-config")
async def admin_get_catalog_config(current_admin: dict = Depends(get_current_staff)):
    return await _read_catalog_config()


@router.put("/catalog-config")
async def update_catalog_config(data: dict, current_admin: dict = Depends(get_current_admin)):
    return await _write_catalog_config(data)


@router.put("/admin/catalog-config")
async def admin_update_catalog_config(data: dict, current_admin: dict = Depends(get_current_admin)):
    return await _write_catalog_config(data)
