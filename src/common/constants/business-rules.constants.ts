/**
 * Business invariants — sourced from product spec.
 * Runtime values come from environment via app.config.ts; constants here
 * are non-tunable structural rules.
 */
export const BusinessRules = {
  // Listings
  MaxImagesPerListing: 6,
  MaxTitleLength: 80,
  MaxDescriptionLength: 1000,
  ListingDefaultExpirationHours: 24,

  // Orders
  OrderConfirmationTimeoutMinutes: 10,
  OrderPickupGracePeriodMinutes: 15,

  // Delivery
  MaxDeliveryRadiusKm: 10,
  DriverMatchingTimeoutSeconds: 60,
  DriverLocationUpdateIntervalSeconds: 5,

  // Reviews
  MinReviewRating: 1,
  MaxReviewRating: 5,
  ReviewWindowDays: 14,

  // Pagination
  DefaultPageSize: 20,
  MaxPageSize: 100,

  // Search
  GeoSearchDefaultRadiusKm: 5,
  GeoSearchMaxRadiusKm: 50,

  // Currency
  DefaultCurrency: 'EUR',
} as const;
