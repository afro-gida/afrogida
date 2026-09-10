#!/usr/bin/env bash
# Contract guard for the backend refactor: compare the running server's OpenAPI
# surface against backend/openapi-baseline.json in the repo.
#
# Run on the VPS (or anywhere that can reach the backend):
#   BACKEND_URL=http://127.0.0.1:8000 bash infra/check-openapi.sh
#
# Exit 0 = identical path/method/parameter/schema surface. Exit 1 = drift.
# Update the baseline ONLY when an API change is intended:
#   curl -s "$BACKEND_URL/openapi.json" | python3 -m json.tool --sort-keys > backend/openapi-baseline.json
set -euo pipefail

BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:8000}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASELINE="$REPO/backend/openapi-baseline.json"

curl -s "$BACKEND_URL/openapi.json" -o /tmp/openapi-current.json

python3 - "$BASELINE" /tmp/openapi-current.json <<'PY'
import json, sys

def surface(spec):
    """Reduce an OpenAPI doc to the parts that define the HTTP contract."""
    out = {}
    for path, methods in spec.get("paths", {}).items():
        for method, op in methods.items():
            if method.startswith("x-"):
                continue
            params = sorted(
                (p.get("name"), p.get("in"), bool(p.get("required")))
                for p in op.get("parameters", [])
            )
            body = op.get("requestBody", {})
            body_required = bool(body.get("required"))
            body_schema = json.dumps(
                body.get("content", {}).get("application/json", {}).get("schema", {}),
                sort_keys=True,
            )
            responses = {}
            for code, resp in op.get("responses", {}).items():
                responses[code] = json.dumps(
                    resp.get("content", {}).get("application/json", {}).get("schema", {}),
                    sort_keys=True,
                )
            out[f"{method.upper()} {path}"] = {
                "params": params,
                "body_required": body_required,
                "body_schema": body_schema,
                "responses": responses,
            }
    return out

base = surface(json.load(open(sys.argv[1])))
curr = surface(json.load(open(sys.argv[2])))

base_keys, curr_keys = set(base), set(curr)
added = sorted(curr_keys - base_keys)
removed = sorted(base_keys - curr_keys)
changed = sorted(k for k in base_keys & curr_keys if base[k] != curr[k])

for label, items in (("ADDED", added), ("REMOVED", removed), ("CHANGED", changed)):
    for it in items:
        print(f"{label}: {it}")
        if label == "CHANGED":
            for field in ("params", "body_required", "body_schema", "responses"):
                if base[it][field] != curr[it][field]:
                    print(f"    {field}:\n      was: {base[it][field]}\n      now: {curr[it][field]}")

if added or removed or changed:
    print(f"\nDRIFT: +{len(added)} -{len(removed)} ~{len(changed)}")
    sys.exit(1)
print(f"OK: {len(curr)} operations, contract unchanged")
PY
