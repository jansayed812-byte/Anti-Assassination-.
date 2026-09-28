#!/usr/bin/env node
// Downloads OpenStreetMap roads, facilities and restricted areas for each branch city via the Overpass API
// and writes services/data/osm/<BRANCH>/{roads,pois,restricted}.geojson. The server uses these instead of
// the synthetic city. Usage: npm run fetch:osm [-- MZR KBL HRT]   (env OVERPASS_URL to use another endpoint)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'services/data/osm');
const OVERPASS = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';

// Centre and urban semi-axes (m) — keep in sync with services/server/geodata/branches.ts
const BRANCHES = {
  MZR: { lat: 36.709, lon: 67.1109, e: 6500, n: 5000 },
  KBL: { lat: 34.5281, lon: 69.1723, e: 9000, n: 7000 },
  HRT: { lat: 34.3482, lon: 62.1997, e: 5500, n: 4500 },
};

const CLASS = {
  motorway: 'trunk', motorway_link: 'trunk', trunk: 'trunk', trunk_link: 'trunk',
  primary: 'primary', primary_link: 'primary', secondary: 'secondary', secondary_link: 'secondary',
  tertiary: 'tertiary', tertiary_link: 'tertiary', unclassified: 'tertiary', residential: 'residential', living_street: 'residential',
};
const KIND = { hospital: 'hospital', clinic: 'clinic', police: 'police', fuel: 'fuel' };

function bbox({ lat, lon, e, n }, marginM) {
  const dLat = (n * 1.15 + marginM) / 111320, dLon = (e * 1.15 + marginM) / (111320 * Math.cos((lat * Math.PI) / 180));
  return [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map((x) => x.toFixed(5)).join(',');
}

async function overpass(query) {
  if (process.env.HTTPS_PROXY || process.env.https_proxy) {
    return JSON.parse(execFileSync('curl', ['-sS', '--fail', '-m', '300', '--data-urlencode', `data=${query}`, OVERPASS], { maxBuffer: 1 << 30 }).toString());
  }
  const res = await fetch(OVERPASS, { method: 'POST', body: new URLSearchParams({ data: query }) });
  if (!res.ok) throw new Error(`Overpass ${res.status}: ${await res.text()}`);
  return res.json();
}

// Dari names are tagged name:prs, or name:fa in older Afghan OSM data.
const names = (t = {}) => ({ name_dr: t['name:prs'] || t['name:fa'] || t.name || undefined, name_ps: t['name:ps'] || undefined, name_en: t['name:en'] || undefined });
const r6 = (x) => Math.round(x * 1e6) / 1e6;

function simplify(pts, tolM) {
  if (pts.length < 3) return pts;
  const lat0 = (pts[0][1] * Math.PI) / 180, kx = 111320 * Math.cos(lat0), ky = 111320;
  const dist = (p, a, b) => {
    const [px, py, ax, ay, bx, by] = [p[0] * kx, p[1] * ky, a[0] * kx, a[1] * ky, b[0] * kx, b[1] * ky];
    const l2 = (bx - ax) ** 2 + (by - ay) ** 2, t = l2 ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2)) : 0;
    return Math.hypot(px - ax - t * (bx - ax), py - ay - t * (by - ay));
  };
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let idx = -1, max = tolM;
    for (let i = s + 1; i < e; i++) { const d = dist(pts[i], pts[s], pts[e]); if (d > max) { max = d; idx = i; } }
    if (idx > 0) { keep[idx] = true; stack.push([s, idx], [idx, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}

async function fetchBranch(id) {
  const b = BRANCHES[id];
  const inner = bbox(b, 1500), outer = bbox(b, 8000);
  console.log(`[${id}] roads…`);
  const roads = await overpass(`[out:json][timeout:240];(way["highway"~"^(motorway|trunk|primary)(_link)?$"](${outer});way["highway"~"^(secondary|tertiary)(_link)?$|^(unclassified|residential|living_street)$"](${inner}););out geom tags;`);
  console.log(`[${id}] facilities…`);
  const pois = await overpass(`[out:json][timeout:240];(nwr["amenity"~"^(hospital|clinic|police|fuel)$"](${inner});nwr["aeroway"="aerodrome"](${outer});nwr["office"="government"](${inner});nwr["landuse"="military"](${inner}););out center geom tags;`);

  const roadFeatures = roads.elements.filter((el) => el.type === 'way' && el.geometry && CLASS[el.tags.highway]).map((el) => ({
    type: 'Feature',
    properties: { id: `osm-w${el.id}`, cls: CLASS[el.tags.highway], oneway: el.tags.oneway === 'yes', maxspeed: parseInt(el.tags.maxspeed, 10) || undefined, ...names(el.tags) },
    geometry: { type: 'LineString', coordinates: simplify(el.geometry.map((g) => [r6(g.lon), r6(g.lat)]), 2) },
  }));

  const poiFeatures = [], restricted = [];
  for (const el of pois.elements) {
    const t = el.tags || {};
    const c = el.type === 'node' ? { lat: el.lat, lon: el.lon } : el.center;
    if (t.landuse === 'military' && el.geometry) {
      restricted.push({ type: 'Feature', properties: { id: `osm-${el.type[0]}${el.id}`, ...names(t) }, geometry: { type: 'Polygon', coordinates: [el.geometry.map((g) => [r6(g.lon), r6(g.lat)])] } });
      continue;
    }
    const kind = KIND[t.amenity] || (t.aeroway === 'aerodrome' ? 'airport' : t.office === 'government' ? 'government' : null);
    if (!kind || !c) continue;
    poiFeatures.push({ type: 'Feature', properties: { id: `osm-${el.type[0]}${el.id}`, kind, ...names(t) }, geometry: { type: 'Point', coordinates: [r6(c.lon), r6(c.lat)] } });
  }

  const dir = join(OUT, id);
  mkdirSync(dir, { recursive: true });
  const write = (f, features) => writeFileSync(join(dir, f), JSON.stringify({ type: 'FeatureCollection', features }));
  write('roads.geojson', roadFeatures);
  write('pois.geojson', poiFeatures);
  write('restricted.geojson', restricted);
  console.log(`[${id}] ${roadFeatures.length} roads, ${poiFeatures.length} facilities, ${restricted.length} restricted areas`);
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(BRANCHES);
for (const id of ids) {
  if (!BRANCHES[id]) { console.error(`unknown branch ${id}`); process.exit(1); }
  await fetchBranch(id);
}
