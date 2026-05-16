#!/usr/bin/env bash
# =============================================================================
# Phase B end-to-end test — exercises every per-concept signup endpoint.
#
# For each role (buyer / seller / driver) the script walks the wizard flow
# from Supabase auth signup all the way to a "complete" user, hitting every
# Phase B endpoint at least once. Each branch creates a fresh user (random
# email + Supabase signup) so re-runs are clean and tests are independent.
#
# Endpoints exercised:
#   - GET  /v1/charters/active                 (public)
#   - POST /v1/auth/signup                     (auth)
#   - POST /v1/users                           (Gate 2)
#   - PUT  /v1/users/me/addresses/:kind        (address upsert)
#   - POST /v1/users/me/charters               (charter acceptance)
#   - PUT  /v1/buyers/me/preferences           (buyer)
#   - PUT  /v1/sellers/me/profile              (seller)
#   - PUT  /v1/sellers/me/business             (seller, non-fait-maison)
#   - PUT  /v1/sellers/me/cuisines             (seller)
#   - PUT  /v1/drivers/me/vehicle              (driver)
#   - PUT  /v1/drivers/me/zones                (driver)
#   - POST /v1/kyc/documents                   (seller + driver)
#   - GET  /v1/users/me                        (final state check)
#
# Cleanup deletes all Supabase auth users + backend rows on exit, even on
# failure (trap).
# =============================================================================

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
SUPABASE_URL="${SUPABASE_URL:-http://127.0.0.1:54321}"
DB_CONTAINER="${DB_CONTAINER:-supabase_db_IncaCook}"
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
  python3 -c "import sys, json; v = json.loads(sys.argv[1])$2; print('' if v is None else (','.join(map(str, v)) if isinstance(v, list) else v))" "$1" 2>/dev/null
}

db_query() {
  docker exec "$DB_CONTAINER" psql -U postgres -d postgres -t -A -c "$1" 2>/dev/null | tr -d '[:space:]'
}

curl_status() { curl -s -o /tmp/signup-test-resp.txt -w "%{http_code}" "$@"; }

# IDs collected for cleanup.
SUPABASE_USER_IDS=()

