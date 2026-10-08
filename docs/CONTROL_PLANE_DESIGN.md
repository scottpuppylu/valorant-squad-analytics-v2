# Control plane design (`control-plane-v1`)

V2-CONSENT-CONTROL-PLANE-01 (2026-10-09). Status: **AWAITING SDD REVIEW**. Local only: no deployment, no cloud
database, no Riot RSO network work, no real users.

The control plane coordinates **people and permissions**. It never handles telemetry. Code lives in `apps/control-api`:

| Layer | Files |
|---|---|
| Domain | `service.ts`, `model.ts`, `eligibility.ts`, `reconciliation.ts` |
| Ports | `repository.ts`, `identity.ts` |
| Thin transport | `handlers.ts`, `localServer.ts` |
| View contracts | `views.ts` |

Shared shapes are in `@vsa/contracts/control`:
- views;
- `DataRevocationRequested`;
- `PublicationEligibility`;
- `ConsentReconciliationRecord`.

## Domain boundaries

| The control plane owns | It never owns |
|---|---|
| Users (product identity), groups, memberships, roles | Canonical matches, rounds, events, kills, positions, view direction |
| Invites (token **hash** only), external identity connections (subject PRIVATE) | Analytics evidence or per-match statistics |
| Consent records + append-only consent transitions | Provider payloads, provider credentials |
| Sync requests and job metadata (state, lease, summary) | Any provider network call |
| Publication eligibility metadata, revocation outbox, reconciliation records | |
| Append-only audit log | |

```
CONTROL PLANE  (groups / identity / consent / job metadata)
   ▲ status + summary           │ pending jobs, revocation events
   │                            ▼   (the local worker polls OUTBOUND)
LOCAL DATA PLANE: worker → provider adapter → canonical PostgreSQL → analytics → public-safe snapshot
```

**Gates** (`npm run check:architecture`), all currently 0 for `apps/control-api`:

| Gate | What it rejects |
|---|---|
| `CONTROL_PLANE_CANONICAL_TELEMETRY_IMPORTS` | Imports of DB drivers, canonical data / contracts, analytics, adapters, collector |
| `CONTROL_PLANE_CANONICAL_MATCH_STORAGE` | Canonical telemetry identifiers |
| `CONTROL_PLANE_PROVIDER_NETWORK_CALLS` | `fetch` / `http(s).request` / WebSocket / provider hosts / adapter imports |
| `CONTROL_PLANE_ANALYTICS_IMPORTS` | Imports of analytics or the exporter |

`HOME_INBOUND_PORT_REQUIRED = NO`.

## Identity

- **`User`** (`usr_…`, random) is the product identity. A Riot PUUID, Henrik id or Discord id is **never** the primary
  identity.
- **`ExternalIdentityConnection`** (`idc_…`):
  - fields: `userId`, `provider` (RIOT / DISCORD), PRIVATE `providerSubject`, `status` (PENDING → VERIFIED →
    DISCONNECTED), `verifiedAt`;
  - the subject never appears in views, audit entries or events;
  - one verified subject maps to one user (`IDENTITY_CONFLICT` otherwise);
  - disconnecting clears the subject.
- **RSO-ready port.** `beginRiotConnection` / `completeRiotConnection` / `disconnectRiotConnection` sit over an
  `IdentityProvider` port:
  - the one-time `state` is hashed at rest and compared in constant time;
  - `RiotRsoIdentityProvider` is NOT_IMPLEMENTED (no network);
  - tests use `MockIdentityProvider`.

  See [RSO_READINESS.md](RSO_READINESS.md).

## Groups, memberships, roles

- **Groups:** `createGroup` / `renameGroup` / `archiveGroup`.
  - Visibility is `PRIVATE` or `INVITE_ONLY` (default `INVITE_ONLY`). There are no public groups.
  - An archived group is read-only for its members. Every mutation fails `GROUP_ARCHIVED`, and open jobs are cancelled.
- **Membership states:** `INVITED → ACTIVE | REMOVED`, `ACTIVE → LEFT | REMOVED`, `LEFT | REMOVED → ACTIVE`.
  - Re-joining needs a new invite.
  - On re-join, consent restarts at DENY.
  - `GROUP_MEMBER_IMPLIES_DATA_CONSENT = NO`.

**Roles:**

| Role | May |
|---|---|
| OWNER (exactly one) | Rename / archive the group; promote / demote ADMIN; remove ADMIN / MEMBER; create / revoke invites |
| ADMIN | Create / revoke invites; remove MEMBER; request / read syncs of members |
| MEMBER | View allowed group content; manage **their own** consent; request their own sync |

