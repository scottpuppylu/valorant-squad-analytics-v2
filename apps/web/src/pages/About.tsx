import { Explain, HistoryNotice } from '../components/ui.tsx';
import type { SnapshotState } from '../data/loadSnapshot.ts';
import { EXPLANATION } from '../i18n.ts';

/** Methodology page: static text, renders even without a snapshot. */
export function About({ state }: { state: SnapshotState }) {
  const coverage = state.status === 'ready' ? state.group.coverage : null;
  return (
    <div className="page prose">
      <header className="page-header">
        <p className="eyebrow">資料與方法</p>
        <h1>資料與方法</h1>
        <HistoryNotice from={coverage?.firstMatchAt} to={coverage?.lastMatchAt} />
      </header>
      <section className="panel">
        <h2>使用哪些資料</h2>
        <ul className="plain">
          <li>成員連結的遊戲帳號、在資料來源上<strong>可見</strong>的對戰紀錄：回合、擊殺事件、下包／拆包、特務與基本數據。</li>
          <li>分數只使用<strong>競技模式</strong>；一般模式只用於「同場比較」，其他模式只供瀏覽。</li>
          <li>牌位只作為背景資訊，且只使用對戰當時或之前已知的資料，絕不使用之後才出現的資訊。</li>
        </ul>
      </section>
      <section className="panel">
        <h2>為什麼不是全部歷史（lifetimeComplete = false）</h2>
        <p>資料來源只提供一部分的歷史對戰；更早的對戰不可見，也無法證明已收齊。因此所有頁面都標示「目前可追蹤紀錄」，場次只代表目前看得到的部分。</p>
      </section>
      <section className="panel">
        <h2>各項指標的意思</h2>
        {(['community-score', 'current-strength', 'recent-form', 'shared-match', 'team-fit', 'kast', 'opening', 'trade', 'clutch', 'round-impact', 'responsibility', 'rank-context', 'basic-stats'] as const).map((k) => (
          <div key={k} className="about-item"><h3>{EXPLANATION[k].title}</h3><p>{EXPLANATION[k].body}</p></div>
        ))}
      </section>
      <section className="panel">
        <h2>信心度與樣本數</h2>
        <p>{EXPLANATION['sample-confidence'].body}</p>
        <p>證據不足時，頁面會明確顯示「證據不足」，而不是留白或用預設值代替；這是正常、誠實的結果。</p>
      </section>
      <section className="panel">
        <h2>隱私</h2>
        <ul className="plain">
          <li>本網站只讀取已發布的<strong>靜態快照</strong>，不連線資料庫、也不呼叫任何遊戲資料來源。</li>
          <li>只顯示成員明確同意公開的衍生分析；未同意公開的成員，他的資料也不會出現在別人的同場比較或組隊結果裡。</li>
          <li>遊戲帳號識別碼、原始對戰編號、位置座標與視角方向永遠不會公開。</li>
        </ul>
      </section>
      <section className="panel">
        <h2>群組範圍</h2>
        <p>所有比較都只在這個群組內進行：社群分數使用透明的固定基準，同場比較只比較群組成員之間的共同對戰。這不是官方牌位、MMR 或 Elo，也不能與其他群組直接比較。</p>
      </section>
      <Explain k="sample-confidence" />
    </div>
  );
}
