import type { FakeAccount, FakeKill, FakeMatchPayload, FakePlayerLine, FakePos, FakeRound, FakeRoundLine } from './payload.ts';

/**
 * Deterministic SYNTHETIC fixture (fake-fixture-v2): 7 fictional tracked players, 72 matches over two acts, 5 maps, full
 * round / kill / plant / defuse / kill-time position evidence. No real Riot IDs, no real names, no real matches.
 * Designed so every product state renders: rich members, a sparse member (abstention), a late joiner (insufficient
 * sample), a member without rank evidence, an unknown agent, a self-kill (event-metrics-v2 robustness) and a match
 * without damage evidence. Private-looking values (fake PUUIDs, raw match refs, handles) are planted on purpose so privacy
 * checks can prove they never reach a public snapshot or the web bundle.
 */
export const FAKE_ACCOUNTS: readonly FakeAccount[] = [
  { handle: 'Nova#DEMO', fakePuuid: 'fake-puuid-0001-nova', tierId: 18, tierName: 'Diamond 1' },
  { handle: 'Rook#DEMO', fakePuuid: 'fake-puuid-0002-rook', tierId: 15, tierName: 'Platinum 1' },
  { handle: 'Vex#DEMO', fakePuuid: 'fake-puuid-0003-vex', tierId: 16, tierName: 'Platinum 2' },
  { handle: 'Kite#DEMO', fakePuuid: 'fake-puuid-0004-kite', tierId: 12, tierName: 'Gold 1' },
  { handle: 'Juno#DEMO', fakePuuid: 'fake-puuid-0005-juno', tierId: 0, tierName: '' },
  { handle: 'Sol#DEMO', fakePuuid: 'fake-puuid-0006-sol', tierId: 17, tierName: 'Platinum 3' },
  { handle: 'Pike#DEMO', fakePuuid: 'fake-puuid-0007-pike', tierId: 13, tierName: 'Gold 2' },
];

const A = (label: string, code: string) => ({ label, code });
// Public static agent content ids (the same ids every client of the game uses); roles come from agent-catalog-v1.
const AG = {
  jett: A('Jett', 'add6443a-41bd-e414-f6ad-e58d267f4e95'), raze: A('Raze', 'f94c3b30-42be-e959-889c-5aa313dba261'),
  phoenix: A('Phoenix', 'eb93336a-449b-9c1b-0a54-a891f7921d69'), reyna: A('Reyna', 'a3bfb853-43b2-7238-a4f1-ad90e9e46bcc'),
  sova: A('Sova', '320b2a48-4d9b-a075-30f1-1f93a9b638fa'), breach: A('Breach', '5f8d3a7f-467b-97f3-062c-13acf203c006'),
  skye: A('Skye', '6f2a04ca-43e0-be17-7f36-b3908627744d'), fade: A('Fade', 'dade69b4-4f5a-8528-247b-219e5a1facd6'),
  omen: A('Omen', '8e253930-4c05-31dd-1b6c-968525494517'), brimstone: A('Brimstone', '9f0d8ba9-4140-b941-57d3-a7ad57c6b417'),
  viper: A('Viper', '707eab51-4836-f488-046a-cda6bf494859'), astra: A('Astra', '41fb69c1-4189-7b37-f117-bcaf1e96f1bf'),
  sage: A('Sage', '569fdd95-4d10-43ab-ca70-79becc718b46'), cypher: A('Cypher', '117ed9e3-49f3-6512-3ccf-0cada7e3823b'),
  killjoy: A('Killjoy', '1e58de9c-4950-5125-93e9-a0aee9f98746'), chamber: A('Chamber', '22697a3d-45bf-8dd7-4fec-84a9e28c69d7'),
};
/** A deliberately UNKNOWN agent identity (not in the catalog): it must stay UNKNOWN, never get a role. */
const UNKNOWN_AGENT = A('Unknown', 'ffffffff-0000-4000-8000-0000000000aa');

interface Profile { skill: number; agents: { code: string; label: string }[] }
const PROFILES: readonly Profile[] = [
  { skill: 1.3, agents: [AG.jett, AG.raze, AG.reyna] }, // Nova
  { skill: 0.95, agents: [AG.omen, AG.astra, AG.brimstone] }, // Rook
  { skill: 1.05, agents: [AG.sova, AG.fade, AG.skye] }, // Vex
  { skill: 0.9, agents: [AG.killjoy, AG.cypher] }, // Kite (sparse)
  { skill: 1.0, agents: [AG.skye, AG.reyna] }, // Juno (late joiner)
  { skill: 1.1, agents: [AG.sage, AG.viper, AG.killjoy] }, // Sol
  { skill: 1.0, agents: [AG.phoenix, AG.raze] }, // Pike (public analytics withheld)
];
const FILLER_AGENTS = [AG.breach, AG.chamber, AG.viper, AG.cypher, AG.fade, AG.brimstone, AG.phoenix, AG.sage, AG.raze, AG.skye, AG.omen, AG.killjoy, AG.jett, AG.sova];

