// Ported from legacy `src/analytics/scope/policies.ts` (accepted, frozen at c063b52 / release 1a4c790). Algorithm body unchanged.
import type { GameMode } from '../../event/matchViewTypes.ts';
import type { FeatureId, ScopeKind } from './types.ts';
import { FEATURE_SCOPE_POLICY_VERSION } from './versions.ts';
import { eligibleModesFor } from '../modeEligibility.ts';

/** mode-eligibility-policy-v1: absolute strength = Competitive only; browsing = every tracked mode. */
const STRENGTH = eligibleModesFor('ABSOLUTE_STRENGTH') as GameMode[];
const BROWSE = eligibleModesFor('BROWSE_HISTORY') as 'all';

export interface WindowBounds {
  minMatches: number;
  minRounds: number;
  /** Sample targets; reaching both (with minActiveDays) completes the window. */
  targetMatches: number;
  targetRounds: number;
  maxMatches: number;
  minActiveDays: number;
  targetActiveDays: number;
  /** Once the minimum is met, do not stretch a window across more calendar days than this. */
  maxSpanDays: number;
  /** Observations older than this (from the anchor / window start) are ineligible. */
  maxLookbackDays: number;
  /** Newest selected evidence within this many days of the anchor counts as fully fresh. */
  freshDays: number;
}

export interface BaselineBounds {
  minMatches: number;
  /** Baseline must reach at least this fraction of the selected current rounds (comparable sample). */
  minRoundsRatio: number;
  minRounds: number;
  targetRounds: number;
  maxMatches: number;
  maxLookbackDays: number;
  crossSeason: boolean;
}

export type Implementation = 'wired' | 'declared' | 'design_only';

export interface FeatureScopePolicy {
  feature: FeatureId;
  label: string;
  horizon: ScopeKind;
  /** Product rationale; documented in ANALYTICS_SCOPES.md. */
  why: string;
  queues: 'all' | GameMode[];
  window?: WindowBounds;
  baseline?: BaselineBounds;
  fixedRecentMatches?: number;
  rankContext: 'unused' | 'optional';
  crossSeason: boolean;
  weighting: 'uniform';
  fallback: 'none' | 'extend_within_bounds';
  confidence: string;
  implementation: Implementation;
}

const currentStrengthWindow: WindowBounds = {
  minMatches: 5, minRounds: 100, targetMatches: 30, targetRounds: 600, maxMatches: 50,
  minActiveDays: 2, targetActiveDays: 5, maxSpanDays: 60, maxLookbackDays: 120, freshDays: 14,
};

const recentFormWindow: WindowBounds = {
  minMatches: 3, minRounds: 60, targetMatches: 5, targetRounds: 120, maxMatches: 10,
  minActiveDays: 2, targetActiveDays: 3, maxSpanDays: 21, maxLookbackDays: 60, freshDays: 14,
};

/** improvement-index-v1 current window: a recent Competitive regime of ~200 rounds (product calibration). */
const improvementWindow: WindowBounds = {
  minMatches: 5, minRounds: 100, targetMatches: 10, targetRounds: 200, maxMatches: 30,
  minActiveDays: 2, targetActiveDays: 4, maxSpanDays: 45, maxLookbackDays: 90, freshDays: 14,
};

/**
 * feature-scope-policy-v3 (v2 + mode-eligibility-policy-v1 queues). The ONLY place that decides which evidence a feature uses.
 * Score formulas (community-score-v2, duo-synergy-v1) are unchanged; only populations are declared here.
 */
