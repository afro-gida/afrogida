"""Pazar Sorumlusu — kısıtlı yönetici rolü. "yonetici" (tam admin) ile
KARIŞTIRILMAMALI; role="pazar_sorumlusu" ayrı ve dar kapsamlı bir rol,
sadece managed_markets'teki pazarların tedarikçilerini yönetebilir."""
import uuid

import services.catalog as _catalog_mod


def _reset_catalog_cache():
    """services.catalog._read_catalog_config() 60sn'lik bellek-içi önbellek
    tutuyor (_write_catalog_config'ten geçmeyen ham DB yazmalarını yansıtmaz)
    — testte doğrudan db.catalog_config'e yazdıktan sonra bunu çağır."""
    _catalog_mod._CACHE = None
    _catalog_mod._CACHE_TS = 0


def _mk_market(db, name):
    doc = {"id": f"market_{uuid.uuid4().hex[:10]}", "name": name, "day": "Pazartesi", "active": True}
    db.markets.insert_one(doc)
    return doc


def _set_supplier_markets(db, mapping):
    original = db.catalog_config.find_one({})
    cfg = dict(original) if original else {"id": "catalog_config"}
    cfg.pop("_id", None)
    cfg["supplier_markets"] = mapping
    db.catalog_config.update_one({}, {"$set": cfg}, upsert=True)
    _reset_catalog_cache()
    return original


def _restore_catalog_config(db, original):
    if original:
        original.pop("_id", None)
        db.catalog_config.update_one({}, {"$set": original})
    else:
        db.catalog_config.delete_many({})
    _reset_catalog_cache()


def test_admin_assigns_and_removes_pazar_sorumlusu(client, make_user, db):
    _, admin_h = make_user(role="yonetici")
    uid, _h = make_user(role="musteri")
    mkt = _mk_market(db, "Sorumlu Test Pazarı A")
    try:
        r = client.post("/api/admin/pazar-sorumlusu/assign",
                         json={"identifier": uid, "managed_markets": [mkt["id"]]}, headers=admin_h)
        assert r.status_code == 200, r.text
        assert r.json()["user"]["role"] == "pazar_sorumlusu"
        assert db.users.find_one({"user_id": uid})["managed_markets"] == [mkt["id"]]

        # boş liste -> rol kaldırılır
        r2 = client.post("/api/admin/pazar-sorumlusu/assign",
                          json={"identifier": uid, "managed_markets": []}, headers=admin_h)
        assert r2.status_code == 200, r2.text
        assert r2.json()["user"]["role"] == "musteri"
    finally:
        db.markets.delete_one({"id": mkt["id"]})


def test_admin_only_can_assign(client, make_user, db):
    _, member_h = make_user(role="musteri")
    uid2, _h2 = make_user(role="musteri")
    mkt = _mk_market(db, "Sorumlu Test Pazarı B")
    try:
        r = client.post("/api/admin/pazar-sorumlusu/assign",
                         json={"identifier": uid2, "managed_markets": [mkt["id"]]}, headers=member_h)
        assert r.status_code == 403
    finally:
        db.markets.delete_one({"id": mkt["id"]})


def test_cannot_assign_yonetici_or_invalid_market(client, make_user, db):
    admin_uid, admin_h = make_user(role="yonetici")
    r = client.post("/api/admin/pazar-sorumlusu/assign",
                     json={"identifier": admin_uid, "managed_markets": []}, headers=admin_h)
    assert r.status_code == 400  # yönetici hesabı pazar sorumlusu yapılamaz

    uid, _h = make_user(role="musteri")
    r2 = client.post("/api/admin/pazar-sorumlusu/assign",
                      json={"identifier": uid, "managed_markets": ["market_yok_boyle"]}, headers=admin_h)
    assert r2.status_code == 400  # geçersiz pazar id


