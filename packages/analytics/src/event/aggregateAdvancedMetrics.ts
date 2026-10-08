// Ported from legacy `src/analytics/advancedMetrics.ts` (accepted, frozen at c063b52 / release 1a4c790). Algorithm body unchanged.
import type { MetricCoverage, MetricEvidence, MetricEvidenceStatus, TradeMetrics, KastMetrics, ClutchMetrics, ObjectiveMetrics, AbilityCastMetrics, EconomyMetrics, ImpactContextMetrics, AdvancedMetrics } from './advancedMetricTypes.ts';
import type { MatchPerformance } from './matchViewTypes.ts';

export interface AggregatedAdvancedMetrics {
  ruleVersion?: string; coverage: MetricCoverage;
  trade: MetricEvidence<Partial<TradeMetrics>>; kast: MetricEvidence<KastMetrics>;
  clutch: MetricEvidence<Partial<ClutchMetrics>>; objectives: MetricEvidence<Partial<ObjectiveMetrics>>;
  abilityCasts: MetricEvidence<Partial<AbilityCastMetrics>>; economy: MetricEvidence<Partial<EconomyMetrics>>;
  impactContext: MetricEvidence<Partial<ImpactContextMetrics>>;
}
type Domain = keyof AdvancedMetrics['evidence'];
const complete = (status: MetricEvidenceStatus) => status === 'derived' || status === 'reconstructed';
export function aggregateAdvancedMetrics(performances: MatchPerformance[]): AggregatedAdvancedMetrics {
  const inputs = performances.flatMap((performance) => performance.advancedMetrics ? [{ performance, advanced: performance.advancedMetrics }] : []);
  const ruleVersion = inputs[0]?.advanced.ruleVersion;
  const unavailable = { status: 'unavailable' as const };
  if (!ruleVersion || inputs.some(({advanced}) => advanced.ruleVersion !== ruleVersion)) return { coverage:{},trade:unavailable,kast:unavailable,clutch:unavailable,objectives:unavailable,abilityCasts:unavailable,economy:unavailable,impactContext:unavailable };
  const coverage = inputs.reduce<Required<MetricCoverage>>((sum,{advanced}) => ({
    eligibleRounds:sum.eligibleRounds+(advanced.coverage.eligibleRounds ?? 0),
    reconstructedRounds:sum.reconstructedRounds+(advanced.coverage.reconstructedRounds ?? 0),
    omittedRounds:sum.omittedRounds+(advanced.coverage.omittedRounds ?? 0),
  }),{eligibleRounds:0,reconstructedRounds:0,omittedRounds:0});
  function domain<T>(key: Domain, fields: readonly string[]): MetricEvidence<Partial<T>> {
    const values = inputs.flatMap(({advanced}) => {
      const value = advanced[key as keyof AdvancedMetrics];
      return typeof value === 'object' && value !== null || complete(advanced.evidence[key]) ? [{ value:(value ?? {}) as Record<string,unknown>, status:advanced.evidence[key] }] : [];
    });
    const result: Record<string,number> = {};
    const invalid = values.some(({value}) => fields.some((field) => field in value && (typeof value[field] !== 'number' || !Number.isFinite(value[field]) || (value[field] as number) < 0)));
    for (const field of fields) {
      const observed = values.flatMap(({value,status}) => typeof value[field] === 'number' && Number.isFinite(value[field]) && (value[field] as number) >= 0 ? [value[field] as number] : complete(status) && !(field in value) ? [0] : []);
      if (observed.length) result[field] = observed.reduce((sum,value) => sum+value,0);
    }
    const status = !values.length ? 'unavailable' : invalid || inputs.length !== performances.length || inputs.some(({advanced}) => !complete(advanced.evidence[key])) ? 'partial' : inputs.every(({advanced}) => advanced.evidence[key] === 'derived') ? 'derived' : 'reconstructed';
    return {status,ruleVersion,coverage,...(values.length ? {value:result as Partial<T>} : {})};
  }
  const trade = domain<TradeMetrics>('trade',['tradeKills','tradedDeaths','tradeAssists','deathsEligibleForTrade','tradeKillEvents']);
  const clutch = domain<ClutchMetrics>('clutch',['clutchAttempts']);
  const invalidClutch=inputs.some(({advanced}) => {
    const value=advanced.clutch;
    return [value?.clutchWins,...Object.values(value?.attemptsByOpponents ?? {}),...Object.values(value?.winsByOpponents ?? {})].some((count)=>count !== undefined && (!Number.isFinite(count) || count < 0));
  });
  if (invalidClutch) clutch.status='partial';
  if (clutch.value) {
    const sumBreakdown = (key:'attemptsByOpponents'|'winsByOpponents') => Object.fromEntries([1,2,3,4,5].map((n) => [n,inputs.reduce((sum,{advanced}) => sum+(advanced.clutch?.[key]?.[n as 1|2|3|4|5] ?? 0),0)])) as ClutchMetrics['attemptsByOpponents'];
    // Partial breakdowns are not silently completed with zeros.
    if (!invalidClutch && inputs.every(({advanced}) => complete(advanced.evidence.clutch))) {
      clutch.value.clutchWins = inputs.reduce((sum,{advanced}) => sum+(advanced.clutch?.clutchWins ?? 0),0);
      clutch.value.attemptsByOpponents = sumBreakdown('attemptsByOpponents');
      const winsByOpponents=sumBreakdown('winsByOpponents');
      // A positive win total cannot prove a missing difficulty distribution is zero.
      if (Object.values(winsByOpponents).reduce((sum,n)=>sum+n,0) === clutch.value.clutchWins) clutch.value.winsByOpponents=winsByOpponents;
    }
  }
  const economy = domain<EconomyMetrics>('economy',['loadoutValueTotal','spentTotal','damage','kills']);
  if (economy.value) {
    const allComplete = inputs.length === performances.length && inputs.every(({advanced}) => complete(advanced.evidence.economy) && advanced.economy !== undefined);
    const average = (key:'loadoutValueAverage'|'spentAverage') => {
      const observed = inputs.filter(({advanced}) => advanced.economy?.[key] !== undefined || complete(advanced.evidence.economy) && advanced.economy !== undefined);
      const denominator = observed.reduce((sum,{advanced}) => sum+(advanced.coverage.eligibleRounds ?? 0),0);
      return denominator > 0 ? observed.reduce((sum,{advanced}) => sum+(advanced.economy?.[key] ?? 0)*(advanced.coverage.eligibleRounds ?? 0),0)/denominator : undefined;
    };
    economy.value.loadoutValueAverage = average('loadoutValueAverage');
    economy.value.spentAverage = average('spentAverage');
    const spent = economy.value.spentTotal;
    const validDamage = allComplete && inputs.every(({advanced})=>advanced.economy?.damagePer1000SpentStatus==='derived') && spent !== undefined && spent > 0 && economy.value.damage !== undefined;
    const validKills = allComplete && inputs.every(({advanced})=>advanced.economy?.killsPer1000SpentStatus==='derived') && spent !== undefined && spent > 0 && economy.value.kills !== undefined;
    economy.value.damagePer1000SpentStatus = validDamage ? 'derived' : 'unavailable';
    economy.value.killsPer1000SpentStatus = validKills ? 'derived' : 'unavailable';
    if (validDamage) economy.value.damagePer1000Spent = 1000*economy.value.damage!/spent!;
    if (validKills) economy.value.killsPer1000Spent = 1000*economy.value.kills!/spent!;
  }
  const eligible = coverage.eligibleRounds;
  const reconstructed = coverage.reconstructedRounds;
  const invalidKast = inputs.some(({performance,advanced}) => performance.kast === undefined || !Number.isFinite(performance.kast) || performance.kast<0 || performance.kast>1 || performance.eventEvidence && performance.eventEvidence.kast !== 'reconstructed' || !Number.isFinite(advanced.coverage.reconstructedRounds));
  const qualified = inputs.reduce((sum,{advanced,performance}) => sum+(performance.kast !== undefined && Number.isFinite(performance.kast) ? performance.kast : 0)*(advanced.coverage.reconstructedRounds ?? 0),0);
  const kast: MetricEvidence<KastMetrics> = {ruleVersion,coverage,status:invalidKast ? 'unavailable' : reconstructed > 0 ? coverage.omittedRounds > 0 || reconstructed < eligible || inputs.length !== performances.length ? 'partial' : 'reconstructed' : 'unavailable',
    ...(!invalidKast && reconstructed > 0 ? {value:{qualifiedRounds:qualified,eligibleRounds:reconstructed,rate:qualified/reconstructed}} : {})};
  return {ruleVersion,coverage,trade,kast,clutch,economy,
    objectives:domain<ObjectiveMetrics>('objectives',['plants','defuses']),
    abilityCasts:domain<AbilityCastMetrics>('abilityCasts',['ability1Casts','ability2Casts','grenadeCasts','ultimateCasts']),
    impactContext:domain<ImpactContextMetrics>('impactContext',['openingKills','tradeKills','manDisadvantageKills','clutchStateKills','multiKillRounds','twoKillRounds','threePlusKillRounds','roundWonKills'])};
}
