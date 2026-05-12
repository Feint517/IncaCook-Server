# IncaCook — Backend Data Model Reference

A flat reference to every model in the Flutter app, organised so the
backend (Supabase / Postgres) schema can be derived table-by-table.

## Conventions

- **Source of truth**: every shared model lives in [`lib/core/models/`](lib/core/models/).
  All are freezed classes with `fromJson` / `toJson` generated.
- **JSON casing**: Dart fields are camelCase; JSON keys are **snake_case**.
  Configured globally in [`build.yaml`](build.yaml) via
  `json_serializable.field_rename: snake`. Examples below show snake_case
  keys to match what the backend will see on the wire.
- **Recommended Postgres types** are listed alongside Dart types. Times are
  `timestamptz` unless explicitly local. Money is `numeric(10,2)`. Spatial
  data uses `geography(Point, 4326)` (PostGIS).
- **Enums**: prefer Postgres enums for stable value sets (3-7 variants);
  prefer lookup tables when the catalog may grow (allergens, cuisines).
- **Storage**: file URLs (`*_url`) are Supabase Storage object keys.
- **Transient / derived fields** are flagged — they should not be columns.

## Roles

The app supports three user roles: `buyer`, `seller`, `driver`. Each user
has exactly one role, set during signup and immutable afterward (changing
role = creating a new account in production).

---

## 1. Identity & Profiles

### `users` — canonical account record (Supabase `auth.users` + extended row)

| Field | Dart | JSON | Postgres | Notes |
|---|---|---|---|---|
| id | `String` | `id` | `uuid` PK | mirrors `auth.users.id` |
| email | `String` | `email` | `text` unique | |
| phone | `String` | `phone` | `text` unique | E.164 |
| first_name | `String` | `first_name` | `text` | |
| last_name | `String` | `last_name` | `text` | |
| role | `UserRole` | `role` | enum `user_role` | buyer \| seller \| driver |
| phone_verified | `bool` | `phone_verified` | `bool` | |
| email_verified | `bool` | `email_verified` | `bool` | |
| accepted_cgu | `bool` | `accepted_cgu` | `bool` | terms of use |
| accepted_cgv | `bool` | `accepted_cgv` | `bool` | terms of sale |
| accepted_at | `DateTime?` | `accepted_at` | `timestamptz` | |
| stripe_customer_id | `String?` | `stripe_customer_id` | `text` | populated as a side effect of the buyer's first payment — not collected at signup |
| created_at | `DateTime` | `created_at` | `timestamptz` | |
| updated_at | `DateTime` | `updated_at` | `timestamptz` | |

Source: [signup_flow_controller.dart](lib/features/authentication/controllers/signup_flow_controller.dart) lines 41–65, [user_role.dart](lib/features/authentication/data/models/user_role.dart).

Password hashing is handled by Supabase auth — not a column on this table.

**Not stored: `biometric_enabled`.** The signup flow's biometric step wires
up `local_auth` (Touch ID / Face ID / Android fingerprint) — a *device-local*
unlock for the locally-stored refresh token. The server never validates
the biometric and the value is per-device, not per-user, so it belongs in
`flutter_secure_storage` on the client, not in the database.

If passkeys / WebAuthn are added later, that's a separate
`webauthn_credentials` table (`credential_id`, `public_key`, `sign_count`,
`transports`, `last_used_at`) — not a boolean here.

### `buyer_profiles` — 1:1 with users where role = buyer

| Field | Dart | JSON | Postgres | Notes |
|---|---|---|---|---|
| user_id | `String` | `user_id` | `uuid` PK FK → users.id | |
| default_address_id | `String?` | `default_address_id` | `uuid` FK → addresses.id | |
| dietary_preferences | `List<DietaryTag>` | `dietary_preferences` | `dietary_tag[]` | |
| allergies | `List<Allergen>` | `allergies` | `allergen[]` | |

Source: signup_flow_controller `dietaryPreferences` + `allergies` + `deliveryAddress`.

### `seller_profiles` — 1:1 with users where role = seller

