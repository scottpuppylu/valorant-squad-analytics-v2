import { describe, expect, it } from 'vitest';
import {
  AGENT_ROLES_CATALOG_V0, agentRoles, analyzeRoundTopology, buildProductAnalytics, buildTeamCompositionEngine, computeSharedMatchRatings, computeStrength,
  EVENT_INPUT_NORMALIZATION_VERSION, EventMetricEngine, projectMatchView, projectMatchViews, rankEvidenceFromCanonical, rankLookup, resolveAgent, resolveRankContextAt,
  SHRINK_K, TeamCompositionInputError, validateAgentCatalog, VALIDATED_GENERAL_RESPONSIBILITIES, WITHHELD_RESPONSIBILITY_LABELS,
  type EventMetricMatchInput, type MetricKillInput, type PairMatchEvidence, type RankEvidence,
} from '@vsa/analytics';
import type { CanonicalMatch } from '@vsa/contracts/canonical';
import { DEMO_MEMBERS } from '@vsa/collector';
import { demoMatches, demoProduct } from './helpers.ts';

// ------------------------------------------------------------------ event-metrics-v2 / round-topology-v1 (handcrafted)
const P = ['a1', 'a2', 'b1', 'b2'];
const team = (id: string) => (id.startsWith('a') ? 'A' : 'B');
function input(rounds: { winner: 'A' | 'B'; kills: [string, string, number][] }[]): EventMetricMatchInput {
  return {
    normalizationVersion: EVENT_INPUT_NORMALIZATION_VERSION, roundsStatus: 'observed', killsStatus: 'observed',
    participants: P.map((id) => ({ id, teamKey: team(id), agent: 'Jett', kills: 0, assists: 0, damage: 0, abilityStatus: 'missing', economyStatus: 'missing' })),
    rounds: rounds.map((r, i) => ({ id: `r${i}`, number: i, winningTeam: r.winner, participantsStatus: 'observed', participantIds: P, plantStatus: 'absent', defuseStatus: 'absent' })),
    kills: rounds.flatMap((r, i) => r.kills.map(([killer, victim, t], s): MetricKillInput => ({ roundId: `r${i}`, sequence: s, timeInRoundMs: t, killerId: killer, victimId: victim, assistantIds: [] }))),
  };
}
const v1 = new EventMetricEngine({ ruleVersion: 'event-metrics-v1' });
const v2 = new EventMetricEngine({ ruleVersion: 'event-metrics-v2' });

describe('event-metrics-v2 + round-topology-v1 (ported unchanged)', () => {
  it('a plain match: v1 and v2 agree exactly on every player', () => {
    const m = input([{ winner: 'A', kills: [['a1', 'b1', 1000], ['b2', 'a2', 2000], ['a1', 'b2', 4000]] }, { winner: 'B', kills: [['b1', 'a1', 1000], ['b2', 'a2', 3000]] }]);
    const r1 = v1.reconstruct(m); const r2 = v2.reconstruct(m);
    for (const id of P) {
      const { ruleVersion: _a, ...x } = r1.players.get(id)!.metrics; const { ruleVersion: _b, ...y } = r2.players.get(id)!.metrics;
      expect(y).toEqual(x);
    }
    expect(r2.players.get('a1')!.metrics.opening.value).toEqual({ firstKills: 2 - 1, firstDeaths: 1 });
    expect(r2.players.get('a1')!.metrics.trade.value!.tradeKills).toBe(1); // a1 avenged a2 within 5 s
  });

  it('a self-kill is a death only: v1 fails closed for the whole match, v2 keeps KAST / Opening / Trade', () => {
    const m = input([{ winner: 'A', kills: [['b1', 'b1', 1000], ['a1', 'b2', 3000]] }, { winner: 'A', kills: [['a2', 'b1', 1000], ['a1', 'b2', 2000]] }]);
    expect(v1.reconstruct(m).players.get('a1')!.metrics.kast.status).toBe('partial');
    const r = v2.reconstruct(m);
    expect(r.players.get('a1')!.metrics.kast.status).toBe('reconstructed');
    expect(r.players.get('a1')!.metrics.opening.value).toEqual({ firstKills: 1, firstDeaths: 0 }); // the self-kill never opens a duel
    expect(r.players.get('b1')!.metrics.opening.value).toEqual({ firstKills: 0, firstDeaths: 1 });
    const topology = analyzeRoundTopology(m.rounds[0]!, m.kills.filter((k) => k.roundId === 'r0'), new Map(m.participants.map((p) => [p.id, p])));
    expect(topology.trusted).toBe(true);
    expect(topology.issues.get('SELF_KILL')).toBe(1);
  });

  it('a revive (same victim twice) and a posthumous kill keep life state UNKNOWN; undecidable clutch is partial, never zero', () => {
    const m = input([{ winner: 'A', kills: [['b1', 'a1', 1000], ['a2', 'b1', 2000], ['b2', 'a1', 9000], ['a2', 'b2', 12000]] }]);
    const topo = analyzeRoundTopology(m.rounds[0]!, m.kills, new Map(m.participants.map((p) => [p.id, p])));
    expect(topo.issues.get('REVIVE')).toBe(1);
    expect(topo.uncertainPlayers.has('a1')).toBe(true);
    const r = v2.reconstruct(m).players.get('a1')!.metrics;
    expect(['reconstructed', 'partial']).toContain(r.kast.status);
    if (r.clutch.status === 'partial') expect(r.clutch.value).toBeUndefined(); // undecidable → no value (never a guessed 0)
    const posthumous = input([{ winner: 'B', kills: [['b1', 'a1', 1000], ['a1', 'b2', 3000], ['b1', 'a2', 5000]] }]);
    expect(analyzeRoundTopology(posthumous.rounds[0]!, posthumous.kills, new Map(posthumous.participants.map((p) => [p.id, p]))).issues.get('POSTHUMOUS_KILL')).toBe(1);
  });

  it('true ambiguity (a killer outside the round) fails closed in v2 exactly like v1', () => {
    const m = input([{ winner: 'A', kills: [['zz', 'b1', 1000]] }]);
    expect(v2.reconstruct(m).players.get('a1')!.metrics.kast.status).toBe('partial');
  });

  it('the canonical projection is deterministic and only tracked members get performances', () => {
    const [match] = demoMatches();
    const a = projectMatchView(match!); const b = projectMatchView(match!);
    expect(a).toEqual(b);
    expect(a.kind).toBe('projected');
    if (a.kind === 'projected') for (const p of a.match.performances) expect(p.playerId).toMatch(/^member-/u);
  });
});

