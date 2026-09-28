"""Ad / pazar / mahalle baş harf düzeltmesi (Türkçe i/İ, ı/I kuralıyla)."""
import pytest

from core.text import tr_title


@pytest.mark.parametrize("raw,expected", [
    ("görükle", "Görükle"),
    ("muhammet ali güngör", "Muhammet Ali Güngör"),
    ("  İSTANBUL   yolu ", "İstanbul Yolu"),
    ("ıspanak ILICA", "Ispanak Ilıca"),
    ("irfaniye", "İrfaniye"),
    ("30 ağustos zafer", "30 Ağustos Zafer"),
    ("hasan-ali öz", "Hasan-Ali Öz"),
    ("ali'nin tezgahı", "Ali'nin Tezgahı"),
    ("", ""),
    (None, ""),
])
def test_tr_title(raw, expected):
    assert tr_title(raw) == expected


def test_afro_norm_turkish_case_insensitive():
    from core.util import _afro_norm
    assert _afro_norm("TOKİ") == _afro_norm("Toki")
    assert _afro_norm("KIZILCIKLI") == _afro_norm("Kızılcıklı")
    assert _afro_norm(" İrfaniye ") == _afro_norm("irfaniye")


def test_market_save_normalizes_names_and_neighborhoods(client, make_user, db):
    _, h = make_user(role="admin")
    body = {"name": "nilüfer hasanağa", "day": "Cumartesi", "location": "hasanağa mah.",
            "delivery_neighborhoods": ["görükle", " GÖRÜKLE ", "kurtuluş", "irfaniye"]}
    r = client.post("/api/admin/markets", headers=h, json=body)
    assert r.status_code == 200, r.text
    m = r.json()
    try:
        assert m["name"] == "Nilüfer Hasanağa"
        assert m["location"] == "Hasanağa Mah."
        assert m["delivery_neighborhoods"] == ["Görükle", "Kurtuluş", "İrfaniye"]
        r = client.put(f"/api/admin/markets/{m['id']}", headers=h, json={**body, "name": "elmasbahçeler"})
        assert r.json()["name"] == "Elmasbahçeler"
    finally:
        db.markets.delete_one({"id": m["id"]})


def test_address_and_profile_names_normalized(client, make_user):
    _, h = make_user()
    r = client.post("/api/auth/addresses", headers=h, json={"neighborhood": "görükle", "street": "safran sokak", "building_no": "5"})
    assert r.status_code == 200, r.text
    a = r.json()["address"]
    assert (a["neighborhood"], a["street"]) == ("Görükle", "Safran Sokak")
    r = client.put("/api/auth/profile", headers=h, json={"name": "muhammet ali güngör"})
    assert r.status_code == 200, r.text
    assert client.get("/api/auth/me", headers=h).json()["name"] == "Muhammet Ali Güngör"
