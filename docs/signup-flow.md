# Signup flow

How users become buyers, sellers, or drivers on IncaCook — and the
backend endpoints that drive each step of the wizard.

This doc has three parts:
1. **§1** — the wizard as the user experiences it, screen by screen.
2. **§3** — the endpoint reference (request + response shape for every
   call the wizard makes).
3. **§4** — `GET /v1/users/me/onboarding`, the completeness endpoint
   that acts as the wizard's resume cursor.

All responses are wrapped by `TransformInterceptor` — see
[`flutter-integration.md`](./flutter-integration.md) for the envelope
format. The bodies shown below are what lives inside `data`.

---

## 1. What the user sees

The wizard is a single `PageView` driven by
[`SignupFlowController`](../lib/features/authentication/controllers/signup_flow_controller.dart).
The step list is computed dynamically from the chosen role / category /
vehicle, so users only see screens that apply to them.

### 1.1 Common preamble — all roles

Every signup starts with the same five screens:

| # | Step | What's collected |
|---|---|---|
| 1 | Basic info | first name, last name, email, phone, password (with strength meter) |
| 2 | Phone verification | 6-digit OTP |
| 3 | Biometric setup | opt-in Face/Touch ID (device-local, never synced) |
| 4 | Legal acceptance | CGU + CGV checkboxes |
| 5 | Role selection | buyer / seller / driver |

After role selection, the wizard branches.

### 1.2 Buyer branch

| # | Step | What's collected |
|---|---|---|
| 6 | Delivery address | line1, city, postcode, lat/lng (Mapbox-geocoded) |
| 7 | Dietary & allergies | dietaryTags[], allergens[] — **skippable** |
| 8 | Done | confirmation, no inputs |

### 1.3 Seller branch

| # | Step | What's collected |
|---|---|---|
| 6 | Profile | photo URL, display name, bio |
| 7 | DOB & pickup address | date of birth (must be ≥18), pickup address |
| 8 | Business info | business name, SIRET (Luhn-checked), facade photo, weekly opening hours — **shown only for non-`fait_maison` categories** |
| 9 | Cuisine | cuisineTypes[], dishTypes[] |
| 10 | KYC — ID | document type, front photo, back photo (when the type requires verso) |
| 11 | KYC — selfie | selfie holding the ID |
| 12 | Charter | hygiene commitment + fait-maison commitment |

### 1.4 Driver branch

| # | Step | What's collected |
|---|---|---|
| 6 | DOB & address | date of birth (must be ≥18), home address |
| 7 | Vehicle | vehicle type (bike / scooter / car / …) |
| 8 | KYC — ID | document type, front, back |
| 9 | KYC — selfie | selfie with ID |
| 10 | Vehicle documents | driving license, carte grise — **shown only when vehicleType.requiresMotorizedDocs** |
| 11 | Operating zones | zone identifiers |
| 12 | Charter | punctuality commitment + care commitment |

### 1.5 Dynamic skipping

Three branches in the step list shorten the wizard:

- `seller.business_info` is skipped server-side when category = FAIT_MAISON.
- `driver.documents` is skipped server-side for non-motorized vehicles.
- `buyer.dietary` is user-skippable from the bottom bar (the "Passer" button).

The skip logic in the wizard is purely UI ordering — the backend
derives `skipped` from underlying state (see §4.3), so the Flutter step
list does **not** need to encode "which steps are optional for which
role".

---

## 2. Backend gates — where the network calls happen

Of the screens above, only two trigger network calls. Everything else
collects into reactive client-side state and is sent later through the
per-concept endpoints in §3.

### 2.1 Gate 1 — Supabase auth signup

Fires when the user passes the Basic Info validator and taps Continue.
The Flutter app stores `accessToken` + `refreshToken` to
`flutter_secure_storage` before returning, so every subsequent request
carries `Authorization: Bearer <accessToken>`.

See §3.1 for the full request/response shape.

### 2.2 Gate 2 — IncaCook profile row

