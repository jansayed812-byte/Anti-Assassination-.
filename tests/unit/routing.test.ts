/**
 * Road graph and escort route planner on a small, fully known street lattice:
 * A* optimality (checked against an exhaustive Dijkstra), oneway handling, snapping, risk avoidance,
 * PACE alternatives, manual waypoints, route analysis (segments, ETA, alerts, stops, checkpoints).
 */
import { describe, it, expect } from 'vitest';
import { latLngToCell } from 'h3-js';
import { distanceM, distanceToPolylineM, offset, type LatLon } from '../../services/server/geo';
import { edgeSeconds, RoadGraph, type Edge } from '../../services/server/routing/graph';
import { RoutePlanner, type BlindCells } from '../../services/server/routing/planner';
import { BRANCHES } from '../../services/server/geodata/branches';
import type { BranchGeo, Poi, Road, RoadClass } from '../../services/server/geodata/types';
import type { RiskModel } from '../../services/server/domain/risk';
import { tri } from '../../services/server/i18n/types';

const DEF = BRANCHES[0];
const O = offset(DEF.center, -875, -875);
const N = 8, STEP = 250;
const at = (i: number, j: number): LatLon => offset(O, i * STEP, j * STEP);
const ll = (p: LatLon): [number, number] => [p.lon, p.lat];

/** 8×8 lattice, 250 m blocks. Row j = 4 is a primary avenue, the rest secondary; one oneway street. */
function lattice(opts: { oneway?: boolean; classes?: (i: number, j: number, h: boolean) => RoadClass } = {}): Road[] {
  const roads: Road[] = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N - 1; i++) {
    roads.push({ id: `h${i}-${j}`, cls: opts.classes?.(i, j, true) ?? (j === 4 ? 'primary' : 'secondary'), oneway: false, coords: [ll(at(i, j)), ll(at(i + 1, j))], name: tri(`سرک ${j}`, `سړک ${j}`, `Street ${j}`) });
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < N - 1; j++) {
    roads.push({ id: `v${i}-${j}`, cls: opts.classes?.(i, j, false) ?? 'secondary', oneway: !!opts.oneway && i === 0, coords: [ll(at(i, j)), ll(at(i, j + 1))], name: tri(`جاده ${i}`, `لار ${i}`, `Avenue ${i}`) });
  }
  return roads;
}

/** Exhaustive Dijkstra (O(V²)) as the reference for A*. */
function dijkstra(g: RoadGraph, from: number, to: number, cost: (e: Edge) => number): number {
  const dist = g.nodes.map(() => Infinity), done = g.nodes.map(() => false);
  dist[from] = 0;
  for (;;) {
    let u = -1;
    for (let v = 0; v < dist.length; v++) if (!done[v] && dist[v] < Infinity && (u < 0 || dist[v] < dist[u])) u = v;
    if (u < 0 || u === to) break;
    done[u] = true;
    for (const e of g.out[u]) dist[e.to] = Math.min(dist[e.to], dist[u] + cost(e));
  }
  return dist[to];
}

