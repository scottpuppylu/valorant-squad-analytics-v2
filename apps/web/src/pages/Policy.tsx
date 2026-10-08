import { POLICY_DATE, POLICY_VERSION, PRIVACY_POLICY, PRODUCT_NAME_EN, TERMS_OF_SERVICE, type PolicyDocument } from '../legal.ts';

function PolicyPage({ doc, eyebrow }: { doc: PolicyDocument; eyebrow: string }) {
  return (
    <div className="page prose" lang="en">
      <header className="page-header">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{doc.title}</h1>
        <p className="muted small">{PRODUCT_NAME_EN} · DRAFT {POLICY_VERSION} · {POLICY_DATE}</p>
        <div className="callout" lang="zh-Hant">{doc.summaryZh.map((p) => <p key={p}>{p}</p>)}</div>
      </header>
      {doc.sections.map((s) => (
        <section key={s.id} className="panel" id={`policy-${s.id}`}>
          <h2>{s.title}</h2>
          {s.paragraphs.map((p) => <p key={p}>{p}</p>)}
          {s.items?.length ? <ul className="plain">{s.items.map((i) => <li key={i}>{i}</li>)}</ul> : null}
        </section>
      ))}
    </div>
  );
}

export const Privacy = () => <PolicyPage doc={PRIVACY_POLICY} eyebrow="隱私權政策" />;
export const Terms = () => <PolicyPage doc={TERMS_OF_SERVICE} eyebrow="服務條款" />;
