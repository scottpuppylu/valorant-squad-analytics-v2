// Ported from legacy `src/scoring/benchmarks.ts` (accepted, frozen at c063b52 / release 1a4c790). Algorithm body unchanged.
import type { PlayerRole } from '../../event/matchViewTypes.ts';
import type { Benchmark } from './types.ts';
import { BENCHMARK_VERSION } from './versions.ts';

export type ScoredMetric = 'acs' | 'adr' | 'kd' | 'kpr' | 'apr' | 'kast' | 'firstKillsPerRound';
export const roleBenchmarks: Record<PlayerRole, Record<ScoredMetric, readonly [number, number]>> = {
  Duelist: { acs: [175,275], adr:[120,175], kd:[.78,1.35], kpr:[.58,.9], apr:[.12,.32], kast:[.64,.8], firstKillsPerRound:[.08,.2] },
  Initiator: { acs:[160,235], adr:[112,152], kd:[.76,1.22], kpr:[.52,.76], apr:[.24,.5], kast:[.67,.83], firstKillsPerRound:[.05,.14] },
  Controller: { acs:[150,220], adr:[108,146], kd:[.76,1.22], kpr:[.5,.72], apr:[.23,.48], kast:[.69,.85], firstKillsPerRound:[.035,.11] },
  Sentinel: { acs:[155,225], adr:[110,150], kd:[.8,1.3], kpr:[.52,.75], apr:[.14,.36], kast:[.69,.85], firstKillsPerRound:[.035,.12] },
};
// Transparent product-design calibration ranges, NOT population percentiles.
const globalRanges = {
  fdpr: [.18,.02,'lower'], disadvantage:[0,.12,'higher'], tradeKills:[0,.15,'higher'],
  clutchState:[0,.15,'higher'], multiKill:[0,.25,'higher'], wonKills:[0,.65,'higher'],
  tradeAssists:[0,.10,'higher'], objectives:[0,.15,'higher'], shrunkClutch:[.08,.80,'higher'],
  difficultWins:[0,.08,'higher'], damageEfficiency:[25,65,'higher'], killEfficiency:[.08,.32,'higher'],
  acsCv:[.40,.03,'lower'], kastSd:[.15,.01,'lower'],
} as const;
export type GlobalMetric = keyof typeof globalRanges;
export type ComponentMetric = ScoredMetric | GlobalMetric;
export function benchmarkFor(metric: ComponentMetric, role: PlayerRole): Benchmark {
  if (metric in globalRanges) {
    const [poor,strong,direction] = globalRanges[metric as GlobalMetric];
    return { metric, context:'global', poor,strong,direction,version:BENCHMARK_VERSION };
  }
  const [poor,strong] = roleBenchmarks[role][metric as ScoredMetric];
  return { metric, context:role, poor,strong,direction:'higher',version:BENCHMARK_VERSION };
}
export const benchmarkRegistry: Benchmark[] = [
  ...Object.keys(roleBenchmarks).flatMap((role) => Object.keys(roleBenchmarks[role as PlayerRole]).map((metric) => benchmarkFor(metric as ScoredMetric,role as PlayerRole))),
  ...Object.keys(globalRanges).map((metric) => benchmarkFor(metric as GlobalMetric,'Duelist')),
];
