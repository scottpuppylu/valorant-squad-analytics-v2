# Control-plane threat model (`control-plane-v1`)

Concise and scoped to the local reference implementation. It is re-evaluated before any deployment.

| Threat | Mitigation in this wave | Residual / future |
|---|---|---|
| **Stolen invite token** | 256-bit random token, expiry ≤ 168 h, one-time acceptance, revocation; an addressed invite (`forUserId`) only works for its addressee | Delivery channel security; rate limiting on accept |
| **Token replay** | A consumed token is `INVITE_INVALID` for anyone else (same-user retry is idempotent, no side effect); expired / revoked / unknown are indistinguishable | — |
| **Token at rest / in logs** | Only a domain-separated SHA-256 is stored; lookup + constant-time digest compare; tokens never appear in audit, views or errors | Transport logs of a future server must drop request bodies |
| **Unauthorized group access** | Principal comes from the transport; every command is checked in the domain service; non-members get `FORBIDDEN` with no existence oracle; removed / left members lose access; archived groups are read-only | Real authentication (product sign-in) is future |
| **Consent escalation** | Consent commands are self-only (no target parameter); IDENTITY_CONNECTED only from a verified connection; ordered grants; no inference from membership, matches, imports or provider accounts; re-join resets consent to DENY | — |
| **Job spoofing** | Job commands need a WORKER principal (users get `UNAUTHENTICATED`); RUNNING requires a live lease and a fresh consent check | Worker credentials and registration for a deployment |
| **Lease theft** | Random fencing lease token per claim (hash at rest); heartbeat / start / complete need owner + token + live lease; a reclaim fences the old holder | — |
| **Provider subject disclosure** | Subject is PRIVATE: never in views, audit, events or errors; cleared on disconnect; privacy guard rejects `providerSubject` / `tokenHash` / `leaseToken` keys | Encryption at rest in a future store |
| **CSRF / browser auth (future)** | Local server: bearer-only (no cookies), JSON content-type required, loopback bind | A deployed browser flow needs SameSite cookies + CSRF tokens or bearer-only, plus CORS allowlist |
| **Rate abuse** | Bounded inputs (TTL, lease, poll ≤ 20, 64 KiB body), job deduplication per membership | Per-principal rate limits before any deployment |
| **Home-machine exposure** | Worker polls OUTBOUND; no callbacks; local API binds 127.0.0.1 only (`HOME_INBOUND_PORT_REQUIRED = NO`) | — |
| **Telemetry leakage into the control plane** | Architecture gates: no canonical telemetry identifiers, no DB / analytics / adapter imports, no network calls in `apps/control-api` | — |
| **Over-deletion on revocation** | The control plane never deletes; the data plane erases only player-attributable precise spatial evidence and keeps shared topology (idempotent, contract-tested on synthetic data) | Full erasure policy for other evidence is a separate decision |
