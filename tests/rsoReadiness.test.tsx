import { readdir, readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToString } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDemoPipeline } from '@vsa/collector';
import { Shell } from '../apps/web/src/App.tsx';
import { loadSnapshot, type Fetcher, type ReadySnapshot, type SnapshotState } from '../apps/web/src/data/loadSnapshot.ts';
import { canGrant, DEMO_SYNC_MATCHES, demoReducer, groupCanSee, INITIAL_DEMO_STATE, publicationEligible, syncAllowed, type DemoAction, type DemoState } from '../apps/web/src/demoFlow.ts';
import { OPT_IN_DISCLAIMER, PRIVACY_POLICY, PRIVATE_CONTACT_EMAIL, RIOT_LEGAL_BOILERPLATE, TERMS_OF_SERVICE } from '../apps/web/src/legal.ts';
import { DemoFlowView } from '../apps/web/src/pages/DemoFlow.tsx';
import { FEATURE_ALIGNMENT } from '../apps/web/src/pages/Product.tsx';
import { parseRoute, ROUTES, routePath } from '../apps/web/src/router.ts';
import { LEGAL_DOCS } from '../scripts/legal-docs.ts';
import { ACTIVATED_AT, OBSERVED_AT } from './helpers.ts';

let root = '';
let ready: ReadySnapshot;
const fsFetcher = (base: string): Fetcher => async (path) => {
  try { const t = await readFile(join(base, path.replace(/^public-data\//u, '')), 'utf8'); return { ok: true, status: 200, text: async () => t }; }
  catch { return { ok: false, status: 404, text: async () => '' }; }
};
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'vsa-rso-'));
  await runDemoPipeline({ outDir: root, now: () => OBSERVED_AT, activatedAt: ACTIVATED_AT });
  const loaded = await loadSnapshot(fsFetcher(root));
  if (loaded.status !== 'ready') throw new Error('snapshot not ready');
  ready = loaded;
}, 120_000);
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

