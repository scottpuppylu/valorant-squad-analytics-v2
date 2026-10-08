import type { CanonicalMatch, RankContext } from '@vsa/contracts/canonical';

/**
 * Ingestion provenance (`ingestion-provenance-v1`) mapped onto the existing canonical-schema-v2 `source` block — no
 * schema change:
 *   providerId          source.providerId           origin provider namespace (e.g. henrik)
 *   providerVersion     source.providerVersion      provider payload version (e.g. henrik-v4)
 *   adapterVersion      source.acquisitionSource    the adapter that acquired it (e.g. henrik-adapter-v1)
 *   normalizerVersion   source.normalizerVersion
 *   observedAt          source.observedAt
 *   providerEvidenceRef source.providerRecordRef    PRIVATE — never in public output
 */
export interface IngestionProvenance {
  providerId: string;
  providerVersion: string;
  adapterVersion: string;
  normalizerVersion: string;
  observedAt: string;
  acquisition: 'provider-adapter' | 'legacy-import';
  /** PRIVATE provider record reference. */
  providerEvidenceRef: string;
}

export function provenanceOf(match: CanonicalMatch): IngestionProvenance {
  const s = match.source;
  return { providerId: s.providerId, providerVersion: s.providerVersion, adapterVersion: s.acquisitionSource, normalizerVersion: s.normalizerVersion, observedAt: s.observedAt,
    acquisition: s.acquisition, providerEvidenceRef: s.providerRecordRef };
}

/** The only provenance shape allowed outside the private store: no record ref, no account ref. */
export function publicProvenance(match: CanonicalMatch): Omit<IngestionProvenance, 'providerEvidenceRef'> {
  const { providerEvidenceRef: _ref, ...rest } = provenanceOf(match);
  return rest;
}

/** Rank rows carry provider, endpoint label and tier-model version; the endpoint label is a code label, never a URL. */
export function rankProvenanceOf(row: RankContext): { providerId: string; sourceEndpoint: string; tierModelVersion: string; effectiveAt: string } {
  return { providerId: row.providerId, sourceEndpoint: row.sourceEndpoint, tierModelVersion: row.tierModelVersion, effectiveAt: row.effectiveAt };
}
