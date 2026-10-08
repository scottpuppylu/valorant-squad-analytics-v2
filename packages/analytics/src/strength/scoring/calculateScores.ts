// Ported from legacy `src/scoring/calculateScores.ts` (accepted, frozen at c063b52 / release 1a4c790). Algorithm body unchanged; buildPlayerAnalytics (legacy page helper) not ported.
import type { MatchRecord, MatchPerformance, Player, PlayerScores, PlayerRole, RawPlayerStats } from '../../event/matchViewTypes.ts';
import { isEventMetricRuleVersion, type MetricEvidenceStatus } from '../../event/advancedMetricTypes.ts';
import { aggregateAdvancedMetrics } from '../../event/aggregateAdvancedMetrics.ts';
import { agentRoles } from '../../agents/agentCatalog.ts';
import { standardDeviation } from '../../basic/number.ts';
import { benchmarkFor, type ComponentMetric } from './benchmarks.ts';
import { normalizeBenchmark } from './normalize.ts';
import { categoryMetricWeights, roleWeights, type MetricWeight } from './weights.ts';
import { defaultProfile, validateProfile } from './profiles.ts';
import { dimensionResult, calculateConfidence } from './components.ts';
import { dimensions, SCORING_RULE_VERSION, BENCHMARK_VERSION } from './versions.ts';
import type { Dimension } from './versions.ts';
import type { ComponentTrace, ScoreResult, ScoringProfile } from './types.ts';

export { calculateConfidence } from './components.ts';

interface Entry { performance: MatchPerformance; rounds: number; role?: PlayerRole }
interface Observation { value?: number; denominator: number; coverage: number; status: string; reason?: string; events?: number }
const complete = (status: MetricEvidenceStatus) => status === 'derived' || status === 'reconstructed';
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const sum = (values: number[]) => values.reduce((total,value) => total+value,0);

