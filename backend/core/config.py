"""Ortam değişkenleri ve uygulama sabitleri.

server.py ve diğer modüller bu değerleri buradan okur. `.env` yüklemesi de
burada, ilk import anında yapılır.
"""
import os
import hashlib
import logging
from pathlib import Path

from dotenv import load_dotenv

logger = logging.getLogger("afro.config")

# backend/  (bu dosya backend/core/config.py)
ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")

# ---------------- Genel ----------------
EMERGENT_SESSION_API = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"
SESSION_DURATION_DAYS = 7

# Uygulamada sekme olarak gösterilen sabit, sıralı ürün kategorileri
ORDERED_CATEGORIES = ["Domates", "Salata", "Kabak", "Patlıcan", "Biber", "Fasulye & Bakliyat", "Çeşitler"]
PRODUCT_SEED_VERSION = 2

# Her yeni üyeye kayıtta otomatik verilen hoş geldin kuponu
WELCOME_DISCOUNT_AMOUNT = 50.0   # TL
WELCOME_MIN_AMOUNT = 500.0       # TL

# catalog_config bellek içi önbellek TTL'i (saniye)
CATALOG_CACHE_TTL = 60

# ---------------- Güvenlik anahtarları / telefonları ----------------
def _afro_key_material(env_name: str, purpose: str) -> str:
    """Anahtar .env'den okunur. Yoksa (acil durum) PayTR anahtarlarından
    deterministik türetilir ki 3 uvicorn worker aynı anahtarı kullansın."""
    val = (os.environ.get(env_name) or "").strip()
    if val:
        return val
    logger.warning("[GÜVENLİK] %s .env içinde yok, türetilmiş anahtar kullanılıyor", env_name)
    seed = (os.environ.get("PAYTR_MERCHANT_SALT", "") + "|"
            + os.environ.get("PAYTR_MERCHANT_KEY", "") + "|" + purpose).encode("utf-8")
    return hashlib.sha256(seed).hexdigest()


AFRO_SECRET_KEY = _afro_key_material("AFRO_SECRET_KEY", "afro-hmac-v1")
_AFRO_ENC_RAW = _afro_key_material("AFRO_ENC_KEY", "afro-enc-v1")

SECURITY_ADMIN_PHONE = (os.environ.get("SECURITY_ADMIN_PHONE") or "05380557577").strip()
SECURITY_SMS_THROTTLE_MIN = int(os.environ.get("SECURITY_SMS_THROTTLE_MIN") or 10)
ADMIN_SESSION_HOURS = int(os.environ.get("ADMIN_SESSION_HOURS") or 12)
# Yönetici 2FA: kod HER girişte (cihazdan bağımsız) bu numaraya gider
ADMIN_2FA_PHONE = (os.environ.get("ADMIN_2FA_PHONE") or SECURITY_ADMIN_PHONE).strip()
ADMIN_2FA_TTL_SEC = int(os.environ.get("ADMIN_2FA_TTL_SEC") or 300)
ADMIN_2FA_MAX_ATTEMPTS = 5
# Yalnızca yerel geliştirme (bkz. run_dev_server.py): SMS bilgileri kasıtlı
# boş olduğu için Verimor'a gönderim başarısız olur; normalde (üretimde) bu
# durumda giriş 503 ile reddedilir (aşağıya bak). Bu bayrak SADECE dev
# sunucusunda '1' yapılır, .env.example'da yok, üretim .env'inde YOK —
# üretim davranışı bu bayrakla değişmez.
ADMIN_2FA_ALLOW_UNSENT_SMS = (os.environ.get("ADMIN_2FA_ALLOW_UNSENT_SMS") or "").strip().lower() in ("1", "true")

ENC_PREFIX = "enc:v1:"

# Sözleşme/belge kodu -> Türkçe ad. Sipariş sözleşme logunda ve admin log
# sekmelerinde ("Sözleşme Onayları") belge adını göstermek için kullanılır.
_AFRO_DOC_NAME_TR = {
    "kvkk": "KVKK Aydınlatma Metni",
    "privacy": "Gizlilik Politikası",
    "membership": "Üyelik Sözleşmesi",
    "refundComplaintPolicy": "İade ve Şikayet Politikası",
    "couponTerms": "Kupon Koşulları",
    "pickupTerms": "Gel-Al Koşulları",
    "homeDeliveryTerms": "Eve Servis Koşulları",
    "tedarikci_sozlesmesi": "Tedarikçi Sözleşmesi",
    "delivery_terms": "Eve Servis Koşulları",
    "home_delivery": "Eve Servis Koşulları",
    "eve-servis-mesafeli-sat-s-zle-mesi": "Eve Servis Mesafeli Satış Sözleşmesi",
    "pickup_terms": "Gel-Al Koşulları",
    "pickup": "Gel-Al Koşulları",
    "kvkk_aydinlatma": "KVKK Aydınlatma Metni",
    "gizlilik_politikasi": "Gizlilik Politikası",
    "uyelik_sozlesmesi": "Üyelik Sözleşmesi",
    "ticari_ileti_izni": "Ticari İleti İzni",
    "mesafeli_satis": "Mesafeli Satış Sözleşmesi",
    "on_bilgilendirme": "Ön Bilgilendirme Formu",
    "gel_al": "Gel-Al Koşulları",
}
