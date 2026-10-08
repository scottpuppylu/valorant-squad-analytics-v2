import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeArchitecture } from './architecture.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const report = await analyzeArchitecture(root);
for (const [rule, count] of Object.entries(report.counts)) process.stdout.write(`${rule}=${count}\n`);
process.stdout.write(`FILES_SCANNED=${report.filesScanned}\n`);
for (const v of report.violations) process.stdout.write(`  VIOLATION ${v.rule} ${v.file} -> ${v.specifier}\n`);
const failed = report.violations.length > 0;
process.stdout.write(`ARCHITECTURE_CHECK=${failed ? 'FAIL' : 'PASS'}\n`);
process.exit(failed ? 1 : 0);
