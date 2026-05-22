# Posting module

How a cuisinier publishes a dish, how the client browses it, and the
backend endpoints that drive each side. Handoff document for the
backend implementation pass.

This doc has four parts:
1. **§1** — what exists in the app today (frontend baseline).
2. **§2** — client feedback, mapped to concrete frontend + backend changes.
3. **§3** — endpoint reference (request + response shape for every call the
   posting + browsing flows need).
4. **§4** — schema deltas vs [`BACKEND_SCHEMA.md`](../BACKEND_SCHEMA.md).

All responses follow the standard envelope described in
[`flutter-integration.md`](./flutter-integration.md). The bodies shown
below are what lives inside `data`. snake_case on the wire, camelCase in
Dart (configured in [`build.yaml`](../build.yaml)).

---

## 1. What exists today

### 1.1 Seller side — `AddProductSheet`

Entry point: a bottom sheet opened from the seller dashboard, driven by
[`AddProductController`](../lib/features/seller/controllers/add_product_controller.dart).
The sheet is **UI-only today** — there is no repository, no network
call, no persistence. Submitting just closes the sheet.

Fields collected (see
[`add_product_sheet.dart`](../lib/features/seller/presentation/widgets/add_product_sheet.dart)):

| Section | Field | Type | Required | Notes |
|---|---|---|---|---|
| Photos | `photos` | up to 4 placeholder URLs | no | currently `'placeholder://$index'` strings — no real upload yet |
| Base info | `title` | `String` | yes | non-empty |
| Base info | `description` | `String` | yes | non-empty, multiline |
| Base info | `price` | `double` (€) | yes | > 0; **€4.50 cap for fait-maison** — see §2.2 |
| Base info | `portions` | `int` | yes | > 0 |
| Classification | `category` | `SellerCategory` | yes | read-only chip, derived from the seller's profile, passed to the controller constructor |
| Classification | `cuisines` | `Set<CuisineType>` | no | multi-select |
| Classification | `diets` | `Set<DietaryTag>` | no | multi-select |
| Classification | `dishTypes` | `Set<DishType>` | no | options come from `DishType.valuesFor(sellerCategory)` — empty set for fait-maison |
| Allergens | `allergens` | `Set<Allergen>` | no | 14 EU-mandated, empty list = "none declared" |
| Allergens | `otherAllergens` | `String?` | no | free-text |
| Availability | `pickupStart`, `pickupEnd` | `TimeOfDay?` | no | local time, no date |
| Pickup mode | `onSite`, `delivery` | `bool` | one required | maps to `Fulfillment` enum (pickup / delivery / both) |

