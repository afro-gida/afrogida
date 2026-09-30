"""Kupon son kullanma tarihleri.

Yönetim ekranı tarihi gün olarak girer ("2026-10-31"): kupon o günün SONUNA
kadar (Türkiye saatiyle 23:59:59) geçerlidir. Eskiden bu değer UTC gece
yarısı sayılıyordu, kupon son gününün sabahı 03:00'te bitiyordu.
"""
import re
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from core.util import now_utc

IST = ZoneInfo("Europe/Istanbul")
_DATE_ONLY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def expiry_of(value) -> Optional[datetime]:
    """valid_until -> son geçerli an (tz'li). Boş/bozuk -> None (süresiz)."""
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    s = str(value).strip()
    try:
        if _DATE_ONLY.match(s):
            d = date.fromisoformat(s)
            return datetime.combine(d, time(23, 59, 59), tzinfo=IST)
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def is_expired(value) -> bool:
    exp = expiry_of(value)
    return bool(exp and exp < now_utc())


def clean_date(value) -> Optional[str]:
    """Yönetimden gelen tarih ("YYYY-MM-DD" ya da boş). Geçmiş tarih reddedilir."""
    if value in (None, ""):
        return None
    s = str(value).strip()[:10]
    if not _DATE_ONLY.match(s):
        raise ValueError("Tarih YYYY-AA-GG biçiminde olmalı")
    if date.fromisoformat(s) < datetime.now(IST).date():
        raise ValueError("Son kullanma tarihi geçmiş bir gün olamaz")
    return s


def days_from_today(days) -> Optional[str]:
    """Bugünden (Türkiye) itibaren N gün sonrası "YYYY-MM-DD"; 0/boş -> süresiz."""
    try:
        n = int(days or 0)
    except (TypeError, ValueError):
        return None
    if n <= 0:
        return None
    return (datetime.now(IST).date() + timedelta(days=n)).isoformat()
