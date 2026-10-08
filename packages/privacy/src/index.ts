import { PUBLIC_DOCUMENT_SCHEMAS, SnapshotManifest, type PublicFileKind } from '@vsa/contracts/public';
import { PUBLIC_ALLOWLIST, type FieldSpec } from './allowlist.ts';
import { findSecretPatterns, isPrivateKey } from './guards.ts';

export { PUBLIC_ALLOWLIST, type FieldSpec } from './allowlist.ts';
export { findSecretPatterns, isPrivateKey, SECRET_PATTERNS } from './guards.ts';

export class PrivacyViolation extends Error {
  readonly violations: readonly string[];
  constructor(violations: readonly string[]) {
    super(`public document rejected: ${violations.slice(0, 5).join('; ')}${violations.length > 5 ? ` (+${violations.length - 5} more)` : ''}`);
    this.name = 'PrivacyViolation';
    this.violations = violations;
  }
}

/** Every key path that is private, anywhere in a value tree (independent of the allowlist). */
export function findPrivateKeys(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((item, i) => findPrivateKeys(item, `${path}[${i}]`));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      [...(isPrivateKey(key) ? [`${path}.${key}: private field`] : []), ...findPrivateKeys(child, `${path}.${key}`)]);
  }
  if (typeof value === 'string') return findSecretPatterns(value).map((name) => `${path}: secret pattern ${name}`);
  return [];
}

/**
 * Explicit allowlist serializer: builds a FRESH value containing only allowlisted fields. Any field not in the
 * allowlist is a violation (deny unknown), as is any private key or secret-shaped string, or a non-scalar where a
 * scalar is expected. Never mutates its input.
 */
function serialize(spec: FieldSpec, value: unknown, path: string, out: string[]): unknown {
  switch (spec.kind) {
    case 'nullable':
      return value === null ? null : serialize(spec.of, value, path, out);
    case 'scalar':
      if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
        if (typeof value === 'number' && !Number.isFinite(value)) out.push(`${path}: non-finite number`);
        if (typeof value === 'string') for (const name of findSecretPatterns(value)) out.push(`${path}: secret pattern ${name}`);
        return value;
      }
      out.push(`${path}: expected scalar`);
      return undefined;
    case 'array':
      if (!Array.isArray(value)) { out.push(`${path}: expected array`); return undefined; }
      return value.map((item, i) => serialize(spec.of, item, `${path}[${i}]`, out));
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) { out.push(`${path}: expected object`); return undefined; }
      const result: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (isPrivateKey(key)) { out.push(`${path}.${key}: private field`); continue; }
        const childSpec = spec.fields[key];
        if (!childSpec) { out.push(`${path}.${key}: field not in public allowlist`); continue; }
        result[key] = serialize(childSpec, child, `${path}.${key}`, out);
      }
      return result;
    }
  }
}

/** Serialize an internal value into a validated public document, or throw PrivacyViolation. */
export function toPublicDocument<K extends PublicFileKind>(kind: K, value: unknown) {
  const violations: string[] = [];
  const serialized = serialize(PUBLIC_ALLOWLIST[kind], value, '$', violations);
  if (violations.length) throw new PrivacyViolation(violations);
  const parsed = PUBLIC_DOCUMENT_SCHEMAS[kind].safeParse(serialized);
  if (!parsed.success) throw new PrivacyViolation(parsed.error.issues.map((i) => `$.${i.path.join('.')}: ${i.message}`));
  return parsed.data;
}

/** Validate an already-serialized public document (publisher, web loader, privacy check). Never coerces. */
export function validatePublicDocument(kind: PublicFileKind, value: unknown) {
  const violations = findPrivateKeys(value);
  const parsed = PUBLIC_DOCUMENT_SCHEMAS[kind].safeParse(value);
  if (!parsed.success) violations.push(...parsed.error.issues.map((i) => `$.${i.path.join('.')}: ${i.message}`));
  if (violations.length) throw new PrivacyViolation(violations);
  return parsed.data!;
}

/** Validate a manifest: strict schema (paths are fixed patterns, so traversal cannot be expressed) plus guards. */
export function validateManifest(value: unknown) {
  const violations = findPrivateKeys(value);
  const parsed = SnapshotManifest.safeParse(value);
  if (!parsed.success) violations.push(...parsed.error.issues.map((i) => `$.${i.path.join('.')}: ${i.message}`));
  if (violations.length) throw new PrivacyViolation(violations);
  return parsed.data!;
}