// ------------------------------------------------------------------ agents
describe('agent-catalog-v1', () => {
  it('stable id first; Miks is a Controller; the provider placeholder stays UNKNOWN; catalog v0 is frozen without Miks', () => {
    const miks = resolveAgent({ id: '7c8a4701-4de6-9355-b254-e09bc2a34b72', name: 'Miks' });
    expect(miks.status === 'known' && miks.definition.role).toBe('Controller');
    expect(resolveAgent({ id: '773f0c78-4486-752b-68ef-4585d7f4b848', name: 'Unknown' }).status).toBe('unknown');
    expect(agentRoles.Unknown).toBeUndefined();
    expect(AGENT_ROLES_CATALOG_V0.Miks).toBeUndefined();
    expect(agentRoles.Miks).toBe('Controller');
    expect(validateAgentCatalog([{ agentName: 'Jett' }, { agentName: 'Unknown' }])).toMatchObject({ complete: false, knownRows: 1, unknownRows: 1 });
  });

  it('every demo Competitive performance resolves to a known agent role (the unknown agent only appears in Unrated)', () => {
    const views = projectMatchViews(demoMatches()).filter((m) => m.gameMode === 'Competitive');
    expect(validateAgentCatalog(views.flatMap((m) => m.performances.map((p) => ({ agentName: p.agent })))).complete).toBe(true);
  });
});

