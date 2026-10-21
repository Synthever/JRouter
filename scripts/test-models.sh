#!/usr/bin/env bash
# Smoke test for the JRouter model catalog.
#
# Usage:
#   ./test-models.sh                     # local (no auth needed from loopback)
#   ./test-models.sh https://jrouter.rkhyg.xyz "sk-..."
#   JROUTER_KEY=sk-... ./test-models.sh https://jrouter.rkhyg.xyz
#
# Exit code 0 = catalog reachable and non-empty.
#
# The model count is per-key by design: a key whose policy.allowedModels is set
# sees only those models, and a role=user key sees only published combos. The
# same URL returning different counts for different keys is correct.
set -uo pipefail

BASE="${1:-http://127.0.0.1:20128}"
KEY="${2:-${JROUTER_KEY:-}}"

url="${BASE%/}/v1/models"
if [ -n "$KEY" ]; then
  auth=(-H "Authorization: Bearer $KEY")
  label="with key"
else
  auth=()
  label="no key"
fi

echo "GET $url ($label)"
body="$(mktemp)"
code="$(curl -sS -o "$body" -w '%{http_code}' --max-time 20 "${auth[@]}" "$url")"

if [ "$code" = "401" ]; then
  echo "FAIL: HTTP 401 — $(head -c 200 "$body")"
  echo "hint: remote /v1 needs an API key; requests from loopback do not."
  rm -f "$body"
  exit 1
fi

if [ "$code" != "200" ]; then
  echo "FAIL: HTTP $code — $(head -c 200 "$body")"
  rm -f "$body"
  exit 1
fi

python3 - "$body" <<'PY'
import json, sys

with open(sys.argv[1]) as fh:
    payload = json.load(fh)

data = payload.get("data") or []
combos = [m for m in data if m.get("owned_by") == "combo"]

print(f"OK: object={payload.get('object')} models={len(data)} combos={len(combos)}")
print("combo ids:", ", ".join(m["id"] for m in combos) or "(none published)")

if not data:
    print("FAIL: catalog is empty")
    sys.exit(1)
PY

rc=$?
rm -f "$body"
exit $rc
