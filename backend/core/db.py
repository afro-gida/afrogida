"""MongoDB bağlantısı (async — motor).

`db` ve `client` uygulama genelinde buradan import edilir.
"""
import os

from motor.motor_asyncio import AsyncIOMotorClient

from core import config  # noqa: F401  -> .env'in yüklendiğini garanti eder

_mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(_mongo_url)
db = client[os.environ["DB_NAME"]]
