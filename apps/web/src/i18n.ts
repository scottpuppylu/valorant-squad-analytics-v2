import type { ExplanationKey, ProductStatus, ReasonCode } from '@vsa/contracts/product';

/** User-facing Traditional Chinese labels. Presentation only: no value here changes any number. */
export const HISTORY_LABEL = '目前可追蹤紀錄';
export const HISTORY_NOTE = '資料來源目前可見的對戰紀錄，並非全部歷史；更早的對戰不在其中，也無法確認已收齊。';

export const STATUS_LABEL: Record<ProductStatus, string> = {
  available: '完整', partial: '部分證據', unavailable: '無法計算', insufficient: '證據不足',
};

export const REASON_LABEL: Record<ReasonCode, string> = {
  no_competitive_matches: '沒有競技模式對戰',
  insufficient_sample: '樣本不足',
  evidence_below_threshold: '可用證據低於門檻（70%）',
  needs_six_dimensions: '至少需要 6 個面向與 75% 權重',
  unknown_role: '特務角色未知',
  window_unavailable: '近期區間樣本不足',
  window_partial: '近期區間未達目標樣本',
  baseline_unavailable: '缺少可比較的基準區間',
  event_evidence_partial: '部分場次缺少事件證據',
  no_shared_matches: '沒有共同對戰',
  below_min_shared_matches: '共同對戰少於 5 場',
  no_rank_evidence: '沒有牌位證據',
  insufficient_role_evidence: '該角色的對戰不足 5 場',
  insufficient_side_evidence: '證據不足（該攻守方對戰少於 5 場）',
  responsibility_not_validated: '此類職責未通過時間序驗證，不顯示',
  no_agent_evidence: '有成員沒有競技模式特務紀錄',
  experimental_agent: '實驗性：此成員沒玩過該特務',
  stale_recent_evidence: '最近一場已超過 14 天',
  provider_visible_history: '僅限目前可追蹤紀錄',
  no_distinct_responsibility: '沒有明顯高於群組中位數的分工',
};

export const DIMENSION_LABEL: Record<string, string> = {
  firepower: '火力', roundImpact: '回合影響', entry: '開局', teamplay: '團隊協作', clutch: '殘局', economy: '經濟效率', consistency: '穩定度', roleValue: '角色價值',
};

export const ROLE_LABEL: Record<string, string> = { Duelist: '決鬥者', Initiator: '先鋒', Controller: '控場者', Sentinel: '哨衛' };

/** Validated responsibility labels (team-responsibility-v1 / team-composition-v2 gate). Others are never displayed. */
export const RESPONSIBILITY_LABEL: Record<string, string> = {
  PRIMARY_ENTRY: '主要突破', SECOND_ENTRY_TRADE: '二號位補槍',
  ATTACK_PRIMARY_ENTRY: '進攻：主要突破', ATTACK_SECOND_ENTRY_TRADE: '進攻：跟進補槍', ATTACK_PLANT_SUPPORT: '進攻：下包支援', ATTACK_POST_PLANT: '進攻：下包後守包',
  DEFENSE_FIRST_CONTACT: '防守：第一接觸', DEFENSE_INFO_SUPPORT: '防守：資訊支援',
};

export const RECENT_FORM_LABEL = { up: '上升', flat: '持平', down: '下降', insufficient: '樣本不足' } as const;

/** Concise explanations (what it means for the reader; no implementation internals). */
export const EXPLANATION: Record<ExplanationKey, { title: string; body: string }> = {
  'community-score': { title: '社群分數', body: '以群組內透明基準，把火力、回合影響、開局、團隊協作、殘局、經濟效率、穩定度與角色價值 8 個面向（0–100）加權合成。只用競技模式，並依特務角色使用不同基準，不會自動偏好決鬥者。不是官方牌位，也不是 MMR。' },
  'current-strength': { title: '目前實力', body: '同一套社群分數，但只看最近的一段競技對戰：依回合數、活躍天數與時間跨度自動決定區間（最多 50 場、回溯 120 天）。區間樣本不足時不給數字。' },
  'recent-form': { title: '近期狀態', body: '最近一小段區間的社群分數，減去更早且不重疊、樣本可比的基準區間；差距超過 ±2 分才標示上升或下降。' },
  'shared-match': { title: '同場比較（Shared-Match）', body: '只比較兩位成員「同一場」的表現（單場火力面向）。每場共同對戰算一次，結果向 50 收縮（n/(n+8)）。50 代表在共同對戰中旗鼓相當。不是 MMR、不是真實技術排名，也不是勝率。' },
  'team-fit': { title: 'Team Fit（陣容契合度）', body: '每位成員被分配到的特務，在他自己有證據的特務中的歷史排名百分位，再取五人平均。100 代表五人都在用自己歷史上最適合的特務。這是「歷史相對契合度」，不是勝率、不是未來預測，也不證明這是最佳陣容。' },
  kast: { title: 'KAST', body: '回合中有擊殺、助攻、存活，或陣亡後被隊友補回（5 秒內）的回合比例。只計算事件可完整重建的回合。' },
  opening: { title: '開局', body: '每回合第一個「對敵擊殺」：取得的稱為首殺、被取得的稱為首死。自殺、隊友誤殺與環境傷害不算開局。' },
  trade: { title: '補槍（Trade）', body: '隊友陣亡後 5 秒內擊殺兇手稱為補槍擊殺；自己陣亡後 5 秒內被隊友補回稱為被補槍。' },
  clutch: { title: '殘局', body: '隊上只剩自己、對面仍有人存活時的回合（1 對 N）。只有在事件順序能確定存活人數時才計入，無法確定時不猜測。' },
  'round-impact': { title: '回合影響', body: '人數劣勢下的擊殺、補槍、殘局狀態擊殺、多殺回合與勝利回合中的擊殺，依回合數換算後對照透明基準（0–100）。' },
  'sample-confidence': { title: '信心與樣本', body: '信心度（0–100）描述「這個數字有多少證據」：場次、回合數與可用事件證據的比例。它不是勝率或機率。沒有信心模型的數值，直接顯示樣本數。' },
  'basic-stats': { title: '基本數據', body: 'K/D＝擊殺÷死亡；ADR＝總傷害÷隊伍實際打完的回合數（勝＋敗回合）。只計算競技模式且有觀測數據的對戰。' },
  'rank-context': { title: '牌位脈絡', body: '只顯示對戰當下（或之前）已知的牌位，永遠不使用之後才出現的資料。牌位只是背景資訊，不參與任何分數計算。' },
  responsibility: { title: '分工建議', body: '只顯示通過時間序驗證的分工類型（例如主要突破、跟進補槍、下包支援、防守第一接觸）。證據不足時明確顯示「證據不足」，不會用特務類型猜測；不提供站位、路線或點位建議。' },
};
