import type { PublicationEligibility } from '@vsa/contracts/control';
import type { ConsentRecord, GroupRecord, MembershipRecord } from './model.ts';

/**
 * Deterministic publication eligibility (control-plane-v1, conservative default). A membership may enter a public group
 * snapshot only when ALL hold: the membership is ACTIVE, the group is not archived, consent is EXPLICIT, and
 * GROUP_VISIBILITY_ALLOWED and PUBLIC_DERIVED_ANALYTICS_ALLOWED are both granted. Because grants are ordered, those
 * also require IDENTITY_CONNECTED and DATA_COLLECTION_ALLOWED: revoking collection therefore removes publication
 * eligibility too (no "retained data" publication path in this wave).
 */
export function publicationEligibility(membership: MembershipRecord, group: GroupRecord, consent: ConsentRecord | null): PublicationEligibility {
  const reasons: PublicationEligibility['reasons'] = [];
  if (membership.state !== 'ACTIVE') reasons.push('MEMBERSHIP_NOT_ACTIVE');
  if (group.status !== 'ACTIVE') reasons.push('GROUP_ARCHIVED');
  if (!consent || consent.status !== 'EXPLICIT') reasons.push('CONSENT_REQUIRES_RECONCILIATION');
  const g = consent?.status === 'EXPLICIT' ? consent.grants : null;
  if (!g?.IDENTITY_CONNECTED) reasons.push('IDENTITY_NOT_CONNECTED');
  if (!g?.DATA_COLLECTION_ALLOWED) reasons.push('DATA_COLLECTION_NOT_ALLOWED');
  if (!g?.GROUP_VISIBILITY_ALLOWED) reasons.push('GROUP_VISIBILITY_NOT_ALLOWED');
  if (!g?.PUBLIC_DERIVED_ANALYTICS_ALLOWED) reasons.push('PUBLIC_DERIVED_ANALYTICS_NOT_ALLOWED');
  return { membershipId: membership.membershipId, eligible: reasons.length === 0, reasons };
}

/** Sync eligibility: before a job may RUN, identity and data collection must both be granted for an ACTIVE membership. */
export function syncBlockReasons(membership: MembershipRecord | null, group: GroupRecord | null, consent: ConsentRecord | null): string[] {
  const reasons: string[] = [];
  if (!membership || membership.state !== 'ACTIVE') reasons.push('MEMBERSHIP_NOT_ACTIVE');
  if (!group || group.status !== 'ACTIVE') reasons.push('GROUP_ARCHIVED');
  if (!consent || consent.status !== 'EXPLICIT') reasons.push('CONSENT_REQUIRES_RECONCILIATION');
  if (consent?.status !== 'EXPLICIT' || !consent.grants.IDENTITY_CONNECTED) reasons.push('IDENTITY_NOT_CONNECTED');
  if (consent?.status !== 'EXPLICIT' || !consent.grants.DATA_COLLECTION_ALLOWED) reasons.push('DATA_COLLECTION_NOT_ALLOWED');
  return reasons;
}
