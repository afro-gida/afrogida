"""Kupon doğrulama — /coupons/validate ile sipariş aynı _evaluate_coupon'u kullanır."""
import uuid


def _mk_coupon(db, **over):
    c = {
        "id": f"coup_{uuid.uuid4().hex[:8]}",
        "code": f"TEST{uuid.uuid4().hex[:6].upper()}",
        "title": "Test Kuponu",
        "discount_percent": 10,
        "discount_amount": None,
        "min_amount": 0,
        "members_only": True,
        "assigned_user_ids": [],
        "assignments": [],
        "single_use": False,
        "used": False,
        "active": True,
    }
    c.update(over)
    db.coupons.insert_one(dict(c))
    return c


def _validate(client, headers, code, total):
    return client.post("/api/coupons/validate", json={"code": code, "total": total}, headers=headers or {})


def test_percentage_discount_server_computed(client, make_user, db):
    _, h = make_user()
    c = _mk_coupon(db, discount_percent=20)
    r = _validate(client, h, c["code"], 100)
    assert r.status_code == 200
    assert r.json()["discount"] == 20.0            # %20 * 100


def test_fixed_discount_takes_priority(client, make_user, db):
    _, h = make_user()
    c = _mk_coupon(db, discount_percent=50, discount_amount=15)
    r = _validate(client, h, c["code"], 100)
    assert r.json()["discount"] == 15.0            # sabit tutar percent'i ezer


def test_discount_capped_at_total(client, make_user, db):
    _, h = make_user()
    c = _mk_coupon(db, discount_amount=999)
    r = _validate(client, h, c["code"], 40)
    assert r.json()["discount"] == 40.0            # toplamı aşamaz


def test_min_amount_enforced(client, make_user, db):
    _, h = make_user()
    c = _mk_coupon(db, min_amount=500)
    r = _validate(client, h, c["code"], 100)
    assert r.status_code == 400
    assert "minimum" in r.text.lower()


def test_unknown_coupon_404(client, make_user):
    _, h = make_user()
    assert _validate(client, h, "YOKBOYLE", 100).status_code == 404


def test_inactive_coupon_rejected(client, make_user, db):
    _, h = make_user()
    c = _mk_coupon(db, active=False)
    assert _validate(client, h, c["code"], 100).status_code == 400


def test_assigned_coupon_other_user_forbidden(client, make_user, db):
    _, h = make_user()
    c = _mk_coupon(db, assigned_user_ids=["someone_else"])
    assert _validate(client, h, c["code"], 100).status_code == 403


def test_per_user_limit_exhausted(client, make_user, db):
    uid, h = make_user()
    c = _mk_coupon(db, assignments=[{"user_id": uid, "limit": 1, "used_count": 1}])
    r = _validate(client, h, c["code"], 100)
    assert r.status_code == 400
    assert "kullanım hakk" in r.text.lower()


def test_members_only_requires_login(client, db):
    c = _mk_coupon(db, members_only=True)
    r = client.post("/api/coupons/validate", json={"code": c["code"], "total": 100})
    assert r.status_code == 401
