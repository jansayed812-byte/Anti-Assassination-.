/**
 * Branch risk picture on an H3 grid (resolution 9, ~0.1 km² cells) clipped to the urban boundary.
 *
 * Cell score combines the incident-driven threat (RiskEngine.assessPoint: severity × likelihood × exposure ×
 * confidence) with context: distance to the nearest police/hospital/HQ support and coverage gaps from the
 * blind-spot analysis. score = 1 − (1 − threat)(1 − context).
 */
import { EventEmitter } from 'events';
import { cellToLatLng, getHexagonAreaAvg, getHexagonEdgeLengthAvg, gridDisk, latLngToCell, polygonToCells } from 'h3-js';
import { RiskEngine, type IncidentEvent, type RiskLevel } from '../../threat/risk-engine';
import { distanceM, pointInRing, type LatLon } from '../geo';
import type { BranchGeo, Poi } from '../geodata/types';

export const H3_RES = 9;
export const CELL_EDGE_M = getHexagonEdgeLengthAvg(H3_RES, 'm');
export const CELL_AREA_KM2 = getHexagonAreaAvg(H3_RES, 'km2');

export interface RiskFactors { threat: number; severity: number; likelihood: number; exposure: number; confidence: number; support_m: number; coverage_gap: boolean; context: number; incidents: string[] }
export interface RiskCell { id: string; lat: number; lon: number; score: number; level: RiskLevel; restricted: boolean; factors: RiskFactors }
export interface RankedSite { rank: number; cell: string; lat: number; lon: number; score: number; level: RiskLevel; factors: RiskFactors; nearest: { id: string; name: Poi['name']; distance_m: number } | null }

/** Level bands. Context alone (support distance + coverage gap) tops out at 0.065, so "medium" and above always involve incident threat. */
export const levelOf = (score: number): RiskLevel => (score >= 0.6 ? 'critical' : score >= 0.35 ? 'high' : score >= 0.1 ? 'medium' : 'low');
const SUPPORT_KINDS = new Set(['police', 'hospital', 'hq']);

export class RiskModel extends EventEmitter {
  private incidents = new Map<string, IncidentEvent>();
  private counter = 0;
  private cells: Array<{ id: string; lat: number; lon: number; restricted: boolean; support_m: number }>;
  private cellIndex = new Map<string, number>();
  private gaps = new Set<string>();
  private cache: RiskCell[] | null = null;
  version = 0;

  constructor(private geo: BranchGeo) {
    super();
    const support = geo.pois.filter((p) => SUPPORT_KINDS.has(p.kind));
    const ids = polygonToCells(geo.boundary, H3_RES, true);
    this.cells = ids.sort().map((id) => {
      const [lat, lon] = cellToLatLng(id);
      const p = { lat, lon };
      return {
        id, lat, lon,
        restricted: geo.restricted.some((z) => pointInRing(p, z.ring)),
        support_m: support.length ? Math.min(...support.map((s) => distanceM(p, s))) : 10_000,
      };
    });
    this.cells.forEach((c, i) => this.cellIndex.set(c.id, i));
  }

  cellIds(): string[] { return this.cells.map((c) => c.id); }
  cellCenter(id: string): LatLon | undefined { const i = this.cellIndex.get(id); return i === undefined ? undefined : this.cells[i]; }
  isRestricted(id: string): boolean { const i = this.cellIndex.get(id); return i !== undefined && this.cells[i].restricted; }
  inArea(id: string): boolean { return this.cellIndex.has(id); }

  add(input: Omit<IncidentEvent, 'incident_id' | 'observed_at' | 'valid_until'> & { incident_id?: string; ttl_s?: number }): IncidentEvent {
    const now = Date.now();
    const inc: IncidentEvent = {
      ...input,
      incident_id: input.incident_id ?? `INC-${String(++this.counter).padStart(4, '0')}`,
      observed_at: new Date(now).toISOString(),
      valid_until: new Date(now + 1000 * (input.ttl_s ?? 6 * 3600)).toISOString(),
    };
    this.incidents.set(inc.incident_id, inc);
    this.changed('incidents');
    return inc;
  }

  remove(predicate: (i: IncidentEvent) => boolean): number {
    let n = 0;
    for (const [id, inc] of this.incidents) if (predicate(inc)) { this.incidents.delete(id); n++; }
    if (n) this.changed('incidents');
    return n;
  }

