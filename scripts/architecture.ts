import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

/**
 * Deterministic dependency-boundary analysis (no LLM, no network). Parses import specifiers in every workspace's
 * src/ and counts violations per rule. `npm run check:architecture` fails when any count is non-zero.
 */
export interface SourceFile { workspace: string; path: string; source: string }
export interface Violation { rule: string; workspace: string; file: string; specifier: string }
export interface ArchitectureReport { counts: Record<string, number>; violations: Violation[]; filesScanned: number }

export const RULES = [
  'WEB_DB_IMPORTS', 'WEB_PROVIDER_IMPORTS', 'WEB_NON_STATIC_IMPORTS',
  'ANALYTICS_PROVIDER_SPECIFIC_IMPORTS', 'ANALYTICS_DB_IMPORTS',
  'CONTROL_PLANE_CANONICAL_TELEMETRY_IMPORTS',
  'BROWSER_UNSAFE_IMPORTS', 'CROSS_WORKSPACE_RELATIVE_IMPORTS', 'UNDECLARED_WORKSPACE_DEPENDENCIES',
  'LEGACY_IMPORTER_IN_CORE_IMPORTS', 'PROVIDER_TYPES_OUTSIDE_ADAPTERS',
  'CONTROL_PLANE_CANONICAL_MATCH_STORAGE', 'CONTROL_PLANE_PROVIDER_NETWORK_CALLS', 'CONTROL_PLANE_ANALYTICS_IMPORTS',
] as const;

const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:'"`])\/\/.*$/gmu, '$1');

export function importSpecifiers(source: string): string[] {
  const text = stripComments(source);
  const found = new Set<string>();
  for (const m of text.matchAll(/\b(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,]*?\s+from\s+)?['"]([^'"\n]+)['"]/gu)) found.add(m[1]!);
  for (const m of text.matchAll(/\bimport\(\s*['"]([^'"\n]+)['"]\s*\)/gu)) found.add(m[1]!);
  return [...found].sort();
}

