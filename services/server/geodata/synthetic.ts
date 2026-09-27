/**
 * Deterministic synthetic city used when no OpenStreetMap extract is present (see scripts/fetch-osm.mjs).
 * It is an obviously artificial street lattice with arterials, ring roads and sample facilities; the console
 * labels it as synthetic. Operational seeds (HQ, safe houses) are placed the same way on real OSM data.
 */
import { bboxOf, offset, type LatLon, type LngLat } from '../geo';
import { tri, type Tri } from '../i18n/types';
import type { BranchDef } from './branches';
import type { BranchGeo, Poi, PoiKind, RestrictedZone, Road, RoadClass } from './types';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SPACING = 300;
const DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const afN = (n: number) => String(n).replace(/\d/g, (d) => DIGITS[+d]);

/** Urban boundary: a slightly irregular ellipse (normalised radius factor per heading). */
export function boundaryShape(def: BranchDef): (e: number, n: number) => boolean {
  const s = def.seed;
  const f = (phi: number) => 1 + 0.07 * Math.sin(3 * phi + s) + 0.05 * Math.cos(5 * phi + 2 * s);
  return (e, n) => {
    const phi = Math.atan2(n, e), k = f(phi);
    return (e / (def.extent.eastM * k)) ** 2 + (n / (def.extent.northM * k)) ** 2 <= 1;
  };
}

export function boundaryRing(def: BranchDef): LngLat[] {
  const s = def.seed, out: LngLat[] = [];
  for (let i = 0; i <= 96; i++) {
    const phi = (i / 96) * 2 * Math.PI, k = 1 + 0.07 * Math.sin(3 * phi + s) + 0.05 * Math.cos(5 * phi + 2 * s);
    const p = offset(def.center, def.extent.eastM * k * Math.cos(phi), def.extent.northM * k * Math.sin(phi));
    out.push([p.lon, p.lat]);
  }
  return out;
}

const ARTERIALS: Array<{ bearing: number; name: Tri; extendM: number }> = [
  { bearing: 0, name: tri('سرک شریانی شمال', 'شمالي شریاني سړک', 'North arterial'), extendM: 5000 },
  { bearing: 90, name: tri('سرک شریانی شرق', 'ختیځ شریاني سړک', 'East arterial'), extendM: 5000 },
  { bearing: 135, name: tri('شاهراه جنوب‌شرق', 'سویل ختیځه لویه لار', 'South-east highway'), extendM: 7000 },
  { bearing: 200, name: tri('سرک شریانی جنوب', 'سویلي شریاني سړک', 'South arterial'), extendM: 4000 },
  { bearing: 270, name: tri('شاهراه غرب', 'لوېدیځه لویه لار', 'West highway'), extendM: 7000 },
  { bearing: 315, name: tri('سرک شریانی شمال‌غرب', 'شمال لوېدیځ شریاني سړک', 'North-west arterial'), extendM: 4000 },
];

const RINGS: Array<{ radius: number; name: Tri }> = [
  { radius: 1500, name: tri('سرک حلقوی داخلی', 'دننی کړۍ سړک', 'Inner ring road') },
  { radius: 3300, name: tri('سرک حلقوی بیرونی', 'بهرنی کړۍ سړک', 'Outer ring road') },
];

type Node = { key: string; e: number; n: number; i: number; j: number };

