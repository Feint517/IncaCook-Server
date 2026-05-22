# Listings / posting API — Flutter integration

Endpoint reference for the listings / posting feature, intended as a
handoff doc for the Flutter side. Every route, every field, every
validation rule, with concrete request/response examples taken from
the running server.

This doc is the **source of truth for what the API actually does**.
If the design doc (`posting-module.md`) disagrees, this doc wins —
it reflects the real shape on the wire.

---

## 1. Base setup

| Setting | Value |
|---|---|
| Base URL (production) | `https://incacook-api-production.up.railway.app` |
| Base URL (local dev) | `http://localhost:3001` (iOS sim), `http://10.0.2.2:3001` (Android emu) |
| Version prefix | `/v1` (URI versioning — every route is `/v1/…`) |
| Auth header | `Authorization: Bearer <supabase-jwt>` |
| Content-Type | `application/json` for all bodies |
| Wire casing | **camelCase** for both request and response field names |

The same `Authorization` header your existing `auth_interceptor.dart`
attaches works for every route below. No special permissions header
needed — role + KYC checks happen server-side from the JWT's `sub`.

---

## 2. Response envelope

Every response (success or error) is wrapped in a uniform envelope.

### Success — single resource

```jsonc
{
  "success": true,
  "data": { /* the resource */ },
  "meta": {
    "timestamp": "2026-05-18T16:28:50.000Z",
    "version": "v1"
  }
}
```

### Success — paginated list

```jsonc
{
  "success": true,
  "data": [ /* array of items */ ],
  "pagination": { "hasMore": false, "limit": 20 },
  "meta": { /* … */ }
}
```

> **Important:** paginated responses put the array directly under `data`
> (not under `data.items`). `pagination` lives at the **top level**, not
> inside `data`.

### Error

```jsonc
{
  "success": false,
  "error": {
    "statusCode": 422,
    "message": "Fait-maison listings are capped at 4.50€",
    "error": "UNPROCESSABLE_ENTITY",
    "code": "INCACOOK_PRICE_CAP_EXCEEDED",
    "timestamp": "2026-05-18T16:28:31.332Z",
    "path": "/v1/listings",
    "correlationId": "01KRXYNT7053D6TJXQQN9JQWSJ",
    "details": { /* optional, varies by error */ }
  }
}
```

Branch on `error.code` for known business rules, fall back to
`error.statusCode` and `error.message` for everything else. The full
code catalog lives in §7.

---

## 3. Enums reference

| Enum | Values | Used by |
|---|---|---|
| `SellerCategory` | `FAIT_MAISON`, `RESTAURANT`, `TRAITEUR` | filter, response |
| `CuisineType` | `ORIENTALE`, `ITALIENNE`, `FRANCAISE`, …  (see backend `cuisine_type` enum) | `cuisineTypes`, filter |
| `DishType` | `ENTREE`, `PLAT`, `DESSERT`, `COCKTAIL_DINATOIRE`, **`BOISSON`** | `dishTypes`, filter |
| `DietaryTag` | `HALAL`, `VEGAN`, `VEGETARIEN`, `SANS_GLUTEN`, …  | `dietaryTags`, filter |
| `Allergen` | EU 14: `GLUTEN`, `OEUFS`, `LAIT`, `POISSONS`, …  | `allergens`, `avoidAllergens` filter |
| `Fulfillment` | `DELIVERY`, `PICKUP`, `BOTH` | request, response, filter |

**DishType valid set depends on seller category** (server-enforced):

| Category | Allowed dishTypes |
|---|---|
| `FAIT_MAISON` | none — must be empty array |
| `RESTAURANT` | `ENTREE`, `PLAT`, `DESSERT`, `BOISSON` |
| `TRAITEUR` | `ENTREE`, `PLAT`, `DESSERT`, `BOISSON`, `COCKTAIL_DINATOIRE` |

Sending a value outside this set returns 400 with a clear message
listing what's allowed.

---

## 4. The `Listing` resource