const isDb = (s: string) => s === 'pg' || s.startsWith('pg/') || s.startsWith('@electric-sql/pglite') || s.startsWith('@vsa/canonical-data');
const isProviderSpecific = (s: string) => s.startsWith('@vsa/source-adapters') || /henrik|riot|overwolf|tracker|blitz/iu.test(s) || /(^|\/)fake(\/|$)/u.test(s);
const WEB_ALLOWED = [/^react$/u, /^react\/jsx-runtime$/u, /^react-dom$/u, /^react-dom\/client$/u, /^@vsa\/contracts\/(public|versions|common|team-composition|product)$/u, /^@vsa\/privacy$/u, /^\.\.?\//u];
const ANALYTICS_ALLOWED = [/^@vsa\/contracts\/(canonical|analysis|common|versions|team-composition|product)$/u, /^\.\.?\//u];
const CONTROL_FORBIDDEN = (s: string) => isDb(s) || s.startsWith('@vsa/analytics') || s.startsWith('@vsa/source-adapters') || s.startsWith('@vsa/collector')
  || s === '@vsa/contracts' || s === '@vsa/contracts/canonical' || s === '@vsa/contracts/analysis';
/**
 * Provider-specific adapter code (`@vsa/source-adapters/<provider>`) and provider endpoints stay inside
 * packages/source-adapters. The only exception is the one-way legacy importer, which uses the shared Henrik v4
 * normalizer. (`/fake` is the synthetic demo provider and is governed by the WEB / ANALYTICS rules.)
 */
const PROVIDER_SUBPATH = /^@vsa\/source-adapters\/(henrik|riot|overwolf|import)(\/|$)/u;
const PROVIDER_ENDPOINT = /henrikdev\.xyz|api\.riotgames\.com|\.api\.riotgames\.com|tracker\.gg\/api|overwolf\.games/iu;
const providerSubpathAllowed = (workspace: string, specifier: string) => workspace === 'packages/source-adapters'
  || (workspace === 'apps/legacy-importer' && specifier === '@vsa/source-adapters/henrik');
/**
 * Control plane (apps/control-api): metadata only. It must not model canonical match telemetry, must not make outbound
 * provider / network calls (the local worker polls it, never the reverse), and must not reach analytics or the exporter.
 */
const CONTROL_TELEMETRY = /\b(CanonicalMatch|CanonicalRound|CanonicalEvent|CanonicalParticipant|playerSnapshots|providerRecordRef|matchKey|kill_events|round_participants|viewRadians)\b/u;
const CONTROL_NETWORK = /\bfetch\s*\(|\bhttps?\.(request|get)\s*\(|\bXMLHttpRequest\b|\bnew\s+WebSocket\b|henrikdev|riotgames\.com|overwolf|tracker\.gg/iu;
const CONTROL_NETWORK_MODULES = (s: string) => s === 'node:https' || s === 'https' || s === 'undici' || s === 'axios' || s === 'node-fetch'
  || s.startsWith('@vsa/source-adapters');
const BROWSER_SAFE_WORKSPACES = new Set(['packages/contracts', 'packages/privacy', 'apps/web']);

export function analyzeFiles(files: readonly SourceFile[], declaredDependencies: ReadonlyMap<string, ReadonlySet<string>> = new Map()): ArchitectureReport {
  const violations: Violation[] = [];
  const add = (rule: string, f: SourceFile, specifier: string) => violations.push({ rule, workspace: f.workspace, file: f.path, specifier });
  for (const f of files) {
    if (f.workspace === 'apps/control-api') {
      const code = stripComments(f.source);
      if (CONTROL_TELEMETRY.test(code)) add('CONTROL_PLANE_CANONICAL_MATCH_STORAGE', f, '<canonical telemetry identifier>');
      if (CONTROL_NETWORK.test(code)) add('CONTROL_PLANE_PROVIDER_NETWORK_CALLS', f, '<outbound network call>');
      for (const s of importSpecifiers(f.source)) {
        if (CONTROL_NETWORK_MODULES(s)) add('CONTROL_PLANE_PROVIDER_NETWORK_CALLS', f, s);
        if (s.startsWith('@vsa/analytics') || s.startsWith('@vsa/exporter')) add('CONTROL_PLANE_ANALYTICS_IMPORTS', f, s);
      }
    }
    if (f.workspace !== 'packages/source-adapters' && PROVIDER_ENDPOINT.test(stripComments(f.source))) add('PROVIDER_TYPES_OUTSIDE_ADAPTERS', f, '<provider endpoint literal>');
    for (const s of importSpecifiers(f.source)) {
      if (PROVIDER_SUBPATH.test(s) && !providerSubpathAllowed(f.workspace, s)) add('PROVIDER_TYPES_OUTSIDE_ADAPTERS', f, s);
      if (f.workspace === 'apps/web') {
        if (isDb(s)) add('WEB_DB_IMPORTS', f, s);
        else if (isProviderSpecific(s)) add('WEB_PROVIDER_IMPORTS', f, s);
        else if (!WEB_ALLOWED.some((rx) => rx.test(s)) && !s.endsWith('.css')) add('WEB_NON_STATIC_IMPORTS', f, s);
      }
      if (f.workspace === 'packages/analytics') {
        if (isProviderSpecific(s)) add('ANALYTICS_PROVIDER_SPECIFIC_IMPORTS', f, s);
        else if (isDb(s)) add('ANALYTICS_DB_IMPORTS', f, s);
        else if (!ANALYTICS_ALLOWED.some((rx) => rx.test(s))) add('ANALYTICS_PROVIDER_SPECIFIC_IMPORTS', f, s);
      }
      // The legacy import adapter is a one-way, optional edge: no core package or app may depend on it.
      if (f.workspace !== 'apps/legacy-importer' && s.startsWith('@vsa/legacy-importer')) add('LEGACY_IMPORTER_IN_CORE_IMPORTS', f, s);
      if (f.workspace === 'apps/control-api' && CONTROL_FORBIDDEN(s)) add('CONTROL_PLANE_CANONICAL_TELEMETRY_IMPORTS', f, s);
      if (BROWSER_SAFE_WORKSPACES.has(f.workspace) && (s.startsWith('node:') || ['fs', 'path', 'crypto', 'child_process', 'os'].includes(s))) add('BROWSER_UNSAFE_IMPORTS', f, s);
      if (s.startsWith('.')) {
        const target = resolve(dirname(resolve('/', f.path)), s);
        const workspaceRoot = resolve('/', f.workspace);
        if (target !== workspaceRoot && !target.startsWith(workspaceRoot + sep)) add('CROSS_WORKSPACE_RELATIVE_IMPORTS', f, s);
      }
      const pkg = /^(@vsa\/[^/]+)/u.exec(s)?.[1];
      const declared = declaredDependencies.get(f.workspace);
      if (pkg && declared && !declared.has(pkg)) add('UNDECLARED_WORKSPACE_DEPENDENCIES', f, s);
    }
  }
  const counts = Object.fromEntries(RULES.map((rule) => [rule, violations.filter((v) => v.rule === rule).length]));
  return { counts, violations, filesScanned: files.length };
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!['node_modules', 'dist', 'public'].includes(e.name)) out.push(...(await walk(p))); }
    else if (/\.(ts|tsx|mts)$/u.test(e.name)) out.push(p);
  }
  return out;
}

export async function analyzeArchitecture(root: string): Promise<ArchitectureReport> {
  const files: SourceFile[] = [];
  const declared = new Map<string, Set<string>>();
  for (const group of ['apps', 'packages']) {
    for (const name of (await readdir(join(root, group))).sort()) {
      const workspace = `${group}/${name}`;
      const pkg = JSON.parse(await readFile(join(root, workspace, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; name?: string };
      declared.set(workspace, new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {}), ...(pkg.name ? [pkg.name] : [])]));
      for (const path of (await walk(join(root, workspace, 'src'))).sort()) {
        files.push({ workspace, path: relative(root, path).split(sep).join('/'), source: await readFile(path, 'utf8') });
      }
    }
  }
  return analyzeFiles(files, declared);
}
