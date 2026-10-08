import { z } from 'zod';
import { NonNegativeInt } from './common.ts';
import { ANALYTICS_CONTRACT_VERSION } from './versions.ts';

/**
 * Team Builder product contract (the algorithm itself is ported later; accepted ids: team-composition-v1 / -v2).
 *
 * Honest semantics, encoded as literals so they cannot drift:
 *  - Team Fit = historical relative lineup fit (0–100). It is NOT a win probability and NOT a proven optimal lineup.
 *  - Confidence (0–100) is independent of Team Fit: a high fit with thin evidence has low confidence.
 */
const MemberRef = z.string().min(1).max(64);
const ResponsibilityLabel = z.string().regex(/^[A-Z][A-Z_]{2,60}$/u, 'UPPER_SNAKE responsibility label');

export const TeamCompositionInput = z.object({
  memberIds: z.array(MemberRef).length(5).refine((ids) => new Set(ids).size === 5, 'member ids must be distinct'),
  mapId: z.string().min(1).max(64),
}).strict();
export type TeamCompositionInput = z.infer<typeof TeamCompositionInput>;

export const TeamCompositionAlternative = z.object({
  agentId: z.string().min(1).max(64),
  agentName: z.string().min(1).max(40),
  role: z.string().min(1).max(20),
  teamFit: z.number().min(0).max(100).nullable(),
  confidence: z.number().min(0).max(100),
}).strict();

export const TeamCompositionMemberResult = z.object({
  memberId: MemberRef,
  agentId: z.string().min(1).max(64),
  agentName: z.string().min(1).max(40),
  role: z.string().min(1).max(20),
  generalResponsibility: ResponsibilityLabel.nullable(),
  attackResponsibilities: z.array(ResponsibilityLabel),
  defenseResponsibilities: z.array(ResponsibilityLabel),
  teamFit: z.number().min(0).max(100).nullable(),
  confidence: z.number().min(0).max(100),
  sampleSize: NonNegativeInt,
  evidenceSummary: z.array(z.string().min(1).max(200)),
  alternatives: z.array(TeamCompositionAlternative),
}).strict();
export type TeamCompositionMemberResult = z.infer<typeof TeamCompositionMemberResult>;

export const TeamCompositionResult = z.object({
  analyticsContractVersion: z.literal(ANALYTICS_CONTRACT_VERSION),
  algorithmId: z.string().min(1).max(60),
  mapId: z.string().min(1).max(64),
  status: z.enum(['ok', 'insufficient_evidence']),
  teamFitSemantics: z.literal('historical-relative-lineup-fit'),
  isWinProbability: z.literal(false),
  isProvenOptimalLineup: z.literal(false),
  teamFit: z.number().min(0).max(100).nullable(),
  confidence: z.number().min(0).max(100).nullable(),
  members: z.array(TeamCompositionMemberResult),
  reasons: z.array(z.string().min(1).max(200)),
}).strict().superRefine((result, ctx) => {
  if (result.status === 'ok' && result.members.length !== 5) ctx.addIssue({ code: 'custom', message: 'an ok result has exactly 5 members' });
  if (new Set(result.members.map((m) => m.memberId)).size !== result.members.length) ctx.addIssue({ code: 'custom', message: 'member ids must be distinct' });
});
export type TeamCompositionResult = z.infer<typeof TeamCompositionResult>;