cleanup() {
  local exit_code=$?
  if [ ${#SUPABASE_USER_IDS[@]} -gt 0 ]; then
    echo
    info "Cleanup: deleting test artifacts for ${#SUPABASE_USER_IDS[@]} users..."
    for uid in "${SUPABASE_USER_IDS[@]}"; do
      # Wipe DB-side rows (FKs prevent direct User delete; clear children).
      db_query "DELETE FROM \"UserCharter\" WHERE \"userId\" IN (SELECT id FROM \"User\" WHERE \"supabaseId\" = '$uid')" > /dev/null
      db_query "DELETE FROM \"KycDocument\" WHERE \"userId\" IN (SELECT id FROM \"User\" WHERE \"supabaseId\" = '$uid')" > /dev/null
      db_query "DELETE FROM \"SellerCuisine\" WHERE \"userId\" IN (SELECT id FROM \"User\" WHERE \"supabaseId\" = '$uid')" > /dev/null
      db_query "DELETE FROM \"SellerDish\" WHERE \"userId\" IN (SELECT id FROM \"User\" WHERE \"supabaseId\" = '$uid')" > /dev/null
      db_query "DELETE FROM \"SellerOpeningHours\" WHERE \"sellerId\" IN (SELECT id FROM \"User\" WHERE \"supabaseId\" = '$uid')" > /dev/null
      db_query "DELETE FROM \"SellerBusiness\" WHERE \"userId\" IN (SELECT id FROM \"User\" WHERE \"supabaseId\" = '$uid')" > /dev/null
      db_query "DELETE FROM \"DriverZone\" WHERE \"userId\" IN (SELECT id FROM \"User\" WHERE \"supabaseId\" = '$uid')" > /dev/null
      db_query "DELETE FROM \"BuyerProfile\" WHERE \"userId\" IN (SELECT id FROM \"User\" WHERE \"supabaseId\" = '$uid')" > /dev/null
      db_query "DELETE FROM \"SellerProfile\" WHERE \"userId\" IN (SELECT id FROM \"User\" WHERE \"supabaseId\" = '$uid')" > /dev/null
      db_query "DELETE FROM \"DriverProfile\" WHERE \"userId\" IN (SELECT id FROM \"User\" WHERE \"supabaseId\" = '$uid')" > /dev/null
      db_query "DELETE FROM \"Address\" WHERE \"userId\" IN (SELECT id FROM \"User\" WHERE \"supabaseId\" = '$uid')" > /dev/null
      db_query "DELETE FROM \"User\" WHERE \"supabaseId\" = '$uid'" > /dev/null
      curl -s -X DELETE "$SUPABASE_URL/auth/v1/admin/users/$uid" \
        -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" > /dev/null
    done
    info "Cleanup complete."
  fi
  exit $exit_code
}
trap cleanup EXIT

curl -sf "$BASE_URL/v1/health" > /dev/null || fail "API not reachable at $BASE_URL"
[ -n "$SERVICE_KEY" ] || fail "SUPABASE_SERVICE_ROLE_KEY missing (used only for cleanup)"

# Mints a fresh Supabase user, returns email + token via globals.
fresh_user() {
  local label="$1"
  TEST_EMAIL="signup-${label}-$(date +%s)-$$-${RANDOM}@incacook.test"
  local resp
  resp=$(curl -sf -X POST "$BASE_URL/v1/auth/signup" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"Test1234!secure\"}")
  ACCESS_TOKEN=$(json_get "$resp" "['data']['accessToken']")
  local supabase_user
  supabase_user=$(json_get "$resp" "['data']['user']['id']")
  [ -n "$ACCESS_TOKEN" ] || fail "No accessToken in signup response: $resp"
  SUPABASE_USER_IDS+=("$supabase_user")
}

# ============================================================================
# 0. Public: GET /v1/charters/active
# ============================================================================

step "Public: GET /v1/charters/active"
RESP=$(curl -sf "$BASE_URL/v1/charters/active")
CGU_VERSION=$(json_get "$RESP" "['data']['CGU']")
HYGIENE_VERSION=$(json_get "$RESP" "['data']['HYGIENE']")
[ -n "$CGU_VERSION" ] || fail "CGU version missing in /charters/active"
[ -n "$HYGIENE_VERSION" ] || fail "HYGIENE version missing"
ok "Charter versions: CGU=$CGU_VERSION HYGIENE=$HYGIENE_VERSION"

# ============================================================================
# 1. Buyer branch
# ============================================================================

step "Buyer: full signup flow"
fresh_user "buyer"
curl -sf -X POST "$BASE_URL/v1/users" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"firstName":"Test","lastName":"Buyer","role":"BUYER","acceptedCgu":true,"acceptedCgv":true}' > /dev/null
ok "Gate 2 (POST /v1/users) created BUYER"

# Onboarding: fresh BUYER → next should be 'addresses', both steps incomplete.
RESP=$(curl -sf "$BASE_URL/v1/users/me/onboarding" -H "Authorization: Bearer $ACCESS_TOKEN")
NEXT=$(json_get "$RESP" "['data']['next']")
ADDR_STATUS=$(json_get "$RESP" "['data']['steps']['addresses']")
PREFS_STATUS=$(json_get "$RESP" "['data']['steps']['preferences']")
[ "$NEXT" = "addresses" ] || fail "Fresh buyer next should be 'addresses', got '$NEXT'"
[ "$ADDR_STATUS" = "incomplete" ] || fail "addresses should be incomplete, got '$ADDR_STATUS'"
[ "$PREFS_STATUS" = "incomplete" ] || fail "preferences should be incomplete, got '$PREFS_STATUS'"
ok "Onboarding: next=addresses, both steps incomplete"

# Address (buyer-delivery)
RESP=$(curl -sf -X PUT "$BASE_URL/v1/users/me/addresses/buyer-delivery" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"fullAddress":"12 rue de Test","city":"Paris","postalCode":"75011","type":"HOME","lat":48.853,"lng":2.369}')
ADDR_ID=$(json_get "$RESP" "['data']['id']")
[ -n "$ADDR_ID" ] || fail "No address id returned"
ok "PUT /addresses/buyer-delivery → id=$ADDR_ID"

# Idempotency: second PUT updates the same row.
RESP=$(curl -sf -X PUT "$BASE_URL/v1/users/me/addresses/buyer-delivery" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"fullAddress":"13 rue de Test","city":"Paris","postalCode":"75011"}')
ADDR_ID2=$(json_get "$RESP" "['data']['id']")
[ "$ADDR_ID" = "$ADDR_ID2" ] || fail "Second PUT created a new row instead of updating ($ADDR_ID vs $ADDR_ID2)"
ok "Second PUT updates the same row (idempotent)"

# Preferences
RESP=$(curl -sf -X PUT "$BASE_URL/v1/buyers/me/preferences" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"dietaryTags":["HALAL","GLUTEN_FREE"],"allergens":["ARACHIDES"]}')
TAGS=$(json_get "$RESP" "['data']['dietaryTags']")
[ "$TAGS" = "HALAL,GLUTEN_FREE" ] || fail "Preferences round-trip mismatch: '$TAGS'"
ok "PUT /buyers/me/preferences round-tripped"

# Charters: CGU + CGV
curl -sf -X POST "$BASE_URL/v1/users/me/charters" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d "{\"charter\":\"CGU\",\"version\":\"$CGU_VERSION\"}" > /dev/null
# Idempotency: re-post same version
HTTP_CODE=$(curl_status -X POST "$BASE_URL/v1/users/me/charters" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d "{\"charter\":\"CGU\",\"version\":\"$CGU_VERSION\"}")
[ "$HTTP_CODE" = "201" ] || fail "Charter replay expected 201, got $HTTP_CODE"
ok "POST /users/me/charters (CGU $CGU_VERSION) accepted, replay is idempotent"

# /me reflects the buyer slice
RESP=$(curl -sf "$BASE_URL/v1/users/me" -H "Authorization: Bearer $ACCESS_TOKEN")
BUYER_TAGS=$(json_get "$RESP" "['data']['buyerProfile']['dietaryTags']")
BUYER_ADDR=$(json_get "$RESP" "['data']['buyerProfile']['defaultAddress']['fullAddress']")
[ "$BUYER_TAGS" = "HALAL,GLUTEN_FREE" ] || fail "/me did not surface dietary tags"
[ "$BUYER_ADDR" = "13 rue de Test" ] || fail "/me did not surface address: got '$BUYER_ADDR'"
ok "/users/me reflects the buyer's full setup"

# Buyer onboarding: everything should be done now.
RESP=$(curl -sf "$BASE_URL/v1/users/me/onboarding" -H "Authorization: Bearer $ACCESS_TOKEN")
NEXT=$(json_get "$RESP" "['data']['next']")
ADDR_STATUS=$(json_get "$RESP" "['data']['steps']['addresses']")
PREFS_STATUS=$(json_get "$RESP" "['data']['steps']['preferences']")
[ "$NEXT" = "" ] || fail "Buyer next should be null when done, got '$NEXT'"
[ "$ADDR_STATUS" = "complete" ] || fail "addresses should be complete, got '$ADDR_STATUS'"
[ "$PREFS_STATUS" = "complete" ] || fail "preferences should be complete, got '$PREFS_STATUS'"
ok "Onboarding: buyer fully done (next=null, all steps complete)"

# ============================================================================
# 2. Seller branch (TRAITEUR — exercises business endpoint)
# ============================================================================

step "Seller: full signup flow (TRAITEUR — has business + cuisines)"
fresh_user "seller"
curl -sf -X POST "$BASE_URL/v1/users" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"firstName":"Test","lastName":"Seller","role":"SELLER","acceptedCgu":true,"acceptedCgv":true}' > /dev/null
ok "Gate 2 (POST /v1/users) created SELLER stub"

