// Ported from legacy `src/utils/agentRoles.ts` (agent-catalog-v1 + frozen AGENT_ROLES_CATALOG_V0; data unchanged).
import type { AgentName, PlayerRole } from '../event/matchViewTypes.ts';

/** Kept for the bootstrap API: the catalog role type. */
export type AgentRole = PlayerRole;

/**
 * TASK-DATA-AGENT-CATALOG-01 — `agent-catalog-v1`: THE agent → role catalog (single source of truth).
 *
 * Identity is the stable public agent content UUID the provider sends as `players[].agent.id`; the display name is an
 * alias kept for name-only inputs (demo data, the public dataset, older rows). Every canonicalId below was observed 1:1
 * with its display name across all 838 locally stored match documents; roles are the existing catalog roles, plus Miks
 * (Controller, Riot's official VALORANT agent page, resolved by SDD 2026-10-08).
 *
 * Unknown identities NEVER get a role: no fallback, no guess. Role-dependent metrics treat their rounds as unknown-role
 * (omitted, "Unknown selected agent role"); role-free metrics (kills, ACS, ADR, …) still count them.
 * Known unresolved identity (provider name "Unknown"): 773f0c78-4486-752b-68ef-4585d7f4b848 — deliberately absent.
 * New agent procedure: docs/AGENT_CATALOG.md.
 */
export const AGENT_CATALOG_VERSION = 'agent-catalog-v1' as const;

export interface AgentDefinition {
  canonicalId: string;
  displayName: string;
  role: PlayerRole;
  /** Extra display names that resolve to this agent (exact match). The provider placeholder "Unknown" is never an alias. */
  aliases: readonly string[];
  source: 'catalog-v0' | 'riot-official';
}

const define = (displayName: string, canonicalId: string, role: PlayerRole, source: AgentDefinition['source'] = 'catalog-v0'): AgentDefinition =>
  ({ canonicalId, displayName, role, aliases: [], source });

export const AGENT_DEFINITIONS: readonly AgentDefinition[] = Object.freeze([
  define('Jett', 'add6443a-41bd-e414-f6ad-e58d267f4e95', 'Duelist'), define('Raze', 'f94c3b30-42be-e959-889c-5aa313dba261', 'Duelist'),
  define('Phoenix', 'eb93336a-449b-9c1b-0a54-a891f7921d69', 'Duelist'), define('Reyna', 'a3bfb853-43b2-7238-a4f1-ad90e9e46bcc', 'Duelist'),
  define('Yoru', '7f94d92c-4234-0a36-9646-3a87eb8b5c89', 'Duelist'), define('Neon', 'bb2a4828-46eb-8cd1-e765-15848195d751', 'Duelist'),
  define('Iso', '0e38b510-41a8-5780-5e8f-568b2a4f2d6c', 'Duelist'), define('Waylay', 'df1cb487-4902-002e-5c17-d28e83e78588', 'Duelist'),
  define('Sova', '320b2a48-4d9b-a075-30f1-1f93a9b638fa', 'Initiator'), define('Breach', '5f8d3a7f-467b-97f3-062c-13acf203c006', 'Initiator'),
  define('Skye', '6f2a04ca-43e0-be17-7f36-b3908627744d', 'Initiator'), define('KAY/O', '601dbbe7-43ce-be57-2a40-4abd24953621', 'Initiator'),
  define('Fade', 'dade69b4-4f5a-8528-247b-219e5a1facd6', 'Initiator'), define('Gekko', 'e370fa57-4757-3604-3648-499e1f642d3f', 'Initiator'),
  define('Tejo', 'b444168c-4e35-8076-db47-ef9bf368f384', 'Initiator'),
  define('Omen', '8e253930-4c05-31dd-1b6c-968525494517', 'Controller'), define('Brimstone', '9f0d8ba9-4140-b941-57d3-a7ad57c6b417', 'Controller'),
  define('Viper', '707eab51-4836-f488-046a-cda6bf494859', 'Controller'), define('Astra', '41fb69c1-4189-7b37-f117-bcaf1e96f1bf', 'Controller'),
  define('Harbor', '95b78ed7-4637-86d9-7e41-71ba8c293152', 'Controller'), define('Clove', '1dbf2edd-4729-0984-3115-daa5eed44993', 'Controller'),
  define('Miks', '7c8a4701-4de6-9355-b254-e09bc2a34b72', 'Controller', 'riot-official'),
  define('Sage', '569fdd95-4d10-43ab-ca70-79becc718b46', 'Sentinel'), define('Cypher', '117ed9e3-49f3-6512-3ccf-0cada7e3823b', 'Sentinel'),
  define('Killjoy', '1e58de9c-4950-5125-93e9-a0aee9f98746', 'Sentinel'), define('Chamber', '22697a3d-45bf-8dd7-4fec-84a9e28c69d7', 'Sentinel'),
  define('Deadlock', 'cc8b64c8-4b25-4ff9-6e7f-37b4da43d235', 'Sentinel'), define('Vyse', 'efba5359-4016-a1e5-7626-b1ae76895940', 'Sentinel'),
  define('Veto', '92eeef5d-43b5-1d4a-8d03-b3927a09034b', 'Sentinel'),
]);

const byId = new Map(AGENT_DEFINITIONS.map((agent) => [agent.canonicalId.toLowerCase(), agent]));
const byName = new Map(AGENT_DEFINITIONS.flatMap((agent) => [agent.displayName, ...agent.aliases].map((name) => [name, agent] as const)));

