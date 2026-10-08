# Control plane design (future)

The control plane coordinates **people and permissions**, never telemetry. In the bootstrap it is an interface
(`ControlPlaneService`) plus an in-memory reference implementation (`InMemoryControlPlane`). It has no cloud database, no
authentication provider, no Riot RSO and no deployment.

## Boundary

| May store | Must never store |
|---|---|
| Group metadata, member display names, invites | Raw match telemetry, rounds, events |
| Consent grants and policy versions | Position snapshots or coordinates |
| Sync-job metadata (status, timestamps, a match count) | Analytics evidence or per-match statistics |

`apps/control-api` may import only `@vsa/contracts/control`. The architecture gate fails if it imports canonical data,
analytics, canonical contracts or source adapters.

## Consent model

There are four independent grants, all `false` on join and each granted explicitly:

1. `identityConnected`
2. `dataCollectionAllowed`, which requires 1
3. `groupVisibilityAllowed`, which requires 2
4. `publicDerivedAnalyticsAllowed`, which requires 3

Revoking a grant also revokes every grant that depends on it.

The local pipeline enforces consent independently:
- the ingest service fetches only accounts with collection consent and links only consenting members;
- the exporter publishes only members with visibility and public consent.

## Job model (outbound only — no inbound port to the home machine)

```
cloud control plane ── pending job metadata
        ▲                      │
        │ status + summary     ▼  (collector polls OUTBOUND)
local collector ─► provider fetch ─► local PostgreSQL ─► analytics ─► snapshot publish
```

1. A member, or the schedule, calls `requestSync`. This requires collection consent.
2. The local collector calls `claimPendingJobs`, an outbound poll that is bounded at ≤ 20 per poll.
3. The collector ingests locally, rebuilds analytics and publishes a snapshot.
4. The collector calls `completeJob` with `succeeded` or `failed` and `{ matchesIngested }` only.

A control-plane outage never affects already published static analytics.

## Not in scope yet

- Authentication (RSO), real persistence, invite delivery, rate limiting and abuse controls.
- Each needs its own task and SDD approval.
