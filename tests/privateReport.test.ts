import { readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPrivateReport, IngestService, privateOutputDir, scanPrivateReport } from '@vsa/collector';
import { validateManifest } from '@vsa/privacy';
import { FakeProviderAdapter } from '@vsa/source-adapters';
import { freshDatabase, OBSERVED_AT, seedDemoRoster } from './helpers.ts';

const repoRoot = resolve(import.meta.dirname, '..');

describe('private operator report (local only, never publishable)', () => {
  it('may only be written under <repo>/.private/ — never the public web data or anywhere else', () => {
    expect(privateOutputDir(repoRoot)).toBe(join(repoRoot, '.private', 'operator-report'));
    for (const bad of [join(repoRoot, 'apps/web/public/public-data'), join(repoRoot, '.private', '..', 'apps'), repoRoot, resolve(repoRoot, '..', 'elsewhere')]) {
      expect(() => privateOutputDir(repoRoot, bad)).toThrow(/\.private/u);
    }
  });

  it('the scanner rejects internal ids, provider ids, match keys, coordinates and connection strings', () => {
    for (const leak of ['cm_0123456789abcdef01234567', 'member-nova', 'account-nova', 'pk_0123456789abcdef', '{"x": 1}', 'puuid', 'postgres://u:p@h/db', '00000000-0000-4000-8000-000000000000']) {
      expect(scanPrivateReport(`ok ${leak} ok`).length).toBeGreaterThan(0);
    }
    expect(scanPrivateReport('{"name": "Nova", "communityScore": 48.5}')).toEqual([]);
  });

  it('covers every member (operator view), passes its own scan and is not a snapshot any publisher would accept', async () => {
    const { sql, repository } = await freshDatabase();
    await seedDemoRoster(repository);
    await new IngestService(repository, new FakeProviderAdapter(), () => OBSERVED_AT).ingestGroup('group-demo', { maxMatchesPerAccount: 200 });
    const out = join(repoRoot, '.private', `test-report-${process.pid}`);
    try {
      const result = await buildPrivateReport(repository, 'group-demo', out);
      expect(result.findings).toEqual([]);
      const report = JSON.parse(await readFile(join(out, 'operator-report.json'), 'utf8'));
      expect(report.banner).toMatch(/PRIVATE \/ LOCAL ONLY/u);
      expect(report.members.map((m: { name: string }) => m.name)).toContain('Pike'); // operator view includes non-public members
      expect(() => validateManifest(report)).toThrow();
    } finally {
      await rm(out, { recursive: true, force: true });
      await sql.close();
    }
  });
});
