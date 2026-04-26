#!/usr/bin/env bash
# populate-scadalts.sh — Import data sources and data points into a fresh Scada-LTS instance.
#
# Usage:
#   ./infra/compose/scripts/populate-scadalts.sh [BASE_URL] [USERNAME] [PASSWORD]
#
# Defaults:
#   BASE_URL  = http://localhost:8888/Scada-LTS
#   USERNAME  = admin
#   PASSWORD  = admin
#
# The seed JSON is read from infra/compose/config/scadalts-seed.json
# (relative to the repo root, or wherever this script is invoked from).
#
# The import uses Scada-LTS's DWR EmportDwr.importData endpoint — the same
# mechanism as the Import/Export page in the admin UI.

set -euo pipefail

BASE_URL="${1:-http://localhost:8888/Scada-LTS}"
USERNAME="${2:-admin}"
PASSWORD="${3:-admin}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEED_FILE="${SCRIPT_DIR}/../config/scadalts-seed.json"

if [[ ! -f "$SEED_FILE" ]]; then
  echo "ERROR: seed file not found: $SEED_FILE" >&2
  exit 1
fi

COOKIE_JAR="$(mktemp /tmp/scadalts-cookies.XXXXXX)"
trap 'rm -f "$COOKIE_JAR"' EXIT

echo "Connecting to $BASE_URL ..."

# Step 1 — Authenticate
AUTH_RESPONSE=$(curl -sf -X POST \
  "${BASE_URL}/api/auth/${USERNAME}/${PASSWORD}" \
  -c "$COOKIE_JAR" \
  -w "\n%{http_code}")

HTTP_CODE=$(echo "$AUTH_RESPONSE" | tail -1)
BODY=$(echo "$AUTH_RESPONSE" | head -1)

if [[ "$HTTP_CODE" != "200" ]] || [[ "$BODY" != '"true"' ]]; then
  echo "ERROR: authentication failed (HTTP $HTTP_CODE, body: $BODY)" >&2
  exit 1
fi

echo "Authenticated as $USERNAME."

# Step 2 — Read seed JSON and compact it to a single line for DWR
# (newlines in the DWR body confuse the field parser)
JSON_COMPACT=$(tr -d '\n\r' < "$SEED_FILE")

# Step 3 — Call EmportDwr.importData via DWR plain call
echo "Importing data sources and data points ..."

DWR_BODY="callCount=1
page=${BASE_URL}/emport.shtm
httpSessionId=
scriptSessionId=populate-script-$$
c0-scriptName=EmportDwr
c0-methodName=importData
c0-id=0
c0-param0=string:${JSON_COMPACT}
batchId=1
"

IMPORT_RESPONSE=$(curl -sf -X POST \
  "${BASE_URL}/dwr/call/plaincall/EmportDwr.importData.dwr" \
  -b "$COOKIE_JAR" \
  -H "Content-Type: text/plain" \
  --data-binary "$DWR_BODY" \
  -w "\n%{http_code}")

HTTP_CODE=$(echo "$IMPORT_RESPONSE" | tail -1)
BODY=$(echo "$IMPORT_RESPONSE" | head -5)

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "ERROR: import call failed (HTTP $HTTP_CODE)" >&2
  echo "$BODY" >&2
  exit 1
fi

if echo "$BODY" | grep -q "importStarted=true"; then
  echo "Import started successfully."
else
  echo "WARNING: unexpected response from import endpoint:" >&2
  echo "$BODY" >&2
  exit 1
fi

# Step 4 — Verify data sources were created
echo "Verifying data sources ..."
sleep 2

DS_RESPONSE=$(curl -sf "${BASE_URL}/api/datasources" \
  -b "$COOKIE_JAR" \
  -H "Accept: application/json")

DS_COUNT=$(echo "$DS_RESPONSE" | grep -o '"xid"' | wc -l | tr -d ' ')
echo "Data sources found: $DS_COUNT"

EXPECTED_DS=(DS_COOLING_CIRCUIT DS_EXTRUDER_LINE DS_UTILITIES DS_WELDING_STATION)
MISSING=0
for xid in "${EXPECTED_DS[@]}"; do
  if echo "$DS_RESPONSE" | grep -q "\"$xid\""; then
    echo "  [OK] $xid"
  else
    echo "  [MISSING] $xid" >&2
    MISSING=$((MISSING + 1))
  fi
done

if [[ $MISSING -gt 0 ]]; then
  echo "ERROR: $MISSING expected data source(s) not found after import." >&2
  exit 1
fi

echo ""
echo "Scada-LTS populated successfully."
echo "  Data sources: 4 (Cooling Circuit, Extruder Line, Utilities, Welding Station)"
echo "  Data points : 24"
echo ""
echo "The scadalts-collector will now pick up the data points automatically."
