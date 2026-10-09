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
| `ROOT_SITE_STRATEGY` | GITHUB_USER_SITE_FREE (supersedes OWNED_CUSTOM_DOMAIN, user decision 2026-10-09) |
| `ROOT_SITE_URL` | https://scottpuppylu.github.io/ (repository `scottpuppylu/scottpuppylu.github.io`) |
| `ROOT_FILE_CAPABILITY` | VERIFIED: https://scottpuppylu.github.io/site-control.txt is served at the root (HTTP 200; explicitly not a Riot token) |
| `ROOT_VERIFIABLE_SITE` | READY |
| `RIOT_TXT_PRESENT` | NO (404 by design; a CI guard rejects an early file) |
| `RIOT_TXT_CONTENT_RECEIVED` | NO |
| `RIOT_TXT_READY_TO_ADD` | YES (procedure in the root repository README) |
| `RIOT_SITE_VERIFICATION_COMPLETED` | NO |
| `RIOT_GITHUB_IO_ACCEPTANCE` / `PLATFORM_DOMAIN_ACCEPTANCE_BY_RIOT` | UNCONFIRMED |
| `OWNED_CUSTOM_DOMAIN` | DEFERRED_FALLBACK |
| `FALLBACK_IF_RIOT_REJECTS_GITHUB_IO` | OWNED_CUSTOM_DOMAIN |
| `PRIVATE_CONTACT_STRATEGY` | USER_APPROVED_EMAIL (supersedes DEDICATED_EMAIL_ALIAS, 2026-10-09; an owned-domain alias is optional future cleanup, not a blocker) |
| `PRIVATE_CONTACT_CHANNEL` | READY (`PRIVATE_CONTACT_EMAIL = casper880115@gmail.com`, publication approved by the operator; `CONTACT_METHOD_PENDING = NO`) |

**Root-site reason.** Riot requires a root-verifiable website (`riot.txt` at the website root). The GitHub Pages project
sub-path cannot serve a root file. The free GitHub user site `https://scottpuppylu.github.io/` can, and that was verified with
`site-control.txt`. Riot does not explicitly state whether a `*.github.io` host is acceptable. That is an external review
risk (`RIOT_GITHUB_IO_ACCEPTANCE = UNCONFIRMED`), with an owned custom domain as the fallback. Riot has not verified or
approved the site.

**Real members.** The 9 imported members stay `REQUIRES_RECONSENT`. That blocks any use or publication of their real data;
it does not block submitting the synthetic Production application. No consent state was changed.

## Website and use case

| Item | Status | Evidence / note |
|---|---|---|
| Working public site | READY | https://scottpuppylu.github.io/valorant-squad-analytics-v2/ (synthetic demo with all user flows); SDD ruling: the synthetic prototype is sufficient to apply. Riot site verification will use the root site https://scottpuppylu.github.io/ (below) |
| Use-case description | READY | Package §2 (SHORT / LONG descriptions, user value); teammate comparison is branded **Diff Check** |
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
| Private contact channel | READY | `casper880115@gmail.com` for privacy, data-access, deletion and consent requests (Privacy Policy §10, Terms §11, mailto link). The public issue tracker stays for general, non-sensitive questions |
| Root-verifiable site | READY | `ROOT_SITE_STRATEGY = GITHUB_USER_SITE_FREE`: https://scottpuppylu.github.io/ serves root files (verified with `/site-control.txt`); `riot.txt` is added only when Riot supplies its exact content. Riot acceptance of `*.github.io` UNCONFIRMED; fallback = owned custom domain (DEFERRED_FALLBACK) |
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
| `READINESS` | READY_TO_APPLY_WITH_PLATFORM_DOMAIN_RISK |
| `APPLICATION_MATERIAL` | READY |
| `SYNTHETIC_PROTOTYPE` | SUFFICIENT |
| `TECHNICAL_PREAPPLICATION_BLOCKERS` | 0 |
| `MANUAL_PREAPPLICATION_BLOCKERS` | 0 |
| `ROOT_VERIFIABLE_SITE` | READY |
| `READY_TO_START_RIOT_APPLICATION` | YES |
| `RIOT_SITE_VERIFICATION_COMPLETED` | NO |
| `RIOT_GITHUB_IO_ACCEPTANCE` | UNCONFIRMED (external review risk) |
| `PRIVATE_CONTACT_CHANNEL` | READY |
| `APPLICATION_SUBMITTED` | NO |
| `REAL_DATA_PUBLICATION` | NO |

There is no remaining pre-application blocker. One external risk remains: Riot has not confirmed that a `*.github.io` root
site is acceptable for verification. If Riot rejects it, the fallback is an owned custom domain. Nothing has been submitted;
Riot has not verified the site or approved the domain.

The production key and the RSO client are then `BLOCKED_ON_RIOT_APPROVAL`.
