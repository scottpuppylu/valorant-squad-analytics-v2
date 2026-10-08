import type { ReactNode } from 'react';

function Placeholder({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h1>{title}</h1>
      <div className="placeholder">{children}</div>
    </section>
  );
}

export function Compare() {
  return <Placeholder title="比較">並排比較群組成員的已接受指標。尚未開放。</Placeholder>;
}

export function Synergy() {
  return <Placeholder title="默契">成員兩兩之間的同場關聯（pair-level association），不是因果。尚未開放。</Placeholder>;
}

export function TeamBuilder() {
  return (
    <Placeholder title="組隊建議">
      <p>輸入 5 位成員與地圖，依歷史證據建議角色與責任分工。尚未開放。</p>
      <ul>
        <li>Team Fit＝<strong>歷史相對陣容適配度</strong>，不是勝率，也不是已證明的最佳陣容。</li>
        <li>信心度與 Team Fit 分開呈現：證據少時信心度低。</li>
      </ul>
    </Placeholder>
  );
}

export function About() {
  return (
    <Placeholder title="資料說明">
      <ul>
        <li>本網站只讀取已發布的靜態快照（manifest.json + 不可變的快照檔），不連線資料庫或任何遊戲資料來源。</li>
        <li>歷史為資料來源可見的範圍，<strong>不代表完整生涯</strong>。</li>
        <li>只顯示成員明確同意公開的衍生分析；原始比賽資料、帳號識別碼與位置資料永不公開。</li>
        <li>本工具不是官方牌位、MMR 或 Elo，也不提供對手偵查。</li>
      </ul>
    </Placeholder>
  );
}
