"""Duman testleri — temel uçlar ayakta mı, auth kapıları çalışıyor mu."""


def test_root_ok(client):
    r = client.get("/api/")
    assert r.status_code == 200


def test_products_list_public(client):
    r = client.get("/api/products")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) > 0                      # startup() seed'i ürün doldurur
    assert {"name", "category", "price"} <= set(data[0])


def test_categories_public(client):
    r = client.get("/api/categories")
    assert r.status_code == 200
    cats = r.json()
    assert "Domates" in cats
    assert cats[:2] == ["Domates", "Salata"]  # sabit sıra korunmalı


def test_orders_requires_auth(client):
    assert client.get("/api/orders").status_code == 401


def test_admin_endpoint_requires_admin(client, make_user):
    _, member = make_user(role="member")
    assert client.get("/api/admin/members").status_code == 401  # no token -> 401
    assert client.get("/api/admin/members", headers=member).status_code == 403  # member -> 403


def test_admin_endpoint_allows_admin(client, make_user):
    _, admin = make_user(role="yonetici")
    r = client.get("/api/admin/members", headers=admin)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_vapid_key_public(client):
    r = client.get("/api/push/vapid-public-key")
    assert r.status_code == 200 and "key" in r.json()


def test_push_token_requires_auth(client):
    assert client.post("/api/push-token", json={"push_token": "x"}).status_code == 401


def test_auth_me(client, make_user):
    uid, headers = make_user(role="member", name="Ayşe")
    r = client.get("/api/auth/me", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["user_id"] == uid
    assert body["name"] == "Ayşe"
    assert "password_hash" not in body