| Field | Dart | JSON | Postgres | Notes |
|---|---|---|---|---|
| user_id | `String` | `user_id` | `uuid` PK FK | |
| category | `SellerCategory` | `category` | enum `seller_category` | fait_maison \| traiteur \| restaurant |
| display_name | `String` | `display_name` | `text` | |
| bio | `String` | `bio` | `text` | |
| profile_photo_url | `String` | `profile_photo_url` | `text` | Storage key in `avatars/` |
| date_of_birth | `DateTime` | `date_of_birth` | `date` | strip time component |
| pickup_address_id | `String` | `pickup_address_id` | `uuid` FK → addresses.id | |
| business_name | `String?` | `business_name` | `text` | required if category ≠ fait_maison |
| siret | `String?` | `siret` | `text` | 14-digit, Luhn-validated; required if category ≠ fait_maison |
| restaurant_facade_url | `String?` | `restaurant_facade_url` | `text` | required if category = restaurant |
| cuisine_types | `List<CuisineType>` | `cuisine_types` | `cuisine_type[]` | |
| dish_types | `List<DishType>` | `dish_types` | `dish_type[]` | |
| hygiene_commitment | `bool` | `hygiene_commitment` | `bool` | |
| fait_maison_commitment | `bool` | `fait_maison_commitment` | `bool` | |
| kyc_status | `KycStatus` | `kyc_status` | enum `kyc_status` | pending \| approved \| rejected. **Defaults**: `fait_maison` → `approved` (auto-approved on signup); `traiteur` / `restaurant` → `pending` (admin reviews SIRET + KYC docs + facade). Implement via `INSERT` trigger that branches on `category`. |
| location | `MapPoint` | `location` | `geography(Point, 4326)` | denormalized from pickup address for radius queries |
| delivery_radius_km | `double` | `delivery_radius_km` | `numeric(4,1)` | |
| delivery_fee | `double` | `delivery_fee` | `numeric(10,2)` | |
| prep_min_minutes | `int` | `prep_min_minutes` | `int` | |
| prep_max_minutes | `int` | `prep_max_minutes` | `int` | |
| neighborhood | `String` | `neighborhood` | `text` | "Bastille, Paris 11ème" |
| language_codes | `List<String>` | `language_codes` | `text[]` | ISO codes |
| availability_schedule | `String` | `availability_schedule` | `text` | human-readable; opening hours in separate table |
| verifications | `List<String>` | `verifications` | `text[]` | badge keys |
| promo_text | `String?` | `promo_text` | `text` | optional banner |
| category_tag | `String` | `category_tag` | `text` | "Cuisinière à domicile", etc. |
| stripe_connect_account_id | `String?` | `stripe_connect_account_id` | `text` | nullable until seller completes Stripe Express onboarding |
| stripe_onboarding_completed | `bool` | `stripe_onboarding_completed` | `bool` | default `false`; flipped by the `account.updated` Stripe webhook |
| created_at | | | `timestamptz` | |

Source: [seller_profile.dart](lib/core/models/seller_profile.dart) (canonical fields only — aggregates live in `seller_stats`), signup_flow_controller seller-specific section.

