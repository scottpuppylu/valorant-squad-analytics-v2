/**
 * SYNTHETIC opt-in walkthrough for application review (V2-RSO-PRODUCTION-READINESS-01).
 *
 * Pure, deterministic, in-browser state only: no backend, no control-plane connection, no network, no OAuth URL, no
 * client id. It mirrors the accepted control-plane-v1 rules so a reviewer can see the intended flow:
 * default-DENY grants, IDENTITY_CONNECTED as a verified-connection FACT (not a toggle), ordered grants with cascading
 * revocation, sync blocked without consent, publication only with visibility + public analytics.
 */
export type DemoGrant = 'DATA_COLLECTION_ALLOWED' | 'GROUP_VISIBILITY_ALLOWED' | 'PUBLIC_DERIVED_ANALYTICS_ALLOWED';
export const DEMO_GRANTS: readonly DemoGrant[] = ['DATA_COLLECTION_ALLOWED', 'GROUP_VISIBILITY_ALLOWED', 'PUBLIC_DERIVED_ANALYTICS_ALLOWED'];
const REQUIRES: Readonly<Record<DemoGrant, DemoGrant | 'IDENTITY_CONNECTED'>> = {
  DATA_COLLECTION_ALLOWED: 'IDENTITY_CONNECTED', GROUP_VISIBILITY_ALLOWED: 'DATA_COLLECTION_ALLOWED', PUBLIC_DERIVED_ANALYTICS_ALLOWED: 'GROUP_VISIBILITY_ALLOWED',
};

export type DemoSync = 'NONE' | 'BLOCKED_CONSENT' | 'SUCCEEDED';
export interface DemoState {
  groupCreated: boolean;
  invite: 'NONE' | 'OPEN' | 'ACCEPTED';
  memberJoined: boolean;
  /** Fact of a (mock) verified Riot connection — never a consent toggle. */
  identityConnected: boolean;
  disclaimerAcknowledged: boolean;
  grants: Record<DemoGrant, boolean>;
  sync: DemoSync;
  /** Synthetic result of the last successful demo sync. */
  matchesIngested: number | null;
  revocationRequested: boolean;
  log: string[];
}

export const INITIAL_DEMO_STATE: DemoState = Object.freeze({
  groupCreated: false, invite: 'NONE', memberJoined: false, identityConnected: false, disclaimerAcknowledged: false,
  grants: Object.freeze({ DATA_COLLECTION_ALLOWED: false, GROUP_VISIBILITY_ALLOWED: false, PUBLIC_DERIVED_ANALYTICS_ALLOWED: false }) as Record<DemoGrant, boolean>,
  sync: 'NONE', matchesIngested: null, revocationRequested: false, log: [],
}) as DemoState;

export type DemoAction =
  | { type: 'CREATE_GROUP' }
  | { type: 'CREATE_INVITE' }
  | { type: 'ACCEPT_INVITE' }
  | { type: 'ACKNOWLEDGE_DISCLAIMER' }
  | { type: 'MOCK_CONNECT_RIOT' }
  | { type: 'GRANT'; grant: DemoGrant }
  | { type: 'REVOKE'; grant: DemoGrant }
  | { type: 'REQUEST_SYNC' }
  | { type: 'MOCK_DISCONNECT_RIOT' }
  | { type: 'RESET' };

/** Deterministic synthetic sync result (no provider is ever called). */
export const DEMO_SYNC_MATCHES = 12;

export const LOG_TEXT = {
  CREATE_GROUP: '建立「Demo Squad」（僅限邀請）',
  CREATE_INVITE: '建立一次性邀請連結（示範）',
  ACCEPT_INVITE: '示範成員接受邀請：加入群組不會授予任何資料權限',
  ACKNOWLEDGE_DISCLAIMER: '已閱讀帳號連結說明（草稿）',
  MOCK_CONNECT_RIOT: '模擬 Riot 帳號連結完成（未連線 Riot）',
  SYNC_BLOCKED: '同步被擋下：需要已連結帳號與「資料收集」同意',
  SYNC_OK: `示範同步完成：${DEMO_SYNC_MATCHES} 場合成對戰（沒有呼叫任何資料來源）`,
  REVOKED: '已撤回同意：停止未來同步與公開資格，並送出資料撤回處理請求',
  DISCONNECTED: '已解除帳號連結：所有依賴它的同意一併撤回',
  RESET: '重新開始示範',
} as const;