**Authorization:**
- Every command takes the authenticated `Principal` (USER / WORKER / SYSTEM) from the transport, never from the body.
- The domain service checks it. There is no UI-only authorization.
- Non-members get `FORBIDDEN` whether or not the group exists (no existence oracle).
- Denials are audited.

## Invites

- **Token:**
  - 256-bit `crypto.randomBytes` token (base64url, 43 characters), returned once;
  - only a domain-separated SHA-256 is stored;
  - lookup is by hash, then a constant-time digest comparison.
- **Lifetime:** the expiry is ≤ 168 h (default 72 h).
- **Acceptance:** one-time. The same user re-accepting gets `alreadyAccepted: true` with no side effect.
- **Rejection:** for anyone else a consumed, expired, revoked, unknown or malformed token gives the identical
  `INVITE_INVALID`. Expiry is recorded, and so is a rejection (in the audit log).
- **Addressed invites** (`forUserId`) create an INVITED membership. Revocation or expiry releases it.
- **Pre-acceptance view** (`InviteView`) = `{ acceptable }` only. No group name, members, owner or expiry.

## Consent model

Four independent grants on each membership (user × group), **all DENY by default**:

| Grant | Set by |
|---|---|
| `IDENTITY_CONNECTED` | Fact of a VERIFIED RIOT connection (not grantable directly) |
| `DATA_COLLECTION_ALLOWED` | Explicit member grant |
| `GROUP_VISIBILITY_ALLOWED` | Explicit member grant |
| `PUBLIC_DERIVED_ANALYTICS_ALLOWED` | Explicit member grant |

**State machine:**

```
UNCONNECTED ─connect─► IDENTITY_CONNECTED ─grant─► COLLECTION_ALLOWED ─grant─► GROUP_VISIBLE ─grant─► PUBLIC_ANALYTICS_ALLOWED
        ▲ revoke / disconnect cascades to every later grant ◄──────────────────────────────────────────────┘
```

- **Ordered at the bottom, independent at the top.** Each grant needs the previous one, but stopping at any level is
  valid (collection without public analytics).
- **Self-only:** only the member grants for their own membership. There is no target parameter, so there is no
  escalation through roles.
- **Recorded:** every change appends a `ConsentTransitionRecord` (actor, time, source / reason, previous, next).
- **Idempotent:** re-granting held grants or revoking revoked grants is a no-op with no event.
- **No inference:** consent is never inferred from match presence, imported data, group membership or a provider account.
  Only explicit grants change consent; `IDENTITY_CONNECTED` follows only a verified connection.

### Legacy reconciliation (`consent-reconciliation-v1`)

A `ConsentReconciliationRecord` classifies **authoritative** consent evidence. It never grants anything:

| State | Meaning |
|---|---|
| `PENDING` | Not yet classified |
| `SUPPORTED` | Consistent, accepted-policy evidence; the member must still grant explicitly |
| `UNSUPPORTED` | Evidence exists but under a non-accepted policy |
| `CONFLICT` | Several evidence items disagree |
| `REQUIRES_RECONSENT` | No authoritative evidence |

**The 9 imported real members** (read-only classification on 2026-10-09, nothing persisted):
- All 9 are `requires-reconciliation` with every grant false.
- No authoritative product-consent evidence exists for them:
  - the legacy consent-mode path was abandoned;
  - the private rebuild collection was an SDD-authorized maintainer collection, not member consent.
- They therefore classify as **9 × REQUIRES_RECONSENT** (`NO_AUTHORITATIVE_CONSENT_EVIDENCE`).
- Their consent rows were not modified. A future explicit grant by each person is the only way forward.

## Publication eligibility (conservative)

A membership enters a public group snapshot only if all of these hold:
- the membership is `ACTIVE`;
- the group is not archived;
- consent is `EXPLICIT`;
- `GROUP_VISIBILITY_ALLOWED` and `PUBLIC_DERIVED_ANALYTICS_ALLOWED` are both granted.

The result is deterministic, with reason codes.

**Retention semantics in this wave:** because the grants are ordered, publication also requires identity and data
collection. Revoking collection therefore also ends publication. There is no "publish retained data after collection
stopped" path; one would need its own policy and task.

## Sync jobs and the outbound polling contract

**`requestSync`:**
- writes job metadata only;
- deduplicates an open job for the same membership;
- without consent, records `BLOCKED_CONSENT` immediately.

**States:**

| From | To |
|---|---|
| PENDING | CLAIMED, CANCELLED, BLOCKED_CONSENT |
| CLAIMED | RUNNING, CLAIMED (reclaim), FAILED, CANCELLED, BLOCKED_CONSENT |
| RUNNING | SUCCEEDED, FAILED, CLAIMED (reclaim), CANCELLED |

