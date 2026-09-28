/**
 * Escort route planning on the road graph.
 * Edge cost = travel time × (1 + α·risk) × (critical ? 8 : high ? 3 : 1) × (penalised ? 3 : 1).
 *   P — lowest risk-weighted route          A — P with its edges penalised (edge-disjoint where possible)
 *   C — more risk-averse, avoids P and A    E — from the origin to the nearest safe house
 * Every route can be forced through user waypoints (manual editing).
 */
import { distanceM, type LatLon, type LngLat } from '../geo';
import type { BranchGeo, Poi, PoiKind } from '../geodata/types';
import { L, lengthText } from '../i18n/messages';
import type { Tri } from '../i18n/types';
import type { RiskLevel } from '../../threat/risk-engine';
import { levelOf, type RiskModel } from '../domain/risk';
import { edgeSeconds, type Edge, type RoadGraph } from './graph';

export type PaceKey = 'P' | 'A' | 'C' | 'E';
export const PACE_KEYS: PaceKey[] = ['P', 'A', 'C', 'E'];

export interface RouteSegment { level: RiskLevel; coords: LngLat[]; start_m: number; length_m: number }
export interface RouteStop { id: string; kind: PoiKind; name: Tri; lat: number; lon: number; at_m: number; eta_min: number; offset_m: number }
export interface RoutePlan {
  k: PaceKey; label: Tri; waypoints: LatLon[]; path: LatLon[]; distance_m: number; eta_min: number; high_risk_min: number;
  max_risk: number; avg_risk: number; risk_level: RiskLevel; segments: RouteSegment[];
  alerts: Array<{ level: 'high' | 'critical' | 'blind'; at_m: number; length_m: number; text: Tri }>;
  safe_stops: RouteStop[]; support_points: RouteStop[];
  checkpoints: Array<{ id: string; name: Tri; lat: number; lon: number; at_m: number; eta_min: number }>;
  profile: Array<{ at_m: number; score: number }>; coverage_pct: number;
}

export interface BlindCells { network: Set<string>; monitoring: Set<string>; zoneOf: (cell: string) => { id: string; type: string; label: Tri } | undefined }

const ALPHA = { P: 3, A: 3, C: 6, E: 3 } as const;
const SAFE_KINDS = new Set<PoiKind>(['safe_house', 'police', 'hq']);
const SUPPORT_KINDS = new Set<PoiKind>(['hospital', 'clinic', 'fuel', 'airport']);
const undirected = (e: Edge) => (e.from < e.to ? `${e.from}-${e.to}` : `${e.to}-${e.from}`);

export class RoutePlanner {
  private riskCache: Float64Array;
  private riskVersion = -1;

  constructor(private graph: RoadGraph, private risk: RiskModel, private geo: BranchGeo, private blind: () => BlindCells, private cellOf: (p: LatLon) => string) {
    this.riskCache = new Float64Array(graph.edges.length).fill(NaN);
  }

  private edgeRisk(e: Edge): number {
    if (this.risk.version !== this.riskVersion) { this.riskCache.fill(NaN); this.riskVersion = this.risk.version; }
    let s = this.riskCache[e.id];
    if (Number.isNaN(s)) { s = this.risk.scoreAt(e.mid); this.riskCache[e.id] = s; }
    return s;
  }

  private cost(alpha: number, penalised: Set<string>) {
    return (e: Edge) => {
      const s = this.edgeRisk(e);
      return edgeSeconds(e) * (1 + alpha * s) * (s >= 0.6 ? 8 : s >= 0.35 ? 3 : 1) * (penalised.has(undirected(e)) ? 3 : 1);
    };
  }

  /** Shortest risk-weighted path visiting the points in order; null when some leg is unreachable. */
  private through(points: LatLon[], alpha: number, penalised: Set<string>): Edge[] | null {
    const nodes = points.map((p) => this.graph.nearest(p).node);
    const edges: Edge[] = [];
    const cost = this.cost(alpha, penalised);
    for (let i = 0; i < nodes.length - 1; i++) {
      const leg = this.graph.astar(nodes[i], nodes[i + 1], cost);
      if (!leg) return null;
      edges.push(...leg.edges);
    }
    return edges;
  }

