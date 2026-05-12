#!/usr/bin/env bash
# =============================================================================
# IncaCook end-to-end smoke test.
#
# Walks the full marketplace flow against a running local stack:
#   buyer signup state → place order → pay → seller fulfills → driver
#   delivers → buyer reviews & bookmarks → cancel-with-refund → idempotency.
#
# Prerequisites:
#   - `supabase start` running
#   - `docker start incacook-test-redis` running
#   - `pnpm test:start:dev` running on :3000
#   - `stripe listen --forward-to http://localhost:3000/v1/stripe/webhook`
#     running (so payment_intent.succeeded webhooks reach the API)
#   - .env.test has real Stripe test-mode keys
#
# Run:
#   bash scripts/smoke-test.sh
#
# Exits 0 if every assertion passes, non-zero on first failure.
# =============================================================================

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
DB_CONTAINER="${DB_CONTAINER:-supabase_db_incacook-server}"
WEBHOOK_WAIT_SECONDS="${WEBHOOK_WAIT_SECONDS:-3}"

# Pull STRIPE_SECRET_KEY out of .env.test for the transfers verification step.
STRIPE_SECRET_KEY="${STRIPE_SECRET_KEY:-$(grep '^STRIPE_SECRET_KEY=' .env.test 2>/dev/null | cut -d= -f2-)}"

# ---------- colors ----------
if [ -t 1 ]; then
  GREEN=$'\033[0;32m'; RED=$'\033[0;31m'; YELLOW=$'\033[0;33m'; CYAN=$'\033[0;36m'; RESET=$'\033[0m'
else
  GREEN=''; RED=''; YELLOW=''; CYAN=''; RESET=''
fi

STEP_COUNT=0
step() {
  STEP_COUNT=$((STEP_COUNT + 1))
  echo
  echo "${CYAN}[$STEP_COUNT] $*${RESET}"
}

ok()   { echo "${GREEN}  ✓${RESET} $*"; }
fail() { echo "${RED}  ✗ $*${RESET}"; exit 1; }
info() { echo "    $*"; }

# ---------- helpers ----------

# Mint a JWT for one of the seeded test roles.
mint_jwt() {
  pnpm -s test:mint-jwt "$1" | tail -1
}

# Query a column from a single row via docker exec psql.
db_query() {
  docker exec "$DB_CONTAINER" psql -U postgres -d postgres -t -A -c "$1" 2>/dev/null | tr -d '[:space:]'
}

# Stash + extract values from JSON responses using python3 (no jq dep).
json_get() {
  python3 -c "import sys, json; print(json.loads(sys.argv[1])$2)" "$1" 2>/dev/null
}

# ---------- preflight ----------

step "Preflight"
if ! curl -sf "$BASE_URL/v1/health" > /dev/null; then
  fail "API not reachable at $BASE_URL — is \`pnpm test:start:dev\` running?"
fi
ok "API server responding"

if ! docker ps --filter "name=$DB_CONTAINER" --format '{{.Names}}' | grep -q "$DB_CONTAINER"; then
  fail "Supabase Postgres container '$DB_CONTAINER' not running — \`supabase start\`?"
fi
ok "Postgres container running"

if ! docker ps --filter "name=incacook-test-redis" --format '{{.Names}}' | grep -q "incacook-test-redis"; then
  fail "Redis container 'incacook-test-redis' not running — \`docker start incacook-test-redis\`?"
fi
ok "Redis container running"

if ! command -v stripe > /dev/null; then
  fail "Stripe CLI not on PATH — install via \`brew install stripe/stripe-cli/stripe\`"
fi
ok "Stripe CLI installed"

if ! pgrep -f "stripe listen" > /dev/null; then
  fail "\`stripe listen --forward-to $BASE_URL/v1/stripe/webhook\` is not running — payment webhooks won't reach the API"
fi
ok "Stripe webhook forwarder running"

# ---------- 1. reset state ----------

step "Reset seed data"
pnpm -s test:db:seed > /dev/null
ok "Test users + listings reseeded"

BUYER=$(mint_jwt buyer)
SELLER=$(mint_jwt seller)
DRIVER=$(mint_jwt driver)
ok "JWTs minted (buyer, seller, driver)"

