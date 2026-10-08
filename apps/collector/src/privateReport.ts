import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import {
  buildProductAnalytics, EventMetricEngine, fiveMemberSets, projectMatchViews, validateAgentCatalog,
} from '@vsa/analytics';
import type { PostgresCanonicalRepository } from '@vsa/canonical-data';
import type { CanonicalMatch } from '@vsa/contracts/canonical';
import { findSecretPatterns } from '@vsa/privacy';

/**
 * PRIVATE OPERATOR REPORT (local only). Lets the operator inspect the accepted analytics for EVERY member of a group
 * before consent reconciliation — without creating anything publishable:
 *  - output is a report (JSON + Markdown), not a snapshot: no manifest, no public ids, so no publisher accepts it;
 *  - it may only be written under `<repo>/.private/` (git-ignored) and never under apps/web/public;
 *  - it contains community display names and aggregates only — never provider ids, internal ids, match keys, raw match ids,
 *    coordinates or connection strings (scanned before it is kept; a failed scan deletes it and fails the command);
 *  - it is produced only by an explicit CLI command against a local database; nothing in the web app can request it.
 */
export const PRIVATE_REPORT_VERSION = 'private-operator-report-v1' as const;

const FORBIDDEN: readonly [string, RegExp][] = [
  ['canonical-match-key', /\bcm_[0-9a-f]{24}\b/u], ['internal-member-id', /\bmember-[a-z0-9-]{4,}/u], ['internal-account-id', /\baccount-[a-z0-9-]{4,}/u],
  ['uuid', /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu], ['participant-key', /\bpk_[0-9a-f]{16}\b/u], ['puuid', /puuid/iu],
  ['coordinate-key', /"(x|y|location|playerSnapshots|viewRadians)"/u], ['db', /DATABASE_URL|postgres(ql)?:\/\//u],
];

export function scanPrivateReport(text: string): string[] {
  return [...FORBIDDEN.filter(([, rx]) => rx.test(text)).map(([name]) => name), ...findSecretPatterns(text)];
}

/** Refuse any output location outside `<repo>/.private/`. */
export function privateOutputDir(repoRoot: string, requested?: string): string {
  const base = resolve(repoRoot, '.private');
  const out = resolve(requested ?? join(base, 'operator-report'));
  const rel = relative(base, out);
  if (rel.startsWith('..') || rel.split(sep).includes('..') || resolve(out) === resolve(repoRoot)) throw new Error('the private report may only be written under <repo>/.private/');
  return out;
}

const r = (v: number | null | undefined, d = 1) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

export interface PrivateReportResult { outDir: string; members: number; matches: number; competitive: number; teamRuns: number; timings: Record<string, number>; findings: string[] }

export async function buildPrivateReport(repository: PostgresCanonicalRepository, groupId: string, outDir: string): Promise<PrivateReportResult> {
  const t0 = Date.now();
  const members = await repository.listMembers(groupId);
  const consents = await repository.listConsents(groupId);
  const ids = members.map((m) => m.memberId).sort();
  const name = new Map(members.map((m) => [m.memberId, m.displayName]));
  const keys = await repository.listMatchKeysForMembers(ids);
  const matches: CanonicalMatch[] = [];
  for (let i = 0; i < keys.length; i += 50) matches.push(...await repository.getMatches(keys.slice(i, i + 50)));
  const rank = await repository.listRankContext(ids);
  const loadMs = Date.now() - t0;

  const fingerprints = Object.fromEntries((['event-metrics-v1', 'event-metrics-v2'] as const).map((version) => {
    const records = projectMatchViews(matches, new EventMetricEngine({ ruleVersion: version })).filter((m) => m.gameMode === 'Competitive')
      .flatMap((m) => m.performances.map((p) => ({ match: m.id, member: name.get(p.playerId), kast: p.kast ?? null, fk: p.firstKills ?? null, fd: p.firstDeaths ?? null, adv: p.advancedMetrics ?? null })))
      .sort((a, b) => (a.match < b.match ? -1 : a.match > b.match ? 1 : a.member! < b.member! ? -1 : 1));
    return [version, { competitiveRecords: records.length, fingerprint: `evfp-v1:${sha(records).slice(0, 16)}` }];
  }));
  const views = projectMatchViews(matches);
  const tProduct = Date.now();
  const product = buildProductAnalytics(ids, matches, rank);
  const productMs = Date.now() - tProduct;
  const sets = fiveMemberSets(ids);
  const report = {
    reportVersion: PRIVATE_REPORT_VERSION,
    banner: 'PRIVATE / LOCAL ONLY — operator inspection before consent reconciliation. NOT a public snapshot. Do not publish or share.',
    consent: { members: members.length, publicEligible: consents.filter((c) => c.groupVisibilityAllowed && c.publicDerivedAnalyticsAllowed).length,
      statuses: Object.fromEntries([...new Set(consents.map((c) => c.status))].map((s) => [s, consents.filter((c) => c.status === s).length])) },
    coverage: product.coverage,
    agentCatalog: (({ complete, totalRows, knownRows, unknownRows }) => ({ complete, totalRows, knownRows, unknownRows }))(
      validateAgentCatalog(views.filter((m) => m.gameMode === 'Competitive').flatMap((m) => m.performances.map((p) => ({ agentName: p.agent }))))),
    eventFingerprints: fingerprints,
    members: product.profiles.map((p) => ({
      name: name.get(p.memberId), primaryRole: p.primaryRole, competitiveMatches: p.competitiveMatches,
      communityScore: { status: p.communityScore.status, value: r(p.communityScore.value), confidence: r(p.communityScore.confidence, 0) },
      currentStrength: { status: p.currentStrength.status, value: r(p.currentStrength.value), window: `${p.currentWindow.status} ${p.currentWindow.matches}m/${p.currentWindow.rounds}r` },
      recentForm: p.recentForm.status, kast: r(p.advanced.kast.rate, 3), opening: [p.advanced.opening.firstKills, p.advanced.opening.firstDeaths],
      trade: p.advanced.trade.tradeKills, clutch: [p.advanced.clutch.wins, p.advanced.clutch.attempts], roundImpact: r(p.advanced.roundImpact.value),
      rank: p.rank.tierLabel, topAgents: p.agents.slice(0, 3).map((a) => `${a.agentName}×${a.matches}`),
    })),
    sharedMatch: {
      version: product.sharedMatch.version, coverage: product.sharedMatch.coverage,
      members: product.sharedMatch.members.map((m) => ({ name: name.get(m.memberId), combined: r(m.combined.rating), competitive: r(m.competitive.rating), unrated: r(m.unrated.rating),
        recent: r(m.recent.rating), sharedMatches: m.combined.sharedMatches })),
      pairs: product.sharedMatch.pairs.map((p) => ({ pair: `${name.get(p.memberA)} × ${name.get(p.memberB)}`, shared: p.sharedMatches, scored: p.scoredMatches,
        aheadA: p.aOutperformed, aheadB: p.bOutperformed, neutral: p.neutral, difference: r(p.relativeDifference) })),
    },
    teamComposition: {
      runs: product.teamBuilder.results.length, maps: product.teamBuilder.maps, fiveMemberSets: sets.length,
      okRuns: product.teamBuilder.results.filter((x) => x.status === 'ok').length,
      responsibilities: (() => {
        const tally = new Map<string, number>();
        for (const res of product.teamBuilder.results) for (const m of res.lineups[0]?.members ?? []) for (const label of [m.generalResponsibility, m.attackResponsibility, m.defenseResponsibility, ...m.attackReasons, ...m.defenseReasons]) {
          if (label) tally.set(label, (tally.get(label) ?? 0) + 1);
        }
        return Object.fromEntries([...tally.entries()].sort());
      })(),
      examples: product.teamBuilder.results.filter((x) => x.memberIds.join(',') === sets[0]?.join(',')).slice(0, 3).map((x) => ({
        members: x.memberIds.map((id) => name.get(id)), map: x.map, status: x.status,
        lineups: x.lineups.map((l) => ({ label: l.label, teamFit: r(l.teamFit), confidence: r(l.confidence, 0),
          members: l.members.map((m) => `${name.get(m.memberId)}=${m.agentName}/${m.role}${m.attackResponsibility ? ` A:${m.attackResponsibility}` : ''}${m.defenseResponsibility ? ` D:${m.defenseResponsibility}` : ''}`) })),
      })),
    },
    timings: { loadMs, productMs, totalMs: Date.now() - t0 },
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const md = [`# ${report.banner}`, '', `Version: ${PRIVATE_REPORT_VERSION}`, '', '```json', json, '```', ''].join('\n');
  await mkdir(outDir, { recursive: true });
  const findings = [...scanPrivateReport(json), ...scanPrivateReport(md)];
  if (findings.length) { await rm(outDir, { recursive: true, force: true }); return { outDir, members: ids.length, matches: matches.length, competitive: product.coverage.competitiveMatches, teamRuns: 0, timings: report.timings, findings }; }
  await writeFile(join(outDir, 'operator-report.json'), json, 'utf8');
  await writeFile(join(outDir, 'operator-report.md'), md, 'utf8');
  return { outDir, members: ids.length, matches: matches.length, competitive: product.coverage.competitiveMatches, teamRuns: report.teamComposition.runs, timings: report.timings, findings };
}
