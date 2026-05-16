#!/usr/bin/env bash
# =============================================================================
# Auth-flow test — backend-only.
#
# The Flutter app must never call Supabase directly. This script verifies that
# every auth operation works against /v1/auth/* without touching Supabase URLs
# from the "client side":
#
#   1. POST /v1/auth/signup        → session (access + refresh tokens)
#   2. POST /v1/users               → User row (using the signup's JWT)
#   3. GET  /v1/users/me            → round-trips the same JWT
#   4. POST /v1/auth/signin         → fresh session for same credentials
#   5. POST /v1/auth/refresh        → swap refresh token for a new session
#   6. POST /v1/auth/password/update → change password using current session
#   7. POST /v1/auth/signin         → old password rejected, new password works
#   8. POST /v1/auth/signout?scope=global → revokes all sessions
#   9. POST /v1/auth/refresh        → 401 (refresh token now invalid)
#  10. POST /v1/auth/password/reset-request → 204 (triggers email; we just
#       confirm the endpoint accepts it, not the email content)
#  11. Tampered token → 401
#
# Cleanup deletes the Supabase auth user + backend rows on exit, even on
# failure (trap).
#
# Prerequisites:
#   - `supabase start` running
#   - `pnpm test:start:dev` running on :3000
#
# Run:
#   bash scripts/test-auth-flow.sh
# =============================================================================

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
SUPABASE_URL="${SUPABASE_URL:-http://127.0.0.1:54321}"
DB_CONTAINER="${DB_CONTAINER:-supabase_db_IncaCook}"

# Only used for cleanup (Supabase admin) — the rest of the script never hits
# Supabase directly, mirroring what the Flutter app will do.
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.test | cut -d= -f2-)}"

if [ -t 1 ]; then
  GREEN=$'\033[0;32m'; RED=$'\033[0;31m'; YELLOW=$'\033[0;33m'; CYAN=$'\033[0;36m'; RESET=$'\033[0m'
else
  GREEN=''; RED=''; YELLOW=''; CYAN=''; RESET=''
fi

STEP_COUNT=0
step() { STEP_COUNT=$((STEP_COUNT + 1)); echo; echo "${CYAN}[$STEP_COUNT] $*${RESET}"; }
ok()   { echo "${GREEN}  ✓${RESET} $*"; }
fail() { echo "${RED}  ✗ $*${RESET}"; exit 1; }
info() { echo "    $*"; }

json_get() {
  python3 -c "import sys, json; print(json.loads(sys.argv[1])$2)" "$1" 2>/dev/null
}

db_query() {
  docker exec "$DB_CONTAINER" psql -U postgres -d postgres -t -A -c "$1" 2>/dev/null | tr -d '[:space:]'
}

# Show body + status for debugging (curl -sf hides bodies on 4xx).
curl_status() {
  curl -s -o /tmp/auth-test-resp.txt -w "%{http_code}" "$@"
}

SUPABASE_USER_ID=""
TEST_EMAIL=""

cleanup() {
  local exit_code=$?
  if [ -n "$SUPABASE_USER_ID" ]; then
    echo
    info "Cleanup: deleting test artifacts..."
    db_query "DELETE FROM \"BuyerProfile\" WHERE \"userId\" IN (SELECT id FROM \"User\" WHERE \"supabaseId\" = '$SUPABASE_USER_ID')" > /dev/null
    db_query "DELETE FROM \"User\" WHERE \"supabaseId\" = '$SUPABASE_USER_ID'" > /dev/null
    curl -s -X DELETE "$SUPABASE_URL/auth/v1/admin/users/$SUPABASE_USER_ID" \
      -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" > /dev/null
    info "Removed Supabase auth user $SUPABASE_USER_ID and backend rows."
  fi
  exit $exit_code
}
trap cleanup EXIT

# ---------- preflight ----------

curl -sf "$BASE_URL/v1/health" > /dev/null || fail "API not reachable at $BASE_URL"
[ -n "$SERVICE_KEY" ] || fail "SUPABASE_SERVICE_ROLE_KEY missing from .env.test (only used for cleanup)"

TEST_EMAIL="auth-test-$(date +%s)-$$@incacook.test"
PASSWORD_OLD="Test1234!secure"
PASSWORD_NEW="Brand5678!fresh"

# ---------- 1. signup via backend ----------

step "Backend: POST /v1/auth/signup"
RESPONSE=$(curl -sf -X POST "$BASE_URL/v1/auth/signup" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$PASSWORD_OLD\"}")
ACCESS_TOKEN=$(json_get "$RESPONSE" "['data']['accessToken']")
REFRESH_TOKEN=$(json_get "$RESPONSE" "['data']['refreshToken']")
SUPABASE_USER_ID=$(json_get "$RESPONSE" "['data']['user']['id']")
[ -n "$ACCESS_TOKEN" ] || fail "No accessToken in signup response: $RESPONSE"
[ -n "$REFRESH_TOKEN" ] || fail "No refreshToken in signup response"
[ -n "$SUPABASE_USER_ID" ] || fail "No user.id in signup response"
ok "Signup returned a session (user=$SUPABASE_USER_ID, email=$TEST_EMAIL)"

# ---------- 2. complete signup via /v1/users ----------

step "Backend: POST /v1/users to complete profile"
USER_RESPONSE=$(curl -sf -X POST "$BASE_URL/v1/users" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"firstName":"Auth","lastName":"Test","role":"BUYER","acceptedCgu":true,"acceptedCgv":true}')
USER_ROW_ID=$(json_get "$USER_RESPONSE" "['data']['id']")
[ -n "$USER_ROW_ID" ] || fail "Backend did not return a User id"
ok "User row created (id=$USER_ROW_ID, role=BUYER)"

