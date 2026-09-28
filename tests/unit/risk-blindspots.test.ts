/**
 * H3 risk grid and blind-spot detection on the Mazar-i-Sharif branch geography (synthetic streets when no OSM
 * extract is present — the same data the server runs on in this repository).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { cellArea, cellToLatLng, latLngToCell } from 'h3-js';
import { distanceM, offset, pointInRing, type LatLon } from '../../services/server/geo';
import { BRANCHES } from '../../services/server/geodata/branches';
import { loadBranchGeo } from '../../services/server/geodata/load';
import type { BranchGeo } from '../../services/server/geodata/types';
import { RoadGraph } from '../../services/server/routing/graph';
import { H3_RES, levelOf, RiskModel } from '../../services/server/domain/risk';
import { BlindSpotService, rssiAt, RSSI_THRESHOLD_DBM, watches, type BlindSpotGrowth, type BlindSpotZone } from '../../services/server/domain/blindspots';
import type { Device } from '../../services/server/domain/devices';
import { tri } from '../../services/server/i18n/types';

const MZR = BRANCHES.find((b) => b.id === 'MZR')!;
let geo: BranchGeo;
beforeAll(() => { geo = loadBranchGeo(MZR, '/nonexistent-osm-dir'); });

const incident = (p: LatLon, severity: 'medium' | 'high' | 'critical', radius_m = 500, confidence = 0.9) =>
  ({ type: 'armed_threat', severity, location: p, radius_m, confidence, evidence: ['test'], source: 'unit', human_validation_status: 'confirmed' as const });

describe('risk levels', () => {
  it('bands scores into low / medium / high / critical', () => {
    expect(levelOf(0)).toBe('low');
    expect(levelOf(0.099)).toBe('low');
    expect(levelOf(0.1)).toBe('medium');
    expect(levelOf(0.35)).toBe('high');
    expect(levelOf(0.6)).toBe('critical');
    expect(levelOf(1)).toBe('critical');
  });
});

describe('RiskModel — H3 grid', () => {
  it('covers the whole urban boundary with resolution-9 cells', () => {
    const risk = new RiskModel(geo);
    const cells = risk.grid();
    expect(cells.length).toBeGreaterThan(500);
    const ids = new Set(cells.map((c) => c.id));
    // Sample the bounding box: points inside the boundary and points inside a grid cell agree to within 3 %.
    const [w, s, e, n] = geo.bbox;
    let inBoundary = 0, inGrid = 0, both = 0;
    for (let i = 0; i < 120; i++) for (let j = 0; j < 120; j++) {
      const p = { lat: s + ((n - s) * (i + 0.5)) / 120, lon: w + ((e - w) * (j + 0.5)) / 120 };
      const b = pointInRing(p, geo.boundary), g = ids.has(latLngToCell(p.lat, p.lon, H3_RES));
      if (b) inBoundary++; if (g) inGrid++; if (b && g) both++;
    }
    expect(both / inBoundary).toBeGreaterThan(0.97);
    expect(Math.abs(inGrid - inBoundary) / inBoundary).toBeLessThan(0.03);
    // Exact cell areas add up to the boundary area (bbox area × inside fraction).
    const bboxKm2 = (distanceM({ lat: (s + n) / 2, lon: w }, { lat: (s + n) / 2, lon: e }) * distanceM({ lat: s, lon: w }, { lat: n, lon: w })) / 1e6;
    const gridKm2 = cells.reduce((sum, c) => sum + cellArea(c.id, 'km2'), 0);
    expect(Math.abs(gridKm2 - (bboxKm2 * inBoundary) / 14_400) / gridKm2).toBeLessThan(0.03);
    for (const c of cells.slice(0, 50)) expect(latLngToCell(c.lat, c.lon, H3_RES)).toBe(c.id);
  });

  it('is low everywhere without incidents and rises around an incident, decaying with distance', () => {
    const risk = new RiskModel(geo);
    expect(risk.grid().every((c) => c.level === 'low')).toBe(true);
    const v0 = risk.version;
    const at = MZR.center;
    risk.add(incident(at, 'critical', 600));
    risk.add(incident(offset(at, 80, 60), 'high', 400));
    expect(risk.version).toBeGreaterThan(v0);
    const s0 = risk.scoreAt(at), s2 = risk.scoreAt(offset(at, 3000, 0));
    expect(s0).toBeGreaterThanOrEqual(0.35);
    expect(s0).toBeGreaterThan(s2);
    expect(levelOf(s2)).toBe('low');
    // The incident (threat) component decays with distance; the small context term (distance from police and
    // hospitals, coverage gaps) can rise away from the centre, so it is checked separately.
    const threat = (east: number) => risk.cellAt(offset(at, east, 0))!.factors.threat;
    expect(threat(0)).toBeGreaterThan(threat(700));
    expect(threat(700)).toBeGreaterThanOrEqual(threat(3000));
    const cell = risk.cellAt(at)!;
    expect(cell.factors.incidents.length).toBeGreaterThan(0);
    expect(cell.factors.threat).toBeGreaterThan(0);
  });

  it('drops rejected and removed incidents', () => {
    const risk = new RiskModel(geo);
    risk.add({ ...incident(MZR.center, 'critical'), human_validation_status: 'rejected' });
    expect(risk.list()).toHaveLength(0);
    risk.add(incident(MZR.center, 'critical'));
    expect(risk.list()).toHaveLength(1);
    // remove() purges stored incidents, including the rejected one that list() already hides.
    expect(risk.remove(() => true)).toBe(2);
    expect(risk.scoreAt(MZR.center)).toBeLessThan(0.1);
  });

  it('coverage gaps and distance from support raise context risk only slightly', () => {
    const risk = new RiskModel(geo);
    const c = risk.grid()[0];
    const before = c.score;
    risk.setCoverageGaps([c.id]);
    const after = risk.grid()[0];
    expect(after.factors.coverage_gap).toBe(true);
    expect(after.score).toBeGreaterThan(before);
    expect(after.level).toBe('low');
    expect(Math.max(...risk.grid().map((x) => x.factors.context))).toBeLessThanOrEqual(0.065);
  });

  it('ranks the 10 most dangerous and 10 safest sites, spaced ≥ 700 m apart', () => {
    const risk = new RiskModel(geo);
    // A corroborated cluster (one report alone stays "medium" by design) and a lone report elsewhere.
    risk.add(incident(MZR.center, 'critical', 600));
    risk.add(incident(offset(MZR.center, 100, 80), 'high', 420));
    risk.add(incident(offset(MZR.center, -120, -40), 'high', 450));
    risk.add(incident(offset(MZR.center, 2500, 1200), 'high', 500));
    const { dangerous, safest } = risk.extremes(geo.pois, 10, 700);
    expect(dangerous).toHaveLength(10);
    expect(safest).toHaveLength(10);
    for (const list of [dangerous, safest]) {
      list.forEach((a, i) => { expect(a.rank).toBe(i + 1); list.slice(i + 1).forEach((b) => expect(distanceM(a, b)).toBeGreaterThanOrEqual(700)); });
    }
    for (let i = 1; i < 10; i++) expect(dangerous[i].score).toBeLessThanOrEqual(dangerous[i - 1].score);
    for (let i = 1; i < 10; i++) expect(safest[i].score).toBeGreaterThanOrEqual(safest[i - 1].score);
    expect(distanceM(dangerous[0], MZR.center)).toBeLessThan(400);
    expect(dangerous[0].level).toMatch(/high|critical/);
    expect(safest[0].score).toBeLessThan(dangerous[9].score);
    expect(safest.every((s) => !risk.isRestricted(s.cell))).toBe(true);
    expect(dangerous[0].nearest?.name.dr).toBeTruthy();
  });
});

describe('blind-spot models', () => {
  it('radio link budget falls with distance and crosses the threshold at a finite range', () => {
    expect(rssiAt(30, 6, 100)).toBeGreaterThan(rssiAt(30, 6, 1000));
    expect(rssiAt(30, 6, 1)).toBeGreaterThan(RSSI_THRESHOLD_DBM);
    let d = 1;
    while (rssiAt(30, 6, d) >= RSSI_THRESHOLD_DBM) d *= 1.1;
    expect(d).toBeGreaterThan(1000);
    expect(d).toBeLessThan(50_000);
  });

  it('camera sectors respect range, heading and field of view; drones their footprint', () => {
    const c = MZR.center;
    const cam = { id: 'CAM', geo: c, coverage: { kind: 'camera', heading_deg: 90, fov_deg: 60, range_m: 300 } } as unknown as Device;
    expect(watches(cam, offset(c, 200, 0))).toBe(true); // due east, in range
    expect(watches(cam, offset(c, 200, 100))).toBe(true); // 63° bearing, inside ±30°
    expect(watches(cam, offset(c, 100, 200))).toBe(false); // 27° bearing, outside
    expect(watches(cam, offset(c, 400, 0))).toBe(false); // beyond range
    expect(watches(cam, offset(c, -200, 0))).toBe(false); // behind
    expect(watches(cam, offset(c, -5, 5))).toBe(true); // at the mast
    const drone = { id: 'D', geo: c, coverage: { kind: 'drone', footprint_m: 250 } } as unknown as Device;
    expect(watches(drone, offset(c, 0, 240))).toBe(true);
    expect(watches(drone, offset(c, 0, 260))).toBe(false);
  });
});

describe('BlindSpotService', () => {
  const relay = (id: string, p: LatLon, state: Device['state'] = 'on', tx = 20): Device => ({
    id, name: tri(id, id, id), type: 'relay', protocol: 'test', detail: { key: 'dev.detail.relay' } as never, state, battery_pct: null, firmware: '1', signal_dbm: null,
    last_seen: Date.now(), geo: p, coverage: { kind: 'radio', tx_dbm: tx, gain_db: 6 }, history: [],
  });
  const setup = (devices: Device[], corridors: Array<{ plan: string; route: string; path: LatLon[] }> = []) => {
    const risk = new RiskModel(geo);
    const graph = new RoadGraph(geo.roads);
    const svc = new BlindSpotService(geo, risk, graph, () => devices, () => corridors, () => []);
    return { risk, svc };
  };
  const networkCells = (zones: BlindSpotZone[]) => new Set(zones.filter((z) => z.type === 'network').flatMap((z) => z.cells));

  it('flags everything as no-network without relays, and nothing near a strong relay', () => {
    const { risk, svc } = setup([]);
    const none = networkCells(svc.recompute());
    expect(none.size).toBe(risk.cellIds().length);
    const { svc: svc2 } = setup([relay('R1', MZR.center, 'on', 40)]);
    const cells = networkCells(svc2.recompute());
    expect(cells.has(latLngToCell(MZR.center.lat, MZR.center.lon, H3_RES))).toBe(false);
  });

  it('builds contiguous zones with a report in three languages', () => {
    const devices = [relay('R1', offset(MZR.center, -2500, 0)), relay('R2', offset(MZR.center, 2500, 0))];
    const { risk, svc } = setup(devices, [{ plan: 'ESC-1', route: 'P', path: [offset(MZR.center, -6000, 0), offset(MZR.center, 6000, 0)] }]);
    const zones = svc.recompute();
    expect(zones.length).toBeGreaterThan(0);
    for (const z of zones) {
      expect(z.id).toMatch(/^BS-[NMA][0-9A-Z]{1,4}$/);
      expect(z.cell_count).toBe(z.cells.length);
      expect(z.area_km2).toBeCloseTo(z.cells.reduce((sum, c) => sum + cellArea(c, 'km2'), 0), 1);
      for (const k of ['dr', 'ps', 'en'] as const) { expect(z.detail[k]).toBeTruthy(); expect(z.mitigation[k]).toBeTruthy(); expect(z.label[k]).toBeTruthy(); }
      // Connected through H3 adjacency.
      const set = new Set(z.cells), seen = new Set([z.cells[0]]), stack = [z.cells[0]];
      while (stack.length) for (const nb of risk.neighbours(stack.pop()!)) if (set.has(nb) && !seen.has(nb)) { seen.add(nb); stack.push(nb); }
      expect(seen.size).toBe(z.cells.length);
    }
    // The corridor has no cameras at all, so it is reported as unmonitored and crossing the route.
    const mon = zones.filter((z) => z.type === 'monitoring');
    expect(mon.length).toBeGreaterThan(0);
    expect(mon.some((z) => z.routes.some((r) => r.plan === 'ESC-1' && r.length_m > 0))).toBe(true);
  });

  it('detects a new network blind spot when a relay goes offline and feeds the gap into the risk grid', () => {
    // Three relays spaced across the city; the middle one leaves an isolated hole when it goes offline.
    const devices = [relay('R1', offset(MZR.center, -3000, 0), 'on', 34), relay('R2', offset(MZR.center, 3000, 0), 'on', 34), relay('R3', MZR.center, 'on', 26)];
    const { risk, svc } = setup(devices);
    let fresh: BlindSpotZone[] = [], grown: BlindSpotGrowth[] = [];
    svc.on('changed', (_z: BlindSpotZone[], f: BlindSpotZone[], g: BlindSpotGrowth[]) => { fresh = f; grown = g; });
    const before = networkCells(svc.recompute());
    const rev = svc.revision;
    devices[2].state = 'off';
    const after = networkCells(svc.recompute());
    expect(after.size).toBeGreaterThan(before.size);
    const centre = latLngToCell(MZR.center.lat, MZR.center.lon, H3_RES);
    expect(before.has(centre)).toBe(false);
    expect(after.has(centre)).toBe(true);
    expect(svc.revision).toBeGreaterThan(rev);
    const reported = [...fresh, ...grown.map((g) => g.zone)];
    expect(reported.some((z) => z.type === 'network' && z.cells.includes(centre))).toBe(true);
    expect(risk.cellAt(MZR.center)!.factors.coverage_gap).toBe(true);
    // Back online: the gap closes again and nothing is reported as new.
    devices[2].state = 'on';
    expect(networkCells(svc.recompute()).has(centre)).toBe(false);
    expect(fresh).toHaveLength(0);
    expect(grown).toHaveLength(0);
  });

  it('reports an existing zone that grows when a nearby relay fails', () => {
    // Weak relays: most of the city is already a single no-network zone; losing R3 enlarges it.
    const devices = [relay('R1', offset(MZR.center, -2500, 0)), relay('R2', offset(MZR.center, 2500, 0)), relay('R3', MZR.center)];
    const { svc } = setup(devices);
    let fresh: BlindSpotZone[] = [], grown: BlindSpotGrowth[] = [];
    svc.on('changed', (_z: BlindSpotZone[], f: BlindSpotZone[], g: BlindSpotGrowth[]) => { fresh = f; grown = g; });
    const before = svc.recompute().filter((z) => z.type === 'network');
    devices[2].state = 'off';
    const after = svc.recompute().filter((z) => z.type === 'network');
    expect(after.reduce((n, z) => n + z.cell_count, 0)).toBeGreaterThan(before.reduce((n, z) => n + z.cell_count, 0));
    expect(fresh.filter((z) => z.type === 'network')).toHaveLength(0);
    const g = grown.find((x) => x.zone.type === 'network')!;
    expect(g).toBeDefined();
    expect(g.added_cells).toBeGreaterThanOrEqual(5);
    expect(g.added_km2).toBeGreaterThan(0.4);
    // A recompute without changes reports nothing.
    svc.recompute();
    expect(grown).toHaveLength(0);
  });

  it('marks restricted areas as limited access', () => {
    const { svc } = setup([relay('R1', MZR.center, 'on', 60)]);
    const access = svc.recompute().filter((z) => z.type === 'access');
    for (const zone of geo.restricted) {
      const [lat, lon] = cellToLatLng(latLngToCell(zone.ring[0][1], zone.ring[0][0], H3_RES));
      const inside = geo.restricted.length ? access.some((z) => z.cells.some((c) => { const [a, b] = cellToLatLng(c); return pointInRing({ lat: a, lon: b }, zone.ring); })) : true;
      expect(inside, `restricted zone ${zone.id} near ${lat},${lon}`).toBe(true);
    }
  });
});
