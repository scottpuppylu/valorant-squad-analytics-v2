# Squad Analytics V2

A provider-neutral, local-first analytics product for private, invite-only comparison groups.

Match evidence lives in a **local PostgreSQL 18** canonical store. The website is a **static client** that reads
immutable, versioned, privacy-validated snapshots. The web runtime needs no database, provider API, cloud database or
inbound port to your machine.

```
External sources ─► source adapters ─► local collector ─► local PostgreSQL 18 (canonical evidence)
                                                                   │
                       static web app ◄─ distribution ◄─ immutable snapshot ◄─ public-safe exporter ◄─ analytics
```

The future control plane (auth / groups / invites / consent / sync jobs) is logically separate and never stores match
telemetry. See [docs/ARCHITECTURE_V2.md](docs/ARCHITECTURE_V2.md).

## Data boundary

- Real private data — member, match, position and consent data — is **never committed** to this repository.
- All repository and demo data is **synthetic** (an offline fake provider with fictional players).
- Local PostgreSQL is the canonical analytics data store; V2 does **not** require Neon or any other cloud database.
- Source providers are replaceable adapters; analytics consume only provider-neutral canonical evidence.
- Public web output consumes only sanitized, versioned static snapshots.

## Quick start (Node.js 24+, npm)

```bash
npm install
```

```bash
npm run snapshot:demo
```

```bash
npm run web:dev
```

`snapshot:demo` runs the whole vertical slice offline:

1. The fake provider generates synthetic matches.
2. They are normalized into canonical evidence.
3. The canonical evidence is stored in PostgreSQL. Without `DATABASE_URL` this is an embedded PGlite instance; with it,
   your local PostgreSQL 18.
4. Analytics run over the canonical evidence.
5. The exporter builds the public snapshot.
6. The snapshot is published atomically to `apps/web/public/public-data/`.

The web app then renders the product pages (Dashboard, Players, Player Profile, Compare, Shared-Match, Team Builder,
About) from that static snapshot. Formulas: [docs/SCORING.md](docs/SCORING.md).

Optional local PostgreSQL 18 (localhost only): copy `infra/local/.env.example` to `infra/local/.env`, then run
`npm run db:up` and `npm run db:migrate` with `DATABASE_URL` set (see `.env.example`).

## Commands

| Command | Purpose |
|---|---|
| `npm test` | Vitest: unit, integration (embedded PostgreSQL), privacy, publication, web loading |
| `npm run lint` / `npm run typecheck` | ESLint / strict TypeScript (all workspaces) |
| `npm run build` | Typecheck, then build every workspace (static web via Vite) |
| `npm run check:architecture` | Dependency-boundary gate (web ↛ DB / provider; analytics ↛ provider / SQL; control plane ↛ telemetry …) |
| `npm run check:privacy` | Regenerates the demo snapshot, builds the web app, then scans public data and the bundle for private data |
| `npm run snapshot:demo` / `npm run web:dev` | Offline demo snapshot / Vite dev server |
| `VSA_PG18_URL=… npm test` | Also runs the opt-in real PostgreSQL 18 integration test (use a disposable database) |
| `npm run report:private -- --group <id>` | PRIVATE operator report over a local `DATABASE_URL` (read-only), written only under the git-ignored `.private/`; never a snapshot ([docs/V2_PRODUCT_UI.md](docs/V2_PRODUCT_UI.md)) |
| `npm run import:legacy -- [--dry-run] [--resume]` | Read-only import of the accepted legacy private staging into a local `valorant_analytics_v2*` database ([docs/V2_DATA_IMPORT.md](docs/V2_DATA_IMPORT.md)) |

Node 24 runs the TypeScript sources directly (type stripping, `erasableSyntaxOnly`). A workspace's `build` is a strict
compile; only the web app emits a bundle.

## Repository layout

```
apps/web            static React client (manifest + snapshot JSON only)
apps/collector      local pipeline / CLI: ingest → analytics → export → publish
apps/control-api    control-plane skeleton (metadata only; in-memory reference)
packages/contracts  versioned Zod contracts (control, canonical, analysis, team-composition, public)
packages/source-adapters  DataProviderAdapter, ProviderRouter, FakeProviderAdapter, future-provider skeletons
packages/canonical-data   SQL boundary (pg / PGlite), migrations, canonical repository — the only SQL
packages/analytics  accepted algorithms over canonical contracts only
packages/exporter   allowlisted public documents + content-derived snapshot id
packages/distribution     SnapshotPublisher, LocalFilesystemPublisher (atomic), future publisher placeholders
packages/privacy    public allowlist, private-key guard, secret patterns, validation (browser-safe)
infra/local         optional PostgreSQL 18 (localhost) · docs/ · scripts/ (gates) · tests/
```

## Privacy principle

Public output is **allowlist-only**. Unknown fields are rejected, not dropped. Raw match ids, provider account ids,
participant ids, coordinates, view direction, tokens, keys and database URLs cannot be represented in a public contract.
Snapshots are validated on write (exporter and publisher) and again on read (web loader). History is
**provider-visible, never a complete career** (`lifetimeComplete: false`).

This is not an official rank, MMR or Elo, and there is no opponent scouting.

## Legacy

`valorant-squad-analytics` is **frozen**: release candidate `release/pre-public-clean-01@1a4c790`. It is used only for
reading, audit, porting, data reconciliation and emergency rollback. See [docs/LEGACY_PORT_AUDIT.md](docs/LEGACY_PORT_AUDIT.md).
