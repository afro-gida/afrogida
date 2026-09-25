from fastapi import FastAPI, APIRouter, Header, HTTPException, Depends, Request, File, UploadFile
from fastapi.staticfiles import StaticFiles
from fastapi.responses import PlainTextResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
import base64
import hashlib
import hmac
import json
import bcrypt
import httpx
from pathlib import Path
from pydantic import BaseModel, Field, field_validator
from typing import List, Optional
from datetime import datetime, timezone, timedelta


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
app.mount("/uploads", StaticFiles(directory=str(ROOT_DIR / "uploads")), name="uploads")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

EMERGENT_SESSION_API = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"
SESSION_DURATION_DAYS = 7

# Fixed, ordered product categories shown as tabs in the app
ORDERED_CATEGORIES = ["Domates", "Salata", "Kabak", "Patlıcan", "Biber", "Fasulye & Bakliyat", "Çeşitler"]
PRODUCT_SEED_VERSION = 2

# Welcome coupon auto-issued to every new member on registration
WELCOME_DISCOUNT_AMOUNT = 50.0   # TL
WELCOME_MIN_AMOUNT = 500.0       # TL


# ---------------- Helpers ----------------
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def to_aware(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


async def create_session(user_id: str, token: Optional[str] = None) -> str:
    session_token = token or uuid.uuid4().hex
    await db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user_id,
        "created_at": now_utc(),
        "expires_at": now_utc() + timedelta(days=SESSION_DURATION_DAYS),
    })
    return session_token


async def get_current_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Yetkilendirme gerekli")
    token = authorization.split(" ", 1)[1].strip()
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Geçersiz oturum")
    if to_aware(session["expires_at"]) < now_utc():
        await db.user_sessions.delete_one({"session_token": token})
        raise HTTPException(status_code=401, detail="Oturum süresi doldu")
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Kullanıcı bulunamadı")
    return user


async def get_current_admin(user=Depends(get_current_user)):
    if user.get("role") not in ("admin", "yonetici"):
        raise HTTPException(status_code=403, detail="Yönetici yetkisi gerekli")
    return user


# Personel/esnaf dahil sınırlı yetkili kullanıcılar (ürün düzenleme için)
async def get_current_staff(user=Depends(get_current_user)):
    if user.get("role") not in ("admin", "yonetici", "esnaf"):
        raise HTTPException(status_code=403, detail="Yetki gerekli")
    return user


async def get_optional_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        return None
    try:
        return await get_current_user(authorization)
    except HTTPException:
        return None


# ---------------- Models ----------------
class GoogleSessionInput(BaseModel):
    session_id: str


class PhoneLoginInput(BaseModel):
    phone: str
    name: str


class RegisterInput(BaseModel):
    name: str
    phone: str
    password: Optional[str] = None


class LoginInput(BaseModel):
    phone: str
    password: Optional[str] = None


class AdminLoginInput(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    user_id: str
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    picture: Optional[str] = None
    role: str = "member"
    auth_type: str
    created_at: datetime
    addresses: List[dict] = Field(default_factory=list)
    marketing_consent: Optional[bool] = None


class AuthResponse(BaseModel):
    token: str
    user: UserOut


class ProductInput(BaseModel):
    name: str
    category: str
    subcategory: Optional[str] = "Diğer"
    supplier_group: Optional[str] = "Zeytinci"
    price: Optional[float] = None
    gel_al_price: Optional[float] = 0
    eve_servis_price: Optional[float] = None
    unit: str = "Kg"
    image_url: Optional[str] = None
    description: Optional[str] = None
    in_stock: bool = True
    active: bool = True
    hidden: bool = False
    selectable: bool = False
    quality: Optional[str] = None
    spicy_type: Optional[str] = None
    active_gel_al: bool = True
    active_eve_servis: bool = True
    campaign_discount_percent: Optional[float] = 0
    campaign_min_qty: Optional[float] = 0
    # Ürün özelleştirme (boyut/şekil/kalınlık gibi seçenek grupları + not kutusu)
    # customization_options ör: [{"title":"Boyut","choices":[{"label":"Küçük","price_delta":0},{"label":"Büyük","price_delta":5}]}]
    customization_options: Optional[List[dict]] = None
    customization_note_enabled: Optional[bool] = False
    customization_note_label: Optional[str] = None

    # Form boş sayısal alanları "" (boş string) olarak gönderebiliyor;
    # bunları None'a çevir ki float doğrulaması patlamasın (422 hatası).
    @field_validator(
        "price", "gel_al_price", "eve_servis_price",
        "campaign_discount_percent", "campaign_min_qty",
        mode="before",
    )
    @classmethod
    def _empty_str_to_none(cls, v):
        if isinstance(v, str):
            s = v.strip().replace(",", ".")
            if s == "":
                return None
            try:
                return float(s)
            except (ValueError, TypeError):
                return None
        return v


class Product(ProductInput):
    id: str = Field(default_factory=lambda: new_id("prod"))
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)


class Campaign(BaseModel):
    id: str = Field(default_factory=lambda: new_id("camp"))
    title: str
    description: str
    image_url: Optional[str] = None
    discount_text: Optional[str] = None
    members_only: bool = True
    active: bool = True
    valid_until: Optional[str] = None
    created_at: datetime = Field(default_factory=now_utc)


class CampaignInput(BaseModel):
    title: str
    description: str
    image_url: Optional[str] = None
    discount_text: Optional[str] = None
    members_only: bool = True
    active: bool = True
    valid_until: Optional[str] = None


class Coupon(BaseModel):
    id: str = Field(default_factory=lambda: new_id("coup"))
    code: str
    title: str
    description: Optional[str] = None
    discount_percent: int = 10
    discount_amount: Optional[float] = None  # fixed TL discount; takes priority over percent when set
    min_amount: float = 0
    members_only: bool = True
    assigned_user_ids: List[str] = Field(default_factory=list)
    single_use: bool = False
    used: bool = False
    used_at: Optional[datetime] = None
    auto_issued: bool = False  # True for the automatic welcome coupon
    active: bool = True
    valid_until: Optional[str] = None
    created_at: datetime = Field(default_factory=now_utc)


class CouponInput(BaseModel):
    code: str
    title: str
    description: Optional[str] = None
    discount_percent: int = 10
    discount_amount: Optional[float] = None
    min_amount: float = 0
    members_only: bool = True
    assigned_user_ids: List[str] = Field(default_factory=list)
    single_use: bool = False
    active: bool = True
    valid_until: Optional[str] = None


class RedeemInput(BaseModel):
    code: str


class Market(BaseModel):
    id: str = Field(default_factory=lambda: new_id("market"))
    name: str
    day: str
    image_url: Optional[str] = None
    location: Optional[str] = None
    location_url: Optional[str] = None
    google_maps_url: Optional[str] = None
    note: Optional[str] = None
    active: bool = True
    is_open: bool = False
    orders_enabled: bool = False
    delivery_enabled: bool = False
    online_payment_enabled: bool = False
    active_eve_servis: bool = False
    active_gel_al: bool = True
    delivery_neighborhoods: List[str] = []
    created_at: datetime = Field(default_factory=now_utc)


class MarketInput(BaseModel):
    name: str
    day: str
    image_url: Optional[str] = None
    location: Optional[str] = None
    location_url: Optional[str] = None
    google_maps_url: Optional[str] = None
    note: Optional[str] = None
    active: bool = True
    orders_enabled: bool = False
    delivery_enabled: bool = False
    online_payment_enabled: bool = False
    active_eve_servis: bool = False
    active_gel_al: bool = True
    delivery_neighborhoods: List[str] = []


# ---------------- Auth Routes ----------------
@api_router.post("/auth/google")
async def auth_google(payload: GoogleSessionInput):
    async with httpx.AsyncClient(timeout=20) as http:
        resp = await http.get(EMERGENT_SESSION_API, headers={"X-Session-ID": payload.session_id})
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Google oturumu doğrulanamadı")
    data = resp.json()
    email = data.get("email")
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
    else:
        user_id = new_id("user")
        await db.users.insert_one({
            "user_id": user_id,
            "name": data.get("name") or "Üye",
            "email": email,
            "picture": data.get("picture"),
            "phone": None,
            "role": "member",
            "auth_type": "google",
            "created_at": now_utc(),
        })
    token = await create_session(user_id, token=data.get("session_token"))
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return {"token": token, "user": _public_user_doc(user)}


