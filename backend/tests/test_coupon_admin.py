"""Yönetim kupon sistemi: oluşturma denetimi, kişiye / herkese verme (kullanım
hakkı + son kullanma), yeni üye kuponu, gizlilik ve gün sonu geçerliliği."""
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from tests.test_coupons import _mk_coupon, _validate

IST = ZoneInfo("Europe/Istanbul")


def _day(offset: int) -> str:
    return (datetime.now(IST).date() + timedelta(days=offset)).isoformat()


def _payload(**over):
    p = {"code": f"K{uuid.uuid4().hex[:6].upper()}", "title": "Deneme Kuponu",
         "discount_percent": 10, "discount_amount": None, "min_amount": 0, "valid_until": None}
    p.update(over)
    return p


def test_create_validation(client, make_user, db):
    _, admin = make_user(role="yonetici")
    p = _payload(code=" yaz  indirim ")
    r = client.post("/api/admin/coupons", json=p, headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["code"] == "YAZINDIRIM"  # boşluksuz, büyük harf
    # aynı kod tekrar -> 400
    assert client.post("/api/admin/coupons", json=_payload(code="yazindirim"), headers=admin).status_code == 400
    # geçersiz yüzde, geçmiş tarih, bozuk tarih -> 400
    assert client.post("/api/admin/coupons", json=_payload(discount_percent=0), headers=admin).status_code == 400
    assert client.post("/api/admin/coupons", json=_payload(valid_until=_day(-1)), headers=admin).status_code == 400
    assert client.post("/api/admin/coupons", json=_payload(valid_until="31.12.2026"), headers=admin).status_code == 400
    # sabit tutarlı kupon: yüzde önemsiz
    r = client.post("/api/admin/coupons", json=_payload(discount_amount=50, discount_percent=0), headers=admin)
    assert r.status_code == 200 and r.json()["discount_amount"] == 50


def test_date_only_expiry_valid_until_end_of_day(client, make_user, db):
    _, h = make_user()
    today = _mk_coupon(db, valid_until=_day(0))
    assert _validate(client, h, today["code"], 100).status_code == 200  # bugün sonuna kadar geçerli
    past = _mk_coupon(db, valid_until=_day(-1))
    r = _validate(client, h, past["code"], 100)
    assert r.status_code == 400 and "süresi" in r.text
    # süresi dolan müşteri listesinde de görünmez
    codes = [c["code"] for c in client.get("/api/coupons", headers=h).json()]
    assert today["code"] in codes and past["code"] not in codes


def test_legacy_tr_date_format_expires(client, make_user, db):
    """Eski siteden kalma "GG.AA.YYYY…" tarihi tanınır: süresi geçmişse kupon
    kullanılamaz ve listede görünmez (eskiden süresiz sayılıyordu)."""
    from core.coupon_dates import expiry_of
    assert expiry_of("29.08.2026T23:59:59Z").date().isoformat() == "2026-08-29"
    _, h = make_user()
    old = _mk_coupon(db, valid_until="29.08.2020T23:59:59Z")
    assert _validate(client, h, old["code"], 100).status_code == 400
    assert old["code"] not in [c["code"] for c in client.get("/api/coupons", headers=h).json()]
    d = datetime.now(IST).date() + timedelta(days=3)
    ok = _mk_coupon(db, valid_until=d.strftime("%d.%m.%Y"))
    assert _validate(client, h, ok["code"], 100).status_code == 200


def test_assign_member_with_limit_and_expiry(client, make_user, db):
    uid, h = make_user()
    other_uid, other_h = make_user()
    _, admin = make_user(role="yonetici")
    c = _mk_coupon(db)
    body = {"coupon_id": c["id"], "user_id": uid, "limit": 2, "valid_until": _day(5)}
    assert client.post("/api/admin/coupons/assign-member", json=body, headers=admin).status_code == 200
    client.post("/api/admin/coupons/assign-member", json={**body, "user_id": other_uid}, headers=admin)
    a = next(x for x in db.coupons.find_one({"id": c["id"]})["assignments"] if x["user_id"] == uid)
    assert a["limit"] == 2 and a["valid_until"] == _day(5)

    # GİZLİLİK: müşteri listesinde sadece kendi hakkı, diğer üyenin kimliği yok
    mine = next(x for x in client.get("/api/coupons", headers=h).json() if x["id"] == c["id"])
    assert mine["assigned_user_ids"] == [uid]
    assert [x["user_id"] for x in mine["assignments"]] == [uid]
    assert other_uid not in str(mine)

    # kişiye özel tarih geçtiyse kullanılamaz
    db.coupons.update_one({"id": c["id"], "assignments.user_id": uid}, {"$set": {"assignments.$.valid_until": _day(-1)}})
    r = _validate(client, h, c["code"], 100)
    assert r.status_code == 400 and "süresi" in r.text
    assert _validate(client, other_h, c["code"], 100).status_code == 200

    # geçmiş tarihle verilemez
    assert client.post("/api/admin/coupons/assign-member", json={**body, "valid_until": _day(-2)}, headers=admin).status_code == 400


def test_assign_all_only_customers(client, make_user, db):
    cust, _ = make_user()
    staff, _ = make_user(role="esnaf")
    admin_uid, admin = make_user(role="yonetici")
    c = _mk_coupon(db)
    r = client.post("/api/admin/coupons/assign-all", json={"coupon_id": c["id"], "limit": 3, "valid_until": _day(10)}, headers=admin)
    assert r.status_code == 200, r.text
    doc = db.coupons.find_one({"id": c["id"]})
    assert cust in doc["assigned_user_ids"]
    assert staff not in doc["assigned_user_ids"] and admin_uid not in doc["assigned_user_ids"]
    a = next(x for x in doc["assignments"] if x["user_id"] == cust)
    assert a["limit"] == 3 and a["valid_until"] == _day(10)


def test_regive_adds_fresh_rights(client, make_user, db):
    """Kuponu zaten kullanmış üyeye tekrar verince YENİ hak eklenir (eskiden 1/1
    kalıyordu, "2 üyeye verildi" deyip biri kullanamıyordu)."""
    used_uid, used_h = make_user()
    fresh_uid, _ = make_user()
    _, admin = make_user(role="yonetici")
    c = _mk_coupon(db, assignments=[{"user_id": used_uid, "limit": 1, "used_count": 1}], assigned_user_ids=[used_uid])
    assert _validate(client, used_h, c["code"], 100).status_code == 400  # hakkı bitmiş
    r = client.post("/api/admin/coupons/assign-all", json={"coupon_id": c["id"], "limit": 1}, headers=admin)
    assert r.status_code == 200 and r.json()["renewed_count"] == 1 and "yenilendi" in r.json()["message"]
    doc = db.coupons.find_one({"id": c["id"]})
    a = next(x for x in doc["assignments"] if x["user_id"] == used_uid)
    assert (a["limit"], a["used_count"]) == (2, 1)
    assert next(x for x in doc["assignments"] if x["user_id"] == fresh_uid)["limit"] == 1
    assert _validate(client, used_h, c["code"], 100).status_code == 200  # yeniden kullanabilir
    # tek üyeye tekrar verme de hak ekler
    r = client.post("/api/admin/coupons/assign-member", json={"coupon_id": c["id"], "user_id": used_uid, "limit": 2}, headers=admin)
    assert "eklendi" in r.json()["message"]
    a = next(x for x in db.coupons.find_one({"id": c["id"]})["assignments"] if x["user_id"] == used_uid)
    assert a["limit"] == 3


def test_unassigned_code_per_user_limit(client, make_user, db):
    uid, h = make_user()
    c = _mk_coupon(db, per_user_limit=1)
    assert _validate(client, h, c["code"], 100).status_code == 200
    db.transactions.insert_one({"tx_id": f"TX-{uuid.uuid4().hex[:6]}", "user_id": uid, "coupon_code": c["code"],
                                "order_status": "teslim_edildi", "items": []})
    r = _validate(client, h, c["code"], 100)
    assert r.status_code == 400 and "kullanım hakk" in r.text.lower()


def test_new_member_coupon_setting(client, make_user, db):
    from tests.test_auth import _put_otp
    _, admin = make_user(role="yonetici")
    c = _mk_coupon(db)
    r = client.put("/api/admin/coupons-new-member", json={"coupon_id": c["id"], "limit": 2, "days": 30}, headers=admin)
    assert r.status_code == 200, r.text
    assert client.get("/api/admin/coupons-new-member", headers=admin).json() == {"coupon_id": c["id"], "limit": 2, "days": 30}

    phone = "0555" + str(uuid.uuid4().int)[:7]
    _put_otp(db, phone)
    r = client.post("/api/auth/register", json={"name": "Yeni Üye", "phone": phone, "email": f"y{uuid.uuid4().hex[:6]}@ornek.com",
                                               "password": "sifre123", "otp_code": "123456"})
    assert r.status_code == 200, r.text
    new_uid = r.json()["user"]["user_id"]
    a = next(x for x in db.coupons.find_one({"id": c["id"]})["assignments"] if x["user_id"] == new_uid)
    assert a["limit"] == 2 and a["valid_until"] == _day(30)

    # pasif kupon seçilemez; kupon silinince ayar da kalkar
    pasif = _mk_coupon(db, active=False)
    assert client.put("/api/admin/coupons-new-member", json={"coupon_id": pasif["id"]}, headers=admin).status_code == 400
    assert client.delete(f"/api/admin/coupons/{c['id']}", headers=admin).status_code == 200
    assert client.get("/api/admin/coupons-new-member", headers=admin).json()["coupon_id"] is None
    # kaldırma (boş seçim)
    assert client.put("/api/admin/coupons-new-member", json={"coupon_id": None}, headers=admin).status_code == 200


def test_coupon_assignments_list(client, make_user, db):
    uid, _ = make_user(name="Kuponlu Ayşe")
    _, admin = make_user(role="yonetici")
    c = _mk_coupon(db, valid_until=_day(20))
    client.post("/api/admin/coupons/assign-member", json={"coupon_id": c["id"], "user_id": uid, "limit": 3, "valid_until": _day(5)}, headers=admin)
    bos = _mk_coupon(db)  # kimseye verilmemiş: listede yok
    rows = client.get("/api/admin/coupon-assignments", headers=admin).json()
    mine = [r for r in rows if r["coupon_id"] == c["id"]]
    assert len(mine) == 1 and mine[0]["user_name"] == "Kuponlu Ayşe"
    assert mine[0]["limit"] == 3 and mine[0]["remaining"] == 3
    assert mine[0]["valid_until"] == _day(5)  # kişiye özel tarih kuponunkinden erken
    assert all(r["coupon_id"] != bos["id"] for r in rows)
    # kişiye tarih yoksa kuponun tarihi
    client.post("/api/admin/coupons/assign-member", json={"coupon_id": c["id"], "user_id": uid, "limit": 3, "valid_until": None}, headers=admin)
    row = next(r for r in client.get("/api/admin/coupon-assignments", headers=admin).json() if r["coupon_id"] == c["id"])
    assert row["valid_until"] == _day(20)


def test_coupon_admin_endpoints_admin_only(client, make_user):
    _, h = make_user()
    assert client.get("/api/admin/coupons-new-member", headers=h).status_code in (401, 403)
    assert client.post("/api/admin/coupons", json=_payload(), headers=h).status_code in (401, 403)
