import type { SnapshotState } from '../data/loadSnapshot.ts';

const TITLES: Record<Exclude<SnapshotState['status'], 'ready'>, string> = {
  loading: '載入中…',
  empty: '尚無資料',
  'invalid-manifest': '快照清單無效',
  'unsupported-version': '不支援的快照版本',
  'missing-snapshot': '快照檔案缺失',
  'privacy-failure': '隱私驗證失敗，已拒絕顯示',
};
const HINTS: Record<Exclude<SnapshotState['status'], 'ready'>, string> = {
  loading: '正在讀取已發布的靜態快照。',
  empty: '目前沒有已發布、且成員同意公開的資料。',
  'invalid-manifest': '快照清單（manifest）格式錯誤或雜湊不符，為安全起見不顯示任何內容。',
  'unsupported-version': '這個網站版本無法讀取此快照格式；請更新網站或重新發布快照。',
  'missing-snapshot': '快照缺少必要檔案，不顯示部分資料以免誤導。',
  'privacy-failure': '快照內容未通過隱私檢查（可能含有不允許公開的欄位），已全部拒絕。',
};

/** Every non-ready state is shown explicitly — never a silent blank page. */
export function StatusView({ state }: { state: Exclude<SnapshotState, { status: 'ready' }> }) {
  return (
    <section className={`status status-${state.status}`} role={state.status === 'loading' ? 'status' : 'alert'} data-status={state.status} aria-live="polite">
      <h1>{TITLES[state.status]}</h1>
      <p>{HINTS[state.status]}</p>
      {'detail' in state ? <p className="muted small">技術細節：{state.detail}</p> : null}
    </section>
  );
}
