# Provider matrix

V2-PROVIDER-WAVE-01 (2026-10-09). Status: **AWAITING SDD REVIEW**. Evidence was checked on 2026-10-09 against public
documentation only. Nothing was scraped, reverse engineered or called beyond the documented Henrik endpoints.

## Legend

**Capability cells:**
- `IMPLEMENTED` = runtime-declared by the adapter in this repository.
- `DOCUMENTED` = the provider publicly documents it; not implemented here.
- `NO` = documented as absent, or clearly outside the product.
- `UNKNOWN` = not proven either way.

**STATUS:**

| Status | Meaning |
|---|---|
| `IMPLEMENT_NOW` | Implemented in this wave |
| `PREPARE` | Contract-ready; blocked on approval or credentials |
| `RESEARCH_ONLY` | Evaluated; no runtime integration |
| `NOT_AVAILABLE` | No public, authorized access exists for VALORANT |
| `PARTNER_ONLY` | Only through a future business agreement |
| `DO_NOT_USE` | Prohibited acquisition path |

## Matrix

### Capabilities

| Provider | IDENTITY | MATCH_HISTORY | MATCH_DETAIL | RANK | FORWARD_LIVE | STATIC_CONTENT |
|---|---|---|---|---|---|---|
| **Henrik** (unofficial third-party API) | IMPLEMENTED (`v2/account`) | IMPLEMENTED (`v4/by-puuid/matches`, offset page) | IMPLEMENTED (`v4/match`) | IMPLEMENTED (`v3/by-puuid/mmr`) | NO | DOCUMENTED (`content v1`), not used |
| **Riot official** (developer portal) | DOCUMENTED (`account-v1`; RSO `accounts/me`) | DOCUMENTED (`val-match-v1` matchlists) | DOCUMENTED (`val-match-v1` matches) | NO per player (`val-ranked-v1` = act leaderboards only) | NO | DOCUMENTED (`val-content-v1`) |
| **Overwolf** (desktop client app, VALORANT GEP) | live session only (`me.player_name` / `player_id`) | NO (no history documented) | live events of the current match only | UNKNOWN | DOCUMENTED (`match_info`, kill / death / assist, spike planted / defused, `match_start` / `match_end`) | NO |
| **Tracker Network** | NO for VALORANT | NO for VALORANT | NO for VALORANT | NO for VALORANT | NO | NO |
| **Blitz** | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| **Manual / import archive** (`vsa-match-archive-v1`) | NO | IMPLEMENTED (archive pages) | IMPLEMENTED (`henrik-v4-match` payloads) | NO | NO | NO |
| **Future partner API** | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |

### Access model

| Provider | AUTH_MODEL | PUBLIC_DOCUMENTATION | RATE_LIMIT_DOCUMENTED |
|---|---|---|---|
| **Henrik** | One operator key, server-side (`Authorization` header); generated in the Henrik dashboard | YES (docs.henrikdev.xyz, v4.x, OpenAPI) | PARTIAL: per-key, global; `RateLimit-*` / `X-RateLimit-*` / `Retry-After` headers documented; numeric limits per key type not documented |
| **Riot official** | Production API key; RSO (OAuth) for player-authorized identity | YES (developer.riotgames.com) | YES, portal-level (development 20 / 1 s and 100 / 2 min; production granted per app); VALORANT-specific values UNKNOWN |
| **Overwolf** | Overwolf developer account plus approved app; runs inside the user's Overwolf client | YES (dev.overwolf.com) | N/A (local events) |
| **Tracker Network** | `TRN-Api-Key` for supported games only | Developer portal exists; VALORANT not offered | N/A |
| **Blitz** | No public developer API found | NO | NO |
| **Manual / import archive** | Local file inside an operator-configured root | YES (this repository) | N/A (local; size ≤ 64 MiB, ≤ 5 000 records) |
| **Future partner API** | Contractual | UNKNOWN | UNKNOWN |

### History, consent and approval

