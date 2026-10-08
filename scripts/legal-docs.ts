import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { policyMarkdown, PRIVACY_POLICY, TERMS_OF_SERVICE } from '../apps/web/src/legal.ts';

/** docs/PRIVACY_POLICY.md and docs/TERMS_OF_SERVICE.md are GENERATED from apps/web/src/legal.ts (the website's source). */
export const LEGAL_DOCS = [
  { file: 'docs/PRIVACY_POLICY.md', markdown: () => policyMarkdown(PRIVACY_POLICY) },
  { file: 'docs/TERMS_OF_SERVICE.md', markdown: () => policyMarkdown(TERMS_OF_SERVICE) },
] as const;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const d of LEGAL_DOCS) {
    const path = join(root, d.file);
    const next = d.markdown();
    if (check) { if ((await readFile(path, 'utf8').catch(() => '')) !== next) { stale += 1; process.stdout.write(`STALE ${d.file}\n`); } }
    else await writeFile(path, next, 'utf8');
  }
  process.stdout.write(`LEGAL_DOCS=${check ? (stale ? 'STALE' : 'IN_SYNC') : 'WRITTEN'}\n`);
  process.exit(stale ? 1 : 0);
}
