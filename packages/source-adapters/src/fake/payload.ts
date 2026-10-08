/**
 * The FAKE provider's own payload shape. Deliberately provider-style (its own field names) so the adapter boundary is
 * real: these types must never be imported outside this adapter (enforced by `npm run check:architecture`).
 */
export interface FakeKill {
  round: number;
  ms: number;
  killerPuuid: string;
  victimPuuid: string;
  assistPuuids: string[];
  victimPos: { px: number; py: number; facing: number };
}

export interface FakePlayerLine {
  fakePuuid: string;
  side: 'red' | 'blue';
  agent: { code: string; label: string };
  k: number;
  d: number;
  a: number;
  /** null = this payload has no damage evidence. */
  dmg: number | null;
}

export interface FakeMatchPayload {
  fakeMatchId: string;
  map: { code: string; label: string };
  queue: 'competitive' | 'unrated' | 'deathmatch';
  startedAtEpochMs: number;
  lengthSeconds: number;
  score: { red: number; blue: number };
  players: FakePlayerLine[];
  roundResults: { n: number; winner: 'red' | 'blue'; attacker: 'red' | 'blue' }[];
  killLog: FakeKill[];
}

export interface FakeAccount {
  handle: string;
  fakePuuid: string;
  tierId: number;
  tierName: string;
}