function revokeFrom(state: DemoState, grant: DemoGrant | 'IDENTITY_CONNECTED'): { grants: Record<DemoGrant, boolean>; collectionEnded: boolean } {
  const order: (DemoGrant | 'IDENTITY_CONNECTED')[] = ['IDENTITY_CONNECTED', ...DEMO_GRANTS];
  const grants = { ...state.grants };
  let collectionEnded = false;
  for (const g of order.slice(order.indexOf(grant))) {
    if (g === 'IDENTITY_CONNECTED') continue;
    if (grants[g] && g === 'DATA_COLLECTION_ALLOWED') collectionEnded = true;
    grants[g] = false;
  }
  return { grants, collectionEnded };
}

export function canGrant(state: DemoState, grant: DemoGrant): boolean {
  const need = REQUIRES[grant];
  return state.memberJoined && (need === 'IDENTITY_CONNECTED' ? state.identityConnected : state.grants[need]);
}

export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  const log = (line: string) => [...state.log, line];
  switch (action.type) {
    case 'CREATE_GROUP': return state.groupCreated ? state : { ...state, groupCreated: true, log: log(LOG_TEXT.CREATE_GROUP) };
    case 'CREATE_INVITE': return !state.groupCreated || state.invite !== 'NONE' ? state : { ...state, invite: 'OPEN', log: log(LOG_TEXT.CREATE_INVITE) };
    case 'ACCEPT_INVITE': return state.invite !== 'OPEN' ? state : { ...state, invite: 'ACCEPTED', memberJoined: true, log: log(LOG_TEXT.ACCEPT_INVITE) };
    case 'ACKNOWLEDGE_DISCLAIMER': return !state.memberJoined || state.disclaimerAcknowledged ? state : { ...state, disclaimerAcknowledged: true, log: log(LOG_TEXT.ACKNOWLEDGE_DISCLAIMER) };
    case 'MOCK_CONNECT_RIOT':
      return !state.memberJoined || !state.disclaimerAcknowledged || state.identityConnected ? state : { ...state, identityConnected: true, log: log(LOG_TEXT.MOCK_CONNECT_RIOT) };
    case 'GRANT':
      if (!canGrant(state, action.grant) || state.grants[action.grant]) return state;
      return { ...state, grants: { ...state.grants, [action.grant]: true }, revocationRequested: false, log: log(`同意：${GRANT_LABEL[action.grant]}`) };
    case 'REVOKE': {
      if (!state.grants[action.grant]) return state;
      const { grants, collectionEnded } = revokeFrom(state, action.grant);
      return { ...state, grants, revocationRequested: true, sync: collectionEnded ? 'NONE' : state.sync, log: log(LOG_TEXT.REVOKED) };
    }
    case 'MOCK_DISCONNECT_RIOT': {
      if (!state.identityConnected) return state;
      const { grants } = revokeFrom(state, 'IDENTITY_CONNECTED');
      return { ...state, identityConnected: false, grants, sync: 'NONE', revocationRequested: true, log: log(LOG_TEXT.DISCONNECTED) };
    }
    case 'REQUEST_SYNC': {
      if (!state.memberJoined) return state;
      if (!syncAllowed(state)) return { ...state, sync: 'BLOCKED_CONSENT', matchesIngested: null, log: log(LOG_TEXT.SYNC_BLOCKED) };
      return { ...state, sync: 'SUCCEEDED', matchesIngested: DEMO_SYNC_MATCHES, log: log(LOG_TEXT.SYNC_OK) };
    }
    case 'RESET': return { ...INITIAL_DEMO_STATE, log: [LOG_TEXT.RESET] };
    default: return state;
  }
}

export const GRANT_LABEL: Readonly<Record<DemoGrant, string>> = {
  DATA_COLLECTION_ALLOWED: '資料收集', GROUP_VISIBILITY_ALLOWED: '群組可見', PUBLIC_DERIVED_ANALYTICS_ALLOWED: '公開衍生分析',
};

export const syncAllowed = (s: DemoState) => s.memberJoined && s.identityConnected && s.grants.DATA_COLLECTION_ALLOWED;
/** What the rest of the group may see (mirrors control-plane-v1 eligibility, conservative). */
export const groupCanSee = (s: DemoState) => s.memberJoined && s.identityConnected && s.grants.DATA_COLLECTION_ALLOWED && s.grants.GROUP_VISIBILITY_ALLOWED;
export const publicationEligible = (s: DemoState) => groupCanSee(s) && s.grants.PUBLIC_DERIVED_ANALYTICS_ALLOWED;