Fires after the user picks a role (legal acceptance is collected as
part of the same body). From this point on the user is a "real"
buyer/seller/driver — the role is committed and downstream services
gate on it.

See §3.3 for the full request/response shape.

### 2.3 What about everything else?

After Gate 2, the user proceeds through six to seven more screens
collecting role-specific data — addresses, KYC, business info, cuisines,
vehicles, charters, preferences. Each one maps to a dedicated endpoint
below.

---

## 3. Endpoint reference

Conventions used throughout this section:
- **Auth** column: `public` means no token; `bearer` means
  `Authorization: Bearer <accessToken>` is required.
- **Body** shows the JSON body shape. Required fields are unmarked;
  optional fields are tagged `// optional`.
- **Response** shows the shape inside `data` of the success envelope.
  Errors use the standard error envelope; see
  [`flutter-integration.md`](./flutter-integration.md).
- Codes shown are the success status. 4xx behavior is noted per
  endpoint where the wizard branches on it.

### 3.1 `POST /v1/auth/signup` — public

Creates a new Supabase auth identity. Returns a session immediately
(local Supabase has email confirmations off; prod may differ).

```http
POST /v1/auth/signup            Auth: public          Status: 201
Content-Type: application/json
```

Request:
```jsonc
{
  "email": "alice@example.com",
  "password": "min8chars"
}
```

Response:
```jsonc
{
  "accessToken": "eyJhbGciOi…",
  "refreshToken": "v1…",
  "expiresAt": 1778601278,            // unix seconds
  "user": {
    "id": "uuid",                     // Supabase auth.users.id
    "email": "alice@example.com",
    "phone": null,
    "emailConfirmedAt": "…ISO…",
    "phoneConfirmedAt": null
  }
}
```

Error cases:
- `409` — email already registered
- `400` — password too weak (`error.code` lives on the wire)
- `429` — over rate limit

### 3.2 `POST /v1/auth/signin` — public

Email + password. Same response shape as `/signup`. Wrong credentials
→ `401` (the message never reveals which factor was wrong).

```http
POST /v1/auth/signin            Auth: public          Status: 200
```
```jsonc
// request
{ "email": "alice@example.com", "password": "min8chars" }
```
Response: same `SessionResponse` shape as §3.1.

### 3.3 `POST /v1/users` — bearer

The IncaCook Gate 2 call. Creates the User row backed by the Supabase
identity in the JWT, plus an empty role-specific stub
(`BuyerProfile` / `SellerProfile` / `DriverProfile` — fields filled in
later via §3.13 / §3.14 / §3.17).

```http
POST /v1/users                  Auth: bearer          Status: 201
```

Request:
```jsonc
{
  "firstName": "Alice",
  "lastName": "Doe",
  "role": "BUYER",                // BUYER | SELLER | DRIVER
  "acceptedCgu": true,            // must be true
  "acceptedCgv": true             // must be true
}
```

Response (`UserResponse`):
```jsonc
{
  "id": "01K…",                   // internal ULID
  "email": "alice@example.com",
  "phone": null,
  "role": "BUYER",
  "firstName": "Alice",
  "lastName": "Doe",
  "avatarPath": null,
  "emailVerified": false,
  "phoneVerified": false,
  "createdAt": "…ISO…",
  // Exactly one of these three is present, matching `role`.
  "buyerProfile": {
    "defaultAddress": null,
    "dietaryTags": [],
    "allergens": []
  }
  // sellerProfile / driverProfile populated similarly for those roles
  // — all fields nullable until the wizard's per-concept PUTs fire.
}
```

Error cases:
- `409` — user already created (idempotent retry)
- `400` — CGU/CGV not accepted

### 3.4 `POST /v1/auth/refresh` — public

Swaps a refresh token for a fresh session. The Flutter `dio`
interceptor calls this transparently when an authenticated request
returns 401.