  list(): IncidentEvent[] {
    const now = new Date().toISOString();
    return [...this.incidents.values()].filter((i) => i.valid_until > now && i.human_validation_status !== 'rejected');
  }

  /** Coverage-gap cells from the blind-spot analysis (raises context risk). */
  setCoverageGaps(cells: Iterable<string>): void {
    const next = new Set(cells);
    if (next.size === this.gaps.size && [...next].every((c) => this.gaps.has(c))) return;
    this.gaps = next;
    this.changed('gaps');
  }

  /** 'incidents' when the incident set changed, 'gaps' when only the coverage-gap context did. */
  private changed(reason: 'incidents' | 'gaps'): void { this.cache = null; this.version++; this.emit('changed', reason); }

  private score(c: { id: string; lat: number; lon: number; restricted: boolean; support_m: number }, incidents: IncidentEvent[]): RiskCell {
    const t = RiskEngine.assessPoint(incidents, c.lat, c.lon, CELL_EDGE_M / 2, 'grid');
    const supportFar = Math.max(0, Math.min(1, (c.support_m - 500) / 2500));
    const gap = this.gaps.has(c.id);
    const context = 0.01 + 0.025 * supportFar + 0.03 * (gap ? 1 : 0);
    const score = +(1 - (1 - t.score) * (1 - context)).toFixed(3);
    return {
      id: c.id, lat: +c.lat.toFixed(6), lon: +c.lon.toFixed(6), score, level: levelOf(score), restricted: c.restricted,
      factors: {
        threat: t.score, severity: t.input.severity, likelihood: t.input.likelihood, exposure: +t.input.exposure.toFixed(3),
        confidence: +t.input.data_confidence.toFixed(3), support_m: Math.round(c.support_m), coverage_gap: gap, context: +context.toFixed(3),
        incidents: t.input.evidence ?? [],
      },
    };
  }

  grid(): RiskCell[] {
    if (!this.cache) { const inc = this.list(); this.cache = this.cells.map((c) => this.score(c, inc)); }
    return this.cache;
  }

  /** Risk at an arbitrary point: the containing cell when inside the area, else a direct assessment. */
  scoreAt(p: LatLon): number {
    const i = this.cellIndex.get(latLngToCell(p.lat, p.lon, H3_RES));
    if (i !== undefined) return this.grid()[i].score;
    return RiskEngine.assessPoint(this.list(), p.lat, p.lon, CELL_EDGE_M / 2, 'point').score;
  }

  cellAt(p: LatLon): RiskCell | undefined { const i = this.cellIndex.get(latLngToCell(p.lat, p.lon, H3_RES)); return i === undefined ? undefined : this.grid()[i]; }

  /**
   * Top-n most dangerous and safest locations. Picks are at least `spacingM` apart (non-maximum suppression);
   * restricted cells are excluded from the safe list.
   */
  extremes(pois: Poi[], n = 10, spacingM = 700): { dangerous: RankedSite[]; safest: RankedSite[] } {
    const grid = this.grid();
    const pickN = (sorted: RiskCell[]) => {
      const out: RiskCell[] = [];
      for (const c of sorted) {
        if (out.length >= n) break;
        if (out.every((o) => distanceM(o, c) >= spacingM)) out.push(c);
      }
      return out;
    };
    const named = pois.filter((p) => p.kind !== 'safe_house');
    const rank = (list: RiskCell[]): RankedSite[] => list.map((c, i) => {
      const near = named.reduce<{ p: Poi; d: number } | null>((best, p) => { const d = distanceM(c, p); return !best || d < best.d ? { p, d } : best; }, null);
      return { rank: i + 1, cell: c.id, lat: c.lat, lon: c.lon, score: c.score, level: c.level, factors: c.factors, nearest: near ? { id: near.p.id, name: near.p.name, distance_m: Math.round(near.d) } : null };
    });
    const dangerous = rank(pickN([...grid].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))));
    // Safest: lowest score, preferring well-supported cells; ties broken by support distance.
    const safest = rank(pickN(grid.filter((c) => !c.restricted).sort((a, b) => a.score - b.score || a.factors.support_m - b.factors.support_m || a.id.localeCompare(b.id))));
    return { dangerous, safest };
  }

  neighbours(id: string): string[] { return gridDisk(id, 1).filter((x) => x !== id && this.cellIndex.has(x)); }
}