# Onboarding: fresh SELLER → next='profile' (no category yet, so business
# defaults to incomplete rather than skipped).
RESP=$(curl -sf "$BASE_URL/v1/users/me/onboarding" -H "Authorization: Bearer $ACCESS_TOKEN")
NEXT=$(json_get "$RESP" "['data']['next']")
CAN_LIST=$(json_get "$RESP" "['data']['canList']")
[ "$NEXT" = "profile" ] || fail "Fresh seller next should be 'profile', got '$NEXT'"
[ "$CAN_LIST" = "False" ] || fail "canList should be false for fresh seller, got '$CAN_LIST'"
ok "Onboarding: fresh seller next=profile, canList=false"

curl -sf -X PUT "$BASE_URL/v1/users/me/addresses/seller-pickup" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"fullAddress":"5 rue de Test","city":"Paris","postalCode":"75004","lat":48.857,"lng":2.359}' > /dev/null
ok "PUT /addresses/seller-pickup with coords"

curl -sf -X PUT "$BASE_URL/v1/sellers/me/profile" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "category":"TRAITEUR",
    "displayName":"Test Traiteur",
    "bio":"Test seller for Phase B",
    "profilePhotoUrl":"avatars/test-seller.jpg",
    "dateOfBirth":"1985-03-12",
    "neighborhood":"Marais",
    "deliveryRadiusKm":5,
    "deliveryFeeCents":250,
    "prepMinMinutes":20,
    "prepMaxMinutes":35,
    "hygieneCommitment":true
  }' > /dev/null
