/** Geodesy helpers for map overlays (WGS84; metres). Kept dependency-free and exact to well under a metre. */
import type { LatLon, LngLat } from '../api/types';

const R = 6_371_008.8;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function distanceM(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Point at `distM` metres from `c` along `bearingDeg` (great circle). */
export function destination(c: LatLon, distM: number, bearingDeg: number): LatLon {
  const d = distM / R, th = rad(bearingDeg), p1 = rad(c.lat), l1 = rad(c.lon);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(th));
  const l2 = l1 + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: deg(p2), lon: ((deg(l2) + 540) % 360) - 180 };
}

export function circle(c: LatLon, radiusM: number, steps = 48): LngLat[] {
  const ring: LngLat[] = [];
  for (let i = 0; i <= steps; i++) { const p = destination(c, radiusM, (i / steps) * 360); ring.push([p.lon, p.lat]); }
  return ring;
}

/** Camera field-of-view wedge (fov ≥ 360 → full circle). */
export function sector(c: LatLon, radiusM: number, headingDeg: number, fovDeg: number, steps = 24): LngLat[] {
  if (fovDeg >= 360) return circle(c, radiusM, steps * 2);
  const ring: LngLat[] = [[c.lon, c.lat]];
  for (let i = 0; i <= steps; i++) { const p = destination(c, radiusM, headingDeg - fovDeg / 2 + (fovDeg * i) / steps); ring.push([p.lon, p.lat]); }
  ring.push([c.lon, c.lat]);
  return ring;
}

/** Reach of a relay under the server's log-distance model (RSSI threshold −95 dBm, PL0 32 dB, exponent 3). */
export const relayReachM = (txDbm: number, gainDb: number) => 10 ** ((txDbm + gainDb - 32 + 95) / 30);

/** Distance along the polyline of the point on it nearest to p (planar approximation per segment). */
export function alongM(path: LatLon[], p: LatLon): { at: number; off: number } {
  let best = { at: 0, off: Infinity }, acc = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const kx = Math.cos(rad(a.lat)) * 111_320, ky = 110_540;
    const bx = (b.lon - a.lon) * kx, by = (b.lat - a.lat) * ky, px = (p.lon - a.lon) * kx, py = (p.lat - a.lat) * ky;
    const len2 = bx * bx + by * by;
    const t = len2 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
    const off = Math.hypot(px - t * bx, py - t * by);
    if (off < best.off) best = { at: acc + t * Math.sqrt(len2), off };
    acc += Math.sqrt(len2);
  }
  return best;
}

/** Index at which a new waypoint belongs so the waypoint order follows the route. */
export function insertionIndex(path: LatLon[], waypoints: LatLon[], p: LatLon): number {
  const at = alongM(path, p).at;
  const idx = waypoints.findIndex((w) => alongM(path, w).at > at);
  return idx < 0 ? waypoints.length : idx;
}
