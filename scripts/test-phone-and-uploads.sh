#!/usr/bin/env bash
# =============================================================================
# Phase D + E smoke test:
#   - POST /v1/uploads (signed URL) → PUT file → upload lands at path
#   - POST /v1/auth/phone/request-otp → POST /v1/auth/phone/verify
#
# Uses a fresh Supabase user per run. Cleanup deletes the auth user + DB
# rows on exit (trap), so re-runs are independent.
#
# Local Supabase must have `[auth.sms.test_otp]` configured with the test
# phone below mapping to the test code (see supabase/config.toml).
# =============================================================================

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
SUPABASE_URL="${SUPABASE_URL:-http://127.0.0.1:54321}"
DB_CONTAINER="${DB_CONTAINER:-supabase_db_IncaCook}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.test | cut -d= -f2-)}"

# Must match an entry in supabase/config.toml [auth.sms.test_otp].
TEST_PHONE="+33611111111"
TEST_OTP="123456"

if [ -t 1 ]; then
  GREEN=$'\033[0;32m'; RED=$'\033[0;31m'; CYAN=$'\033[0;36m'; RESET=$'\033[0m'
else
  GREEN=''; RED=''; CYAN=''; RESET=''
fi

STEP_COUNT=0
step() { STEP_COUNT=$((STEP_COUNT + 1)); echo; echo "${CYAN}[$STEP_COUNT] $*${RESET}"; }
ok()   { echo "${GREEN}  ✓${RESET} $*"; }
fail() { echo "${RED}  ✗ $*${RESET}"; exit 1; }
info() { echo "    $*"; }

json_get() {
  python3 -c "import sys, json; v = json.loads(sys.argv[1])$2; print('' if v is None else v)" "$1" 2>/dev/null
}

db_query() {
  docker exec "$DB_CONTAINER" psql -U postgres -d postgres -t -A -c "$1" 2>/dev/null | tr -d '[:space:]'
}

curl_status() { curl -s -o /tmp/pd-resp.txt -w "%{http_code}" "$@"; }

SUPABASE_USER_ID=""
cleanup() {
  local code=$?
  if [ -n "$SUPABASE_USER_ID" ]; then
    info "Cleanup: wiping test user $SUPABASE_USER_ID..."
    db_query "DELETE FROM \"BuyerProfile\" WHERE \"userId\" IN (SELECT id FROM \"User\" WHERE \"supabaseId\" = '$SUPABASE_USER_ID')" > /dev/null
    db_query "DELETE FROM \"User\" WHERE \"supabaseId\" = '$SUPABASE_USER_ID'" > /dev/null
    curl -s -X DELETE "$SUPABASE_URL/auth/v1/admin/users/$SUPABASE_USER_ID" \
      -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" > /dev/null
  fi
  exit $code
}
trap cleanup EXIT

curl -sf "$BASE_URL/v1/health" > /dev/null || fail "API not reachable"

# -----------------------------------------------------------------------------
# Bootstrap: sign up a fresh user + complete Gate 2 as BUYER (simplest role).
# -----------------------------------------------------------------------------

step "Bootstrap: signup + Gate 2"
EMAIL="phone-test-$(date +%s)-$$@incacook.test"
RESP=$(curl -sf -X POST "$BASE_URL/v1/auth/signup" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"Test1234!secure\"}")
ACCESS_TOKEN=$(json_get "$RESP" "['data']['accessToken']")
SUPABASE_USER_ID=$(json_get "$RESP" "['data']['user']['id']")
curl -sf -X POST "$BASE_URL/v1/users" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"firstName":"PD","lastName":"Test","role":"BUYER","acceptedCgu":true,"acceptedCgv":true}' > /dev/null
ok "Fresh BUYER user ready (supabaseId=$SUPABASE_USER_ID)"

# =============================================================================
# Phase D: uploads
# =============================================================================