# Look up seeded listing IDs.
COUSCOUS_ID=$(db_query "SELECT id FROM \"Listing\" WHERE name = 'Couscous Royal' LIMIT 1")
SALADE_ID=$(db_query "SELECT id FROM \"Listing\" WHERE name = 'Salade Niçoise' LIMIT 1")
TARTE_ID=$(db_query "SELECT id FROM \"Listing\" WHERE name = 'Tarte aux Pommes' LIMIT 1")
[ -n "$COUSCOUS_ID" ] || fail "Couldn't find seeded Couscous Royal"
ok "Seeded listings: couscous=$COUSCOUS_ID  salade=$SALADE_ID  tarte=$TARTE_ID"

SELLER_USER_ID=$(db_query "SELECT id FROM \"User\" WHERE email = 'test+seller@incacook.test'")

# ---------- 2. happy path: place → pay → fulfill → deliver → review ----------

step "Place a DELIVERY order"
ORDER_RESPONSE=$(curl -sf -X POST "$BASE_URL/v1/orders" \
  -H "Authorization: Bearer $BUYER" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: smoke-happy-$(date +%s%N)" \
  -d "{
    \"items\": [{ \"listingId\": \"$COUSCOUS_ID\", \"quantity\": 1 }],
    \"fulfillmentChoice\": \"DELIVERY\",
    \"dropoffAddress\": {
      \"fullAddress\": \"12 rue de la Bastille\", \"city\": \"Paris\", \"postalCode\": \"75011\",
      \"type\": \"HOME\", \"lat\": 48.853, \"lng\": 2.369
    }
  }")
ORDER_ID=$(json_get "$ORDER_RESPONSE" "['data']['order']['id']")
STATUS=$(json_get "$ORDER_RESPONSE" "['data']['order']['status']")
BUYER_TOTAL=$(json_get "$ORDER_RESPONSE" "['data']['order']['buyerTotalCents']")
CLIENT_SECRET=$(json_get "$ORDER_RESPONSE" "['data']['paymentIntentClientSecret']")
PI_ID=${CLIENT_SECRET%%_secret_*}

[ "$STATUS" = "PENDING" ] || fail "Expected status=PENDING got $STATUS"
[ "$BUYER_TOTAL" = "1750" ] || fail "Expected buyerTotalCents=1750 got $BUYER_TOTAL"
ok "Order $ORDER_ID  status=PENDING  buyerTotal=1750¢  pi=$PI_ID"

step "Confirm PaymentIntent via Stripe test card"
stripe payment_intents confirm "$PI_ID" \
  --payment-method=pm_card_visa \
  --return-url=http://localhost:3000/stub > /dev/null 2>&1 || fail "PaymentIntent confirm failed"
info "Waiting ${WEBHOOK_WAIT_SECONDS}s for webhook to fire..."
sleep "$WEBHOOK_WAIT_SECONDS"

STATUS=$(db_query "SELECT status FROM \"Order\" WHERE id = '$ORDER_ID'")
[ "$STATUS" = "CONFIRMED" ] || fail "Expected status=CONFIRMED after webhook, got $STATUS"
ok "Webhook delivered → order CONFIRMED"

step "Seller: start-preparing"
curl -sf -X POST "$BASE_URL/v1/orders/$ORDER_ID/start-preparing" \
  -H "Authorization: Bearer $SELLER" > /dev/null
STATUS=$(db_query "SELECT status FROM \"Order\" WHERE id = '$ORDER_ID'")
[ "$STATUS" = "PREPARING" ] || fail "Expected PREPARING got $STATUS"
ok "Order → PREPARING"

step "Seller: mark-ready (also creates Delivery)"
curl -sf -X POST "$BASE_URL/v1/orders/$ORDER_ID/mark-ready" \
  -H "Authorization: Bearer $SELLER" > /dev/null
