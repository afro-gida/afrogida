"""Resim yükleme (ürün/kampanya panelleri kamera veya galeri yüklemesi) —
otomatik EXIF düzeltme + küçültme + WebP optimizasyonu."""
import io
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from core.config import ROOT_DIR
from core.security import get_current_staff

router = APIRouter(prefix="/api")

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

# --- Otomatik gorsel optimizasyonu ------------------------------------
# Panelden yuklenen her fotograf, siteyi yormamasi icin sunucuda otomatik
# olarak: (1) EXIF donusune gore duzeltilir, (2) en uzun kenari
# _IMG_MAX_EDGE pikseli asiyorsa oranli kucultulur, (3) WebP formatina
# cevrilir (kalite _IMG_WEBP_QUALITY). Boylece 3-5 MB'lik telefon
# fotograflari ~20-60 KB'lik WebP'ye duser; 100-150 urunlu sayfa cok
# daha hizli acilir. Animasyonlu GIF ve PIL'in isleyemedigi dosyalar
# oldugu gibi (ham) kaydedilir; hata durumunda da sisteme zarar vermez.
_IMG_MAX_EDGE = 600            # en uzun kenar (px) - mobil kartlar icin optimize (detay korunur)
_IMG_WEBP_QUALITY = 78         # 0-100; 78 = detay korunur, dosya boyutu kucuk


def _optimize_to_webp(content: bytes):
    """Ham bayt -> optimize edilmis WebP bayt. Basarisizsa (None, None)."""
    try:
        from PIL import Image, ImageOps, ImageSequence  # lazy import
    except Exception:
        return None, None
    try:
        img = Image.open(io.BytesIO(content))
        # Animasyonlu GIF/WebP -> dokunma (kareler bozulmasin)
        n_frames = getattr(img, "n_frames", 1)
        if n_frames and n_frames > 1:
            return None, None
        # EXIF donus bilgisine gore dik cevir (telefon fotograflari)
        img = ImageOps.exif_transpose(img)
        # Renk modu: seffaflik varsa RGBA (WebP destekler), yoksa RGB
        if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
            img = img.convert("RGBA")
        else:
            img = img.convert("RGB")
        # Oranli kucultme (yalnizca buyukse)
        w, h = img.size
        longest = max(w, h)
        if longest > _IMG_MAX_EDGE:
            scale = _IMG_MAX_EDGE / float(longest)
            img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
        out = io.BytesIO()
        img.save(out, format="WEBP", quality=_IMG_WEBP_QUALITY, method=6)
        return out.getvalue(), ".webp"
    except Exception:
        return None, None


@router.post("/admin/upload")
async def admin_upload_image(file: UploadFile = File(...), staff=Depends(get_current_staff)):
    # Tedarikçiler (esnaf/supplier) de ürün resmi yükleyebilir. Bu endpoint yalnızca
    # dosyayı kaydedip URL döner; ürün sahiplik kontrolü update_product içinde yapılır.
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Bos dosya")
    if len(content) > _UPLOAD_MAX_BYTES:
        raise HTTPException(status_code=400, detail="Dosya cok buyuk (en fazla 12 MB)")

    # Once optimize etmeyi dene (yeniden boyutlandir + WebP'ye cevir)
    optimized, opt_ext = _optimize_to_webp(content)
    if optimized is not None:
        content = optimized
        ext = opt_ext
    else:
        # Optimizasyon yapilamadi (animasyon / desteklenmeyen / hata) -> ham kaydet
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
