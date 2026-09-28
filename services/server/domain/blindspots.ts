/**
 * Blind-spot analysis on the risk grid.
 *  - network:    no online relay reaches the cell (log-distance path loss, RSSI below threshold)
 *  - monitoring: a cell that must be watched (on an active escort corridor, around a protected site, or under
 *                high incident threat) is outside every online camera sector and drone footprint
 *  - access:     the cell is inside a restricted area or has no drivable road within reach
 * Gap cells of one type are grouped into zones (H3 adjacency) and each zone gets a report.
 */
import { EventEmitter } from 'events';
import { cellArea, cellsToMultiPolygon, latLngToCell } from 'h3-js';
import { bearingDeg, distanceM, pointInRing, type LatLon } from '../geo';
import type { BranchGeo, Poi } from '../geodata/types';
import { L, lengthText, type MsgKey } from '../i18n/messages';
import type { Tri } from '../i18n/types';
import type { RoadGraph } from '../routing/graph';
import type { Device } from './devices';
import { H3_RES, type RiskModel } from './risk';

export type BlindType = 'network' | 'monitoring' | 'access';
export const RSSI_THRESHOLD_DBM = -95;
const PL0_DB = 32, PATH_LOSS_EXP = 3.0;
export const rssiAt = (txDbm: number, gainDb: number, distM: number) => txDbm + gainDb - (PL0_DB + 10 * PATH_LOSS_EXP * Math.log10(Math.max(1, distM)));

export interface Corridor { plan: string; route: string; path: LatLon[] }
export interface BlindSpotZone {
  id: string; type: BlindType; label: Tri; cells: string[]; cell_count: number; area_km2: number; centroid: LatLon;
  polygon: number[][][][]; max_risk: number; avg_risk: number;
  routes: Array<{ plan: string; route: string; length_m: number }>;
  nearest_support: { id: string; name: Tri; distance_m: number } | null;
  detail: Tri; mitigation: Tri; first_seen: number;
}

const ACCESS_ROAD_M = 250;
const PROTECTED_RADIUS_M = 400;
/** An existing zone that gains at least this many newly blind cells (≈ 0.5 km²) is reported as grown. */
const GROWTH_MIN_CELLS = 5;
/** Cells blind within this window are not "new" again (drone patrols, flapping links). */
const RECENT_MS = 15 * 60_000;

/** A zone that already existed but grew (e.g. a relay went offline next to an existing gap). */
export interface BlindSpotGrowth { zone: BlindSpotZone; added_cells: number; added_km2: number }
const areaKm2 = (cells: string[]) => +cells.reduce((s, c) => s + cellArea(c, 'km2'), 0).toFixed(2);

export class BlindSpotService extends EventEmitter {
  private zonesCache: BlindSpotZone[] = [];
  private firstSeen = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private roadDist = new Map<string, number>();
  /** Bumped whenever the set of zones changes (route analyses cache on it). */
  revision = 0;
  /** Last time each cell was blind, per type (see RECENT_MS). */
  private recentBlind: Record<BlindType, Map<string, number>> = { network: new Map(), monitoring: new Map(), access: new Map() };

  constructor(
    private geo: BranchGeo, private risk: RiskModel, private graph: RoadGraph,
    private devices: () => Device[], private corridors: () => Corridor[], private protectedSites: () => LatLon[],
    private now: () => number = Date.now,
  ) {
    super();
    for (const id of risk.cellIds()) this.roadDist.set(id, graph.nearest(risk.cellCenter(id)!).distM);
  }

  zones(): BlindSpotZone[] { return this.zonesCache; }

