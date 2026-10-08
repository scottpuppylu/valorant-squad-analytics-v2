// Ported from legacy `src/analytics/teamComposition/siteReference.ts` (accepted, frozen at c063b52 / release 1a4c790). Algorithm body unchanged; parameter properties expanded (erasableSyntaxOnly).

/**
 * TASK-ANALYTICS-TEAM-COMPOSITION-02 — `site-reference-v1`: a PRIVATE, derived, raw-coordinate site reference.
 *
 * Built only from provider-observed match evidence: plant coordinates grouped by their explicit provider site label
 * (A / B / C), per map. No external transform, callout or polygon is used, no coordinate is hard-coded, and distances
 * are only ever compared WITHIN one map (raw provider units, never labelled or compared across maps).
 *
 * A point is SITE_<X>_PROXIMAL only when it lies inside site X's empirical plant-distance envelope (the chosen
 * quantile of plant distances to that site's centroid) and inside no other site's envelope. Outside every envelope →
 * NON_SITE_OR_UNKNOWN (abstain); inside two envelopes → ambiguous (abstain). Raw values never leave this module's
 * callers' private computation.
 */
export const SITE_REFERENCE_VERSION = 'site-reference-v1' as const;
export type SiteLabel = string;
export type SiteGate = 'p95' | 'p99';

export interface PlantPoint { map: string; site: SiteLabel; x: number; y: number }
interface SiteStats { site: SiteLabel; n: number; cx: number; cy: number; radius: Record<SiteGate, number> }
export type SiteClass =
  | { status: 'proximal'; site: SiteLabel }
  | { status: 'outside' | 'ambiguous' | 'unknown_map' };

const quantile = (sorted: readonly number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!;

export class SiteReference {
  private readonly maps = new Map<string, SiteStats[]>();

  readonly gate: SiteGate;
  readonly minimumPlantsPerSite: number;

  constructor(plants: readonly PlantPoint[], gate: SiteGate = 'p95', minimumPlantsPerSite = 20) {
    this.gate = gate;
    this.minimumPlantsPerSite = minimumPlantsPerSite;
    const grouped = new Map<string, PlantPoint[]>();
    for (const p of plants) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !p.site) continue;
      grouped.set(`${p.map}\u0000${p.site}`, [...(grouped.get(`${p.map}\u0000${p.site}`) ?? []), p]);
    }
    for (const key of [...grouped.keys()].sort()) {
      const points = grouped.get(key)!;
      if (points.length < minimumPlantsPerSite) continue; // too few labelled plants: that site has no reference
      const [map, site] = key.split('\u0000') as [string, string];
      // Order-independent centroid: sum in a canonical order.
      const ordered = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
      const cx = ordered.reduce((s, p) => s + p.x, 0) / ordered.length; const cy = ordered.reduce((s, p) => s + p.y, 0) / ordered.length;
      const distances = ordered.map((p) => Math.hypot(p.x - cx, p.y - cy)).sort((a, b) => a - b);
      this.maps.set(map, [...(this.maps.get(map) ?? []), { site, n: points.length, cx, cy, radius: { p95: quantile(distances, 0.95), p99: quantile(distances, 0.99) } }]);
    }
  }

  /** Maps with at least two referenced sites (a site-relative statement needs an alternative). */
  hasMap(map: string): boolean { return (this.maps.get(map)?.length ?? 0) >= 2; }
  sites(map: string): SiteLabel[] { return (this.maps.get(map) ?? []).map((s) => s.site).sort(); }

  classify(map: string, x: number, y: number): SiteClass {
    const sites = this.maps.get(map);
    if (!sites || sites.length < 2 || !Number.isFinite(x) || !Number.isFinite(y)) return { status: 'unknown_map' };
    const inside = sites.filter((s) => Math.hypot(x - s.cx, y - s.cy) <= s.radius[this.gate]);
    if (inside.length === 0) return { status: 'outside' };
    if (inside.length > 1) return { status: 'ambiguous' };
    return { status: 'proximal', site: inside[0]!.site };
  }
}
