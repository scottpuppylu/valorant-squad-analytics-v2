import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderToString } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDemoPipeline } from '@vsa/collector';
import { Page, Shell } from '../apps/web/src/App.tsx';
import { loadSnapshot, type Fetcher, type ReadySnapshot } from '../apps/web/src/data/loadSnapshot.ts';
import { TeamBuilder, TeamBuilderResult } from '../apps/web/src/pages/TeamBuilder.tsx';
import { parseRoute } from '../apps/web/src/router.ts';
import { canCalculate, compareViewModel, dashboardViewModel, findTeamResult, selectCompare, toggleMember } from '../apps/web/src/viewModels.ts';
import { ACTIVATED_AT, OBSERVED_AT } from './helpers.ts';

let root = '';
let state: ReadySnapshot;
const fsFetcher = (base: string): Fetcher => async (path) => {
  try { const text = await readFile(join(base, path.replace(/^public-data\//u, '')), 'utf8'); return { ok: true, status: 200, text: async () => text }; }
  catch { return { ok: false, status: 404, text: async () => '' }; }
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'vsa-web-'));
  await runDemoPipeline({ outDir: root, now: () => OBSERVED_AT, activatedAt: ACTIVATED_AT });
  const loaded = await loadSnapshot(fsFetcher(root));
  if (loaded.status !== 'ready') throw new Error(`snapshot not ready: ${loaded.status}`);
  state = loaded;
}, 120_000);
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

/** SSR text with React's text-node separators removed. */
const text = (markup: string) => markup.replaceAll('<!-- -->', '');
const html = (hash: string) => text(renderToString(<Shell route={parseRoute(hash)} state={state} />));
const idOf = (name: string) => state.group.members.find((m) => m.displayName === name)!.publicMemberId;
const FORBIDDEN_HISTORY = ['完整生涯', '生涯總場次', 'Lifetime complete', 'lifetime complete'];

describe('product pages render from the static snapshot only', () => {
  it('every route renders, uses honest history wording and never claims lifetime completeness', () => {
    for (const hash of ['#/', '#/players', `#/players/${idOf('Nova')}`, `#/compare?a=${idOf('Nova')}&b=${idOf('Rook')}`, '#/synergy', '#/team-builder', '#/about']) {
      const page = html(hash);
      expect(page).toContain('目前可追蹤紀錄');
      for (const phrase of FORBIDDEN_HISTORY) expect(page).not.toContain(phrase);
      for (const m of page.matchAll(/(.{0,8})MMR/gu)) expect(m[1]).toMatch(/不是|非/u); // MMR is only ever mentioned as "not MMR"
      for (const hidden of ['Pike', 'fake-puuid', 'member-', 'account-']) expect(page).not.toContain(hidden);
    }
  });

  it('Dashboard: group title, coverage period, ranking by Current Strength, insufficient members listed separately, quick entries', () => {
    const page = html('#/');
    for (const text of [state.group.group.name, '資料期間', '目前實力排名', '比較兩位成員', '組隊建議', '樣本不足（不排名）', 'Kite']) expect(page).toContain(text);
    const vm = dashboardViewModel(state);
    expect(vm.ranked.map((r) => r.rank)).toEqual(vm.ranked.map((_, i) => i + 1));
    expect(vm.insufficient.map((r) => r.profile.displayName)).toContain('Kite');
    const values = vm.ranked.filter((r) => r.profile.currentStrength.status === 'available').map((r) => r.profile.currentStrength.value!);
    expect([...values].sort((a, b) => b - a)).toEqual(values);
  });

  it('Player Profile: overview, basic, advanced, dimensions, context, shared-match and evidence; unknown rank is shown as unknown', () => {
    const nova = html(`#/players/${idOf('Nova')}`);
    for (const text of ['目前實力（近期區間）', '社群分數（全部競技紀錄）', '基本數據（競技）', 'K/D', 'ADR', 'ACS', 'KAST', '首殺 / 首死', '補槍擊殺 / 被補槍', '殘局 勝 / 次', '回合影響',
      '八個面向', '牌位（對戰當時）', '特務', '地圖', '同場比較（Shared-Match）', '證據與限制']) expect(nova).toContain(text);
    expect(html(`#/players/${idOf('Juno')}`)).toContain('沒有牌位證據（不推測）');
    expect(html('#/players/m_0000000000000000')).toContain('找不到這位成員');
  });

  it('Compare: two distinct members; all-history and direct shared-match comparisons are separate and neither is "truer"', () => {
    expect(html('#/compare')).toContain('請選擇兩位不同的成員');
    const page = html(`#/compare?a=${idOf('Nova')}&b=${idOf('Rook')}`);
    for (const text of ['各自的全部競技紀錄', '兩人同場對戰（Shared-Match）', '沒有哪一個比較「真」']) expect(page).toContain(text);
    expect(compareViewModel(state, idOf('Nova'), idOf('Nova'))).toBeNull();
    const vm = compareViewModel(state, idOf('Rook'), idOf('Nova'))!;
    const forward = compareViewModel(state, idOf('Nova'), idOf('Rook'))!;
    expect(vm.pair!.aAhead).toBe(forward.pair!.bAhead); // orientation follows the selection, not the internal order
    expect(selectCompare({ a: 'x', b: 'y' }, 'a', 'y')).toEqual({ a: 'y', b: 'x' }); // picking the other slot's member swaps
  });

  it('Synergy page: Shared-Match comparison only (no invented synergy formula), with sample size and eligibility', () => {
    const page = html('#/synergy');
    for (const text of ['同場比較（Shared-Match）', '不是默契指數', '成員同場評分', '兩兩組合', '共同對戰']) expect(page).toContain(text);
    expect(page).toContain('沒有共同對戰'); // a pair with no shared matches is labelled, not hidden
  });

  it('Team Builder: exactly five members, map selection, lookup of the precomputed result', () => {
    const ids = state.group.members.map((m) => m.publicMemberId);
    let sel = { members: [] as string[], map: 'Ascent' as string | null };
    for (const id of ids) sel = toggleMember(sel, id);
    expect(sel.members).toHaveLength(5); // the sixth pick is ignored, never swapped in silently
    expect(canCalculate(sel, state.teamBuilder.maps)).toBe(true);
    expect(canCalculate({ ...sel, members: sel.members.slice(0, 4) }, state.teamBuilder.maps)).toBe(false);
    expect(canCalculate({ ...sel, map: 'NotAMap' }, state.teamBuilder.maps)).toBe(false);
    expect(findTeamResult(state.teamBuilder, { ...sel, members: [...sel.members].reverse() })).toEqual(findTeamResult(state.teamBuilder, sel));
    const form = text(renderToString(<TeamBuilder state={state} />));
    expect(form).toContain('選擇 5 位成員（已選 0/5）');
    expect(form).toMatch(/<button[^>]*disabled[^>]*>計算建議<\/button>/u);
    expect(form).toContain('id="tb-map"');
  });

  it('Team Builder result: agent, role, validated attack / defense responsibilities, abstention, Team Fit wording, alternatives', () => {
    const names = new Map(state.group.members.map((m) => [m.publicMemberId, m.displayName]));
    const results = state.teamBuilder.results.filter((r) => r.status === 'ok');
    const page = text(results.map((result) => renderToString(<TeamBuilderResult result={result} doc={state.teamBuilder} names={names} />)).join(''));
    for (const text of ['建議陣容（歷史契合度）', 'Team Fit', '不是勝率', '不證明這是最佳陣容', '進攻', '防守', '其他接近的陣容']) expect(page).toContain(text);
    expect(page).toMatch(/<span class="duty-side">進攻<\/span><strong>(主要突破|跟進補槍|下包支援|下包後守包)<\/strong>/u);
    expect(page).toMatch(/<span class="duty-side">防守<\/span><strong>(第一接觸|資訊支援)<\/strong>/u);
    expect(page).toMatch(/證據不足|無明顯分工/u); // abstention is a visible, valid result
    for (const withheld of ['SITE_HOLD', 'FLEX', 'CLUTCH', 'UTILITY_SUPPORT', 'SPACE_CONTROL', 'INFO_SETUP', 'ROTATION']) expect(page).not.toContain(withheld);
    const sel = { members: results[0]!.memberIds, map: results[0]!.map };
    expect(renderToString(<TeamBuilder state={state} initial={{ selection: sel, submitted: true }} />)).toContain('data-state="result"');
  });

  it('every page, Dashboard included, carries the prominent synthetic-demo notice (not a footer-only disclaimer)', () => {
    for (const hash of ['#/', '#/players', '#/compare', '#/synergy', '#/team-builder', '#/about']) {
      const page = html(hash);
      expect(page).toContain('DEMO / 示範資料');
      expect(page).toContain('目前網站使用合成示範資料，不是實際玩家公開資料。');
    }
    const markup = renderToString(<Shell route={parseRoute('#/')} state={state} />);
    expect(markup.indexOf('demo-banner')).toBeLessThan(markup.indexOf('id="main"'));
  });

  it('About: data, provider-visible limitation, Team Fit, Shared-Match, confidence, privacy and group scope', () => {
    const page = html('#/about');
    for (const text of ['使用哪些資料', 'lifetimeComplete = false', 'Team Fit', '同場比較', '信心度與樣本數', '隱私', '群組範圍']) expect(page).toContain(text);
    expect(renderToString(<Page route="/about" state={{ status: 'loading' }} />)).toContain('資料與方法'); // methodology renders without a snapshot
  });

  it('mobile structure: data tables carry per-cell labels and the stylesheet stacks them under 640 px (no horizontal scroll)', async () => {
    const page = html('#/');
    expect(page).toContain('class="table responsive"');
    expect(page).toContain('data-label="目前實力"');
    const css = await readFile(join(import.meta.dirname, '../apps/web/src/styles.css'), 'utf8');
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*\.table\.responsive td\[data-label\]::before/u);
    expect(css).not.toMatch(/overflow-x:\s*auto/u);
  });

  it('accessibility basics: one h1 per page, labelled navigation, labelled selectors, skip link, text status (not colour only)', () => {
    for (const hash of ['#/', '#/players', '#/synergy', '#/team-builder', '#/about', `#/compare?a=${idOf('Nova')}&b=${idOf('Vex')}`]) {
      const page = html(hash);
      expect(page.match(/<h1[ >]/gu)?.length).toBe(1);
      expect(page).toContain('aria-label="主要導覽"');
      expect(page).toContain('跳到主要內容');
    }
    const compare = html('#/compare');
    expect(compare).toContain('for="compare-a"'); expect(compare).toContain('for="compare-b"');
    expect(html('#/')).toMatch(/data-status="(available|partial)"[^>]*><span aria-hidden="true">.<\/span> (完整|部分證據)/u);
  });
});
