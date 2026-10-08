"""Robot doğrulaması: anahtar yokken kapalı; varken token'sız / reddedilen istek SMS göndermez."""
import core.turnstile as ts


def _send(client, **extra):
    return client.post("/api/auth/send-phone-otp", json={"phone": "05551230099", "purpose": "password_reset", **extra})


def test_turnstile_kapaliyken_eski_davranis(client, monkeypatch):
    monkeypatch.delenv("TURNSTILE_SECRET_KEY", raising=False)
    assert _send(client).status_code == 200


def test_turnstile_acikken_token_zorunlu(client, monkeypatch):
    monkeypatch.setenv("TURNSTILE_SECRET_KEY", "test-secret")
    r = _send(client)
    assert r.status_code == 400
    assert "robot" in r.json()["detail"].lower()


def test_turnstile_reddedilen_token(client, monkeypatch):
    monkeypatch.setenv("TURNSTILE_SECRET_KEY", "test-secret")

    class FakeRes:
        def json(self):
            return {"success": False, "error-codes": ["invalid-input-response"]}

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, data=None):
            assert data["secret"] == "test-secret" and data["response"] == "kotu-token"
            return FakeRes()

    monkeypatch.setattr(ts.httpx, "AsyncClient", FakeClient)
    r = _send(client, turnstile_token="kotu-token")
    assert r.status_code == 400


def _login(client, phone, password="x", **extra):
    return client.post("/api/auth/login", json={"phone": phone, "password": password, **extra})


def test_giris_ilk_denemede_kutu_istenmez_yanlistan_sonra_istenir(client, monkeypatch, make_user, db):
    monkeypatch.setenv("TURNSTILE_SECRET_KEY", "test-secret")
    db.login_lockouts.delete_many({})
    _, _ = make_user(phone="05551230098")
    assert _login(client, "05551230098", "test1234").status_code == 200  # ilk deneme, kutusuz
    assert _login(client, "05551230098", "yanlis").status_code == 401
    r = _login(client, "05551230098", "test1234")  # yanlıştan sonra kutu şart
    assert r.status_code == 428
    assert "robot" in r.json()["detail"].lower()


def test_giris_ayni_adresten_farkli_numaralar_kutuya_takilir(client, monkeypatch, db):
    monkeypatch.setenv("TURNSTILE_SECRET_KEY", "test-secret")
    db.login_lockouts.delete_many({})
    for i in range(3):
        assert _login(client, f"0555999000{i}").status_code in (401, 404)
    assert _login(client, "05559990009").status_code == 428
    db.login_lockouts.delete_many({})


def test_sorumlu_yeni_cihaz_sms_oncesi_kutu_sart(client, monkeypatch, make_user, db):
    monkeypatch.setenv("TURNSTILE_SECRET_KEY", "test-secret")
    db.login_lockouts.delete_many({})
    make_user(role="pazar_sorumlusu", phone="05551230097")
    assert _login(client, "05551230097", "test1234").status_code == 428
    db.login_lockouts.delete_many({})


def test_turnstile_gecerli_token(client, monkeypatch):
    monkeypatch.setenv("TURNSTILE_SECRET_KEY", "test-secret")

    class FakeRes:
        def json(self):
            return {"success": True}

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, data=None):
            return FakeRes()

    monkeypatch.setattr(ts.httpx, "AsyncClient", FakeClient)
    assert _send(client, turnstile_token="iyi-token").status_code == 200