// ------------------------------------------------------------------ rank context
describe('rank-context-v1: no future leakage', () => {
  const row = (kind: RankEvidence['kind'], at: string, matchRef: string | null, tier: number): RankEvidence => ({ accountId: 'm', kind, source: 't', effectiveAt: at, ingestedAt: at,
    seasonId: null, seasonShort: null, providerTierId: tier, providerTierName: null, rr: null, providerElo: null, rrChange: null, matchRef, queue: null, normalized: null });
  it('uses the exact in-match snapshot, else strictly earlier evidence; never later, never peak / seasonal, never its own history row', () => {
    const rows = [row('history', '2026-01-01T00:00:00.000Z', 'old', 10), row('history', '2026-02-01T11:59:59.000Z', 'm2', 99), row('match_snapshot', '2026-02-01T12:00:00.000Z', 'm2', 14),
      row('match_snapshot', '2026-03-01T12:00:00.000Z', 'later', 20), row('peak', '2025-12-01T00:00:00.000Z', null, 25), row('seasonal', '2025-12-01T00:00:00.000Z', null, 24)];
    expect(resolveRankContextAt(rows, 'm', '2026-02-01T12:00:00.000Z', 'm2')).toMatchObject({ status: 'exact_match', evidence: { providerTierId: 14 } });
    const prior = resolveRankContextAt(rows.filter((r) => r.kind !== 'match_snapshot' || r.matchRef !== 'm2'), 'm', '2026-02-01T12:00:00.000Z', 'm2');
    expect(prior).toMatchObject({ status: 'prior_observation', evidence: { providerTierId: 10 } }); // own post-match history row (99) excluded
    expect(resolveRankContextAt(rows, 'm', '2025-06-01T00:00:00.000Z', 'x')).toMatchObject({ status: 'unknown', laterEvidenceExists: true });
  });

  it('canonical rows → evidence keyed by member; every demo participation resolves without leakage', () => {
    const rows = rankEvidenceFromCanonical([{ rankContextId: 'r1', memberId: 'member-nova', accountId: 'account-nova', kind: 'match-snapshot', effectiveAt: '2026-07-01T19:00:00.000Z',
      matchKey: 'cm_000000000000000000000001', providerId: 'fake', sourceEndpoint: 'x', providerTierId: 20, providerTierName: 'Diamond 1', rr: null, rrChange: null, providerElo: 1700,
      seasonKey: null, queue: 'competitive', normalizedTierKey: 'diamond_1', tierOrdinal: 16, tierModelVersion: 'valorant-tier-order-v1' }]);
    const ctx = rankLookup(rows)('member-nova', '2026-07-01T19:00:00.000Z', 'cm_000000000000000000000001');
    expect(ctx.evidence?.normalized?.label).toBe('Diamond 1');
    expect(rankLookup(rows)('member-nova', '2026-06-01T00:00:00.000Z', 'cm_other').status).toBe('unknown');
  });
});

// ------------------------------------------------------------------ shared-match v1
describe('shared-match-rating-v1', () => {
  const sig = (memberId: string, firepower: number) => ({ memberId, agent: 'Jett', role: 'Duelist' as const, rounds: 20, teamGroup: 'A' as const, teamWon: true, acs: 200, adr: 140,
    kpr: 0.8, apr: 0.2, killDiffPerRound: 0.1, kast: null, fkpr: null, fdpr: null, dimensions: { firepower }, engineOverall: null, matchProfile: null });
  const unit = (i: number, a: string, fa: number, b: string, fb: number): PairMatchEvidence => ({ version: 'shared-match-evidence-v1', matchRef: `m${String(i).padStart(3, '0')}`,
    playedAt: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), mode: 'Competitive', map: 'Ascent', seasonKey: null, rounds: 20, sameTeam: true, a: sig(a, fa), b: sig(b, fb),
    rankA: { tierOrdinal: null, status: 'unknown' }, rankB: { tierOrdinal: null, status: 'unknown' }, rankTierDifference: null,
    valid: { stats: true, matchProfile: false, kast: false, remakeOrShort: false } });
  const units = Array.from({ length: 12 }, (_, i) => unit(i, 'x', 60 + (i % 3) * 5, 'y', 40 + (i % 4) * 3));

  it('is group-relative, shrunk by n/(n+8), unavailable below 5 shared matches, and independent of member-id order', () => {
    const r = computeSharedMatchRatings(['x', 'y'], units);
    const x = r.members.find((m) => m.memberId === 'x')!.combined;
    expect(x.status).toBe('available');
    expect(x.rating).toBeCloseTo(100 * (0.5 + 0.5 * (12 / (12 + SHRINK_K))), 9); // x out-performs y every time
    expect(computeSharedMatchRatings(['x', 'y'], units.slice(0, 4)).members[0]!.combined.status).toBe('unavailable');
    // relabel: swapping which id sorts first never changes the member ratings
    const swapped = units.map((u) => ({ ...u, a: { ...u.b, memberId: 'a' }, b: { ...u.a, memberId: 'b' } }));
    const s = computeSharedMatchRatings(['a', 'b'], swapped);
    expect(s.members.find((m) => m.memberId === 'b')!.combined.rating).toBeCloseTo(x.rating!, 12);
  });
});

