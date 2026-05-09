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