```http
POST /v1/auth/refresh           Auth: public          Status: 200
```
```jsonc
// request
{ "refreshToken": "v1…" }
```
Response: same `SessionResponse` shape as §3.1.

### 3.5 `POST /v1/auth/signout?scope=local|global` — bearer

Revokes the current session (default `local`) or every session for the
user (`global`).

```http
POST /v1/auth/signout?scope=global    Auth: bearer    Status: 204
```

No body. No response body.

### 3.6 `POST /v1/auth/password/reset-request` — public

Triggers Supabase to email a magic link. Always returns 204 even if
the email doesn't exist (Supabase doesn't leak account existence here).

```http
POST /v1/auth/password/reset-request  Auth: public    Status: 204
```
```jsonc
// request
{
  "email": "alice@example.com",
  "redirectTo": "incacook://auth/recover"   // optional deep link
}
```

### 3.7 `POST /v1/auth/password/update` — bearer

Sets a new password. The Bearer is either the user's normal session
(change-while-signed-in) or the recovery JWT from the magic link
(forgot-password flow) — the strategy doesn't distinguish.

```http
POST /v1/auth/password/update         Auth: bearer    Status: 204
```
```jsonc
// request
{ "newPassword": "min8chars" }
```

### 3.8 `POST /v1/auth/phone/request-otp` — bearer

Attaches a phone number to the caller's existing email-based account
and triggers an SMS OTP. Calling again with a different phone
overwrites the pending phone (last-write-wins). Phone is E.164 with
leading `+`.

```http
POST /v1/auth/phone/request-otp       Auth: bearer    Status: 204
```
```jsonc
// request
{ "phone": "+33611111111" }
```

In local dev with `[auth.sms.test_otp]` configured (see
[`supabase/config.toml`](../supabase/config.toml)), the phones
`+33611111111` / `+33622222222` / `+33633333333` all accept code
`123456` — no real SMS sent.

### 3.9 `POST /v1/auth/phone/verify` — bearer

Confirms the OTP. On success the user's phone is marked verified on
Supabase auth.users **and** mirrored onto `User.phone` /
`User.phoneVerified` in our DB (in canonical E.164 form with the
leading `+`). Returns a fresh session — the Flutter app should swap
tokens.

```http
POST /v1/auth/phone/verify            Auth: bearer    Status: 200
```
```jsonc
// request
{ "phone": "+33611111111", "code": "123456" }
```
Response: same `SessionResponse` shape as §3.1 — `user.phone` and
`user.phoneConfirmedAt` are now populated.

Error cases:
- `401` — wrong code or expired OTP
- `400` — phone format invalid

---

### 3.10 `GET /v1/charters/active` — public

Returns the currently-active version of each charter. The Flutter app
reads this before showing CGU/CGV / role-specific charter screens so it
knows which version string to POST back via §3.11.

```http
GET /v1/charters/active               Auth: public    Status: 200
```

Response:
```jsonc
{
  "CGU": "v1.0",
  "CGV": "v1.0",
  "HYGIENE": "v1.0",
  "FAIT_MAISON": "v1.0",
  "PUNCTUALITY": "v1.0",
  "CARE": "v1.0"
}
```

Bumping a version causes existing acceptances (keyed on
`(userId, charter, version)`) to no longer count, so users get
re-prompted on next sign-in.

### 3.11 `POST /v1/users/me/charters` — bearer

Records the caller's acceptance of one charter version. Idempotent —
re-posting the same `(charter, version)` returns 201 with the
original `acceptedAt`.

```http
POST /v1/users/me/charters            Auth: bearer    Status: 201
```
```jsonc
// request
{
  "charter": "HYGIENE",           // CGU | CGV | HYGIENE | FAIT_MAISON | PUNCTUALITY | CARE
  "version": "v1.0"
}
```

Response:
```jsonc
{
  "charter": "HYGIENE",
  "version": "v1.0",
  "acceptedAt": "2026-05-12T17:20:00.000Z"
}
```

