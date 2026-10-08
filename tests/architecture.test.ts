import { describe, expect, it } from 'vitest';
import { analyzeArchitecture, analyzeFiles, importSpecifiers, RULES } from '../scripts/architecture.ts';

describe('architecture boundaries (repository)', () => {
  it('every boundary count is zero', async () => {
    const report = await analyzeArchitecture(process.cwd());
    expect(report.filesScanned).toBeGreaterThan(30);
    expect(report.violations).toEqual([]);
    for (const rule of RULES) expect(report.counts[rule]).toBe(0);
  });
});

describe('architecture checker detects violations (self-test)', () => {
  const one = (workspace: string, source: string, declared?: string[]) =>
    analyzeFiles([{ workspace, path: `${workspace}/src/x.ts`, source }], declared ? new Map([[workspace, new Set(declared)]]) : new Map());

  it('parses import / export / dynamic / type-only specifiers and ignores comments', () => {
    expect(importSpecifiers(`import a from 'a';\nimport type { B } from "b";\nexport * from './c.ts';\nexport { d } from 'd';\nconst e = await import('e');\n// import x from 'ignored'\n/* import y from 'ignored2' */`))
      .toEqual(['./c.ts', 'a', 'b', 'd', 'e']);
  });

  it.each([
    ['apps/web', `import pg from 'pg';`, 'WEB_DB_IMPORTS'],
    ['apps/web', `import { x } from '@vsa/canonical-data';`, 'WEB_DB_IMPORTS'],
    ['apps/web', `import { FakeProviderAdapter } from '@vsa/source-adapters';`, 'WEB_PROVIDER_IMPORTS'],
    ['apps/web', `import { readFile } from 'node:fs/promises';`, 'WEB_NON_STATIC_IMPORTS'],
    ['apps/web', `import { computeBasicPlayerStats } from '@vsa/analytics';`, 'WEB_NON_STATIC_IMPORTS'],
    ['packages/analytics', `import type { FakeMatchPayload } from '@vsa/source-adapters/fake';`, 'ANALYTICS_PROVIDER_SPECIFIC_IMPORTS'],
    ['packages/analytics', `import type { HenrikMatch } from './henrik/types.ts';`, 'ANALYTICS_PROVIDER_SPECIFIC_IMPORTS'],
    ['packages/analytics', `import { PostgresCanonicalRepository } from '@vsa/canonical-data';`, 'ANALYTICS_DB_IMPORTS'],
    ['apps/control-api', `import type { CanonicalMatch } from '@vsa/contracts/canonical';`, 'CONTROL_PLANE_CANONICAL_TELEMETRY_IMPORTS'],
    ['apps/control-api', `import { applyMigrations } from '@vsa/canonical-data';`, 'CONTROL_PLANE_CANONICAL_TELEMETRY_IMPORTS'],
    ['packages/privacy', `import { createHash } from 'node:crypto';`, 'BROWSER_UNSAFE_IMPORTS'],
    ['packages/exporter', `import { x } from '../../privacy/src/index.ts';`, 'CROSS_WORKSPACE_RELATIVE_IMPORTS'],
    ['packages/canonical-data', `import { normalizeHenrikV4Match } from '@vsa/legacy-importer';`, 'LEGACY_IMPORTER_IN_CORE_IMPORTS'],
    ['apps/collector', `import { LegacyEvidenceImportAdapter } from '@vsa/legacy-importer';`, 'LEGACY_IMPORTER_IN_CORE_IMPORTS'],
    ['apps/collector', `import { HenrikAdapter } from '@vsa/source-adapters/henrik';`, 'PROVIDER_TYPES_OUTSIDE_ADAPTERS'],
    ['packages/exporter', `import { RiotAdapter } from '@vsa/source-adapters/riot';`, 'PROVIDER_TYPES_OUTSIDE_ADAPTERS'],
    ['packages/analytics', `import type { X } from '@vsa/source-adapters/import';`, 'PROVIDER_TYPES_OUTSIDE_ADAPTERS'],
    ['apps/legacy-importer', `import { RiotAdapter } from '@vsa/source-adapters/riot';`, 'PROVIDER_TYPES_OUTSIDE_ADAPTERS'],
    ['apps/collector', `const base = 'https://api.henrikdev.xyz/valorant';`, 'PROVIDER_TYPES_OUTSIDE_ADAPTERS'],
  ])('%s: %s → %s', (workspace, source, rule) => {
    expect(one(workspace, source).counts[rule]).toBe(1);
  });

  it('the one-way legacy importer may use the shared Henrik v4 normalizer; source-adapters may use its own subpaths', () => {
    expect(one('apps/legacy-importer', `export { normalizeHenrikV4Match } from '@vsa/source-adapters/henrik';`).counts.PROVIDER_TYPES_OUTSIDE_ADAPTERS).toBe(0);
    expect(one('packages/source-adapters', `import { HenrikAdapter } from '@vsa/source-adapters/henrik';`).counts.PROVIDER_TYPES_OUTSIDE_ADAPTERS).toBe(0);
  });

  it('flags workspace imports that are not declared dependencies', () => {
    expect(one('packages/exporter', `import { x } from '@vsa/analytics';`, ['@vsa/contracts']).counts.UNDECLARED_WORKSPACE_DEPENDENCIES).toBe(1);
  });
});
