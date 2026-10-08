import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { PUBLIC_FILE_NAMES } from '@vsa/contracts/public';
import { findSecretPatterns, validateManifest, validatePublicDocument } from '@vsa/privacy';
import { fixtureCoordinates, PRIVATE_FIXTURE_MARKERS } from '@vsa/source-adapters/fake';

/** Internal identifier shapes that must never be published (canonical keys, internal member/account/group ids). */
const INTERNAL_ID_PATTERNS: readonly [string, RegExp][] = [
  ['canonical-match-key', /\bcm_[0-9a-f]{24}\b/u],
  ['internal-member-id', /\bmember-[a-z0-9-]+\b/u],
  ['internal-account-id', /\baccount-[a-z0-9-]+\b/u],
  ['internal-group-id', /\bgroup-demo\b/u],
];
const DB_STRINGS = ['DATABASE_URL', 'postgres://', 'postgresql://', 'PGPASSWORD', 'PGHOST', 'POSTGRES_PASSWORD'];
/** Operator / provider markers that must never reach a public artifact (private reports, credential files, provider runtime). */
const OPERATOR_MARKERS = ['.private/', 'provider.env', 'HENRIK_API_KEY', 'RIOT_API_KEY', 'api.henrikdev.xyz', 'api.riotgames.com', 'IDENTIFIER_HMAC_KEY'];
/** Riot PUUIDs are 78-character url-safe tokens; nothing public has that shape. */
const PUUID_SHAPE = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{78}(?![A-Za-z0-9_-])/u;

export interface ScanFinding { file: string; problem: string }

function scanText(file: string, text: string, coordinateStrings: readonly string[]): ScanFinding[] {
  const findings: ScanFinding[] = [];
  for (const marker of PRIVATE_FIXTURE_MARKERS) if (text.includes(marker)) findings.push({ file, problem: `private fixture marker ${marker}` });
  for (const name of findSecretPatterns(text)) findings.push({ file, problem: `secret pattern ${name}` });
  for (const [name, rx] of INTERNAL_ID_PATTERNS) if (rx.test(text)) findings.push({ file, problem: `internal id ${name}` });
  for (const s of DB_STRINGS) if (text.includes(s)) findings.push({ file, problem: `database string ${s}` });
  for (const s of OPERATOR_MARKERS) if (text.includes(s)) findings.push({ file, problem: `operator / provider marker ${s}` });
  if (PUUID_SHAPE.test(text)) findings.push({ file, problem: 'puuid-shaped token' });
  const hit = coordinateStrings.find((c) => text.includes(c));
  if (hit) findings.push({ file, problem: `raw fixture coordinate ${hit}` });
  return findings;
}

const collectNumbers = (value: unknown, out: number[] = []): number[] => {
  if (typeof value === 'number') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectNumbers(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectNumbers(v, out));
  return out;
};

/** Full validation of a published public-data root: manifest, hashes, documents, plus content scans. */
export async function scanPublicData(root: string): Promise<{ files: number; findings: ScanFinding[] }> {
  const coordinates = new Set(fixtureCoordinates());
  const coordinateStrings = [...coordinates].map(String);
  const findings: ScanFinding[] = [];
  const manifestText = await readFile(join(root, 'manifest.json'), 'utf8');
  findings.push(...scanText('manifest.json', manifestText, coordinateStrings));
  const manifest = validateManifest(JSON.parse(manifestText));
  let files = 1;
  for (const entry of manifest.active.files) {
    const rel = `${manifest.active.path}/${entry.name}`;
    const text = await readFile(join(root, manifest.active.path, entry.name), 'utf8');
    files += 1;
    if (createHash('sha256').update(text, 'utf8').digest('hex') !== entry.sha256) findings.push({ file: rel, problem: 'sha256 mismatch' });
    if (PUBLIC_FILE_NAMES[entry.kind] !== entry.name) findings.push({ file: rel, problem: 'kind/name mismatch' });
    const json = JSON.parse(text) as unknown;
    try { validatePublicDocument(entry.kind, json); } catch (error) { findings.push({ file: rel, problem: `invalid public document: ${(error as Error).message}` }); }
    if (collectNumbers(json).some((n) => coordinates.has(n))) findings.push({ file: rel, problem: 'raw fixture coordinate value' });
    findings.push(...scanText(rel, text, coordinateStrings));
  }
  return { files, findings };
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

/** Scan every text file of the built web bundle (JS, CSS, HTML, copied public JSON). */
export async function scanWebBundle(distDir: string): Promise<{ files: number; findings: ScanFinding[] }> {
  await stat(distDir);
  const coordinateStrings = fixtureCoordinates().map(String);
  const findings: ScanFinding[] = [];
  const paths = (await walk(distDir)).filter((p) => /\.(js|mjs|css|html|json|txt|map|svg)$/u.test(p)).sort();
  for (const p of paths) findings.push(...scanText(p.slice(distDir.length + 1).split('\\').join('/'), await readFile(p, 'utf8'), coordinateStrings));
  return { files: paths.length, findings };
}
