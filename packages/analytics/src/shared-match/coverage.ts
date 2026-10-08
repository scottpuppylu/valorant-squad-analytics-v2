// Ported from legacy `src/analytics/sharedMatch/coverage.ts` (accepted, frozen at c063b52 / release 1a4c790). Algorithm body unchanged.
import type { PairMatchEvidence } from './pairEvidence.ts';

/**
 * Direct pair coverage graph. Only DIRECT shared matches count; indirect paths (A↔B↔C) are never turned into
 * A↔C evidence here (a later task may use them, explicitly labelled as inferred).
 */
export interface PairCoverage { a: string; b: string; shared: number; competitive: number; unrated: number; sameTeam: number; opposingTeam: number }

export function pairCoverage(memberIds: readonly string[], pairs: readonly PairMatchEvidence[]): PairCoverage[] {
  const ids = [...new Set(memberIds)].sort();
  const cells = new Map<string, PairCoverage>();
  for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) {
    cells.set(`${ids[i]}|${ids[j]}`, { a: ids[i]!, b: ids[j]!, shared: 0, competitive: 0, unrated: 0, sameTeam: 0, opposingTeam: 0 });
  }
  const seen = new Set<string>();
  for (const pair of pairs) {
    const key = `${pair.a.memberId}|${pair.b.memberId}`;
    const unit = `${key}|${pair.matchRef}`;
    const cell = cells.get(key);
    if (!cell || seen.has(unit)) continue;
    seen.add(unit);
    cell.shared += 1;
    if (pair.mode === 'Competitive') cell.competitive += 1; else cell.unrated += 1;
    if (pair.sameTeam) cell.sameTeam += 1; else cell.opposingTeam += 1;
  }
  return [...cells.values()];
}

export function coverageSummary(cells: readonly PairCoverage[]) {
  const evidenced = cells.filter((cell) => cell.shared > 0).map((cell) => cell.shared).sort((x, y) => x - y);
  const median = evidenced.length ? (evidenced.length % 2 ? evidenced[(evidenced.length - 1) / 2]! : (evidenced[evidenced.length / 2 - 1]! + evidenced[evidenced.length / 2]!) / 2) : null;
  return {
    possiblePairs: cells.length,
    pairsWithShared: evidenced.length,
    pairsWithCompetitive: cells.filter((cell) => cell.competitive > 0).length,
    pairsWithUnrated: cells.filter((cell) => cell.unrated > 0).length,
    pairsWithBoth: cells.filter((cell) => cell.competitive > 0 && cell.unrated > 0).length,
    pairsWithZero: cells.filter((cell) => cell.shared === 0).length,
    min: evidenced[0] ?? null, median, mean: evidenced.length ? evidenced.reduce((s, v) => s + v, 0) / evidenced.length : null, max: evidenced.at(-1) ?? null,
    sameTeam: cells.reduce((s, c) => s + c.sameTeam, 0), opposingTeam: cells.reduce((s, c) => s + c.opposingTeam, 0),
  };
}

/** Connected components of the direct-evidence graph (edges = ≥ minShared shared matches). */
export function connectedComponents(memberIds: readonly string[], cells: readonly PairCoverage[], minShared = 1): string[][] {
  const parent = new Map(memberIds.map((id) => [id, id]));
  const find = (id: string): string => (parent.get(id) === id ? id : find(parent.get(id)!));
  for (const cell of cells) if (cell.shared >= minShared) parent.set(find(cell.a), find(cell.b));
  const groups = new Map<string, string[]>();
  for (const id of memberIds) groups.set(find(id), [...(groups.get(find(id)) ?? []), id]);
  return [...groups.values()];
}
