import type { SnapshotState } from '../data/loadSnapshot.ts';

const TITLES: Record<Exclude<SnapshotState['status'], 'ready'>, string> = {
  loading: '載入中…',
  empty: '尚無資料',
  'invalid-manifest': '快照清單無效',
  'unsupported-version': '不支援的快照版本',
  'missing-snapshot': '快照檔案缺失',
  'privacy-failure': '隱私驗證失敗，已拒絕顯示',
};

/** Every non-ready state is shown explicitly — never a silent blank page. */
export function StatusView({ state }: { state: Exclude<SnapshotState, { status: 'ready' }> }) {
  return (
    <section className={`status status-${state.status}`} role={state.status === 'loading' ? 'status' : 'alert'} data-status={state.status}>
      <h2>{TITLES[state.status]}</h2>
      {'detail' in state ? <p>{state.detail}</p> : null}
    </section>
  );
}
