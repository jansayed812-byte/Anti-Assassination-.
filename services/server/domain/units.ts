/**
 * Unit tracking. Each unit's ground truth is simulated (alpha drives the running plan's active
 * route); sensor readings derived from it are fused by FusionOrchestrator, and the fused estimate
 * is what gets published — position, CEP95, source mix and risk at that position.
 */
import { FusionOrchestrator } from '../../fusion/fusion-orchestrator';
import { alongPolyline, bearingDeg, distanceM, polylineLengthM, toLatLon, ORIGIN, type LatLon } from '../geo';
import type { RiskModel } from './risk';
import type { RiskLevel } from '../../threat/risk-engine';

export type SourceKind = 'gnss' | 'wifi' | 'ble' | 'cellular';

export interface UnitMeta {
  id: string; name: string; icon: string; group: 'mission' | 'standby'; sub: string; mission: string | null;
  sources: SourceKind[]; comms: 'ok' | 'lost';
}

export interface UnitTelemetry {
  id: string; lat: number; lon: number; alt_m: number; speed_kmh: number; heading_deg: number; accel_mps2: number;
  cep95_m: number; confidence: number; degraded: boolean; mode: string;
  fusion: Array<{ source: string; share: number }>; risk_score: number; risk_level: RiskLevel;
  route?: string; route_progress?: number;
}

const NOISE_M: Record<SourceKind, number> = { gnss: 2, wifi: 3, ble: 2.5, cellular: 6 };
const ACC_M: Record<SourceKind, number> = { gnss: 3, wifi: 6, ble: 4, cellular: 8 };
const LABEL: Record<SourceKind, string> = { gnss: 'GNSS', wifi: 'Wi-Fi', ble: 'BLE', cellular: 'Cell' };

function jitter(p: LatLon, sigmaM: number): LatLon {
  const g = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  return { lat: p.lat + (g() * sigmaM) / 111_320, lon: p.lon + (g() * sigmaM) / (111_320 * Math.cos((p.lat * Math.PI) / 180)) };
}

function measurement(kind: SourceKind, id: string, p: LatLon, altM: number) {
  const m = jitter(p, NOISE_M[kind]);
  const acc = ACC_M[kind];
  const data =
    kind === 'gnss' ? { fix_type: '3d', latitude: m.lat, longitude: m.lon, altitude_m: altM, velocity_north_mps: 0, velocity_east_mps: 0, velocity_down_mps: 0, hdop: 0.9, vdop: 1.3, pdop: 1.6, h_accuracy_m: acc, v_accuracy_m: acc * 1.5, gnss_constellation: 'mixed', satellites_used: 12, satellites_visible: 17, utc_time: new Date().toISOString() }
    : kind === 'wifi' ? { access_point_mac: `ap-${id}`, latitude: m.lat, longitude: m.lon, accuracy_m: acc, rssi_dbm: -58, rtt_ns: 120, source_type: 'wifi_rtt' }
    : kind === 'ble' ? { beacon_uuid: `b-${id}`, beacon_major: 1, beacon_minor: 1, latitude: m.lat, longitude: m.lon, rssi_dbm: -62, distance_m: 4, tx_power_dbm: -59, accuracy_m: acc, source_type: 'ble' }
    : { cell_id: `c-${id}`, latitude: m.lat, longitude: m.lon, accuracy_m: acc, rssi_dbm: -85 };
  return { sourceId: `${kind}-${id}`, sourceType: kind, data, timestamp: Date.now() };
}

/** Index of the segment start whose segment passes closest to p (the path continues from the next vertex). */
function nearestSegment(path: LatLon[], p: LatLon): number {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    for (let k = 0; k <= 10; k++) {
      const q = { lat: path[i].lat + (path[i + 1].lat - path[i].lat) * (k / 10), lon: path[i].lon + (path[i + 1].lon - path[i].lon) * (k / 10) };
      const d = distanceM(p, q);
      if (d < bestD) { bestD = d; best = i; }
    }
  }
  return best;
}

/** Fraction (0–1) along the path of the sampled point nearest to p. */
function progressOn(path: LatLon[], p: LatLon): number {
  let best = 0, bestD = Infinity;
  for (let i = 0; i <= 200; i++) { const d = distanceM(p, alongPolyline(path, i / 200)); if (d < bestD) { bestD = d; best = i; } }
  return +(best / 200).toFixed(3);
}

interface Track {
  meta: UnitMeta; fusion: FusionOrchestrator; truth: LatLon; alt: number;
  hist: Array<{ p: LatLon; t: number }>; speed: number; heading: number; accel: number;
  window: SourceKind[][]; last?: UnitTelemetry;
}

export class UnitTracker {
  private tracks = new Map<string, Track>();
  private alphaT = 0.18;
  private t0 = Date.now();
  private alphaRoute: { key: string; path: LatLon[] } | null = null;

