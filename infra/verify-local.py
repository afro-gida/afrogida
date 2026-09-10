"""Yerel doğrulama: server.py'yi import et, OpenAPI şemasını üret ve
backend/openapi-baseline.json ile karşılaştır.

  .venv/Scripts/python.exe infra/verify-local.py

Exit 0 = import temiz + API yüzeyi (path/method/parametre/şema) baseline ile aynı.
Exit 1 = import hatası veya sözleşme sapması.

Kasıtlı bir API değişikliğinden sonra baseline'ı güncelle:
  .venv/Scripts/python.exe infra/verify-local.py --update-baseline
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.abspath(os.path.join(HERE, "..", "backend"))

os.chdir(BACKEND)
sys.path.insert(0, BACKEND)
os.makedirs("uploads", exist_ok=True)
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "verify_local")

import server  # noqa: E402

spec = server.app.openapi()
baseline_path = os.path.join(BACKEND, "openapi-baseline.json")

if "--update-baseline" in sys.argv:
    with open(baseline_path, "w", encoding="utf-8") as fh:
        json.dump(spec, fh, indent=4, sort_keys=True, ensure_ascii=False)
    print(f"baseline updated ({len(spec.get('paths', {}))} paths)")
    sys.exit(0)


def surface(doc):
    out = {}
    for path, methods in doc.get("paths", {}).items():
        for method, op in methods.items():
            if method.startswith("x-"):
                continue
            params = sorted(
                (p.get("name"), p.get("in"), bool(p.get("required")))
                for p in op.get("parameters", [])
            )
            body = op.get("requestBody", {})
            body_schema = json.dumps(
                body.get("content", {}).get("application/json", {}).get("schema", {}),
                sort_keys=True,
            )
            responses = {
                code: json.dumps(
                    r.get("content", {}).get("application/json", {}).get("schema", {}),
                    sort_keys=True,
                )
                for code, r in op.get("responses", {}).items()
            }
            out[f"{method.upper()} {path}"] = {
                "params": params,
                "body_required": bool(body.get("required")),
                "body_schema": body_schema,
                "responses": responses,
            }
    return out


base = surface(json.load(open(baseline_path, encoding="utf-8")))
curr = surface(spec)

added = sorted(set(curr) - set(base))
removed = sorted(set(base) - set(curr))
changed = sorted(k for k in set(base) & set(curr) if base[k] != curr[k])

for label, items in (("ADDED", added), ("REMOVED", removed), ("CHANGED", changed)):
    for it in items:
        print(f"{label}: {it}")
        if label == "CHANGED":
            for f in ("params", "body_required", "body_schema", "responses"):
                if base[it][f] != curr[it][f]:
                    print(f"    {f}:\n      was: {base[it][f]}\n      now: {curr[it][f]}")

if added or removed or changed:
    print(f"\nDRIFT: +{len(added)} -{len(removed)} ~{len(changed)}")
    sys.exit(1)

print(f"OK: import clean, {len(curr)} operations, contract matches baseline")
