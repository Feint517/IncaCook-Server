/**
 * Money is stored as integer cents to avoid floating-point drift. These
 * helpers convert at the API boundary.
 */
export const eurosToCents = (euros: number): number => Math.round(euros * 100);

export const centsToEuros = (cents: number): number => Math.round(cents) / 100;

export const formatEuros = (cents: number, locale = 'fr-FR'): string =>
  new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(centsToEuros(cents));