STATUS=$(db_query "SELECT status FROM \"Order\" WHERE id = '$ORDER_ID'")
DELIVERY_ID=$(db_query "SELECT id FROM \"Delivery\" WHERE \"orderId\" = '$ORDER_ID'")
DELIVERY_STATUS=$(db_query "SELECT status FROM \"Delivery\" WHERE id = '$DELIVERY_ID'")
[ "$STATUS" = "READY" ] || fail "Expected order READY got $STATUS"
[ -n "$DELIVERY_ID" ] || fail "Expected Delivery row to be auto-created"
[ "$DELIVERY_STATUS" = "SEARCHING" ] || fail "Expected delivery SEARCHING got $DELIVERY_STATUS"
ok "Order → READY,  Delivery $DELIVERY_ID → SEARCHING"

step "Driver: list available deliveries"
AVAILABLE_COUNT=$(curl -sf "$BASE_URL/v1/drivers/me/deliveries/available" \
  -H "Authorization: Bearer $DRIVER" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['data']))")
[ "$AVAILABLE_COUNT" = "1" ] || fail "Expected 1 available delivery, got $AVAILABLE_COUNT"
ok "$AVAILABLE_COUNT delivery available to claim"

step "Driver: claim (atomic race-safe)"
curl -sf -X POST "$BASE_URL/v1/drivers/me/deliveries/$DELIVERY_ID/claim" \
  -H "Authorization: Bearer $DRIVER" > /dev/null
STATUS=$(db_query "SELECT status FROM \"Delivery\" WHERE id = '$DELIVERY_ID'")
[ "$STATUS" = "ASSIGNED" ] || fail "Expected ASSIGNED got $STATUS"
ok "Delivery → ASSIGNED"

step "Driver: arrive-pickup"
curl -sf -X POST "$BASE_URL/v1/drivers/me/deliveries/$DELIVERY_ID/arrive-pickup" \
  -H "Authorization: Bearer $DRIVER" > /dev/null
STATUS=$(db_query "SELECT status FROM \"Delivery\" WHERE id = '$DELIVERY_ID'")
[ "$STATUS" = "AT_PICKUP" ] || fail "Expected AT_PICKUP got $STATUS"
ok "Delivery → AT_PICKUP"

step "Driver: confirm-pickup (also flips Order → IN_DELIVERY)"
curl -sf -X POST "$BASE_URL/v1/drivers/me/deliveries/$DELIVERY_ID/confirm-pickup" \
  -H "Authorization: Bearer $DRIVER" > /dev/null
D_STATUS=$(db_query "SELECT status FROM \"Delivery\" WHERE id = '$DELIVERY_ID'")
O_STATUS=$(db_query "SELECT status FROM \"Order\" WHERE id = '$ORDER_ID'")
[ "$D_STATUS" = "PICKED_UP" ] || fail "Expected delivery PICKED_UP got $D_STATUS"
[ "$O_STATUS" = "IN_DELIVERY" ] || fail "Expected order IN_DELIVERY got $O_STATUS"
ok "Delivery → PICKED_UP,  Order → IN_DELIVERY"

step "Driver: confirm-delivery (triggers Stripe transfers to seller + driver)"
curl -sf -X POST "$BASE_URL/v1/drivers/me/deliveries/$DELIVERY_ID/confirm-delivery" \
  -H "Authorization: Bearer $DRIVER" > /dev/null
D_STATUS=$(db_query "SELECT status FROM \"Delivery\" WHERE id = '$DELIVERY_ID'")
O_STATUS=$(db_query "SELECT status FROM \"Order\" WHERE id = '$ORDER_ID'")
[ "$D_STATUS" = "DELIVERED" ] || fail "Expected delivery DELIVERED got $D_STATUS"
[ "$O_STATUS" = "DELIVERED" ] || fail "Expected order DELIVERED got $O_STATUS"
ok "Delivery → DELIVERED,  Order → DELIVERED"
TRANSFER_COUNT=$(stripe transfers list --limit=5 --api-key="$STRIPE_SECRET_KEY" 2>/dev/null \
  | grep -c "\"orderId\": \"$ORDER_ID\"" || true)
[ "$TRANSFER_COUNT" = "2" ] || fail "Expected 2 Stripe transfers for $ORDER_ID, found $TRANSFER_COUNT"
ok "Stripe transfers landed (seller + driver legs, transfer_group matches)"

