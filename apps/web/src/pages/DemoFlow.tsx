import { useReducer, type ReactNode } from 'react';
import {
  canGrant, DEMO_GRANTS, demoReducer, GRANT_LABEL, groupCanSee, INITIAL_DEMO_STATE, publicationEligible, syncAllowed, type DemoAction, type DemoGrant, type DemoState,
} from '../demoFlow.ts';
import { OPT_IN_DISCLAIMER } from '../legal.ts';

const GRANT_HELP: Record<DemoGrant, string> = {
  DATA_COLLECTION_ALLOWED: '允許本服務取得並保存你的對戰紀錄（之後由本地工作程序向官方 API 取得）。',
  GROUP_VISIBILITY_ALLOWED: '允許同一個邀請制群組的成員看到你的統計。',
  PUBLIC_DERIVED_ANALYTICS_ALLOWED: '允許衍生統計（不含帳號識別碼、對戰編號或位置）出現在公開群組頁面。',
};

/** Every control on this page is a local, in-browser simulation. */
export function DemoTag() {
  return <span className="demo-chip" data-demo-tag="true">DEMO · NOT CONNECTED TO RIOT · NO REAL ACCOUNT DATA</span>;
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: ReactNode }) {
  return (
    <section className="panel demo-step" data-step={n} data-done={done ? 'true' : 'false'}>
      <header className="panel-head"><h2>{n}. {title}</h2><span className="muted small">{done ? '✓ 已完成' : '尚未完成'}</span></header>
      {children}
    </section>
  );
}

