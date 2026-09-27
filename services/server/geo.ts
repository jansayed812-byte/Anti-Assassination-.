/**
 * Local tangent-plane projection shared by the server and the operations console map.
 * One scene unit = 20 m; +x = east, -z = north. Origin = operations area center.
 */
export const ORIGIN = { lat: 35.6892, lon: 51.389 };
export const METERS_PER_UNIT = 20;
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = 111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

export type LatLon = { lat: number; lon: number };
export type XZ = [number, number];

export function toLatLon([x, z]: XZ): LatLon {
  return {
    lat: +(ORIGIN.lat - (z * METERS_PER_UNIT) / M_PER_DEG_LAT).toFixed(6),
    lon: +(ORIGIN.lon + (x * METERS_PER_UNIT) / M_PER_DEG_LON).toFixed(6),
  };
}

export function toXZ({ lat, lon }: LatLon): XZ {
  return [((lon - ORIGIN.lon) * M_PER_DEG_LON) / METERS_PER_UNIT, (-(lat - ORIGIN.lat) * M_PER_DEG_LAT) / METERS_PER_UNIT];
}

export function distanceM(a: LatLon, b: LatLon): number {
  const R = 6_371_000, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function bearingDeg(a: LatLon, b: LatLon): number {
  const y = Math.sin(((b.lon - a.lon) * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180);
  const x = Math.cos((a.lat * Math.PI) / 180) * Math.sin((b.lat * Math.PI) / 180) -
    Math.sin((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.cos(((b.lon - a.lon) * Math.PI) / 180);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Point at fraction t (0–1) along a polyline, by arc length. */
export function alongPolyline(pts: LatLon[], t: number): LatLon {
  const seg = pts.slice(1).map((p, i) => distanceM(pts[i], p));
  const total = seg.reduce((s, d) => s + d, 0);
  let target = Math.max(0, Math.min(1, t)) * total;
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
