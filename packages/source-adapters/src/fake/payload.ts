/**
 * The FAKE provider's own payload shape. Deliberately provider-style (its own field names) so the adapter boundary is
 * real: these types must never be imported outside this adapter (enforced by `npm run check:architecture`).
 */
export interface FakePos { px: number; py: number; facing: number }

export interface FakeKill {
  round: number;
  ms: number;
  killerPuuid: string;
  victimPuuid: string;
  assistPuuids: string[];
  victimPos: FakePos;
  /** Positions of other players alive at the kill (never the victim). */
  seen: { puuid: string; pos: FakePos }[];
}

export interface FakeRoundLine { puuid: string; k: number; pts: number; buy: number; bank: number; gun: { code: string; label: string } }

export interface FakeRound {
  n: number;
  winner: 'red' | 'blue';
  attacker: 'red' | 'blue';
  how: 'Elimination' | 'Bomb detonated' | 'Bomb defused' | 'Round timer expired';
  plant: { site: string; puuid: string; ms: number; pos: FakePos } | null;
  defuse: { puuid: string; ms: number; pos: FakePos } | null;
  lines: FakeRoundLine[];
}

export interface FakePlayerLine {
  fakePuuid: string;
  side: 'red' | 'blue';
  agent: { code: string; label: string };
  k: number;
  d: number;
  a: number;
  pts: number;
  /** null = this payload has no damage evidence. */
  dmg: number | null;
  head: number; body: number; leg: number;
  casts: { q: number; e: number; c: number; x: number };
  econ: { buyTotal: number; buyAvg: number; spentTotal: number; spentAvg: number };
}

export interface FakeMatchPayload {
  fakeMatchId: string;
  map: { code: string; label: string };
  queue: 'competitive' | 'unrated' | 'swiftplay';
  act: string;
  startedAtEpochMs: number;
  lengthSeconds: number;
  score: { red: number; blue: number };
  players: FakePlayerLine[];
  rounds: FakeRound[];
  killLog: FakeKill[];
}

export interface FakeAccount {
  handle: string;
  fakePuuid: string;
  tierId: number;
  tierName: string;
}