The shape returned by every endpoint that yields a single listing
(`POST`, `GET /v1/listings/:id`, `PATCH`, items in `GET /v1/listings`,
items in `GET /v1/sellers/me/listings`).

```jsonc
{
  "id": "01KRXYPD4F7Z94B33EAA6R4Y17",     // ULID
  "sellerId": "...",                      // ULID
  "name": "Tajine au poulet",
  "description": "...",                   // string | null
  "imageUrls": ["listings/abc.jpg"],      // 0..3 storage keys

  // Money in cents (never euros on the wire).
  "priceCents": 350,
  "originalPriceCents": 800,              // number | null
  "discountPercent": 56,                  // number | null

  // null = "cook to order" (restaurant/traiteur). Required + > 0 for fait_maison.
  "portionsLeft": 5,                      // number | null

  "cuisineTypes": ["ORIENTALE"],          // CuisineType[] — 0+ values
  "dishTypes": ["PLAT"],                  // DishType[] — see §3 for category constraints
  "dietaryTags": ["HALAL"],               // DietaryTag[]
  "allergens": ["GLUTEN"],                // Allergen[]
  "otherAllergens": null,                 // string | null — free-text for allergens not in the 14-item enum

  "isAvailable": true,                    // seller's on/off toggle
  "isVeg": false,
  "menuCategory": null,                   // string | null — restaurant/traiteur sub-category ("Pizza mixte")
  "category": "FAIT_MAISON",              // SellerCategory — server-set from seller's profile

  "fulfillment": "BOTH",                  // Fulfillment
  "prepMinutes": 25,

  // null = permanent menu item (restaurant/traiteur). Required for fait_maison.
  "expiresAt": "2026-05-20T16:28:50.000Z", // ISO | null

  "createdAt": "2026-05-18T16:28:50.000Z",
  "updatedAt": "2026-05-18T16:28:50.000Z",

  // Per-listing add-ons (bread, drinks, sauces, …) declared by the seller.
  // Empty array — never null — when the listing has none.
  "extras": [
    {
      "id": "01KRXZ…",                    // ULID
      "label": "Avec pain",
      "priceDeltaCents": 50,              // signed cents; negative allowed (e.g. "no cheese: -50")
      "isSelectedByDefault": false,
      "sortOrder": 0
    }
  ]
}
```

**Buyer-feed-only fields** (present on items returned by `GET /v1/listings`
in addition to everything above):

```jsonc
{
  "sellerName": "Fatima K.",
  "distanceKm": 0.3,         // number | null — null when buyer location unresolved
  "inRange": true,           // boolean | null — distanceKm <= seller.deliveryRadiusKm
  "rating": 4.9,             // number | null — from seller stats
  "reviewCount": 24,
  "extras": []               // always empty on the feed — fetch detail for full extras
}
```

`extras` is intentionally empty on the feed payload — load it lazily
when the buyer opens the detail screen via `GET /v1/listings/:id`.

---

## 5. Endpoints

### 5.1 `POST /v1/listings` — create

Creates a listing. Seller resolved from JWT. KYC = APPROVED required.

```http
POST /v1/listings                                Status: 201
Authorization: Bearer <jwt>
Content-Type: application/json
```

**Request body:**

```jsonc
{
  "name": "Tajine au poulet",                       // required, 1-200 chars
  "description": "Tajine traditionnel mijoté 4h",   // optional, ≤ 2000 chars
  "imageUrls": ["listings/abc.jpg"],                // required, 1-3 keys
  "priceCents": 350,                                // required, >= 0; fait_maison: ≤ 450
  "originalPriceCents": 800,                        // optional; if set, must be >= priceCents
  "discountPercent": 56,                            // optional, 0-100
  "portionsLeft": 5,                                // optional (required for fait_maison), >= 0
  "cuisineTypes": ["ORIENTALE"],                    // optional, unique
  "dishTypes": ["PLAT"],                            // optional, unique, must be valid for category
  "dietaryTags": ["HALAL"],                         // optional, unique
  "allergens": ["GLUTEN"],                          // optional, unique
  "otherAllergens": null,                           // optional, ≤ 500 chars
  "isAvailable": true,                              // optional, defaults to true
  "isVeg": false,                                   // optional, defaults to false
  "menuCategory": "Tajines",                        // optional, ≤ 100 chars (restaurant/traiteur)
  "fulfillment": "BOTH",                            // required
  "prepMinutes": 25,                                // required, >= 0
  "expiresAt": "2026-05-20T18:00:00Z",              // optional (required for fait_maison), ISO, must be in the future
  "extras": [                                       // optional, 0-20 items
    { "label": "Avec pain",      "priceDeltaCents": 50,  "isSelectedByDefault": false },
    { "label": "Sauce piquante", "priceDeltaCents": 50 }
  ]
}
```