const MAPS = [
  { code: 'map-ascent', label: 'Ascent', sites: ['A', 'B'] }, { code: 'map-bind', label: 'Bind', sites: ['A', 'B'] },
  { code: 'map-haven', label: 'Haven', sites: ['A', 'B', 'C'] }, { code: 'map-lotus', label: 'Lotus', sites: ['A', 'B', 'C'] },
  { code: 'map-split', label: 'Split', sites: ['A', 'B'] },
] as const;
const SITE_CENTER: Record<string, [number, number]> = { A: [2300, 2600], B: [7200, 6400], C: [4600, 7900] };

/** mulberry32: tiny deterministic PRNG (fixture generation only). */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Coordinates are 1000–8999 with a .375 / .625 fraction: impossible to confuse with any published statistic. */
function position(rand: () => number, center: readonly [number, number], spread: number): FakePos {
  const c = (v: number) => Math.min(8999, Math.max(1000, Math.round(v + (rand() - 0.5) * 2 * spread))) + (rand() < 0.5 ? 0.375 : 0.625);
  return { px: c(center[0]), py: c(center[1]), facing: Math.round(rand() * 6283) / 1000 };
}

function pick<T>(rand: () => number, items: readonly T[], weight: (item: T) => number = () => 1): T {
  const total = items.reduce((s, i) => s + weight(i), 0);
  let r = rand() * total;
  for (const item of items) { r -= weight(item); if (r <= 0) return item; }
  return items[items.length - 1]!;
}

function trackedFor(index: number): number[] {
  const core = [0, 1, 2, 5].filter((k) => !(index % 5 === 4 && k === 2) && !(index % 7 === 3 && k === 1));
  const extra = [...(index % 3 === 0 ? [6] : []), ...(index % 9 === 4 ? [3] : []), ...(index >= 62 ? [4] : [])];
  return [...core, ...extra].slice(0, 5);
}