### 3.12 `PUT /v1/users/me/addresses/:kind` — bearer

Upserts the caller's address of the given kind. URL `:kind` is one of:

- `buyer-delivery` (buyer only)
- `seller-pickup` (seller only)
- `driver-home` (driver only)

The role/kind pairing is enforced — calling with a kind that doesn't
match the caller's role returns 400. For seller and driver, a partial
unique index guarantees at most one row per (user, kind); for buyer
delivery, multiple rows are allowed and the wizard's "default address"
PUT operates on the most-recently-updated one.

```http
PUT /v1/users/me/addresses/buyer-delivery   Auth: bearer    Status: 200
```

Request:
```jsonc
{
  "fullAddress": "12 rue de la Bastille",
  "city": "Paris",
  "postalCode": "75011",
  "type": "HOME",                   // optional — HOME | WORK | OTHER
  "customLabel": "Mom's place",     // optional
  "apartment": "3B",                // optional
  "floor": "2",                     // optional
  "digicode": "12A45",              // optional
  "deliveryNotes": "Side entrance", // optional
  "lat": 48.853,                    // optional but recommended (geocoded)
  "lng": 2.369                      // optional
}
```

Response (`AddressResponse`):
```jsonc
{
  "id": "01K…",
  "type": "HOME",
  "customLabel": "Mom's place",
  "fullAddress": "12 rue de la Bastille",
  "city": "Paris",
  "postalCode": "75011",
  "apartment": "3B",
  "floor": "2",
  "digicode": "12A45",
  "deliveryNotes": "Side entrance",
  "lat": 48.853,
  "lng": 2.369
}
```

When `lat`/`lng` are provided, the geography point is written to
`Address.point`; for `seller-pickup`, it's also denormalized onto
`SellerProfile.location` for the listing feed's radius queries.

---

### 3.13 `PUT /v1/buyers/me/preferences` — bearer (buyer only)

