// Ported from legacy `src/types/advancedMetrics.ts` (accepted, frozen at c063b52 / release 1a4c790). Algorithm body unchanged.

export type MetricEvidenceStatus = 'reconstructed' | 'derived' | 'partial' | 'unavailable';

/**
 * Event-metric rule versions the scoring engine accepts. event-metrics-v2 (round-topology-aware) keeps the exact v1
 * evidence contract; see docs/EVENT_RECONSTRUCTION_ROBUSTNESS.md.
 */
export const EVENT_METRIC_RULE_VERSIONS = ['event-metrics-v1', 'event-metrics-v2'] as const;
export function isEventMetricRuleVersion(value: unknown): boolean {
  return typeof value === 'string' && (EVENT_METRIC_RULE_VERSIONS as readonly string[]).includes(value);
}

export interface MetricCoverage {
  eligibleRounds?: number;
  reconstructedRounds?: number;
  omittedRounds?: number;
}

export interface MetricEvidence<T> {
  status: MetricEvidenceStatus;
  ruleVersion?: string;
  value?: T;
  coverage?: MetricCoverage;
}

export type ClutchOpponentCount = 1 | 2 | 3 | 4 | 5;
export type ClutchBreakdown = Record<ClutchOpponentCount, number>;

export interface TradeMetrics {
  tradeKills: number;
  tradedDeaths: number;
  tradeAssists: number;
  deathsEligibleForTrade: number;
  tradeKillEvents: number;
}

export interface KastMetrics {
  qualifiedRounds: number;
  eligibleRounds: number;
  rate: number;
  survivedRounds?: number;
}

export interface OpeningMetrics { firstKills: number; firstDeaths: number }

export interface ClutchMetrics {
  clutchAttempts: number;
  clutchWins?: number;
  attemptsByOpponents: ClutchBreakdown;
  winsByOpponents?: ClutchBreakdown;
}

export interface ObjectiveMetrics { plants: number; defuses: number }

export interface AbilityCastMetrics {
  ability1Casts: number;
  ability2Casts: number;
  grenadeCasts: number;
  ultimateCasts: number;
}

export interface EconomyMetrics {
  loadoutValueTotal: number;
  loadoutValueAverage: number;
  spentTotal: number;
  spentAverage: number;
  damage: number;
  kills: number;
  damagePer1000SpentStatus: 'derived' | 'unavailable';
  damagePer1000Spent?: number;
  killsPer1000SpentStatus: 'derived' | 'unavailable';
  killsPer1000Spent?: number;
}

export interface ImpactContextMetrics {
  openingKills: number;
  tradeKills: number;
  manDisadvantageKills: number;
  clutchStateKills: number;
  multiKillRounds: number;
  twoKillRounds: number;
  threePlusKillRounds: number;
  roundWonKills: number;
}

export interface RoleValueInputs {
  available: Array<'agent' | 'assists' | 'damage' | 'objectives' | 'tradeAssists' | 'kast' | 'survival' | 'abilityCasts'>;
  unavailable: Array<'utilityEffects'>;
}

export interface AdvancedMetrics {
  ruleVersion: string;
  coverage: MetricCoverage;
  evidence: {
    trade: MetricEvidenceStatus;
    clutch: MetricEvidenceStatus;
    objectives: MetricEvidenceStatus;
    abilityCasts: MetricEvidenceStatus;
    economy: MetricEvidenceStatus;
    impactContext: MetricEvidenceStatus;
    roleValueInputs: MetricEvidenceStatus;
  };
  trade?: Partial<TradeMetrics>;
  clutch?: Partial<Omit<ClutchMetrics, 'attemptsByOpponents' | 'winsByOpponents'>> & {
    attemptsByOpponents?: Partial<ClutchBreakdown>;
    winsByOpponents?: Partial<ClutchBreakdown>;
  };
  objectives?: Partial<ObjectiveMetrics>;
  abilityCasts?: Partial<AbilityCastMetrics>;
  economy?: Partial<EconomyMetrics> & Pick<EconomyMetrics, 'damagePer1000SpentStatus' | 'killsPer1000SpentStatus'>;
  impactContext?: Partial<ImpactContextMetrics>;
}
