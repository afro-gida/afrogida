import asyncio
import logging
import os

from fastapi import FastAPI, APIRouter
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware

from core.config import ROOT_DIR, PRODUCT_SEED_VERSION
from core.crypto import _AFRO_FERNET, hash_token
from core.db import client, db  # .env core.config import'unda yüklendi
from core.security import _admin_watchdog_loop
from models import Product, Campaign, Coupon, Market

app = FastAPI()
app.mount("/uploads", StaticFiles(directory=str(ROOT_DIR / "uploads")), name="uploads")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# server.py: uygulama girişi (FastAPI app + middleware + startup/shutdown
# seed). Tüm iş mantığı core/ + models.py + services/ + routers/ altında;
# hangi parça nerede sorusu için CHANGES.md / router dosyalarının
# docstring'lerine bak.


@api_router.get("/")
async def root():
    return {"message": "Pazar Uygulaması API"}


# /admin/members* (list/count/get/logs/put/delete/no-show clear+exception)
# -> routers/admin_members.py


# admin/staff, admin/supplier-groups, esnaf/kurye atama, admin/couriers,
# admin/courier-markets, admin/courier/{id}/stats+settings -> routers/admin_staff.py


# admin/upload (resim yükleme + WebP optimizasyonu) -> routers/uploads.py


from routers.push import router as _push_router
from routers.auth import router as _auth_router
from routers.products import router as _products_router
from routers.coupons import router as _coupons_router
from routers.markets import router as _markets_router
from routers.orders import router as _orders_router
from routers.payments import router as _payments_router
from routers.courier import router as _courier_router
from routers.suppliers import router as _suppliers_router
from routers.logs import router as _logs_router
from routers.catalog import router as _catalog_router
from routers.complaints import router as _complaints_router
from routers.admin_orders import router as _admin_orders_router
from routers.settings import router as _settings_router
from routers.legal import router as _legal_router
from routers.admin_members import router as _admin_members_router
from routers.admin_staff import router as _admin_staff_router
from routers.uploads import router as _uploads_router
from routers.pazar_sorumlusu import router as _pazar_sorumlusu_router
app.include_router(api_router)
app.include_router(_push_router)
app.include_router(_auth_router)
app.include_router(_products_router)
app.include_router(_coupons_router)
app.include_router(_markets_router)
app.include_router(_orders_router)
app.include_router(_payments_router)
app.include_router(_courier_router)
app.include_router(_suppliers_router)
app.include_router(_logs_router)
app.include_router(_catalog_router)
app.include_router(_complaints_router)
app.include_router(_admin_orders_router)
app.include_router(_settings_router)
app.include_router(_legal_router)
app.include_router(_admin_members_router)
app.include_router(_admin_staff_router)
app.include_router(_uploads_router)
app.include_router(_pazar_sorumlusu_router)




