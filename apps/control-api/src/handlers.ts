import { ControlPlaneError } from './errors.ts';
import type { Principal } from './model.ts';
import type { ControlPlaneService } from './service.ts';

/**
 * Thin transport surface. Each handler forwards to the domain service, which owns every rule (authorization included).
 * The principal always comes from the transport's authenticator — never from the request body.
 */
type Handler = (service: ControlPlaneService, principal: Principal, input: never) => Promise<unknown>;
const h = <I>(fn: (service: ControlPlaneService, principal: Principal, input: I) => Promise<unknown>) => fn as unknown as Handler;

export const CONTROL_HANDLERS = Object.freeze({
  createGroup: h<{ name: string; visibility?: 'PRIVATE' | 'INVITE_ONLY' }>((s, p, i) => s.createGroup(p, i)),
  createInvite: h<{ groupId: string; ttlHours?: number; forUserId?: string }>((s, p, i) => s.createInvite(p, i)),
  acceptInvite: h<{ token: string }>((s, p, i) => s.acceptInvite(p, i)),
  revokeInvite: h<{ groupId: string; inviteId: string }>((s, p, i) => s.revokeInvite(p, i)),
  listGroups: h<Record<string, never>>((s, p) => s.listGroups(p)),
  listMembers: h<{ groupId: string }>((s, p, i) => s.listMembers(p, i)),
  grantConsent: h<Parameters<ControlPlaneService['grantConsent']>[1]>((s, p, i) => s.grantConsent(p, i)),
  revokeConsent: h<Parameters<ControlPlaneService['revokeConsent']>[1]>((s, p, i) => s.revokeConsent(p, i)),
  requestSync: h<{ groupId: string; membershipId?: string }>((s, p, i) => s.requestSync(p, i)),
  getSyncStatus: h<{ jobId: string }>((s, p, i) => s.getSyncStatus(p, i)),
});
export type ControlOperation = keyof typeof CONTROL_HANDLERS;

export const HTTP_STATUS: Readonly<Record<ControlPlaneError['code'], number>> = Object.freeze({
  UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, GROUP_ARCHIVED: 409, INVALID_STATE: 409, INVITE_INVALID: 410, IDENTITY_CONFLICT: 409, VALIDATION: 400, LEASE_CONFLICT: 409,
});

export async function dispatch(service: ControlPlaneService, principal: Principal, operation: string, input: unknown): Promise<{ status: number; body: unknown }> {
  if (!Object.hasOwn(CONTROL_HANDLERS, operation)) return { status: 404, body: { error: 'NOT_FOUND' } };
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return { status: 400, body: { error: 'VALIDATION' } };
  try {
    return { status: 200, body: await CONTROL_HANDLERS[operation as ControlOperation](service, principal, input as never) };
  } catch (error) {
    if (error instanceof ControlPlaneError) return { status: HTTP_STATUS[error.code], body: { error: error.code } };
    return { status: 500, body: { error: 'INTERNAL' } };
  }
}
