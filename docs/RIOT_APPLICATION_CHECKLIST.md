# Riot application checklist (NOT SUBMITTED)

V2-RSO-PRODUCTION-READINESS-01 (2026-10-09). Statuses: READY · PARTIAL · BLOCKED · MANUAL_ACTION_REQUIRED.

Nothing has been submitted. No Riot product, production key or RSO client has been requested, and no ticket or message
was sent. The package is [RIOT_PRODUCTION_APPLICATION.md](RIOT_PRODUCTION_APPLICATION.md).

## Website and use case

| Item | Status | Evidence / note |
|---|---|---|
| Working public site | PARTIAL | https://scottpuppylu.github.io/valorant-squad-analytics-v2/ (synthetic demo with all user flows). Riot reserves production keys for fully functioning applications, so a synthetic-only prototype may not be enough |
| Use-case description | READY | Package §2 (SHORT / LONG descriptions, user value) |
| Privacy Policy | READY (draft) | `#/privacy`; [PRIVACY_POLICY.md](PRIVACY_POLICY.md), generated from the page source |
| Terms of Service | READY (draft) | `#/terms`; [TERMS_OF_SERVICE.md](TERMS_OF_SERVICE.md), generated |
| Opt-in disclaimer | READY (DRAFT FOR RIOT REVIEW) | Shown before the mock account-linking step; package §5 |
| Synthetic user flow | READY | `#/demo-flow`: group → invite → join → mock connect → 3 permissions (default OFF) → sync → revoke |
| Product review page | READY | `#/product` |

## Architecture, privacy and policy alignment

| Item | Status | Evidence / note |
|---|---|---|
| RSO architecture plan | READY (design) | [RSO_READINESS.md](RSO_READINESS.md); live RSO NOT_IMPLEMENTED |
| Security summary | READY | Package §6; [CONTROL_PLANE_THREAT_MODEL.md](CONTROL_PLANE_THREAT_MODEL.md) |
| Data-flow diagram | READY | Package §4; `#/product` |
| Non-scouting statement | READY | Terms §3; product page; alignment table (NOT OFFERED) |
| Non-MMR statement | READY | Terms §3; every score explanation; Dashboard relabelled ("近期表現排序", not a rank / MMR / Elo) |
| Riot legal boilerplate | READY | Site footer on every page (General Policies wording) |

## Contact, domain and application answers

| Item | Status | Evidence / note |
|---|---|---|
| Contact | MANUAL_ACTION_REQUIRED | Public issue tracker for general questions; private data-request channel = CONTACT_METHOD_PENDING (no private email published without approval) |
| Domain status | MANUAL_ACTION_REQUIRED | `DOMAIN_REQUIREMENT = OWN_DOMAIN_RECOMMENDED`: Riot verifies the domain via `riot.txt` at the website root; this project sub-path cannot serve `/riot.txt`. Owned or root-served domain: not purchased or configured |
| Production application answers | READY (draft) | Package §2, all required fields |

## Screenshots and known gaps

| Item | Status | Evidence / note |
|---|---|---|
| Screenshots | READY | [assets/riot-application/](assets/riot-application/), 10 synthetic images (see below), no EXIF / XMP |
| Known gaps | READY (documented) | Package §7; still open: production key, RSO client, durable control DB, backend, auth / token storage, OAuth callback, deletion worker, monitoring |

## Blocked on Riot

| Item | Status | Evidence / note |
|---|---|---|
| Production key | BLOCKED | Requires application approval |
| RSO client | BLOCKED | Requires an approved production application |

## Screenshot index (synthetic data only)

| File | Shows |
|---|---|
| `01-dashboard.jpg` | Dashboard with demo banner and "recent performance" ordering (not a rank) |
| `02-player-profile.jpg` | Player profile (fictional member) |
| `03-compare.jpg` | Two-member comparison |
| `04-team-builder.jpg` | Team Builder result: Team Fit = historical fit, not a win probability; abstentions |
| `05-group-invite-flow.jpg` | Demo flow: create group, invite, join (no data access) |
| `06-consent-screen.jpg` | Draft opt-in disclaimer, mock Riot connection, three permissions all OFF |
| `07-revocation.jpg` | Revocation effects and flow log |
| `08-privacy.jpg` | Privacy Policy: current synthetic vs future approved mode |
| `09-terms.jpg` | Terms of Service: no scouting, no cheating assistance, no MMR replacement |
| `10-product.jpg` | Product overview for reviewers |

## Readiness decision

`PARTIAL`. The material is prepared. Applying still needs these manual items:
1. a root-verifiable website or domain (`riot.txt`);
2. a private contact channel for data requests;
3. a decision on whether a synthetic prototype is enough, or whether durable control-plane persistence plus product sign-in must exist first;
4. re-consent of any real members before real data.

The production key and the RSO client are then decided by Riot.
