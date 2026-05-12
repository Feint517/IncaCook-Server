/**
 * 7-value FR enum per BACKEND_SCHEMA.md. Doc flags this as a "lookup table
 * (will grow)" — when a new cuisine is needed, add it here and migrate the
 * Postgres enum.
 */
export enum CuisineType {
  Orientale = 'ORIENTALE',
  Francaise = 'FRANCAISE',
  Africaine = 'AFRICAINE',
  Portugaise = 'PORTUGAISE',
  Italienne = 'ITALIENNE',
  Espagnole = 'ESPAGNOLE',
  Latine = 'LATINE',
}
