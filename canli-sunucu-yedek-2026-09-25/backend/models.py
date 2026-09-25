"""Pydantic istek/yanıt modelleri.

server.py ve router'lar buradan import eder. Alan doğrulama ve varsayılanlar
burada; iş mantığı yok.
"""
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator

from core.util import new_id, now_utc


# ---------------- Auth ----------------
class GoogleSessionInput(BaseModel):
    session_id: str


class PhoneLoginInput(BaseModel):
    phone: str
    name: str


class RegisterInput(BaseModel):
    name: str
    phone: str
    password: Optional[str] = None
    otp_code: Optional[str] = None
    marketing_consent: Optional[bool] = None


class LoginInput(BaseModel):
    phone: str
    password: Optional[str] = None


class AdminLoginInput(BaseModel):
    username: str
    password: str


class Admin2FAVerifyInput(BaseModel):
    challenge_id: str
    code: str


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


# ---------------- Katalog: ürün / kampanya / kupon / market ----------------
class ProductInput(BaseModel):
    name: str
    category: str
    subcategory: Optional[str] = "Diğer"
    supplier_group: Optional[str] = "Zeytinci"
    price: Optional[float] = None
    gel_al_price: Optional[float] = 0
    eve_servis_price: Optional[float] = None
    # --- Tedarikçi çift fiyat sistemi (Faz 1) ---
    supplier_price: Optional[float] = 0          # tedarikçinin girdiği tezgah fiyatı
    sale_price: Optional[float] = None           # müşteriye satış fiyatı
    profit_margin_amount: Optional[float] = 0    # adminin belirlediği kâr tutarı
    price_updated_at: Optional[datetime] = None
    price_updated_by: Optional[str] = None       # "supplier" | "admin" | "migration"
    supplier_price_locked_until: Optional[datetime] = None
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
    customization_options: Optional[List[dict]] = None
    customization_note_enabled: Optional[bool] = False
    customization_note_label: Optional[str] = None

    # Form boş sayısal alanları "" olarak gönderebiliyor -> None'a çevir (422 önlem)
    @field_validator(
        "price", "gel_al_price", "eve_servis_price",
        "campaign_discount_percent", "campaign_min_qty",
        "supplier_price", "sale_price", "profit_margin_amount",
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
    discount_amount: Optional[float] = None  # sabit TL indirim; set ise percent'ten önceliklidir
    min_amount: float = 0
    members_only: bool = True
    assigned_user_ids: List[str] = Field(default_factory=list)
    assignments: List[dict] = Field(default_factory=list)
    per_user_limit: int = 1
    single_use: bool = False
    used: bool = False
    used_at: Optional[datetime] = None
    auto_issued: bool = False  # otomatik hoş geldin kuponu için True
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
    user_id: Optional[str] = None


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
    # Pazar bazlı Eve Servis / Gel-Al / ödeme ayarları (eskiden global_settings'te
    # tek/ortak bir kayıttı — artık her pazarın kendi ayarı var). services/orders.py
    # sipariş hazırlarken artık bunları okuyacak (bkz. CHANGES.md, Admin sistemi #1).
    eve_servis_urun_gorunurlugu: bool = True
    eve_servis_min_tutar: float = 0
    eve_servis_saati: str = "00:00-23:59"
    kapida_nakit_odeme_enabled: bool = True
    nakit_tezgah_limit_enabled: bool = False
    nakit_tezgah_maksimum_tutari: float = 0
    gel_al_min_tutar: float = 0
    teslimat_ucreti: float = 0
    ucretsiz_teslimat_alt_limiti: float = 0
    pazar_saati: str = "00:00-23:59"
    gel_al_saati: str = "00:00-23:59"
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
    eve_servis_urun_gorunurlugu: bool = True
    eve_servis_min_tutar: float = 0
    eve_servis_saati: str = "00:00-23:59"
    kapida_nakit_odeme_enabled: bool = True
    nakit_tezgah_limit_enabled: bool = False
    nakit_tezgah_maksimum_tutari: float = 0
    gel_al_min_tutar: float = 0
    teslimat_ucreti: float = 0
    ucretsiz_teslimat_alt_limiti: float = 0
    pazar_saati: str = "00:00-23:59"
    gel_al_saati: str = "00:00-23:59"


# ---------------- Üye / personel / kurye yönetimi ----------------
class MemberOut(BaseModel):
    user_id: str
    name: str = ""
    email: Optional[str] = None
    phone: Optional[str] = None
    picture: Optional[str] = None
    auth_type: Optional[str] = None
    role: Optional[str] = None
    supplier_name: Optional[str] = None
    created_at: Optional[datetime] = None


class MemberUpdateInput(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    is_restricted: Optional[bool] = None
    restriction_reason: Optional[str] = None
    restriction_until: Optional[str] = None


class StaffAssignInput(BaseModel):
    supplier_group: Optional[str] = None


class StaffAssignByIdInput(BaseModel):
    identifier: str
    supplier_group: Optional[str] = None


class CourierAssignInput(BaseModel):
    identifier: str
    courier_markets: Optional[List[str]] = None  # yeni çok-pazar
    courier_market: Optional[str] = None          # geriye uyumluluk (tek pazar)


class PazarSorumlusuAssignInput(BaseModel):
    """Pazar Sorumlusu ataması — role="pazar_sorumlusu" (DİKKAT: "yonetici"
    rolüyle KARIŞTIRILMAMALI, o zaten tam admin anlamına geliyor)."""
    identifier: str
    managed_markets: List[str] = []


# ---------------- Tedarikçi ----------------
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


class AfroSupplierPayMark(BaseModel):
    supplier_group: str
    date: str
    note: Optional[str] = None


class AfroSupplierPayConfirm(BaseModel):
    date: str
    code: str


class AfroSupplierContractInput(BaseModel):
    url: str
    version: str
    title: Optional[str] = "Tedarikçi Sözleşmesi"