const text = (markup: string) => markup.replaceAll('<!-- -->', '').replace(/<[^>]+>/gu, ' ').replace(/&#x27;/gu, "'").replace(/&quot;/gu, '"').replace(/&amp;/gu, '&');
const page = (hash: string, state: SnapshotState = ready) => text(renderToString(<Shell route={parseRoute(hash)} state={state} />));
const NEW_ROUTES = ['#/product', '#/demo-flow', '#/privacy', '#/terms'];
const ALL_ROUTES = ['#/', '#/players', '#/compare', '#/synergy', '#/team-builder', '#/about', ...NEW_ROUTES];
const run = (actions: DemoAction[], from: DemoState = INITIAL_DEMO_STATE) => actions.reduce(demoReducer, from);
const JOIN: DemoAction[] = [{ type: 'CREATE_GROUP' }, { type: 'CREATE_INVITE' }, { type: 'ACCEPT_INVITE' }];
const CONNECT: DemoAction[] = [...JOIN, { type: 'ACKNOWLEDGE_DISCLAIMER' }, { type: 'MOCK_CONNECT_RIOT' }];

describe('public review routes (static, deep-link safe)', () => {
  it('parse and reload consistently; render without a snapshot; keep the demo banner and the Riot boilerplate', () => {
    for (const [hash, pageName] of [['#/product', 'product'], ['#/demo-flow', 'demo-flow'], ['#/privacy', 'privacy'], ['#/terms', 'terms']] as const) {
      const route = parseRoute(hash);
      expect(route.page).toBe(pageName);
      expect(parseRoute(`#${routePath(route)}`)).toEqual(route); // reload of the same hash yields the same page
      for (const state of [ready, { status: 'loading' } as SnapshotState]) {
        const t = page(hash, state);
        expect(t).toContain('DEMO / 示範資料');
        expect(t).toContain('目前網站使用合成示範資料，不是實際玩家公開資料。');
        expect(t).toContain(RIOT_LEGAL_BOILERPLATE);
      }
    }
    for (const hash of ALL_ROUTES) expect(page(hash)).toContain("isn't endorsed by Riot Games");
  });

  it('privacy page separates the current synthetic demo from the future approved RSO mode and covers every required topic', () => {
    const t = page('#/privacy');
    for (const s of ['CURRENT SYNTHETIC DEMO', 'FUTURE APPROVED RSO MODE (not live)', 'Data categories', 'Purpose', 'Retention', 'Revocation and deletion', 'Publication eligibility',
      'Third-party services', 'Security', 'Contact', 'Changes to this policy', 'Product account data', 'External identity references', 'Consent metadata', 'Group and invite metadata',
      'Match / game data', 'Derived analytics', 'Provider provenance', 'Audit and security metadata', 'UNTIL_USER_REVOCATION', 'OPERATIONAL_NECESSITY', 'TBD_WITH_POLICY_REVIEW',
      PRIVATE_CONTACT_EMAIL, 'must re-consent']) expect(t).toContain(s);
    expect(t).not.toContain('CONTACT_METHOD_PENDING');
    expect(t).not.toMatch(/we currently collect riot account data/iu);
    expect(t).not.toMatch(/(?<!not )opted in\b.*real members/iu);
  });

  it('terms cover the required topics including no scouting, no cheating assistance, no MMR replacement and non-affiliation', () => {
    const t = page('#/terms');
    for (const s of ['Service purpose', 'Eligibility', 'Acceptable use', 'No opponent scouting', 'No cheating assistance', 'No ranking replacement', 'Your responsibilities',
      'Account linking and consent', 'Group and invite rules', 'Service availability', 'Analytics limitations', 'provider-visible only', 'Termination and revocation', 'Riot Games',
      'not a win probability']) expect(t).toContain(s);
  });

  it('product page explains the use case, synthetic status, approval needs and policy alignment', () => {
    const t = page('#/product');
    for (const s of ['synthetic demo only', 'Requires Riot approval', 'invite-only', 'Player opt-in flow', 'Data flow', 'The control plane is not a match database', 'Privacy model',
      'Implemented but not deployed', 'pre-/post-match planning']) expect(t).toContain(s);
    const status = Object.fromEntries(FEATURE_ALIGNMENT.map((r) => [r.feature, r.status]));
    expect(status).toMatchObject({ 'Opponent scouting': 'NOT OFFERED', 'MMR / Elo alternative': 'NOT OFFERED', 'Real-time tactical guidance': 'NOT OFFERED' });
  });
});

describe('synthetic opt-in walkthrough (in-browser state only)', () => {
  it('defaults to DENY: every permission OFF; joining a group grants nothing', () => {
    expect(INITIAL_DEMO_STATE.grants).toEqual({ DATA_COLLECTION_ALLOWED: false, GROUP_VISIBILITY_ALLOWED: false, PUBLIC_DERIVED_ANALYTICS_ALLOWED: false });
    const joined = run(JOIN);
    expect(joined.memberJoined).toBe(true);
    expect([syncAllowed(joined), groupCanSee(joined), publicationEligible(joined)]).toEqual([false, false, false]);
    expect(canGrant(joined, 'DATA_COLLECTION_ALLOWED')).toBe(false); // needs the verified (mock) connection
  });

  it('identity is a mock-verified FACT after the disclaimer, not a consent toggle; permissions are separate and ordered', () => {
    expect(run([...JOIN, { type: 'MOCK_CONNECT_RIOT' }]).identityConnected).toBe(false); // disclaimer first
    const connected = run(CONNECT);
    expect(connected.identityConnected).toBe(true);
    expect(connected.grants.DATA_COLLECTION_ALLOWED).toBe(false);
    expect(run([{ type: 'GRANT', grant: 'PUBLIC_DERIVED_ANALYTICS_ALLOWED' }], connected).grants.PUBLIC_DERIVED_ANALYTICS_ALLOWED).toBe(false);
    const collecting = run([{ type: 'GRANT', grant: 'DATA_COLLECTION_ALLOWED' }], connected);
    expect([syncAllowed(collecting), groupCanSee(collecting), publicationEligible(collecting)]).toEqual([true, false, false]); // collection without visibility
    const visible = run([{ type: 'GRANT', grant: 'GROUP_VISIBILITY_ALLOWED' }], collecting);
    expect([groupCanSee(visible), publicationEligible(visible)]).toEqual([true, false]);
    expect(publicationEligible(run([{ type: 'GRANT', grant: 'PUBLIC_DERIVED_ANALYTICS_ALLOWED' }], visible))).toBe(true);
  });

  it('sync is blocked without consent and succeeds (synthetic, no provider) with it', () => {
    expect(run([...CONNECT, { type: 'REQUEST_SYNC' }]).sync).toBe('BLOCKED_CONSENT');
    const ok = run([...CONNECT, { type: 'GRANT', grant: 'DATA_COLLECTION_ALLOWED' }, { type: 'REQUEST_SYNC' }]);
    expect(ok).toMatchObject({ sync: 'SUCCEEDED', matchesIngested: DEMO_SYNC_MATCHES });
  });

  it('revocation cascades, stops future sync and publication eligibility and records a revocation request; unlink does the same', () => {
    const full = run([...CONNECT, ...(['DATA_COLLECTION_ALLOWED', 'GROUP_VISIBILITY_ALLOWED', 'PUBLIC_DERIVED_ANALYTICS_ALLOWED'] as const).map((grant) => ({ type: 'GRANT', grant }) as DemoAction),
      { type: 'REQUEST_SYNC' }]);
    const revoked = run([{ type: 'REVOKE', grant: 'DATA_COLLECTION_ALLOWED' }], full);
    expect(revoked.grants).toEqual({ DATA_COLLECTION_ALLOWED: false, GROUP_VISIBILITY_ALLOWED: false, PUBLIC_DERIVED_ANALYTICS_ALLOWED: false });
    expect([revoked.sync, revoked.revocationRequested, syncAllowed(revoked), publicationEligible(revoked)]).toEqual(['NONE', true, false, false]);
    const publicOnly = run([{ type: 'REVOKE', grant: 'PUBLIC_DERIVED_ANALYTICS_ALLOWED' }], full);
    expect([publicOnly.sync, syncAllowed(publicOnly), groupCanSee(publicOnly), publicationEligible(publicOnly)]).toEqual(['SUCCEEDED', true, true, false]);
    const unlinked = run([{ type: 'MOCK_DISCONNECT_RIOT' }], full);
    expect([unlinked.identityConnected, unlinked.grants.DATA_COLLECTION_ALLOWED, unlinked.revocationRequested]).toEqual([false, false, true]);
    expect(run([{ type: 'RESET' }], unlinked).grants).toEqual(INITIAL_DEMO_STATE.grants);
  });

  it('every control is a labelled local button: DEMO / NOT CONNECTED TO RIOT / NO REAL ACCOUNT DATA, no links to Riot, no OAuth parameters', () => {
    const markup = renderToString(<DemoFlowView state={INITIAL_DEMO_STATE} dispatch={() => undefined} />);
    expect(markup).toContain('DEMO · NOT CONNECTED TO RIOT · NO REAL ACCOUNT DATA');
    expect(markup).toContain(OPT_IN_DISCLAIMER.label);
    expect(markup).toContain('模擬連結 Riot 帳號（DEMO，不會連線 Riot）');
    expect(markup).not.toMatch(/<form|action=|riotgames\.com|client_id|redirect_uri|response_type|oauth|authorize\?|code_challenge/iu);
    for (const href of markup.matchAll(/href="([^"]+)"/gu)) expect(href[1]).toMatch(/^#\//u);
    const consent = text(renderToString(<DemoFlowView state={run(CONNECT)} dispatch={() => undefined} />));
    expect(consent.match(/：\s*關閉/gu)?.length).toBe(3);
  });
});

describe('source-level guarantees', () => {
  async function walk(dir: string): Promise<string[]> {
    const out: string[] = [];
    for (const e of await readdir(dir, { withFileTypes: true })) out.push(...(e.isDirectory() ? await walk(join(dir, e.name)) : [join(dir, e.name)]));
    return out;
  }

  it('the web app contains no OAuth / RSO endpoint, client id, token or provider credential', async () => {
    const files = (await walk('apps/web/src')).filter((f) => /\.(ts|tsx|css)$/u.test(f));
    const source = (await Promise.all(files.map((f) => readFile(f, 'utf8')))).join('\n');
    expect(source).not.toMatch(/auth\.riotgames\.com|client_id|client_secret|redirect_uri|access_token|refresh_token|RGAPI-|HDEV-|HENRIK_API_KEY|api\.henrikdev|api\.riotgames\.com/iu);
  });

  it('public wording never claims a rank / MMR / Elo / scouting capability (every mention is negated)', () => {
    const NEGATION = /不是|非|沒有|不提供|禁止|not|no\b|never|prohibited|NOT OFFERED/iu;
    for (const hash of ALL_ROUTES) {
      const t = page(hash);
      for (const m of t.matchAll(/MMR|Elo\b|天梯|hidden rating|scouting|偵查/giu)) {
        const window = t.slice(Math.max(0, m.index! - 80), m.index! + 40);
        expect(NEGATION.test(window), `${hash}: …${window}…`).toBe(true);
      }
      expect(t).not.toContain('目前實力');
    }
  });

  it('docs/PRIVACY_POLICY.md and docs/TERMS_OF_SERVICE.md are generated from the website source (no drift)', async () => {
    for (const d of LEGAL_DOCS) expect(await readFile(d.file, 'utf8')).toBe(d.markdown());
    expect(PRIVACY_POLICY.sections.length).toBeGreaterThanOrEqual(10);
    expect(TERMS_OF_SERVICE.sections.length).toBeGreaterThanOrEqual(10);
  });

  it('the application package states the true control-plane and RSO status and is not submitted', async () => {
    const app = await readFile('docs/RIOT_PRODUCTION_APPLICATION.md', 'utf8');
    for (const s of ['RIOT_APPLICATION_SUBMITTED` | NO', 'RSO_APPLICATION_SUBMITTED` | NO', 'RIOT_CREDENTIALS_USED` | NO', 'CONTROL_PLANE_DEPLOYED = NO', 'LIVE_RSO = NO',
      'CONTROL_PLANE_PERSISTENCE = PROTOTYPE_ONLY', 'OWN_DOMAIN_RECOMMENDED', 'RIOT_SUPPORT_RESPONSE_RECEIVED = NO']) expect(app).toContain(s);
    const rso = await readFile('docs/RSO_READINESS.md', 'utf8');
    expect(rso).toContain('NOT_IMPLEMENTED');
  });
});

describe('Diff Check branding and approved private contact (V2-DIFF-CHECK-CONTACT-01)', () => {
  it('the teammate comparison is labelled Diff Check while the #/compare route stays compatible', () => {
    expect(ROUTES.find((r) => r.path === '/compare')?.label).toBe('Diff Check');
    const route = parseRoute('#/compare?a=m_0000000000000000&b=m_1111111111111111');
    expect(route).toMatchObject({ page: 'compare', a: 'm_0000000000000000', b: 'm_1111111111111111' });
    expect(parseRoute(`#${routePath(route)}`).page).toBe('compare'); // reload keeps the page
    const markup = renderToString(<Shell route={parseRoute('#/compare')} state={ready} />);
    expect(markup).toMatch(/<h1>Diff Check<\/h1>/u);
    expect(text(markup)).toContain('隊內成員數據比較');
    expect(text(markup)).toMatch(/不是牌位、MMR 或 Elo/u);
    for (const hash of ['#/', '#/product', '#/demo-flow']) expect(page(hash)).toContain('Diff Check');
    const product = FEATURE_ALIGNMENT.find((r) => r.feature.startsWith('Diff Check'))!;
    expect(product.notes).toMatch(/Not scouting, not MMR \/ Elo/u);
  });

  it('privacy and terms publish the approved contact email as a mailto link; the placeholder is gone', () => {
    expect(PRIVATE_CONTACT_EMAIL).toBe('casper880115@gmail.com');
    const privacy = renderToString(<Shell route={parseRoute('#/privacy')} state={ready} />);
    expect(privacy).toContain('href="mailto:casper880115@gmail.com"');
    expect(page('#/terms')).toContain('casper880115@gmail.com');
    for (const hash of ['#/privacy', '#/terms', '#/product']) expect(page(hash)).not.toContain('CONTACT_METHOD_PENDING');
  });

  it('the application checklist lists exactly one pre-application blocker: CUSTOM_DOMAIN', async () => {
    const checklist = await readFile('docs/RIOT_APPLICATION_CHECKLIST.md', 'utf8');
    expect(checklist).toContain('| `MANUAL_PREAPPLICATION_BLOCKERS` | 1: `CUSTOM_DOMAIN` |');
    expect(checklist).toContain('| `PRIVATE_CONTACT_CHANNEL` | READY |');
    expect(checklist).toContain('| `TECHNICAL_PREAPPLICATION_BLOCKERS` | 0 |');
    expect(checklist).toContain('| `READINESS` | PARTIAL |');
    expect(checklist).not.toMatch(/PRIVATE_CONTACT_CHANNEL` \| MANUAL_ACTION_REQUIRED/u);
    for (const doc of ['docs/RIOT_APPLICATION_CHECKLIST.md', 'docs/RIOT_PRODUCTION_APPLICATION.md', 'docs/RSO_READINESS.md']) {
      expect(await readFile(doc, 'utf8')).not.toMatch(/CONTACT_METHOD_PENDING = YES/u);
    }
  });
});
