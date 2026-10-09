import { POLICY_DATE, POLICY_VERSION, PRIVACY_POLICY, PRIVATE_CONTACT_EMAIL, PRODUCT_NAME_EN, TERMS_OF_SERVICE, type PolicyDocument } from '../legal.ts';

/** Text with the approved contact address turned into a mailto link. */
function WithContact({ text }: { text: string }) {
  const parts = text.split(PRIVATE_CONTACT_EMAIL);
  return <>{parts.map((part, i) => (i === 0 ? part : <span key={i}><a href={`mailto:${PRIVATE_CONTACT_EMAIL}`}>{PRIVATE_CONTACT_EMAIL}</a>{part}</span>))}</>;
}

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
          {s.paragraphs.map((p) => <p key={p}><WithContact text={p} /></p>)}
          {s.items?.length ? <ul className="plain">{s.items.map((i) => <li key={i}><WithContact text={i} /></li>)}</ul> : null}
        </section>
      ))}
    </div>
  );
}

export const Privacy = () => <PolicyPage doc={PRIVACY_POLICY} eyebrow="隱私權政策" />;
export const Terms = () => <PolicyPage doc={TERMS_OF_SERVICE} eyebrow="服務條款" />;
