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


def test_turnstile_giriste_token_zorunlu(client, monkeypatch):
    monkeypatch.setenv("TURNSTILE_SECRET_KEY", "test-secret")
    r = client.post("/api/auth/login", json={"phone": "05551230098", "password": "x"})
    assert r.status_code == 400
    assert "robot" in r.json()["detail"].lower()


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