describe('RoadGraph', () => {
  it('builds nodes and directed edges (two per two-way street)', () => {
    const g = new RoadGraph(lattice());
    expect(g.nodes.length).toBe(N * N);
    expect(g.edges.length).toBe(2 * 2 * N * (N - 1));
    for (const e of g.edges) expect(e.len).toBeCloseTo(STEP, 0);
  });

  it('snaps to the nearest node', () => {
    const g = new RoadGraph(lattice());
    const target = at(3, 5);
    const hit = g.nearest(offset(target, 40, -30));
    expect(distanceM(g.nodes[hit.node], target)).toBeLessThan(0.01);
    expect(hit.distM).toBeCloseTo(50, 0);
  });

  it('A* matches exhaustive Dijkstra on randomised road classes', () => {
    const classes: RoadClass[] = ['trunk', 'primary', 'secondary', 'tertiary', 'residential'];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const g = new RoadGraph(lattice({ classes: () => classes[Math.floor(rnd() * classes.length)] }));
    for (let k = 0; k < 25; k++) {
      const a = Math.floor(rnd() * g.nodes.length), b = Math.floor(rnd() * g.nodes.length);
      const path = g.astar(a, b, edgeSeconds)!;
      expect(path).not.toBeNull();
      expect(path.cost).toBeCloseTo(dijkstra(g, a, b, edgeSeconds), 6);
      // The path is connected and ends where asked.
      expect(path.nodes[0]).toBe(a);
      expect(path.nodes[path.nodes.length - 1]).toBe(b);
      path.edges.forEach((e, i) => { if (i) expect(e.from).toBe(path.edges[i - 1].to); });
    }
  });

  it('respects oneway streets', () => {
    const g = new RoadGraph(lattice({ oneway: true }));
    const up = g.nearest(at(0, 0)).node, top = g.nearest(at(0, 1)).node;
    // Northbound along the oneway column is a single edge; southbound must detour through column 1.
    expect(g.astar(up, top, edgeSeconds)!.edges.length).toBe(1);
    expect(g.astar(top, up, edgeSeconds)!.edges.length).toBe(3);
  });

  it('returns null for an unreachable node', () => {
    const island: Road = { id: 'island', cls: 'residential', oneway: false, coords: [ll(offset(O, 5000, 5000)), ll(offset(O, 5200, 5000))] };
    const g = new RoadGraph([...lattice(), island]);
    const a = g.nearest(at(0, 0)).node, b = g.nearest(offset(O, 5000, 5000)).node;
    expect(g.astar(a, b, edgeSeconds)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------

/** Danger disc (score 0.8) around the lattice centre on the avenue; elsewhere 0.02. */
const DANGER = at(3.5, 4);
const DANGER_R = 300;
const riskStub = (score = (p: LatLon) => (distanceM(p, DANGER) <= DANGER_R ? 0.8 : 0.02)) => ({ version: 1, scoreAt: score }) as unknown as RiskModel;

const poi = (id: string, kind: Poi['kind'], p: LatLon): Poi => ({ id, kind, name: tri(id, id, id), lat: p.lat, lon: p.lon, synthetic: true });
const ORIGIN = at(0, 4), DEST = at(7, 4);
function planner(opts: { pois?: Poi[]; blind?: BlindCells; risk?: RiskModel } = {}) {
  const roads = lattice();
  const geo = { def: DEF, source: 'synthetic', boundary: [], bbox: [0, 0, 0, 0], roads, restricted: [],
    pois: opts.pois ?? [
      poi('SH-near', 'safe_house', offset(ORIGIN, 0, 150)), // within 300 m of the origin → never the E target
      poi('SH-1', 'safe_house', at(1, 7)), poi('SH-2', 'safe_house', at(6, 0)),
      poi('HOSP', 'hospital', offset(at(5, 6), 30, 0)), poi('POL', 'police', offset(at(2, 2), 0, 40)),
    ] } as unknown as BranchGeo;
  const graph = new RoadGraph(roads);
  const blind = opts.blind ?? { network: new Set<string>(), monitoring: new Set<string>(), zoneOf: () => undefined };
  return { graph, planner: new RoutePlanner(graph, opts.risk ?? riskStub(), geo, () => blind, (p) => latLngToCell(p.lat, p.lon, 9)) };
}

describe('RoutePlanner — PACE', () => {
  const { graph, planner: pl } = planner();
  const routes = pl.pace(ORIGIN, DEST);
  const byK = Object.fromEntries(routes.map((r) => [r.k, r]));

  it('returns all four PACE routes', () => {
    expect(routes.map((r) => r.k)).toEqual(['P', 'A', 'C', 'E']);
  });

  it('P avoids the danger zone that the fastest route crosses', () => {
    const fastest = graph.astar(graph.nearest(ORIGIN).node, graph.nearest(DEST).node, edgeSeconds)!;
    const fastestPts = fastest.nodes.map((n) => graph.nodes[n]);
    expect(distanceToPolylineM(DANGER, fastestPts)).toBeLessThan(DANGER_R);
    expect(byK.P.max_risk).toBeLessThan(0.1);
    expect(byK.P.risk_level).toBe('low');
    expect(byK.P.path.every((p) => distanceM(p, DANGER) > DANGER_R - 1)).toBe(true);
    expect(byK.P.distance_m).toBeGreaterThan(polyLen(fastestPts));
  });

  it('A differs from P (penalised edges) and C is at least as risk-averse', () => {
    const key = (r: typeof byK.P) => r.path.map((p) => `${p.lat},${p.lon}`).join('|');
    expect(key(byK.A)).not.toBe(key(byK.P));
    expect(byK.C.max_risk).toBeLessThan(0.35);
  });

  it('E goes to the cheapest safe house more than 300 m from the origin', () => {
    const end = byK.E.path[byK.E.path.length - 1];
    expect(distanceM(end, at(1, 7))).toBeLessThan(1);
    expect(byK.E.checkpoints.map((c) => c.id)).toEqual(['CP-1', 'DEST']);
  });

  it('reports consistent distance, ETA, segments and checkpoints', () => {
    const r = byK.P;
    const segLen = r.segments.reduce((s, x) => s + x.length_m, 0);
    expect(Math.abs(segLen - r.distance_m)).toBeLessThanOrEqual(r.segments.length);
    expect(Math.abs(polyLen(r.path) - r.distance_m)).toBeLessThan(1);
    // ETA = Σ length / (class speed × urban factor): secondary 50 km/h, primary 60 km/h → 40–48 km/h.
    const kmh = (r.distance_m / 1000) / (r.eta_min / 60);
    expect(kmh).toBeGreaterThan(39.5); expect(kmh).toBeLessThan(48.5);
    expect(r.checkpoints.map((c) => c.id)).toEqual(['CP-1', 'CP-2', 'CP-3', 'DEST']);
    const cps = r.checkpoints.map((c) => c.at_m);
    expect([...cps].sort((a, b) => a - b)).toEqual(cps);
    expect(r.checkpoints[3].eta_min).toBeCloseTo(r.eta_min, 1);
    expect(r.profile[0].at_m).toBe(0);
    expect(r.coverage_pct).toBe(100);
  });

  it('lists safe stops within 300 m and support points within 500 m, ordered along the route', () => {
    for (const r of routes) {
      for (const s of r.safe_stops) { expect(s.offset_m).toBeLessThanOrEqual(300); expect(['safe_house', 'police', 'hq']).toContain(s.kind); }
      for (const s of r.support_points) expect(s.offset_m).toBeLessThanOrEqual(500);
      const ats = r.safe_stops.map((s) => s.at_m);
      expect([...ats].sort((a, b) => a - b)).toEqual(ats);
    }
    expect(routes.some((r) => r.safe_stops.some((s) => s.id === 'POL'))).toBe(true);
  });
});

describe('RoutePlanner — manual waypoints and alerts', () => {
  it('forces a route through user waypoints and flags the critical stretch', () => {
    const { planner: pl } = planner();
    const [p] = pl.pace(ORIGIN, DEST, { P: [DANGER] }).filter((r) => r.k === 'P');
    expect(p.waypoints).toEqual([DANGER]);
    expect(distanceToPolylineM(DANGER, p.path)).toBeLessThan(STEP);
    expect(p.max_risk).toBeGreaterThanOrEqual(0.6);
    expect(p.risk_level).toBe('critical');
    expect(p.high_risk_min).toBeGreaterThan(0);
    const critical = p.alerts.filter((a) => a.level === 'critical');
    expect(critical.length).toBeGreaterThan(0);
    expect(critical[0].length_m).toBeGreaterThanOrEqual(100);
    for (const k of ['dr', 'ps', 'en'] as const) expect(critical[0].text[k].length).toBeGreaterThan(5);
    // Coloured segments: consecutive segments always change level, and the critical one is on the route.
    p.segments.forEach((s, i) => { if (i) expect(s.level).not.toBe(p.segments[i - 1].level); });
    expect(p.segments.some((s) => s.level === 'critical')).toBe(true);
  });

  it('visits several waypoints in order', () => {
    const { planner: pl } = planner();
    const wps = [at(2, 1), at(5, 1)];
    const [p] = pl.pace(ORIGIN, DEST, { P: wps });
    const idx = wps.map((w) => p.path.findIndex((q) => distanceM(q, w) < 1));
    expect(idx.every((i) => i > 0)).toBe(true);
    expect(idx[0]).toBeLessThan(idx[1]);
  });

  it('raises a blind-spot alert when the route crosses an unmonitored zone', () => {
    const cells = new Set<string>();
    for (let e = -400; e <= 400; e += 50) cells.add(latLngToCell(at(1, 4).lat, offset(at(1, 4), e, 0).lon, 9));
    const blind: BlindCells = { network: cells, monitoring: new Set(), zoneOf: (c) => (cells.has(c) ? { id: 'BS-N1', type: 'network', label: tri('بدون شبکه', 'بې شبکې', 'No network') } : undefined) };
    const { planner: pl } = planner({ blind, risk: riskStub(() => 0.02) });
    const [p] = pl.pace(ORIGIN, DEST);
    expect(p.alerts.some((a) => a.level === 'blind' && a.text.en.includes('BS-N1'))).toBe(true);
    expect(p.coverage_pct).toBeLessThan(100);
  });
});

function polyLen(pts: LatLon[]): number { return pts.slice(1).reduce((s, p, i) => s + distanceM(pts[i], p), 0); }
