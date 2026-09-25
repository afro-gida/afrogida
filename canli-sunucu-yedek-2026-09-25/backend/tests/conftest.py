"""Test altyapısı.

İzole bir MongoDB veritabanına (`afrogida_test`) karşı çalışır — staging veya
production DB'sine ASLA dokunmaz. `server.py` import edilmeden önce ortam
değişkenleri ayarlanır.

  cd backend && python -m pytest -q            (yerel: .venv, mongod gerekir)
  bash infra/run-tests.sh                       (sunucuda: staging venv + mongod)
"""
import os
import secrets
import sys
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)
(BACKEND / "uploads").mkdir(exist_ok=True)

TEST_DB = "afrogida_test"
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ["DB_NAME"] = TEST_DB
os.environ.setdefault("AFRO_SECRET_KEY", "test-secret-key")
os.environ.setdefault("AFRO_ENC_KEY", "test-enc-key")
os.environ.setdefault("AFRO_ENV", "test")
# SMS / PayTR dış çağrıları testte yapılmaz
os.environ.setdefault("VERIMOR_USERNAME", "")
os.environ.setdefault("VERIMOR_PASSWORD", "")
os.environ.setdefault("SECURITY_ADMIN_PHONE", "")

from pymongo import MongoClient  # noqa: E402

_sync = MongoClient(os.environ["MONGO_URL"])
_db = _sync[TEST_DB]


@pytest.fixture(scope="session", autouse=True)
def _fresh_db():
    """Test oturumu başında test DB'sini sıfırla; startup() seed'i doldurur."""
    _sync.drop_database(TEST_DB)
    yield
    _sync.drop_database(TEST_DB)


@pytest.fixture(scope="session")
def client(_fresh_db):
    """Uygulama TestClient'ı — lifespan (startup/shutdown) tetiklenir."""
    from fastapi.testclient import TestClient
    import server

    with TestClient(server.app) as c:
        yield c


@pytest.fixture
def db():
    """Doğrudan (pymongo) test DB erişimi — fixture kurulum/temizlik için."""
    return _db


@pytest.fixture
def make_user(db):
    """Test kullanıcısı + geçerli oturum token'ı üretir.

        uid, headers = make_user(role="member")
        client.get("/api/orders", headers=headers)
    """
    from core.crypto import hash_token
    import bcrypt

    created = []

    def _make(role="member", *, twofa=None, **fields):
        uid = f"test_{uuid.uuid4().hex[:10]}"
        phone = fields.pop("phone", "05" + str(uuid.uuid4().int)[:9])
        doc = {
            "user_id": uid,
            "role": role,
            "name": fields.pop("name", "Test Kullanıcı"),
            "phone": phone,
            "auth_type": "phone",
            "password_hash": bcrypt.hashpw(b"test1234", bcrypt.gensalt()).decode(),
            "created_at": datetime.now(timezone.utc),
        }
        doc.update(fields)
        db.users.insert_one(doc)

        token = secrets.token_hex(32)
        is_admin = role in ("admin", "yonetici")
        db.user_sessions.insert_one({
            "token_hash": hash_token(token),
            "user_id": uid,
            "role": role,
            "is_admin": is_admin,
            "twofa_verified": is_admin if twofa is None else twofa,
            "ip_address": "127.0.0.1",
            "ua_hash": "test",
            "created_at": datetime.now(timezone.utc),
            "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
        })
        created.append(uid)
        return uid, {"Authorization": f"Bearer {token}"}

    yield _make

    if created:
        db.users.delete_many({"user_id": {"$in": created}})
        db.user_sessions.delete_many({"user_id": {"$in": created}})