def test_pazar_sorumlusu_sees_only_own_market(client, make_user, db):
    _, admin_h = make_user(role="yonetici")
    mkt_a = _mk_market(db, "İzole Test Pazarı A")
    mkt_b = _mk_market(db, "İzole Test Pazarı B")
    original = _set_supplier_markets(db, {
        "Tedarikçi A": ["İzole Test Pazarı A"],
        "Tedarikçi B": ["İzole Test Pazarı B"],
    })
    try:
        uid, sh = make_user(role="musteri")
        client.post("/api/admin/pazar-sorumlusu/assign",
                    json={"identifier": uid, "managed_markets": [mkt_a["id"]]}, headers=admin_h)

        r = client.get("/api/pazar-sorumlusu/markets", headers=sh)
        assert r.status_code == 200, r.text
        ids = [m["id"] for m in r.json()]
        assert ids == [mkt_a["id"]]  # sadece A, B YOK

        r2 = client.get("/api/pazar-sorumlusu/suppliers", headers=sh)
        groups = [s["supplier_group"] for s in r2.json()]
        assert groups == ["Tedarikçi A"]  # sadece kendi pazarındaki tedarikçi

        # kendi pazarındaki tedarikçinin ürünlerini görebilir
        r3 = client.get("/api/pazar-sorumlusu/suppliers/Tedarikçi A/products", headers=sh)
        assert r3.status_code == 200, r3.text

        # başka pazarın tedarikçisine erişemez
        r4 = client.get("/api/pazar-sorumlusu/suppliers/Tedarikçi B/products", headers=sh)
        assert r4.status_code == 403
    finally:
        db.markets.delete_many({"id": {"$in": [mkt_a["id"], mkt_b["id"]]}})
        _restore_catalog_config(db, original)


def test_pazar_sorumlusu_cannot_touch_other_market(client, make_user, db):
    _, admin_h = make_user(role="yonetici")
    mkt_own = _mk_market(db, "Kendi Pazarım")
    mkt_other = _mk_market(db, "Başkasının Pazarı")
    original = _set_supplier_markets(db, {})
    try:
        uid, sh = make_user(role="musteri")
        client.post("/api/admin/pazar-sorumlusu/assign",
                    json={"identifier": uid, "managed_markets": [mkt_own["id"]]}, headers=admin_h)

        # kendi pazarına tedarikçi atayabilir
        r = client.post("/api/pazar-sorumlusu/suppliers/assign",
                         json={"supplier_group": "Yeni Tedarikçi", "market_id": mkt_own["id"]}, headers=sh)
        assert r.status_code == 200, r.text
        cfg = db.catalog_config.find_one({}, {"_id": 0})
        assert "Kendi Pazarım" in (cfg.get("supplier_markets", {}).get("Yeni Tedarikçi") or [])

        # başkasının pazarına ATAYAMAZ
        r2 = client.post("/api/pazar-sorumlusu/suppliers/assign",
                          json={"supplier_group": "Sızma Tedarikçi", "market_id": mkt_other["id"]}, headers=sh)
        assert r2.status_code == 403

        # başkasının pazarından KALDIRAMAZ
        r3 = client.post("/api/pazar-sorumlusu/suppliers/unassign",
                          json={"supplier_group": "Yeni Tedarikçi", "market_id": mkt_other["id"]}, headers=sh)
        assert r3.status_code == 403
    finally:
        db.markets.delete_many({"id": {"$in": [mkt_own["id"], mkt_other["id"]]}})
        _restore_catalog_config(db, original)


def test_admin_still_passes_pazar_sorumlusu_dependency(client, make_user):
    """get_current_courier deseniyle aynı: tam admin de bu uçlara erişebilir
    (denetim için), sadece managed_markets'i olmadığı için boş sonuç görür."""
    _, admin_h = make_user(role="yonetici")
    r = client.get("/api/pazar-sorumlusu/markets", headers=admin_h)
    assert r.status_code == 200
    assert r.json() == []
