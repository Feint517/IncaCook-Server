import { registerAs } from '@nestjs/config';

/**
 * Normalises the FCM service-account private key into valid PEM, robust to
 * how the value was stored in `.env`:
 *   - strips a surrounding pair of quotes the loader may have kept
 *     (dotenv doesn't always strip them, leaving a leading `"` that breaks
 *     OpenSSL with "DECODER routines::unsupported");
 *   - converts escaped `\n` into real newlines (no-op when already real).
 */
function normalizePrivateKey(raw: string): string {
  let key = raw.trim();
  // Strip a stray trailing comma a JSON-style paste may leave (`"...key...",`).
  if (key.endsWith(',')) {
    key = key.slice(0, -1).trim();
  }
  // Strip a surrounding pair of quotes the loader may have kept (a leading `"`
  // breaks OpenSSL with "DECODER routines::unsupported").
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  // Convert escaped `\n` into real newlines (no-op when already real).
  return key.replace(/\\n/g, '\n');
}

export const firebaseConfig = registerAs('firebase', () => ({
  projectId: process.env.FIREBASE_PROJECT_ID ?? '',
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL ?? '',
  privateKey: normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY ?? ''),
}));

export type FirebaseConfig = ReturnType<typeof firebaseConfig>;
