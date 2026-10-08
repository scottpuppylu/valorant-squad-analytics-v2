import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanPublicData, scanWebBundle } from './privacyScan.ts';

/**
 * Run after `npm run snapshot:demo` and the web build (the npm script does both):
 *   1. public-data: manifest + every snapshot file fully re-validated and content-scanned;
 *   2. web bundle: every built text file scanned for private markers, internal ids, secrets, DB strings, coordinates.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicData = await scanPublicData(join(root, 'apps/web/public/public-data'));
const bundle = await scanWebBundle(join(root, 'apps/web/dist'));
for (const f of [...publicData.findings, ...bundle.findings]) process.stdout.write(`  FINDING ${f.file}: ${f.problem}\n`);
process.stdout.write(`PUBLIC_DATA_FILES=${publicData.files}\nPUBLIC_DATA_PRIVACY=${publicData.findings.length ? 'FAIL' : 'PASS'}\n`);
process.stdout.write(`WEB_BUNDLE_FILES=${bundle.files}\nWEB_BUNDLE_PRIVACY=${bundle.findings.length ? 'FAIL' : 'PASS'}\n`);
const failed = publicData.findings.length + bundle.findings.length > 0;
process.stdout.write(`PRIVACY_CHECK=${failed ? 'FAIL' : 'PASS'}\n`);
process.exit(failed ? 1 : 0);