  /** Safe house cheapest to reach by risk-weighted cost (houses within 300 m of the start are skipped). */
  nearestSafeHouse(from: LatLon): Poi | undefined {
    const houses = this.geo.pois.filter((p) => p.kind === 'safe_house' && distanceM(p, from) > 300);
    if (!houses.length) return undefined;
    const byNode = new Map<number, Poi>();
    for (const h of houses) { const n = this.graph.nearest(h).node; if (!byNode.has(n)) byNode.set(n, h); }
    const hit = this.graph.nearestOf(this.graph.nearest(from).node, new Set(byNode.keys()), this.cost(ALPHA.E, new Set()));
    return hit ? byNode.get(hit.target) : undefined;
  }

  /** Compute all four PACE routes. `waypoints[k]` forces route k through user-placed points. */
  pace(origin: LatLon, destination: LatLon, waypoints: Partial<Record<PaceKey, LatLon[]>> = {}): RoutePlan[] {
    const out: RoutePlan[] = [];
    const used = new Set<string>();
    for (const k of PACE_KEYS) {
      const dest = k === 'E' ? this.nearestSafeHouse(origin) ?? destination : destination;
      const wps = waypoints[k] ?? [];
      const penalised = k === 'P' || k === 'E' ? new Set<string>() : new Set(used);
      const edges = this.through([origin, ...wps, dest], ALPHA[k], penalised);
      if (!edges) continue;
      if (k === 'P' || k === 'A') for (const e of edges) used.add(undirected(e));
      out.push(this.analyze(k, edges, wps, origin));
    }
    return out;
  }

