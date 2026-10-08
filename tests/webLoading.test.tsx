import { createHash } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { runDemoPipeline } from '@vsa/collector';
import { Page, Shell } from '../apps/web/src/App.tsx';
import { DEMO_GROUP } from '@vsa/collector';
import { StatusView } from '../apps/web/src/components/StatusView.tsx';
import { loadSnapshot, type Fetcher, type SnapshotState } from '../apps/web/src/data/loadSnapshot.ts';
import { ROUTES } from '../apps/web/src/router.ts';
import { ACTIVATED_AT, OBSERVED_AT, withTempDir } from './helpers.ts';

/** A static-host stand-in: serves files under `root` at `public-data/...`; 404 when absent. */
const fsFetcher = (root: string): Fetcher => async (path) => {
  try {
    const text = await readFile(join(root, path.replace(/^public-data\//u, '')), 'utf8');
    return { ok: true, status: 200, text: async () => text };
  } catch {
    return { ok: false, status: 404, text: async () => '' };
  }
};

const publish = (root: string) => runDemoPipeline({ outDir: root, now: () => OBSERVED_AT, activatedAt: ACTIVATED_AT });
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

describe('static web loading', () => {
  it('loads a published snapshot (ready) and renders the Dashboard from it', () => withTempDir(async (root) => {
    const { snapshotId } = await publish(root);
    const state = await loadSnapshot(fsFetcher(root));
    expect(state.status).toBe('ready');
    const html = renderToString(<Shell route={{ page: 'dashboard' }} state={state} />);
    for (const text of [DEMO_GROUP.name, snapshotId, 'public-snapshot-v2', 'Nova', 'Juno', '近期表現', '目前可追蹤紀錄']) expect(html).toContain(text);
    expect(html).not.toContain('Pike');
    expect(renderToString(<Page route="/players" state={state} />)).toContain('Rook');
  }));

  it('empty: no manifest published yet', () => withTempDir(async (root) => {
    expect((await loadSnapshot(fsFetcher(root))).status).toBe('empty');
  }));

  it('invalid manifest: not JSON, or schema-invalid', () => withTempDir(async (root) => {
    await writeFile(join(root, 'manifest.json'), '{not json', 'utf8');
    expect((await loadSnapshot(fsFetcher(root))).status).toBe('invalid-manifest');
    await publish(root);
    const m = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
    m.active.path = 'snapshots/../../etc';
    await writeFile(join(root, 'manifest.json'), JSON.stringify(m), 'utf8');
    expect((await loadSnapshot(fsFetcher(root))).status).toBe('invalid-manifest');
  }));

  it('unsupported snapshot version', () => withTempDir(async (root) => {
    await publish(root);
    const m = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
    await writeFile(join(root, 'manifest.json'), JSON.stringify({ ...m, manifestVersion: 'manifest-v9' }), 'utf8');
    expect((await loadSnapshot(fsFetcher(root))).status).toBe('unsupported-version');
  }));

  it('missing snapshot file', () => withTempDir(async (root) => {
    const { snapshotId } = await publish(root);
    await rm(join(root, 'snapshots', snapshotId, 'analytics.json'));
    expect((await loadSnapshot(fsFetcher(root))).status).toBe('missing-snapshot');
  }));

  it('a file that does not match its manifest hash is refused', () => withTempDir(async (root) => {
    const { snapshotId } = await publish(root);
    const f = join(root, 'snapshots', snapshotId, 'group.json');
    await writeFile(f, (await readFile(f, 'utf8')).replace(DEMO_GROUP.name, 'Other Squad'), 'utf8');
    expect((await loadSnapshot(fsFetcher(root))).status).toBe('invalid-manifest');
  }));

  it('privacy validation failure: a private field with a matching hash is still refused', () => withTempDir(async (root) => {
    const { snapshotId } = await publish(root);
    const f = join(root, 'snapshots', snapshotId, 'group.json');
    const leaked = (await readFile(f, 'utf8')).replace('"displayName": "Nova"', '"displayName": "Nova", "puuid": "leak"');
    await writeFile(f, leaked, 'utf8');
    const m = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
    m.active.files = m.active.files.map((x: { name: string }) => (x.name === 'group.json' ? { ...x, sha256: sha(leaked), bytes: Buffer.byteLength(leaked) } : x));
    await writeFile(join(root, 'manifest.json'), JSON.stringify(m), 'utf8');
    const state = await loadSnapshot(fsFetcher(root));
    expect(state.status).toBe('privacy-failure');
    expect(renderToString(<Page route="/" state={state} />)).not.toContain('Nova');
  }));

  it('every non-ready state renders an explicit, non-silent status', () => {
    const states: Exclude<SnapshotState, { status: 'ready' }>[] = [
      { status: 'loading' }, { status: 'empty', detail: 'd' }, { status: 'invalid-manifest', detail: 'd' },
      { status: 'unsupported-version', detail: 'd' }, { status: 'missing-snapshot', detail: 'd' }, { status: 'privacy-failure', detail: 'd' },
    ];
    for (const s of states) expect(renderToString(<StatusView state={s} />)).toContain(`data-status="${s.status}"`);
  });

  it('declares the six product routes plus the reviewer pages (product overview, opt-in walkthrough)', () => {
    expect(ROUTES.map((r) => r.path)).toEqual(['/', '/players', '/compare', '/synergy', '/team-builder', '/about', '/product', '/demo-flow']);
    for (const r of ROUTES) expect(renderToString(<Page route={r.path} state={{ status: 'loading' }} />).length).toBeGreaterThan(0);
  });
});