- `category` is **never** in the body — derived server-side from the
  authenticated seller's `SellerProfile.category`.
- `extras[].label`: required, 1-120 chars. `priceDeltaCents`: required,
  signed integer (negative allowed). `isSelectedByDefault`: optional,
  defaults to `false`. Server assigns each row a `sortOrder` from its
  position in the array.

**Response:** the full `Listing` shape (§4) wrapped in the standard envelope.

**Common errors:**

| Code | HTTP | When |
|---|---|---|
| `INCACOOK_FORBIDDEN` | 403 | Caller is not a seller, or `kycStatus != APPROVED`. Error message: `"KYC_NOT_APPROVED"` when KYC isn't approved (distinguishes from generic forbidden) |
| `INCACOOK_PRICE_CAP_EXCEEDED` | 422 | `priceCents > 450` for fait_maison seller |
| `INCACOOK_VALIDATION_FAILED` | 422 | Zod/class-validator structural failure (returns `details` with per-field issues) |
| `INCACOOK_UNKNOWN` | 400 | Business validation: `fait_maison listings require portionsLeft`, `… require expiresAt`, `dishTypes ["…"] not allowed for FAIT_MAISON`, `imageUrls cannot have more than 3 entries`, `originalPriceCents must be >= priceCents`, `expiresAt must be in the future` |

> **Why is "business validation" `INCACOOK_UNKNOWN` and not its own code?**
> The error-code registry doesn't have a specific entry for each business
> rule — branching on `error.message` is acceptable for these. Don't
> machine-parse the message; just surface it as user-facing text.

### 5.2 `PATCH /v1/listings/:id` — update

All fields optional; only present fields are updated. Same validation
rules as POST (with merged state: `existing ⊕ dto`). KYC = APPROVED
required. Caller must own the listing.

```http
PATCH /v1/listings/{id}                          Status: 200
```

**`extras` is replace-all.** Sending `extras` clears the existing
add-ons and inserts the new array atomically. Omit `extras` to leave
add-ons unchanged.

**Common errors:** same as §5.1 plus:
| Code | HTTP | When |
|---|---|---|
| `INCACOOK_NOT_FOUND` | 404 | Listing doesn't exist or is soft-deleted |
| `INCACOOK_FORBIDDEN` | 403 | Caller doesn't own the listing |

### 5.3 `DELETE /v1/listings/:id` — soft delete

```http
DELETE /v1/listings/{id}                         Status: 204
```

Sets `deletedAt` and forces `isAvailable = false`. The row stays in the
DB so existing orders can still resolve the historical name + price
snapshot. After delete:
- `GET /v1/listings/:id` returns 404
- `GET /v1/listings` (feed) excludes it
- `GET /v1/sellers/me/listings` excludes it

No KYC check on delete — sellers can wind down content even if their
KYC has lapsed.

### 5.4 `PATCH /v1/listings/:id/availability` — quick toggle

```http
PATCH /v1/listings/{id}/availability             Status: 200
Content-Type: application/json

{ "isAvailable": false }
```

Quick on/off without sending the whole listing. No KYC check (same
reasoning as delete). Returns the full updated listing.

### 5.5 `GET /v1/listings` — buyer feed

Buyer feed. Filtered, sorted, paginated. Server-side visibility gate:
only listings from APPROVED, non-deleted sellers, available, and
(`expiresAt IS NULL OR expiresAt > now()`).