step "Buyer: review the delivered order"
REVIEW_RESPONSE=$(curl -sf -X POST "$BASE_URL/v1/orders/$ORDER_ID/review" \
  -H "Authorization: Bearer $BUYER" -H "Content-Type: application/json" \
  -d '{ "rating": 5, "body": "Smoke test review",
        "criteriaRatings": [
          { "criterion": "FOOD_QUALITY", "value": 5 },
          { "criterion": "HYGIENE", "value": 92 },
          { "criterion": "PACKAGING", "value": 4.5 }
        ] }')
REVIEW_ID=$(json_get "$REVIEW_RESPONSE" "['data']['id']")
[ -n "$REVIEW_ID" ] || fail "Review not created"
AVG_RATING=$(db_query "SELECT \"averageRating\" FROM \"SellerProfile\" WHERE \"userId\" = '$SELLER_USER_ID'")
REVIEW_COUNT=$(db_query "SELECT \"reviewCount\" FROM \"SellerProfile\" WHERE \"userId\" = '$SELLER_USER_ID'")
[ "$AVG_RATING" = "5" ] || fail "Expected averageRating=5 got $AVG_RATING"
[ "$REVIEW_COUNT" = "1" ] || fail "Expected reviewCount=1 got $REVIEW_COUNT"
ok "Review $REVIEW_ID created;  SellerProfile aggregates updated (rating=5, count=1)"

step "Buyer: bookmark a listing"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/v1/listings/$TARTE_ID/bookmark" \
  -H "Authorization: Bearer $BUYER")
[ "$HTTP" = "204" ] || fail "Expected 204 got $HTTP"
ok "Bookmark created (204)"

step "Buyer: re-bookmark same listing (idempotent)"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/v1/listings/$TARTE_ID/bookmark" \
  -H "Authorization: Bearer $BUYER")
[ "$HTTP" = "204" ] || fail "Expected 204 (idempotent) got $HTTP"
ok "Duplicate bookmark is a no-op"

step "Seller stats reflect review + bookmark"
STATS=$(curl -sf "$BASE_URL/v1/sellers/$SELLER_USER_ID/stats" -H "Authorization: Bearer $BUYER")
RATING=$(json_get "$STATS" "['data']['rating']")
RC=$(json_get "$STATS" "['data']['reviewCount']")
MEALS_SOLD=$(json_get "$STATS" "['data']['mealsSold']")
MEALS_SAVED=$(json_get "$STATS" "['data']['mealsSaved']")
[ "$RATING" = "5" ] || fail "rating=$RATING"
[ "$RC" = "1" ] || fail "reviewCount=$RC"
[ "$MEALS_SOLD" = "1" ] || fail "mealsSold=$MEALS_SOLD"
[ "$MEALS_SAVED" = "1" ] || fail "mealsSaved=$MEALS_SAVED"
ok "rating=5  reviewCount=1  mealsSold=1  mealsSaved=1"

# ---------- 3. cancellation + refund ----------

step "Place a 2nd order for cancellation"
RESPONSE=$(curl -sf -X POST "$BASE_URL/v1/orders" \
  -H "Authorization: Bearer $BUYER" -H "Content-Type: application/json" \
  -H "Idempotency-Key: smoke-cancel-$(date +%s%N)" \
  -d "{
    \"items\": [{ \"listingId\": \"$SALADE_ID\", \"quantity\": 1 }],
    \"fulfillmentChoice\": \"DELIVERY\",
    \"dropoffAddress\": { \"fullAddress\": \"x\", \"city\": \"Paris\", \"postalCode\": \"75011\", \"type\": \"HOME\" }
  }")
CANCEL_ORDER=$(json_get "$RESPONSE" "['data']['order']['id']")
CANCEL_PI=$(json_get "$RESPONSE" "['data']['paymentIntentClientSecret']")
CANCEL_PI=${CANCEL_PI%%_secret_*}
stripe payment_intents confirm "$CANCEL_PI" --payment-method=pm_card_visa --return-url=http://localhost:3000/stub > /dev/null 2>&1
sleep "$WEBHOOK_WAIT_SECONDS"
STATUS=$(db_query "SELECT status FROM \"Order\" WHERE id = '$CANCEL_ORDER'")
[ "$STATUS" = "CONFIRMED" ] || fail "Expected CONFIRMED got $STATUS"
ok "Order $CANCEL_ORDER placed + paid, status=CONFIRMED"

