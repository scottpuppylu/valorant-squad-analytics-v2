import type { PublicFileKind } from '@vsa/contracts/public';

/**
 * The AUTHORITATIVE public field allowlist. A field not listed here can never be published: the serializer rejects
 * it (it does not silently drop it, so an accidentally attached private field is surfaced as an error).
 * tests/privacy.test.ts proves this tree equals the strict public Zod schemas in @vsa/contracts/public.
 */
export type FieldSpec =
  | { kind: 'scalar' }
  | { kind: 'object'; fields: Record<string, FieldSpec> }
  | { kind: 'array'; of: FieldSpec }
  | { kind: 'nullable'; of: FieldSpec };

const scalar: FieldSpec = { kind: 'scalar' };
const obj = (fields: Record<string, FieldSpec>): FieldSpec => ({ kind: 'object', fields });
const arr = (of: FieldSpec): FieldSpec => ({ kind: 'array', of });
const nullable = (of: FieldSpec): FieldSpec => ({ kind: 'nullable', of });

const provenance = obj({ historyCompleteness: scalar, lifetimeComplete: scalar, summary: scalar });
const scope = obj({ mode: scalar, historyCompleteness: scalar });

export const PUBLIC_ALLOWLIST: Record<PublicFileKind, FieldSpec> = {
  group: obj({
    snapshotVersion: scalar,
    group: obj({ publicGroupId: scalar, name: scalar }),
    members: arr(obj({ publicMemberId: scalar, displayName: scalar })),
    provenance,
    dataAsOf: nullable(scalar),
  }),
  players: obj({
    snapshotVersion: scalar,
    players: arr(obj({ publicMemberId: scalar, displayName: scalar, matchesObserved: scalar, firstObservedAt: nullable(scalar), lastObservedAt: nullable(scalar) })),
  }),
  analytics: obj({
    snapshotVersion: scalar,
    analyticsContractVersion: scalar,
    scope,
    algorithms: arr(obj({ algorithmId: scalar, description: scalar })),
    players: arr(obj({
      publicMemberId: scalar, algorithmId: scalar,
      sampleSize: obj({ matches: scalar, rounds: scalar }),
      matchesPlayed: scalar, wins: scalar, losses: scalar, kills: scalar, deaths: scalar, assists: scalar,
      kd: nullable(scalar), adr: nullable(scalar),
      eligible: scalar, eligibilityReasons: arr(scalar),
    })),
  }),
};
