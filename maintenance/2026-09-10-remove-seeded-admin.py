"""
One-off maintenance (2026-09-10, security audit finding #1):
back up and delete the unused seeded default-admin accounts
(username 'admin' / password 'pazar2026') from the Afro Gida production DB.

Three duplicates existed (multi-worker startup race, no unique index on username).

- Prints a JSON backup of every matching account to stdout BEFORE deleting.
- Deletes those users and any of their sessions.
- Read-only verification of what remains.

Pair with the server.py change that removes the seed block and adds a
unique sparse index on users.username, then restart afro-backend.

Run on the server:
  sudo /root/afro-proje-yedek/afro-proje/backend/venv/bin/python3 \
       2026-09-10-remove-seeded-admin.py
"""
import os
import json
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/root/afro-proje-yedek/afro-proje/backend/.env")
db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

known = ["admin_25db4a100ac3", "admin_e52132876834", "admin_cf35cfc412e8"]
# Also catch any other username='admin' AND role='admin' doc, to be safe.
matched = [u["user_id"] for u in db.users.find({"username": "admin", "role": "admin"}, {"user_id": 1})]
ids = sorted(set(known) | set(matched))

docs = list(db.users.find({"user_id": {"$in": ids}}))
print("=== BACKUP (JSON) ===")
print(json.dumps(docs, default=str, ensure_ascii=False))
print("=== END BACKUP ===")

res = db.users.delete_many({"user_id": {"$in": ids}})
sess = db.user_sessions.delete_many({"user_id": {"$in": ids}})
print("deleted_users     :", res.deleted_count)
print("deleted_sessions  :", sess.deleted_count)

print("--- verification ---")
print("role=admin left   :", db.users.count_documents({"role": "admin"}))
print("username=admin left:", db.users.count_documents({"username": "admin"}))
print("yonetici accounts :", [
    (u.get("name"), u.get("user_id"), (str(u.get("phone")) or "")[:3] + "***")
    for u in db.users.find({"role": "yonetici"})
])
