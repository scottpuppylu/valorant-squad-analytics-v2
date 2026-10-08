import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dispatch } from './handlers.ts';
import type { Principal } from './model.ts';
import type { ControlPlaneService } from './service.ts';

export const LOCAL_BIND_HOST = '127.0.0.1';
const MAX_BODY_BYTES = 64 * 1024;

/**
 * LOCAL DEVELOPMENT ONLY. Binds to 127.0.0.1 (never 0.0.0.0, never deployed): no inbound access to the home machine.
 * POST /rpc/<operation> with a JSON object body; the principal comes from `authenticate(Authorization header)`.
 * Bearer-only authentication (no cookies), and JSON content-type is required, so a cross-site form cannot drive it.
 */
export async function startLocalControlApi(input: { service: ControlPlaneService; authenticate: (authorization: string | undefined) => Principal | null; port?: number }): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const send = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
    const op = /^\/rpc\/([A-Za-z]{3,40})$/u.exec(req.url ?? '')?.[1];
    if (req.method !== 'POST' || !op) return send(404, { error: 'NOT_FOUND' });
    if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return send(415, { error: 'VALIDATION' });
    const principal = input.authenticate(req.headers.authorization);
    if (!principal) return send(401, { error: 'UNAUTHENTICATED' });
    const chunks: Buffer[] = []; let size = 0;
    req.on('data', (c: Buffer) => { size += c.length; if (size > MAX_BODY_BYTES) { send(413, { error: 'VALIDATION' }); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (size > MAX_BODY_BYTES) return;
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return send(400, { error: 'VALIDATION' }); }
      dispatch(input.service, principal, op, body).then((r) => send(r.status, r.body), () => send(500, { error: 'INTERNAL' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(input.port ?? 0, LOCAL_BIND_HOST, resolve));
  const address = server.address() as AddressInfo;
  if (address.address !== LOCAL_BIND_HOST) { server.close(); throw new Error('control API must bind to loopback only'); }
  return { server, url: `http://${LOCAL_BIND_HOST}:${address.port}` };
}