/** Name → role for name-only inputs (every display name and alias of the catalog). */
export const agentRoles: Readonly<Record<string, PlayerRole>> = Object.freeze(Object.fromEntries([...byName].map(([name, agent]) => [name, agent.role])));

/**
 * FROZEN pre-catalog-v1 name map (catalog v0, 28 agents, no Miks). Used ONLY by shared-match-evidence-v1, whose accepted
 * ratings were computed with it (TASK-SCORING-SHARED-MATCH-01); never extend it.
 */
export const AGENT_ROLES_CATALOG_V0: Readonly<Record<string, PlayerRole>> = Object.freeze(Object.fromEntries(
  AGENT_DEFINITIONS.filter((agent) => agent.source === 'catalog-v0').map((agent) => [agent.displayName, agent.role])));

export type AgentResolution =
  | { status: 'known'; definition: AgentDefinition; matchedBy: 'id' | 'name' }
  | { status: 'unknown'; reason: 'unknown_id' | 'unknown_name' | 'missing_identity'; agentId?: string; agentName?: string };

const clean = (value: string | null | undefined) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);

/**
 * Stable id first: a known id resolves regardless of the display name (stale, localized or provider "Unknown"); a
 * present but unknown id is UNKNOWN even when the name collides with a catalog name. Without an id, the exact display
 * name / alias decides.
 */
export function resolveAgent(input: { id?: string | null; name?: string | null }): AgentResolution {
  const id = clean(input.id); const name = clean(input.name);
  if (id) {
    const definition = byId.get(id.toLowerCase());
    return definition ? { status: 'known', definition, matchedBy: 'id' } : { status: 'unknown', reason: 'unknown_id', agentId: id, ...(name ? { agentName: name } : {}) };
  }
  if (!name) return { status: 'unknown', reason: 'missing_identity' };
  const definition = byName.get(name);
  return definition ? { status: 'known', definition, matchedBy: 'name' } : { status: 'unknown', reason: 'unknown_name', agentName: name };
}

/** Most-played known role; UNDEFINED when no played agent has a known role (no fallback role is ever invented). */
export function primaryRoleForAgents(agents: AgentName[]): PlayerRole | undefined {
  const counts = new Map<PlayerRole, number>();
  for (const agent of agents) {
    const role = agentRoles[agent];
    if (role) counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}

export interface AgentCatalogValidation {
  version: typeof AGENT_CATALOG_VERSION;
  complete: boolean;
  totalRows: number;
  knownRows: number;
  unknownRows: number;
  missingRows: number;
  coveragePercent: number;
  /** Known stable id stored with a name that is not its canonical name or alias: name-keyed analytics would miss it. */
  nameMismatchRows: number;
  /** Every identity the catalog cannot classify (or whose stored name drifted), most rows first (stable order). */
  unknownIdentities: { agentId: string | null; agentName: string | null; reason: 'unknown_id' | 'unknown_name' | 'missing_identity' | 'name_mismatch'; rows: number }[];
}

/**
 * AGENT_CATALOG_COMPLETE guard over stored (id, name) identities (one row = one member-match, or pass `rows` counts).
 * Complete only when every row resolves AND every known id carries its canonical name/alias — the condition under which
 * the name-keyed analytics paths are exactly id-correct. Input order never changes the result.
 */
export function validateAgentCatalog(rows: readonly { agentId?: string | null; agentName?: string | null; rows?: number }[]): AgentCatalogValidation {
  let known = 0; let unknown = 0; let missing = 0; let mismatch = 0;
  const unknownByKey = new Map<string, AgentCatalogValidation['unknownIdentities'][number]>();
  for (const row of rows) {
    const weight = row.rows ?? 1;
    const resolution = resolveAgent({ id: row.agentId, name: row.agentName });
    const name = clean(row.agentName);
    const drifted = resolution.status === 'known' && resolution.matchedBy === 'id' && name !== undefined
      && name !== resolution.definition.displayName && !resolution.definition.aliases.includes(name);
    if (resolution.status === 'known' && !drifted) { known += weight; continue; }
    const reason = resolution.status === 'known' ? 'name_mismatch' as const : resolution.reason;
    if (reason === 'missing_identity') missing += weight; else if (reason === 'name_mismatch') mismatch += weight; else unknown += weight;
    const key = `${reason}|${clean(row.agentId)?.toLowerCase() ?? ''}|${clean(row.agentName) ?? ''}`;
    const entry = unknownByKey.get(key) ?? { agentId: clean(row.agentId)?.toLowerCase() ?? null, agentName: name ?? null, reason, rows: 0 };
    entry.rows += weight;
    unknownByKey.set(key, entry);
  }
  const total = known + unknown + missing + mismatch;
  return {
    version: AGENT_CATALOG_VERSION, complete: unknown + missing + mismatch === 0, totalRows: total, knownRows: known, unknownRows: unknown, missingRows: missing,
    nameMismatchRows: mismatch,
    coveragePercent: total ? (100 * known) / total : 100,
    unknownIdentities: [...unknownByKey.values()].sort((a, b) => b.rows - a.rows || (a.agentId ?? '').localeCompare(b.agentId ?? '') || (a.agentName ?? '').localeCompare(b.agentName ?? '')),
  };
}
