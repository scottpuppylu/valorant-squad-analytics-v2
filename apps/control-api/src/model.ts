import type { ConsentGrantName, ConsentGrants, SyncJobState } from '@vsa/contracts/control';

/**
 * control-plane-v1 STORAGE records. They hold metadata only — no match, round, event, position or analytics evidence
 * (CONTROL_PLANE_CANONICAL_MATCH_STORAGE = 0). Fields marked PRIVATE never leave the control plane: views, audit entries
 * and data-plane events are built from allowlisted fields.
 */

/** Authenticated principal, supplied by the transport (never trusted from request bodies). */
export type Principal = { kind: 'USER'; userId: string } | { kind: 'WORKER'; workerId: string } | { kind: 'SYSTEM'; reason: string };

/** Product identity. Never a Riot PUUID, Henrik account id or Discord id — those live in identity connections. */
export interface UserRecord { userId: string; displayName: string; status: 'ACTIVE' | 'DISABLED'; createdAt: string }

export interface IdentityConnectionRecord {
  connectionId: string;
  userId: string;
  provider: 'RIOT' | 'DISCORD';
  /** PRIVATE: the provider's subject (e.g. a verified Riot account id). Never in views, audit or events. */
  providerSubject: string | null;
  status: 'PENDING' | 'VERIFIED' | 'DISCONNECTED';
  /** PRIVATE: hash of the one-time state value of a pending connection attempt. */
  attemptStateHash: string | null;
  createdAt: string;
  verifiedAt: string | null;
  disconnectedAt: string | null;
}

export interface GroupRecord {
  groupId: string;
  name: string;
  visibility: 'PRIVATE' | 'INVITE_ONLY';
  status: 'ACTIVE' | 'ARCHIVED';
  createdBy: string;
  createdAt: string;
  archivedAt: string | null;
}

export type Role = 'OWNER' | 'ADMIN' | 'MEMBER';
export type MembershipStateName = 'INVITED' | 'ACTIVE' | 'LEFT' | 'REMOVED';
export interface MembershipRecord { membershipId: string; groupId: string; userId: string; role: Role; state: MembershipStateName; createdAt: string; updatedAt: string }

/** Allowed membership transitions. Re-joining after LEFT / REMOVED needs a NEW invite (an explicit admin decision). */
export const MEMBERSHIP_TRANSITIONS: Readonly<Record<MembershipStateName, readonly MembershipStateName[]>> = Object.freeze({
  INVITED: ['ACTIVE', 'REMOVED'],
  ACTIVE: ['LEFT', 'REMOVED'],
  LEFT: ['ACTIVE'],
  REMOVED: ['ACTIVE'],
});

export interface InviteRecord {
  inviteId: string;
  groupId: string;
  createdBy: string;
  /** PRIVATE: SHA-256 of the 256-bit token. The raw token is returned once to the creator and never stored or logged. */
  tokenHash: string;
  /** Optional addressee: an INVITED membership exists until acceptance or revocation. */
  forUserId: string | null;
  status: 'OPEN' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  createdAt: string;
  expiresAt: string;
  acceptedBy: string | null;
  acceptedAt: string | null;
  revokedAt: string | null;
}

/** Consent per membership (user × group). EXPLICIT records start all-false; nothing is ever inferred. */
export interface ConsentRecord {
  membershipId: string;
  groupId: string;
  userId: string;
  status: 'EXPLICIT' | 'REQUIRES_RECONCILIATION';
  grants: ConsentGrants;
  policyVersion: string | null;
  updatedAt: string;
  version: number;
}

export const NO_GRANTS: ConsentGrants = Object.freeze({ IDENTITY_CONNECTED: false, DATA_COLLECTION_ALLOWED: false, GROUP_VISIBILITY_ALLOWED: false, PUBLIC_DERIVED_ANALYTICS_ALLOWED: false });
/** Each grant requires the previous one; revoking a grant revokes everything after it. */
export const GRANT_ORDER: readonly ConsentGrantName[] = ['IDENTITY_CONNECTED', 'DATA_COLLECTION_ALLOWED', 'GROUP_VISIBILITY_ALLOWED', 'PUBLIC_DERIVED_ANALYTICS_ALLOWED'];

/** One consent change: actor, time, reason / source, previous and new state. Append-only. */
export interface ConsentTransitionRecord {
  transitionId: string;
  membershipId: string;
  actor: string;
  at: string;
  source: string;
  previous: ConsentGrants;
  next: ConsentGrants;
}

export interface SyncJobRecord {
  jobId: string;
  groupId: string;
  membershipId: string;
  requestedBy: string;
  state: SyncJobState;
  attempt: number;
  leaseOwner: string | null;
  /** PRIVATE: hash of the current lease (fencing) token. */
  leaseTokenHash: string | null;
  leaseExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  blockedReasons: string[];
  /** Execution record of a finished run (summary only — never telemetry). */
  result: { outcome: 'SUCCEEDED' | 'FAILED'; matchesIngested: number; errorCode: string | null } | null;
}

/**
 * Allowed job transitions. There is no PENDING → SUCCEEDED / FAILED: completion requires a RUNNING execution under a
 * valid lease. CLAIMED / RUNNING with an expired lease may be reclaimed (→ CLAIMED, attempt + 1).
 */
export const JOB_TRANSITIONS: Readonly<Record<SyncJobState, readonly SyncJobState[]>> = Object.freeze({
  PENDING: ['CLAIMED', 'CANCELLED', 'BLOCKED_CONSENT'],
  CLAIMED: ['RUNNING', 'CLAIMED', 'CANCELLED', 'BLOCKED_CONSENT', 'FAILED'],
  RUNNING: ['SUCCEEDED', 'FAILED', 'CLAIMED', 'CANCELLED'],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
  BLOCKED_CONSENT: [],
});
export const TERMINAL_JOB_STATES: ReadonlySet<SyncJobState> = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'BLOCKED_CONSENT']);

export const AUDIT_ACTIONS = [
  'USER_REGISTERED', 'GROUP_CREATED', 'GROUP_RENAMED', 'GROUP_ARCHIVED', 'INVITE_CREATED', 'INVITE_REVOKED', 'INVITE_EXPIRED', 'INVITE_ACCEPTED', 'INVITE_REJECTED',
  'MEMBERSHIP_LEFT', 'MEMBERSHIP_REMOVED', 'ROLE_CHANGED', 'IDENTITY_CONNECTION_STARTED', 'IDENTITY_CONNECTED', 'IDENTITY_DISCONNECTED', 'CONSENT_GRANTED',
  'CONSENT_REVOKED', 'SYNC_REQUESTED', 'SYNC_BLOCKED', 'SYNC_CLAIMED', 'SYNC_RECLAIMED', 'SYNC_STARTED', 'SYNC_COMPLETED', 'SYNC_CANCELLED',
  'DATA_REVOCATION_REQUESTED', 'AUTHORIZATION_DENIED',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Append-only audit entry: ids, action, outcome and code labels only (no tokens, hashes, subjects or free text). */
export interface AuditEntry {
  auditId: string;
  seq: number;
  at: string;
  actorKind: Principal['kind'];
  actorRef: string;
  action: AuditAction;
  groupId: string | null;
  targetRef: string | null;
  outcome: 'SUCCESS' | 'DENIED';
  codes: string[];
}