@api_router.post("/auth/phone")
async def auth_phone(payload: PhoneLoginInput):
    phone = payload.phone.strip()
    if len(phone) < 7:
        raise HTTPException(status_code=400, detail="Geçerli bir telefon numarası girin")
    existing = await db.users.find_one({"phone": phone}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        if payload.name.strip():
            await db.users.update_one({"user_id": user_id}, {"$set": {"name": payload.name.strip()}})
    else:
        user_id = new_id("user")
        await db.users.insert_one({
            "user_id": user_id,
            "name": payload.name.strip() or "Üye",
            "email": None,
            "picture": None,
            "phone": phone,
            "role": "member",
            "auth_type": "phone",
            "created_at": now_utc(),
        })
    token = await create_session(user_id)
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return {"token": token, "user": _public_user_doc(user)}


async def issue_welcome_coupon(user_id: str):
    """Auto-issue a single-use welcome coupon to a new member."""
    coupon = Coupon(
        code=f"HG{uuid.uuid4().hex[:6].upper()}",
        title="Hoş Geldin Kuponu",
        description="İlk alışverişinizde 500₺ ve üzeri için 50₺ indirim. Kodu tezgahta gösterin.",
        discount_percent=0,
        discount_amount=WELCOME_DISCOUNT_AMOUNT,
        min_amount=WELCOME_MIN_AMOUNT,
        members_only=True,
        assigned_user_ids=[user_id],
        single_use=True,
        used=False,
        auto_issued=True,
        active=True,
    )
    await db.coupons.insert_one(coupon.dict())


@api_router.post("/auth/register")
async def auth_register(payload: RegisterInput):
    phone = payload.phone.strip()
    name = payload.name.strip()
    if len(phone) < 7:
        raise HTTPException(status_code=400, detail="Geçerli bir telefon numarası girin")
    if not name:
        raise HTTPException(status_code=400, detail="Lütfen adınızı girin")
    existing = await db.users.find_one({"phone": phone}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=409, detail="Bu numara zaten kayıtlı. Lütfen giriş yapın.")
    user_id = new_id("user")
    await db.users.insert_one({
        "user_id": user_id,
        "name": name or "Üye",
        "email": None,
        "picture": None,
        "phone": phone,
        "role": "member",
        "auth_type": "phone",
        "password_hash": hash_password(payload.password) if payload.password else None,
        "created_at": now_utc(),
    })
    await issue_welcome_coupon(user_id)
    token = await create_session(user_id)
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return {"token": token, "user": _public_user_doc(user)}


@api_router.post("/auth/login")
async def auth_login(payload: LoginInput):
    phone = payload.phone.strip()
    if len(phone) < 7:
        raise HTTPException(status_code=400, detail="Geçerli bir telefon numarası girin")
    existing = await db.users.find_one({"phone": phone}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı. Lütfen önce üye olun.")
    stored_hash = existing.get("password_hash")
    if stored_hash:
        if not payload.password or not verify_password(payload.password, stored_hash):
            raise HTTPException(status_code=401, detail="Telefon numarası veya şifre hatalı")
    else:
        # Legacy kullanıcı: şifresi yoksa ilk girişte belirlediği şifreyi kaydet
        if payload.password:
            await db.users.update_one({"user_id": existing["user_id"]}, {"$set": {"password_hash": hash_password(payload.password)}})
    token = await create_session(existing["user_id"])
    user = await db.users.find_one({"user_id": existing["user_id"]}, {"_id": 0})
    return {"token": token, "user": _public_user_doc(user)}


@api_router.post("/auth/admin")
async def auth_admin(payload: AdminLoginInput):
    admin = await db.users.find_one({"role": {"$in": ["admin", "yonetici"]}, "username": payload.username})
    if not admin or not verify_password(payload.password, admin.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Kullanıcı adı veya şifre hatalı")
    token = await create_session(admin["user_id"])
    user = await db.users.find_one({"user_id": admin["user_id"]}, {"_id": 0, "password_hash": 0, "username": 0})
    return {"token": token, "user": _public_user_doc(user)}


@api_router.get("/auth/me")
async def auth_me(user=Depends(get_current_user)):
    return _public_user_doc(user)


@api_router.post("/auth/logout")
async def auth_logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        await db.user_sessions.delete_one({"session_token": token})
    return {"success": True}


# ---------------- Customer profile / address compatibility routes ----------------
def _clean_text(value) -> str:
    return str(value or "").strip()




# ---------------- Verimor SMS helpers ----------------
def _normalize_sms_phone(phone: str) -> str:
    phone_clean = str(phone or "").replace(" ", "").replace("-", "").replace("(", "").replace(")", "").replace("+", "")
    if phone_clean.startswith("0"):
        phone_clean = "90" + phone_clean[1:]
    elif phone_clean and not phone_clean.startswith("90"):
        phone_clean = "90" + phone_clean
    return phone_clean


def send_sms_verimor(phone: str, message: str) -> bool:
    """Verimor HTTP API ile SMS gönder."""
    username = os.environ.get("VERIMOR_USERNAME", "")
    password = os.environ.get("VERIMOR_PASSWORD", "")
    sender = os.environ.get("VERIMOR_SENDER", "AFROGIDA")

    if not username or not password:
        logger.error("[SMS] Verimor bilgileri eksik")
        return False

    phone_clean = _normalize_sms_phone(phone)
    if len(phone_clean) < 10:
        logger.error("[SMS] Geçersiz telefon numarası")
        return False

    payload = {
        "username": username,
        "password": password,
        "sender": sender,
        "messages": [{"msg": message, "dest": phone_clean}],
    }

    try:
        response = httpx.post("https://sms.verimor.com.tr/v2/send.json", json=payload, timeout=10)
        try:
            result = response.json()
        except Exception:
            result = {"raw": response.text[:300]}
        if response.status_code == 200:
            logger.info("[SMS] Başarıyla gönderildi: %s", phone_clean[-4:].rjust(len(phone_clean), "*"))
            return True
        logger.error("[SMS] Verimor hata status=%s response=%s", response.status_code, result)
        return False
    except Exception as exc:
        logger.error("[SMS] İstek hatası: %s", exc)
        return False


def _generate_sms_code() -> str:
    import random
    return f"{random.randint(0, 999999):06d}"


def send_delivery_sms(phone: str, order_id: str, delivery_code: str) -> bool:
    """Sipariş hazır olduğunda teslim kodu SMS'i gönder."""
    expiry_time = datetime.now().replace(hour=23, minute=59, second=0, microsecond=0)
    expiry_str = expiry_time.strftime("%d.%m.%Y 23:59")
    message = (
        "Afro Gida siparisiniz hazir!\n"
        f"Teslim kodu: {delivery_code}\n"
        f"Gecerlilik: {expiry_str}\n"
        f"Siparis No: {str(order_id)[:8].upper()}"
    )
    return send_sms_verimor(phone, message)


def _normalize_address_payload(data: dict, user_id: str, existing_id: Optional[str] = None) -> dict:
    address_id = existing_id or data.get("id") or new_id("addr")
    title = _clean_text(data.get("title") or data.get("type") or "Evim")
    address = {
        "id": address_id,
        "user_id": user_id,
        "title": title,
        "city": _clean_text(data.get("city") or data.get("il") or "Bursa"),
        "district": _clean_text(data.get("district") or data.get("ilce") or ""),
        "neighborhood": _clean_text(data.get("neighborhood") or data.get("mahalle") or ""),
        "street": _clean_text(data.get("street") or data.get("sokak") or data.get("cadde") or ""),
        "building_no": _clean_text(data.get("building_no") or data.get("bina_no") or data.get("building") or ""),
        "floor": _clean_text(data.get("floor") or data.get("kat") or ""),
        "apartment_no": _clean_text(data.get("apartment_no") or data.get("daire") or data.get("door") or ""),
        "site_name": _clean_text(data.get("site_name") or data.get("site_adi") or ""),
        "description": _clean_text(data.get("description") or data.get("adres_tarifi") or ""),
        "details": data.get("details"),
        "lat": data.get("lat"),
        "lng": data.get("lng"),
        "is_default": bool(data.get("is_default", False)),
        "updated_at": now_utc(),
    }
    if not existing_id:
        address["created_at"] = now_utc()
    return address


def _validate_address_payload(address: dict):
    missing = []
    if not _clean_text(address.get("neighborhood")):
        missing.append("mahalle")
    if not _clean_text(address.get("street")):
        missing.append("sokak/cadde")
    if not _clean_text(address.get("building_no")):
        missing.append("bina no")
    if missing:
        raise HTTPException(
            status_code=400,
            detail="Adres kaydı için zorunlu alanlar eksik: " + ", ".join(missing)
        )


def _public_user_doc(user: dict) -> dict:
    return {k: v for k, v in user.items() if k not in ("_id", "password_hash", "username")}


@api_router.put("/auth/profile")
async def update_auth_profile(data: dict, current_user: dict = Depends(get_current_user)):
    updates = {}
    if "name" in data:
        name = str(data.get("name") or "").strip()
        if name:
            updates["name"] = name
    if "marketing_consent" in data:
        updates["marketing_consent"] = bool(data.get("marketing_consent"))
    if updates:
        updates["updated_at"] = now_utc()
        await db.users.update_one({"user_id": current_user["user_id"]}, {"$set": updates})
    user = await db.users.find_one({"user_id": current_user["user_id"]}, {"_id": 0, "password_hash": 0, "username": 0})
    return user


@api_router.get("/auth/addresses")
async def list_auth_addresses(current_user: dict = Depends(get_current_user)):
    user = await db.users.find_one({"user_id": current_user["user_id"]}, {"_id": 0, "addresses": 1})
    addresses = user.get("addresses", []) if user else []
    if not addresses:
        addresses = await db.addresses.find({"user_id": current_user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return addresses


@api_router.post("/auth/addresses")
async def create_auth_address(data: dict, current_user: dict = Depends(get_current_user)):
    address = _normalize_address_payload(data, current_user["user_id"])
    _validate_address_payload(address)
    user = await db.users.find_one({"user_id": current_user["user_id"]}, {"_id": 0, "addresses": 1})
    current_addresses = user.get("addresses", []) if user else []
    if not current_addresses or address.get("is_default"):
        for addr in current_addresses:
            addr["is_default"] = False
        address["is_default"] = True
    current_addresses.append(address)
    await db.users.update_one({"user_id": current_user["user_id"]}, {"$set": {"addresses": current_addresses, "updated_at": now_utc()}})
    await db.addresses.update_one({"id": address["id"], "user_id": current_user["user_id"]}, {"$set": address}, upsert=True)
    user_doc = await db.users.find_one({"user_id": current_user["user_id"]}, {"_id": 0, "password_hash": 0, "username": 0})
    return {"success": True, "address": address, "user": user_doc}


@api_router.put("/auth/addresses/{address_id}")
async def update_auth_address(address_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    user = await db.users.find_one({"user_id": current_user["user_id"]}, {"_id": 0, "addresses": 1})
    addresses = user.get("addresses", []) if user else []
    found = False
    updated_address = None
    for idx, addr in enumerate(addresses):
        if addr.get("id") == address_id:
            updated_address = _normalize_address_payload({**addr, **data}, current_user["user_id"], existing_id=address_id)
            _validate_address_payload(updated_address)
            addresses[idx] = updated_address
            found = True
            break
    if not found:
        existing = await db.addresses.find_one({"id": address_id, "user_id": current_user["user_id"]}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Adres bulunamadı")
        updated_address = _normalize_address_payload({**existing, **data}, current_user["user_id"], existing_id=address_id)
        _validate_address_payload(updated_address)
        addresses.append(updated_address)
    if updated_address and updated_address.get("is_default"):
        for addr in addresses:
            if addr.get("id") != address_id:
                addr["is_default"] = False
    await db.users.update_one({"user_id": current_user["user_id"]}, {"$set": {"addresses": addresses, "updated_at": now_utc()}})
    await db.addresses.update_one({"id": address_id, "user_id": current_user["user_id"]}, {"$set": updated_address}, upsert=True)
    return {"success": True, "address": updated_address}


@api_router.delete("/auth/addresses/{address_id}")
async def delete_auth_address(address_id: str, current_user: dict = Depends(get_current_user)):
    user = await db.users.find_one({"user_id": current_user["user_id"]}, {"_id": 0, "addresses": 1})
    addresses = user.get("addresses", []) if user else []
    new_addresses = [addr for addr in addresses if addr.get("id") != address_id]
    if len(new_addresses) == len(addresses):
        existing = await db.addresses.find_one({"id": address_id, "user_id": current_user["user_id"]})
        if not existing:
            raise HTTPException(status_code=404, detail="Adres bulunamadı")
    if new_addresses and not any(addr.get("is_default") for addr in new_addresses):
        new_addresses[0]["is_default"] = True
    await db.users.update_one({"user_id": current_user["user_id"]}, {"$set": {"addresses": new_addresses, "updated_at": now_utc()}})
    await db.addresses.delete_one({"id": address_id, "user_id": current_user["user_id"]})
    return {"success": True}


@api_router.patch("/auth/addresses/{address_id}/default")
async def set_default_auth_address(address_id: str, current_user: dict = Depends(get_current_user)):
    user = await db.users.find_one({"user_id": current_user["user_id"]}, {"_id": 0, "addresses": 1})
    addresses = user.get("addresses", []) if user else []
    found = False
    for addr in addresses:
        is_target = addr.get("id") == address_id
        addr["is_default"] = is_target
        found = found or is_target
    if not found:
        raise HTTPException(status_code=404, detail="Adres bulunamadı")
    await db.users.update_one({"user_id": current_user["user_id"]}, {"$set": {"addresses": addresses, "updated_at": now_utc()}})
    await db.addresses.update_many({"user_id": current_user["user_id"]}, {"$set": {"is_default": False}})
    await db.addresses.update_one({"id": address_id, "user_id": current_user["user_id"]}, {"$set": {"is_default": True, "updated_at": now_utc()}})
    return {"success": True}


# Backward-compatible aliases if any screen calls /api/addresses directly.
@api_router.get("/addresses")
async def compat_list_addresses(current_user: dict = Depends(get_current_user)):
    return await list_auth_addresses(current_user)


@api_router.post("/addresses")
async def compat_create_address(data: dict, current_user: dict = Depends(get_current_user)):
    return await create_auth_address(data, current_user)


@api_router.put("/addresses/{address_id}")
async def compat_update_address(address_id: str, data: dict, current_user: dict = Depends(get_current_user)):
    return await update_auth_address(address_id, data, current_user)


@api_router.delete("/addresses/{address_id}")
async def compat_delete_address(address_id: str, current_user: dict = Depends(get_current_user)):
    return await delete_auth_address(address_id, current_user)


@api_router.patch("/addresses/{address_id}/default")
async def compat_set_default_address(address_id: str, current_user: dict = Depends(get_current_user)):
    return await set_default_auth_address(address_id, current_user)


# ---------------- Product Routes ----------------
def _afro_norm(s):
    """Boşlukları kırp + küçük harfe indir (pazar/tedarikçi adı eşleştirmek için)."""
    try:
        return (s or "").strip().casefold()
    except Exception:
        return ""


@api_router.get("/products", response_model=List[Product])
async def list_products(
    category: Optional[str] = None,
    search: Optional[str] = None,
    market: Optional[str] = None,
    show_all: Optional[str] = None,
):
    query = {}
    if category and category != "Tümü":
        query["category"] = category
    if search:
        query["name"] = {"$regex": search, "$options": "i"}
    products = await db.products.find(query, {"_id": 0}).to_list(1000)

    # PAZAR BAZLI TEDARİKÇİ FİLTRESİ: Bir ürün, ancak tedarikçisi (supplier_group)
    # catalog_config.supplier_markets içinde seçili pazara atanmışsa görünür.
    # - Tedarikçinin haritada kaydı varsa: KATI davran (sadece atanmış pazarlarda
    #   görünür; liste boşsa hiçbir pazarda görünmez).
    # - Tedarikçinin hiç kaydı yoksa: güvenli tarafta kal (her pazarda göster).
    # - market boşsa veya show_all istenmişse: filtreleme yok (geriye dönük uyumlu).
    _show_all = str(show_all).lower() in ("1", "true", "yes") if show_all is not None else False
    if market and market.strip() and not _show_all:
        target = _afro_norm(market)
        cfg = await _read_catalog_config()
        sm = (cfg or {}).get("supplier_markets") or {}
        norm_map = {}  # kayıtlı tedarikçiler -> izin verilen pazar kümeleri
        for sup, mkts in sm.items():
            mset = set(_afro_norm(x) for x in (mkts or []) if _afro_norm(x))
            # Tedarikçi supplier_markets'te kayıtlıysa (boş bile olsa) kısıtlıdır.
            # - Listesi boşsa: hiçbir pazarda görünmez.
            # - Listesi doluysa: sadece o pazarlarda görünür.
            norm_map[_afro_norm(sup)] = mset

        def _allowed(p):
            sg = _afro_norm(p.get("supplier_group") or "")
            if sg in norm_map:
                # Tedarikçi kayıtlı -> izin listesine bak (boş küme = hiçbir yerde yok)
                return target in norm_map[sg]
            return True  # yapılandırılmamış tedarikçi -> her pazarda göster (eski ürünler)

        products = [p for p in products if _allowed(p)]
    # Order by category (same top-to-bottom order as the category menu),
    # then in-stock first (out-of-stock sink to the bottom of each category), then name.
    cat_order = {c: i for i, c in enumerate(ORDERED_CATEGORIES)}
    products.sort(key=lambda p: (
        cat_order.get(p.get("category"), len(cat_order)),
        0 if p.get("in_stock") else 1,
        (p.get("name") or "").lower(),
    ))
    return products


@api_router.get("/products-meta")
async def products_meta():
    doc = await db.products.find_one({}, {"_id": 0, "updated_at": 1}, sort=[("updated_at", -1)])
    return {"last_updated": doc["updated_at"] if doc and doc.get("updated_at") else None}


@api_router.get("/categories", response_model=List[str])
async def list_categories():
    existing = await db.products.distinct("category")
    # Always show the fixed ordered categories first, then any extra
    # categories an admin may have added that aren't in the list.
    extras = [c for c in sorted(existing) if c not in ORDERED_CATEGORIES]
    return ORDERED_CATEGORIES + extras


@api_router.get("/products/{product_id}", response_model=Product)
async def get_product(product_id: str):
    product = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not product:
        raise HTTPException(status_code=404, detail="Ürün bulunamadı")
    return product


@api_router.get("/admin/products")
async def admin_list_products(staff=Depends(get_current_staff)):
    query = {}
    if staff.get("role") == "esnaf":
        sg = staff.get("supplier_group")
        if not sg:
            return []
        query["supplier_group"] = sg
    products = await db.products.find(query, {"_id": 0}).to_list(5000)
    cat_order = {c: i for i, c in enumerate(ORDERED_CATEGORIES)}
    products.sort(key=lambda p: (
        (p.get("supplier_group") or "").lower(),
        cat_order.get(p.get("category"), len(cat_order)),
        (p.get("name") or "").lower(),
    ))
    return products


@api_router.post("/admin/products", response_model=Product)
async def create_product(payload: ProductInput, staff=Depends(get_current_staff)):
    data = payload.dict()
    # Esnaf sadece kendi tedarikçisine ürün ekleyebilir
    if staff.get("role") == "esnaf":
        sg = staff.get("supplier_group")
        if not sg:
            raise HTTPException(status_code=403, detail="Hesabınıza tedarikçi atanmamış")
        data["supplier_group"] = sg
    if not data.get("price"):
        data["price"] = data.get("gel_al_price") or 0
    product = Product(**data)
    await db.products.insert_one(product.dict())
    return product


@api_router.put("/admin/products/{product_id}", response_model=Product)
async def update_product(product_id: str, payload: ProductInput, staff=Depends(get_current_staff)):
    existing = await db.products.find_one({"id": product_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Ürün bulunamadı")
    updates = payload.dict()
    # Esnaf sadece kendi tedarikçisinin ürünlerini düzenleyebilir
    if staff.get("role") == "esnaf":
        sg = staff.get("supplier_group")
        if not sg or existing.get("supplier_group") != sg:
            raise HTTPException(status_code=403, detail="Bu ürünü düzenleme yetkiniz yok")
        updates["supplier_group"] = sg
    if not updates.get("price"):
        updates["price"] = updates.get("gel_al_price") or 0
    updates["updated_at"] = now_utc()
    result = await db.products.update_one({"id": product_id}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Ürün bulunamadı")
    product = await db.products.find_one({"id": product_id}, {"_id": 0})
    return product


@api_router.delete("/admin/products/{product_id}")
async def delete_product(product_id: str, staff=Depends(get_current_staff)):
    # Esnaf sadece kendi tedarikçisinin ürünlerini silebilir
    if staff.get("role") == "esnaf":
        sg = staff.get("supplier_group")
        existing = await db.products.find_one({"id": product_id}, {"_id": 0, "supplier_group": 1})
        if not existing:
            raise HTTPException(status_code=404, detail="Ürün bulunamadı")
        if not sg or existing.get("supplier_group") != sg:
            raise HTTPException(status_code=403, detail="Bu ürünü silme yetkiniz yok")
    result = await db.products.delete_one({"id": product_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Ürün bulunamadı")
    return {"success": True}


# ---------------- Campaign Routes ----------------
@api_router.get("/campaigns", response_model=List[Campaign])
async def list_campaigns(user=Depends(get_optional_user)):
    query = {"active": True}
    if not user:
        query["members_only"] = False
    campaigns = await db.campaigns.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return campaigns


@api_router.get("/admin/campaigns", response_model=List[Campaign])
async def admin_list_campaigns(admin=Depends(get_current_admin)):
    campaigns = await db.campaigns.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return campaigns


@api_router.post("/admin/campaigns", response_model=Campaign)
async def create_campaign(payload: CampaignInput, admin=Depends(get_current_admin)):
    campaign = Campaign(**payload.dict())
    await db.campaigns.insert_one(campaign.dict())
    return campaign


@api_router.put("/admin/campaigns/{campaign_id}", response_model=Campaign)
async def update_campaign(campaign_id: str, payload: CampaignInput, admin=Depends(get_current_admin)):
    result = await db.campaigns.update_one({"id": campaign_id}, {"$set": payload.dict()})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Kampanya bulunamadı")
    campaign = await db.campaigns.find_one({"id": campaign_id}, {"_id": 0})
    return campaign


@api_router.delete("/admin/campaigns/{campaign_id}")
async def delete_campaign(campaign_id: str, admin=Depends(get_current_admin)):
    result = await db.campaigns.delete_one({"id": campaign_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Kampanya bulunamadı")
    return {"success": True}


# ---------------- Coupon Routes ----------------
@api_router.get("/coupons", response_model=List[Coupon])
async def list_coupons(user=Depends(get_optional_user)):
    coupons = await db.coupons.find({"active": True}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    result = []
    for c in coupons:
        assigned = c.get("assigned_user_ids") or []
        if user:
            # Members see: coupons assigned to them, OR general (unassigned) coupons
            if assigned:
                if user["user_id"] in assigned:
                    result.append(c)
            else:
                result.append(c)
        else:
            # Guests see only public, unassigned coupons
            if not assigned and not c.get("members_only", True):
                result.append(c)
    return result


@api_router.post("/coupons/validate")
async def validate_coupon(data: dict, user=Depends(get_optional_user)):
    code = str(data.get("code") or "").upper().strip()
    total = float(data.get("total", data.get("cart_total", 0)) or 0)
    payment_method = str(data.get("payment_method") or "")
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
    min_amount = float(coupon.get("min_amount", 0) or 0)
    if total < min_amount:
        raise HTTPException(status_code=400, detail=f"Minimum sipariş tutarı: {min_amount:.0f}₺")
    discount_amount = coupon.get("discount_amount")
    if discount_amount is not None and float(discount_amount or 0) > 0:
        discount = float(discount_amount or 0)
        discount_type = "fixed"
    else:
        percent = float(coupon.get("discount_percent", 0) or 0)
        discount = total * percent / 100
        discount_type = "percentage"
    discount = max(0, min(discount, total))
    return {
        "success": True,
        "id": coupon.get("id"),
        "coupon_id": coupon.get("id"),
        "code": coupon.get("code"),
        "title": coupon.get("title"),
        "discount_type": discount_type,
        "discount_percent": coupon.get("discount_percent"),
        "discount_value": coupon.get("discount_amount") if discount_type == "fixed" else coupon.get("discount_percent"),
        "discount": discount,
        "discount_amount": discount,
        "min_amount": min_amount,
        "payment_method": payment_method,
        "message": f"{discount:.2f}₺ indirim uygulandı",
    }


@api_router.get("/admin/coupons", response_model=List[Coupon])
async def admin_list_coupons(admin=Depends(get_current_admin)):
    # Exclude per-member auto-issued welcome coupons to keep the admin list clean.
    coupons = await db.coupons.find({"auto_issued": {"$ne": True}}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return coupons


@api_router.post("/admin/coupons/redeem")
async def admin_redeem_coupon(payload: RedeemInput, admin=Depends(get_current_admin)):
    code = payload.code.upper().strip()
    coupon = await db.coupons.find_one({"code": code}, {"_id": 0})
    if not coupon:
        raise HTTPException(status_code=404, detail="Kupon bulunamadı")
    if not coupon.get("active", True):
        raise HTTPException(status_code=400, detail="Bu kupon pasif durumda")
    if coupon.get("single_use") and coupon.get("used"):
        raise HTTPException(status_code=400, detail="Bu kupon daha önce kullanılmış")
    await db.coupons.update_one({"id": coupon["id"]}, {"$set": {"used": True, "used_at": now_utc()}})
    return {"success": True, "code": code, "title": coupon.get("title"),
            "discount_amount": coupon.get("discount_amount"),
            "discount_percent": coupon.get("discount_percent"),
            "min_amount": coupon.get("min_amount", 0)}


@api_router.post("/admin/coupons", response_model=Coupon)
async def create_coupon(payload: CouponInput, admin=Depends(get_current_admin)):
    coupon = Coupon(**payload.dict())
    coupon.code = coupon.code.upper().strip()
    await db.coupons.insert_one(coupon.dict())
    return coupon


@api_router.put("/admin/coupons/{coupon_id}", response_model=Coupon)
async def update_coupon(coupon_id: str, payload: CouponInput, admin=Depends(get_current_admin)):
    updates = payload.dict()
    updates["code"] = updates["code"].upper().strip()
    result = await db.coupons.update_one({"id": coupon_id}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Kupon bulunamadı")
    coupon = await db.coupons.find_one({"id": coupon_id}, {"_id": 0})
    return coupon


@api_router.delete("/admin/coupons/{coupon_id}")
async def delete_coupon(coupon_id: str, admin=Depends(get_current_admin)):
    result = await db.coupons.delete_one({"id": coupon_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Kupon bulunamadı")
    return {"success": True}


# ---------------- Market (çıkılan pazarlar) Routes ----------------
@api_router.get("/markets", response_model=List[Market])
async def list_markets():
    markets = await db.markets.find({"active": True}, {"_id": 0}).sort("created_at", 1).to_list(1000)
    return markets


@api_router.get("/admin/markets", response_model=List[Market])
async def admin_list_markets(staff=Depends(get_current_staff)):
    markets = await db.markets.find({}, {"_id": 0}).sort("created_at", 1).to_list(1000)
    return markets


@api_router.post("/admin/markets", response_model=Market)
async def create_market(payload: MarketInput, admin=Depends(get_current_admin)):
    market = Market(**payload.dict())
    await db.markets.insert_one(market.dict())
    return market


@api_router.put("/admin/markets/{market_id}", response_model=Market)
async def update_market(market_id: str, payload: MarketInput, admin=Depends(get_current_admin)):
    result = await db.markets.update_one({"id": market_id}, {"$set": payload.dict()})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Pazar bulunamadı")
    market = await db.markets.find_one({"id": market_id}, {"_id": 0})
    return market


@api_router.delete("/admin/markets/{market_id}")
async def delete_market(market_id: str, admin=Depends(get_current_admin)):
    result = await db.markets.delete_one({"id": market_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Pazar bulunamadı")
    return {"success": True}


@api_router.get("/")
async def root():
    return {"message": "Pazar Uygulaması API"}


# ---------------- Member (customer) management ----------------
class MemberOut(BaseModel):
    user_id: str
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    picture: Optional[str] = None
    auth_type: str
    created_at: datetime


@api_router.get("/admin/members", response_model=List[MemberOut])
async def admin_list_members(search: Optional[str] = None, admin=Depends(get_current_admin)):
    query: dict = {"role": {"$in": ["musteri", "member"]}}
    if search and search.strip():
        rx = {"$regex": search.strip(), "$options": "i"}
        query["$or"] = [{"name": rx}, {"phone": rx}, {"email": rx}]
    members = await db.users.find(
        query, {"_id": 0, "password_hash": 0, "username": 0}
    ).sort("created_at", -1).to_list(2000)
    return members


@api_router.get("/admin/members/count")
async def admin_members_count(admin=Depends(get_current_admin)):
    count = await db.users.count_documents({"role": {"$in": ["musteri", "member"]}})
    return {"count": count}


@api_router.get("/admin/members/{user_id}")
async def admin_get_member(user_id: str, admin=Depends(get_current_admin)):
    """Üye Detayı ekranı için tek üyenin tüm (hassas olmayan) bilgilerini döndürür."""
    member = await db.users.find_one(
        {"user_id": user_id, "role": {"$in": ["musteri", "member"]}},
        {"_id": 0, "password_hash": 0, "username": 0},
    )
    if not member:
        raise HTTPException(status_code=404, detail="Üye bulunamadı")
    return member


class MemberUpdateInput(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    is_restricted: Optional[bool] = None
    restriction_reason: Optional[str] = None
    restriction_until: Optional[str] = None


@api_router.put("/admin/members/{user_id}")
async def admin_update_member(
    user_id: str, payload: MemberUpdateInput, admin=Depends(get_current_admin)
):
    """Üye bilgilerini / kısıtlama durumunu günceller (Üye Detayı ekranından)."""
    member = await db.users.find_one(
        {"user_id": user_id, "role": {"$in": ["musteri", "member"]}}
    )
    if not member:
        raise HTTPException(status_code=404, detail="Üye bulunamadı")
    update: dict = {}
    if payload.name is not None:
        update["name"] = payload.name.strip() or member.get("name") or "Üye"
    if payload.phone is not None:
        update["phone"] = payload.phone.strip()
    if payload.is_restricted is not None:
        update["is_restricted"] = bool(payload.is_restricted)
        if payload.is_restricted:
            update["restriction_reason"] = payload.restriction_reason
            update["restriction_until"] = payload.restriction_until
        else:
            # Kısıtlama kaldırıldığında sebep/süre temizlenir
            update["restriction_reason"] = None
            update["restriction_until"] = None
    if update:
        await db.users.update_one({"user_id": user_id}, {"$set": update})
    updated = await db.users.find_one(
        {"user_id": user_id}, {"_id": 0, "password_hash": 0, "username": 0}
    )
    return updated


@api_router.delete("/admin/members/{user_id}")
async def admin_delete_member(user_id: str, admin=Depends(get_current_admin)):
    result = await db.users.delete_one({"user_id": user_id, "role": {"$in": ["musteri", "member"]}})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Üye bulunamadı")
    await db.user_sessions.delete_many({"user_id": user_id})
    return {"success": True}


# ---------------- Esnaf (tedarikçi hesabı) yönetimi ----------------
class StaffAssignInput(BaseModel):
    supplier_group: Optional[str] = None


def _yonetici_only(user: dict):
    if user.get("role") not in ("admin", "yonetici"):
        raise HTTPException(status_code=403, detail="Bu işlem için yönetici yetkisi gerekli")


@api_router.get("/admin/staff")
async def admin_list_staff(admin=Depends(get_current_admin)):
    _yonetici_only(admin)
    staff = await db.users.find(
        {"role": "esnaf"}, {"_id": 0, "password_hash": 0, "username": 0}
    ).sort("created_at", -1).to_list(500)
    return staff


@api_router.get("/admin/supplier-groups")
async def admin_supplier_groups(admin=Depends(get_current_admin)):
    """Tedarikçi (supplier_group) seçenekleri: SADECE katalog config'deki tedarikçiler.
    Eskiden ürünlerde kullanılan + suppliers koleksiyonu da birleştiriliyordu; bu yüzden
    silinmiş/eski tedarikçiler (Afro Sebze, Meyve, ...) listede görünmeye devam ediyordu.
    Artık yalnızca catalog_config.suppliers döndürülür ki yönetici listeyi tam kontrol etsin."""
    _yonetici_only(admin)
    cfg = await _read_catalog_config()
    groups = set()
    for g in (cfg.get("suppliers") or []):
        if g:
            groups.add(g)
    return sorted(groups)


async def _assign_staff_by_identifier(identifier: str, supplier_group: Optional[str]):
    """identifier user_id veya telefon olabilir.
    supplier_group verilirse üyeyi esnaf yapar ve tedarikçiyi atar;
    boş/None verilirse esnaf yetkisini kaldırıp normal üyeye (musteri) döndürür."""
    ident = (identifier or "").strip()
    if not ident:
        raise HTTPException(status_code=400, detail="Telefon veya user_id girin")
    sg = (supplier_group or "").strip() or None
    user = await db.users.find_one({"$or": [{"user_id": ident}, {"phone": ident}]})
    if not user:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
    if user.get("role") in ("admin", "yonetici"):
        raise HTTPException(status_code=400, detail="Yönetici hesabı tedarikçi olarak atanamaz")
    new_role = "esnaf" if sg else "musteri"
    await db.users.update_one(
        {"user_id": user["user_id"]},
        {"$set": {"role": new_role, "supplier_group": sg}},
    )
    updated = await db.users.find_one(
        {"user_id": user["user_id"]}, {"_id": 0, "password_hash": 0, "username": 0}
    )
    return {"success": True, "user": _public_user_doc(updated)}


@api_router.put("/admin/staff/{user_id}")
async def admin_assign_staff(user_id: str, payload: StaffAssignInput, admin=Depends(get_current_admin)):
    _yonetici_only(admin)
    return await _assign_staff_by_identifier(user_id, payload.supplier_group)


class StaffAssignByIdInput(BaseModel):
    identifier: str
    supplier_group: Optional[str] = None


@api_router.post("/admin/staff/assign")
async def admin_assign_staff_post(payload: StaffAssignByIdInput, admin=Depends(get_current_admin)):
    _yonetici_only(admin)
    return await _assign_staff_by_identifier(payload.identifier, payload.supplier_group)


# ---------------------------------------------------------------------
# Resim yukleme (urun / kampanya panelleri kamera veya galeri yuklemesi)
# Frontend blob'u FormData 'file' olarak /api/admin/upload'a POST eder.
# Buraya kadar endpoint yoktu -> yukleme basarisiz oluyor, urun/kampanya
# fotografi uygulanmiyordu. Dosyayi uploads/ klasorune kaydedip kalici
# URL (/uploads/<ad>) donuyoruz. Bu URL nginx tarafindan servis edilir.
# ---------------------------------------------------------------------
_UPLOAD_EXT_BY_CTYPE = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/heic": ".jpg",
    "image/heif": ".jpg",
}
_UPLOAD_MAX_BYTES = 12 * 1024 * 1024  # 12 MB


@api_router.post("/admin/upload")
async def admin_upload_image(file: UploadFile = File(...), admin=Depends(get_current_admin)):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Bos dosya")
    if len(content) > _UPLOAD_MAX_BYTES:
        raise HTTPException(status_code=400, detail="Dosya cok buyuk (en fazla 12 MB)")

    ctype = (file.content_type or "").lower().strip()
    ext = _UPLOAD_EXT_BY_CTYPE.get(ctype)
    if not ext:
        name = (file.filename or "").lower()
        for e in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
            if name.endswith(e):
                ext = ".jpg" if e == ".jpeg" else e
                break
    if not ext:
        ext = ".jpg"

    uploads_dir = ROOT_DIR / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    fname = f"{uuid.uuid4().hex}{ext}"
    (uploads_dir / fname).write_bytes(content)
    return {"url": f"/uploads/{fname}"}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------- Startup: indexes + seed ----------------
@app.on_event("startup")
async def startup():
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.products.create_index("id", unique=True)

    # Seed admin
    admin = await db.users.find_one({"role": "admin"})
    if not admin:
        await db.users.insert_one({
            "user_id": new_id("admin"),
            "name": "Pazar Yöneticisi",
            "email": None,
            "phone": None,
            "picture": None,
            "role": "admin",
            "auth_type": "admin",
            "username": "admin",
            "password_hash": hash_password("pazar2026"),
            "created_at": now_utc(),
        })
        logger.info("Seeded admin account")

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

# ============================================================
# SUPPLIER ENDPOINTS — eklenecek blok
# ============================================================

class SupplierInput(BaseModel):
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    market_ids: Optional[List[str]] = []
    notes: Optional[str] = None
    is_active: Optional[bool] = True

class Supplier(SupplierInput):
    id: str
    created_at: Optional[str] = None

# ---------- Admin: Tedarikçi listesi ----------
@app.get("/api/admin/suppliers")
async def admin_get_suppliers(current_admin: dict = Depends(get_current_staff)):
    suppliers = []
    async for s in db.suppliers.find():
        s["id"] = str(s["_id"])
        s.pop("_id", None)
        suppliers.append(s)
    return suppliers

# ---------- Admin: Yeni tedarikçi ekle ----------
@app.post("/api/admin/suppliers")
async def admin_create_supplier(data: SupplierInput, current_admin: dict = Depends(get_current_admin)):
    from datetime import datetime
    doc = data.dict()
    doc["created_at"] = datetime.utcnow().isoformat()
    result = await db.suppliers.insert_one(doc)
    doc["id"] = str(result.inserted_id)
    doc.pop("_id", None)
    return doc

# ---------- Admin: Tedarikçi güncelle ----------
@app.put("/api/admin/suppliers/{supplier_id}")
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
@app.delete("/api/admin/suppliers/{supplier_id}")
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
@app.get("/api/suppliers")
async def get_suppliers():
    suppliers = []
    async for s in db.suppliers.find({"is_active": True}):
        s["id"] = str(s["_id"])
        s.pop("_id", None)
        suppliers.append(s)
    return suppliers



# ---------- Catalog Config ----------
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

async def _read_catalog_config():
    config = await db.catalog_config.find_one({}, {"_id": 0})
    return config if config else DEFAULT_CATALOG_CONFIG

async def _write_catalog_config(data: dict):
    await db.catalog_config.update_one({}, {"$set": data}, upsert=True)
    return await _read_catalog_config()

@app.get("/api/catalog-config")
async def get_catalog_config():
    return await _read_catalog_config()

@app.get("/api/admin/catalog-config")
async def admin_get_catalog_config(current_admin: dict = Depends(get_current_staff)):
    return await _read_catalog_config()

@app.put("/api/catalog-config")
async def update_catalog_config(data: dict, current_admin: dict = Depends(get_current_admin)):
    return await _write_catalog_config(data)

@app.put("/api/admin/catalog-config")
async def admin_update_catalog_config(data: dict, current_admin: dict = Depends(get_current_admin)):
    return await _write_catalog_config(data)



# ---------------- Restored admin read endpoints (orders / complaints / issues / visits) ----------------
def _order_date_filter(filter_type: str):
    now = now_utc()
    if filter_type == "today":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif filter_type == "last_7_days":
        start = now - timedelta(days=7)
    elif filter_type == "last_1_month":
        start = now - timedelta(days=30)
    else:
        return {}
    return {"created_at": {"$gte": start}}


@app.get("/api/admin/orders")
async def admin_list_orders(filter_type: str = "all_time", current_admin: dict = Depends(get_current_admin)):
    q = _order_date_filter(filter_type)
    return await db.transactions.find(q, {"_id": 0}).sort("created_at", -1).to_list(3000)


@app.get("/api/admin/orders/{tx_id}")
async def admin_get_order(tx_id: str, current_admin: dict = Depends(get_current_admin)):
    order = await db.transactions.find_one({"tx_id": tx_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Sipariş bulunamadı")
    return order


@app.put("/api/admin/orders/{tx_id}")
async def admin_update_order(tx_id: str, data: dict, current_admin: dict = Depends(get_current_admin)):
    allowed = {
        "order_status", "payment_status", "admin_note", "delivery_code",
        "delivered_at", "cancel_reason", "refund_status", "refund_amount"
    }
    updates = {k: v for k, v in data.items() if k in allowed}
    if not updates:
        raise HTTPException(status_code=400, detail="Güncellenecek alan bulunamadı")

    existing_order = await db.transactions.find_one({"tx_id": tx_id}, {"_id": 0})
    if not existing_order:
        raise HTTPException(status_code=404, detail="Sipariş bulunamadı")

    updates["updated_at"] = now_utc()
    if updates.get("order_status") == "teslim_edildi":
        if not updates.get("delivered_at"):
            updates["delivered_at"] = now_utc()
        # Teslim edilen sipariş ödemesi otomatik "ödendi" (iade edilmemişse)
        cur_pay = str(existing_order.get("payment_status") or "").strip().lower()
        if "payment_status" not in updates and cur_pay not in ("paid", "iade_edildi", "kismi_iade_edildi"):
            updates["payment_status"] = "paid"

    ready_statuses = {"hazir", "hazır", "ready"}
    new_status = str(updates.get("order_status") or "").strip().lower()
    old_status = str(existing_order.get("order_status") or "").strip().lower()
    delivery_sms_sent = None

    if new_status in ready_statuses and old_status not in ready_statuses:
        delivery_code = str(updates.get("delivery_code") or existing_order.get("delivery_code") or _generate_sms_code())
        delivery_expires_at = datetime.now().replace(hour=23, minute=59, second=0, microsecond=0)
        updates["delivery_code"] = delivery_code
        updates["delivery_code_expires_at"] = delivery_expires_at
        user_phone = None
        if existing_order.get("user_id"):
            user_doc = await db.users.find_one({"user_id": existing_order.get("user_id")}, {"_id": 0, "phone": 1})
            user_phone = (user_doc or {}).get("phone")
        if not user_phone:
            user_phone = existing_order.get("phone") or existing_order.get("customer_phone")
        delivery_sms_sent = send_delivery_sms(user_phone, tx_id, delivery_code) if user_phone else False
        updates["delivery_sms_sent"] = delivery_sms_sent
        updates["delivery_sms_sent_at"] = now_utc() if delivery_sms_sent else None

    result = await db.transactions.update_one({"tx_id": tx_id}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Sipariş bulunamadı")
    await db.orders.update_one({"$or": [{"tx_id": tx_id}, {"order_id": tx_id}]}, {"$set": updates})
    await db.order_status_logs.insert_one({
        "id": new_id("olog"),
        "tx_id": tx_id,
        "updates": updates,
        "delivery_sms_sent": delivery_sms_sent,
        "admin_user_id": current_admin.get("user_id"),
        "admin_name": current_admin.get("name"),
        "created_at": now_utc(),
    })
    return await db.transactions.find_one({"tx_id": tx_id}, {"_id": 0})


@app.get("/api/admin/complaints")
async def admin_list_complaints(current_admin: dict = Depends(get_current_admin)):
    return await db.complaints.find({}, {"_id": 0}).sort("created_at", -1).to_list(3000)


@app.put("/api/admin/complaints/{complaint_id}")
async def admin_update_complaint(complaint_id: str, data: dict, current_admin: dict = Depends(get_current_admin)):
    updates = {k: v for k, v in data.items() if k in ("status", "admin_response")}
    updates["updated_at"] = now_utc()
    result = await db.complaints.update_one({"id": complaint_id}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı")
    return await db.complaints.find_one({"id": complaint_id}, {"_id": 0})


@app.delete("/api/admin/complaints/{complaint_id}")
async def admin_delete_complaint(complaint_id: str, current_admin: dict = Depends(get_current_admin)):
    result = await db.complaints.delete_one({"id": complaint_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı")
    return {"success": True}


@app.get("/api/admin/issues")
async def admin_list_issues(current_admin: dict = Depends(get_current_admin)):
    return await db.order_issues.find({}, {"_id": 0}).sort("created_at", -1).to_list(3000)


@app.put("/api/admin/issues/{issue_id}")
async def admin_update_issue(issue_id: str, data: dict, current_admin: dict = Depends(get_current_admin)):
    updates = {k: v for k, v in data.items() if k in ("status", "admin_note")}
    updates["updated_at"] = now_utc()
    result = await db.order_issues.update_one({"id": issue_id}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı")
    return await db.order_issues.find_one({"id": issue_id}, {"_id": 0})


@app.get("/api/admin/visits/report")
async def admin_visits_report(current_admin: dict = Depends(get_current_admin)):
    pipeline = [
        {"$group": {"_id": "$date", "count": {"$sum": 1}}},
        {"$sort": {"_id": -1}},
    ]
    rows = await db.daily_visits.aggregate(pipeline).to_list(2000)
    return [{"date": r["_id"], "count": r["count"]} for r in rows if r.get("_id")]

# ---------------- Abacus patch: frontend compatibility endpoints (2026-07-27) ----------------
@app.get("/api/settings")
async def compat_get_settings():
    settings = await db.settings.find_one({"id": "global_settings"}, {"_id": 0})
    if not settings:
        settings = await db.settings.find_one({}, {"_id": 0})
    return settings or {}

@app.put("/api/admin/settings")
async def compat_update_admin_settings(data: dict, current_admin: dict = Depends(get_current_admin)):
    data = {k: v for k, v in data.items() if k != "_id"}
    data["id"] = data.get("id", "global_settings")
    data["updated_at"] = now_utc()
    await db.settings.update_one({"id": "global_settings"}, {"$set": data}, upsert=True)
    return {"success": True, "settings": await db.settings.find_one({"id": "global_settings"}, {"_id": 0})}

@app.get("/api/orders")
async def compat_list_my_orders(current_user: dict = Depends(get_current_user)):
    return await db.transactions.find({"user_id": current_user.get("user_id")}, {"_id": 0}).sort("created_at", -1).to_list(1000)

@app.get("/api/admin/legal-docs")
async def compat_admin_legal_docs(current_admin: dict = Depends(get_current_admin)):
    return await db.legal_documents.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)

@app.get("/api/admin/sms/config")
async def compat_admin_sms_config(current_admin: dict = Depends(get_current_admin)):
    cfg = await db.sms_config.find_one({}, {"_id": 0, "password": 0, "api_key": 0, "token": 0})
    if not cfg:
        cfg = {
            "provider": "verimor",
            "enabled": False,
            "configured": False,
            "message": "SMS sağlayıcı kimlik bilgisi mevcut değil; endpoint aktif ancak gerçek SMS gönderimi için Verimor ayarları girilmeli."
        }
    return cfg

@app.get("/api/admin/logs/actions")
async def compat_admin_action_logs(limit: int = 200, current_admin: dict = Depends(get_current_admin)):
    limit = max(1, min(int(limit or 200), 1000))
    rows = await db.admin_action_logs.find({}, {"_id": 0}).sort("timestamp", -1).to_list(limit)
    return _compat_json_clean(rows)

@app.get("/api/admin/logs/security")
async def compat_admin_security_logs(limit: int = 200, current_admin: dict = Depends(get_current_admin)):
    limit = max(1, min(int(limit or 200), 1000))
    rows = await db.security_logs.find({}, {"_id": 0}).sort("timestamp", -1).to_list(limit)
    return _compat_json_clean(rows)

async def _record_visit(request_data: dict | None = None):
    today = now_utc().date().isoformat()
    doc = {
        "id": new_id("visit"),
        "date": today,
        "created_at": now_utc(),
        "payload": request_data or {},
    }
    await db.daily_visits.insert_one(doc)
    return {"success": True, "date": today}


# ---------------- Payment / order compatibility endpoints ----------------
def _mask_phone(phone: str | None) -> str | None:
    phone = str(phone or "")
    if len(phone) < 6:
        return phone or None
    return phone[:4] + "****" + phone[-2:]


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
    Döner: (secili_liste, toplam_ek_ucret, not_metni)
    """
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
        # Ürün tanımında bu grup+seçeneği bul, yetkili fiyat farkını al
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


async def _prepare_order_payload(data: dict, current_user: dict) -> dict:
    delivery_type = _normalize_delivery_type(data)
    payment_method = _normalize_payment_method(data)
    items_in = data.get("items") or data.get("cart_items") or []
    if not isinstance(items_in, list) or not items_in:
        raise HTTPException(status_code=400, detail="Sepet boş")

    items = []
    subtotal = 0.0
    for raw in items_in:
        product_id = raw.get("id") or raw.get("product_id")
        qty = _as_float(raw.get("qty", raw.get("quantity", 1)), 1)
        if qty <= 0:
            raise HTTPException(status_code=400, detail="Ürün miktarı geçersiz")
        product = await db.products.find_one({"id": product_id}, {"_id": 0}) if product_id else None
        price_type = "gel_al_price" if delivery_type == "gel_al" else "eve_servis_price"
        price = raw.get("price")
        if product:
            price = product.get(price_type) if product.get(price_type) is not None else product.get("price", price)
            if not product.get("active", True) or product.get("hidden", False) or not product.get("in_stock", True):
                raise HTTPException(status_code=400, detail=f"{product.get('name', 'Ürün')} şu anda satışa uygun değil")
        price = _as_float(price, 0)
        # Özelleştirme seçeneklerini ürün tanımına göre doğrula ve ek ücreti hesapla
        sel_options, options_fee_unit, cust_note = _resolve_selected_options(product, raw)
        # Ek ücret (seçme/hizmet bedeli) birim başına; kilo/adet ile çarpılır.
        # İndirim yalnızca ürün fiyatına uygulanır; seçme bedeline indirim uygulanmaz.
        options_fee = round(options_fee_unit * qty, 2)
        line_total = round(price * qty + options_fee, 2)
        subtotal += line_total
        items.append({
            "id": product_id,
            "name": raw.get("name") or (product or {}).get("name") or "Ürün",
            "qty": qty,
            "quantity": qty,
            "price": price,
            "unit": raw.get("unit") or (product or {}).get("unit"),
            "selected_options": sel_options,
            "options_fee_unit": options_fee_unit,
            "options_fee": options_fee,
            "customization_note": cust_note,
            "total_price": line_total,
            "line_total": line_total,
            "unit_price_snapshot": price,
            "price_type": price_type,
            "product_name_snapshot": (product or {}).get("name") or raw.get("name"),
            "category_snapshot": (product or {}).get("category"),
            "supplier_group_snapshot": (product or {}).get("supplier_group"),
            "unit_snapshot": (product or {}).get("unit") or raw.get("unit"),
            "quality_snapshot": (product or {}).get("quality"),
        })

    # Güvenlik: müşteri tarafının gönderdiği amount/subtotal değerine güvenme;
    # toplamı backend, ürün fiyatları ve miktarlar üzerinden hesaplar.
    subtotal = round(subtotal, 2)
    discount = round(_as_float(data.get("discount"), 0), 2)
    delivery_fee = round(_as_float(data.get("delivery_fee"), 0), 2)
    amount = round(max(0, subtotal + delivery_fee - discount), 2)

    settings = await db.settings.find_one({"id": "global_settings"}, {"_id": 0}) or {}
    min_amount = _as_float(settings.get("min_pickup_amount" if delivery_type == "gel_al" else "min_delivery_amount"), 0)
    if amount < min_amount:
        raise HTTPException(status_code=400, detail=f"Minimum sipariş tutarı: {min_amount:.0f}₺")

    if delivery_type == "eve_servis" and not _clean_text(data.get("address")):
        raise HTTPException(status_code=400, detail="Eve servis siparişi için teslimat adresi zorunludur")

    if payment_method in ("cash_on_delivery", "pay_at_counter") and settings.get("cash_payment_limit_enabled"):
        max_cash = _as_float(settings.get("cash_payment_max_amount"), 0)
        if max_cash > 0 and amount > max_cash:
            raise HTTPException(status_code=400, detail=f"Bu tutar için yalnızca online ödeme kabul edilir. Nakit/tezgah ödeme limiti: {max_cash:.0f}₺")

    tx_id = new_id("tx")
    order = {
        "tx_id": tx_id,
        "user_id": current_user.get("user_id"),
        "user_name": current_user.get("name"),
        "user_phone": _mask_phone(current_user.get("phone")),
        "amount": amount,
        "subtotal": subtotal,
        "delivery_fee": delivery_fee,
        "discount": discount,
        "status": "pending",
        "order_status": "hazirlik_bekliyor",
        "payment_status": "pending" if payment_method == "online_card" else "unpaid",
        "payment_method": payment_method,
        "delivery_method": "pickup" if delivery_type == "gel_al" else "home_delivery",
        "delivery_type": delivery_type,
        "items": items,
        "coupon_code": data.get("coupon_code"),
        "address": data.get("address") or ("Tezgah" if delivery_type == "gel_al" else ""),
        "delivery_neighborhood": data.get("delivery_neighborhood") or "",
        "market_id": data.get("market_id") or data.get("stall_id"),
        "stall_id": data.get("stall_id") or data.get("market_id"),
        "pickup_time": data.get("pickup_time") or None,
        "delivery_slot_start": data.get("delivery_slot_start") or None,
        "delivery_slot_end": data.get("delivery_slot_end") or None,
        "document_acceptances": data.get("document_acceptances") or [],
        "agreements_accepted": bool(data.get("agreements_accepted") or data.get("legal_accepted")),
        "agreements_versions": data.get("agreements_versions") or {},
        "delivery_note": (data.get("delivery_note") or "")[:500],
        "no_bell": bool(data.get("no_bell")),
        "leave_at_door": bool(data.get("leave_at_door")) if payment_method == "online_card" else False,
        "created_at": now_utc(),
        "updated_at": now_utc(),
    }
    return order


def _paytr_keys_status() -> dict:
    return {
        "merchant_id": bool(os.getenv("PAYTR_MERCHANT_ID") or os.getenv("merchant_id")),
        "merchant_key": bool(os.getenv("PAYTR_MERCHANT_KEY") or os.getenv("merchant_key")),
        "merchant_salt": bool(os.getenv("PAYTR_MERCHANT_SALT") or os.getenv("merchant_salt")),
    }


def _clean_paytr_oid(value: str) -> str:
    cleaned = "".join(ch for ch in str(value or "") if ch.isalnum())
    return (cleaned[:64] if cleaned else uuid.uuid4().hex[:16])


async def _init_paytr_token(order: dict, request: Request, user_email: str | None = None) -> dict:
    merchant_id = os.getenv("PAYTR_MERCHANT_ID") or os.getenv("merchant_id")
    merchant_key = os.getenv("PAYTR_MERCHANT_KEY") or os.getenv("merchant_key")
    merchant_salt = os.getenv("PAYTR_MERCHANT_SALT") or os.getenv("merchant_salt")
    if not merchant_id or not merchant_key or not merchant_salt:
        return {"success": False, "configured": False, "message": "PayTR merchant_id / merchant_key / merchant_salt ayarları eksik"}

    email = user_email or f"{order.get('user_id')}@afrogida.local"
    user_ip = request.client.host if request and request.client else "127.0.0.1"
    merchant_oid = _clean_paytr_oid(order.get("merchant_oid") or order.get("tx_id") or new_id("tx"))
    order["merchant_oid"] = merchant_oid
    payment_amount = str(int(round(float(order.get("amount", 0)) * 100)))
    basket = [[i.get("name") or "Ürün", f"{float(i.get('line_total') or i.get('total_price') or 0):.2f}", int(max(1, round(float(i.get("qty") or i.get("quantity") or 1))))] for i in order.get("items", [])]
    user_basket = base64.b64encode(json.dumps(basket, ensure_ascii=False).encode()).decode()
    no_installment = "0"
    max_installment = "0"
    currency = "TL"
    test_mode = os.getenv("PAYTR_TEST_MODE", "1")
    hash_str = merchant_id + user_ip + merchant_oid + email + payment_amount + user_basket + no_installment + max_installment + currency + test_mode + merchant_salt
    paytr_token = base64.b64encode(hmac.new(merchant_key.encode(), hash_str.encode(), hashlib.sha256).digest()).decode()
    payload = {
        "merchant_id": merchant_id,
        "user_ip": user_ip,
        "merchant_oid": merchant_oid,
        "email": email,
        "payment_amount": payment_amount,
        "paytr_token": paytr_token,
        "user_basket": user_basket,
        "debug_on": os.getenv("PAYTR_DEBUG_ON", "1"),
        "no_installment": no_installment,
        "max_installment": max_installment,
        "user_name": order.get("user_name") or "Afro Gıda Müşteri",
        "user_address": order.get("address") or "Bursa",
        "user_phone": str(order.get("user_phone") or ""),
        "merchant_ok_url": os.getenv("PAYTR_OK_URL", "https://afrogida.com.tr/my-orders"),
        "merchant_fail_url": os.getenv("PAYTR_FAIL_URL", "https://afrogida.com.tr/cart"),
        "timeout_limit": os.getenv("PAYTR_TIMEOUT_LIMIT", "30"),
        "currency": currency,
        "test_mode": test_mode,
        "lang": "tr",
    }
    async with httpx.AsyncClient(timeout=20) as http:
        resp = await http.post("https://www.paytr.com/odeme/api/get-token", data=payload)
    try:
        result = resp.json()
    except Exception:
        return {"success": False, "configured": True, "message": "PayTR yanıtı okunamadı", "status_code": resp.status_code}
    if result.get("status") == "success" and result.get("token"):
        return {"success": True, "configured": True, "merchant_oid": merchant_oid, "token": result["token"], "payment_url": f"https://www.paytr.com/odeme/guvenli/{result['token']}"}
    return {"success": False, "configured": True, "merchant_oid": merchant_oid, "message": result.get("reason") or "PayTR token alınamadı", "paytr_response": result}


@app.post("/api/orders")
async def compat_create_order(data: dict, current_user: dict = Depends(get_current_user)):
    order = await _prepare_order_payload(data, current_user)
    await db.transactions.insert_one(order)
    return {"success": True, "tx_id": order["tx_id"], "order": _compat_json_clean(order)}


@app.post("/api/payments/init")
async def compat_payments_init(data: dict, request: Request, current_user: dict = Depends(get_current_user)):
    order = await _prepare_order_payload(data, current_user)
    await db.transactions.insert_one(order)
    if order["payment_method"] != "online_card":
        return {"success": True, "tx_id": order["tx_id"], "order": _compat_json_clean(order)}
    paytr = await _init_paytr_token(order, request, current_user.get("email"))
    await db.transactions.update_one({"tx_id": order["tx_id"]}, {"$set": {"merchant_oid": paytr.get("merchant_oid"), "paytr_init": paytr, "updated_at": now_utc()}})
    if not paytr.get("success"):
        raise HTTPException(status_code=503 if not paytr.get("configured") else 400, detail=paytr.get("message") or "PayTR ödeme başlatılamadı")
    return {"success": True, "tx_id": order["tx_id"], "payment_url": paytr.get("payment_url"), "token": paytr.get("token")}



@app.post("/api/payment/paytr/iframe-token")
async def get_paytr_iframe_token(data: dict, request: Request, current_user: dict | None = Depends(get_optional_user)):
    """PayTR iFrame token oluşturur. Oturum varsa müşteri bilgileri kullanılır; yoksa test/uyumluluk amaçlı gövdeden gelen bilgiler kullanılır."""
    keys = _paytr_keys_status()
    if not all(keys.values()):
        return {"success": False, "configured": False, "keys": keys, "message": "PayTR API anahtarları backend .env içinde tanımlı değil"}

    merchant_oid = str(data.get("order_id") or data.get("merchant_oid") or new_id("tx"))
    amount = _as_float(data.get("amount"), 0)
    raw_basket = data.get("basket") or data.get("items") or []
    items = []
    for item in raw_basket:
        qty = _as_float(item.get("qty") or item.get("quantity"), 1)
        price = _as_float(item.get("price") or item.get("unit_price") or item.get("line_total") or item.get("total_price"), 0)
        items.append({
            "name": str(item.get("name") or item.get("product_name") or "Ürün"),
            "qty": qty,
            "line_total": price * qty if not item.get("line_total") and not item.get("total_price") else price,
        })
    if not items:
        items = [{"name": "Test Ürün", "qty": 1, "line_total": amount}]

    user = current_user or {}
    order = {
        "tx_id": merchant_oid,
        "merchant_oid": merchant_oid,
        "amount": amount,
        "user_id": user.get("user_id") or "paytr_test",
        "user_name": data.get("user_name") or user.get("name") or "Afro Gıda Müşteri",
        "user_phone": data.get("user_phone") or user.get("phone") or "+905380557577",
        "address": data.get("user_address") or data.get("address") or "Bursa",
        "items": items,
    }
    email = data.get("email") or data.get("user_email") or user.get("email") or "musteri@afrogida.com.tr"
    paytr = await _init_paytr_token(order, request, email)
    if paytr.get("success"):
        paytr_merchant_oid = paytr.get("merchant_oid") or merchant_oid
        await db.transactions.update_one(
            {"tx_id": merchant_oid},
            {"$setOnInsert": {"tx_id": merchant_oid, "created_at": now_utc()}, "$set": {"merchant_oid": paytr_merchant_oid, "amount": amount, "payment_method": "online_card", "payment_status": "pending", "paytr_init": paytr, "updated_at": now_utc()}},
            upsert=True,
        )
        return {"success": True, "token": paytr.get("token"), "iframe_url": paytr.get("payment_url"), "payment_url": paytr.get("payment_url")}
    raise HTTPException(status_code=503 if not paytr.get("configured") else 400, detail=paytr.get("message") or "PayTR token alınamadı")

@app.post("/api/payment/paytr/callback")
@app.post("/api/payments/paytr/callback")
async def paytr_callback(request: Request):
    from urllib.parse import parse_qs
    body = (await request.body()).decode("utf-8", errors="ignore")
    parsed = parse_qs(body, keep_blank_values=True)
    form_data = {k: (v[0] if isinstance(v, list) and v else "") for k, v in parsed.items()}
    merchant_oid = form_data.get("merchant_oid")
    status = form_data.get("status")
    total_amount = form_data.get("total_amount")
    hash_val = form_data.get("hash")

    merchant_key = os.getenv("PAYTR_MERCHANT_KEY") or os.getenv("merchant_key")
    merchant_salt = os.getenv("PAYTR_MERCHANT_SALT") or os.getenv("merchant_salt")
    if not merchant_key or not merchant_salt:
        return PlainTextResponse("PAYTR_CONFIG_MISSING")
    if not merchant_oid or not status or not total_amount or not hash_val:
        return PlainTextResponse("PAYTR_MISSING_FIELDS")

    hash_str = f"{merchant_oid}{merchant_salt}{status}{total_amount}"
    expected = base64.b64encode(hmac.new(merchant_key.encode(), hash_str.encode(), hashlib.sha256).digest()).decode()
    if hash_val != expected:
        return PlainTextResponse("PAYTR_HASH_MISMATCH")

    update = {
        "paytr_callback": dict(form_data),
        "paytr_total_amount": total_amount,
        "updated_at": now_utc(),
    }
    if status == "success":
        update.update({"payment_status": "paid", "status": "confirmed", "order_status": "hazirlik_bekliyor"})
    else:
        update.update({"payment_status": "failed", "status": "payment_failed", "paytr_failed_reason": form_data.get("failed_reason_msg") or form_data.get("failed_reason_code")})

    await db.transactions.update_one({"$or": [{"merchant_oid": merchant_oid}, {"tx_id": merchant_oid}]}, {"$set": update})
    await db.orders.update_one({"$or": [{"merchant_oid": merchant_oid}, {"tx_id": merchant_oid}, {"order_id": merchant_oid}]}, {"$set": update})
    return PlainTextResponse("OK")

@app.post("/api/payment/paytr")
async def compat_payment_paytr(data: dict, request: Request):
    keys = _paytr_keys_status()
    if not all(keys.values()):
        return {"success": False, "configured": False, "keys": keys, "message": "PayTR API anahtarları backend .env içinde tanımlı değil"}
    order = {
        "tx_id": str(data.get("order_id") or new_id("tx")),
        "amount": _as_float(data.get("amount"), 0),
        "user_id": "paytr_test",
        "user_name": data.get("user_name") or "Test Kullanıcı",
        "user_phone": data.get("user_phone") or "+905380557577",
        "address": data.get("user_address") or "Bursa",
        "items": [{"name": "Test Sipariş", "line_total": _as_float(data.get("amount"), 0), "qty": 1}],
    }
    paytr = await _init_paytr_token(order, request, data.get("user_email"))
    return {"success": bool(paytr.get("success")), "configured": True, **paytr}

@app.get("/api/visit")
async def compat_get_visit():
    return await _record_visit({"method": "GET"})

@app.post("/api/visit")
async def compat_post_visit(data: dict = None):
    return await _record_visit(data or {"method": "POST"})

@app.post("/api/auth/send-phone-otp")
async def compat_send_phone_otp(data: dict):
    phone = str(data.get("phone") or data.get("phone_number") or "").strip()
    purpose = str(data.get("purpose") or "registration").strip() or "registration"
    if len(phone) < 7:
        raise HTTPException(status_code=400, detail="Geçerli telefon numarası gerekli")
    code = _generate_sms_code()
    expires_at = now_utc() + timedelta(minutes=5)
    await db.otp_codes.delete_many({"phone": phone, "purpose": purpose})
    await db.otp_codes.insert_one({
        "phone": phone,
        "purpose": purpose,
        "code": code,
        "created_at": now_utc(),
        "expires_at": expires_at,
        "used": False,
    })
    message = f"Afro Gida dogrulama kodunuz: {code}\nKod 5 dakika gecerlidir."
    sms_sent = send_sms_verimor(phone, message)
    await db.otp_requests_log.insert_one({
        "phone": phone,
        "purpose": purpose,
        "requested_at": now_utc(),
        "sms_sent": sms_sent,
        "sms_provider": "verimor",
        "expires_at": expires_at,
    })
    return {"success": True, "sms_sent": sms_sent, "expires_in": 300}


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