  constructor(private risk: RiskModel, private routeFor: () => { key: string; path: LatLon[] } | undefined, units: UnitMeta[]) {
    const start: Record<string, [number, number, number]> = { alpha: [-85, 75, 1210], drone: [-70, 60, 1650], bravo: [-40, -30, 1215], charlie: [35, 45, 1205] };
    for (const meta of units) {
      const s = start[meta.id] ?? [0, 0, 1200];
      this.tracks.set(meta.id, {
        meta, fusion: new FusionOrchestrator({ enuReference: { reference_latitude: ORIGIN.lat, reference_longitude: ORIGIN.lon, reference_altitude_m: 1200 }, updateRateHz: 5 }),
        truth: toLatLon([s[0], s[1]]), alt: s[2], hist: [], speed: 0, heading: 0, accel: 0, window: [],
      });
    }
  }

  meta(): UnitMeta[] { return [...this.tracks.values()].map((t) => t.meta); }
  latest(): UnitTelemetry[] { return [...this.tracks.values()].flatMap((t) => (t.last ? [t.last] : [])); }
  get(id: string): UnitTelemetry | undefined { return this.tracks.get(id)?.last; }

  /** Advance ground truth by dt seconds, fuse fresh sensor readings and return the new telemetry. */
  async tick(dt: number): Promise<UnitTelemetry[]> {
    const now = Date.now();
    const route = this.routeFor();
    const alpha = this.tracks.get('alpha');
    if (alpha && route) {
      if (!this.alphaRoute) this.alphaRoute = { key: route.key, path: route.path };
      else if (this.alphaRoute.key !== route.key) {
        // Re-route: drive from the current position to the nearest point of the new route, then follow it.
        this.alphaRoute = { key: route.key, path: [alpha.truth, ...route.path.slice(nearestSegment(route.path, alpha.truth) + 1)] };
        this.alphaT = 0;
      }
      const path = this.alphaRoute.path;
      const kmh = 44 + 6 * Math.sin((now - this.t0) / 9000);
      this.alphaT += ((kmh / 3.6) * dt) / Math.max(1, polylineLengthM(path));
      if (this.alphaT >= 1) { this.alphaRoute = { key: route.key, path: route.path }; this.alphaT = 0; }
      alpha.truth = alongPolyline(path, this.alphaT);
    }
    const drone = this.tracks.get('drone');
    if (drone && alpha) {
      const a = ((now - this.t0) / 1000) * 0.04;
      drone.truth = { lat: alpha.truth.lat + (280 * Math.sin(a)) / 111_320, lon: alpha.truth.lon + (280 * Math.cos(a)) / (111_320 * Math.cos((alpha.truth.lat * Math.PI) / 180)) };
    }
    const charlie = this.tracks.get('charlie');
    if (charlie) charlie.truth = toLatLon([35 + 2.5 * Math.sin((now - this.t0) / 3300), 45]);

    const out: UnitTelemetry[] = [];
    for (const t of this.tracks.values()) {
      const readings = t.meta.sources.map((k) => measurement(k, t.meta.id, t.truth, t.alt));
      const fused = await t.fusion.processMeasurements(readings);
      const p = { lat: fused.position.lat, lon: fused.position.lon };
      // Speed/heading over a 2 s window; displacement inside the CEP is treated as noise (stationary).
      t.hist.push({ p, t: now });
      while (t.hist.length > 1 && now - t.hist[0].t > 2000) t.hist.shift();
      const cep = 2.45 * fused.accuracy.uncertainty_m;
      if (t.hist.length > 1) {
        const first = t.hist[0], dts = (now - first.t) / 1000, d = distanceM(first.p, p);
        const v = dts > 0.5 && d > cep ? d / dts : 0;
        const speed = t.speed * 0.85 + v * 0.15;
        t.accel = +(t.accel * 0.8 + Math.abs((speed - t.speed) / dt) * 0.2).toFixed(1);
        t.speed = speed;
        if (d > cep) t.heading = bearingDeg(first.p, p);
      }
      t.window.push(fused.sources.map((s) => s.split(':')[0] as SourceKind));
      if (t.window.length > 50) t.window.shift();
      const counts = new Map<SourceKind, number>();
      for (const w of t.window) for (const k of w) counts.set(k, (counts.get(k) ?? 0) + 1);
      const total = [...counts.values()].reduce((s, n) => s + n, 0) || 1;
      const kinds = [...counts.keys()];
      const r = this.risk.assess(p, 0, `unit:${t.meta.id}`);
      t.last = {
        id: t.meta.id, lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6), alt_m: Math.round(t.alt),
        speed_kmh: Math.round(t.speed * 3.6), heading_deg: Math.round(t.heading), accel_mps2: t.accel,
        cep95_m: +(2.45 * fused.accuracy.uncertainty_m).toFixed(1), confidence: +fused.confidence.toFixed(2), degraded: fused.isDegraded,
        mode: kinds.includes('gnss') ? (kinds.length > 1 ? 'تلفیق کامل' : 'GNSS') : 'Dead-reckoning',
        fusion: t.meta.sources.map((k) => ({ source: LABEL[k], share: Math.round(((counts.get(k) ?? 0) / total) * 100) })),
        risk_score: r.score, risk_level: r.level,
        ...(t.meta.id === 'alpha' && route ? { route: route.key, route_progress: progressOn(route.path, t.truth) } : {}),
      };
      out.push(t.last);
    }
    return out;
  }
}
