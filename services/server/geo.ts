/**
 * Geodesic helpers. All coordinates are WGS84; LngLat tuples follow GeoJSON order [lon, lat].
 */
export type LatLon = { lat: number; lon: number };
export type LngLat = [number, number];

const R_EARTH = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

export const ll = (p: LngLat): LatLon => ({ lat: p[1], lon: p[0] });
export const lngLat = (p: LatLon): LngLat => [p.lon, p.lat];

export function distanceM(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return R_EARTH * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function bearingDeg(a: LatLon, b: LatLon): number {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Point `eastM`/`northM` metres from `p`. Longitude is scaled at the mean latitude of the two points, which keeps
 * the geodesic distance within a few centimetres of hypot(east, north) across a city (±10 km).
 */
export function offset(p: LatLon, eastM: number, northM: number): LatLon {
  const lat = p.lat + (northM / R_EARTH) * (180 / Math.PI);
  return {
    lat: +lat.toFixed(7),
    lon: +(p.lon + (eastM / (R_EARTH * Math.cos(rad((p.lat + lat) / 2)))) * (180 / Math.PI)).toFixed(7),
  };
}

/** Local east/north metres of `p` relative to `origin` (inverse of `offset`). */
export function toLocal(origin: LatLon, p: LatLon): [number, number] {
  return [rad(p.lon - origin.lon) * R_EARTH * Math.cos(rad((origin.lat + p.lat) / 2)), rad(p.lat - origin.lat) * R_EARTH];
}

/** Point at fraction t (0–1) along a polyline, by arc length. */
export function alongPolyline(pts: LatLon[], t: number): LatLon {
  if (pts.length === 1) return pts[0];
  const seg = pts.slice(1).map((p, i) => distanceM(pts[i], p));
  let target = Math.max(0, Math.min(1, t)) * seg.reduce((s, d) => s + d, 0);
  for (let i = 0; i < seg.length; i++) {
    if (target <= seg[i] || i === seg.length - 1) {
      const k = seg[i] ? Math.min(1, target / seg[i]) : 0;
      return { lat: pts[i].lat + (pts[i + 1].lat - pts[i].lat) * k, lon: pts[i].lon + (pts[i + 1].lon - pts[i].lon) * k };
    }
    target -= seg[i];
  }
  return pts[pts.length - 1];
}

export function polylineLengthM(pts: LatLon[]): number {
  return pts.slice(1).reduce((s, p, i) => s + distanceM(pts[i], p), 0);
}

/** Distance from p to segment ab, and the fraction along ab of the closest point. */
export function pointSegment(p: LatLon, a: LatLon, b: LatLon): { d: number; t: number } {
  const [px, py] = toLocal(a, p), [bx, by] = toLocal(a, b);
  const len2 = bx * bx + by * by;
  const t = len2 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
  return { d: Math.hypot(px - t * bx, py - t * by), t };
}

export function distanceToPolylineM(p: LatLon, pts: LatLon[]): number {
  if (pts.length === 1) return distanceM(p, pts[0]);
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) best = Math.min(best, pointSegment(p, pts[i], pts[i + 1]).d);
  return best;
}

/** Ray-casting point-in-polygon on a closed or open ring of [lon, lat]. */
export function pointInRing(p: LatLon, ring: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p.lat) !== (yj > p.lat) && p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function bboxOf(pts: LngLat[]): [number, number, number, number] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of pts) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return [w, s, e, n];
}

/** Approximate circle polygon (for CEP rings and zone buffers). */
export function circleRing(c: LatLon, radiusM: number, steps = 48): LngLat[] {
  const out: LngLat[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    const p = offset(c, radiusM * Math.cos(a), radiusM * Math.sin(a));
    out.push([p.lon, p.lat]);
  }
  return out;
}