  analyze(k: PaceKey, edges: Edge[], waypoints: LatLon[], origin: LatLon): RoutePlan {
    const path: LatLon[] = edges.length ? [this.graph.nodes[edges[0].from], ...edges.map((e) => this.graph.nodes[e.to])] : [origin];
    const segments: RouteSegment[] = [];
    const alerts: RoutePlan['alerts'] = [];
    let dist = 0, secs = 0, highSecs = 0, riskLen = 0, maxRisk = 0;
    const cum: number[] = [0];
    const secAt: number[] = [0];
    let run: { level: RiskLevel; start: number; len: number; names: Map<string, number>; names3: Map<string, Tri> } | null = null;
    const flushRun = () => {
      if (run && (run.level === 'high' || run.level === 'critical') && run.len >= 100) {
        const top = [...run.names.entries()].sort((a, b) => b[1] - a[1])[0];
        const road = top ? run.names3.get(top[0])! : L('route.road.unnamed');
        alerts.push({ level: run.level, at_m: Math.round(run.start), length_m: Math.round(run.len), text: L(run.level === 'critical' ? 'route.alert.critical' : 'route.alert.high', { len: lengthText(run.len), road }) });
      }
    };
    edges.forEach((e, i) => {
      const s = this.edgeRisk(e), lvl = levelOf(s), t = edgeSeconds(e);
      const a = this.graph.nodes[e.from], b = this.graph.nodes[e.to];
      const last = segments[segments.length - 1];
      if (last && last.level === lvl) { last.coords.push([b.lon, b.lat]); last.length_m += e.len; }
      else segments.push({ level: lvl, coords: [[a.lon, a.lat], [b.lon, b.lat]], start_m: dist, length_m: e.len });
      if (!run || run.level !== lvl) { flushRun(); run = { level: lvl, start: dist, len: 0, names: new Map(), names3: new Map() }; }
      run.len += e.len;
      if (e.name) { run.names.set(e.name.en, (run.names.get(e.name.en) ?? 0) + e.len); run.names3.set(e.name.en, e.name); }
      dist += e.len; secs += t; riskLen += s * e.len; maxRisk = Math.max(maxRisk, s);
      if (lvl === 'high' || lvl === 'critical') highSecs += t;
      cum[i + 1] = dist; secAt[i + 1] = secs;
    });
    flushRun();
    for (const s of segments) { s.length_m = Math.round(s.length_m); s.start_m = Math.round(s.start_m); }

    // Blind-spot crossings and network coverage along the route (sampled every 50 m).
    const blind = this.blind();
    let covered = 0, samples = 0;
    let crossing: { id: string; type: string; label: Tri; start: number; len: number } | null = null;
    const flushCrossing = () => { if (crossing && crossing.len >= 100) alerts.push({ level: 'blind', at_m: Math.round(crossing.start), length_m: Math.round(crossing.len), text: L('route.alert.blind', { id: crossing.id, type: crossing.label, len: lengthText(crossing.len) }) }); crossing = null; };
    const profile: RoutePlan['profile'] = [];
    for (let m = 0; m <= dist; m += 50) {
      const p = this.pointAt(path, cum, m);
      const cell = this.cellOf(p);
      samples++;
      if (!blind.network.has(cell)) covered++;
      const z = blind.zoneOf(cell);
      if (z && z.type !== 'access') {
        if (crossing && crossing.id === z.id) crossing.len += 50;
        else { flushCrossing(); crossing = { ...z, start: m, len: 50 }; }
      } else flushCrossing();
      if (m % 200 === 0) profile.push({ at_m: m, score: this.risk.scoreAt(p) });
    }
    flushCrossing();
    alerts.sort((a, b) => a.at_m - b.at_m);

    const etaAt = (m: number) => {
      const i = Math.max(0, cum.findIndex((c) => c >= m));
      return +((secAt[i] ?? secs) / 60).toFixed(1);
    };
    const stops = (kinds: Set<PoiKind>, maxOffset: number): RouteStop[] => this.geo.pois.filter((p) => kinds.has(p.kind)).flatMap((p) => {
      let best = { d: Infinity, at: 0 };
      path.forEach((q, i) => { const d = distanceM(p, q); if (d < best.d) best = { d, at: cum[i] ?? 0 }; });
      return best.d <= maxOffset ? [{ id: p.id, kind: p.kind, name: p.name, lat: p.lat, lon: p.lon, at_m: Math.round(best.at), eta_min: etaAt(best.at), offset_m: Math.round(best.d) }] : [];
    }).sort((a, b) => a.at_m - b.at_m);

    const cps = k === 'E' ? [0.5] : [0.25, 0.5, 0.75];
    const checkpoints = cps.map((f, i) => {
      const m = dist * f, p = this.pointAt(path, cum, m);
      const e = edges[Math.max(0, cum.findIndex((c) => c >= m) - 1)];
      return { id: `CP-${i + 1}`, name: L('route.cp', { n: i + 1, road: e?.name ?? L('route.road.unnamed') }), lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6), at_m: Math.round(m), eta_min: etaAt(m) };
    });
    const end = path[path.length - 1];
    checkpoints.push({ id: 'DEST', name: L('route.dest'), lat: end.lat, lon: end.lon, at_m: Math.round(dist), eta_min: +(secs / 60).toFixed(1) });

    const avg = dist ? riskLen / dist : 0;
    return {
      k, label: L(`route.${k}`), waypoints, path: path.map((p) => ({ lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6) })),
      distance_m: Math.round(dist), eta_min: +(secs / 60).toFixed(1), high_risk_min: +(highSecs / 60).toFixed(1),
      max_risk: +maxRisk.toFixed(3), avg_risk: +avg.toFixed(3), risk_level: levelOf(maxRisk), segments, alerts,
      safe_stops: stops(SAFE_KINDS, 300), support_points: stops(SUPPORT_KINDS, 500), checkpoints, profile,
      coverage_pct: samples ? Math.round((covered / samples) * 100) : 100,
    };
  }

  private pointAt(path: LatLon[], cum: number[], m: number): LatLon {
    if (path.length === 1) return path[0];
    let i = cum.findIndex((c) => c >= m);
    if (i <= 0) return path[Math.max(0, i)];
    const seg = cum[i] - cum[i - 1], f = seg ? (m - cum[i - 1]) / seg : 0;
    return { lat: path[i - 1].lat + (path[i].lat - path[i - 1].lat) * f, lon: path[i - 1].lon + (path[i].lon - path[i - 1].lon) * f };
  }
}
