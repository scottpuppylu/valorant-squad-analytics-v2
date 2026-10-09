# Riot application checklist (NOT SUBMITTED)

V2-RSO-PRODUCTION-READINESS-01 (2026-10-09). Statuses: READY · PARTIAL · BLOCKED · MANUAL_ACTION_REQUIRED.

Nothing has been submitted. No Riot product, production key or RSO client has been requested, and no ticket or message
was sent. The package is [RIOT_PRODUCTION_APPLICATION.md](RIOT_PRODUCTION_APPLICATION.md).

## SDD rulings (binding, accepted 2026-10-09; V2-RSO-READINESS-RULING-SYNC-01)

| Ruling | Value |
|---|---|
| `SYNTHETIC_PROTOTYPE_SUFFICIENT_TO_APPLY` | YES |
| `DURABLE_CONTROL_DB_REQUIRED_BEFORE_APPLICATION` | NO |
| `REAL_PRODUCT_SIGN_IN_REQUIRED_BEFORE_APPLICATION` | NO |
| `LIVE_RSO_REQUIRED_BEFORE_APPLICATION` | NO |
| `REAL_MEMBER_RECONSENT_REQUIRED_BEFORE_APPLICATION` | NO |
| `REAL_MEMBER_RECONSENT_REQUIRED_BEFORE_REAL_DATA_USE_OR_PUBLICATION` | YES |
| `APPLICATION_SUBMITTED` | NO |
| `DOMAIN_STRATEGY` | OWNED_CUSTOM_DOMAIN |
| `GITHUB_USER_SITE_WORKAROUND` | NOT_SELECTED |
| `CUSTOM_DOMAIN` | MANUAL_ACTION_REQUIRED (the domain name is not chosen yet) |
| `PRIVATE_CONTACT_STRATEGY` | DEDICATED_EMAIL_ALIAS (preferred shape `privacy@<owned-domain>`; optional `support@<owned-domain>`) |
| `PRIVATE_CONTACT_CHANNEL` | MANUAL_ACTION_REQUIRED (`CONTACT_METHOD_PENDING = YES`; no address is invented or published) |

**Domain reason.** Riot requires a root-verifiable website (`riot.txt` at the website root). The GitHub Pages project sub-path
cannot serve a root file. A `*.github.io` root-host workaround is not selected because Riot does not explicitly establish it
as an acceptable production verification domain.

**Real members.** The 9 imported members stay `REQUIRES_RECONSENT`. That blocks any use or publication of their real data;
it does not block submitting the synthetic Production application. No consent state was changed.

## Website and use case

| Item | Status | Evidence / note |
|---|---|---|
| Working public site | READY | https://scottpuppylu.github.io/valorant-squad-analytics-v2/ (synthetic demo with all user flows); SDD ruling: the synthetic prototype is sufficient to apply. Riot site verification still needs the owned domain (below) |
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
| Private contact channel | MANUAL_ACTION_REQUIRED | `PRIVATE_CONTACT_STRATEGY = DEDICATED_EMAIL_ALIAS` (`privacy@<owned-domain>`, optional `support@<owned-domain>`); until supplied, `CONTACT_METHOD_PENDING = YES`. The public issue tracker stays for general, non-sensitive questions |
| Custom domain | MANUAL_ACTION_REQUIRED | `DOMAIN_STRATEGY = OWNED_CUSTOM_DOMAIN` (`GITHUB_USER_SITE_WORKAROUND = NOT_SELECTED`). Riot verifies the domain via `riot.txt` at the website root; this project sub-path cannot serve `/riot.txt`. Domain not chosen, purchased or configured |
| Production application answers | READY (draft) | Package §2, all required fields |

## Screenshots and known gaps

| Item | Status | Evidence / note |
|---|---|---|
| Screenshots | READY | [assets/riot-application/](assets/riot-application/), 10 synthetic images (see below), no EXIF / XMP |
| Known gaps | READY (documented) | Package §7. Production / runtime gaps (durable control DB, backend, product sign-in, token storage, OAuth callback, live RSO, deletion worker, monitoring, real-member re-consent) are NOT pre-application blockers |

## Blocked on Riot

| Item | Status | Evidence / note |
|---|---|---|
| Production key | BLOCKED_ON_RIOT_APPROVAL | Decided by Riot after the application is submitted |
| RSO client | BLOCKED_ON_RIOT_APPROVAL | Only for an approved production application |

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

| Item | Value |
|---|---|
| `READINESS` | PARTIAL |
| `APPLICATION_MATERIAL` | READY |
| `SYNTHETIC_PROTOTYPE` | SUFFICIENT |
| `TECHNICAL_PREAPPLICATION_BLOCKERS` | 0 |
| `MANUAL_PREAPPLICATION_BLOCKERS` | 2: `CUSTOM_DOMAIN`, `PRIVATE_CONTACT_CHANNEL` |
| `APPLICATION_SUBMITTED` | NO |
| `REAL_DATA_PUBLICATION` | NO |

The only pre-application blockers are the two manual items:
1. a root-verifiable owned custom domain (`riot.txt`);
2. a private contact channel (dedicated email alias).

The production key and the RSO client are then `BLOCKED_ON_RIOT_APPROVAL`.
