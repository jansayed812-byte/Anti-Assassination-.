/**
 * Road graph built from the branch's road features, with nearest-node lookup and A* search.
 * Edge weights are supplied per query so the same graph serves fastest, risk-weighted and penalised searches.
 */
import { distanceM, type LatLon } from '../geo';
import { ROAD_SPEED_KMH, type Road, type RoadClass } from '../geodata/types';
import type { Tri } from '../i18n/types';

export interface Edge { id: number; from: number; to: number; len: number; speedKmh: number; cls: RoadClass; name?: Tri; mid: LatLon }
export interface Path { nodes: number[]; edges: Edge[]; cost: number }

/** Urban slow-down applied to posted/class speeds for ETA. */
export const URBAN_FACTOR = 0.8;
export const edgeSeconds = (e: Edge) => e.len / ((e.speedKmh * URBAN_FACTOR) / 3.6);

class MinHeap {
  private a: Array<[number, number]> = [];
  push(k: number, v: number) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop(): [number, number] | undefined {
    const a = this.a; if (!a.length) return undefined;
    const top = a[0], last = a.pop()!;
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
  get size() { return this.a.length; }
}

export class RoadGraph {
  readonly nodes: LatLon[] = [];
  readonly out: Edge[][] = [];
  readonly edges: Edge[] = [];
  private index = new Map<string, number>();
  private grid = new Map<string, number[]>();
  private maxSpeed = 1;
  private static CELL = 0.004;

  constructor(roads: Road[]) {
    for (const r of roads) {
      const speed = r.maxspeed && r.maxspeed > 5 ? r.maxspeed : ROAD_SPEED_KMH[r.cls];
      this.maxSpeed = Math.max(this.maxSpeed, speed);
      for (let i = 0; i < r.coords.length - 1; i++) {
        const a = this.node(r.coords[i][1], r.coords[i][0]), b = this.node(r.coords[i + 1][1], r.coords[i + 1][0]);
        if (a === b) continue;
        this.link(a, b, speed, r);
        if (!r.oneway) this.link(b, a, speed, r);
      }
    }
  }

  private node(lat: number, lon: number): number {
    const key = `${lat.toFixed(6)},${lon.toFixed(6)}`;
    let id = this.index.get(key);
    if (id === undefined) {
      id = this.nodes.length;
      this.nodes.push({ lat, lon });
      this.out.push([]);
      this.index.set(key, id);
      const g = `${Math.floor(lat / RoadGraph.CELL)},${Math.floor(lon / RoadGraph.CELL)}`;
      (this.grid.get(g) ?? this.grid.set(g, []).get(g)!).push(id);
    }
    return id;
  }

  private link(a: number, b: number, speedKmh: number, r: Road) {
    const A = this.nodes[a], B = this.nodes[b];
    const e: Edge = { id: this.edges.length, from: a, to: b, len: distanceM(A, B), speedKmh, cls: r.cls, name: r.name, mid: { lat: (A.lat + B.lat) / 2, lon: (A.lon + B.lon) / 2 } };
    this.edges.push(e);
    this.out[a].push(e);
  }

  /** Nearest graph node (searches the surrounding grid rings until a hit, then one more ring). */
  nearest(p: LatLon, drivableOnly = true): { node: number; distM: number } {
    const gi = Math.floor(p.lat / RoadGraph.CELL), gj = Math.floor(p.lon / RoadGraph.CELL);
    let best = -1, bestD = Infinity;
    for (let ring = 0; ring < 60; ring++) {
      for (let di = -ring; di <= ring; di++) for (let dj = -ring; dj <= ring; dj++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
        for (const id of this.grid.get(`${gi + di},${gj + dj}`) ?? []) {
          if (drivableOnly && this.out[id].length === 0) continue;
          const d = distanceM(p, this.nodes[id]);
          if (d < bestD) { bestD = d; best = id; }
        }
      }
      if (best >= 0 && ring > 0 && bestD < ring * RoadGraph.CELL * 111_000 * 0.8) break;
    }
    return { node: best, distM: bestD };
  }

  /** A* with a caller-supplied edge cost (seconds-like; must be ≥ travel time for the heuristic to stay admissible). */
  astar(from: number, to: number, cost: (e: Edge) => number): Path | null {
    if (from === to) return { nodes: [from], edges: [], cost: 0 };
    const target = this.nodes[to];
    const h = (n: number) => distanceM(this.nodes[n], target) / ((this.maxSpeed * URBAN_FACTOR) / 3.6);
    const g = new Map<number, number>([[from, 0]]);
    const prev = new Map<number, Edge>();
    const open = new MinHeap();
    open.push(h(from), from);
    const closed = new Set<number>();
    while (open.size) {
      const [, n] = open.pop()!;
      if (n === to) break;
      if (closed.has(n)) continue;
      closed.add(n);
      const gn = g.get(n)!;
      for (const e of this.out[n]) {
        const c = gn + cost(e);
        if (c < (g.get(e.to) ?? Infinity)) { g.set(e.to, c); prev.set(e.to, e); open.push(c + h(e.to), e.to); }
      }
    }
    if (!prev.has(to)) return null;
    const edges: Edge[] = [];
    for (let n = to; n !== from; ) { const e = prev.get(n)!; edges.push(e); n = e.from; }
    edges.reverse();
    return { nodes: [from, ...edges.map((e) => e.to)], edges, cost: g.get(to)! };
  }
}
