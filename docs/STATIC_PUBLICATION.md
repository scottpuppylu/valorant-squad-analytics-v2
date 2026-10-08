# Static publication: synthetic demo on GitHub Pages

V2-STATIC-PUBLICATION-01 (2026-10-09). Status: **AWAITING SDD REVIEW**.

## What is published

| Item | Value |
|---|---|
| URL | https://scottpuppylu.github.io/valorant-squad-analytics-v2/ |
| Data mode | **SYNTHETIC_DEMO** only: `FakeProviderAdapter` + the synthetic fixture (fictional members and matches) |
| Real data | **None.** REAL_PUBLIC_DATA_PUBLISHED = NO; the local PostgreSQL group, the 838-match private dataset, private operator reports, legacy data and Henrik results are never inputs |
| Runtime | Static files only: `index.html`, the bundle, `public-data/manifest.json` and one immutable snapshot. No DATABASE_URL, PostgreSQL, provider (Henrik / Riot / Overwolf) or server API |
| Routing | Hash routes (`#/players`, `#/player/<id>`, …) and a relative Vite `base: './'`, so the site works under the `/valorant-squad-analytics-v2/` sub-path with no server rewrites. Direct load and reload hit `index.html` |
| Demo notice | A prominent `DEMO / 示範資料` banner on every page (Dashboard included), not a footer-only disclaimer |

## Pipeline (`.github/workflows/pages.yml`)

Trigger: push to `main`, or `workflow_dispatch`.

Permissions:
- `contents: read`;
- the deploy job only: `pages: write`, `id-token: write`.

It uses **zero secrets**: no provider key, no DATABASE_URL, no private environment variable.

**Steps:**
1. `actions/checkout` (no persisted credentials) and `actions/setup-node` 24, then `npm ci`.
2. `npm run check:architecture`: web ↛ DB / provider (WEB_PROVIDER_IMPORTS = 0), and the other boundaries.
3. `npm run build`: typecheck plus every workspace build.
4. `npm run check:privacy`:
   - regenerates the synthetic snapshot (`snapshot:demo`), so nothing is hand-committed;
   - rebuilds the web app with that snapshot;
   - scans the public data (schemas, allowlist, private keys, secret patterns, hashes);
   - scans the exact `apps/web/dist` that is uploaded.
5. `actions/upload-pages-artifact` (`apps/web/dist`) → `actions/deploy-pages`.

**What the dist scan rejects:**
- secret patterns and DB strings;
- internal ids, fixture private markers and raw fixture coordinates;
- PUUID-shaped 78-character tokens;
- `.private/`, `provider.env`, provider key names and provider API hosts.

**Not run in CI:** the real-data checks (staging comparisons, PostgreSQL 18 regressions). They need private local data and
stay local.

## Rollback

The pushed `main` commit is the rollback point. Reverting it, or disabling Pages (Settings → Pages), removes the demo.
Nothing else depends on it.