export function DemoFlowView({ state, dispatch }: { state: DemoState; dispatch: (a: DemoAction) => void }) {
  const btn = (label: string, action: DemoAction, enabled: boolean, extra?: string) => (
    <button type="button" className={`demo-button${extra ? ` ${extra}` : ''}`} disabled={!enabled} onClick={() => dispatch(action)}>{label}</button>
  );
  return (
    <div className="page demo-flow">
      <header className="page-header">
        <p className="eyebrow">同意流程示範（給審查者）</p>
        <h1>未來的加入與授權流程</h1>
        <p className="callout" role="note">
          這是<strong>純前端的模擬示範</strong>：不登入、不連線 Riot、不呼叫任何資料來源，重新整理就會重設。它展示未來取得 Riot 核准後的流程：
          加入群組不等於授權；帳號連結由玩家自己發起；三種權限分開、預設全部關閉；撤回後停止未來同步與公開資格。
        </p>
        <DemoTag />
      </header>

      <Step n={1} title="建立群組（Demo Squad，僅限邀請）" done={state.groupCreated}>
        <p>群組只有「私人」或「僅限邀請」兩種，沒有公開搜尋，也不能用任意 Riot ID 查詢陌生人。</p>
        {btn('建立 Demo Squad（DEMO）', { type: 'CREATE_GROUP' }, !state.groupCreated)}
      </Step>

      <Step n={2} title="邀請成員" done={state.invite !== 'NONE'}>
        <p>邀請是一次性、會過期的連結；在接受之前，連結不會透露群組名稱或成員。</p>
        {btn('建立邀請（DEMO）', { type: 'CREATE_INVITE' }, state.groupCreated && state.invite === 'NONE')}
      </Step>

      <Step n={3} title="成員接受邀請" done={state.memberJoined}>
        <p><strong>加入群組不會授予任何資料權限。</strong>此時其他人看不到這位成員的任何個人統計。</p>
        {btn('以示範成員身分接受（DEMO）', { type: 'ACCEPT_INVITE' }, state.invite === 'OPEN')}
      </Step>

      <Step n={4} title="連結 Riot 帳號（模擬）" done={state.identityConnected}>
        <div className="disclaimer" data-disclaimer="opt-in">
          <p className="demo-chip">{OPT_IN_DISCLAIMER.label}</p>
          <ul className="plain">{OPT_IN_DISCLAIMER.zh.map((p) => <li key={p}>{p}</li>)}</ul>
          <details><summary>English</summary><ul className="plain" lang="en">{OPT_IN_DISCLAIMER.en.map((p) => <li key={p}>{p}</li>)}</ul></details>
        </div>
        {btn('我已閱讀帳號連結說明', { type: 'ACKNOWLEDGE_DISCLAIMER' }, state.memberJoined && !state.disclaimerAcknowledged)}
        {btn('模擬連結 Riot 帳號（DEMO，不會連線 Riot）', { type: 'MOCK_CONNECT_RIOT' }, state.memberJoined && state.disclaimerAcknowledged && !state.identityConnected)}
        <p className="muted small">已驗證的帳號連結是一個「事實」，不是同意開關。正式版會透過 Riot Sign On 驗證；目前沒有任何授權網址或用戶端設定。</p>
      </Step>

      <Step n={5} title="檢視並設定權限（預設全部關閉）" done={state.grants.DATA_COLLECTION_ALLOWED}>
        <ul className="consent-list">
          {DEMO_GRANTS.map((g) => (
            <li key={g} data-grant={g} data-on={state.grants[g] ? 'true' : 'false'}>
              <div><strong>{GRANT_LABEL[g]}</strong>：<span className="consent-state">{state.grants[g] ? '開啟' : '關閉'}</span><p className="muted small">{GRANT_HELP[g]}</p></div>
              {state.grants[g]
                ? btn(`撤回「${GRANT_LABEL[g]}」`, { type: 'REVOKE', grant: g }, true, 'danger')
                : btn(`同意「${GRANT_LABEL[g]}」`, { type: 'GRANT', grant: g }, canGrant(state, g))}
            </li>
          ))}
        </ul>
        <p className="muted small">權限有順序：資料收集需要已連結帳號；群組可見需要資料收集；公開衍生分析需要群組可見。可以只開資料收集、不公開。</p>
      </Step>

      <Step n={6} title="要求同步" done={state.sync === 'SUCCEEDED'}>
        {btn('要求同步（DEMO，不會呼叫任何資料來源）', { type: 'REQUEST_SYNC' }, state.memberJoined)}
        <p data-sync={state.sync}>
          {state.sync === 'NONE' ? '尚未同步。' : state.sync === 'BLOCKED_CONSENT' ? '同步被擋下：需要已連結帳號與「資料收集」同意（正式版不會在這種情況下發出任何資料請求）。'
            : `示範同步完成：${state.matchesIngested} 場合成對戰。`}
        </p>
      </Step>

      <Step n={7} title="分析結果與可見範圍" done={state.sync === 'SUCCEEDED'}>
        <dl className="meta">
          <div><dt>可以同步</dt><dd data-state="sync-allowed">{syncAllowed(state) ? '是' : '否'}</dd></div>
          <div><dt>群組成員看得到</dt><dd data-state="group-visible">{groupCanSee(state) ? '是' : '否'}</dd></div>
          <div><dt>可進入公開頁面</dt><dd data-state="public-eligible">{publicationEligible(state) ? '是' : '否'}</dd></div>
        </dl>
        {state.sync === 'SUCCEEDED' ? <p>看看合成的分析結果長什麼樣子：<a href="#/players">玩家</a>、<a href="#/compare">Diff Check</a>、<a href="#/team-builder">組隊建議</a>（全部是虛構示範資料）。</p> : null}
      </Step>

      <Step n={8} title="撤回授權" done={state.revocationRequested}>
        <p>撤回「資料收集」（或解除帳號連結）時：</p>
        <ul className="plain">
          <li>未來的同步立即停止；</li>
          <li>未來的公開資格立即停止；</li>
          <li>會送出「資料撤回處理請求」，移除可歸屬於你的精確位置資料；</li>
          <li>與其他玩家共有、無法歸屬到你的對戰紀錄不會被瞬間全部刪除（另依刪除請求流程處理）。</li>
        </ul>
        {btn('撤回「資料收集」（DEMO）', { type: 'REVOKE', grant: 'DATA_COLLECTION_ALLOWED' }, state.grants.DATA_COLLECTION_ALLOWED, 'danger')}
        {btn('模擬解除 Riot 帳號連結（DEMO）', { type: 'MOCK_DISCONNECT_RIOT' }, state.identityConnected, 'danger')}
        {state.revocationRequested ? <p className="callout" data-state="revocation-requested">已送出撤回請求（示範）：未來同步與公開資格已停止，資料撤回處理已排入。</p> : null}
      </Step>

      <section className="panel">
        <header className="panel-head"><h2>示範紀錄</h2>{btn('重新開始', { type: 'RESET' }, true)}</header>
        {state.log.length ? <ol className="plain" data-log="true">{state.log.map((l, i) => <li key={`${i}-${l}`}>{l}</li>)}</ol> : <p className="muted">尚無動作。</p>}
      </section>
    </div>
  );
}

export function DemoFlow() {
  const [state, dispatch] = useReducer(demoReducer, INITIAL_DEMO_STATE);
  return <DemoFlowView state={state} dispatch={dispatch} />;
}