PRE_STOCK=$(db_query "SELECT \"portionsLeft\" FROM \"Listing\" WHERE id = '$SALADE_ID'")
ok "Salade portions left = $PRE_STOCK (decremented from 3)"

step "Seller cancels — inventory restored + refund issued"
curl -sf -X POST "$BASE_URL/v1/orders/$CANCEL_ORDER/cancel" \
  -H "Authorization: Bearer $SELLER" -H "Content-Type: application/json" \
  -d '{ "reason": "Smoke test cancel" }' > /dev/null
sleep 1
POST_STOCK=$(db_query "SELECT \"portionsLeft\" FROM \"Listing\" WHERE id = '$SALADE_ID'")
ORDER_STATUS=$(db_query "SELECT status FROM \"Order\" WHERE id = '$CANCEL_ORDER'")
REFUNDED=$(db_query "SELECT \"stripeRefundId\" IS NOT NULL FROM \"Order\" WHERE id = '$CANCEL_ORDER'")
[ "$ORDER_STATUS" = "CANCELLED" ] || fail "Expected CANCELLED got $ORDER_STATUS"
[ "$POST_STOCK" -gt "$PRE_STOCK" ] || fail "Inventory not restored ($PRE_STOCK → $POST_STOCK)"
[ "$REFUNDED" = "t" ] || fail "Refund not recorded"
ok "Cancel + refund:  order=CANCELLED  inventory restored ($PRE_STOCK → $POST_STOCK)  refund recorded"

# ---------- 4. idempotency ----------

step "Idempotency: replay with same key + same body → same order"
KEY="smoke-idem-$(date +%s%N)"
BODY="{
  \"items\": [{ \"listingId\": \"$TARTE_ID\", \"quantity\": 1 }],
  \"fulfillmentChoice\": \"PICKUP\",
  \"dropoffAddress\": { \"fullAddress\": \"x\", \"city\": \"Paris\", \"postalCode\": \"75011\", \"type\": \"HOME\" }
}"
R1=$(curl -sf -X POST "$BASE_URL/v1/orders" -H "Authorization: Bearer $BUYER" \
  -H "Content-Type: application/json" -H "Idempotency-Key: $KEY" -d "$BODY")
R2=$(curl -sf -X POST "$BASE_URL/v1/orders" -H "Authorization: Bearer $BUYER" \
  -H "Content-Type: application/json" -H "Idempotency-Key: $KEY" -d "$BODY")
O1=$(json_get "$R1" "['data']['order']['id']")
O2=$(json_get "$R2" "['data']['order']['id']")
[ "$O1" = "$O2" ] || fail "Idempotency replay returned a different order ($O1 vs $O2)"
ok "Same key + same body returns same order ($O1)"

step "Idempotency: same key + DIFFERENT body → 409"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/v1/orders" \
  -H "Authorization: Bearer $BUYER" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $KEY" \
  -d "{ \"items\": [{ \"listingId\": \"$TARTE_ID\", \"quantity\": 2 }],
        \"fulfillmentChoice\": \"PICKUP\",
        \"dropoffAddress\": { \"fullAddress\": \"x\", \"city\": \"x\", \"postalCode\": \"x\" } }")
[ "$HTTP" = "409" ] || fail "Expected 409 got $HTTP"
ok "Different body with reused key → 409"

step "Missing Idempotency-Key header → 400"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/v1/orders" \
  -H "Authorization: Bearer $BUYER" -H "Content-Type: application/json" -d "$BODY")
[ "$HTTP" = "400" ] || fail "Expected 400 got $HTTP"
ok "Missing Idempotency-Key → 400"

# ---------- 5. wrap up ----------

echo
echo "${GREEN}✓ all $STEP_COUNT steps passed${RESET}"