| Provider | HISTORY_DEPTH_DOCUMENTED | CONSENT_REQUIREMENT | PRODUCTION_APPROVAL_REQUIREMENT |
|---|---|---|---|
| **Henrik** | NO. Provider-visible subset only. Legacy evidence: one member had about 433 matches observed vs 102 Henrik-visible Competitive in 2026; `LIFETIME_COMPLETE = NO` | Provider: UNKNOWN. Project: explicit four-grant opt-in | No Riot approval; Henrik terms and key tier apply |
| **Riot official** | NO (matchlist depth not documented) | YES, documented: every VALORANT app must have player opt-in; no data for players who have not opted in | YES: production key; "Personal Key Applications are currently not supported" for VALORANT; RSO only with a production key |
| **Overwolf** | NO (no historical availability documented) | User installs the app. Project consent is still required. Riot game policy applies | YES: Overwolf app proposal / whitelisting and review; Riot game compliance |
| **Tracker Network** | N/A | N/A | Staff state they cannot grant VALORANT API access under Riot policy |
| **Blitz** | UNKNOWN | UNKNOWN | UNKNOWN |
| **Manual / import archive** | NO (an archive is a subset) | The same consent gates as any acquisition. Imports are private by default and never grant visibility | None (local) |
| **Future partner API** | UNKNOWN | Must meet the project consent model | Business agreement |

### Use and status

| Provider | V2_USE_CASE | STATUS |
|---|---|---|
| **Henrik** | Current acquisition for consented members (bounded, ≤ 6 RPM / ≤ 2 lanes) | **IMPLEMENT_NOW** |
| **Riot official** | Future official source once approved (ticket #139243830 open, `RIOT_SUPPORT_RESPONSE_RECEIVED = NO`) | **PREPARE** (contract-only adapter; 0 requests) |
| **Overwolf** | Possible future FORWARD_LIVE capture of completed, consented matches | **RESEARCH_ONLY** |
| **Tracker Network** | None | **NOT_AVAILABLE** (scraping = **DO_NOT_USE**) |
| **Blitz** | None | **NOT_AVAILABLE** (no public API found; partner availability UNKNOWN; scraping or private endpoints = **DO_NOT_USE**) |
| **Manual / import archive** | Owner-provided archives; offline fallback inside the Henrik namespace | **IMPLEMENT_NOW** |
| **Future partner API** | Data agreement, if one ever exists | **PARTNER_ONLY** |

### STATIC_CONTENT sources (separate from match provenance)

| Source | Use | STATUS |
|---|---|---|
| Riot official agent / role information | `agent-catalog-v1` (in repository, versioned) | In use (static catalog, not an adapter) |
| Riot `val-content-v1` | Future catalog refresh (needs a production key) | PREPARE (not implemented) |
| Henrik `content v1` | Not needed: catalogs come from Riot official sources | RESEARCH_ONLY |
| valorant-api.com | Unofficial, game-file extraction, All Rights Reserved (TASK-DATA-MAP-ZONE-METADATA-01) | DO_NOT_USE |

## Evidence

**Henrik.** [docs.henrikdev.xyz](https://docs.henrikdev.xyz) (API reference v4.x, updated 2025-12-18):
- Endpoints, key headers and rate-limit headers.
- SendError shape (`errors[{code, message, status}]`).
- Live canary (this wave): IDENTITY, MATCH_HISTORY, MATCH_DETAIL and RANK each returned 2xx.

**Riot.**
- [VALORANT docs](https://developer.riotgames.com/docs/valorant): opt-in requirement; personal-key applications not supported; RSO
  requires a production key.
- [API list](https://developer.riotgames.com/apis): VAL-MATCH-V1, VAL-RANKED-V1 (leaderboards), VAL-CONTENT-V1, VAL-STATUS-V1, ACCOUNT-V1.
- [VALORANT API launch and policies](https://www.riotgames.com/en/DevRel/valorant-api-launch): personal and development keys have no
  VALORANT access; production keys are granted selectively.

**Overwolf.**
- [VALORANT game events](https://dev.overwolf.com/ow-native/live-game-data-gep/supported-games/valorant): live info and events;
  `pseudo_match_id` is Overwolf-generated and unrelated to Riot; `match_end` does not fire in custom or training modes.
- [App proposal](https://dev.overwolf.com/ow-native/getting-started/submitting-an-app-proposal): API access needs an approved idea.

**Tracker Network.**
- [TRN.Developers](https://github.com/TrackerNetwork/TRN.Developers): keys exist for supported games.
- Staff replies on [feedback.tracker.gg](https://feedback.tracker.gg/t/api-key-approval-request-painel-valorant-bot/59174) and in
  [an earlier thread](https://feedback.tracker.gg/t/valoprant-api-for-devs/22820): they cannot provide VALORANT API access under
  Riot's policies.
- tracker.gg/developers returned HTTP 403 to an automated read, so it was not used as evidence.

**Blitz.** No public developer API documentation was found by search. That is absence of evidence, so partner availability
stays UNKNOWN.
