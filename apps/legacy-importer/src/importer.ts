import { createHash } from 'node:crypto';
import type { CanonicalRepository } from '@vsa/canonical-data';
import type { RankContext } from '@vsa/contracts/canonical';
import { canonicalMatchKey } from '@vsa/source-adapters';
import { HENRIK_PROVIDER_ID, LEGACY_IMPORT_NORMALIZER_VERSION, normalizeHenrikV4Match, type NormalizeDiagnostics } from './henrikV4.ts';
import { IMPORT_GROUP, planIdentities, sourceRefHash } from './identity.ts';
import { SOURCE_SYSTEM } from './legacySchema.ts';
import { createSafeLogger, type SafeLogger } from './safeLog.ts';
import type { LegacyEvidenceSource } from './source.ts';

export interface ImportOptions {
  dryRun?: boolean;
  /** Skip source records whose checkpoint (same payload hash + normalizer version) already exists. */
  resume?: boolean;
  pageSize?: number;
  /** Stop after this many matches (crash / restart tests). */
  maxMatches?: number;
  now?: () => string;
  log?: SafeLogger;
}

export interface ImportReport {
  dryRun: boolean;
  sourceVersions: Record<string, string>;
  identity: { members: number; accounts: number; multiAccountMembers: number; unresolvedAccounts: number; collisions: number; consentStatus: string };
  matches: { sourceRows: number; processed: number; inserted: number; rewritten: number; resumedSkips: number; conflicts: number; duplicates: number };
  diagnostics: { killsInUnknownRounds: number; invalidKills: number; snapshotsDroppedDuplicate: number; snapshotsDroppedNonRoster: number; snapshotsDroppedInvalid: number;
    sideConflicts: number; killOnlyParticipants: number; economyOutOfDomain: number };
  rank: { sourceRows: number; imported: number; unresolvedAccount: number; matchRefUnresolved: number };
  consentInferredFromEvidence: false;
  durationMs: number;
}

export class SourceConflictError extends Error {
  constructor(detail: string) { super(`source conflict: ${detail}`); this.name = 'SourceConflictError'; }
}

const ACQUISITION_SOURCE = 'legacy-rebuild-staging:rebuild-staging-v1';
const KIND = { current: 'current', peak: 'peak', seasonal: 'seasonal', history: 'history', match_snapshot: 'match-snapshot' } as const;
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * LegacyEvidenceImportAdapter: legacy private staging (READ ONLY) → explicit normalization → V2 canonical repository.
 * The canonical repository knows nothing about legacy tables; this adapter is the only place that does.
 */
export class LegacyEvidenceImportAdapter {
  private readonly source: LegacyEvidenceSource;
  private readonly target: CanonicalRepository | null;
  constructor(source: LegacyEvidenceSource, target: CanonicalRepository | null) {
    this.source = source;
    this.target = target;
  }