ok "PUT /sellers/me/profile (TRAITEUR)"

# Business — must succeed with valid SIRET (Luhn-passing test value).
RESP=$(curl -sf -X PUT "$BASE_URL/v1/sellers/me/business" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "businessName":"Test Traiteur SARL",
    "siret":"73282932000074",
    "facadeUrl":"seller-facades/test.jpg",
    "openingHours":[
      {"dayOfWeek":"MONDAY","startTime":"09:00","endTime":"18:00"},
      {"dayOfWeek":"TUESDAY","startTime":"09:00","endTime":"18:00"}
    ]
  }')
HOURS_COUNT=$(json_get "$RESP" "['data']['openingHours']")
[ -n "$HOURS_COUNT" ] || fail "Business response missing openingHours array"
ok "PUT /sellers/me/business + 2 opening-hours rows"

# Cuisines
curl -sf -X PUT "$BASE_URL/v1/sellers/me/cuisines" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"cuisines":["FRANCAISE","ITALIENNE"],"dishTypes":["PLAT","ENTREE"]}' > /dev/null
ok "PUT /sellers/me/cuisines"

# Replace test: send a different set, should fully replace
curl -sf -X PUT "$BASE_URL/v1/sellers/me/cuisines" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"cuisines":["FRANCAISE"],"dishTypes":["PLAT","DESSERT"]}' > /dev/null
CUISINE_COUNT=$(db_query "SELECT COUNT(*) FROM \"SellerCuisine\" WHERE \"userId\" IN (SELECT id FROM \"User\" WHERE email LIKE 'signup-seller-%')")
[ "$CUISINE_COUNT" = "1" ] || fail "Cuisines should replace not append; expected 1 row, got $CUISINE_COUNT"
ok "Cuisines fully replace on re-PUT (1 cuisine row after second call)"

# KYC: ID front + back + selfie
for kyc_type in ID_FRONT ID_BACK SELFIE; do
  curl -sf -X POST "$BASE_URL/v1/kyc/documents" \
    -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
    -d "{\"type\":\"$kyc_type\",\"fileUrl\":\"kyc/test/$kyc_type.jpg\",\"idDocumentType\":\"CARTE_IDENTITE\"}" > /dev/null
done
ok "POST /kyc/documents x3 (ID_FRONT, ID_BACK, SELFIE)"

# Charters: hygiene
curl -sf -X POST "$BASE_URL/v1/users/me/charters" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d "{\"charter\":\"HYGIENE\",\"version\":\"$HYGIENE_VERSION\"}" > /dev/null
ok "POST /users/me/charters (HYGIENE)"