function buildMatch(index: number): FakeMatchPayload {
  const rand = prng(7000 + index * 13);
  const queue: FakeMatchPayload['queue'] = index === 30 ? 'swiftplay' : index % 8 === 7 ? 'unrated' : 'competitive';
  const map = MAPS[(index * 3 + (index >> 2)) % MAPS.length]!;
  const id = String(index + 1).padStart(4, '0');
  const tracked = trackedFor(index);
  const blue = [...tracked.map((k) => FAKE_ACCOUNTS[k]!.fakePuuid), ...Array.from({ length: 5 - tracked.length }, (_, i) => `fake-puuid-other-${id}-b${i + 1}`)];
  const red = [1, 2, 3, 4, 5].map((k) => `fake-puuid-other-${id}-r${k}`);
  const everyone = [...blue, ...red];
  const sideOf = (p: string): 'red' | 'blue' => (blue.includes(p) ? 'blue' : 'red');
  const skill = new Map(everyone.map((p) => {
    const k = FAKE_ACCOUNTS.findIndex((a) => a.fakePuuid === p);
    return [p, k >= 0 ? PROFILES[k]!.skill : 0.9 + rand() * 0.2];
  }));
  // Agents: members prefer their pool (deterministic rotation), team agents stay distinct.
  const agentOf = new Map<string, { code: string; label: string }>();
  for (const team of [blue, red]) {
    const used = new Set<string>();
    for (const p of team) {
      const k = FAKE_ACCOUNTS.findIndex((a) => a.fakePuuid === p);
      const pool = k >= 0 ? (k === 4 && queue === 'unrated' ? [UNKNOWN_AGENT] : PROFILES[k]!.agents) : FILLER_AGENTS;
      const ordered = k >= 0 ? [...pool.slice(index % pool.length), ...pool.slice(0, index % pool.length)] : pool;
      const preferred = k >= 0 && rand() < 0.6 ? pool[0]! : undefined;
      const choice = [preferred, ...ordered, ...FILLER_AGENTS].find((a) => a && !used.has(a.code))!;
      used.add(choice.code); agentOf.set(p, choice);
    }
  }
  const blueStrength = blue.reduce((s, p) => s + skill.get(p)!, 0) / 5;
  const blueWins = rand() < 0.35 + 0.5 * (blueStrength - 0.95);
  const loserRounds = 3 + Math.floor(rand() * 9);
  const score = blueWins ? { blue: 13, red: loserRounds } : { blue: loserRounds, red: 13 };
  const total = score.blue + score.red;
  const winners: ('red' | 'blue')[] = [];
  let blueLeft = score.blue - (blueWins ? 1 : 0); let redLeft = score.red - (blueWins ? 0 : 1);
  for (let n = 1; n < total; n += 1) {
    if (blueLeft > 0 && (redLeft === 0 || rand() < blueLeft / (blueLeft + redLeft))) { winners.push('blue'); blueLeft -= 1; } else { winners.push('red'); redLeft -= 1; }
  }
  winners.push(blueWins ? 'blue' : 'red');

  const killLog: FakeKill[] = [];
  const rounds: FakeRound[] = [];
  const kills = new Map(everyone.map((p) => [p, 0])); const deaths = new Map(everyone.map((p) => [p, 0])); const assists = new Map(everyone.map((p) => [p, 0]));
  const pts = new Map(everyone.map((p) => [p, 0])); const buys = new Map(everyone.map((p) => [p, 0]));
  for (let n = 1; n <= total; n += 1) {
    const winner = winners[n - 1]!;
    const attacker: 'red' | 'blue' = n <= 12 ? 'red' : 'blue';
    const loser = winner === 'blue' ? 'red' : 'blue';
    const r = rand();
    const how: FakeRound['how'] = winner === attacker ? (r < 0.55 ? 'Elimination' : 'Bomb detonated') : (r < 0.5 ? 'Elimination' : r < 0.8 ? 'Bomb defused' : 'Round timer expired');
    const loserDeaths = how === 'Elimination' ? 5 : how === 'Bomb detonated' ? 1 + Math.floor(rand() * 4) : 2 + Math.floor(rand() * 3);
    // 0..4 winner deaths (4 = a last survivor wins the round: a real 1-vs-N clutch win must be possible).
    const winnerDeaths = Math.min(4, Math.floor(rand() * rand() * 5.5));
    const order: ('W' | 'L')[] = [...Array(loserDeaths).fill('L'), ...Array(winnerDeaths).fill('W')];
    for (let i = order.length - 1; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j]!, order[i]!]; }
    if (how === 'Elimination') { const last = order.lastIndexOf('L'); order.splice(last, 1); order.push('L'); }
    const alive = { blue: new Set(blue), red: new Set(red) };
    const targetSite = pick(rand, map.sites);
    const anchor = new Map(everyone.map((p) => [p, pick(rand, map.sites)]));
    const where = (p: string) => (sideOf(p) === attacker ? position(rand, SITE_CENTER[targetSite]!, 900) : position(rand, SITE_CENTER[anchor.get(p)!]!, 1100));
    let t = 5000 + Math.floor(rand() * 6000);
    const planted = how === 'Bomb detonated' || how === 'Bomb defused' || (how === 'Elimination' && winner === attacker && rand() < 0.3);
    const plantAfter = planted ? Math.max(1, Math.floor(order.length / 2)) : -1;
    let plant: FakeRound['plant'] = null;
    const selfKillRound = index % 11 === 5 && n === 4;
    const roundKills = new Map(everyone.map((p) => [p, 0]));
    order.forEach((who, i) => {
      if (i === plantAfter && plant === null) {
        const planter = pick(rand, [...alive[attacker]], (p) => skill.get(p)!);
        plant = { site: targetSite, puuid: planter, ms: t + 2000, pos: position(rand, SITE_CENTER[targetSite]!, 450) };
        t += 4000;
      }
      const victimTeam = who === 'L' ? loser : winner;
      const killerTeam = victimTeam === 'blue' ? 'red' : 'blue';
      const victim = pick(rand, [...alive[victimTeam]], (p) => 2 - skill.get(p)!);
      const self = selfKillRound && who === 'W';
      const killer = self ? victim : pick(rand, [...alive[killerTeam]], (p) => skill.get(p)! ** 2);
      const mates = [...alive[killerTeam]].filter((p) => p !== killer);
      const assist = !self && mates.length && rand() < 0.55 ? [pick(rand, mates)] : [];
      const seen = [...alive.blue, ...alive.red].filter((p) => p !== victim).sort(() => 0).filter(() => rand() < 0.5).slice(0, 4).map((p) => ({ puuid: p, pos: where(p) }));
      killLog.push({ round: n, ms: t, killerPuuid: killer, victimPuuid: victim, assistPuuids: assist, victimPos: where(victim), seen });
      if (!self) { kills.set(killer, kills.get(killer)! + 1); roundKills.set(killer, roundKills.get(killer)! + 1); }
      deaths.set(victim, deaths.get(victim)! + 1);
      for (const a of assist) assists.set(a, assists.get(a)! + 1);
      alive[victimTeam].delete(victim);
      t += 2000 + Math.floor(rand() * 11000);
    });
    let defuse: FakeRound['defuse'] = null;
    const p0 = plant as FakeRound['plant'];
    if (how === 'Bomb defused' && p0) {
      const defender = pick(rand, [...alive[winner]]);
      defuse = { puuid: defender, ms: p0.ms + 20000 + Math.floor(rand() * 15000), pos: position(rand, SITE_CENTER[p0.site]!, 400) };
    }
    const pistol = n === 1 || n === 13;
    const lines: FakeRoundLine[] = everyone.map((p) => {
      const buy = pistol ? 800 : 2000 + Math.floor(rand() * 2900);
      const points = roundKills.get(p)! * 160 + 30 + Math.floor(rand() * 90) + (alive[sideOf(p)].has(p) ? 40 : 0);
      pts.set(p, pts.get(p)! + points); buys.set(p, buys.get(p)! + buy);
      return { puuid: p, k: roundKills.get(p)!, pts: points, buy, bank: Math.floor(rand() * 4000), gun: pistol ? { code: 'w-classic', label: 'Classic' } : rand() < 0.6 ? { code: 'w-vandal', label: 'Vandal' } : { code: 'w-phantom', label: 'Phantom' } };
    });
    rounds.push({ n, winner, attacker, how, plant: p0, defuse, lines });
  }
  const hasDamage = index !== 15; // one unrated match without damage evidence
  const players: FakePlayerLine[] = everyone.map((p) => {
    const k = kills.get(p)!; const a = assists.get(p)!;
    const head = Math.round(k * 0.6 + rand() * 3); const body = Math.round(k * 2.4 + 10 + rand() * 8); const leg = Math.round(1 + rand() * 4);
    const buyTotal = buys.get(p)!;
    return { fakePuuid: p, side: sideOf(p), agent: agentOf.get(p)!, k, d: deaths.get(p)!, a, pts: pts.get(p)!,
      dmg: hasDamage ? k * 138 + a * 42 + total * (12 + Math.floor(rand() * 14)) : null, head, body, leg,
      casts: { q: total + Math.floor(rand() * total), e: Math.floor(total * 0.8 + rand() * total), c: Math.floor(total * 0.6 + rand() * 6), x: 1 + Math.floor(rand() * 4) },
      econ: { buyTotal, buyAvg: Math.round((100 * buyTotal) / total) / 100, spentTotal: Math.round(buyTotal * 0.92), spentAvg: Math.round((92 * buyTotal) / total) / 100 } };
  });
  return {
    fakeMatchId: `fake-match-ref-${id}`, map: { code: map.code, label: map.label }, queue, act: index < 36 ? 'v26a4' : 'v26a5',
    startedAtEpochMs: Date.UTC(2026, 6, 1, 19, 0, 0) + index * 21 * 3_600_000 + (index % 3) * 37 * 60_000,
    lengthSeconds: 900 + total * 95, score, players, rounds, killLog,
  };
}

export const FAKE_MATCH_COUNT = 72;
export const FAKE_MATCHES: readonly FakeMatchPayload[] = Array.from({ length: FAKE_MATCH_COUNT }, (_, i) => buildMatch(i));

/** Markers that must NEVER appear in public snapshots or the web bundle (used by check:privacy and tests). */
export const PRIVATE_FIXTURE_MARKERS: readonly string[] = ['fake-puuid-', 'fake-match-ref-', '#DEMO', 'FAKE-PROVIDER-SECRET'];

/** Every raw coordinate in the fixture (must never appear in any public output). */
export function fixtureCoordinates(): number[] {
  return FAKE_MATCHES.flatMap((m) => [
    ...m.killLog.flatMap((k) => [k.victimPos.px, k.victimPos.py, ...k.seen.flatMap((s) => [s.pos.px, s.pos.py])]),
    ...m.rounds.flatMap((r) => [...(r.plant ? [r.plant.pos.px, r.plant.pos.py] : []), ...(r.defuse ? [r.defuse.pos.px, r.defuse.pos.py] : [])]),
  ]);
}
