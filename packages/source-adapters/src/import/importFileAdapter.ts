import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { CanonicalMatch } from '@vsa/contracts/canonical';
import { IsoInstant } from '@vsa/contracts/common';
import {
  MAX_MATCH_PAGE_SIZE, type DataProviderAdapter, type GetMatchInput, type ListMatchesInput, type ListMatchesResult, type ProviderCapability,
} from '../adapter.ts';
import { ProviderError } from '../errors.ts';
import { HENRIK_V4_MATCH_ARCHIVE_FORMAT, type ArchivePayloadFormat } from '../henrik/archiveFormat.ts';

export const IMPORT_FILE_PROVIDER_ID = 'import-file';
export const IMPORT_FILE_ADAPTER_VERSION = 'import-file-adapter-v1';
export const IMPORT_ARCHIVE_FORMAT = 'vsa-match-archive-v1';
export const DEFAULT_IMPORT_MAX_BYTES = 32 * 1024 * 1024;
export const MAX_IMPORT_BYTES = 64 * 1024 * 1024;
export const MAX_IMPORT_RECORDS = 5_000;

/** Registered payload formats. A format not listed here is rejected — there is no dynamic loading. */
export const ARCHIVE_PAYLOAD_FORMATS: ReadonlyMap<string, ArchivePayloadFormat> = new Map([[HENRIK_V4_MATCH_ARCHIVE_FORMAT.payloadFormat, HENRIK_V4_MATCH_ARCHIVE_FORMAT]]);

const ArchiveEnvelope = z.object({
  format: z.literal(IMPORT_ARCHIVE_FORMAT),
  payloadFormat: z.string().min(1).max(40),
  exportedAt: IsoInstant,
  records: z.array(z.object({ payload: z.record(z.string(), z.unknown()) }).strict()).min(1).max(MAX_IMPORT_RECORDS),
}).strict();

const fail = (message: string) => new ProviderError({ kind: 'MALFORMED_RESPONSE', providerId: IMPORT_FILE_PROVIDER_ID, message: `import archive rejected: ${message}` });

export interface OpenImportFileOptions {
  /** The only directory imports may be read from (operator-configured). */
  rootDir: string;
  /** A `.json` file path RELATIVE to rootDir. Absolute paths, `..` segments and symlinks are rejected. */
  relativePath: string;
  maxBytes?: number;
}

/**
 * Owner-provided match archives (`vsa-match-archive-v1`) → canonical evidence. PRIVATE by default: imported evidence
 * is ordinary private canonical evidence, subject to the same consent gates as any acquisition; importing never grants
 * visibility or publication. Reads JSON only (no code execution), inside one root directory, with size / record limits.
 */
export class ImportFileAdapter implements DataProviderAdapter {
  readonly providerId = IMPORT_FILE_PROVIDER_ID;
  readonly providerVersion = IMPORT_FILE_ADAPTER_VERSION;
  readonly recordNamespace: string;
  private readonly format: ArchivePayloadFormat;
  private readonly byRef: ReadonlyMap<string, Record<string, unknown>>;
  private readonly order: readonly string[];

  private constructor(format: ArchivePayloadFormat, records: readonly Record<string, unknown>[]) {
    this.format = format;
    this.recordNamespace = format.recordNamespace;
    const byRef = new Map<string, Record<string, unknown>>();
    for (const payload of records) {
      const ref = format.recordRef(payload);
      if (!ref) throw fail('record without a record reference');
      if (byRef.has(ref)) throw fail('duplicate record reference');
      byRef.set(ref, payload);
    }
    this.byRef = byRef;
    this.order = [...byRef.keys()];
  }

  /** Validate an already-parsed archive document (tests, or callers that read the file themselves). */
  static fromDocument(document: unknown): ImportFileAdapter {
    const parsed = ArchiveEnvelope.safeParse(document);
    if (!parsed.success) throw fail('envelope violates vsa-match-archive-v1');
    const format = ARCHIVE_PAYLOAD_FORMATS.get(parsed.data.payloadFormat);
    if (!format) throw fail('unsupported payload format');
    return new ImportFileAdapter(format, parsed.data.records.map((r) => r.payload));
  }