```http
GET /v1/listings?cuisineTypes=ORIENTALE,FRANCAISE&dishTypes=PLAT  Status: 200
```

**Query parameters — all optional, all camelCase:**

| Param | Type | Notes |
|---|---|---|
| `category` | `SellerCategory` | single value |
| `cuisineTypes` | CSV | OR semantics — listing matches if **any** of its cuisines is in the set |
| `dishTypes` | CSV | OR semantics |
| `fulfillment` | `Fulfillment` | single value |
| `dietary` | CSV `DietaryTag` | AND semantics — listing must carry **every** tag |
| `avoidAllergens` | CSV `Allergen` | listings sharing any allergen with this set are excluded |
| `isVeg` | bool | |
| `minPriceCents` | int | inclusive |
| `maxPriceCents` | int | inclusive |
| `maxDistanceKm` | float (1 decimal) | requires buyer location |
| `search` | string ≤ 120 | ILIKE on `name` + `description` |
| `lat`, `lng` | float | buyer's current location; both or neither |
| `sort` | `distance` \| `newest` \| `price_asc` \| `price_desc` | default: `distance` if location known, else `newest` |
| `limit` | int 1-100 | default 20 |
| `offset` | int >= 0 | default 0 |

> **Empty filter = all visible listings.** Omitting `cuisineTypes` /
> `dishTypes` / `dietary` etc. means "no filter on that dimension".
> The buyer who clears all filters sees everything.

**Buyer location:** if `lat`/`lng` are omitted, the server falls back
to the buyer's saved default `BUYER_DELIVERY` address. If neither
resolves, distance-based sort/filter is disabled and `distanceKm` is
`null`. Requesting `sort=distance` without a buyer point silently
falls back to `newest`.

**Response:**

```jsonc
{
  "success": true,
  "data": [ /* array of listings (full shape + buyer-feed fields, see §4) */ ],
  "pagination": { "hasMore": false, "limit": 20 },
  "meta": { /* … */ }
}
```

`pagination.hasMore: true` means there's at least one more page — use
`offset + limit` for the next request.

### 5.6 `GET /v1/listings/:id` — listing detail

Anybody authenticated can fetch. Returns the full listing including
`extras` (lazily-loaded on the buyer detail screen).

```http
GET /v1/listings/{id}                             Status: 200
```

**Response:** the full `Listing` shape (§4) in `data`. Soft-deleted
listings return 404.

### 5.7 `GET /v1/sellers/me/listings` — seller dashboard

The authenticated seller's own listings. Includes `isAvailable = false`
and expired entries that wouldn't appear in the buyer feed.
Soft-deleted entries are excluded. Sorted by `createdAt` descending.

```http
GET /v1/sellers/me/listings                      Status: 200
```

**Response:**

```jsonc
{
  "success": true,
  "data": [ /* array of full Listing shapes (§4); not paginated */ ]
}
```

Currently returns all the seller's listings in one shot (no
pagination). If a seller has > 100 listings in practice we'll add
pagination later — flag it.

---

## 6. Category rules cheat sheet

| Rule | fait_maison | restaurant / traiteur |
|---|---|---|
| `priceCents` | ≤ 450 (hard cap) | unconstrained |
| `portionsLeft` | **required**, > 0 | optional; `null` = cook-to-order |
| `expiresAt` | **required**, > now | optional; `null` = permanent menu item |
| `dishTypes` | must be empty | any value from §3 table |
| `menuCategory` | ignored | free-text sub-category, ≤ 100 chars |

The Flutter form should already render conditionally on `sellerCategory`
— mirror the rules above. Server enforces all of these regardless.

---

## 7. Error code catalog

Codes you'll see from this module. Branch on `code` for these specific
cases; fall back to `message` for everything else.