# /me final check
RESP=$(curl -sf "$BASE_URL/v1/users/me" -H "Authorization: Bearer $ACCESS_TOKEN")
SELLER_CAT=$(json_get "$RESP" "['data']['sellerProfile']['category']")
SELLER_BIZ=$(json_get "$RESP" "['data']['sellerProfile']['businessName']")
SELLER_SIRET=$(json_get "$RESP" "['data']['sellerProfile']['siret']")
SELLER_CUISINES=$(json_get "$RESP" "['data']['sellerProfile']['cuisineTypes']")
[ "$SELLER_CAT" = "TRAITEUR" ] || fail "/me wrong category: $SELLER_CAT"
[ "$SELLER_BIZ" = "Test Traiteur SARL" ] || fail "/me wrong businessName: $SELLER_BIZ"
[ "$SELLER_SIRET" = "73282932000074" ] || fail "/me wrong siret: $SELLER_SIRET"
[ "$SELLER_CUISINES" = "FRANCAISE" ] || fail "/me wrong cuisines: $SELLER_CUISINES"
ok "/users/me reflects seller's complete setup"

# Seller onboarding: next=null (all steps done) but canList=false because
# KYC documents are still PENDING admin review.
RESP=$(curl -sf "$BASE_URL/v1/users/me/onboarding" -H "Authorization: Bearer $ACCESS_TOKEN")
NEXT=$(json_get "$RESP" "['data']['next']")
KYC_REVIEW=$(json_get "$RESP" "['data']['kycReviewState']")
CAN_LIST=$(json_get "$RESP" "['data']['canList']")
KYC_ID_STATUS=$(json_get "$RESP" "['data']['steps']['kyc_id']")
BUSINESS_STATUS=$(json_get "$RESP" "['data']['steps']['business']")
[ "$NEXT" = "" ] || fail "Seller next should be null when fully filled, got '$NEXT'"
[ "$KYC_REVIEW" = "PENDING" ] || fail "kycReviewState should be PENDING, got '$KYC_REVIEW'"
[ "$CAN_LIST" = "False" ] || fail "canList should be false while KYC pending, got '$CAN_LIST'"
[ "$KYC_ID_STATUS" = "pending_review" ] || fail "kyc_id should be pending_review, got '$KYC_ID_STATUS'"
[ "$BUSINESS_STATUS" = "complete" ] || fail "TRAITEUR business should be complete, got '$BUSINESS_STATUS'"
ok "Onboarding: TRAITEUR seller next=null, kycReviewState=PENDING, canList=false (awaiting admin)"

# ============================================================================
# 3. Driver branch
# ============================================================================

step "Driver: full signup flow"
fresh_user "driver"
curl -sf -X POST "$BASE_URL/v1/users" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"firstName":"Test","lastName":"Driver","role":"DRIVER","acceptedCgu":true,"acceptedCgv":true}' > /dev/null
ok "Gate 2 (POST /v1/users) created DRIVER stub"

curl -sf -X PUT "$BASE_URL/v1/users/me/addresses/driver-home" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"fullAddress":"8 boulevard de Test","city":"Paris","postalCode":"75011","lat":48.87,"lng":2.382}' > /dev/null
ok "PUT /addresses/driver-home"

curl -sf -X PUT "$BASE_URL/v1/drivers/me/vehicle" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"vehicleType":"BICYCLE","dateOfBirth":"1996-04-22"}' > /dev/null
ok "PUT /drivers/me/vehicle (BICYCLE + DOB)"

curl -sf -X PUT "$BASE_URL/v1/drivers/me/zones" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"zones":["Bastille","Marais","Belleville"]}' > /dev/null
ok "PUT /drivers/me/zones (3 zones)"

# Bicycle driver: ID + selfie only (no DRIVING_LICENSE — vehicle isn't motorized)
for kyc_type in ID_FRONT ID_BACK SELFIE; do
  curl -sf -X POST "$BASE_URL/v1/kyc/documents" \
    -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
    -d "{\"type\":\"$kyc_type\",\"fileUrl\":\"kyc/test/$kyc_type.jpg\",\"idDocumentType\":\"CARTE_IDENTITE\"}" > /dev/null