export function syntheticGeo(def: BranchDef, extra: { airport?: LatLon } = {}): BranchGeo {
  const rnd = mulberry32(def.seed);
  const inside = boundaryShape(def);
  const th = (def.rotationDeg * Math.PI) / 180;
  const nodes = new Map<string, Node>();
  const R = Math.ceil(Math.max(def.extent.eastM, def.extent.northM) * 1.25 / SPACING);
  for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
    const x = i * SPACING, y = j * SPACING;
    const e = x * Math.cos(th) - y * Math.sin(th) + (rnd() - 0.5) * 70;
    const n = x * Math.sin(th) + y * Math.cos(th) + (rnd() - 0.5) * 70;
    if (inside(e, n)) nodes.set(`${i},${j}`, { key: `${i},${j}`, e, n, i, j });
  }

  type Edge = { a: string; b: string; cls: RoadClass; name?: Tri };
  const edges = new Map<string, Edge>();
  const ek = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const nd of nodes.values()) {
    for (const [di, dj] of [[1, 0], [0, 1]]) {
      const other = nodes.get(`${nd.i + di},${nd.j + dj}`);
      if (!other) continue;
      const collector = di === 1 ? nd.j % 4 === 0 : nd.i % 4 === 0;
      edges.set(ek(nd.key, other.key), { a: nd.key, b: other.key, cls: collector ? 'tertiary' : 'residential' });
    }
  }

  const neighbours = (nd: Node) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([di, dj]) => nodes.get(`${nd.i + di},${nd.j + dj}`)).filter((x): x is Node => !!x);
  const centre = [...nodes.values()].reduce((best, nd) => (Math.hypot(nd.e, nd.n) < Math.hypot(best.e, best.n) ? nd : best));

  // Rings: tangential lattice edges near each radius become secondary roads.
  for (const ring of RINGS) {
    for (const ed of edges.values()) {
      const A = nodes.get(ed.a)!, B = nodes.get(ed.b)!;
      const me = (A.e + B.e) / 2, mn = (A.n + B.n) / 2, d = Math.hypot(me, mn);
      const radial = Math.abs(((B.e - A.e) * me + (B.n - A.n) * mn) / (d * Math.hypot(B.e - A.e, B.n - A.n) || 1));
      if (Math.abs(d - ring.radius) < SPACING * 0.6 && radial < 0.55) { ed.cls = 'secondary'; ed.name = ring.name; }
    }
  }

  // Arterials: greedy walk from the centre along a heading, then a straight extension beyond the city.
  const extraRoads: Road[] = [];
  let seq = 0;
  for (const art of ARTERIALS) {
    const dir: [number, number] = [Math.sin((art.bearing * Math.PI) / 180), Math.cos((art.bearing * Math.PI) / 180)];
    let cur = centre;
    const seen = new Set([cur.key]);
    for (;;) {
      let best: Node | undefined, bestScore = 0.35;
      for (const nb of neighbours(cur)) {
        if (seen.has(nb.key)) continue;
        const de = nb.e - cur.e, dn = nb.n - cur.n, len = Math.hypot(de, dn);
        const along = (de * dir[0] + dn * dir[1]) / len;
        const lateral = Math.abs((nb.e * dir[1] - nb.n * dir[0]) / 1000);
        const score = along - 0.25 * lateral;
        if (score > bestScore) { bestScore = score; best = nb; }
      }
      if (!best) break;
      const ed = edges.get(ek(cur.key, best.key));
      if (ed) { ed.cls = 'primary'; ed.name = art.name; }
      seen.add(best.key);
      cur = best;
    }
    const start = offset(def.center, cur.e, cur.n);
    const coords: LngLat[] = [[start.lon, start.lat]];
    const steps = Math.ceil(art.extendM / 500);
    for (let k = 1; k <= steps; k++) {
      const p = offset(def.center, cur.e + dir[0] * 500 * k, cur.n + dir[1] * 500 * k);
      coords.push([p.lon, p.lat]);
    }
    extraRoads.push({ id: `S-${def.id}-ext-${seq++}`, cls: 'trunk', name: art.name, oneway: false, coords });
  }

  // Sparse the local streets a little, keep the largest connected component.
  for (const [k, ed] of edges) if (ed.cls === 'residential' && rnd() < 0.1) edges.delete(k);
  const adj = new Map<string, string[]>();
  for (const ed of edges.values()) { (adj.get(ed.a) ?? adj.set(ed.a, []).get(ed.a)!).push(ed.b); (adj.get(ed.b) ?? adj.set(ed.b, []).get(ed.b)!).push(ed.a); }
  const comp = new Set<string>();
  const stack = [centre.key];
  while (stack.length) { const k = stack.pop()!; if (comp.has(k)) continue; comp.add(k); for (const x of adj.get(k) ?? []) if (!comp.has(x)) stack.push(x); }

  const toLL = (nd: Node): LngLat => { const p = offset(def.center, nd.e, nd.n); return [p.lon, p.lat]; };
  const roads: Road[] = [...extraRoads];
  for (const ed of edges.values()) {
    if (!comp.has(ed.a) || !comp.has(ed.b)) continue;
    roads.push({ id: `S-${def.id}-${seq++}`, cls: ed.cls, name: ed.name, oneway: false, coords: [toLL(nodes.get(ed.a)!), toLL(nodes.get(ed.b)!)] });
  }

  // Facilities at fixed polar positions, snapped onto the nearest street node.
  const connected = [...nodes.values()].filter((nd) => comp.has(nd.key));
  const at = (distM: number, bearing: number): LatLon => {
    const e = distM * Math.sin((bearing * Math.PI) / 180), n = distM * Math.cos((bearing * Math.PI) / 180);
    const nd = connected.reduce((best, x) => (Math.hypot(x.e - e, x.n - n) < Math.hypot(best.e - e, best.n - n) ? x : best));
    return offset(def.center, nd.e, nd.n);
  };
  const pois: Poi[] = [];
  const add = (kind: PoiKind, name: Tri, p: LatLon, synthetic = true) => pois.push({ id: `${def.id}-${kind}-${pois.filter((x) => x.kind === kind).length + 1}`, kind, name, lat: p.lat, lon: p.lon, synthetic });
  const sample = (dr: string, ps: string, en: string) => tri(`${dr} (نمونه)`, `${ps} (بېلګه)`, `${en} (sample)`);
  add('hospital', sample('شفاخانهٔ ساحوی', 'سیمه‌ییز روغتون', 'Regional hospital'), at(1200, 200));
  add('hospital', sample('شفاخانهٔ ملکی', 'ملکي روغتون', 'Civil hospital'), at(2600, 330));
  add('clinic', sample('کلینیک صحی', 'روغتیايي کلینیک', 'Health clinic'), at(3000, 120));
  [[900, 300], [2000, 30], [3000, 180], [4200, 250]].forEach(([d, b], k) =>
    add('police', sample(`حوزهٔ پولیس ${afN(k + 1)}`, `د پولیسو ${afN(k + 1)} حوزه`, `Police district ${k + 1}`), at(d, b)));
  [[1500, 90], [3300, 260], [4000, 10]].forEach(([d, b]) => add('fuel', sample('تانک تیل', 'د تېلو ټانک', 'Fuel station'), at(d, b)));
  add('government', sample('ریاست ولایت', 'ولایتي مقام', 'Provincial governor office'), at(500, 160));
  if (extra.airport) add('airport', tri('میدان هوایی', 'هوايي ډګر', 'Airport'), extra.airport, false);

  const restricted: RestrictedZone[] = [];
  const mil = at(4300, 45);
  const ring: LngLat[] = [];
  for (let k = 0; k <= 36; k++) { const a = (k / 36) * 2 * Math.PI; const p = offset(mil, 550 * Math.cos(a), 550 * Math.sin(a)); ring.push([p.lon, p.lat]); }
  restricted.push({ id: `${def.id}-R1`, name: sample('ساحهٔ نظامی ممنوع', 'منع شوې پوځي سیمه', 'Restricted military area'), ring });

  const boundary = boundaryRing(def);
  return { def, source: 'synthetic', boundary, bbox: bboxOf(boundary), roads, pois, restricted };
}

/** Operational seeds that exist regardless of the base data: branch HQ and safe houses (exercise data). */
export function operationalSites(def: BranchDef, snap: (p: LatLon) => LatLon): Poi[] {
  const at = (distM: number, bearing: number) => snap(offset(def.center, distM * Math.sin((bearing * Math.PI) / 180), distM * Math.cos((bearing * Math.PI) / 180)));
  const hq = at(700, 60), sh1 = at(3600, 285), sh2 = at(2800, 140);
  return [
    { id: `${def.id}-HQ`, kind: 'hq', name: tri(`قرارگاه ${def.city.dr}`, `د ${def.city.ps} قرارګاه`, `${def.city.en} HQ`), lat: hq.lat, lon: hq.lon, synthetic: true },
    { id: `${def.id}-SH-001`, kind: 'safe_house', name: tri('خانهٔ امن SH-001', 'خوندي کور SH-001', 'Safe house SH-001'), lat: sh1.lat, lon: sh1.lon, synthetic: true },
    { id: `${def.id}-SH-002`, kind: 'safe_house', name: tri('خانهٔ امن SH-002', 'خوندي کور SH-002', 'Safe house SH-002'), lat: sh2.lat, lon: sh2.lon, synthetic: true },
  ];
}