Replaces the buyer's dietary tags + allergens in one call. Either
array may be empty (the wizard's preferences step is skippable).

```http
PUT /v1/buyers/me/preferences         Auth: bearer    Status: 200
```

Request:
```jsonc
{
  "dietaryTags": ["HALAL", "GLUTEN_FREE"],
  "allergens": ["ARACHIDES"]
}
```

Response:
```jsonc
{
  "dietaryTags": ["HALAL", "GLUTEN_FREE"],
  "allergens": ["ARACHIDES"]
}
```

Enums:
- `dietaryTags`: `HALAL` | `VEGAN` | `GLUTEN_FREE` | `CASHER`
- `allergens` (EU-mandated 14, French names): `GLUTEN`, `CRUSTACES`,
  `OEUFS`, `POISSONS`, `ARACHIDES`, `SOJA`, `LAIT`, `FRUITS_A_COQUE`,
  `CELERI`, `MOUTARDE`, `SESAME`, `SULFITES`, `LUPIN`, `MOLLUSQUES`

---

### 3.14 `PUT /v1/sellers/me/profile` — bearer (seller only)

Sets the core seller-profile slice. The wizard collects most of these
fields on the "Profile" + "DOB & pickup address" screens.

Setting `category` to FAIT_MAISON for the first time auto-flips
`kycStatus` from PENDING to APPROVED (fait-maison sellers skip the KYC
review step). Changing category later doesn't demote APPROVED back to
PENDING — admin tooling handles that case.

```http
PUT /v1/sellers/me/profile            Auth: bearer    Status: 200
```

Request:
```jsonc
{
  "category": "TRAITEUR",                  // FAIT_MAISON | TRAITEUR | RESTAURANT
  "displayName": "Chez Alice",
  "bio": "Cuisine du marché",              // optional
  "profilePhotoUrl": "avatars/<uid>/01K…", // path returned by /v1/uploads
  "dateOfBirth": "1985-03-12",             // YYYY-MM-DD, must be ≥18
  "neighborhood": "Marais",                // optional
  "deliveryRadiusKm": 5,                   // optional
  "deliveryFeeCents": 250,                 // optional
  "prepMinMinutes": 20,                    // optional
  "prepMaxMinutes": 35,                    // optional, must be ≥ prepMin
  "hygieneCommitment": true,               // optional
  "faitMaisonCommitment": true             // optional (true for fait-maison)
}
```

Response: the full updated `SellerProfile` row.

### 3.15 `PUT /v1/sellers/me/business` — bearer (non-fait-maison sellers)

Upserts the SellerBusiness row and replaces opening hours in one
transaction. Fait-maison sellers get 400 here (they don't have a
storefront).

SIRET is 14 digits, Luhn-checked server-side.

```http
PUT /v1/sellers/me/business           Auth: bearer    Status: 200
```

Request:
```jsonc
{
  "businessName": "Alice Traiteur SARL",
  "siret": "73282932000074",
  "facadeUrl": "seller-facades/<uid>/01K…",  // optional, /v1/uploads path
  "legalForm": "SARL",                       // optional
  "openingHours": [                          // optional, ≤7 rows (one per day)
    { "dayOfWeek": "MONDAY",  "startTime": "09:00", "endTime": "18:00" },
    { "dayOfWeek": "TUESDAY", "startTime": "09:00", "endTime": "18:00" }
  ]
}
```

Response:
```jsonc
{
  "userId": "01K…",
  "businessName": "Alice Traiteur SARL",
  "siret": "73282932000074",
  "facadeUrl": "seller-facades/<uid>/01K…",
  "legalForm": "SARL",
  "createdAt": "…",
  "updatedAt": "…",
  "openingHours": [
    { "dayOfWeek": "MONDAY",  "startTime": "1970-01-01T09:00:00.000Z", "endTime": "…18:00…" },
    { "dayOfWeek": "TUESDAY", "startTime": "…09:00…",                  "endTime": "…18:00…" }
  ]
}
```

### 3.16 `PUT /v1/sellers/me/cuisines` — bearer (seller only)

Replaces the seller's cuisine + dish-type sets (delete-then-insert
inside a transaction). Both arrays must have ≥1 element.

```http
PUT /v1/sellers/me/cuisines           Auth: bearer    Status: 200
```

Request:
```jsonc
{
  "cuisines": ["FRANCAISE", "ITALIENNE"],
  "dishTypes": ["PLAT", "ENTREE"]
}
```

Response: echoes the same arrays.

Enums:
- `cuisines`: `ORIENTALE` | `FRANCAISE` | `AFRICAINE` | `PORTUGAISE` | `ITALIENNE` | `ESPAGNOLE` | `LATINE`
- `dishTypes`: `ENTREE` | `PLAT` | `DESSERT` | `COCKTAIL_DINATOIRE`

---

### 3.17 `PUT /v1/drivers/me/vehicle` — bearer (driver only)

Sets vehicle type and (optionally) date of birth on the same call —
the wizard collects both on the "Vehicle / DOB" screen.

```http
PUT /v1/drivers/me/vehicle            Auth: bearer    Status: 200
```

Request:
```jsonc
{
  "vehicleType": "BICYCLE",        // BICYCLE | SCOOTER | CAR
  "dateOfBirth": "1996-04-22"      // optional, YYYY-MM-DD, must be ≥18
}
```

Response: the full updated `DriverProfile` row.

### 3.18 `PUT /v1/drivers/me/zones` — bearer (driver only)

Replaces the driver's operating zones. Strings are free-text zone
identifiers ("Bastille", "Marais", …); v2 will promote these to a
proper `Zone` lookup table.

```http
PUT /v1/drivers/me/zones              Auth: bearer    Status: 200
```

Request:
```jsonc
{ "zones": ["Bastille", "Marais", "Belleville"] }
```

Response:
```jsonc
{ "zones": ["Bastille", "Marais", "Belleville"] }
```

---

### 3.19 `POST /v1/uploads` — bearer

