import { randomBytes } from 'node:crypto';

import { customAlphabet } from 'nanoid';
import { ulid } from 'ulid';

const ORDER_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * Lexicographically sortable, URL-safe ID for primary keys not handled by
 * the database.
 */
export const generateUlid = (): string => ulid();

/**
 * Short, human-friendly order code (e.g. "X3K7M9"). Avoids ambiguous
 * characters (0/O, 1/I).
 */
export const generateOrderCode = (length = 8): string => {
  const make = customAlphabet(ORDER_ALPHABET, length);
  return make();
};

/**
 * Cryptographically-random, URL-safe token (default 24 bytes → 32 chars).
 * Used for the seller→driver pickup-proof QR: high entropy so it can't be
 * guessed, and unique enough to key a delivery by.
 */
export const generateSecureToken = (bytes = 24): string => randomBytes(bytes).toString('base64url');