done
ok "POST /kyc/documents x3 (ID_FRONT, ID_BACK, SELFIE)"

# Driver tries to submit a motorized doc → rejected
HTTP_CODE=$(curl_status -X POST "$BASE_URL/v1/kyc/documents" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"DRIVING_LICENSE","fileUrl":"kyc/test/license.jpg"}')
[ "$HTTP_CODE" = "400" ] || fail "Bicycle driver submitting DRIVING_LICENSE should 400, got $HTTP_CODE"
ok "Bicycle driver blocked from submitting motorized-only document (400)"

curl -sf -X POST "$BASE_URL/v1/users/me/charters" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d "{\"charter\":\"PUNCTUALITY\",\"version\":\"v1.0\"}" > /dev/null
curl -sf -X POST "$BASE_URL/v1/users/me/charters" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d "{\"charter\":\"CARE\",\"version\":\"v1.0\"}" > /dev/null
ok "POST /users/me/charters (PUNCTUALITY + CARE)"

RESP=$(curl -sf "$BASE_URL/v1/users/me" -H "Authorization: Bearer $ACCESS_TOKEN")
DRIVER_VEHICLE=$(json_get "$RESP" "['data']['driverProfile']['vehicleType']")
DRIVER_ZONES=$(json_get "$RESP" "['data']['driverProfile']['operatingZones']")
DRIVER_ADDR=$(json_get "$RESP" "['data']['driverProfile']['baseAddress']['fullAddress']")
[ "$DRIVER_VEHICLE" = "BICYCLE" ] || fail "/me wrong vehicleType: $DRIVER_VEHICLE"
[ "$DRIVER_ZONES" = "Bastille,Marais,Belleville" ] || fail "/me wrong zones: $DRIVER_ZONES"
[ "$DRIVER_ADDR" = "8 boulevard de Test" ] || fail "/me wrong base address"
ok "/users/me reflects driver's complete setup"

# Driver onboarding: next=null (everything filled), documents=skipped (bicycle
# is non-motorized), canDeliver=false (KYC docs still PENDING admin).
RESP=$(curl -sf "$BASE_URL/v1/users/me/onboarding" -H "Authorization: Bearer $ACCESS_TOKEN")
NEXT=$(json_get "$RESP" "['data']['next']")
DOCS_STATUS=$(json_get "$RESP" "['data']['steps']['documents']")
KYC_REVIEW=$(json_get "$RESP" "['data']['kycReviewState']")
CAN_DELIVER=$(json_get "$RESP" "['data']['canDeliver']")
[ "$NEXT" = "" ] || fail "Bicycle driver next should be null when filled, got '$NEXT'"
[ "$DOCS_STATUS" = "skipped" ] || fail "documents should be skipped for bicycle, got '$DOCS_STATUS'"
[ "$KYC_REVIEW" = "PENDING" ] || fail "kycReviewState should be PENDING, got '$KYC_REVIEW'"
[ "$CAN_DELIVER" = "False" ] || fail "canDeliver should be false while KYC pending, got '$CAN_DELIVER'"
ok "Onboarding: bicycle driver next=null, documents=skipped, canDeliver=false (awaiting admin)"

# ============================================================================
# 3b. Fait-maison seller — auto-approves KYC, so canList flips true without admin.
# ============================================================================

step "Seller (FAIT_MAISON): auto-approve KYC → canList=true without admin"
fresh_user "fm-seller"
curl -sf -X POST "$BASE_URL/v1/users" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"firstName":"Fait","lastName":"Maison","role":"SELLER","acceptedCgu":true,"acceptedCgv":true}' > /dev/null

curl -sf -X PUT "$BASE_URL/v1/users/me/addresses/seller-pickup" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"fullAddress":"3 rue FM","city":"Paris","postalCode":"75004","lat":48.857,"lng":2.359}' > /dev/null