# ---------- 3. /me with the session ----------

step "Backend: GET /v1/users/me"
ME=$(curl -sf "$BASE_URL/v1/users/me" -H "Authorization: Bearer $ACCESS_TOKEN")
ME_ID=$(json_get "$ME" "['data']['id']")
[ "$ME_ID" = "$USER_ROW_ID" ] || fail "/me returned $ME_ID expected $USER_ROW_ID"
ok "/users/me resolves the session JWT to the right User row"

# ---------- 4. signin via backend ----------

step "Backend: POST /v1/auth/signin with same credentials"
RESPONSE=$(curl -sf -X POST "$BASE_URL/v1/auth/signin" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$PASSWORD_OLD\"}")
SECOND_ACCESS=$(json_get "$RESPONSE" "['data']['accessToken']")
SECOND_REFRESH=$(json_get "$RESPONSE" "['data']['refreshToken']")
[ -n "$SECOND_ACCESS" ] || fail "Signin returned no accessToken"
[ "$SECOND_ACCESS" != "$ACCESS_TOKEN" ] || fail "Signin returned the same accessToken as signup (suspicious)"
ok "Signin issues a fresh session"

# ---------- 5. refresh via backend ----------

step "Backend: POST /v1/auth/refresh"
RESPONSE=$(curl -sf -X POST "$BASE_URL/v1/auth/refresh" \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"$SECOND_REFRESH\"}")
THIRD_ACCESS=$(json_get "$RESPONSE" "['data']['accessToken']")
THIRD_REFRESH=$(json_get "$RESPONSE" "['data']['refreshToken']")
[ -n "$THIRD_ACCESS" ] || fail "Refresh returned no accessToken"
ok "Refresh produced a new session"

# Use this access token going forward.
ACTIVE_ACCESS="$THIRD_ACCESS"

# ---------- 6. password update ----------

step "Backend: POST /v1/auth/password/update"
HTTP_CODE=$(curl_status -X POST "$BASE_URL/v1/auth/password/update" \
  -H "Authorization: Bearer $ACTIVE_ACCESS" -H "Content-Type: application/json" \
  -d "{\"newPassword\":\"$PASSWORD_NEW\"}")
[ "$HTTP_CODE" = "204" ] || fail "Expected 204 on password update, got $HTTP_CODE. Body: $(cat /tmp/auth-test-resp.txt)"
ok "Password updated (204)"

# ---------- 7. old password rejected, new accepted ----------

step "Backend: signin with old password → 401, new password → 200"
HTTP_CODE=$(curl_status -X POST "$BASE_URL/v1/auth/signin" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$PASSWORD_OLD\"}")
[ "$HTTP_CODE" = "401" ] || fail "Expected 401 with old password, got $HTTP_CODE"
RESPONSE=$(curl -sf -X POST "$BASE_URL/v1/auth/signin" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$PASSWORD_NEW\"}")
ACTIVE_ACCESS=$(json_get "$RESPONSE" "['data']['accessToken']")
ACTIVE_REFRESH=$(json_get "$RESPONSE" "['data']['refreshToken']")
[ -n "$ACTIVE_ACCESS" ] || fail "Signin with new password returned no token"
ok "Old password rejected, new password works"

# ---------- 8. signout (global) ----------

step "Backend: POST /v1/auth/signout?scope=global"
HTTP_CODE=$(curl_status -X POST "$BASE_URL/v1/auth/signout?scope=global" \
  -H "Authorization: Bearer $ACTIVE_ACCESS")
[ "$HTTP_CODE" = "204" ] || fail "Expected 204 on signout, got $HTTP_CODE"
ok "Global signout returned 204"

# ---------- 9. refresh after global signout → 401 ----------

step "Backend: POST /v1/auth/refresh after global signout → expect 401"
HTTP_CODE=$(curl_status -X POST "$BASE_URL/v1/auth/refresh" \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"$ACTIVE_REFRESH\"}")
[ "$HTTP_CODE" = "401" ] || fail "Refresh should be 401 after global signout, got $HTTP_CODE. Body: $(cat /tmp/auth-test-resp.txt)"
ok "Refresh token is rejected after global signout"

# ---------- 10. password reset request accepts the email ----------

step "Backend: POST /v1/auth/password/reset-request"
HTTP_CODE=$(curl_status -X POST "$BASE_URL/v1/auth/password/reset-request" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\"}")
[ "$HTTP_CODE" = "204" ] || fail "Expected 204 from reset-request, got $HTTP_CODE. Body: $(cat /tmp/auth-test-resp.txt)"
ok "Reset request accepted (email body itself isn't asserted here — check Mailpit at 127.0.0.1:54324)"

# ---------- 11. tampered token rejected ----------

step "Backend: tampered JWT → expect 401"
# Re-signin to get a valid token, then mangle it.
RESPONSE=$(curl -sf -X POST "$BASE_URL/v1/auth/signin" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$PASSWORD_NEW\"}")
GOOD=$(json_get "$RESPONSE" "['data']['accessToken']")
# Replace the last char of the signature; pick a different letter than what's
# already there so the mangle is always a real change (a sig that ends in 'X'
# would otherwise be unchanged by a naive `${GOOD%?}X`).
LAST="${GOOD: -1}"
if [ "$LAST" = "A" ]; then ALT="B"; else ALT="A"; fi
TAMPERED="${GOOD%?}$ALT"
HTTP_CODE=$(curl_status "$BASE_URL/v1/users/me" -H "Authorization: Bearer $TAMPERED")
[ "$HTTP_CODE" = "401" ] || fail "Expected 401 on tampered JWT, got $HTTP_CODE"
ok "Tampered token rejected as 401"

echo
echo "${GREEN}✓ all $STEP_COUNT steps passed${RESET}"