// ------------------------------------------------------------------ Community Score / Current Strength / Team Composition on the synthetic demo
describe('accepted strength + team composition pipelines (synthetic demo)', () => {
  const matches = demoMatches();
  const views = projectMatchViews(matches);
  const ids = DEMO_MEMBERS.map((m) => m.memberId);

  it('Community Score and Current Strength: accepted gates, Competitive only, deterministic', () => {
    const a = computeStrength(ids, views); const b = computeStrength(ids, views);
    expect(JSON.stringify(a.map((r) => r.communityScore?.overall))).toBe(JSON.stringify(b.map((r) => r.communityScore?.overall)));
    for (const r of a) for (const e of r.entries) expect(e.match.gameMode).toBe('Competitive');
    const nova = a.find((r) => r.memberId === 'member-nova')!;
    expect(nova.communityScore!.overall.status).toBe('available');
    expect(nova.currentWindow.current.matches).toBeLessThanOrEqual(50);
    const kite = a.find((r) => r.memberId === 'member-kite')!;
    expect(kite.currentWindow.status).toBe('unavailable'); // sparse member: below the window minimum → no Current Strength
    expect(kite.currentStrength).toBeUndefined();
  });

  it('Team Composition V1: exactly five distinct members and a map; Team Fit is 0–100; V2 never changes the V1 assignment', () => {
    const engine = buildTeamCompositionEngine(matches);
    expect(() => engine.recommend(ids.slice(0, 4), 'Ascent')).toThrow(TeamCompositionInputError);
    expect(() => engine.recommend([...ids.slice(0, 4), ids[0]!], 'Ascent')).toThrow(TeamCompositionInputError);
    const five = ['member-nova', 'member-rook', 'member-vex', 'member-sol', 'member-pike'];
    const r = engine.recommend(five, 'Ascent');
    expect(r.v1.status).toBe('ok');
    const top = r.v1.lineups[0]!;
    expect(top.teamFit).toBeGreaterThanOrEqual(0); expect(top.teamFit).toBeLessThanOrEqual(100);
    expect(r.v1.boundary).toEqual({ positionClaims: false, siteClaims: false, causalClaim: false, liveOpponentScouting: false });
    expect(r.v2!.assignment).toEqual(top.members.map((m) => ({ memberId: m.memberId, agent: m.agent, role: m.role })));
    expect(r.v2!.emittable).toEqual({ attack: ['ATTACK_PLANT_SUPPORT', 'ATTACK_POST_PLANT', 'ATTACK_PRIMARY_ENTRY', 'ATTACK_SECOND_ENTRY_TRADE'],
      defense: ['DEFENSE_FIRST_CONTACT', 'DEFENSE_INFO_SUPPORT'], siteTendency: false });
    for (const m of r.v2!.members) { expect(m.attack.siteTendency.site).toBeNull(); expect(m.defense.siteTendency.site).toBeNull(); }
    expect(JSON.stringify(engine.recommend([...five].reverse(), 'Ascent').v1)).toBe(JSON.stringify(r.v1)); // input order never matters
  });

  it('product read model: only validated responsibility labels are displayable; withheld V2 labels never appear; abstention is explicit', () => {
    const product = demoProduct();
    const text = JSON.stringify(product.teamBuilder.results);
    for (const label of ['ATTACK_INFO_SETUP', 'ATTACK_SPACE_CONTROL', 'ATTACK_UTILITY_SUPPORT', 'DEFENSE_SITE_HOLD', 'DEFENSE_CLUTCH', 'DEFENSE_FLEX']) expect(text).not.toContain(label);
    const members = product.teamBuilder.results.flatMap((r) => r.lineups.flatMap((l) => l.members));
    for (const m of members) {
      if (m.generalResponsibility) expect(VALIDATED_GENERAL_RESPONSIBILITIES.has(m.generalResponsibility)).toBe(true);
      if (m.withheldResponsibility) expect(VALIDATED_GENERAL_RESPONSIBILITIES.has(m.withheldResponsibility)).toBe(false);
    }
    expect(members.some((m) => m.attackReasons.includes('insufficient_side_evidence') || m.defenseReasons.includes('insufficient_side_evidence') || m.attackReasons.includes('no_distinct_responsibility'))).toBe(true);
    expect(product.teamBuilder.withheldLabels).toEqual([...WITHHELD_RESPONSIBILITY_LABELS]);
  });

  it('a withheld member is an untracked participant for public product analytics (no pair, profile or lineup)', () => {
    const product = demoProduct();
    const text = JSON.stringify(product);
    expect(text).not.toContain('member-pike');
    const everyone = buildProductAnalytics(ids, matches, [], { teamMaps: [] });
    expect(JSON.stringify(everyone.profiles)).toContain('member-pike');
  });

  it('the canonical evidence is never mutated by the product builder', () => {
    const copy: CanonicalMatch[] = JSON.parse(JSON.stringify(matches));
    buildProductAnalytics(['member-nova', 'member-rook'], matches, [], { teamMaps: [] });
    expect(matches).toEqual(copy);
  });
});
