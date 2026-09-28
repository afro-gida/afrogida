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


def tr_title(value) -> str:
    """Boşlukları sadeleştirir; her kelimenin (ve tireyle ayrılan parçanın) ilk
    harfini büyütür, gerisini küçültür. Kesme işaretinden sonrası küçük kalır
    ("ali'nin" -> "Ali'nin")."""
    if value is None:
        return ""
    s = re.sub(r"\s+", " ", str(value)).strip()
    return " ".join("-".join(_cap(part) for part in word.split("-")) for word in s.split(" "))
