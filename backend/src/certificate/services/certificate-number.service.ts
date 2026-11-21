import { randomInt } from 'node:crypto';

// No 0/O or 1/I/L: people type these numbers in from paper.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const CERTIFICATE_NO_PATTERN = /^PSM-\d{4}-[A-Z2-9]{8}$/;

/**
 * Random, not sequential: a stranger cannot guess the next certificate number and walk
 * through everyone's certificates. Uniqueness is guaranteed by the unique index on
 * certificate_no (31^8 ≈ 850 billion values, so a clash is very rare and simply retried).
 */
export function generateCertificateNo(now: Date = new Date()): string {
  let suffix = '';
  for (let i = 0; i < 8; i++) suffix += ALPHABET[randomInt(ALPHABET.length)];
  return `PSM-${now.getFullYear()}-${suffix}`;
}