  /** Recompute after a short debounce (device/plan/risk changes arrive in bursts). */
  schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.recompute(); }, 300);
  }

  stop(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; }

  recompute(): BlindSpotZone[] {
    const devs = this.devices().filter((d) => d.geo && d.coverage);
    const radios = devs.filter((d) => d.coverage!.kind === 'radio' && d.state !== 'off');
    const cams = devs.filter((d) => (d.coverage!.kind === 'camera' && d.state !== 'off') || (d.coverage!.kind === 'drone' && d.state === 'on'));
    const grid = this.risk.grid();

    const required = new Set<string>();
    for (const c of this.corridors()) {
      for (let i = 0; i < c.path.length - 1; i++) {
        const n = Math.max(1, Math.ceil(distanceM(c.path[i], c.path[i + 1]) / 60));
        for (let k = 0; k <= n; k++) {
          const a = c.path[i], b = c.path[i + 1];
          required.add(latLngToCell(a.lat + ((b.lat - a.lat) * k) / n, a.lon + ((b.lon - a.lon) * k) / n, H3_RES));
        }
      }
    }
    const sites = this.protectedSites();

    const byType: Record<BlindType, Set<string>> = { network: new Set(), monitoring: new Set(), access: new Set() };
    for (const cell of grid) {
      const p = { lat: cell.lat, lon: cell.lon };
      const best = radios.reduce((m, d) => { const c = d.coverage as { tx_dbm: number; gain_db: number }; return Math.max(m, rssiAt(c.tx_dbm, c.gain_db, distanceM(p, d.geo!))); }, -Infinity);
      if (best < RSSI_THRESHOLD_DBM) byType.network.add(cell.id);
      const mustWatch = required.has(cell.id) || cell.factors.threat >= 0.35 || sites.some((s) => distanceM(p, s) <= PROTECTED_RADIUS_M);
      if (mustWatch && !cams.some((d) => watches(d, p))) byType.monitoring.add(cell.id);
      if (cell.restricted || (this.roadDist.get(cell.id) ?? 0) > ACCESS_ROAD_M) byType.access.add(cell.id);
    }

    const scoreOf = new Map(grid.map((c) => [c.id, c.score]));
    const support = this.geo.pois.filter((p) => p.kind === 'police' || p.kind === 'hospital' || p.kind === 'hq');
    const now = this.now();
    const zones: BlindSpotZone[] = [];
    for (const type of ['network', 'monitoring', 'access'] as BlindType[]) {
      const comps = this.components(byType[type]);
      const ids = this.assignIds(type, comps);
      for (const [ci, cells] of comps.entries()) {
        const centroid = { lat: cells.reduce((s, c) => s + this.risk.cellCenter(c)!.lat, 0) / cells.length, lon: cells.reduce((s, c) => s + this.risk.cellCenter(c)!.lon, 0) / cells.length };
        const scores = cells.map((c) => scoreOf.get(c) ?? 0);
        const id = ids[ci];
        const near = nearest(support, centroid);
        zones.push({
          id, type, label: L(`bs.type.${type}` as MsgKey), cells, cell_count: cells.length, area_km2: areaKm2(cells),
          centroid: { lat: +centroid.lat.toFixed(6), lon: +centroid.lon.toFixed(6) }, polygon: cellsToMultiPolygon(cells, true),
          max_risk: Math.max(...scores), avg_risk: +(scores.reduce((s, x) => s + x, 0) / scores.length).toFixed(3),
          routes: this.crossings(new Set(cells)),
          nearest_support: near ? { id: near.p.id, name: near.p.name, distance_m: Math.round(near.d) } : null,
          detail: this.detail(type, cells, centroid, radios, cams),
          mitigation: L(`bs.mit.${type}` as MsgKey, { near: near ? near.p.name : '—' }),
          first_seen: this.firstSeen.get(id) ?? now,
        });
      }
    }
    zones.sort((a, b) => b.avg_risk - a.avg_risk || b.cell_count - a.cell_count);

    const previous = this.zonesCache;
    // New / grown zones are judged against every cell that was blind in the last 15 minutes, not just the last
    // pass: a patrolling drone uncovers and re-covers the same ground constantly and must not raise alerts.
    const known = (type: BlindType, c: string) => { const t = this.recentBlind[type].get(c); return t !== undefined && now - t <= RECENT_MS; };
    const fresh: BlindSpotZone[] = [];
    const grown: BlindSpotGrowth[] = [];
    if (this.revision > 0) {
      for (const z of zones) {
        const added = z.cells.filter((c) => !known(z.type, c));
        if (added.length / z.cells.length > 0.7) fresh.push(z);
        else if (added.length >= GROWTH_MIN_CELLS) grown.push({ zone: z, added_cells: added.length, added_km2: areaKm2(added) });
      }
    }
    for (const z of zones) for (const c of z.cells) this.recentBlind[z.type].set(c, now);
    for (const m of Object.values(this.recentBlind)) if (m.size > 20_000) for (const [c, t] of m) if (now - t > RECENT_MS) m.delete(c);
    const sig = (zs: BlindSpotZone[]) => zs.map((z) => `${z.id}:${z.cell_count}`).join(',');
    if (this.revision === 0 || sig(previous) !== sig(zones)) this.revision++;
    for (const z of zones) if (!this.firstSeen.has(z.id)) this.firstSeen.set(z.id, z.first_seen);
    this.zonesCache = zones;
    this.risk.setCoverageGaps([...byType.network, ...byType.monitoring]);
    this.emit('changed', zones, fresh, grown);
    return zones;
  }

  /**
   * Stable zone identity: a zone keeps the id of the previous zone of the same type it shares most cells with
   * (moving drones and relay changes reshape zones every few seconds); genuinely new zones get an id derived
   * from their lowest cell.
   */
  private assignIds(type: BlindType, comps: string[][]): string[] {
    const prev = this.zonesCache.filter((z) => z.type === type).map((z) => ({ id: z.id, cells: new Set(z.cells) }));
    const pairs: Array<{ i: number; id: string; shared: number }> = [];
    comps.forEach((cells, i) => {
      for (const p of prev) {
        const shared = cells.reduce((n, c) => n + (p.cells.has(c) ? 1 : 0), 0);
        if (shared > 0 && shared >= 0.3 * Math.min(cells.length, p.cells.size)) pairs.push({ i, id: p.id, shared });
      }
    });
    pairs.sort((a, b) => b.shared - a.shared || a.id.localeCompare(b.id));
    const out: string[] = new Array(comps.length);
    const used = new Set<string>();
    for (const p of pairs) if (out[p.i] === undefined && !used.has(p.id)) { out[p.i] = p.id; used.add(p.id); }
    comps.forEach((cells, i) => {
      if (out[i] !== undefined) return;
      const base = `BS-${type[0].toUpperCase()}${parseInt(cells[0].slice(3, 11), 16).toString(36).slice(-4).toUpperCase()}`;
      let id = base;
      for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
      out[i] = id; used.add(id);
    });
    return out;
  }

  private components(cells: Set<string>): string[][] {
    const seen = new Set<string>(), out: string[][] = [];
    for (const start of cells) {
      if (seen.has(start)) continue;
      const comp: string[] = [], stack = [start];
      seen.add(start);
      while (stack.length) {
        const c = stack.pop()!;
        comp.push(c);
        for (const n of this.risk.neighbours(c)) if (cells.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
      }
      out.push(comp.sort());
    }
    return out;
  }

  private crossings(cells: Set<string>): BlindSpotZone['routes'] {
    const out: BlindSpotZone['routes'] = [];
    for (const c of this.corridors()) {
      let len = 0;
      for (let i = 0; i < c.path.length - 1; i++) {
        const d = distanceM(c.path[i], c.path[i + 1]), n = Math.max(1, Math.ceil(d / 25));
        for (let k = 0; k < n; k++) {
          const a = c.path[i], b = c.path[i + 1], f = (k + 0.5) / n;
          if (cells.has(latLngToCell(a.lat + (b.lat - a.lat) * f, a.lon + (b.lon - a.lon) * f, H3_RES))) len += d / n;
        }
      }
      if (len > 0) out.push({ plan: c.plan, route: c.route, length_m: Math.round(len) });
    }
    return out;
  }

  private detail(type: BlindType, cells: string[], centroid: LatLon, radios: Device[], cams: Device[]): Tri {
    if (type === 'network') {
      const best = radios.reduce<{ d: Device; rssi: number; dist: number } | null>((m, d) => {
        const c = d.coverage as { tx_dbm: number; gain_db: number }, dist = distanceM(centroid, d.geo!), rssi = rssiAt(c.tx_dbm, c.gain_db, dist);
        return !m || rssi > m.rssi ? { d, rssi, dist } : m;
      }, null);
      return best ? L('bs.detail.network', { rssi: Math.round(best.rssi), relay: best.d.id, dist: lengthText(best.dist) }) : L('bs.detail.network', { rssi: '—', relay: '—', dist: '—' });
    }
    if (type === 'monitoring') {
      const near = cams.reduce<{ d: Device; dist: number } | null>((m, d) => { const dist = distanceM(centroid, d.geo!); return !m || dist < m.dist ? { d, dist } : m; }, null);
      return near ? L('bs.detail.monitoring', { camera: near.d.id, dist: lengthText(near.dist) }) : L('bs.detail.monitoring', { camera: '—', dist: '—' });
    }
    const zone = this.geo.restricted.find((z) => cells.some((c) => pointInRing(this.risk.cellCenter(c)!, z.ring)));
    if (zone) return L('bs.detail.restricted', { zone: zone.name });
    return L('bs.detail.noRoad', { dist: lengthText(Math.max(...cells.map((c) => this.roadDist.get(c) ?? 0))) });
  }
}

export function watches(d: Device, p: LatLon): boolean {
  const cov = d.coverage!;
  const dist = distanceM(d.geo!, p);
  if (cov.kind === 'drone') return dist <= cov.footprint_m;
  if (cov.kind !== 'camera') return false;
  if (dist > cov.range_m) return false;
  if (dist < 15) return true;
  const diff = Math.abs(((bearingDeg(d.geo!, p) - cov.heading_deg + 540) % 360) - 180);
  return diff <= cov.fov_deg / 2;
}

function nearest(pois: Poi[], p: LatLon): { p: Poi; d: number } | null {
  return pois.reduce<{ p: Poi; d: number } | null>((best, x) => { const d = distanceM(p, x); return !best || d < best.d ? { p: x, d } : best; }, null);
}