Issues a Supabase signed upload URL. The Flutter app **PUTs the file
body directly to that URL**, then sends `path` back to the relevant
resource endpoint (e.g. `profilePhotoUrl` on §3.14, `fileUrl` on
§3.20). Two-step uploads make mobile retries cleaner — the file upload
is independent of the metadata write.

```http
POST /v1/uploads                      Auth: bearer    Status: 201
```

Request:
```jsonc
{
  "purpose": "avatar",          // avatar | kyc_document | listing_image | seller_facade
  "contentType": "image/jpeg"   // optional, informational
}
```

Response:
```jsonc
{
  "uploadUrl": "http://127.0.0.1:54321/storage/v1/object/upload/sign/avatars/<uid>/01K…?token=…",
  "token": "…",                                // included for completeness
  "path": "avatars/<supabaseId>/01K…",         // store this in the *Url field
  "bucket": "avatars"
}
```

Path scheme is `<bucket>/<supabaseId>/<ulid>` — server-generated, so a
client can't choose a path inside another user's namespace.

Role gates:
- `avatar` → any role
- `kyc_document` → seller or driver, blocked for fait-maison sellers
- `listing_image` → seller only
- `seller_facade` → seller only, blocked for fait-maison

Mismatch → 403.

After PUTing the file body to `uploadUrl`, the client sends `path`
verbatim to whichever endpoint owns the column.

### 3.20 `POST /v1/kyc/documents` — bearer (seller / driver)

Upserts one KycDocument row keyed on `(userId, type)`. Uploading a new
file for the same slot supersedes the previous one and resets
`reviewState` to PENDING. The seller / driver profile's `kycStatus`
mirror is recomputed from the aggregate state of all docs.

```http
POST /v1/kyc/documents                Auth: bearer    Status: 201
```

Request:
```jsonc
{
  "type": "ID_FRONT",                 // ID_FRONT | ID_BACK | SELFIE | DRIVING_LICENSE | CARTE_GRISE | INSURANCE
  "fileUrl": "kyc/<uid>/01K…",        // path returned by /v1/uploads
  "idDocumentType": "CARTE_IDENTITE"  // required only on ID_FRONT / ID_BACK
                                      //   CARTE_IDENTITE | PASSEPORT | TITRE_SEJOUR
}
```

Response (`KycDocumentResponse`):
```jsonc
{
  "id": "01K…",
  "type": "ID_FRONT",
  "fileUrl": "kyc/<uid>/01K…",
  "reviewState": "PENDING",           // PENDING | APPROVED | REJECTED
  "rejectionReason": null,
  "submittedAt": "…ISO…",
  "reviewedAt": null,
  "metadata": { "idDocumentType": "CARTE_IDENTITE" }
}
```

