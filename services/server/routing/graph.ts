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

/** Binary min-heap of (key, node) pairs in typed arrays — no per-push allocation. */
class MinHeap {
  private k = new Float64Array(1024);
  private v = new Int32Array(1024);
  private n = 0;
  push(key: number, val: number): void {
    if (this.n === this.k.length) {
      const k = new Float64Array(this.n * 2), v = new Int32Array(this.n * 2);
      k.set(this.k); v.set(this.v); this.k = k; this.v = v;
    }
    let i = this.n++;
    while (i > 0) { const p = (i - 1) >> 1; if (this.k[p] <= key) break; this.k[i] = this.k[p]; this.v[i] = this.v[p]; i = p; }
    this.k[i] = key; this.v[i] = val;
  }
  /** Removes the entry with the smallest key and returns its node. */
  pop(): number {
    const top = this.v[0], n = --this.n;
    if (n > 0) {
      const key = this.k[n], val = this.v[n];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const m = l + 1 < n && this.k[l + 1] < this.k[l] ? l + 1 : l;
        if (this.k[m] >= key) break;
        this.k[i] = this.k[m]; this.v[i] = this.v[m]; i = m;
      }
      this.k[i] = key; this.v[i] = val;
    }
    return top;
  }
  get size(): number { return this.n; }
}

export class RoadGraph {
  readonly nodes: LatLon[] = [];
  readonly out: Edge[][] = [];
  readonly edges: Edge[] = [];
  private index = new Map<string, number>();
  private grid = new Map<string, number[]>();
  private maxSpeed = 1;
  private static CELL = 0.004;
  /** Node positions in metres on a local equirectangular plane (cheap A* heuristic). */
  private px = new Float64Array(0);
  private py = new Float64Array(0);

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
    const lat0 = this.nodes.reduce((sum, p) => sum + p.lat, 0) / Math.max(1, this.nodes.length);
    const k = (Math.PI / 180) * 6_371_000, kx = k * Math.cos((lat0 * Math.PI) / 180);
    this.px = Float64Array.from(this.nodes, (p) => p.lon * kx);
    this.py = Float64Array.from(this.nodes, (p) => p.lat * k);
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
    // Straight-line time at the top speed, shrunk by 1 % so the planar approximation (≤ 0.2 % off across a
    // city) can never overestimate — the heuristic stays admissible and A* optimal.
    const tx = this.px[to], ty = this.py[to], px = this.px, py = this.py;
    const inv = 0.99 / ((this.maxSpeed * URBAN_FACTOR) / 3.6);
    return this.search(from, (n) => n === to, (n) => Math.hypot(px[n] - tx, py[n] - ty) * inv, cost);
  }

  /**
   * Cheapest path from `from` to whichever node of `targets` is cheapest to reach (Dijkstra, stops at the first
   * target settled) — one search instead of one per candidate.
   */
  nearestOf(from: number, targets: Set<number>, cost: (e: Edge) => number): (Path & { target: number }) | null {
    if (targets.has(from)) return { nodes: [from], edges: [], cost: 0, target: from };
    const p = this.search(from, (n) => targets.has(n), () => 0, cost);
    return p ? { ...p, target: p.nodes[p.nodes.length - 1] } : null;
  }

  /** Best-first search over typed arrays (per-call allocation is cheap next to Map bookkeeping on large graphs). */
  private search(from: number, isGoal: (n: number) => boolean, h: (n: number) => number, cost: (e: Edge) => number): Path | null {
    const n = this.nodes.length;
    const g = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const open = new MinHeap();
    g[from] = 0;
    open.push(h(from), from);
    let goal = -1;
    while (open.size) {
      const u = open.pop();
      if (closed[u]) continue;
      if (isGoal(u)) { goal = u; break; }
      closed[u] = 1;
      const gu = g[u];
      for (const e of this.out[u]) {
        if (closed[e.to]) continue;
        const c = gu + cost(e);
        if (c < g[e.to]) { g[e.to] = c; prev[e.to] = e.id; open.push(c + h(e.to), e.to); }
      }
    }
    if (goal < 0) return null;
    const edges: Edge[] = [];
    for (let v = goal; v !== from; ) { const e = this.edges[prev[v]]; edges.push(e); v = e.from; }
    edges.reverse();
    return { nodes: [from, ...edges.map((e) => e.to)], edges, cost: g[goal] };
  }
}
