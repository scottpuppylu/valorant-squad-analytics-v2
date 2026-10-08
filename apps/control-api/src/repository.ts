import type { ConsentReconciliationRecord, DataRevocationRequested } from '@vsa/contracts/control';
import type {
  AuditEntry, ConsentRecord, ConsentTransitionRecord, GroupRecord, IdentityConnectionRecord, InviteRecord, MembershipRecord, SyncJobRecord, UserRecord,
} from './model.ts';

/**
 * Portable control-plane storage contract (control-plane-v1). Metadata only: users, groups, memberships, invites,
 * identity connections, consent, sync jobs, revocation outbox, reconciliation records and the append-only audit log.
 * No vendor SDK is assumed (no Neon / Supabase / D1 / Firebase / Vercel storage); a future PostgreSQL implementation
 * would use its own `control_plane` schema, never the canonical telemetry tables (docs/CONTROL_PLANE_DESIGN.md).
 */
export interface ControlPlaneStore {
  getUser(userId: string): UserRecord | null;
  putUser(user: UserRecord): void;

  getGroup(groupId: string): GroupRecord | null;
  putGroup(group: GroupRecord): void;

  getMembership(membershipId: string): MembershipRecord | null;
  findMembership(groupId: string, userId: string): MembershipRecord | null;
  listMembershipsByGroup(groupId: string): MembershipRecord[];
  listMembershipsByUser(userId: string): MembershipRecord[];
  putMembership(membership: MembershipRecord): void;

  getInvite(inviteId: string): InviteRecord | null;
  findInviteByTokenHash(tokenHash: string): InviteRecord | null;
  listInvites(): InviteRecord[];
  putInvite(invite: InviteRecord): void;

  getConnection(connectionId: string): IdentityConnectionRecord | null;
  listConnectionsByUser(userId: string): IdentityConnectionRecord[];
  findVerifiedConnectionBySubject(provider: IdentityConnectionRecord['provider'], providerSubject: string): IdentityConnectionRecord | null;
  putConnection(connection: IdentityConnectionRecord): void;

  getConsent(membershipId: string): ConsentRecord | null;
  listConsentsByUser(userId: string): ConsentRecord[];
  putConsent(consent: ConsentRecord): void;
  appendConsentTransition(transition: ConsentTransitionRecord): void;
  listConsentTransitions(membershipId: string): ConsentTransitionRecord[];

  getJob(jobId: string): SyncJobRecord | null;
  listJobs(): SyncJobRecord[];
  putJob(job: SyncJobRecord): void;

  appendRevocation(event: DataRevocationRequested): void;
  listRevocations(): DataRevocationRequested[];

  putReconciliation(record: ConsentReconciliationRecord): void;
  listReconciliations(): ConsentReconciliationRecord[];

  appendAudit(entry: Omit<AuditEntry, 'seq'>): AuditEntry;
  listAudit(): AuditEntry[];
}

export interface ControlPlaneRepository {
  /** Run `work` atomically and serially: all writes commit together or none do. */
  transact<T>(work: (store: ControlPlaneStore) => T): Promise<T>;
  /** Read-only snapshot access. */
  read<T>(work: (store: ControlPlaneStore) => T): Promise<T>;
}

interface State {
  users: Map<string, UserRecord>;
  groups: Map<string, GroupRecord>;
  memberships: Map<string, MembershipRecord>;
  invites: Map<string, InviteRecord>;
  connections: Map<string, IdentityConnectionRecord>;
  consents: Map<string, ConsentRecord>;
  transitions: ConsentTransitionRecord[];
  jobs: Map<string, SyncJobRecord>;
  revocations: DataRevocationRequested[];
  reconciliations: Map<string, ConsentReconciliationRecord>;
  audit: AuditEntry[];
}

const emptyState = (): State => ({ users: new Map(), groups: new Map(), memberships: new Map(), invites: new Map(), connections: new Map(), consents: new Map(),
  transitions: [], jobs: new Map(), revocations: [], reconciliations: new Map(), audit: [] });
