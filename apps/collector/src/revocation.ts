import type { CanonicalRepository } from '@vsa/canonical-data';
import { DataRevocationRequested } from '@vsa/contracts/control';

export interface RevocationResult {
  eventId: string;
  memberResolved: boolean;
  /** Player-attributable precise spatial evidence erased (snapshots deleted, event / plant / defuse coordinates cleared). */
  spatialErasure: Awaited<ReturnType<CanonicalRepository['erasePositionTelemetryForMember']>> | null;
  /** Non-attributable shared match topology is retained (matches, rounds, other players' evidence). */
  matchesRetained: number;
}

/**
 * Local DATA-PLANE side of the revocation contract: the collector polls DataRevocationRequested OUTBOUND from the control
 * plane and enforces it here. STOP_FUTURE_SYNC and EXCLUDE_FROM_PUBLICATION are enforced by consent at sync / export
 * time; ERASE_ATTRIBUTABLE_SPATIAL_EVIDENCE removes the member's precise spatial evidence without deleting shared match
 * topology. Idempotent (a repeated event erases nothing new). The control plane itself never touches telemetry.
 */
export async function applyDataRevocation(repository: CanonicalRepository, event: unknown, resolveMemberId: (membershipId: string) => string | null): Promise<RevocationResult> {
  const e = DataRevocationRequested.parse(event);
  const memberId = resolveMemberId(e.membershipId);
  if (!memberId) return { eventId: e.eventId, memberResolved: false, spatialErasure: null, matchesRetained: 0 };
  const spatialErasure = e.scopes.includes('ERASE_ATTRIBUTABLE_SPATIAL_EVIDENCE') ? await repository.erasePositionTelemetryForMember(memberId) : null;
  return { eventId: e.eventId, memberResolved: true, spatialErasure, matchesRetained: (await repository.listMatchKeysForMembers([memberId])).length };
}
