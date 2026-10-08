# Riot RSO readiness

V2-CONSENT-CONTROL-PLANE-01 (2026-10-09). Status: **design / interfaces only**.

| Item | State |
|---|---|
| Riot RSO network work | **NOT_IMPLEMENTED** |
| Riot Production / RSO application | Not submitted |
| Riot support ticket | #139243830 open; `RIOT_SUPPORT_RESPONSE_RECEIVED = NO` |
| Riot requests made | 0 |

**Provider policy** ([PROVIDER_MATRIX.md](PROVIDER_MATRIX.md)):
- Riot is `PREPARE` and the long-term primary candidate.
- RSO requires Production-level access.
- Player-facing statistics require player opt-in.

## Future flow

| # | Step | Component | Today |
|---|---|---|---|
| 1 | The user signs into the product (product account, `usr_…`) | Product auth (future) | NOT_IMPLEMENTED; tests use SYSTEM-registered users |
| 2 | Riot RSO connection: `beginRiotConnection` → Riot authorize → `completeRiotConnection` | `IdentityProvider` port | Port + one-time `state` (hashed, constant-time compared) IMPLEMENTED; `RiotRsoIdentityProvider` NOT_IMPLEMENTED; `MockIdentityProvider` for tests |
| 3 | Verified Riot identity: the connection becomes VERIFIED with a PRIVATE subject; `IDENTITY_CONNECTED` becomes true | Control plane | IMPLEMENTED (mock-verified) |
| 4 | Explicit data consent: the member grants `DATA_COLLECTION_ALLOWED` under a policy version | Control plane | IMPLEMENTED (default DENY) |
| 5 | Group membership + visibility consent: invite acceptance, then `GROUP_VISIBILITY_ALLOWED` | Control plane | IMPLEMENTED |
| 6 | Sync request: `requestSync` creates job metadata | Control plane | IMPLEMENTED |
| 7 | Local worker acquisition: outbound poll → claim → consent re-check at RUNNING → provider adapter → canonical PostgreSQL | Local data plane | Contract IMPLEMENTED; no worker loop wired to a provider |
| 8 | Derived analytics publication, only if `PUBLIC_DERIVED_ANALYTICS_ALLOWED` is separately granted | Exporter + eligibility | Eligibility IMPLEMENTED; real publication not authorized |

## RSO-specific requirements still to implement (NOT_IMPLEMENTED)

**OAuth / RSO:**
- authorization-code flow with PKCE;
- exact redirect URIs;
- token exchange on a server;
- access tokens never stored beyond the exchange;
- only the verified account subject is kept, PRIVATE.

**Riot account identity:**
- `account-v1 accounts/me` with the RSO token;
- the subject maps to a connection, never to the product user id.

**Data access.** Production key; VAL-MATCH-V1 matchlist and match detail through a future `RiotAdapter` capability. The
contract-only adapter exists and declares no capability.

**Opt-in:**
- players who have not opted in are never shown;
- no opponent scouting;
- the four-grant consent model already enforces opt-in per group.

**Rate limits.** Honour the production key limits and `Retry-After`, using the existing bounded transport and limiter
patterns.

## What will not change when RSO lands

- Consent stays explicit and default-DENY. An RSO login is identity, not data consent.
- The control plane stays metadata-only. Provider data is fetched by the local worker, never by the control plane.
- Revocation emits `DataRevocationRequested`, which the local data plane enforces.