const copy = <T>(value: T): T => structuredClone(value);
const frozen = <T extends object>(value: T): T => Object.freeze(copy(value));

/**
 * Deterministic local reference repository (tests, local development). Transactions are serialized and copy-on-write:
 * a thrown error discards every write of that transaction. Records are copied in and out, so callers can never mutate
 * stored state; the audit log and the transition / revocation logs are append-only.
 */
export class InMemoryControlPlaneRepository implements ControlPlaneRepository {
  private state: State = emptyState();
  private queue: Promise<unknown> = Promise.resolve();

  transact<T>(work: (store: ControlPlaneStore) => T): Promise<T> {
    const run = this.queue.then(() => {
      const draft = copy(this.state);
      const result = work(storeOver(draft));
      this.state = draft;
      return copy(result);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  read<T>(work: (store: ControlPlaneStore) => T): Promise<T> {
    const run = this.queue.then(() => copy(work(storeOver(copy(this.state)))));
    this.queue = run.catch(() => undefined);
    return run;
  }
}

function storeOver(s: State): ControlPlaneStore {
  const get = <T>(map: Map<string, T>, key: string): T | null => (map.has(key) ? copy(map.get(key)!) : null);
  return {
    getUser: (id) => get(s.users, id),
    putUser: (u) => { s.users.set(u.userId, copy(u)); },
    getGroup: (id) => get(s.groups, id),
    putGroup: (g) => { s.groups.set(g.groupId, copy(g)); },
    getMembership: (id) => get(s.memberships, id),
    findMembership: (groupId, userId) => copy([...s.memberships.values()].find((m) => m.groupId === groupId && m.userId === userId) ?? null),
    listMembershipsByGroup: (groupId) => copy([...s.memberships.values()].filter((m) => m.groupId === groupId)),
    listMembershipsByUser: (userId) => copy([...s.memberships.values()].filter((m) => m.userId === userId)),
    putMembership: (m) => { s.memberships.set(m.membershipId, copy(m)); },
    getInvite: (id) => get(s.invites, id),
    findInviteByTokenHash: (hash) => copy([...s.invites.values()].find((i) => i.tokenHash === hash) ?? null),
    listInvites: () => copy([...s.invites.values()]),
    putInvite: (i) => { s.invites.set(i.inviteId, copy(i)); },
    getConnection: (id) => get(s.connections, id),
    listConnectionsByUser: (userId) => copy([...s.connections.values()].filter((c) => c.userId === userId)),
    findVerifiedConnectionBySubject: (provider, subject) => copy([...s.connections.values()].find((c) => c.provider === provider && c.status === 'VERIFIED' && c.providerSubject === subject) ?? null),
    putConnection: (c) => { s.connections.set(c.connectionId, copy(c)); },
    getConsent: (id) => get(s.consents, id),
    listConsentsByUser: (userId) => copy([...s.consents.values()].filter((c) => c.userId === userId)),
    putConsent: (c) => { s.consents.set(c.membershipId, copy(c)); },
    appendConsentTransition: (t) => { s.transitions.push(frozen(t)); },
    listConsentTransitions: (membershipId) => copy(s.transitions.filter((t) => t.membershipId === membershipId)),
    getJob: (id) => get(s.jobs, id),
    listJobs: () => copy([...s.jobs.values()]),
    putJob: (j) => { s.jobs.set(j.jobId, copy(j)); },
    appendRevocation: (e) => { s.revocations.push(frozen(e)); },
    listRevocations: () => copy(s.revocations),
    putReconciliation: (r) => { s.reconciliations.set(r.recordId, copy(r)); },
    listReconciliations: () => copy([...s.reconciliations.values()]),
    appendAudit: (entry) => { const e = frozen({ ...entry, seq: s.audit.length + 1 }); s.audit.push(e); return copy(e); },
    listAudit: () => copy(s.audit),
  };
}
