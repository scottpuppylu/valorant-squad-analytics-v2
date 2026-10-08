import { describe, expect, it } from 'vitest';
import {
  assignmentSignature, buildTeamCompositionEngine, compareDescWithTies, compareRecommendation, rankAssignments, TEAM_COMPOSITION_LEGACY_VERSION,
  TEAM_COMPOSITION_TIE_EPSILON, TEAM_COMPOSITION_VERSION, tieEqual, withinComparableBand, type RankableAssignment,
} from '@vsa/analytics';
import type { CanonicalMatch } from '@vsa/contracts/canonical';
import { demoMatches } from './helpers.ts';

const EPS = TEAM_COMPOSITION_TIE_EPSILON;

describe('team-composition-v1.1 versioning', () => {
  it('V2 emits team-composition-v1.1; team-composition-v1 names the legacy semantics only', () => {
    expect(TEAM_COMPOSITION_VERSION).toBe('team-composition-v1.1');
    expect(TEAM_COMPOSITION_LEGACY_VERSION).toBe('team-composition-v1');
    expect(EPS).toBe(1e-9);
  });
});

describe('semantic equality (inclusive epsilon)', () => {
  it('exact equality, difference < epsilon and difference == epsilon are ties; difference > epsilon is not', () => {
    expect(tieEqual(60, 60)).toBe(true);
    expect(tieEqual(0, EPS / 2)).toBe(true);
    expect(tieEqual(0, EPS)).toBe(true); // exactly epsilon apart (exactly representable here)
    expect(tieEqual(0, 2 * EPS)).toBe(false);
    expect(compareDescWithTies(0, EPS)).toBe(0);
    expect(compareDescWithTies(0, 2 * EPS)).toBeGreaterThan(0); // larger first
    expect(compareDescWithTies(2 * EPS, 0)).toBeLessThan(0);
  });

  it('confidence ties pass to score, then to the signature; a real confidence difference decides on its own', () => {
    const a: RankableAssignment = { confidence: 70, score: 60, signature: 'b' };
    const b: RankableAssignment = { confidence: 70 + 1e-12, score: 61, signature: 'a' };
    expect(compareRecommendation(a, b)).toBeGreaterThan(0); // confidence tied → higher score (b) first
    const c: RankableAssignment = { confidence: 71, score: 50, signature: 'z' };
    expect(compareRecommendation(c, b)).toBeLessThan(0); // confidence 71 beats 70 regardless of score
    const d: RankableAssignment = { confidence: 70, score: 61 + 1e-13, signature: 'c' };
    expect(compareRecommendation(b, d)).toBeLessThan(0); // confidence and score tied → signature asc ('a' < 'c')
  });

  it('comparable-band membership uses the same equality at its edge', () => {
    expect(withinComparableBand(58, 60, 2)).toBe(true);
    expect(withinComparableBand(58 - EPS / 2, 60, 2)).toBe(true);
    expect(withinComparableBand(58 - 1e-6, 60, 2)).toBe(false);
  });
});

describe('deterministic ranking', () => {
  const pool: RankableAssignment[] = [
    { score: 64.2, confidence: 70.53926346588312, signature: 's1' }, { score: 61.5, confidence: 70.53926346588311, signature: 's2' },
    { score: 62.4, confidence: 69.7, signature: 's3' }, { score: 50, confidence: 99, signature: 's4' }, { score: 64.2 + 1e-12, confidence: 70.5392634658831, signature: 's0' },
  ];
  it('is identical for every input order, never repeats an assignment and never repeats the primary as an alternative', () => {
    const expected = rankAssignments(pool, 3).map((a) => a.signature);
    expect(expected).toEqual(['s0', 's1', 's2', 's3', 's4']); // band: s0 s1 s2 s3 (by confidence ties → score → signature); s4 outside the band
    for (let i = 0; i < 20; i += 1) {
      const shuffled = [...pool].sort(() => Math.sin(i * 7 + pool.length) - 0.1);
      expect(rankAssignments(shuffled.reverse(), 3).map((a) => a.signature)).toEqual(expected);
    }
    expect(new Set(expected).size).toBe(expected.length);
    expect(() => rankAssignments([...pool, pool[0]!], 3)).toThrow(/duplicate/u);
  });

  it('the signature uses only V2 member identity, agent content id and role, in canonical member order', () => {
    const picks = [{ memberId: 'member-b', agent: 'Jett', role: 'Duelist' }, { memberId: 'member-a', agent: 'Omen', role: 'Controller' }];
    const sig = assignmentSignature(picks);
    expect(sig).toBe('member-a=8e253930-4c05-31dd-1b6c-968525494517/Controller|member-b=add6443a-41bd-e414-f6ad-e58d267f4e95/Duelist');
    expect(assignmentSignature([...picks].reverse())).toBe(sig);
    expect(assignmentSignature([{ memberId: 'member-a', agent: 'Unknown', role: 'Duelist' }])).toBe('member-a=unknown:Unknown/Duelist');
  });
});

describe('recommendation invariance on the synthetic pipeline', () => {
  const matches = demoMatches();
  const engine = buildTeamCompositionEngine(matches);
  const SETS = [['member-nova', 'member-rook', 'member-vex', 'member-sol', 'member-pike'], ['member-nova', 'member-rook', 'member-kite', 'member-sol', 'member-juno']];
  const perms = <T,>(xs: T[]): T[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));

  it('INPUT_ORDER_INVARIANCE: all 120 permutations of the five members give the same output, on several maps', () => {
    for (const set of SETS) for (const map of ['Ascent', 'Haven', 'Split']) {
      const reference = JSON.stringify(engine.recommend(set, map));
      for (const p of perms(set)) expect(JSON.stringify(engine.recommend(p, map))).toBe(reference);
    }
  });

  it('DATABASE / ITERATION ORDER INVARIANCE: shuffled match rows and participant rows give the same output', () => {
    const shuffle = <T,>(xs: readonly T[], seed: number) => [...xs].map((x, i) => ({ x, k: Math.sin(seed * 9301 + i * 49297) })).sort((a, b) => a.k - b.k).map((e) => e.x);
    const reordered: CanonicalMatch[] = shuffle(matches, 3).map((m, i) => ({ ...m, participants: shuffle(m.participants, i), rounds: shuffle(m.rounds, i + 1),
      events: shuffle(m.events, i + 2) }));
    const other = buildTeamCompositionEngine(reordered);
    for (const set of SETS) for (const map of ['Ascent', 'Bind', 'Lotus']) {
      expect(JSON.stringify(other.recommend(set, map))).toBe(JSON.stringify(engine.recommend(set, map)));
    }
  });

  it('alternatives: no duplicates, the primary never reappears, labels follow the order', () => {
    for (const map of engine.maps) {
      const r = engine.recommend(SETS[0]!, map).v1;
      const sigs = r.lineups.map((l) => l.members.map((m) => `${m.memberId}=${m.agent}`).join('|'));
      expect(new Set(sigs).size).toBe(sigs.length);
      expect(r.lineups.map((l) => l.label)).toEqual(['RECOMMENDED_HISTORICAL_FIT', ...r.lineups.slice(1).map(() => 'ALTERNATIVE')]);
      expect(r.version).toBe('team-composition-v1.1');
    }
  });
});