Role gates:
- Fait-maison sellers: 400 (they don't submit KYC; auto-approved)
- Bicycle drivers attempting `DRIVING_LICENSE` / `CARTE_GRISE` /
  `INSURANCE`: 400 (those slots are for motorized vehicles only)
- ID_FRONT / ID_BACK without `idDocumentType`: 400

### 3.21 `GET /v1/kyc/documents/me` — bearer

Returns every KycDocument row owned by the caller — one row per type
they've uploaded. Used by the wizard's KYC step to know which slots
are filled.

```http
GET /v1/kyc/documents/me              Auth: bearer    Status: 200
```

Response: an array of `KycDocumentResponse` (shape from §3.20).

---

### 3.22 `GET /v1/users/me` — bearer

Returns the full user aggregate — Gate 2 fields + the matching role
profile. Drives post-login routing and reflects every Phase B PUT
back to the client. See §3.3 for the response shape.

---

## 4. The completeness endpoint

### 4.1 `GET /v1/users/me/onboarding` — bearer

Single source of truth for "what's left for this user to do?" — the
Flutter wizard's resume cursor reads from here, the listings
publish-gate reads `canList` from here, etc.

```http
GET /v1/users/me/onboarding           Auth: bearer    Status: 200
```

Response shape — fields vary by role:

**Buyer:**
```jsonc
{
  "role": "BUYER",
  "next": "addresses",                // first incomplete step, or null when done
  "steps": {
    "addresses": "incomplete",
    "preferences": "incomplete"
  }
}
```

**Seller (TRAITEUR mid-signup):**
```jsonc
{
  "role": "SELLER",
  "next": "kyc_selfie",
  "steps": {
    "profile":     "complete",
    "addresses":   "complete",
    "business":    "complete",        // "skipped" for FAIT_MAISON
    "cuisines":    "complete",
    "kyc_id":      "complete",        // or "pending_review" / "skipped" for FAIT_MAISON
    "kyc_selfie":  "incomplete",
    "charter":     "incomplete"
  },
  "kycReviewState": "PENDING",        // PENDING | APPROVED | REJECTED
  "canList": false
}
```

**Driver (bicycle, fully filled):**
```jsonc
{
  "role": "DRIVER",
  "next": null,
  "steps": {
    "addresses":   "complete",
    "vehicle":     "complete",
    "zones":       "complete",
    "kyc_id":      "pending_review",
    "kyc_selfie":  "pending_review",
    "documents":   "skipped",         // bicycle → non-motorized → skipped
    "charter":     "complete"
  },
  "kycReviewState": "PENDING",
  "canDeliver": false                 // true once kycReviewState=APPROVED
}
```

### 4.2 Status values

| Status | Meaning |
|---|---|
| `complete` | Row exists with all required fields. |
| `incomplete` | Row missing or partially filled, OR a KYC doc is `REJECTED` and needs re-upload. |
| `skipped` | Explicitly not required for this user (e.g. `business` for fait-maison sellers, `documents` for non-motorized drivers, KYC slots for fait-maison sellers). |
| `pending_review` | All required slots uploaded but admin hasn't approved yet. Only applies to KYC steps. |

### 4.3 Derivation rules

The server computes each `steps.*` from underlying table state. Each
rule is a single deterministic check:

| Step key | Status logic |
|---|---|
| `profile` | `SellerProfile` row has `displayName` + `profilePhotoUrl` + `dateOfBirth` + `category` |
| `business` | Fait-maison → `skipped`; otherwise `SellerBusiness` row exists |
| `cuisines` | `SellerCuisine` has ≥1 row |
| `addresses` | `Address` row exists for the role's required `kind` (BUYER_DELIVERY / SELLER_PICKUP / DRIVER_HOME) |
| `preferences` | Buyer's `BuyerProfile` has been updated (or has any tags/allergens) |
| `vehicle` | `DriverProfile.vehicleType` AND `dateOfBirth` both set |
| `zones` | `DriverZone` has ≥1 row |
| `kyc_id` | Fait-maison → `skipped`; else ID_FRONT (+ ID_BACK when the doc type requires verso) all APPROVED (PENDING → `pending_review`; REJECTED / missing → `incomplete`) |
| `kyc_selfie` | Fait-maison → `skipped`; else SELFIE doc APPROVED |
| `documents` | Non-motorized → `skipped`; else DRIVING_LICENSE + CARTE_GRISE both APPROVED |
| `charter` | All role-required charters acknowledged in `UserCharter` for the **current** version (per `GET /v1/charters/active`) |

Required charters per role:
- Buyer: none (CGU/CGV captured at Gate 2)
- Seller, non-fait-maison: `HYGIENE`
- Seller, fait-maison: `HYGIENE` + `FAIT_MAISON`
- Driver: `PUNCTUALITY` + `CARE`

The `next` field is the first `incomplete` step in canonical role
order. When every step is `complete` or `skipped`, `next` is null.

### 4.4 Derived gate flags

- **`canList`** (seller) — every step `complete`/`skipped` AND
  `kycReviewState === APPROVED`. The listing-publish gate
  (`POST /v1/listings`) reads this. Fait-maison sellers reach
  `canList=true` immediately after profile + addresses + cuisines +
  charter, since their KYC auto-approves.
- **`canDeliver`** (driver) — analogous. The driver-assignment /
  `claim` gate reads this.
- Buyer never has either flag — buyers can browse and order immediately
  after Gate 2.

### 4.5 Client usage

The wizard calls `/users/me/onboarding` in two situations:

**Cold start with a stored session.** Tokens exist in
`flutter_secure_storage`; the app fetches `/users/me/onboarding`. A
non-null `next` means the user abandoned mid-signup — the app jumps the
`PageView` to that step.

```dart
final state = await usersRepository.fetchOnboarding();
if (state.next != null) {
  controller.currentPage.value = controller.steps.indexWhere(
    (s) => s.key == state.next,
  );
}
```

**After each role-specific PUT/POST**, to confirm the status flipped
and learn the new `next` (which may have skipped ahead past an optional
step).

### 4.6 Resume across devices

Because the completeness endpoint is the single source of truth, a user
who starts signup on iOS, gets to KYC, then signs in on web will land
on the same screen they left iOS at. No client-side synchronization
needed — both surfaces consume the same shape.

---

## 5. Lifecycle summary

End-to-end sequence the backend observes for a complete signup:

```
1.  POST  /v1/auth/signup                          → row in auth.users (session returned)
2.  POST  /v1/users                                → row in User (Gate 2, role committed)
3.  POST  /v1/auth/phone/request-otp               → Supabase sends SMS OTP
4.  POST  /v1/auth/phone/verify                    → User.phone, User.phoneVerified set
5.  POST  /v1/uploads (purpose=…)         ┐
    PUT   <signed url>                    │  Per-asset uploads. Each pair
                                          │  produces a `path` the client
                                          │  passes to a resource endpoint.
6.  PUT   /v1/sellers/me/profile          ┐
    PUT   /v1/sellers/me/business         │  Role-specific tables populate
    PUT   /v1/sellers/me/cuisines         │  in whatever order the user
    PUT   /v1/users/me/addresses/:kind    │  advances. Each call upserts;
    POST  /v1/kyc/documents (ID_FRONT)    │  the user can abandon and
    POST  /v1/kyc/documents (ID_BACK)     │  resume freely.
    POST  /v1/kyc/documents (SELFIE)      │
    POST  /v1/users/me/charters …         ┘
7.  Each PUT/POST is followed by GET /v1/users/me/onboarding, which
    returns the next incomplete step. When `next == null`, the wizard
    navigates to the role home.
8.  PayoutSetupBanner (sellers / drivers) checks for an active Stripe
    Connect Express account; if missing, prompts onboarding. This is
    independent of /onboarding completeness — it's the next post-signup
    gate, not a wizard step.
```

---

## 6. Resolved design decisions

The four open questions from earlier drafts of this doc have all been
locked in implementation:

### 6.1 Skipped steps — empty PUT or no call at all?

**Decided: no call at all.** Per §4.3 the server derives `skipped` from
category / vehicle type — the client stays unaware of "which steps are
optional for which role".

### 6.2 Charter versioning

**Decided: `GET /v1/charters/active`** (§3.10). Versions are hardcoded
in
[`charters.constants.ts`](../src/modules/compliance/charters/charters.constants.ts) —
bumping requires a deploy but is in git history. Move to a DB row only
when ops needs to roll versions without a deploy.

### 6.3 KYC upload mechanism

**Decided: two-step.** `POST /v1/uploads` (§3.19) returns a signed URL
the client PUTs the file body to; then the client posts the resulting
`path` to `POST /v1/kyc/documents` (§3.20).

### 6.4 Phone OTP

**Decided: `POST /v1/auth/phone/{request-otp,verify}`** (§3.8, §3.9).
Sits on top of Supabase's phone-change flow; local dev uses
`[auth.sms.test_otp]`, prod uses Twilio.