curl -sf -X PUT "$BASE_URL/v1/sellers/me/profile" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "category":"FAIT_MAISON",
    "displayName":"Chez FM",
    "profilePhotoUrl":"avatars/fm.jpg",
    "dateOfBirth":"1985-03-12",
    "neighborhood":"Marais",
    "deliveryRadiusKm":3,
    "deliveryFeeCents":200,
    "prepMinMinutes":20,
    "prepMaxMinutes":30
  }' > /dev/null

curl -sf -X PUT "$BASE_URL/v1/sellers/me/cuisines" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"cuisines":["FRANCAISE"],"dishTypes":["PLAT"]}' > /dev/null

curl -sf -X POST "$BASE_URL/v1/users/me/charters" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d "{\"charter\":\"HYGIENE\",\"version\":\"$HYGIENE_VERSION\"}" > /dev/null
curl -sf -X POST "$BASE_URL/v1/users/me/charters" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"charter":"FAIT_MAISON","version":"v1.0"}' > /dev/null

# Fait-maison should NOT need a business row or KYC docs.
HTTP_CODE=$(curl_status -X PUT "$BASE_URL/v1/sellers/me/business" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"businessName":"x","siret":"73282932000074"}')
[ "$HTTP_CODE" = "400" ] || fail "Fait-maison /sellers/me/business should 400, got $HTTP_CODE"

HTTP_CODE=$(curl_status -X POST "$BASE_URL/v1/kyc/documents" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"ID_FRONT","fileUrl":"kyc/fm/id-front.jpg","idDocumentType":"CARTE_IDENTITE"}')
[ "$HTTP_CODE" = "400" ] || fail "Fait-maison /kyc/documents should 400, got $HTTP_CODE"

RESP=$(curl -sf "$BASE_URL/v1/users/me/onboarding" -H "Authorization: Bearer $ACCESS_TOKEN")
NEXT=$(json_get "$RESP" "['data']['next']")
KYC_REVIEW=$(json_get "$RESP" "['data']['kycReviewState']")
CAN_LIST=$(json_get "$RESP" "['data']['canList']")
BUSINESS_STATUS=$(json_get "$RESP" "['data']['steps']['business']")
KYC_ID_STATUS=$(json_get "$RESP" "['data']['steps']['kyc_id']")
[ "$NEXT" = "" ] || fail "Fait-maison next should be null, got '$NEXT'"
[ "$BUSINESS_STATUS" = "skipped" ] || fail "Fait-maison business should be skipped, got '$BUSINESS_STATUS'"
[ "$KYC_ID_STATUS" = "skipped" ] || fail "Fait-maison kyc_id should be skipped, got '$KYC_ID_STATUS'"
[ "$KYC_REVIEW" = "APPROVED" ] || fail "Fait-maison kycReviewState should be APPROVED, got '$KYC_REVIEW'"
[ "$CAN_LIST" = "True" ] || fail "Fait-maison canList should be true, got '$CAN_LIST'"
ok "Fait-maison: business=skipped, kyc_id=skipped, kycReviewState=APPROVED, canList=true"

# ============================================================================
# 4. Cross-role guards
# ============================================================================

step "Guards: buyer cannot PUT seller endpoints"
fresh_user "buyer-guard"
curl -sf -X POST "$BASE_URL/v1/users" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"firstName":"G","lastName":"B","role":"BUYER","acceptedCgu":true,"acceptedCgv":true}' > /dev/null

HTTP_CODE=$(curl_status -X PUT "$BASE_URL/v1/sellers/me/profile" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"category":"FAIT_MAISON","displayName":"X","profilePhotoUrl":"p","dateOfBirth":"1990-01-01"}')
[ "$HTTP_CODE" = "403" ] || fail "Buyer hitting /sellers/me/profile should 403, got $HTTP_CODE"

HTTP_CODE=$(curl_status -X PUT "$BASE_URL/v1/users/me/addresses/seller-pickup" \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"fullAddress":"x","city":"x","postalCode":"x"}')
[ "$HTTP_CODE" = "400" ] || fail "Buyer hitting /addresses/seller-pickup should 400, got $HTTP_CODE"

ok "Buyer correctly blocked from seller endpoints (403 / 400)"

echo
echo "${GREEN}✓ all $STEP_COUNT steps passed${RESET}"
