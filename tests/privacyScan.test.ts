import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runDemoPipeline } from '@vsa/collector';
import { fixtureCoordinates } from '@vsa/source-adapters/fake';
import { scanPublicData, scanWebBundle } from '../scripts/privacyScan.ts';
import { OBSERVED_AT, withTempDir } from './helpers.ts';

/** The privacy scanners must actually detect leaks — a clean result is only meaningful if dirty input fails. */
describe('privacy scanners detect planted leaks', () => {
  it('public-data scan flags private markers, internal ids and tampering', () => withTempDir(async (root) => {
    const { snapshotId } = await runDemoPipeline({ outDir: root, now: () => OBSERVED_AT });
    const file = join(root, 'snapshots', snapshotId, 'players.json');
    await writeFile(file, (await readFile(file, 'utf8')).replace('"Nova"', '"Nova fake-puuid-0001-nova member-nova"'), 'utf8');
    const problems = (await scanPublicData(root)).findings.map((f) => f.problem).join('\n');
    for (const expected of ['sha256 mismatch', 'private fixture marker fake-puuid-', 'internal id internal-member-id']) expect(problems).toContain(expected);
  }));

  it('web bundle scan flags secrets, database strings, fixture markers and raw coordinates', () => withTempDir(async (dist) => {
    await mkdir(join(dist, 'assets'), { recursive: true });
    await writeFile(join(dist, 'index.html'), '<html></html>', 'utf8');
    expect((await scanWebBundle(dist)).findings).toEqual([]);
    const coordinate = String(fixtureCoordinates()[0]);
    await writeFile(join(dist, 'assets', 'app.js'), `const a="postgres://u:p@localhost/db";const b="FAKE-PROVIDER-SECRET-DO-NOT-PUBLISH";const c=${coordinate};const d="DATABASE_URL";`, 'utf8');
    const problems = (await scanWebBundle(dist)).findings.map((f) => f.problem).join('\n');
    for (const expected of ['secret pattern postgres-connection-string', 'private fixture marker FAKE-PROVIDER-SECRET', `raw fixture coordinate ${coordinate}`, 'database string DATABASE_URL']) {
      expect(problems).toContain(expected);
    }
  }));
});