export const featureScopePolicies: Record<FeatureId, FeatureScopePolicy> = {
  matchHistory: { feature: 'matchHistory', label: '對戰紀錄', horizon: 'LIFETIME', why: '瀏覽全部已追蹤戰績（所有模式）；分頁只影響載入量，不影響分析。',
    queues: BROWSE, rankContext: 'unused', crossSeason: true, weighting: 'uniform', fallback: 'none', confidence: '不適用（描述性）', implementation: 'wired' },
  lifetimeTotals: { feature: 'lifetimeTotals', label: '全部已追蹤排位', horizon: 'LIFETIME', why: '長期累積描述，僅排位（競技）模式；不是 Riot 生涯總計。',
    queues: STRENGTH, rankContext: 'unused', crossSeason: true, weighting: 'uniform', fallback: 'none', confidence: '社群分數既有樣本信心', implementation: 'wired' },
  agentStats: { feature: 'agentStats', label: '特務統計', horizon: 'LIFETIME', why: '特務是情境篩選，與時間範圍正交。',
    queues: STRENGTH, rankContext: 'unused', crossSeason: true, weighting: 'uniform', fallback: 'none', confidence: '出賽與回合數', implementation: 'wired' },
  mapStats: { feature: 'mapStats', label: '地圖統計', horizon: 'LIFETIME', why: '地圖是情境篩選，與時間範圍正交。',
    queues: STRENGTH, rankContext: 'unused', crossSeason: true, weighting: 'uniform', fallback: 'none', confidence: '出賽與回合數', implementation: 'wired' },
  actOverview: { feature: 'actOverview', label: '指定 Act', horizon: 'ACT', why: '只用具有該 Act 證據的對戰；缺少 Act 證據時不得改用全部已追蹤。',
    queues: STRENGTH, rankContext: 'unused', crossSeason: false, weighting: 'uniform', fallback: 'none', confidence: '社群分數既有樣本信心；Act 證據不足時為 unavailable', implementation: 'wired' },
  currentStrength: { feature: 'currentStrength', label: '目前實力', horizon: 'ADAPTIVE',
    why: '社群排名的預設人口：最近、同一規則、僅競技模式；依回合、活躍天數與時間跨度決定區間，不只看場數。',
    queues: STRENGTH, window: currentStrengthWindow, rankContext: 'optional', crossSeason: false, weighting: 'uniform',
    fallback: 'extend_within_bounds', confidence: '區間信心（樣本×時間×證據）與社群分數信心分開呈現；低於最低樣本者分列為資料不足', implementation: 'wired' },
  recentForm: { feature: 'recentForm', label: '近期狀態', horizon: 'ADAPTIVE',
    why: '近期進退需要互不重疊的現況與基準區間；沿用既有 Overall 差值與 ±2 門檻，只改變選樣方式。',
    queues: STRENGTH, window: recentFormWindow,
    baseline: { minMatches: 3, minRoundsRatio: 0.75, minRounds: 60, targetRounds: 120, maxMatches: 30, maxLookbackDays: 180, crossSeason: true },
    rankContext: 'optional', crossSeason: false, weighting: 'uniform', fallback: 'extend_within_bounds',
    confidence: '兩個區間的樣本、時間與證據信心；任一區間不足即為樣本不足', implementation: 'wired' },
  fixedRecent: { feature: 'fixedRecent', label: '最近 N 場排位', horizon: 'RECENT', why: '使用者明示的固定場數篩選（只計排位，跳過一般／娛樂模式）；與自適應區間並存，不代表近期狀態或進步。',
    queues: STRENGTH, rankContext: 'unused', crossSeason: true, weighting: 'uniform', fallback: 'none', confidence: '社群分數既有樣本信心', implementation: 'wired' },
  trends: { feature: 'trends', label: '最近對戰走勢', horizon: 'RECENT', fixedRecentMatches: 6, why: '逐場描述最新六場符合資格的排位，不計分。',
    queues: STRENGTH, rankContext: 'unused', crossSeason: true, weighting: 'uniform', fallback: 'none', confidence: '不適用（逐場描述）', implementation: 'declared' },
  synergy: { feature: 'synergy', label: '搭檔分析', horizon: 'PAIR',
    why: '共同同隊樣本與各自其他場次基準使用同一個明示情境（全部已追蹤排位、指定 Act 或日期／地圖）；duo-synergy-v1 比較不同場次的 Overall，因此只用排位。',
    queues: STRENGTH, rankContext: 'unused', crossSeason: true, weighting: 'uniform', fallback: 'none', confidence: 'duo-synergy-v1 既有信心公式', implementation: 'wired' },
  improvementIndex: { feature: 'improvementIndex', label: '進步指數', horizon: 'ADAPTIVE',
    why: '現況與嚴格更早、不重疊、樣本可比的基準比較；先找同 Act 基準，不足時才明示改用前一個 Act（improvement-index-v1）。',
    queues: STRENGTH, window: improvementWindow,
    // Same-Act first. The progress module retries with crossSeason=true only as an explicit, disclosed fallback.
    baseline: { minMatches: 5, minRoundsRatio: 0.8, minRounds: 100, targetRounds: 200, maxMatches: 60, maxLookbackDays: 180, crossSeason: false },
    rankContext: 'optional', crossSeason: false, weighting: 'uniform', fallback: 'extend_within_bounds',
    confidence: '樣本×時間×證據×可比性，與指數數值分開（見 PROGRESS_INDEX.md）', implementation: 'wired' },
};

export const featureScopePolicyVersion = FEATURE_SCOPE_POLICY_VERSION;

export function policyFor(feature: FeatureId): FeatureScopePolicy {
  return featureScopePolicies[feature];
}