_AFRO_ORIGINS = [o.strip() for o in (os.environ.get("AFRO_ALLOWED_ORIGINS") or
                 "https://afrogida.com.tr,https://www.afrogida.com.tr,http://localhost:3000,http://localhost:8081,http://localhost:19006,capacitor://localhost,http://localhost").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=_AFRO_ORIGINS,
    allow_origin_regex=r"^https://([a-z0-9-]+\.)?afrogida\.com\.tr$",
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------- Startup: indexes + seed ----------------
@app.on_event("startup")
async def startup():
    await db.users.create_index("user_id", unique=True)

    async def _safe_index(coll, keys, **opts):
        """Çok işçili (multi-worker) başlatmada eşzamanlı indeks kurulumları birbirini iptal
        edebilir (IndexBuildAborted); başlatmayı çökertmeden yeniden dener."""
        for _try in range(4):
            try:
                await coll.create_index(keys, **opts)
                return
            except Exception as _ix_exc:
                logger.warning(f"[GÜVENLİK] indeks {getattr(coll, 'name', '')}:{keys} deneme {_try+1}: {_ix_exc}")
                await asyncio.sleep(0.5 + _try)

    # Oturumlar: eski düz token indeksi (unique, sparse OLMAYAN) yeni hash'li kayıtlarla çakışır -> kaldır
    try:
        _sess_idx = await db.user_sessions.index_information()
        _old = _sess_idx.get("session_token_1")
        if _old and not _old.get("sparse"):
            await db.user_sessions.drop_index("session_token_1")
    except Exception as _di_exc:
        logger.warning(f"[GÜVENLİK] session_token indeksi kaldırılamadı (başka işçi hallediyor olabilir): {_di_exc}")
    await _safe_index(db.user_sessions, "session_token", unique=True, sparse=True)
    await _safe_index(db.user_sessions, "token_hash", unique=True, sparse=True)
    await _safe_index(db.user_sessions, "expires_at", expireAfterSeconds=0)
    # Mevcut düz token'ları tek seferlik hash'e çevir (DB sızıntısında oturum çalınamasın)
    try:
        async for _s in db.user_sessions.find({"session_token": {"$exists": True, "$ne": None}}, {"_id": 1, "session_token": 1}):
            await db.user_sessions.update_one({"_id": _s["_id"]}, {"$set": {"token_hash": hash_token(_s["session_token"])}, "$unset": {"session_token": ""}})
    except Exception as _mig_exc:
        logger.error(f"[GÜVENLİK] oturum migrasyonu hatası: {_mig_exc}")
    await _safe_index(db.rate_limits, "expires_at", expireAfterSeconds=0)
    await _safe_index(db.rate_limits, [("key", 1), ("bucket", 1)], unique=True)
    await _safe_index(db.login_lockouts, "key", unique=True)
    await _safe_index(db.login_lockouts, "expires_at", expireAfterSeconds=0)
    await _safe_index(db.security_alarm_sms, "sent_at", expireAfterSeconds=86400)
    await _safe_index(db.admin_2fa, "challenge_id", unique=True)
    await _safe_index(db.admin_2fa, "expires_at", expireAfterSeconds=0)
    try:
        _adm_ids = [u["user_id"] async for u in db.users.find({"role": {"$in": ["admin", "yonetici"]}}, {"_id": 0, "user_id": 1})]
        _dr = await db.user_sessions.delete_many({"user_id": {"$in": _adm_ids}, "twofa_verified": {"$ne": True}})
        if _dr.deleted_count:
            logger.warning("[GÜVENLİK] SMS doğrulamasız %s yönetici oturumu düşürüldü", _dr.deleted_count)
    except Exception as _e:
        logger.error("[GÜVENLİK] yönetici oturum temizliği hatası: %s", _e)
    if _AFRO_FERNET is None:
        logger.error("[GÜVENLİK] cryptography yok — venv'e 'pip install cryptography' gerekli!")
    # Yönetici oturum güvenlik watchdog'unu başlat (her 2 dk'da bir tarama)
    asyncio.create_task(_admin_watchdog_loop())
    logger.info("[GÜVENLİK] Admin watchdog başlatıldı (2 dk'da bir tarama)")
    await db.products.create_index("id", unique=True)
    # Aynı kullanıcı adının çok işçili başlatmada birden çok kez oluşmasını engelle.
    await _safe_index(db.users, "username", unique=True, sparse=True)

    # NOT: Sabit parolalı "admin" / "pazar2026" seed hesabı GÜVENLİK nedeniyle
    # kaldırıldı (2026-09-10 denetimi, bulgu #1). Yönetici hesabı artık yalnızca
    # elle (DB'de) oluşturulur; canlıda `yonetici` rollü gerçek bir hesap mevcut.

    # Seed / migrate products to the fixed category structure (runs once per version)
    meta = await db.meta.find_one({"key": "product_seed"})
    current_version = meta["version"] if meta else 0
    if current_version < PRODUCT_SEED_VERSION:
        sample_products = [
            # Domates
            {"name": "Salkım Domates", "category": "Domates", "price": 24.90, "unit": "kg", "description": "Taze salkım domates", "image_url": "https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=400&q=80"},
            {"name": "Pembe Domates", "category": "Domates", "price": 29.90, "unit": "kg", "description": "Tatlı pembe domates", "image_url": "https://images.unsplash.com/photo-1607305387299-a3d9611cd469?w=400&q=80"},
            {"name": "Çeri Domates", "category": "Domates", "price": 39.90, "unit": "kg", "description": "Atıştırmalık çeri domates", "image_url": "https://images.unsplash.com/photo-1546470427-e26264be0b0d?w=400&q=80"},
            # Salata
            {"name": "Kıvırcık Marul", "category": "Salata", "price": 12.00, "unit": "adet", "description": "Çıtır kıvırcık marul", "image_url": "https://images.unsplash.com/photo-1622206151226-18ca2c9ab4a1?w=400&q=80"},
            {"name": "Göbek Salata", "category": "Salata", "price": 15.00, "unit": "adet", "description": "Taze göbek salata", "image_url": "https://images.unsplash.com/photo-1640958904159-51ae08bd3412?w=400&q=80"},
            {"name": "Roka", "category": "Salata", "price": 8.00, "unit": "demet", "description": "Taze roka", "image_url": "https://images.unsplash.com/photo-1515872474884-c6dd0f2f3a2f?w=400&q=80"},
            {"name": "Maydanoz", "category": "Salata", "price": 6.00, "unit": "demet", "description": "Taze maydanoz", "image_url": "https://images.unsplash.com/photo-1535189043414-47a3c49a0bed?w=400&q=80"},
            # Kabak
            {"name": "Sakız Kabağı", "category": "Kabak", "price": 22.00, "unit": "kg", "description": "Taze sakız kabağı", "image_url": "https://images.unsplash.com/photo-1596199388524-13d1bb6e8b34?w=400&q=80"},
            {"name": "Bal Kabağı", "category": "Kabak", "price": 18.00, "unit": "kg", "description": "Tatlı bal kabağı", "image_url": "https://images.unsplash.com/photo-1570586437263-ab629fccc818?w=400&q=80"},
            # Patlıcan
            {"name": "Kemer Patlıcan", "category": "Patlıcan", "price": 27.90, "unit": "kg", "description": "İnce kabuklu kemer patlıcan", "image_url": "https://images.unsplash.com/photo-1659261200833-ec8761558af7?w=400&q=80"},
            {"name": "Bostan Patlıcan", "category": "Patlıcan", "price": 24.90, "unit": "kg", "description": "Dolmalık bostan patlıcan", "image_url": "https://images.unsplash.com/photo-1605196560547-b2f7281b7355?w=400&q=80"},
            # Biber
            {"name": "Çarliston Biber", "category": "Biber", "price": 34.00, "unit": "kg", "description": "Tatlı çarliston biber", "image_url": "https://images.unsplash.com/photo-1563565375-f3fdfdbefa83?w=400&q=80"},
            {"name": "Sivri Biber", "category": "Biber", "price": 36.00, "unit": "kg", "description": "Acı sivri biber", "image_url": "https://images.unsplash.com/photo-1583119022894-919a68a3d0e3?w=400&q=80"},
            {"name": "Dolmalık Biber", "category": "Biber", "price": 32.00, "unit": "kg", "description": "Renkli dolmalık biber", "image_url": "https://images.unsplash.com/photo-1525607551316-4a8e16d1f9ba?w=400&q=80"},
            {"name": "Kapya Biber", "category": "Biber", "price": 38.00, "unit": "kg", "description": "Közlemelik kapya biber", "image_url": "https://images.unsplash.com/photo-1601648764658-cf37e8c89b70?w=400&q=80"},
            # Çeşitler
            {"name": "Salatalık", "category": "Çeşitler", "price": 19.50, "unit": "kg", "description": "Çıtır taze salatalık", "image_url": "https://images.unsplash.com/photo-1604977042946-1eecc30f269e?w=400&q=80"},
            {"name": "Patates", "category": "Çeşitler", "price": 14.00, "unit": "kg", "description": "Yerli patates", "image_url": "https://images.unsplash.com/photo-1518977676601-b53f82aba655?w=400&q=80"},
            {"name": "Soğan", "category": "Çeşitler", "price": 12.50, "unit": "kg", "description": "Kuru soğan", "image_url": "https://images.unsplash.com/photo-1508747703725-719777637510?w=400&q=80"},
            {"name": "Havuç", "category": "Çeşitler", "price": 16.00, "unit": "kg", "description": "Taze havuç", "image_url": "https://images.unsplash.com/photo-1598170845058-32b9d6a5da37?w=400&q=80"},
            {"name": "Limon", "category": "Çeşitler", "price": 21.00, "unit": "kg", "description": "Sulu limon", "image_url": "https://images.unsplash.com/photo-1590502593747-42a996133562?w=400&q=80"},
        ]
        await db.products.delete_many({})
        docs = [Product(**p).dict() for p in sample_products]
        await db.products.insert_many(docs)
        await db.meta.update_one(
            {"key": "product_seed"},
            {"$set": {"key": "product_seed", "version": PRODUCT_SEED_VERSION}},
            upsert=True,
        )
        logger.info("Seeded/migrated %d products to v%d", len(docs), PRODUCT_SEED_VERSION)

    # Seed campaigns
    if await db.campaigns.count_documents({}) == 0:
        sample_campaigns = [
            {"title": "Üyelere Özel Hafta Sonu İndirimi", "description": "Cumartesi-Pazar tüm meyvelerde üyelere %15 indirim! Üyelik kartınızı tezgahta gösterin.", "discount_text": "%15 İndirim", "members_only": True, "image_url": "https://images.pexels.com/photos/18452311/pexels-photo-18452311.jpeg?auto=compress&cs=tinysrgb&w=800", "valid_until": "2026-12-31"},
            {"title": "Mevsim Sebzelerinde Büyük Fırsat", "description": "Tüm mevsim sebzelerinde uygun fiyatlar. Taze ve doğal ürünler tezgahta sizleri bekliyor.", "discount_text": "Uygun Fiyat", "members_only": False, "image_url": "https://images.unsplash.com/photo-1542838132-92c53300491e?w=800&q=80", "valid_until": "2026-12-31"},
            {"title": "Üye Ol, İlk Alışverişte Kazan", "description": "Üye olan müşterilerimize ilk alışverişlerinde özel sürpriz indirim. Hemen üye olun!", "discount_text": "Hoş Geldin Hediyesi", "members_only": True, "image_url": "https://images.pexels.com/photos/36377439/pexels-photo-36377439.jpeg?auto=compress&cs=tinysrgb&w=800", "valid_until": "2026-12-31"},
        ]
        docs = [Campaign(**c).dict() for c in sample_campaigns]
        await db.campaigns.insert_many(docs)
        logger.info("Seeded %d campaigns", len(docs))

    # Seed coupons
    if await db.coupons.count_documents({}) == 0:
        sample_coupons = [
            {"code": "TAZE10", "title": "Tüm Ürünlerde %10 İndirim", "description": "Tezgahta bu kodu gösterin, tüm alışverişinizde %10 indirim kazanın.", "discount_percent": 10, "members_only": True, "valid_until": "2026-12-31"},
            {"code": "MEYVE20", "title": "Meyvelerde %20 İndirim", "description": "Üyelere özel tüm meyvelerde %20 indirim kuponu.", "discount_percent": 20, "members_only": True, "valid_until": "2026-12-31"},
            {"code": "HOSGELDIN15", "title": "Hoş Geldin Kuponu %15", "description": "Yeni üyelere özel ilk alışverişte %15 indirim.", "discount_percent": 15, "members_only": True, "valid_until": "2026-12-31"},
        ]
        docs = [Coupon(**c).dict() for c in sample_coupons]
        await db.coupons.insert_many(docs)
        logger.info("Seeded %d coupons", len(docs))

    # Seed markets (çıkılan pazarlar)
    if await db.markets.count_documents({}) == 0:
        sample_markets = [
            {"name": "Mudanya Güzelyalı Pazarı", "day": "Perşembe", "location": "Güzelyalı, Mudanya / Bursa", "note": "Sabah erken taze ürünlerle tezgahtayız.", "image_url": "https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=800&q=80"},
            {"name": "Mudanya Cumartesi Pazarı", "day": "Cumartesi", "location": "Mudanya Merkez / Bursa", "note": "Mevsim sebze ve meyveleri.", "image_url": "https://images.unsplash.com/photo-1542838132-92c53300491e?w=800&q=80"},
        ]
        docs = [Market(**m).dict() for m in sample_markets]
        await db.markets.insert_many(docs)
        logger.info("Seeded %d markets", len(docs))


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

# SUPPLIER ENDPOINTS (admin CRUD /api/admin/suppliers*, public /api/suppliers)
# -> routers/suppliers.py

# Catalog Config (get/set) -> routers/catalog.py


# admin/orders (list/get/update/refund/verify-delivery-code) -> routers/admin_orders.py


# =====================================================================
# KURYE UÇLARI
# Kurye, atandığı PAZARDAN (courier_market) verilen EVE SERVİS siparişlerini
# görür ve yönetir. Akış: ... -> hazir -> [Yola Çıktım] -> yolda ->
# [Teslim kodu doğrula] -> teslim_edildi. SMS bildirimi YOK (yalnızca durum).
# =====================================================================
# COURIER_ACTIVE_STATUSES, _courier_*, /api/courier/{me,orders,orders/history,
# orders/{tx_id}/depart,orders/{tx_id}/verify-delivery-code} -> routers/courier.py


# admin/complaints, admin/issues -> routers/complaints.py

# admin/visits/report, settings (get/set), admin/legal-docs (get), admin/sms/config
# -> routers/settings.py
# admin/upload-pdf, admin/legal-docs (post/put), contracts/pending,
# contracts/accept, admin/contract-gate-stats, admin/contract-gate-logs
# -> routers/legal.py


# admin/logs/stats/overview + admin/logs/{collection_name} -> routers/logs.py