  static async open(options: OpenImportFileOptions): Promise<ImportFileAdapter> {
    const maxBytes = options.maxBytes ?? DEFAULT_IMPORT_MAX_BYTES;
    if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_IMPORT_BYTES) throw new ProviderError({ kind: 'MISCONFIGURED', providerId: IMPORT_FILE_PROVIDER_ID, message: 'invalid maxBytes' });
    const rel = options.relativePath;
    if (typeof rel !== 'string' || rel.length === 0 || rel.length > 255 || rel.includes('\u0000') || isAbsolute(rel) || /^[A-Za-z]:/u.test(rel)
      || rel.split(/[\\/]/u).some((segment) => segment === '..') || !rel.toLowerCase().endsWith('.json')) {
      throw fail('path must be a relative .json path inside the import root');
    }
    const root = await realpath(options.rootDir);
    const candidate = resolve(root, rel);
    const info = await lstat(candidate).catch(() => null);
    if (!info || !info.isFile() || info.isSymbolicLink()) throw fail('not a regular file');
    const real = await realpath(candidate);
    const inside = relative(root, real);
    if (inside === '' || inside.startsWith('..') || isAbsolute(inside) || inside.split(sep).includes('..')) throw fail('path escapes the import root');
    if (info.size > maxBytes) throw fail('file exceeds the size limit');
    const text = await readFile(real, 'utf8');
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw fail('file exceeds the size limit');
    let document: unknown;
    try { document = JSON.parse(text); } catch { throw fail('not valid JSON'); }
    return ImportFileAdapter.fromDocument(document);
  }

  capabilities(): ReadonlySet<ProviderCapability> {
    return new Set<ProviderCapability>(['MATCH_HISTORY', 'MATCH_DETAIL']);
  }

  get recordCount(): number { return this.order.length; }

  /** Archive order, bounded pages. The archive is a provider-visible subset, never a career. */
  async listMatches(input: ListMatchesInput): Promise<ListMatchesResult> {
    const size = Math.max(1, Math.min(MAX_MATCH_PAGE_SIZE, Math.trunc(input.limit)));
    const start = input.cursor === null ? 0 : Number(input.cursor);
    if (!Number.isSafeInteger(start) || start < 0) throw new ProviderError({ kind: 'BAD_REQUEST', providerId: this.providerId, capability: 'MATCH_HISTORY', message: 'invalid cursor' });
    const mine = this.order.filter((ref) => this.format.participantRefs(this.byRef.get(ref)!).includes(input.providerAccountRef));
    const page = mine.slice(start, start + size);
    return { matchRefs: page, nextCursor: start + page.length < mine.length ? String(start + page.length) : null,
      history: { completeness: 'provider-visible', lifetimeComplete: false, pageOffset: start, pageSize: size, returned: page.length, providerReportedTotal: null } };
  }

  async getMatch(input: GetMatchInput): Promise<CanonicalMatch> {
    const payload = this.byRef.get(input.matchRef);
    if (!payload) throw new ProviderError({ kind: 'NOT_FOUND', providerId: this.providerId, capability: 'MATCH_DETAIL', message: 'record not in archive' });
    try {
      return this.format.normalize(payload, { resolveIdentity: input.resolveIdentity, observedAt: input.observedAt,
        acquisitionSource: `${IMPORT_FILE_ADAPTER_VERSION}:${this.format.payloadFormat}`, normalizerVersion: `${this.format.payloadFormat}-archive-v1` });
    } catch {
      throw new ProviderError({ kind: 'MALFORMED_RESPONSE', providerId: this.providerId, capability: 'MATCH_DETAIL', message: 'archive record failed canonical normalization' });
    }
  }
}