SUCCEEDED, FAILED, CANCELLED and BLOCKED_CONSENT are terminal. There is no `PENDING → SUCCEEDED`: success needs a RUNNING
execution under a live lease, and it records an execution summary.

**Worker API (a WORKER principal, outbound only):**

| Call | Behaviour |
|---|---|
| `pollJobs` | Lists ≤ 20 claimable jobs (PENDING, or holding an expired lease), oldest first |
| `claimJob` | Issues a fencing lease token (random, hash at rest), with a lease of ≤ 300 s; a live lease held by anyone is `LEASE_CONFLICT`; an expired lease is reclaimed (attempt + 1) and the old holder is fenced out |
| `startJob` | CLAIMED → RUNNING only if `IDENTITY_CONNECTED` and `DATA_COLLECTION_ALLOWED` still hold for an ACTIVE membership in an active group; otherwise `BLOCKED_CONSENT`, so no provider request can follow |
| `heartbeatJob` | Extends the lease; `proceed: false` when consent ended mid-run |
| `completeJob` / `failJob` | Idempotent for the same lease holder and result; a different result, another worker or an expired lease is rejected |
| `pollRevocations` | The revocation outbox |

## Revocation

**Effect:** `revokeConsent` (or disconnecting the last RIOT identity) immediately ends sync and publication eligibility.
Open jobs become `BLOCKED_CONSENT`.

**Events.** It emits `DataRevocationRequested`:

| Grants ended | Scopes |
|---|---|
| Collection (or identity) | `STOP_FUTURE_SYNC`, `EXCLUDE_FROM_PUBLICATION`, `ERASE_ATTRIBUTABLE_SPATIAL_EVIDENCE` |
| Visibility / public analytics only | `EXCLUDE_FROM_PUBLICATION` |

**Data-plane side.** The control plane never deletes telemetry. The data plane enforces the event in
`applyDataRevocation` (`apps/collector/src/revocation.ts`):
- erasure removes the member's precise spatial evidence (player snapshots, and event / plant / defuse coordinates of their
  events);
- it keeps non-attributable shared match topology;
- it is idempotent;
- it is contract-tested on synthetic data only, never run on the real 838-match dataset in this task.

**Leaving or removal** ends eligibility through membership state; it neither grants nor deletes consent.

## Audit

Append-only (sequence numbers; records are copied in and out). Entries hold ids, an action, an outcome and UPPER_SNAKE
codes only, never tokens, token hashes, provider subjects, lease tokens or free text.

**Covered actions:**
- user registered;
- group created / renamed / archived;
- invite created / revoked / accepted / rejected / expired;
- membership left / removed; role changed;
- identity connection started / connected / disconnected;
- consent granted / revoked;
- sync requested / blocked / claimed / reclaimed / started / completed / cancelled;
- data revocation requested;
- authorization denied.

## Storage portability

**Contract.** `ControlPlaneRepository` is portable: `transact` (atomic, serialized) and `read` over a
`ControlPlaneStore` of metadata records. It assumes no vendor SDK: no Neon, Supabase, D1, Firebase or Vercel storage.

**Reference implementation.** `InMemoryControlPlaneRepository` is deterministic and copy-on-write, with rollback on error.

**Why there is no PostgreSQL implementation yet.** The control-plane gate deliberately forbids DB drivers in
`apps/control-api`. A future PostgreSQL store would:
- be its own package;
- use its own `control_plane` schema (users, groups, memberships, invites, identity_connections, consents,
  consent_transitions, sync_jobs, revocation_outbox, reconciliations, audit_log);
- never share tables with the canonical telemetry (`matches`, `rounds`, `events`, snapshots).

## Transport (local development only)

- `handlers.ts` maps operations (createGroup, createInvite, acceptInvite, listGroups, listMembers, grantConsent,
  revokeConsent, requestSync, getSyncStatus, revokeInvite) to the service and error codes to HTTP status.
- `startLocalControlApi`:
  - binds **127.0.0.1 only** and refuses any other address;
  - serves `POST /rpc/<op>`;
  - requires a JSON content-type and bearer authentication from an injected authenticator (no cookies);
  - caps the body at 64 KiB.
- It is not deployed and not wired into the public Pages demo.

## Future RSO integration

[RSO_READINESS.md](RSO_READINESS.md) covers the RSO flow. [CONTROL_PLANE_THREAT_MODEL.md](CONTROL_PLANE_THREAT_MODEL.md)
covers the threats.
