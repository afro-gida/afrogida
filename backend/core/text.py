"""Türkçe metin düzeltme: ad, pazar adı, mahalle vb. baş harfleri büyük
("görükle" -> "Görükle", "muhammet ali güngör" -> "Muhammet Ali Güngör").

Python'un str.title()/upper() Türkçe i/İ ve ı/I ayrımını bilmez
("istanbul".title() == "Istanbul"), bu yüzden elle yapılır.
"""
import re


def tr_lower(s: str) -> str:
    return s.replace("I", "ı").replace("İ", "i").lower()


def tr_upper(s: str) -> str:
    return s.replace("i", "İ").replace("ı", "I").upper()


def _cap(word: str) -> str:
    return tr_upper(word[:1]) + tr_lower(word[1:]) if word else word


def _cap_keep_short_caps(word: str) -> str:
    # "XL", "S", "KG" gibi kısa büyük harfli kısaltmalar olduğu gibi kalır
    if word and len(word) <= 3 and word == tr_upper(word) and any(ch.isalpha() for ch in word):
        return word
    return _cap(word)


def tr_title_product(value) -> str:
    """Ürün adı ve seçenekler için baş harf düzeltme ("dolma bİBer" ->
    "Dolma Biber", "büyük boy" -> "Büyük Boy"); "XL" gibi kısaltmalar korunur."""
    if value is None:
        return ""
    s = re.sub(r"\s+", " ", str(value)).strip()
    return " ".join("-".join(_cap_keep_short_caps(p) for p in w.split("-")) for w in s.split(" "))


_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}$")


def normalize_email(value):
    """Geçerliyse küçük harfli e-posta, değilse None (e-Arşiv fatura için)."""
    s = str(value or "").strip().lower()
    if not s or len(s) > 254 or ".." in s or not _EMAIL_RE.match(s):
        return None
    return s


def tr_title(value) -> str:
    """Boşlukları sadeleştirir; her kelimenin (ve tireyle ayrılan parçanın) ilk
    harfini büyütür, gerisini küçültür. Kesme işaretinden sonrası küçük kalır
    ("ali'nin" -> "Ali'nin")."""
    if value is None:
        return ""
    s = re.sub(r"\s+", " ", str(value)).strip()
    return " ".join("-".join(_cap(part) for part in word.split("-")) for word in s.split(" "))
