import { createHash } from 'node:crypto';

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** Provider-neutral canonical match key, derived from (provider, provider record): never IS the provider's id. */
export function canonicalMatchKey(providerId: string, providerRecordRef: string): string {
  return `cm_${sha256(`canonical-match-key-v1:${providerId}:${providerRecordRef}`).slice(0, 24)}`;
}

/** Match-scoped participant key: stable for one match, not linkable across matches, not reversible to the provider id. */
export function canonicalParticipantKey(matchKey: string, providerAccountRef: string): string {
  return `pk_${sha256(`canonical-participant-key-v1:${matchKey}:${providerAccountRef}`).slice(0, 16)}`;
}
