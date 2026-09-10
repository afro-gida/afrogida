"""Küçük, bağımsız yardımcılar. Hiçbir şeye bağımlı değildir."""
import uuid
from datetime import datetime, timezone


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def to_aware(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _clean_text(value) -> str:
    return str(value or "").strip()


def _afro_norm(s) -> str:
    """Boşlukları kırp + küçük harfe indir (pazar/tedarikçi adı eşleştirmek için)."""
    try:
        return (s or "").strip().casefold()
    except Exception:
        return ""


def _norm_limit(value, default: int = 1) -> int:
    """Kullanım hakkı (limit) değerini pozitif tam sayıya normalize eder."""
    try:
        n = int(float(value))
    except (TypeError, ValueError):
        n = default
    return n if n >= 1 else 1
