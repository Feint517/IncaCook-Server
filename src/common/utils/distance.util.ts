const EARTH_RADIUS_KM = 6371;

const toRadians = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Haversine distance between two lat/lng points, in kilometres.
 * Use only for rough client-side estimates; authoritative distance lives in
 * PostGIS queries.
 */
export const haversineKm = (
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number => {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
};