**Pending-state behavior** (no UI screen, schema-only):
The signup flow drops the seller straight into the seller home — there is
no "account under review" screen
([signup_flow_controller.dart:439](lib/features/authentication/controllers/signup_flow_controller.dart#L439)).
The pending state is enforced *server-side* via a **listing visibility
gate**: a `pending` seller can sign in, edit their profile, and upload
listings, but those listings are hidden from the buyer feed until
`kyc_status = 'approved'`. RLS / view filter on `listings`:
```sql
-- in any buyer-facing query against listings
WHERE EXISTS (
  SELECT 1 FROM seller_profiles sp
  WHERE sp.user_id = listings.seller_id
    AND sp.kyc_status = 'approved'
)
```

The same gate applies to `driver_profiles.kyc_status`: a `pending` driver
should not be auto-assigned to orders. Enforce in the assignment query,
not at sign-in (the driver still needs to access their dashboard).

### `seller_opening_hours` — 1:N with seller_profiles (restaurants only)

| Field | Dart | JSON | Postgres | Notes |
|---|---|---|---|---|
| seller_id | | `seller_id` | `uuid` FK → seller_profiles.user_id | |
| day_of_week | `DayOfWeek` | `day_of_week` | enum `day_of_week` | |
| start_time | `TimeOfDay` | `start_time` | `time` | local time, no zone |
| end_time | `TimeOfDay` | `end_time` | `time` | |

Primary key: `(seller_id, day_of_week)`.

Source: [time_range.dart](lib/features/authentication/data/models/time_range.dart), [day_of_week.dart](lib/features/authentication/data/models/day_of_week.dart).

### `driver_profiles` — 1:1 with users where role = driver

| Field | Dart | JSON | Postgres | Notes |
|---|---|---|---|---|
| user_id | `String` | `user_id` | `uuid` PK FK | |
| date_of_birth | `DateTime` | `date_of_birth` | `date` | |
| base_address_id | `String` | `base_address_id` | `uuid` FK → addresses.id | |
| vehicle_type | `DriverVehicleType` | `vehicle_type` | enum `driver_vehicle_type` | bicycle \| scooter \| car |
| operating_zones | `List<String>` | `operating_zones` | `text[]` | neighborhood names; consider FK to a `zones` table later |
| stripe_connect_account_id | `String?` | `stripe_connect_account_id` | `text` | nullable until driver completes Stripe Express onboarding |
| stripe_onboarding_completed | `bool` | `stripe_onboarding_completed` | `bool` | default `false`. Flipped by the `account.updated` Stripe webhook when `charges_enabled && payouts_enabled && details_submitted`. |
| charter_accepted | `bool` | `charter_accepted` | `bool` | |
| punctuality_commitment | `bool` | `punctuality_commitment` | `bool` | |
| care_commitment | `bool` | `care_commitment` | `bool` | |
| kyc_status | `KycStatus` | `kyc_status` | enum `kyc_status` | |

Source: [driver_vehicle_type.dart](lib/features/authentication/data/models/driver_vehicle_type.dart), signup controller driver section.

### `addresses` — shared by buyers, sellers, drivers, and order delivery destinations

| Field | Dart | JSON | Postgres | Notes |
|---|---|---|---|---|
| id | `String?` | `id` | `uuid` PK | |
| user_id | | `user_id` | `uuid` FK → users.id | |
| type | `SavedAddressType?` | `type` | enum `saved_address_type` | home \| work \| other; null for ad-hoc |
| custom_label | `String?` | `custom_label` | `text` | overrides type label |
| full_address | `String` | `full_address` | `text` | "12 rue de Rivoli" |
| city | `String` | `city` | `text` | |
| postal_code | `String` | `postal_code` | `text` | |
| coordinate | `MapPoint?` | `coordinate` | `geography(Point, 4326)` | use PostGIS for `ST_DWithin` |
| apartment | `String?` | `apartment` | `text` | |
| floor | `String?` | `floor` | `text` | |
| digicode | `String?` | `digicode` | `text` | |
| delivery_notes | `String?` | `delivery_notes` | `text` | |

**Transient (not persisted)**: `inRange: bool` — UI-derived flag for whether
the address is inside the active seller's `delivery_radius_km`. Computed
client-side or via a Postgres function at query time.

Source: [address.dart](lib/core/models/address.dart).

### `kyc_submissions` — for sellers + drivers

| Field | Dart | JSON | Postgres | Notes |
|---|---|---|---|---|
| id | | `id` | `uuid` PK | |
| user_id | | `user_id` | `uuid` FK | |
| id_document_type | `IdDocumentType` | `id_document_type` | enum `id_document_type` | carte_identite \| passeport \| titre_sejour |
| id_front_url | `String` | `id_front_url` | `text` | Storage key in `kyc/` |
| id_back_url | `String?` | `id_back_url` | `text` | required if document type requires verso |
| selfie_url | `String` | `selfie_url` | `text` | |
| driving_license_url | `String?` | `driving_license_url` | `text` | drivers w/ motorized vehicles |
| carte_grise_url | `String?` | `carte_grise_url` | `text` | drivers w/ motorized vehicles |
| insurance_url | `String?` | `insurance_url` | `text` | drivers w/ motorized vehicles |
| status | `KycStatus` | `status` | enum `kyc_status` | pending \| approved \| rejected |
| reviewer_id | | `reviewer_id` | `uuid` FK → users.id | nullable |
| reviewed_at | | `reviewed_at` | `timestamptz` | |
| rejection_reason | | `rejection_reason` | `text` | |
| submitted_at | | `submitted_at` | `timestamptz` | |

Source: [id_document_type.dart](lib/features/authentication/data/models/id_document_type.dart), signup controller KYC fields.

---

## 2. Catalog

### `listings` — single canonical dish-for-sale row (was `FoodListing` + `SellerProduct`)

| Field | Dart | JSON | Postgres | Notes |
|---|---|---|---|---|
| id | `String` | `id` | `uuid` PK | |
| seller_id | | `seller_id` | `uuid` FK → seller_profiles.user_id | (replaces denormalized `sellerName` on the wire) |
| name | `String` | `name` | `text` | |
| image_url | `String` | `image_url` | `text` | Storage key in `listings/` |
| price | `double` | `price` | `numeric(10,2)` | |
| original_price | `double?` | `original_price` | `numeric(10,2)` | pre-discount |
| discount_percent | `int` | `discount_percent` | `int` | 0–100; could be derived |
| portions_left | `int` | `portions_left` | `int` | inventory |
| fulfillment | `Fulfillment` | `fulfillment` | enum `fulfillment` | delivery \| pickup \| both |
| expires_at | `DateTime` | `expires_at` | `timestamptz` | |
| prep_minutes | `int?` | `prep_minutes` | `int` | |
| is_available | `bool` | `is_available` | `bool` | seller toggle |
| is_veg | `bool` | `is_veg` | `bool` | vegetarian (looser than `DietaryTag.vegan`) |
| menu_category | `String?` | `menu_category` | `text` | seller's free-text sub-category ("Pizza mixte") |
| category | `SellerCategory` | `category` | enum `seller_category` | derived from seller; denormalize for filter perf |
| dietary_tags | `List<DietaryTag>` | `dietary_tags` | `dietary_tag[]` | |
| cuisine_type | `CuisineType?` | `cuisine_type` | enum `cuisine_type` | |
| dish_type | `DishType?` | `dish_type` | enum `dish_type` | |
| allergens | `List<Allergen>` | `allergens` | `allergen[]` | empty list = "no allergens declared" |
| other_allergens | `String?` | `other_allergens` | `text` | free-text allergens not in the 14-item enum |
| created_at | | `created_at` | `timestamptz` | |
| updated_at | | `updated_at` | `timestamptz` | |

**Buyer-side aggregates** (NOT columns — denormalized at fetch time, server-side joins):
- `seller_name` ← join from seller_profiles
- `distance_km` ← `ST_Distance(seller.location, $buyer_location)`
- `rating` ← from seller_stats or per-listing review aggregate
- `review_count` ← from reviews aggregate

These appear in the Dart `FoodListing` as fields with default `0` for backward compat.

Source: [food_listing.dart](lib/core/models/food_listing.dart).

### `listing_add_ons`

| Field | Dart | JSON | Postgres | Notes |
|---|---|---|---|---|
| id | `String` | `id` | `uuid` PK | |
| listing_id | | `listing_id` | `uuid` FK → listings.id | |
| label | `String` | `label` | `text` | |
| price_delta | `double` | `price_delta` | `numeric(10,2)` | can be negative |
| is_selected_by_default | `bool` | `is_selected_by_default` | `bool` | |
| sort_order | | `sort_order` | `int` | server-only |

Source: [product_add_on.dart](lib/core/models/product_add_on.dart).

### `kitchens` (optional view-model)

The `Kitchen` Dart class is currently a buyer-feed view of a seller, with
denormalized rating/delivery info and a few presentational fields (chef
avatar, tags). On the backend this is **not its own table** — it's a query
that joins `seller_profiles + seller_stats + listings`. Keep as a Dart
view-model but build it from joins server-side.

If you want to materialize it as a Postgres view: `kitchens_view`.

Source: [kitchen.dart](lib/core/models/kitchen.dart).

---

## 3. Cart, Orders, Payments

### `carts` and `cart_items`

The cart is currently in-memory ([cart_controller.dart](lib/features/cart/controllers/cart_controller.dart)).
Persisting it server-side is optional (mobile apps often keep cart local).
If persisted:

`carts(user_id PK FK, updated_at)` — one active cart per user.

`cart_items`:

| Field | Dart | JSON | Postgres |
|---|---|---|---|
| id | `String` | `id` | `uuid` PK |
| cart_id | | `cart_id` | `uuid` FK → carts.user_id |
| listing_id | | `listing_id` | `uuid` FK → listings.id |
| quantity | `int` | `quantity` | `int` |
| note | `String` | `note` | `text` |
| is_available | `bool` | `is_available` | `bool` |
| created_at | | `created_at` | `timestamptz` |

`cart_item_addons(cart_item_id, listing_addon_id)` — selected add-ons.

**Computed (not stored)**: `unit_price` = `listing.price + Σ addon.price_delta`,
`line_total` = `unit_price × quantity`.

Source: [cart_item.dart](lib/core/models/cart_item.dart).

### `orders` — finalized purchases

| Field | Dart | JSON | Postgres |
|---|---|---|---|
| id | `String` | `id` | `uuid` PK |
| order_number | `String` | `order_number` | `text` unique (e.g. "A4521") |
| buyer_id | | `buyer_id` | `uuid` FK → users.id |
| seller_id | | `seller_id` | `uuid` FK → seller_profiles.user_id |
| driver_id | | `driver_id` | `uuid` FK → driver_profiles.user_id |
| placed_at | `DateTime` | `placed_at` | `timestamptz` |
| stage | `OrderStage` | `stage` | enum `order_stage` |
| subtotal | `double` | `subtotal` | `numeric(10,2)` |
| delivery_fee | `double` | `delivery_fee` | `numeric(10,2)` |
| service_fee | `double` | `service_fee` | `numeric(10,2)` |
| total | `double` | `total` | `numeric(10,2)` |
| fulfillment_choice | `FulfillmentChoice` | `fulfillment_choice` | enum `fulfillment_choice` |
| fulfillment_fee | `double` | `fulfillment_fee` | `numeric(10,2)` |
| delivery_address_id | | `delivery_address_id` | `uuid` FK → addresses.id |
| delivery_instructions | `String?` | `delivery_instructions` | `text` |
| delivery_timing | `DeliveryTiming?` | `delivery_timing` | enum `delivery_timing` |
| scheduled_at | `DateTime?` | `scheduled_at` | `timestamptz` |
| expected_at | `DateTime?` | `expected_at` | `timestamptz` |
| note | `String?` | `note` | `text` |
| created_at | | `created_at` | `timestamptz` |

Source: [order_detail.dart](lib/core/models/order_detail.dart),
[delivery_details.dart](lib/core/models/delivery_details.dart),
[fulfillment_options.dart](lib/core/models/fulfillment_options.dart),
[order_stage.dart](lib/core/enums/order_stage.dart).

`OrderDetail.fulfillmentOptions` (the available delivery/pickup choices at
order time) is a snapshot for display — store inline on `orders` if you
need to show it post-hoc, or recompute from listing/seller state.

`DelivererInfo` is a denormalized view (driver name + avatar + rating)
displayed during tracking. Backend: join `driver_profiles` →
`drivers_view` rather than persisting separately.

### `order_items` — snapshot of cart_items at the time the order was placed

Same shape as `cart_items` but with `order_id` FK. **Snapshot price + name
+ image** so historical orders survive listing edits/deletes:

| Field | Postgres | Notes |
|---|---|---|
| id | `uuid` PK | |
| order_id | `uuid` FK → orders.id | |
| listing_id | `uuid` FK → listings.id | nullable on listing delete |
| listing_name_snapshot | `text` | |
| listing_image_url_snapshot | `text` | |
| unit_price_snapshot | `numeric(10,2)` | |
| quantity | `int` | |
| note | `text` | |

`order_item_addons(order_item_id, label_snapshot, price_delta_snapshot)` —
also snapshotted, since add-ons can be edited.

### `payment_methods` — saved payment options per user

The Dart `PaymentMethod` is a **freezed sealed union** with five variants.
Recommended: ONE table with a discriminator column.

Card details (number, full expiry, etc.) are NOT stored — Stripe holds
them. We keep a tokenized reference plus a couple of *display-only* mirrors
that get refreshed when the buyer adds or updates a card. PCI scope stays
on Stripe's side.

| Field | Dart | JSON | Postgres |
|---|---|---|---|
| id | `String` | `id` | `uuid` PK |
| user_id | | `user_id` | `uuid` FK → users.id |
| kind | (variant tag) | `kind` | enum `payment_method_kind` |
| stripe_payment_method_id | `String?` | `stripe_payment_method_id` | `text` | `pm_xxx` for cards / Apple Pay / Google Pay |
| display_brand | `String?` | `display_brand` | `text` | UI mirror — "Visa" / "Mastercard" |
| display_last4 | `String?` | `display_last4` | `text` | UI mirror — "4242" |
| display_expiry | `String?` | `display_expiry` | `text` | UI mirror — "12/26" |
| masked_email | `String?` | `masked_email` | `text` | for `paypal` |
| wallet_balance | `double?` | `wallet_balance` | `numeric(10,2)` | for `wallet` |
| is_default | `bool` | `is_default` | `bool` | one-per-user via partial unique index |
| created_at | | `created_at` | `timestamptz` |

`payment_method_kind` enum: `wallet`, `saved_card`, `paypal`, `apple_pay`,
`google_pay`. The discriminator key on the wire is `kind` (configured via
`@FreezedUnionValue` in [payment_method.dart](lib/core/models/payment_method.dart)).

**Note on the freezed model**: the current Dart class still has `last4` /
`expiry` / `brand` as direct factory params for `SavedCardPaymentMethod`.
When the Stripe wiring lands, those become the `display_*` mirrors above
and a new `stripePaymentMethodId` field is added to the union. Until then
the model stays as-is so existing call sites keep compiling.

### `payments` — actual payment events

| Field | Postgres | Notes |
|---|---|---|
| id | `uuid` PK | |
| order_id | `uuid` FK → orders.id | |
| payment_method_id | `uuid` FK → payment_methods.id | |
| amount | `numeric(10,2)` | |
| status | enum `payment_status` | pending \| authorized \| captured \| refunded \| failed |
| processor_ref | `text` | charge / payment_intent id |
| created_at | `timestamptz` | |

---

## 4. Reviews & Stats

### `reviews` — buyer's review of a single order

| Field | Dart | JSON | Postgres |
|---|---|---|---|
| id | | `id` | `uuid` PK |
| order_id | | `order_id` | `uuid` FK → orders.id, unique |
| author_id | | `author_id` | `uuid` FK → users.id |
| seller_id | | `seller_id` | `uuid` FK |
| body | `String` | `body` | `text` |
| helpful_count | `int` | `helpful_count` | `int` |
| created_at | | `created_at` | `timestamptz` |

Source: [seller_profile.dart](lib/core/models/seller_profile.dart) — `SellerReview`.

### `review_criteria_ratings`

`SellerRating` per criterion, attached to a review.

| Field | Dart | JSON | Postgres |
|---|---|---|---|
| review_id | | `review_id` | `uuid` FK → reviews.id |
| criterion | `RatingCriterion` | `criterion` | enum `rating_criterion` |
| value | `double` | `value` | `numeric(4,1)` |
| sample_count | `int` | `sample_count` | `int` |

PK: `(review_id, criterion)`.

The criterion's `value_type` (`percent` 0–100 vs `score5` 0–5) is fixed by
the criterion enum — no need to persist. See [seller_rating.dart](lib/core/models/seller_rating.dart).

### `seller_stats` — derived/cached aggregates (materialized view)

Not a table you write to directly. Build as a materialized view from
`reviews + review_criteria_ratings + orders` and refresh on schedule, or
compute on demand. Bundle returned shape per [seller_profile.dart](lib/core/models/seller_profile.dart) `SellerStats`:

| Field | Type | Source |
|---|---|---|
| seller_id | `uuid` PK | |
| rating | `numeric(3,2)` | avg of reviews.rating |
| review_count | `int` | count of reviews |
| meals_sold | `int` | count of completed orders |
| meals_saved | `int` | count of bookmarks |
| response_rate_percent | `int` | % of orders accepted within SLA |
| rating_distribution | `jsonb` | `{ "5": 268, "4": 32, ... }` |
| sentiment_tags | `jsonb` | `[{ "label": "Délicieux", "count": 154 }, ...]` |
| criteria_ratings | `jsonb` | array of `{criterion, avg_value, sample_count}` |

`bookmarks(buyer_id, listing_id)` table feeds `meals_saved`.

---

## 5. Delivery driver

### `driver_daily_stats` — rollup view

Source: [delivery_driver_models.dart](lib/features/delivery/domain/delivery_driver_models.dart) `DailyStats`.

| Field | Postgres |
|---|---|
| driver_id | `uuid` FK |
| date | `date` |
| earnings | `numeric(10,2)` |
| online_seconds | `int` |
| rides_completed | `int` |

PK: `(driver_id, date)`.

### `weekly_challenges` and `challenge_progress`

Source: same file, `WeeklyChallenge`.

```
weekly_challenges(id, title, target, starts_at, ends_at)
challenge_progress(challenge_id, driver_id, progress)  -- 0..target
```

### `order_issues` — driver-reported issues mid-job

| Field | Dart | JSON | Postgres |
|---|---|---|---|
| id | | `id` | `uuid` PK |
| order_id | | `order_id` | `uuid` FK → orders.id |
| driver_id | | `driver_id` | `uuid` FK |
| issue_code | `String` | `issue_code` | `text` (e.g. `restaurant_closed`) |
| severity | `IssueSeverity` | `severity` | enum `issue_severity` |
| stage_when_reported | `OrderStage` | `stage_when_reported` | enum `order_stage` |
| free_text | `String?` | `free_text` | `text` |
| reported_at | `DateTime` | `reported_at` | `timestamptz` |

Source: [issue_catalog.dart](lib/features/delivery/data/issue_catalog.dart).
The catalog itself (list of supported issue codes + which stages allow them)
can stay client-side or move to a `issue_catalog` lookup table.

---

## 6. Chat

The Dart `ChatPreview` is a thread-list view, not a persistence shape.
Real schema:

```
chat_threads(id uuid PK, order_id uuid FK nullable, created_at)
chat_thread_participants(thread_id, user_id, last_read_at)
chat_messages(id uuid PK, thread_id, sender_id, body text, sent_at, read_by jsonb)
```

`unread_count`, `is_typing`, `last_message`, `last_message_at` are all
derived from `chat_messages`.

Source: [chat_preview.dart](lib/features/chat/domain/chat_preview.dart).

---

## 7. Enum reference

These map cleanly to either Postgres enums (stable, small) or lookup
tables (extensible). Recommendation listed.

| Enum | Values | Postgres approach |
|---|---|---|
| `user_role` | buyer, seller, driver | enum |
| `seller_category` | fait_maison, traiteur, restaurant | enum |
| `cuisine_type` | orientale, francaise, africaine, portugaise, italienne, espagnole, latine | lookup table (will grow) |
| `dish_type` | entree, plat, dessert, cocktail_dinatoire | enum |
| `dietary_tag` | halal, vegan, gluten_free, casher | enum |
| `allergen` | gluten, crustaces, oeufs, poissons, arachides, soja, lait, fruits_a_coque, celeri, moutarde, sesame, sulfites, lupin, mollusques | enum (EU-mandated, stable). Free-text "other" goes on `listings.other_allergens`. |
| `fulfillment` | delivery, pickup, both | enum |
| `fulfillment_choice` | delivery, pickup | enum (subset of fulfillment) |
| `order_stage` | prepared, arrived_pickup, on_the_way, arrived_dropoff, delivered, failed | enum |
| `delivery_timing` | asap, scheduled | enum |
| `saved_address_type` | home, work, other | enum |
| `driver_vehicle_type` | bicycle, scooter, car | enum |
| `day_of_week` | monday … sunday | enum |
| `id_document_type` | carte_identite, passeport, titre_sejour | enum |
| `kyc_status` | pending, approved, rejected | enum |
| `payment_method_kind` | wallet, saved_card, paypal, apple_pay, google_pay | enum |
| `payment_status` | pending, authorized, captured, refunded, failed | enum |
| `rating_criterion` | hygiene, food_quality, packaging | enum |
| `rating_value_type` | percent, score5 | NOT a column — derived from `rating_criterion` |
| `issue_severity` | abort, report | enum |

Source: [food_enums.dart](lib/core/enums/food_enums.dart), [order_enums.dart](lib/core/enums/order_enums.dart), [order_stage.dart](lib/core/enums/order_stage.dart), and the auth-side enum files in [lib/features/authentication/data/models/](lib/features/authentication/data/models/).

---

## 8. Storage buckets (Supabase Storage)

Recommended bucket layout:

| Bucket | Contents | RLS |
|---|---|---|
| `avatars` | User profile photos, seller chef photo, driver photo, customer avatars on reviews | Public read; owner write |
| `listings` | Dish images | Public read; seller write (only their own) |
| `seller-facades` | Restaurant facade photos | Public read; seller write |
| `kyc` | ID front/back, selfies, driving license, carte grise, insurance | **Private**: owner + reviewers only |

URL columns on the database (`profile_photo_url`, `id_front_url`, etc.) hold the **object key** within the bucket, e.g. `kyc/<user_id>/id-front.jpg`. Resolve to a signed URL at read time.

---

## 8.5. Stripe Connect (payouts)

Sellers and drivers receive money via **Stripe Connect Express**. The
platform never stores a raw IBAN — Stripe captures bank details, KYC
docs, ToS acceptance, and tax info during their hosted onboarding flow.
The Dart signup flow does **not** include a payout step (the IBAN page
was deleted): users complete app signup, land on their dashboard, and
see a `PayoutSetupBanner` prompting them to finish payout setup.

**Buyers** never create a Stripe Connect account. They become regular
Stripe Customers as a side effect of their first payment; the resulting
`stripe_customer_id` is written to `users` automatically.

### Dual-gate model

A seller / driver record has **two independent gates**:

| Gate | Default | Source of truth | What it blocks |
|---|---|---|---|
| `kyc_status` | `pending` (or `approved` for `fait_maison`) | Internal admin reviewer | Listing visibility / driver assignment |
| `stripe_onboarding_completed` | `false` | Stripe webhook (`account.updated`) when `charges_enabled && payouts_enabled && details_submitted` | Receiving payouts |

The two are independent — a seller may be KYC-approved but
Stripe-incomplete (orders accepted, payouts queued by Stripe) or vice
versa. Both gates must pass for the user to be a fully-active marketplace
participant.

### Required webhooks (Supabase Edge Function)

Subscribe at minimum to:

- `account.updated` → flip `stripe_onboarding_completed` true/false
- `account.application.deauthorized` → unset both `stripe_connect_account_id` and `stripe_onboarding_completed`
- `payment_intent.succeeded` → finalize the corresponding `payments` row
- `payout.paid` / `payout.failed` → log to a `payout_events(driver_or_seller_id, status, amount, arrived_at)` audit table

### Env vars (server-side only — never in Flutter)

- `STRIPE_PUBLISHABLE_KEY` — client-safe
- `STRIPE_SECRET_KEY` — server only
- `STRIPE_WEBHOOK_SECRET` — server only
- `STRIPE_CONNECT_CLIENT_ID` — for OAuth-style flows if used

### Deep links

Define two URL-scheme deep links so Stripe's hosted onboarding can return
to the app: `incacook://payout/return` (success) and
`incacook://payout/refresh` (re-create the link). Register both in
iOS `Info.plist` and Android `AndroidManifest.xml`.

---

## 9. Required Postgres extensions

- **PostGIS** — for `geography(Point, 4326)` columns and `ST_DWithin` /
  `ST_Distance` queries used by the listing feed (max-radius filter) and
  delivery-eligibility checks.
- **pgcrypto** — for `gen_random_uuid()` defaults.

---

## 10. RLS notes (high-level)

- **buyers**: read their own user row, profile, addresses, orders, reviews
  they authored, payment methods, chat threads they participate in. Read
  any seller_profile (public). Read listings (public).
- **sellers**: read their own user row, profile, KYC, opening hours.
  Read+write their own listings + add-ons. Read orders pointing at them.
- **drivers**: read their own user row, profile, KYC. Read orders assigned
  to them. Write `order_issues` for orders they're driving.
- **admins** (separate role): read everything. Write `kyc_submissions.status`.

The `auth.uid()` Postgres function maps a Supabase JWT to the user id; use
it in every RLS policy.

---

## 11. Suggested first migration order

1. Extensions (postgis, pgcrypto)
2. All enums
3. `users` (extends `auth.users`)
4. `addresses`
5. `buyer_profiles`, `seller_profiles`, `driver_profiles`
6. `seller_opening_hours`
7. `kyc_submissions`
8. Storage buckets + RLS policies for KYC
9. **At this point: the auth + signup flow can be wired end-to-end.**
10. `listings`, `listing_add_ons`
11. `orders`, `order_items`, `order_item_addons`
12. `payment_methods`, `payments`
13. `reviews`, `review_criteria_ratings`
14. `bookmarks`
15. Materialized view: `seller_stats`
16. `chat_threads`, `chat_thread_participants`, `chat_messages`
17. `order_issues`, `driver_daily_stats`, `weekly_challenges`

---

## Files referenced

| Concept | Source file |
|---|---|
| User role enum | [user_role.dart](lib/features/authentication/data/models/user_role.dart) |
| Driver vehicle enum | [driver_vehicle_type.dart](lib/features/authentication/data/models/driver_vehicle_type.dart) |
| ID doc type enum | [id_document_type.dart](lib/features/authentication/data/models/id_document_type.dart) |
| Day of week enum | [day_of_week.dart](lib/features/authentication/data/models/day_of_week.dart) |
| Daily time range | [time_range.dart](lib/features/authentication/data/models/time_range.dart) |
| Signup flow state | [signup_flow_controller.dart](lib/features/authentication/controllers/signup_flow_controller.dart) |
| Address | [address.dart](lib/core/models/address.dart) |
| Food listing (was FoodListing + SellerProduct) | [food_listing.dart](lib/core/models/food_listing.dart) |
| Kitchen view-model | [kitchen.dart](lib/core/models/kitchen.dart) |
| Cart item | [cart_item.dart](lib/core/models/cart_item.dart) |
| Listing filter | [listing_filter.dart](lib/core/models/listing_filter.dart) |
| Product add-on | [product_add_on.dart](lib/core/models/product_add_on.dart) |
| Delivery details | [delivery_details.dart](lib/core/models/delivery_details.dart) |
| Fulfillment options | [fulfillment_options.dart](lib/core/models/fulfillment_options.dart) |
| Order detail + DelivererInfo | [order_detail.dart](lib/core/models/order_detail.dart) |
| Order stage | [order_stage.dart](lib/core/enums/order_stage.dart) |
| Payment method (sealed union) | [payment_method.dart](lib/core/models/payment_method.dart) |
| Seller profile + stats + reviews | [seller_profile.dart](lib/core/models/seller_profile.dart) |
| Seller rating | [seller_rating.dart](lib/core/models/seller_rating.dart) |
| Map point / route | [map_route.dart](lib/core/services/map/models/map_route.dart) |
| Food / order enums | [food_enums.dart](lib/core/enums/food_enums.dart), [order_enums.dart](lib/core/enums/order_enums.dart) |
| Driver issues catalog | [issue_catalog.dart](lib/features/delivery/data/issue_catalog.dart) |
| Driver dashboard view-models | [delivery_driver_models.dart](lib/features/delivery/domain/delivery_driver_models.dart) |
| Chat preview | [chat_preview.dart](lib/features/chat/domain/chat_preview.dart) |