| Code | HTTP | Meaning |
|---|---|---|
| `INCACOOK_PRICE_CAP_EXCEEDED` | 422 | fait_maison `priceCents > 450`. `message` quotes the cap in euros. |
| `INCACOOK_FORBIDDEN` | 403 | Various: not a seller, KYC not APPROVED (`message: "KYC_NOT_APPROVED"`), or not the listing owner |
| `INCACOOK_NOT_FOUND` | 404 | Listing doesn't exist or is soft-deleted |
| `INCACOOK_VALIDATION_FAILED` | 422 | Structural validation failure — `details` has per-field errors |
| `INCACOOK_UNKNOWN` | 400 | Catch-all for business validation messages — use `error.message` for the human text |
| `INCACOOK_UNAUTHORIZED` | 401 | Token missing/invalid/expired |
| `INCACOOK_RATE_LIMITED` | 429 | Throttled |

---

## 8. End-to-end curl examples

**Auth:** mint a local seller JWT with
`pnpm -s test:mint-jwt seller > /tmp/jwt` from the backend repo.

```bash
SELLER=$(cat /tmp/jwt)
API=http://localhost:3001/v1
```

### Create a fait_maison listing with extras

```bash
curl -sS -X POST "$API/listings" \
  -H "Authorization: Bearer $SELLER" -H "Content-Type: application/json" \
  -d '{
    "name": "Tajine au poulet",
    "imageUrls": ["listings/tajine.jpg"],
    "priceCents": 350,
    "portionsLeft": 5,
    "cuisineTypes": ["ORIENTALE"],
    "dietaryTags": ["HALAL"],
    "allergens": ["GLUTEN"],
    "fulfillment": "BOTH",
    "prepMinutes": 25,
    "expiresAt": "2026-05-20T18:00:00Z",
    "extras": [
      { "label": "Avec pain",      "priceDeltaCents": 50 },
      { "label": "Sauce piquante", "priceDeltaCents": 50 }
    ]
  }' | jq .
```

### Update only the extras

```bash
LISTING_ID=01KRXYPD4F7Z94B33EAA6R4Y17
curl -sS -X PATCH "$API/listings/$LISTING_ID" \
  -H "Authorization: Bearer $SELLER" -H "Content-Type: application/json" \
  -d '{
    "extras": [
      { "label": "Avec pain",       "priceDeltaCents": 50 },
      { "label": "Boisson 33cl",    "priceDeltaCents": 150 },
      { "label": "Sans olives",     "priceDeltaCents": -50 }
    ]
  }' | jq .
```

### Toggle availability off

```bash
curl -sS -X PATCH "$API/listings/$LISTING_ID/availability" \
  -H "Authorization: Bearer $SELLER" -H "Content-Type: application/json" \
  -d '{ "isAvailable": false }' | jq .
```

### Browse with filters

```bash
BUYER=$(pnpm -s test:mint-jwt buyer)
curl -sS "$API/listings?cuisineTypes=ORIENTALE,FRANCAISE&dietary=HALAL&maxPriceCents=500" \
  -H "Authorization: Bearer $BUYER" | jq .
```

### Seller dashboard

```bash
curl -sS "$API/sellers/me/listings" \
  -H "Authorization: Bearer $SELLER" | jq .
```

---

## 9. What's deliberately NOT here yet

- **No seller-wide extras pantry.** Add-ons are per-listing only.
  A future `seller_extras` table could be layered on without breaking
  the current API — flagged in [`posting-module.md` §4.1](./posting-module.md#41-listing_add_ons-table--no-migration-needed).
- **No size variants** (S/M/L). Restaurants needing this should create
  separate listings for now.
- **No pagination on `GET /v1/sellers/me/listings`.** Add when needed.
- **No structured field-level errors for business rules.** Currently
  surfaced as `code: INCACOOK_UNKNOWN` with a clear `message`. If
  Flutter needs to highlight specific form fields beyond what Zod
  validation already covers, ping us.

---

## 10. Related backend docs

- [`posting-module.md`](./posting-module.md) — the design / spec doc this implementation follows
- [`flutter-integration.md`](./flutter-integration.md) — general API conventions (base URL, auth, idempotency)
- [`error-codes.md`](./error-codes.md) — full `INCACOOK_*` catalog
- [`BACKEND_SCHEMA.md`](../BACKEND_SCHEMA.md) — Postgres schema source
