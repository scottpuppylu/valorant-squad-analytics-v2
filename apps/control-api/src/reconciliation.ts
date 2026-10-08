import { ConsentReconciliationRecord } from '@vsa/contracts/control';
import { createHash } from 'node:crypto';

/**
 * Legacy consent reconciliation (consent-reconciliation-v1). Pure: it classifies what AUTHORITATIVE consent evidence
 * says about imported members and never changes any consent. Inputs deliberately contain no match presence, provider
 * account, group membership or imported-data signal — none of those is consent.
 *
 *   no authoritative evidence            → REQUIRES_RECONSENT (NO_AUTHORITATIVE_CONSENT_EVIDENCE)
 *   evidence under a non-accepted policy → UNSUPPORTED (POLICY_VERSION_NOT_ACCEPTED)
 *   several evidence items that disagree → CONFLICT (EVIDENCE_DISAGREES)
 *   consistent accepted evidence         → SUPPORTED (AUTHORITATIVE_EVIDENCE_PRESENT) — still grants nothing; the
 *                                          member must grant explicitly, which makes their consent EXPLICIT.
 */
export const RECONCILIATION_VERSION = 'consent-reconciliation-v1';

export interface ImportedConsentSubject { subjectRef: string; status: 'explicit' | 'requires-reconciliation' }
/** Evidence of an explicit, product-level consent decision by the member (e.g. a signed consent record). */
export interface AuthoritativeConsentEvidence {
  subjectRef: string;
  kind: 'EXPLICIT_PRODUCT_CONSENT';
  policyVersion: string;
  dataCollectionAllowed: boolean;
  publicDerivedAnalyticsAllowed: boolean;
}

export function reconcileImportedConsents(input: {
  subjects: readonly ImportedConsentSubject[];
  evidence: readonly AuthoritativeConsentEvidence[];
  acceptedPolicyVersions: readonly string[];
  importSource: string;
  decidedAt: string;
  decidedBy: string;
}): ConsentReconciliationRecord[] {
  return input.subjects.filter((s) => s.status === 'requires-reconciliation').map((s) => {
    const items = input.evidence.filter((e) => e.subjectRef === s.subjectRef);
    let state: ConsentReconciliationRecord['state'];
    let codes: string[];
    if (items.length === 0) { state = 'REQUIRES_RECONSENT'; codes = ['NO_AUTHORITATIVE_CONSENT_EVIDENCE']; }
    else if (new Set(items.map((e) => `${e.policyVersion}|${e.dataCollectionAllowed}|${e.publicDerivedAnalyticsAllowed}`)).size > 1) { state = 'CONFLICT'; codes = ['EVIDENCE_DISAGREES']; }
    else if (!input.acceptedPolicyVersions.includes(items[0]!.policyVersion)) { state = 'UNSUPPORTED'; codes = ['POLICY_VERSION_NOT_ACCEPTED']; }
    else { state = 'SUPPORTED'; codes = ['AUTHORITATIVE_EVIDENCE_PRESENT', 'EXPLICIT_REGRANT_REQUIRED']; }
    const recordId = `rec_${createHash('sha256').update(`${RECONCILIATION_VERSION}|${input.importSource}|${s.subjectRef}`, 'utf8').digest('hex').slice(0, 24)}`;
    return ConsentReconciliationRecord.parse({ recordId, subjectRef: s.subjectRef, importSource: input.importSource, state, evidenceCodes: codes,
      decidedAt: input.decidedAt, decidedBy: input.decidedBy });
  }).sort((a, b) => (a.subjectRef < b.subjectRef ? -1 : 1));
}
