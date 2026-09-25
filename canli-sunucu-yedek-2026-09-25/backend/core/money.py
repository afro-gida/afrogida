"""Kuruş hassasiyetli para hesabı — float yerine Decimal, kuruşa yuvarla."""
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation

_CENT = Decimal("0.01")
_MILLI = Decimal("0.001")


def D(value, default="0") -> Decimal:
    try:
        if value is None or value == "":
            return Decimal(default)
        if isinstance(value, bool):
            return Decimal(default)
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return Decimal(default)


def money(value) -> float:
    """Kuruşa (0.01) yuvarlanmış float (JSON uyumu için)."""
    return float(D(value).quantize(_CENT, rounding=ROUND_HALF_UP))


def money_d(value) -> Decimal:
    return D(value).quantize(_CENT, rounding=ROUND_HALF_UP)


def _num_close(a, b, tol="0.011") -> bool:
    return abs(D(a) - D(b)) <= Decimal(tol)