  async run(options: ImportOptions = {}): Promise<ImportReport> {
    const started = Date.now();
    const dryRun = options.dryRun ?? false;
    if (!dryRun && !this.target) throw new Error('a target repository is required unless --dry-run');
    const log = options.log ?? createSafeLogger();
    const now = options.now ?? (() => new Date().toISOString());
    const pageSize = Math.min(Math.max(options.pageSize ?? 25, 1), 100);

    await this.source.verifyReadOnly();
    const sourceVersions = await this.source.versions();
    const plan = planIdentities(await this.source.accounts());
    if (plan.collisions.length) throw new SourceConflictError(`identity collisions (${plan.collisions.length})`);
    const multiAccountMembers = plan.members.filter((m) => plan.accounts.filter((a) => a.memberId === m.memberId).length > 1).length;
    log('identity_planned', { members: plan.members.length, accounts: plan.accounts.length, multiAccountMembers, names: plan.members.map((m) => m.displayName) });

    if (!dryRun) {
      const target = this.target!;
      await target.upsertGroup(IMPORT_GROUP);
      for (const m of plan.members) await target.upsertMember(m);
      for (const a of plan.accounts) await target.upsertSourceAccount(a);
      // Never downgrade an explicit V2 consent; otherwise record that consent is unknown and must be reconciled.
      const existing = new Map((await target.listConsents(IMPORT_GROUP.groupId)).map((c) => [c.memberId, c]));
      for (const c of plan.consents) if (existing.get(c.memberId)?.status !== 'explicit') await target.upsertConsent(c);
    }

    const resolveIdentity = (ref: string) => plan.resolver.get(ref) ?? null;
    const report: ImportReport = {
      dryRun, sourceVersions,
      identity: { members: plan.members.length, accounts: plan.accounts.length, multiAccountMembers, unresolvedAccounts: plan.unresolvedAccounts, collisions: 0,
        consentStatus: 'requires-reconciliation' },
      matches: { sourceRows: await this.source.matchCount(), processed: 0, inserted: 0, rewritten: 0, resumedSkips: 0, conflicts: 0, duplicates: 0 },
      diagnostics: { killsInUnknownRounds: 0, invalidKills: 0, snapshotsDroppedDuplicate: 0, snapshotsDroppedNonRoster: 0, snapshotsDroppedInvalid: 0, sideConflicts: 0,
        killOnlyParticipants: 0, economyOutOfDomain: 0 },
      rank: { sourceRows: 0, imported: 0, unresolvedAccount: 0, matchRefUnresolved: 0 },
      consentInferredFromEvidence: false, durationMs: 0,
    };
    const add = (d: NormalizeDiagnostics) => {
      report.diagnostics.killsInUnknownRounds += d.killsInUnknownRounds; report.diagnostics.invalidKills += d.invalidKills;
      report.diagnostics.snapshotsDroppedDuplicate += d.snapshotsDropped.duplicate; report.diagnostics.snapshotsDroppedNonRoster += d.snapshotsDropped.nonRoster;
      report.diagnostics.snapshotsDroppedInvalid += d.snapshotsDropped.invalid; report.diagnostics.sideConflicts += d.sideConflicts;
      report.diagnostics.killOnlyParticipants += d.killOnlyParticipants; report.diagnostics.economyOutOfDomain += d.economyOutOfDomain;
    };

    const seenKeys = new Set<string>();
    let after: string | null = null;
    pages: for (;;) {
      const page = await this.source.matchPage(after, pageSize);
      if (page.length === 0) break;
      for (const row of page) {
        after = row.provider_match_id;
        const metaId = (row.payload.metadata as { match_id?: unknown } | undefined)?.match_id;
        if (metaId !== row.provider_match_id) throw new SourceConflictError('payload match id does not match its source key');
        const refHash = sourceRefHash(row.provider_match_id);
        const checkpoint = this.target ? await this.target.getImportRecord(SOURCE_SYSTEM, refHash) : null;
        if (checkpoint && checkpoint.sourcePayloadSha256 !== row.payload_sha256) {
          report.matches.conflicts += 1;
          throw new SourceConflictError('a source record changed content since it was imported; refusing to overwrite silently');
        }
        if (options.resume && checkpoint && checkpoint.normalizerVersion === LEGACY_IMPORT_NORMALIZER_VERSION) { report.matches.resumedSkips += 1; continue; }
        const { match, diagnostics } = normalizeHenrikV4Match(row.payload, { resolveIdentity, observedAt: row.fetched_at, acquisitionSource: ACQUISITION_SOURCE });
        if (seenKeys.has(match.matchKey)) { report.matches.duplicates += 1; throw new SourceConflictError('duplicate canonical match in one source'); }
        seenKeys.add(match.matchKey);
        add(diagnostics);
        report.matches.processed += 1;
        if (!dryRun) {
          await this.target!.saveMatch(match, { sourceSystem: SOURCE_SYSTEM, sourceRefHash: refHash, sourcePayloadSha256: row.payload_sha256,
            normalizerVersion: LEGACY_IMPORT_NORMALIZER_VERSION, importedAt: now() });
          if (checkpoint) report.matches.rewritten += 1; else report.matches.inserted += 1;
        }
        if (options.maxMatches !== undefined && report.matches.processed >= options.maxMatches) break pages;
      }
      log('import_progress', { processed: report.matches.processed, inserted: report.matches.inserted, rewritten: report.matches.rewritten, resumedSkips: report.matches.resumedSkips });
    }

    const completed = options.maxMatches === undefined || report.matches.processed < options.maxMatches;
    if (completed) {
      const refIndex = await this.source.matchRefIndex();
      const rows = await this.source.rankRows();
      report.rank.sourceRows = rows.length;
      const contexts: RankContext[] = [];
      for (const r of rows) {
        const ids = plan.byLegacyAccount.get(r.account_public_id);
        if (!ids) { report.rank.unresolvedAccount += 1; continue; }
        const providerMatchId = r.match_ref ? refIndex.get(r.match_ref) : undefined;
        if (r.match_ref && !providerMatchId) report.rank.matchRefUnresolved += 1;
        contexts.push({
          rankContextId: `rk_${sha(`vsa-v2-rank-v1|${r.evidence_key}`).slice(0, 24)}`, memberId: ids.memberId, accountId: ids.accountId, kind: KIND[r.kind],
          effectiveAt: r.effective_at, matchKey: providerMatchId ? canonicalMatchKey(HENRIK_PROVIDER_ID, providerMatchId) : null, providerId: HENRIK_PROVIDER_ID,
          sourceEndpoint: r.source.slice(0, 80), providerTierId: r.provider_tier_id, providerTierName: r.provider_tier_name, rr: r.rr, rrChange: r.rr_change,
          providerElo: r.provider_elo, seasonKey: r.season_short, queue: r.queue, normalizedTierKey: r.normalized_tier_key, tierOrdinal: r.tier_ordinal,
          tierModelVersion: r.tier_model_version,
        });
      }
      if (!dryRun && contexts.length) await this.target!.saveRankContext(contexts);
      report.rank.imported = contexts.length;
    }
    report.durationMs = Date.now() - started;
    log('import_finished', { dryRun, completed, ...report.matches, rank: report.rank.imported, durationMs: report.durationMs });
    return report;
  }
}