step "Phase D: POST /v1/uploads (avatar)"
RESP=$(curl -sf -X POST "$BASE_URL/v1/uploads" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"purpose":"avatar"}')
UPLOAD_URL=$(json_get "$RESP" "['data']['uploadUrl']")
UPLOAD_PATH=$(json_get "$RESP" "['data']['path']")
UPLOAD_BUCKET=$(json_get "$RESP" "['data']['bucket']")
[ "$UPLOAD_BUCKET" = "avatars" ] || fail "Wrong bucket: $UPLOAD_BUCKET"
case "$UPLOAD_PATH" in
  avatars/$SUPABASE_USER_ID/*) ;;
  *) fail "Path doesn't follow avatars/<supabaseId>/<id>: $UPLOAD_PATH" ;;
esac
ok "Signed URL issued, path scoped to user's supabaseId"

step "Phase D: PUT file body to the signed URL"
echo "phase-d test bytes" > /tmp/pd-file.txt
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$UPLOAD_URL" \
  -H "Content-Type: text/plain" --data-binary @/tmp/pd-file.txt)
[ "$STATUS" = "200" ] || fail "PUT to signed URL got $STATUS, expected 200"
ok "Upload succeeded (200)"

step "Phase D: gates — buyer cannot upload listing_image or seller_facade"
HTTP_CODE=$(curl_status -X POST "$BASE_URL/v1/uploads" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"purpose":"listing_image"}')
[ "$HTTP_CODE" = "403" ] || fail "Buyer listing_image expected 403, got $HTTP_CODE"
HTTP_CODE=$(curl_status -X POST "$BASE_URL/v1/uploads" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"purpose":"seller_facade"}')
[ "$HTTP_CODE" = "403" ] || fail "Buyer seller_facade expected 403, got $HTTP_CODE"
HTTP_CODE=$(curl_status -X POST "$BASE_URL/v1/uploads" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"purpose":"kyc_document"}')
[ "$HTTP_CODE" = "403" ] || fail "Buyer kyc_document expected 403, got $HTTP_CODE"
ok "Per-purpose role gates work (buyer → 403 on seller/driver/KYC purposes)"

# =============================================================================
# Phase E: phone OTP
# =============================================================================

step "Phase E: POST /v1/auth/phone/request-otp"
HTTP_CODE=$(curl_status -X POST "$BASE_URL/v1/auth/phone/request-otp" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d "{\"phone\":\"$TEST_PHONE\"}")
[ "$HTTP_CODE" = "204" ] || fail "Expected 204 from request-otp, got $HTTP_CODE. Body: $(cat /tmp/pd-resp.txt)"
ok "OTP request accepted (204)"

step "Phase E: POST /v1/auth/phone/verify with wrong code → 401"
HTTP_CODE=$(curl_status -X POST "$BASE_URL/v1/auth/phone/verify" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d "{\"phone\":\"$TEST_PHONE\",\"code\":\"999999\"}")
[ "$HTTP_CODE" = "401" ] || fail "Wrong-code verify expected 401, got $HTTP_CODE. Body: $(cat /tmp/pd-resp.txt)"
ok "Wrong OTP rejected (401)"

step "Phase E: POST /v1/auth/phone/verify with the right code → 200 + session"
RESP=$(curl -sf -X POST "$BASE_URL/v1/auth/phone/verify" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d "{\"phone\":\"$TEST_PHONE\",\"code\":\"$TEST_OTP\"}")
NEW_TOKEN=$(json_get "$RESP" "['data']['accessToken']")
PHONE_CONFIRMED=$(json_get "$RESP" "['data']['user']['phoneConfirmedAt']")
[ -n "$NEW_TOKEN" ] || fail "verify returned no accessToken"
[ -n "$PHONE_CONFIRMED" ] || fail "verify returned no phoneConfirmedAt"
ok "OTP verified, fresh session issued, phoneConfirmedAt set"

step "Phase E: User row mirrors verified phone"
ROW_PHONE=$(db_query "SELECT phone FROM \"User\" WHERE \"supabaseId\" = '$SUPABASE_USER_ID'")
ROW_VERIFIED=$(db_query "SELECT \"phoneVerified\" FROM \"User\" WHERE \"supabaseId\" = '$SUPABASE_USER_ID'")
[ "$ROW_PHONE" = "$TEST_PHONE" ] || fail "User.phone wrong: '$ROW_PHONE' vs '$TEST_PHONE'"
[ "$ROW_VERIFIED" = "t" ] || fail "User.phoneVerified expected t, got '$ROW_VERIFIED'"
ok "User.phone='$ROW_PHONE', phoneVerified=true"

echo
echo "${GREEN}✓ all $STEP_COUNT steps passed${RESET}"
