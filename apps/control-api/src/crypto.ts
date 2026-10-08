import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256-bit opaque bearer secrets (invite tokens, lease tokens). base64url, 43 characters; never sequential. */
export const SECRET_BYTES = 32;
export const newSecret = (bytes: number = SECRET_BYTES): string => randomBytes(bytes).toString('base64url');

/** Opaque, non-sequential record ids (96 random bits) — identifiers, not secrets. */
export const newId = (prefix: 'usr' | 'grp' | 'mbr' | 'inv' | 'idc' | 'job' | 'aud' | 'evt' | 'ctr' | 'rec' | 'att'): string => `${prefix}_${randomBytes(12).toString('hex')}`;

/** Domain-separated SHA-256 of a secret: the only form ever stored. */
export const hashSecret = (purpose: 'invite-token-v1' | 'lease-token-v1' | 'identity-state-v1', secret: string): string =>
  createHash('sha256').update(`vsa-control-plane:${purpose}:${secret}`, 'utf8').digest('hex');

/** Constant-time comparison of two hex digests of equal length (false on any length / format mismatch). */
export function digestEquals(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/u.test(a) || !/^[0-9a-f]{64}$/u.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
