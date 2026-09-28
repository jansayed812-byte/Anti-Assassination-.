/**
 * Coordinate accuracy (requirement: ≤ 5 m). The server keeps WGS84 end to end and rounds to 6 decimals;
 * these tests bound the error of every geodesic helper the map, risk grid and router rely on.
 */
import { describe, it, expect } from 'vitest';
import { alongPolyline, bearingDeg, bboxOf, circleRing, distanceM, distanceToPolylineM, offset, pointInRing, polylineLengthM, toLocal, type LatLon } from '../../services/server/geo';
import { BRANCHES } from '../../services/server/geodata/branches';

const MAZAR: LatLon = { lat: 36.709, lon: 67.1109 };
const round6 = (p: LatLon): LatLon => ({ lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6) });
const rad = (d: number) => (d * Math.PI) / 180;

describe('geodesic distance and bearing', () => {
  it('matches reference great-circle distances', () => {
    // One degree of longitude on the equator and of latitude on a meridian (sphere R = 6 371 km).
    expect(distanceM({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(111_194.9, 0);
    expect(distanceM({ lat: 10, lon: 20 }, { lat: 11, lon: 20 })).toBeCloseTo(111_194.9, 0);
    // Mazar-i-Sharif → Kabul city centres: ≈ 306 km in a straight line (the road via Salang is ≈ 420 km).
    const kabul = BRANCHES.find((b) => b.id === 'KBL')!.center;
    expect(distanceM(MAZAR, kabul) / 1000).toBeGreaterThan(303);
    expect(distanceM(MAZAR, kabul) / 1000).toBeLessThan(309);
    expect(distanceM(MAZAR, MAZAR)).toBe(0);
  });

  it('is symmetric and obeys the triangle inequality', () => {
    const a = MAZAR, b = offset(MAZAR, 3000, 1200), c = offset(MAZAR, -800, 4100);
    expect(distanceM(a, b)).toBeCloseTo(distanceM(b, a), 9);
    expect(distanceM(a, c)).toBeLessThanOrEqual(distanceM(a, b) + distanceM(b, c));
  });

  it('gives compass bearings', () => {
    expect(bearingDeg(MAZAR, offset(MAZAR, 0, 1000))).toBeCloseTo(0, 1);
    expect(bearingDeg(MAZAR, offset(MAZAR, 1000, 0))).toBeCloseTo(90, 1);
    expect(bearingDeg(MAZAR, offset(MAZAR, 0, -1000))).toBeCloseTo(180, 1);
    expect(bearingDeg(MAZAR, offset(MAZAR, -1000, 0))).toBeCloseTo(270, 1);
  });
});

describe('local tangent plane (offset / toLocal)', () => {
  it('round-trips points across a 20 km city with < 0.5 m error', () => {
    let worst = 0;
    for (let e = -10_000; e <= 10_000; e += 1250) {
      for (let n = -10_000; n <= 10_000; n += 1250) {
        const p = offset(MAZAR, e, n);
        const [x, y] = toLocal(MAZAR, p);
        worst = Math.max(worst, Math.hypot(x - e, y - n));
      }
    }
    expect(worst).toBeLessThan(0.5);
  });

  it('places offset points at the requested geodesic distance (< 0.1 m up to 14 km, any direction)', () => {
    let worst = 0;
    for (let a = 0; a < 360; a += 15) {
      for (const r of [100, 1000, 5000, 10_000, 14_000]) {
        const e = r * Math.sin(rad(a)), n = r * Math.cos(rad(a));
        worst = Math.max(worst, Math.abs(distanceM(MAZAR, offset(MAZAR, e, n)) - r));
      }
    }
    expect(worst).toBeLessThan(0.1);
  });

  it('keeps the 6-decimal wire format within 0.11 m of the true point', () => {
    for (const b of BRANCHES) {
      for (let i = 0; i < 50; i++) {
        const p = offset(b.center, Math.sin(i * 1.7) * 6000 + 0.0137 * i, Math.cos(i * 2.3) * 5000 + 0.0291 * i);
        expect(distanceM(p, round6(p))).toBeLessThan(0.11);
      }
    }
  });
});

describe('polylines and polygons', () => {
  const line = [MAZAR, offset(MAZAR, 1000, 0), offset(MAZAR, 1000, 1000)];

  it('measures length and interpolates by arc length', () => {
    expect(polylineLengthM(line)).toBeCloseTo(2000, 0);
    expect(distanceM(alongPolyline(line, 0.25), offset(MAZAR, 500, 0))).toBeLessThan(0.5);
    expect(distanceM(alongPolyline(line, 0.75), offset(MAZAR, 1000, 500))).toBeLessThan(0.5);
    expect(alongPolyline(line, 0)).toEqual(line[0]);
    expect(distanceM(alongPolyline(line, 1), line[2])).toBeLessThan(0.01);
    expect(distanceM(alongPolyline(line, 7), line[2])).toBeLessThan(0.01);
  });

  it('measures perpendicular distance to a polyline', () => {
    expect(distanceToPolylineM(offset(MAZAR, 500, 40), line)).toBeCloseTo(40, 0);
    expect(distanceToPolylineM(offset(MAZAR, 1100, 700), line)).toBeCloseTo(100, 0);
    expect(distanceToPolylineM(offset(MAZAR, -300, 0), line)).toBeCloseTo(300, 0);
  });

  it('builds circles of the requested radius and tests containment', () => {
    const ring = circleRing(MAZAR, 250, 64);
    for (const [lon, lat] of ring) expect(Math.abs(distanceM(MAZAR, { lat, lon }) - 250)).toBeLessThan(0.5);
    expect(pointInRing(MAZAR, ring)).toBe(true);
    expect(pointInRing(offset(MAZAR, 240, 0), ring)).toBe(true);
    expect(pointInRing(offset(MAZAR, 260, 0), ring)).toBe(false);
    const [w, s, e, n] = bboxOf(ring);
    expect(w).toBeLessThan(MAZAR.lon); expect(e).toBeGreaterThan(MAZAR.lon);
    expect(s).toBeLessThan(MAZAR.lat); expect(n).toBeGreaterThan(MAZAR.lat);
  });
});