Form gating logic:
[`add_product_controller.dart:68-88`](../lib/features/seller/controllers/add_product_controller.dart#L68-L88).

What is **missing** on the seller side today (i.e. needs both frontend
and backend work, called out per item in §2):
- Seller-level "extras" declaration (bread / drinks / sauces).
- Real photo upload (we have placeholders).
- Persisting the dish anywhere — there is no `ListingsRepository`.

### 1.2 Client side — browsing

Entry point: [`ClientHomeScreen`](../lib/features/client/presentation/screens/client_home.dart) —
category pills, kitchens carousel, listings feed.

Filter UI:
[`filters_sheet.dart`](../lib/features/client/presentation/widget/filters_sheet.dart).
Filter state: [`FilterController`](../lib/features/client/controllers/filter_controller.dart).
Filter model: [`ListingFilter`](../lib/core/models/listing_filter.dart).

Available filters:
- `category` — seller category (single select, optional)
- `cuisines` — `Set<CuisineType>` (OR semantics)
- `diets` — `Set<DietaryTag>` (AND semantics — every selected diet must be present)
- `dishTypes` — `Set<DishType>` (OR; valid set narrows when `category` changes)
- `maxDistanceKm` — clamped to `category.maxRadiusKm`
- `inStockOnly` — bool

**When the filter is empty, all listings are returned**
([`filter_controller.dart:80`](../lib/features/client/controllers/filter_controller.dart#L80) —
`if (f.isEmpty) return source`). Frontend is already correct on §2.5;
backend must mirror this (no implicit narrowing).

Dish detail:
[`ProductDetailScreen`](../lib/features/catalog/presentation/screens/product_detail.dart).
**Add-ons are hardcoded** ([lines 73-80](../lib/features/catalog/presentation/screens/product_detail.dart#L73-L80))
as a static `_demoAddOns` list with bread / hot sauce / kids portion.
Replacing this with a real fetch is §2.1 + §2.3.

Data source for both the feed and dish detail today is **mock**
([`ClientMockData`](../lib/features/client/data/client_mock_data.dart),
[`SellerProductMockData`](../lib/features/seller/data/seller_product_mock_data.dart),
[`OrderMockData`](../lib/features/orders/data/order_mock_data.dart)).

### 1.3 Order tracking

Tracking screen:
[`OrderTrackingScreen`](../lib/features/orders/presentation/screens/order_tracking.dart) →
[`OrderBottomSheet`](../lib/features/orders/presentation/widgets/order_bottom_sheet.dart).
Stage labels in
[`order_bottom_sheet.dart:80-97`](../lib/features/orders/presentation/widgets/order_bottom_sheet.dart#L80-L97).

The bottom sheet currently **does not branch on fulfillment** — the
"en route" subtitle is the same for pickup and delivery. The order
model already carries the distinction
([`order_detail.dart:44-45`](../lib/core/models/order_detail.dart#L44-L45)
— `isDelivery` / `isPickup`); the tracking sheet just doesn't read it.
Fix is §2.4.

### 1.4 Existing API surface

Real backend integration today lives in `/v1/auth/*` and
`/v1/sellers/me/*`
([`auth_repository.dart`](../lib/features/authentication/data/repositories/auth_repository.dart),
[`sellers_repository.dart`](../lib/features/authentication/data/repositories/sellers_repository.dart)).
HTTP client + auth interceptor:
[`api_client.dart`](../lib/core/network/api_client.dart),
[`auth_interceptor.dart`](../lib/core/network/auth_interceptor.dart).

Base URL: `https://incacook-api-production.up.railway.app`, prefix
`/v1`. JWT bearer auth, refresh-token rotation already wired.

The posting module's repositories (listings, extras, browse feed) do
**not exist yet** — they're the deliverable on the Flutter side once
the backend lands.

---

## 2. Client feedback → required behavior

Five items from the client, mapped to concrete changes. Each has a
"frontend status" line so it's clear what work is needed where.

### 2.1 Cuisinier-declared extras (bread, drinks, …)

> *"Ajouter dans la rubrique Cuisinier, à savoir s'ils ont du pain ou
> des boissons disponibles qui pourraient remettre à la vente en
> proposant un prix pour ces articles supplémentaires que le client
> pourrait voir dans son interface."*

**Frontend status: missing.** No UI in `AddProductSheet` for declaring
extras, and `ProductDetailScreen` hardcodes `_demoAddOns` instead of
fetching real ones.

**Design decision — per-listing add-ons, not per-seller pantry.** Each
listing carries its own set of add-ons (bread, drink, sauce, …),
declared by the seller in the same form that creates the dish. This
matches the standard food-delivery pattern (Uber Eats, Deliveroo) and
gives sellers granular control — a tajine can come with bread, a salad
can skip it. A cuisinier who offers bread for every dish does have to
re-declare it per listing; accepted as the cost of flexibility, and
the form can offer a "copy add-ons from last listing" affordance later
if friction proves real.

The backend already has a [`ListingAddOn` Prisma model](../prisma/schema.prisma)
with `(listing_id, label, price_delta_cents, is_selected_by_default,
sort_order)`. **No schema change required** — only wiring it into the
listing-mutation endpoints. See §4.1.

**Backend deliverables:**
- `POST` / `PATCH /v1/listings` accept an optional `extras[]` array in
  the request body (§3.3). The endpoint inserts / replaces the
  associated `listing_add_ons` rows in the same transaction as the
  parent listing.
- `GET /v1/listings/:id` returns the listing's `extras` inline (§3.2).
  Empty array (`[]`) when the listing has no add-ons — never `null`.

**Frontend deliverables (separate PR, not blocking the backend):**
- Add an "Extras" section to `AddProductSheet` — a small list editor
  for `(label, price_delta)` rows.
- Replace the hardcoded `_demoAddOns` in
  [`product_detail.dart`](../lib/features/catalog/presentation/screens/product_detail.dart#L73-L80)
  with the `extras` returned from `GET /v1/listings/:id`.

This also resolves §2.3.

### 2.2 Hard €4.50 cap for fait-maison

> *"… si on est dans le cas de fait Maison il faut que le tarif soit
> bloqué à 4,50 € et l'empêcher de mettre plus … il faut aller au-delà
> de l'indication mais l'interdire pour la rubrique fait maison."*

**Frontend status: partially enforced.**
[`add_product_controller.dart:81`](../lib/features/seller/controllers/add_product_controller.dart#L81)
already blocks submission (`canSubmit` returns false when
`isFaitMaison && price > 4.5`), but there is no inline error message
or red border on the price field — the user just sees the Continue
button disabled with no explanation. Visual feedback is a frontend-only
fix (separate PR).

**Backend deliverable: enforce server-side too.**
- `POST/PUT /v1/listings` must reject `price > 4.50` when the
  authenticated seller's `category = FAIT_MAISON`. Use the seller's
  category from `seller_profiles` — do **not** trust a category sent
  in the request body.
- Response: `422` with
  `{code: "FAIT_MAISON_PRICE_CAP_EXCEEDED", maxPrice: 4.50}`.

Constant lives in
[`add_product_controller.dart:15`](../lib/features/seller/controllers/add_product_controller.dart#L15)
(`faitMaisonPriceCap = 4.5`). Backend should keep the same value;
treat it as configuration (env var or DB constant) so both ends can
move it together if it ever changes.

### 2.3 Extras only when the seller actually has them

> *"Sur les plats quand le client choisit, il va payer les extras
> comme le pain, la sauce piquante — sont à mettre uniquement si le
> Cuisinier en dispose, il ne faut pas le mettre par défaut."*

Resolved by §2.1 — the moment extras are fetched per-listing instead
of hardcoded, this is satisfied by construction. A listing with no
declared add-ons → no add-on chips on the dish detail. No additional
backend work beyond §2.1.

**Note for the frontend follow-up:** when the extras list comes back
empty, the dish detail must hide the entire "Extras" section, not
just render an empty chip row.

### 2.4 Tracking copy adapts to pickup vs delivery

> *"… même si j'ai mis à retirer sur place, on constate qu'on est dans
> un cas de figure de livraison avec l'indication: 'Votre commande est
> en route.' Adapter ce commentaire en fonction de retirer sur place
> ou à livrer à domicile."*

**Frontend status: needs branching.**
[`order_bottom_sheet.dart:86-91`](../lib/features/orders/presentation/widgets/order_bottom_sheet.dart#L86-L91)
uses `AppTexts.trackingArrivingSubtitle` ("… votre nourriture est en
route.") for both pickup and delivery at the `onTheWay` /
`arrivedDropoff` stages.

The data is already there — `OrderDetail.fulfillment.choice` is
populated and `isDelivery` / `isPickup` getters exist
([`order_detail.dart:44-45`](../lib/core/models/order_detail.dart#L44-L45)).
The fix is purely presentational on the Flutter side:
- Pass the order (or just `isDelivery`) into `OrderBottomSheet`.
- Branch the title + subtitle in `_StageHeader`. Suggested copy:
  - Delivery → keep existing "Votre nourriture est en route."
  - Pickup → "Votre commande vous attend chez le cuisinier." (or
    similar — confirm copy with the client).
- Add the new strings to
  [`text_strings.dart`](../lib/core/constants/text_strings.dart):
  `trackingArrivingSubtitlePickup`, plus the title prefix if it should
  differ.

**Backend deliverable: nothing new.** The order GET endpoint already
needs to return `fulfillment.choice` (it does in the schema today —
see [`BACKEND_SCHEMA.md` §3 `orders`](../BACKEND_SCHEMA.md#3-cart-orders-payments)).
Just confirm the field is in the response payload.

**Worth checking on the backend side:** the `OrderStage` semantics for
pickup orders. `onTheWay` only makes sense when there's a driver
between seller and buyer. For pickup, the stages should be
`prepared → arrivedPickup → delivered` (skipping `onTheWay` /
`arrivedDropoff`). If the backend currently advances every order
through `onTheWay`, that's a separate bug to track. The Flutter
tracking timeline can render either path — the stage list just needs
to be correct upstream.

### 2.5 No filter selected → show everything

> *"Quand on est Client, et qu'on ne choisit pas de régime alimentaire
> ou bien de type de cuisine, il faut que tous les plats et tous les
> régimes apparaissent."*

**Frontend status: already correct.**
[`filter_controller.dart:80`](../lib/features/client/controllers/filter_controller.dart#L80)
short-circuits with `if (f.isEmpty) return source` — when no filter is
set, all listings pass through.

**Backend deliverable: same behavior server-side.**
`GET /v1/listings` with no `cuisines` / `diets` / `dish_types` /
`category` params returns the full feed (subject to geo bounds and
visibility gating from KYC + `is_available`). Do **not** treat
unspecified filter params as "narrow to empty". Specifically:
- Absent param → don't filter on that dimension.
- Present but empty array → same as absent (treat as "any").

### 2.6 Multi-category model fit (fait_maison + traiteur + restaurant)

Not from client feedback — surfaced while reviewing the schema for this
doc. The current model bakes in fait_maison assumptions that don't fit
restaurant / traiteur. Fix at the schema level rather than shoehorning
workarounds into the API.

**§2.6.a — `expires_at` and `portions_left` are mandatory but only
meaningful for fait_maison.**

- A fait_maison cook has X portions ready by 12:00, sold out by 14:00 →
  both fields make sense.
- A restaurant's pizza is on the menu every day, cooked to order →
  both fields are nonsense; the seller would have to re-create the
  listing daily or set `expires_at` to year 2099 and `portions_left`
  to 9999.

**Fix:** make both nullable at the schema + endpoint + model level.
- `expires_at = null` → permanent menu item, no expiry.
- `portions_left = null` → "cook to order", no inventory tracking;
  buyer UI shows "Disponible" instead of "X portions restantes".

Server validation in `POST /v1/listings`:
- fait_maison: both **required**.
- restaurant / traiteur: both **optional**.

Frontend: `AddProductSheet` already hides the dishTypes section for
fait_maison (empty `DishType.valuesFor`). Same conditional rendering
should hide / make optional the portions and expiration fields when
seller category is restaurant/traiteur.

**§2.6.b — `menu_category` is in the schema but not the form.**

[`BACKEND_SCHEMA.md`](../BACKEND_SCHEMA.md#listings) and `FoodListing`
both carry `menu_category` ("Pizza mixte", "Entrées chaudes", …) but
`AddProductSheet` doesn't expose it. Restaurants and traiteurs need it
to group their menu beyond the four-value `DishType` enum.

**Fix:** add an optional `menuCategory` text field to the form, shown
only when `sellerCategory != faitMaison`. No backend change needed —
the column already exists; just include it in §3.3's request body
(already documented there).

**§2.6.c — No `BOISSON` (drink) dish type.**

[`DishType`](../lib/core/enums/food_enums.dart#L101-L142) covers entrée,
plat, dessert, cocktail_dinatoire. A standalone drink as its own
listing (Coca-Cola sold by a restaurant, soda packs sold by a traiteur)
has nowhere to land. The seller-level extras pantry from §2.1 handles
drinks **as add-ons to dishes**, but not drinks as standalone
purchasable items.

**Fix:** extend the enum.
```dart
@JsonValue('BOISSON')
boisson(
  label: AppTexts.dishDrink,
  availableFor: {SellerCategory.traiteur, SellerCategory.restaurant},
),
```
Backend: `ALTER TYPE dish_type ADD VALUE 'BOISSON'`. See §4.5.

**§2.6.d — Form collects multi-select, model stores singular.**

[`add_product_controller.dart`](../lib/features/seller/controllers/add_product_controller.dart)
exposes `RxSet<CuisineType>` and `RxSet<DishType>` (multi-select chips),
but [`food_listing.dart`](../lib/core/models/food_listing.dart) stores
`CuisineType?` and `DishType?` (singular nullable). A seller picks
"Orientale + Africaine" in the UI — only one survives the model. The
§3.1 response in this doc has the same singular shape; the §3.3
request body is already plural — so the doc itself was internally
inconsistent.

**Fix:** pluralize on the model + schema + response side. Columns
become `cuisine_types cuisine_type[]` and `dish_types dish_type[]`.
The §3.3 request is already in the right shape. §3.1 / §3.2 responses
need pluralizing — done in §3 below. Filter semantics in §3.1 don't
change conceptually: `cuisines` query param is "OR over the listing's
cuisines"; `dish_types` ditto.

Frontend: rename `FoodListing.cuisineType` → `cuisineTypes:
List<CuisineType>`, same for `dishType`. One-line change in
[`filter_controller.dart:83-94`](../lib/features/client/controllers/filter_controller.dart#L83-L94)
(`l.cuisineType == null || !f.cuisines.contains(l.cuisineType)` →
`!l.cuisineTypes.any(f.cuisines.contains)`).

**§2.6.e — Size variants (S/M/L) are not modeled.**

Restaurants often sell the same dish in multiple sizes. Today the only
workaround is three separate listings — the seller-level extras pantry
doesn't fit (bread is an add-on, "Large" is a variant of the dish
itself).

**Decision: defer for v1.** Document as a known limitation. Restaurants
can create separate listings ("Pizza Margherita Petite", "… Grande",
…) until we add a `listing_variants` table. Not in scope here.

---

## 3. Endpoint reference

Conventions:
- **Auth** column: `public` (no token); `bearer` (`Authorization: Bearer <accessToken>`).
- **Body** shows JSON shape; optional fields tagged `// optional`.
- **Response** shows what lives inside `data` of the success envelope.
- snake_case on the wire.

### 3.1 `GET /v1/listings` — bearer

The buyer feed. Returns paginated listings filtered by the query.

```http
GET /v1/listings                     Auth: bearer        Status: 200
```

Query params (all optional):

| Param | Type | Notes |
|---|---|---|
| `category` | string enum | `FAIT_MAISON` \| `TRAITEUR` \| `RESTAURANT` |
| `cuisines` | csv enum | OR semantics, e.g. `ORIENTALE,ITALIENNE` |
| `diets` | csv enum | AND semantics — listing must carry every tag |
| `dish_types` | csv enum | OR semantics; valid set depends on `category` |
| `allergens_to_exclude` | csv enum | listings with any of these are filtered out |
| `max_distance_km` | float | requires `lat`/`lng`; clamped to `category.maxRadiusKm` server-side |
| `in_stock_only` | bool | `portions_left > 0` |
| `lat`, `lng` | float | buyer's reference point for `distance_km` + distance filter |
| `cursor` | string | opaque pagination cursor |
| `limit` | int | default 20, max 50 |

**No params → returns all visible listings**, paginated. See §2.5.

Response:
```jsonc
{
  "items": [
    {
      "id": "uuid",
      "name": "Tajine poulet olives",
      "image_url": "listings/abc.jpg",
      "price": 3.00,
      "original_price": 8.00,         // optional
      "discount_percent": 62,
      "portions_left": 4,             // nullable — null = "cook to order" (restaurant/traiteur), see §2.6.a
      "fulfillment": "BOTH",          // DELIVERY | PICKUP | BOTH
      "expires_at": "2026-05-18T18:00:00Z", // nullable — null = permanent menu item, see §2.6.a
      "prep_minutes": 20,
      "is_available": true,
      "is_veg": false,
      "menu_category": null,          // optional free-text, restaurant/traiteur only (§2.6.b)
      "category": "FAIT_MAISON",
      "dietary_tags": ["HALAL"],
      "cuisine_types": ["ORIENTALE"], // array, 0+ values (§2.6.d)
      "dish_types": [],               // array, empty for fait_maison (§2.6.d)
      "allergens": ["GLUTEN"],
      "other_allergens": null,
      "seller": {
        "id": "uuid",
        "display_name": "Fatima K.",
        "rating": 4.9,
        "review_count": 24
      },
      "distance_km": 0.3              // server-computed when lat/lng supplied
    }
  ],
  "next_cursor": "opaque-string"      // null on last page
}
```

Visibility: only listings whose seller has `kyc_status = approved` and
whose `is_available = true` and `expires_at > now()` are returned.

### 3.2 `GET /v1/listings/:id` — bearer

Single dish detail. Returns the full listing plus the seller's active
extras (denormalized) so the dish detail screen does not need a second
round-trip.

```http
GET /v1/listings/{id}                Auth: bearer        Status: 200
```

Response: same shape as a single item in §3.1, plus:
```jsonc
{
  // … all fields from §3.1 item shape …
  "description": "Tajine traditionnel mijoté 4h, olives vertes …",
  "extras": [
    {
      "id": "uuid",                  // listing_add_ons row id
      "label": "Avec pain",
      "price_delta": 0.50,           // signed € — negative allowed ("no cheese: -0.50")
      "is_selected_by_default": false
    }
  ],
  "seller": {
    // … same as §3.1 …
    "neighborhood": "Bastille, Paris 11ème",
    "prep_min_minutes": 15,
    "prep_max_minutes": 30
  }
}
```

**§2.3 implication:** when the listing has no add-ons, the `extras`
array is empty (`[]`) — never `null`. The Flutter side then hides the
extras section entirely.

### 3.3 `POST /v1/listings` — bearer (seller only)

Creates a listing. Authenticated user must have `role = seller` and
`seller_profiles.kyc_status = approved`. Sellers whose KYC is still
`pending` get `403 KYC_NOT_APPROVED`.

```http
POST /v1/listings                    Auth: bearer        Status: 201
Content-Type: application/json
```

Request:
```jsonc
{
  "name": "Tajine poulet olives",
  "description": "Tajine traditionnel mijoté 4h …",
  "price": 3.00,                     // €
  "portions": 4,                     // optional — null = "cook to order" (§2.6.a); required for fait_maison
  "fulfillment": "BOTH",             // DELIVERY | PICKUP | BOTH
  "image_urls": ["listings/abc.jpg", "listings/def.jpg"], // 1-4, storage keys from /uploads
  "pickup_start": "11:30",           // optional, HH:mm local
  "pickup_end": "14:00",             // optional
  "expires_at": "2026-05-18T18:00:00Z", // optional — null = permanent menu item (§2.6.a); required for fait_maison
  "cuisines": ["ORIENTALE"],         // optional, may be empty
  "diets": ["HALAL"],                // optional
  "dish_types": [],                  // optional; must be valid for seller's category
  "allergens": ["GLUTEN"],           // optional
  "other_allergens": null,           // optional
  "is_veg": false,
  "menu_category": "Tajines",        // optional free-text, restaurant/traiteur only (§2.6.b)
  "extras": [                        // optional; 0-20 items per listing (§2.1)
    { "label": "Avec pain",      "price_delta": 0.50, "is_selected_by_default": false },
    { "label": "Sauce piquante", "price_delta": 0.50, "is_selected_by_default": false }
  ]
}
```

Notes:
- `category` is **not** in the request — derived from
  `seller_profiles.category` server-side. Same for `seller_id`.
- `image_urls` reference Supabase Storage keys previously uploaded via
  the existing uploads flow (see
  [`uploads_repository.dart`](../lib/features/authentication/data/repositories/uploads_repository.dart)).

**Validation (server-side, must mirror the Flutter form):**
- `name` non-empty.
- `description` non-empty.
- `price > 0`.
- **`price ≤ 4.50` when seller category is `FAIT_MAISON`** (§2.2).
  Returns `422 FAIT_MAISON_PRICE_CAP_EXCEEDED` with
  `{maxPrice: 4.50}`.
- `portions`: required and `> 0` for fait_maison; optional for
  restaurant/traiteur, must be `> 0` if set (§2.6.a).
- At least one fulfillment mode set.
- Every `dish_types` value must be in `DishType.valuesFor(category)`
  (fait-maison → must be empty; restaurant/traiteur → entree / plat /
  dessert / boisson; traiteur-only → cocktail_dinatoire). See §2.6.c
  for `BOISSON`.
- `expires_at`: required and `> now()` for fait_maison; optional for
  restaurant/traiteur (§2.6.a).
- `menu_category`: ignored for fait_maison; ≤ 60 chars for
  restaurant/traiteur.
- `extras`: optional; max 20 items per listing; each `label` non-empty
  and ≤ 60 chars; `price_delta` is signed (negative allowed for
  "no X" variants). Persisted as `listing_add_ons` rows in the same
  transaction as the parent listing.
- `image_urls` length 1-4.

Response: the full listing detail shape from §3.2.

### 3.4 `PUT /v1/listings/:id` — bearer (seller only)

Updates a listing the caller owns. Same body + validation as §3.3, but
all fields optional. Cannot transfer ownership.

```http
PUT /v1/listings/{id}                Auth: bearer        Status: 200
```

Errors:
- `404` — listing not found or not owned by caller.
- `422` — same validation errors as §3.3.

### 3.5 `DELETE /v1/listings/:id` — bearer (seller only)

Soft delete — sets `listings.deleted_at` (the existing Prisma model
already has the column). The row stays so historical orders that
reference it can still resolve the name + price snapshot. The buyer
feed (§3.1) and dish detail (§3.2) filter out rows with `deleted_at IS
NOT NULL`.

```http
DELETE /v1/listings/{id}             Auth: bearer        Status: 204
```

### 3.6 `GET /v1/sellers/me/listings` — bearer (seller only)

The seller's own dashboard view of their listings (including unavailable
and expired ones, unlike §3.1).

```http
GET /v1/sellers/me/listings          Auth: bearer        Status: 200
```

Query params: same pagination as §3.1; plus `include_expired=true|false`
(default `false`) and `include_unavailable=true|false` (default `true`).

Response: same item shape as §3.1, with no distance/visibility gating.

### 3.7 `GET /v1/orders/:id` — bearer (buyer only — owner)

Already implied by [`BACKEND_SCHEMA.md` §3](../BACKEND_SCHEMA.md#3-cart-orders-payments).
Documented here for completeness so the tracking copy fix (§2.4) has a
clear data contract.

Response includes `fulfillmentChoice` (flat, not nested) so the tracking
screen can branch its subtitle:

```jsonc
{
  "id": "uuid",
  "orderNumber": "ICK-1234",
  "status": "ON_THE_WAY",            // PREPARED | ARRIVED_PICKUP | ON_THE_WAY | ARRIVED_DROPOFF | DELIVERED | FAILED
  "fulfillmentChoice": "PICKUP",     // PICKUP | DELIVERY  ← used by §2.4
  "fulfillmentFeeCents": 0,
  "dropoffAddress": { /* … */ },     // populated for both; semantically only
                                     // matters when fulfillmentChoice = DELIVERY
  // … rest per OrderResponseDto in src/modules/orders/dto/order-response.dto.ts …
}
```

**Audit result (Phase 4):** the field is already returned — see
[`OrderResponseDto.fulfillmentChoice`](../src/modules/orders/dto/order-response.dto.ts).
No backend change needed; Flutter can wire §2.4 against the existing
response.

**Stage path by fulfillment** (worth confirming with backend):
- Delivery: `PREPARED → ARRIVED_PICKUP → ON_THE_WAY → ARRIVED_DROPOFF → DELIVERED`.
- Pickup: `PREPARED → ARRIVED_PICKUP → DELIVERED` (skip on-the-way /
  arrived-dropoff — buyer is the one moving, not a driver).

---

## 4. Schema deltas vs `BACKEND_SCHEMA.md`

Two changes vs the current schema doc. Both should be merged into
[`BACKEND_SCHEMA.md`](../BACKEND_SCHEMA.md) once the backend lands.

### 4.1 `listing_add_ons` table — no migration needed

§2.1 declares add-ons per listing. The existing [`ListingAddOn`](../prisma/schema.prisma)
Prisma model already has the right shape:

```
listing_add_ons (
  id, listing_id, label, price_delta_cents, is_selected_by_default,
  sort_order, created_at, updated_at
)
```

with `ON DELETE CASCADE` from `listings.id` already wired via the
Prisma relation. The Flutter [`ProductAddOn`](../lib/core/models/product_add_on.dart)
model maps to this 1:1.

**No schema change required for this table.** All the work is in the
endpoint layer: `POST` / `PATCH /v1/listings` accept an `extras[]`
array (§3.3) and write to `listing_add_ons` in the same transaction
as the parent listing.

If we ever need a seller-wide pantry that auto-attaches to every
listing (e.g. "bread always available, declared once"), it can be
layered on later as a separate `seller_extras` table joined into the
listing detail response — additive, no migration to the model above.

### 4.2 `listings.price` check constraint

To enforce §2.2 at the schema level (defense in depth — the server
also validates):

```sql
ALTER TABLE listings
  ADD CONSTRAINT listings_price_cap_fait_maison CHECK (
    NOT EXISTS (
      SELECT 1 FROM seller_profiles sp
      WHERE sp.user_id = listings.seller_id
        AND sp.category = 'FAIT_MAISON'
        AND listings.price > 4.50
    )
  );
```

(Or implement as a `BEFORE INSERT/UPDATE` trigger on `listings`, which
is cleaner — the subquery in a `CHECK` constraint isn't supported by
all Postgres versions in the same way.)

The endpoint layer (§3.3) should already reject with a clear error
code; this constraint is the last-line safety net.

### 4.3 `listings.expires_at` and `listings.portions_left` become nullable

Driven by §2.6.a. Today both columns are `NOT NULL` per
[`BACKEND_SCHEMA.md` §2](../BACKEND_SCHEMA.md#listings):

```sql
ALTER TABLE listings
  ALTER COLUMN expires_at DROP NOT NULL,
  ALTER COLUMN portions_left DROP NOT NULL;
```

Conditional `NOT NULL` is enforced at the API layer (§3.3 validation),
not at the column level — Postgres can't easily express "NOT NULL when
seller's category is X" without a trigger, and the API check is
authoritative anyway.

If you want defense-in-depth, the same `BEFORE INSERT/UPDATE` trigger
suggested for §4.2 can also assert:
```sql
IF (SELECT category FROM seller_profiles WHERE user_id = NEW.seller_id) = 'FAIT_MAISON'
   AND (NEW.expires_at IS NULL OR NEW.portions_left IS NULL) THEN
  RAISE EXCEPTION 'fait_maison listings require expires_at and portions_left';
END IF;
```

### 4.4 Add `BOISSON` to `dish_type` enum

Driven by §2.6.c.

```sql
ALTER TYPE dish_type ADD VALUE 'BOISSON';
```

Postgres requires this to run outside a transaction block — separate
migration step. After the enum value lands, the seller-side dish-type
filter (`DishType.valuesFor(category)`) will surface it for restaurant
and traiteur automatically once
[`food_enums.dart`](../lib/core/enums/food_enums.dart) is updated.

### 4.5 `cuisine_type` and `dish_type` columns become arrays

Driven by §2.6.d. Today the listing columns are scalar enums; the form
and request body have always been multi-select. Pluralize the columns:

```sql
ALTER TABLE listings
  ADD COLUMN cuisine_types cuisine_type[] NOT NULL DEFAULT '{}',
  ADD COLUMN dish_types dish_type[] NOT NULL DEFAULT '{}';

UPDATE listings
SET cuisine_types = CASE WHEN cuisine_type IS NULL THEN '{}'::cuisine_type[]
                         ELSE ARRAY[cuisine_type] END,
    dish_types    = CASE WHEN dish_type IS NULL THEN '{}'::dish_type[]
                         ELSE ARRAY[dish_type] END;

ALTER TABLE listings DROP COLUMN cuisine_type, DROP COLUMN dish_type;
```

GIN indexes for the filter queries in §3.1:
```sql
CREATE INDEX listings_cuisine_types_gin ON listings USING gin (cuisine_types);
CREATE INDEX listings_dish_types_gin    ON listings USING gin (dish_types);
```

Filter SQL changes: equality (`cuisine_type = ANY($1)`) → array overlap
(`cuisine_types && $1::cuisine_type[]`). OR semantics preserved.

`BACKEND_SCHEMA.md` §2 needs the column names + types updated to match.

---

## 5. Order of work

Suggested phasing — backend can ship them as separate PRs, Flutter
follows behind on each:

1. **Migrations** — bundle the listing schema changes:
   - `listings.expires_at` + `portions_left` nullable (§4.3).
   - `cuisine_types[]` + `dish_types[]` columns + GIN indexes (§4.5).
   - `BOISSON` enum value (§4.4 — separate migration file, outside txn).
   - `listings.price` fait_maison cap (§4.2) — API validation is the
     primary defense; trigger optional.

   `listing_add_ons` requires no migration (§4.1).

2. **`POST/PATCH/DELETE /v1/listings` + `GET /v1/sellers/me/listings`** —
   adds `extras[]` handling alongside the listing CRUD (insert /
   replace `listing_add_ons` rows in the same transaction). Unlocks
   the Flutter `AddProductSheet` wiring.

3. **`GET /v1/listings` + `GET /v1/listings/:id`** — unlocks replacing
   `ClientMockData` and the hardcoded `_demoAddOns` (now sourced
   per-listing via the join in §3.2).

4. **Confirm `GET /v1/orders/:id` returns `fulfillment.choice`** —
   Flutter patches `OrderBottomSheet` to branch the subtitle (§2.4).
   No backend work if the field is already there; just a schema audit.

Items 2 and 3 unblock the bulk of the Flutter posting work. Item 4
can land any time.

---

## Files referenced

Frontend (current state):
- [`add_product_controller.dart`](../lib/features/seller/controllers/add_product_controller.dart)
- [`add_product_sheet.dart`](../lib/features/seller/presentation/widgets/add_product_sheet.dart)
- [`filter_controller.dart`](../lib/features/client/controllers/filter_controller.dart)
- [`product_detail.dart`](../lib/features/catalog/presentation/screens/product_detail.dart)
- [`order_bottom_sheet.dart`](../lib/features/orders/presentation/widgets/order_bottom_sheet.dart)
- [`order_detail.dart`](../lib/core/models/order_detail.dart)
- [`food_listing.dart`](../lib/core/models/food_listing.dart)
- [`product_add_on.dart`](../lib/core/models/product_add_on.dart)
- [`food_enums.dart`](../lib/core/enums/food_enums.dart)
- [`api_client.dart`](../lib/core/network/api_client.dart)
- [`sellers_repository.dart`](../lib/features/authentication/data/repositories/sellers_repository.dart)

Schema + conventions:
- [`BACKEND_SCHEMA.md`](../BACKEND_SCHEMA.md)
- [`flutter-integration.md`](./flutter-integration.md)
- [`signup-flow.md`](./signup-flow.md) — style template for this doc
