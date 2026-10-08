import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PUBLIC_DOCUMENT_SCHEMAS, type PublicFileKind } from '@vsa/contracts/public';
import { findPrivateKeys, PrivacyViolation, PUBLIC_ALLOWLIST, toPublicDocument, validatePublicDocument, type FieldSpec } from '@vsa/privacy';

const validGroup = () => ({
  snapshotVersion: 'public-snapshot-v1',
  group: { publicGroupId: 'g_0123456789abcdef', name: 'Demo' },
  members: [{ publicMemberId: 'm_0123456789abcdef', displayName: 'Nova' }],
  provenance: { historyCompleteness: 'provider-visible', lifetimeComplete: false, summary: 'synthetic' },
  dataAsOf: null,
});

const PRIVATE_FIELDS = ['puuid', 'matchIdRaw', 'accessToken', 'refreshToken', 'locationX', 'locationY', 'viewRadians', 'databaseUrl', 'providerSecret',
  'PUUID', 'player_puuid', 'raw_match_id', 'api_key', 'participantId', 'providerAccountRef'];

describe('public serialization policy', () => {
  it('accepts a valid document unchanged', () => {
    expect(toPublicDocument('group', validGroup())).toEqual(validGroup());
  });

  it.each(PRIVATE_FIELDS)('rejects the private field %s at the top level and nested', (field) => {
    expect(() => toPublicDocument('group', { ...validGroup(), [field]: 'x' })).toThrow(PrivacyViolation);
    const nested = validGroup();
    (nested.members[0] as Record<string, unknown>)[field] = 'x';
    expect(() => toPublicDocument('group', nested)).toThrow(PrivacyViolation);
    expect(() => validatePublicDocument('group', nested)).toThrow(PrivacyViolation);
  });

  it('denies unknown fields even when their names look harmless', () => {
    expect(() => toPublicDocument('group', { ...validGroup(), favouriteColour: 'blue' })).toThrow(/not in public allowlist/u);
    expect(() => validatePublicDocument('group', { ...validGroup(), favouriteColour: 'blue' })).toThrow(PrivacyViolation);
  });

  it.each([
    ['postgres://user:pass@db.example/vsa'], ['HDEV-01234567-89ab-cdef-0123-456789abcdef'], ['RGAPI-01234567-89ab'],
    ['Bearer abcdefghijklmnopqrstuvwxyz012345'], ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXZhbHVl'],
  ])('rejects secret-shaped values in allowed fields: %s', (secret) => {
    expect(() => toPublicDocument('group', { ...validGroup(), group: { publicGroupId: 'g_0123456789abcdef', name: secret.slice(0, 80) } })).toThrow(PrivacyViolation);
  });

  it('finds private keys recursively in arbitrary structures', () => {
    expect(findPrivateKeys({ a: [{ b: { locationX: 1 } }], c: { refresh_token: 'x' } })).toEqual(['$.a[0].b.locationX: private field', '$.c.refresh_token: private field']);
  });

  it('the allowlist is exactly the strict public schema shape (single source of truth is tested)', () => {
    const shape = (schema: z.ZodType): FieldSpec => {
      if (schema instanceof z.ZodNullable) return { kind: 'nullable', of: shape(schema.unwrap() as z.ZodType) };
      if (schema instanceof z.ZodArray) return { kind: 'array', of: shape(schema.element as z.ZodType) };
      if (schema instanceof z.ZodObject) return { kind: 'object', fields: Object.fromEntries(Object.entries(schema.shape).map(([k, v]) => [k, shape(v as z.ZodType)])) };
      return { kind: 'scalar' };
    };
    for (const kind of Object.keys(PUBLIC_DOCUMENT_SCHEMAS) as PublicFileKind[]) expect(PUBLIC_ALLOWLIST[kind]).toEqual(shape(PUBLIC_DOCUMENT_SCHEMAS[kind]));
  });

  it('never mutates its input and produces a fresh value', () => {
    const input = validGroup();
    const frozen = JSON.stringify(input);
    const out = toPublicDocument('group', input);
    expect(JSON.stringify(input)).toBe(frozen);
    expect(out).not.toBe(input);
  });
});
