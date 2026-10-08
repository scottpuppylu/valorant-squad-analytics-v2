/**
 * Analytics layout (intended): basic/ (bootstrap), event/, rank/, shared-match/, team-composition/, weapons/.
 * Accepted algorithms keep their identifiers when ported (e.g. event-metrics-v2, shared-match-rating-v1,
 * team-composition-v1/-v2) — the product being V2 never renames an algorithm. See docs/LEGACY_PORT_AUDIT.md.
 */
export {
  BASIC_PLAYER_STATS_ALGORITHM, BASIC_PLAYER_STATS_DESCRIPTION, computeBasicPlayerStats, roundsPlayed, summarizeObservations, type ObservationSummary,
} from './basic/basicPlayerStats.ts';
export { AGENT_CATALOG_VERSION, AGENT_DEFINITIONS, resolveAgent, type AgentDefinition, type AgentResolution, type AgentRole } from './agents/agentCatalog.ts';
export { safeDivide } from './basic/number.ts';