function observe(metric: ComponentMetric, entries: Entry[]): Observation {
  const totalRounds = sum(entries.map((entry) => entry.rounds));
  let eligible = entries;
  let value: number | undefined;
  let denominator = totalRounds;
  let events: number | undefined;
  const core = ['acs','adr','kd','kpr','apr','kast','firstKillsPerRound','fdpr'].includes(metric);
  if (core) {
    const field = metric === 'firstKillsPerRound' ? 'firstKills' : metric === 'fdpr' ? 'firstDeaths'
      : metric === 'kd' || metric === 'kpr' ? 'kills' : metric === 'apr' ? 'assists' : metric;
    eligible = entries.filter(({performance,rounds}) => rounds > 0 && finite(performance[field as keyof MatchPerformance])
      && (metric !== 'kd' || finite(performance.deaths))
      && (!performance.eventEvidence || !['kast','firstKillsPerRound','fdpr'].includes(metric)
        || performance.eventEvidence[metric === 'kast' ? 'kast' : 'opening'] === 'reconstructed')
      && (!['kast','firstKillsPerRound','fdpr'].includes(metric) || !performance.advancedMetrics
        || isEventMetricRuleVersion(performance.advancedMetrics.ruleVersion) && performance.advancedMetrics.coverage.eligibleRounds === rounds && performance.advancedMetrics.coverage.reconstructedRounds === rounds && performance.advancedMetrics.coverage.omittedRounds === 0));
    denominator = sum(eligible.map((entry) => entry.rounds));
    const counts = sum(eligible.map(({performance}) => performance[field as keyof MatchPerformance] as number));
    if (denominator > 0) {
      if (metric === 'kd') { const deaths = sum(eligible.map(({performance}) => performance.deaths)); value = deaths > 0 ? counts/deaths : undefined; denominator = deaths; }
      else if (metric === 'acs' || metric === 'adr' || metric === 'kast') value = sum(eligible.map(({performance,rounds}) => (performance[field as keyof MatchPerformance] as number)*rounds))/denominator;
      else value = counts/denominator;
    }
  } else {
    const domain = ['tradeKills','tradeAssists'].includes(metric) ? 'trade'
      : ['disadvantage','clutchState','multiKill','wonKills'].includes(metric) ? 'impactContext'
      : ['shrunkClutch','difficultWins'].includes(metric) ? 'clutch'
      : metric === 'objectives' ? 'objectives' : 'economy';
    eligible = entries.filter(({performance,rounds}) => {
      const advanced = performance.advancedMetrics;
      return advanced !== undefined && isEventMetricRuleVersion(advanced.ruleVersion) && complete(advanced.evidence[domain])
        && advanced.coverage.eligibleRounds === rounds
        && (domain === 'economy' || domain === 'objectives'
          || advanced.coverage.reconstructedRounds === rounds && advanced.coverage.omittedRounds === 0);
    });
    denominator = sum(eligible.map((entry) => entry.rounds));
    const advanced = aggregateAdvancedMetrics(eligible.map((entry) => entry.performance));
    if (!complete(advanced[domain].status)) eligible = [];
    if (eligible.length === 0) { value=undefined; }
    else if (domain === 'trade') {
      const count = metric === 'tradeKills' ? advanced.trade.value?.tradeKills : advanced.trade.value?.tradeAssists;
      if (count !== undefined && denominator > 0) value = count/denominator;
    } else if (domain === 'impactContext') {
      const key = {disadvantage:'manDisadvantageKills',clutchState:'clutchStateKills',multiKill:'multiKillRounds',wonKills:'roundWonKills'}[metric as 'disadvantage'];
      const count = advanced.impactContext.value?.[key as keyof NonNullable<typeof advanced.impactContext.value>];
      if (count !== undefined && denominator > 0) value = count/denominator;
    } else if (domain === 'objectives') {
      const objective = advanced.objectives.value;
      if (objective?.plants !== undefined && objective.defuses !== undefined && denominator > 0) value = (objective.plants+objective.defuses)/denominator;
    } else if (domain === 'clutch') {
      const clutch = advanced.clutch.value;
      events = clutch?.clutchAttempts;
      if (events !== undefined && events > 0 && clutch?.clutchWins !== undefined && clutch.clutchWins <= events) {
        if (metric === 'shrunkClutch') { value=(clutch.clutchWins+1)/(events+5); denominator=events; }
        else if (clutch.winsByOpponents && denominator > 0) value=sum(([1,2,3,4,5] as const).map((n) => clutch.winsByOpponents![n]*(1+(n-1)*.25)))/denominator;
      }
    } else {
      // Positive-spend tuples must align; a missing numerator cannot become zero.
      eligible = eligible.filter(({performance}) => {
        const economy=performance.advancedMetrics?.economy;
        return finite(economy?.spentTotal) && economy.spentTotal > 0 && finite(metric === 'damageEfficiency' ? economy.damage : economy.kills)
          && (metric === 'damageEfficiency' ? economy.damagePer1000SpentStatus === 'derived' : economy.killsPer1000SpentStatus === 'derived');
      });
      const economy=aggregateAdvancedMetrics(eligible.map((entry) => entry.performance)).economy.value;
      denominator=economy?.spentTotal ?? 0;
      value=metric === 'damageEfficiency' ? economy?.damagePer1000Spent : economy?.killsPer1000Spent;
      events=eligible.length;
    }
  }
  const observedRounds = sum(eligible.map((entry) => entry.rounds));
  const coverage = totalRounds > 0 ? observedRounds/totalRounds : 0;
  const usable=finite(value) && coverage+1e-12 >= .7;
  return { ...(usable ? {value} : {}), denominator,coverage,status:coverage===1 ? 'complete' : coverage>0 ? 'partial' : 'unavailable',
    ...(!usable ? {reason:coverage < .7 ? 'Observed selected-round evidence below 70%' : 'Missing evidence or invalid denominator'} : {}),events };
}
/** Trace benchmark when no role is known at all: role-free placeholder (never a guessed role; no value is computed). */
const unknownRoleBenchmark = (metric: ComponentMetric): ComponentTrace['benchmark'] => ({ metric, context:'unknown_role', poor:0, strong:0, direction:'higher', version:'unknown-role' });
function component(metric: ComponentMetric, weight: number, entries: Entry[], role: PlayerRole | undefined, roleKnown=true): ComponentTrace {
  const observation=observe(metric,entries);
  if(role===undefined) roleKnown=false;
  const benchmark=role===undefined ? unknownRoleBenchmark(metric) : benchmarkFor(metric,role);
  const rawValue=roleKnown ? observation.value : undefined;
  return {metric,selectedRole:roleKnown ? role : undefined,configuredWeight:weight,usedWeight:0,evidenceStatus:observation.status,benchmark,denominator:observation.denominator,
    observedCoverage:observation.coverage,...(rawValue!==undefined ? {rawValue,normalizedValue:normalizeBenchmark(rawValue,benchmark)} : {omissionReason:roleKnown ? observation.reason : 'Unknown selected agent role'})};
}
function consistency(entries: Entry[], sample: ScoreResult['sample']): ScoreResult {
  const valid = entries.filter(({performance,rounds}) => rounds > 0 && finite(performance.acs) && finite(performance.kast)
    && (!performance.eventEvidence || performance.eventEvidence.kast === 'reconstructed')
    && (!performance.advancedMetrics || performance.advancedMetrics.coverage.reconstructedRounds === rounds && performance.advancedMetrics.coverage.omittedRounds === 0));
  const acs=valid.map(({performance}) => performance.acs), kast=valid.flatMap(({performance}) => finite(performance.kast) ? [performance.kast] : []);
  const mean=acs.length ? sum(acs)/acs.length : 0;
  const coverage=entries.length ? valid.length/entries.length : 0;
  const rawValues: Partial<Record<ComponentMetric,number>> = valid.length>=5 && coverage>=.7 ? { ...(mean>0 ? {acsCv:standardDeviation(acs)/mean} : {}),kastSd:standardDeviation(kast)} : {};
  const traces=categoryMetricWeights.consistency.map(([metric,weight]) => {
    const benchmark=benchmarkFor(metric,'Controller'), rawValue=rawValues[metric];
    return {metric,configuredWeight:weight,usedWeight:0,evidenceStatus:coverage===1 ? 'complete':'partial',benchmark,denominator:valid.length,observedCoverage:coverage,
      ...(rawValue!==undefined ? {rawValue,normalizedValue:normalizeBenchmark(rawValue,benchmark)}:{omissionReason:'At least five valid observations required'})};
  });
  return dimensionResult('consistency',traces,{...sample,relevantEvents:valid.length},valid.length<10 || coverage<1);
}
export function overallResult(scores: Record<Dimension,ScoreResult>, sample: ScoreResult['sample'], profileInput: ScoringProfile=defaultProfile): ScoreResult {
  const profile=validateProfile(profileInput);
  const numeric=dimensions.filter((key) => scores[key].value!==undefined);
  const availableWeight=sum(numeric.map((key) => profile.weights[key]));
  const allowed=numeric.length>=6 && availableWeight+1e-12>=.75;
  const coverageFactor=sum(numeric.map((key) => profile.weights[key]*(scores[key].coverage.observedRatio ?? scores[key].coverage.ratio)));
  return {status:!allowed ? 'unavailable':numeric.length===8 && dimensions.every((key) => scores[key].status==='available') ? 'available':'partial',
    ...(allowed ? {value:sum(numeric.map((key) => scores[key].value!*profile.weights[key]))/availableWeight}:{}),
    coverage:{availableWeight,requiredWeight:1,ratio:availableWeight,observedRatio:coverageFactor},sample,confidence:calculateConfidence(sample.matches,sample.rounds,coverageFactor),
    ruleVersion:SCORING_RULE_VERSION,benchmarkVersion:BENCHMARK_VERSION,
    trace:{dimension:'overall',components:[],profileVersion:profile.version,
      dimensions:dimensions.map((dimension) => ({dimension,configuredWeight:profile.weights[dimension],usedWeight:allowed && scores[dimension].value!==undefined ? profile.weights[dimension]/availableWeight:0,status:scores[dimension].status,value:scores[dimension].value,coverage:scores[dimension].coverage.ratio})),
      ...(!allowed ? {omissionReason:'Overall requires six dimensions and 75% configured weight'}:{})}};
}
export function compareScoreResults(a: ScoreResult,b: ScoreResult): number {
  const priority={available:0,partial:1,unavailable:2};
  return priority[a.status]-priority[b.status] || (b.value ?? -Infinity)-(a.value ?? -Infinity) || 0;
}
/** `roles` defaults to the canonical agent catalog; frozen evidence versions (shared-match-evidence-v1) pass their own. */
export function calculatePlayerScores(player: Player, _stats: RawPlayerStats, matches: MatchRecord[], profile: ScoringProfile=defaultProfile,
  options: { roles?: Readonly<Record<string, PlayerRole>> } = {}): PlayerScores {
  const roles=options.roles ?? agentRoles;
  const entries: Entry[]=matches.flatMap((match) => match.performances.filter((performance) => performance.playerId===player.id).map((performance) => ({performance,rounds:match.scoreFor+match.scoreAgainst,role:roles[performance.agent]})));
  const sample={matches:entries.length,rounds:sum(entries.map((entry) => entry.rounds))};
  const groups=new Map<PlayerRole|undefined,Entry[]>();
  for(const entry of entries) groups.set(entry.role,[...(groups.get(entry.role) ?? []),entry]);
  const roleRounds=Object.fromEntries([...groups].filter(([role]) => role!==undefined).map(([role,values]) => [role,sum(values.map((entry) => entry.rounds))])) as Partial<Record<PlayerRole,number>>;
  const dominant=(Object.entries(roleRounds).sort((a,b) => b[1]!-a[1]! || a[0].localeCompare(b[0]))[0]?.[0] as PlayerRole|undefined) ?? player.role;
  const scores={} as Record<Dimension,ScoreResult>;
  for(const dimension of dimensions) {
    if(dimension==='consistency') {scores[dimension]=consistency(entries,sample);continue;}
    const traces:ComponentTrace[]=[];
    for(const [role,values] of groups) {
      const selected=role ?? dominant;
      const weights:readonly MetricWeight[]=dimension==='roleValue' ? (selected ? roleWeights[selected] : []) : categoryMetricWeights[dimension];
      const fraction=sample.rounds>0 ? sum(values.map((entry) => entry.rounds))/sample.rounds : 0;
      traces.push(...weights.map(([metric,weight]) => component(metric,weight*fraction,values,role ?? dominant,role!==undefined)));
    }
    // Preserve configured denominator even for an empty selection.
    if(!groups.size) {
      const weights=dimension==='roleValue' ? (dominant ? roleWeights[dominant] : []) : categoryMetricWeights[dimension];
      traces.push(...weights.map(([metric,weight]) => component(metric,weight,[],dominant)));
    }
    const relevant=dimension==='clutch' ? observe('shrunkClutch',entries).events : dimension==='economy' ? observe('damageEfficiency',entries).events : undefined;
    scores[dimension]=dimensionResult(dimension,traces,{...sample,...(relevant!==undefined ? {relevantEvents:relevant}:{})});
    scores[dimension].trace.selectedRole=dominant;
    scores[dimension].trace.roles=roleRounds;
    if(dimension==='clutch') {
      const completeEntries=entries.filter(({performance,rounds}) => {
        const advanced=performance.advancedMetrics;
        return advanced !== undefined && isEventMetricRuleVersion(advanced.ruleVersion) && complete(advanced.evidence.clutch) && advanced.coverage.eligibleRounds===rounds && advanced.coverage.reconstructedRounds===rounds && advanced.coverage.omittedRounds===0;
      });
      const clutch=aggregateAdvancedMetrics(completeEntries.map(({performance}) => performance)).clutch.value;
      if(clutch?.clutchAttempts && clutch.clutchWins!==undefined) scores[dimension].trace.prior={mean:.20,strength:5,wins:clutch.clutchWins,attempts:clutch.clutchAttempts,rawConversion:clutch.clutchWins/clutch.clutchAttempts,shrunkConversion:(clutch.clutchWins+1)/(clutch.clutchAttempts+5)};
    }
    if(dimension==='roleValue') {
      const casts=aggregateAdvancedMetrics(entries.map(({performance}) => performance)).abilityCasts.value;
      scores[dimension].trace.context=casts ? {abilityCasts:sum(Object.values(casts).filter(finite))}:{};
    }
    if(dimension==='economy') scores[dimension].trace.context={positiveSpendObservations:relevant ?? 0};
  }
  const overall=overallResult(scores,sample,profile);
  return {...scores,overall,confidence:overall.confidence};
}
