import type { ReactNode } from 'react';
import type { ExplanationKey, ProductStatus, ReasonCode } from '@vsa/contracts/product';
import type { PublicProductMetric } from '@vsa/contracts/public';
import { formatInt, formatScore } from '../format.ts';
import { EXPLANATION, HISTORY_LABEL, HISTORY_NOTE, REASON_LABEL, STATUS_LABEL } from '../i18n.ts';

/** Honest history wording, shown on every data page. */
export function HistoryNotice({ from, to }: { from?: string | null; to?: string | null }) {
  return (
    <p className="history-notice" role="note">
      <span className="history-tag">{HISTORY_LABEL}</span>
      {from && to ? <span>{from.slice(0, 10)} – {to.slice(0, 10)}。</span> : null}
      <span>{HISTORY_NOTE}</span>
    </p>
  );
}

/** Status as TEXT plus a shape marker (never colour alone). */
export function StatusBadge({ status }: { status: ProductStatus }) {
  const mark = { available: '●', partial: '◐', unavailable: '○', insufficient: '○' }[status];
  return <span className={`badge badge-${status}`} data-status={status}><span aria-hidden="true">{mark}</span> {STATUS_LABEL[status]}</span>;
}

export function Reasons({ reasons }: { reasons: readonly ReasonCode[] }) {
  const shown = reasons.filter((r) => r !== 'provider_visible_history');
  if (shown.length === 0) return null;
  return <ul className="reasons">{shown.map((r) => <li key={r}>{REASON_LABEL[r]}</li>)}</ul>;
}

/** 0–100 bar; the number is always printed next to it. */
export function ScoreBar({ value, label }: { value: number | null; label: string }) {
  if (value === null) return null;
  const v = Math.max(0, Math.min(100, value));
  return <span className="bar" role="img" aria-label={`${label} ${v.toFixed(1)} / 100`}><span className="bar-fill" style={{ width: `${v}%` }} /></span>;
}

/** Confidence only when the metric has a confidence model; sample size always (no fake precision). */
export function SampleNote({ metric }: { metric: PublicProductMetric }) {
  const sample = metric.sampleSize ? `${metric.sampleSize.matches} 場 · ${metric.sampleSize.rounds} 回合` : '無樣本';
  return (
    <span className="sample">
      {sample}
      {metric.confidenceModel !== 'none' && metric.confidence !== null ? <> · 信心 {formatInt(metric.confidence)}/100</> : null}
    </span>
  );
}

/** A product metric: value + status + sample, or an explicit insufficient-evidence state (never a blank). */
export function Metric({ metric, label, compact = false }: { metric: PublicProductMetric; label: string; compact?: boolean }) {
  const shown = metric.value !== null && metric.status !== 'unavailable' && metric.status !== 'insufficient';
  return (
    <div className={`metric${compact ? ' metric-compact' : ''}`} data-metric={metric.explanationKey}>
      <div className="metric-label">{label}</div>
      {shown ? (
        <div className="metric-value"><span className="num">{formatScore(metric.value)}</span><ScoreBar value={metric.value} label={label} /></div>
      ) : (
        <div className="metric-value metric-missing">證據不足，不顯示數值</div>
      )}
      <div className="metric-meta"><StatusBadge status={metric.status} /> <SampleNote metric={metric} /></div>
      {!compact ? <Reasons reasons={metric.eligibility.reasons} /> : null}
    </div>
  );
}

export function Explain({ k }: { k: ExplanationKey }) {
  const e = EXPLANATION[k];
  return (
    <details className="explain">
      <summary>什麼是「{e.title}」？</summary>
      <p>{e.body}</p>
    </details>
  );
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="panel" aria-label={title}>
      <header className="panel-head"><h2>{title}</h2>{aside}</header>
      {children}
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty" role="status" data-state="empty"><strong>{title}</strong>{children ? <div>{children}</div> : null}</div>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return <div className="stat"><dt>{label}</dt><dd>{value}</dd>{hint ? <span className="stat-hint">{hint}</span> : null}</div>;
}
