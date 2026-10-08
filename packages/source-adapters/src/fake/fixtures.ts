import type { FakeAccount, FakeKill, FakeMatchPayload, FakePlayerLine } from './payload.ts';

/**
 * Deterministic SYNTHETIC fixture: 6 fictional tracked players, 10 matches (8 competitive, 2 unrated), 4 maps.
 * No real Riot IDs, no real names. Private-looking values (fake PUUIDs, raw match refs, handles) are planted on
 * purpose so privacy checks can prove they never reach a public snapshot or the web bundle.
 */
export const FAKE_ACCOUNTS: readonly FakeAccount[] = [
  { handle: 'Nova#DEMO', fakePuuid: 'fake-puuid-0001-nova', tierId: 18, tierName: 'Diamond 1' },
  { handle: 'Rook#DEMO', fakePuuid: 'fake-puuid-0002-rook', tierId: 15, tierName: 'Platinum 1' },
  { handle: 'Vex#DEMO', fakePuuid: 'fake-puuid-0003-vex', tierId: 16, tierName: 'Platinum 2' },
  { handle: 'Kite#DEMO', fakePuuid: 'fake-puuid-0004-kite', tierId: 12, tierName: 'Gold 1' },
  { handle: 'Juno#DEMO', fakePuuid: 'fake-puuid-0005-juno', tierId: 19, tierName: 'Diamond 2' },
  { handle: 'Pike#DEMO', fakePuuid: 'fake-puuid-0006-pike', tierId: 13, tierName: 'Gold 2' },
];

const MAPS = [
  { code: 'map-ascent', label: 'Ascent' }, { code: 'map-bind', label: 'Bind' },
  { code: 'map-haven', label: 'Haven' }, { code: 'map-lotus', label: 'Lotus' },
] as const;
const AGENTS = [
  { code: 'agent-jett', label: 'Jett' }, { code: 'agent-sova', label: 'Sova' }, { code: 'agent-omen', label: 'Omen' },
  { code: 'agent-killjoy', label: 'Killjoy' }, { code: 'agent-raze', label: 'Raze' }, { code: 'agent-skye', label: 'Skye' },
  { code: 'agent-viper', label: 'Viper' }, { code: 'agent-cypher', label: 'Cypher' }, { code: 'agent-reyna', label: 'Reyna' },
  { code: 'agent-breach', label: 'Breach' },
] as const;

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
const coordinate = (rand: () => number) => 1000 + Math.floor(rand() * 8000) + (rand() < 0.5 ? 0.375 : 0.625);

function buildMatch(index: number): FakeMatchPayload {
  const rand = prng(1000 + index);
  const tracked = [0, 1, 2, 3].map((k) => FAKE_ACCOUNTS[(index + k) % FAKE_ACCOUNTS.length]!.fakePuuid);
  const blue = [...tracked, `fake-puuid-other-${String(index).padStart(2, '0')}-b5`];
  const red = [1, 2, 3, 4, 5].map((k) => `fake-puuid-other-${String(index).padStart(2, '0')}-r${k}`);
  const blueWins = index % 3 !== 2; // deterministic win/loss pattern
  const loserRounds = 5 + (index % 7);
  const score = blueWins ? { blue: 13, red: loserRounds } : { blue: loserRounds, red: 13 };
  const totalRounds = score.blue + score.red;
  // The final round goes to the match winner; the other rounds are distributed so per-round wins sum to the score.
  const roundResults: FakeMatchPayload['roundResults'] = [];
  let blueLeft = score.blue - (blueWins ? 1 : 0); let redLeft = score.red - (blueWins ? 0 : 1);
  for (let n = 1; n <= totalRounds; n += 1) {
    let winner: 'red' | 'blue';
    if (n === totalRounds) winner = blueWins ? 'blue' : 'red';
    else if (blueLeft > 0 && (redLeft === 0 || rand() < 0.55)) { winner = 'blue'; blueLeft -= 1; }
    else { winner = 'red'; redLeft -= 1; }
    roundResults.push({ n, winner, attacker: n <= 12 ? 'red' : 'blue' });
  }
  const everyone = [...blue, ...red];
  const sideOf = (puuid: string): 'red' | 'blue' => (blue.includes(puuid) ? 'blue' : 'red');
  const killLog: FakeKill[] = [];
  for (let n = 1; n <= totalRounds; n += 1) {
    for (let k = 0; k < 3; k += 1) {
      const killer = everyone[Math.floor(rand() * everyone.length)]!;
      const enemies = everyone.filter((p) => sideOf(p) !== sideOf(killer));
      const victim = enemies[Math.floor(rand() * enemies.length)]!;
      const mates = everyone.filter((p) => sideOf(p) === sideOf(killer) && p !== killer);
      const assist = rand() < 0.6 ? [mates[Math.floor(rand() * mates.length)]!] : [];
      killLog.push({ round: n, ms: 8000 + k * 9000 + Math.floor(rand() * 4000), killerPuuid: killer, victimPuuid: victim, assistPuuids: assist,
        victimPos: { px: coordinate(rand), py: coordinate(rand), facing: Math.round(rand() * 6283) / 1000 } });
    }
  }
  const hasDamage = index !== 9; // one match without damage evidence → ADR excludes it
  const players: FakePlayerLine[] = everyone.map((puuid, i) => {
    const k = killLog.filter((e) => e.killerPuuid === puuid).length;
    const d = killLog.filter((e) => e.victimPuuid === puuid).length;
    const a = killLog.filter((e) => e.assistPuuids.includes(puuid)).length;
    return { fakePuuid: puuid, side: sideOf(puuid), agent: AGENTS[(index + i) % AGENTS.length]!, k, d, a, dmg: hasDamage ? k * 142 + a * 38 + 60 * ((index + i) % 4) : null };
  });
  return {
    fakeMatchId: `fake-match-ref-${String(index + 1).padStart(4, '0')}`,
    map: MAPS[index % MAPS.length]!,
    queue: index === 4 || index === 8 ? 'unrated' : 'competitive',
    startedAtEpochMs: Date.UTC(2026, 8, 1, 18, 0, 0) + index * 26 * 3_600_000,
    lengthSeconds: 1500 + totalRounds * 45,
    score, players, roundResults, killLog,
  };
}

export const FAKE_MATCHES: readonly FakeMatchPayload[] = Array.from({ length: 10 }, (_, i) => buildMatch(i));

/** Markers that must NEVER appear in public snapshots or the web bundle (used by check:privacy and tests). */
export const PRIVATE_FIXTURE_MARKERS: readonly string[] = ['fake-puuid-', 'fake-match-ref-', '#DEMO', 'FAKE-PROVIDER-SECRET'];

/** Every raw coordinate in the fixture (must never appear in any public output). */
export function fixtureCoordinates(): number[] {
  return FAKE_MATCHES.flatMap((m) => m.killLog.flatMap((k) => [k.victimPos.px, k.victimPos.py]));
}
