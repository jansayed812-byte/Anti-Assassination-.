/**
 * Everything one branch owns: its geography and road graph, risk grid, escort plans and routing, units, devices,
 * detections, alerts, blind-spot analysis, simulation runner and realtime bus. Branch data never mixes; what
 * crosses branches goes through the SyncHub (see sync.ts).
 */
import { latLngToCell } from 'h3-js';
import type { ScenarioAnchor, ScenarioDef } from '../simulation/scenario-types';
import { alongPolyline, bearingDeg, distanceM, offset, type LatLon } from './geo';
import type { BranchDef } from './geodata/branches';
import { loadBranchGeo } from './geodata/load';
import type { BranchGeo, Poi } from './geodata/types';
import { L } from './i18n/messages';
import { RealtimeBus } from './realtime';
import { RoadGraph } from './routing/graph';
import { RoutePlanner, type BlindCells } from './routing/planner';
import { AlertService } from './domain/alerts';
import { BlindSpotService, type BlindSpotGrowth, type BlindSpotZone } from './domain/blindspots';
import { DetectionService } from './domain/detections';
import { DeviceRegistry } from './domain/devices';
import { PlanService } from './domain/plans';
import { H3_RES, RiskModel } from './domain/risk';
import { SimService } from './domain/sim';
import { UnitTracker } from './domain/units';
import { baselinePath, keySites, seedAlerts, seedDetections, seedDevices, seedIncidents, seedPlans, seedUnits, type KeySites } from './seed';

export interface BranchContext {
  id: string; def: BranchDef; geo: BranchGeo; sites: KeySites; graph: RoadGraph; risk: RiskModel; planner: RoutePlanner;
  plans: PlanService; units: UnitTracker; devices: DeviceRegistry; detections: DetectionService; alerts: AlertService;
  blind: BlindSpotService; sim: SimService; bus: RealtimeBus;
  anchor: (a: ScenarioAnchor) => LatLon;
  resources: () => Array<Poi & { icon: string }>;
  telemetryTicks: number;
  tick: (dt: number) => Promise<void>;
  stop: () => void;
}

const RESOURCE_ICON: Partial<Record<Poi['kind'], string>> = { safe_house: 'house-line', hospital: 'first-aid', clinic: 'first-aid', police: 'shield', fuel: 'gas-pump', hq: 'flag', airport: 'airplane' };
const cellOf = (p: LatLon) => latLngToCell(p.lat, p.lon, H3_RES);

export function createBranchContext(def: BranchDef, opts: { dataDir: string; scenarios: ScenarioDef[] }): BranchContext {
  const geo = loadBranchGeo(def, opts.dataDir);
  const sites = keySites(geo);
  const graph = new RoadGraph(geo.roads);
  const risk = new RiskModel(geo);
  const bus = new RealtimeBus(10_000, def.id);
  const alerts = new AlertService(Date.now, def.id);

  // Exercise incidents sit along the naive shortest route so the risk-aware planner visibly routes around them.
  const naive = baselinePath(graph, sites.hq, sites.destination);
  seedIncidents(risk, naive);

  let blind: BlindSpotService | null = null;
  const blindCells = (): BlindCells => {
    const zones = blind?.zones() ?? [];
    const network = new Set<string>(), monitoring = new Set<string>(), byCell = new Map<string, BlindSpotZone>();
    for (const z of zones) for (const c of z.cells) {
      if (z.type === 'network') network.add(c);
      if (z.type === 'monitoring') monitoring.add(c);
      if (!byCell.has(c) || byCell.get(c)!.type === 'access') byCell.set(c, z);
    }
    return { network, monitoring, zoneOf: (c) => { const z = byCell.get(c); return z && { id: z.id, type: z.type, label: z.label }; } };
  };
  const planner = new RoutePlanner(graph, risk, geo, blindCells, cellOf);
  const plans = new PlanService(planner, () => `${risk.version}|${blind?.revision ?? 0}`, seedPlans(def, sites));

  const running = () => { const p = plans.running(); const r = p?.pace.find((x) => x.k === p.active_route); return p && r ? { key: r.k, path: r.path } : undefined; };
  const units = new UnitTracker(risk, running, seedUnits(def, sites, geo), { ...def.center, alt_m: def.elevationM });
  const primary = plans.get('ESC-0412')?.pace.find((r) => r.k === 'P')?.path ?? naive;
  const devices = new DeviceRegistry(seedDevices(def, sites, primary));
  const detections = new DetectionService(risk, seedDetections(naive, def.center));
  for (const a of seedAlerts(risk.cellIds().length)) alerts.create({ ...a, source: 'system' });

  const protectedSites = (): LatLon[] => {
    const run = plans.running();
    return [sites.hq, ...sites.safeHouses, ...(run ? [run.destination] : [])];
  };
  blind = new BlindSpotService(geo, risk, graph, () => devices.raw(), () => plans.corridors(), protectedSites);

  const anchor = (a: ScenarioAnchor): LatLon => {
    let p: LatLon = def.center;
    let heading = 0;
    if (a.route) {
      const plan = plans.running() ?? plans.list()[0];
      const r = plan?.pace.find((x) => x.k === a.route) ?? plan?.pace[0];
      if (r && r.path.length > 1) {
        const f = Math.max(0, Math.min(1, a.frac ?? 0.5));
        p = alongPolyline(r.path, f);
        heading = bearingDeg(alongPolyline(r.path, Math.max(0, f - 0.01)), alongPolyline(r.path, Math.min(1, f + 0.01)));
      }
    } else if (a.unit) {
      const u = units.get(a.unit);
      p = u ?? units.meta().find((m) => m.id === a.unit)?.start ?? p;
    } else if (a.poi) {
      p = geo.pois.find((x) => x.id === a.poi || x.id.endsWith(`-${a.poi}`)) ?? geo.pois.find((x) => x.kind === a.poi) ?? p;
    } else if (a.restricted && geo.restricted[0]) {
      const ring = geo.restricted[0].ring;
      p = { lat: ring.reduce((s, c) => s + c[1], 0) / ring.length, lon: ring.reduce((s, c) => s + c[0], 0) / ring.length };
    }
    if (a.side_m) { const r = ((heading + 90) * Math.PI) / 180; p = offset(p, a.side_m * Math.sin(r), a.side_m * Math.cos(r)); }
    if (a.east_m || a.north_m) p = offset(p, a.east_m ?? 0, a.north_m ?? 0);
    return p;
  };
  const sim = new SimService(opts.scenarios, anchor, def.id);

  const ctx: BranchContext = {
    id: def.id, def, geo, sites, graph, risk, planner, plans, units, devices, detections, alerts, blind, sim, bus, anchor,
    resources: () => geo.pois.filter((p) => RESOURCE_ICON[p.kind]).map((p) => ({ ...p, icon: RESOURCE_ICON[p.kind]! })),
    telemetryTicks: 0,
    tick: async (dt: number) => {
      const out = await units.tick(dt);
      const drone = out.find((u) => u.id === 'drone');
      if (drone) devices.moveTo('D-01', { lat: drone.lat, lon: drone.lon });
      devices.drainBattery('D-01', 0.0005);
      ctx.telemetryTicks++;
      bus.publish('telemetry', { units: out });
    },
    stop: () => { blind?.stop(); sim.reset(); },
  };

  // Realtime fan-out and cross-service reactions inside the branch.
  alerts.on('changed', (a) => bus.publish('alerts', a));
  plans.on('changed', (p) => { bus.publish('plans', p); blind?.schedule(); });
  devices.on('changed', (d, prev) => {
    bus.publish('devices', d);
    if (prev && prev.state !== 'off' && d.state === 'off') alerts.create({ level: 'error', title: L('alert.deviceOffline', { device: d.name }), src: d.id, source: 'system' });
    if (!prev || prev.state !== d.state || prev.geo !== d.geo) blind?.schedule();
  });
  detections.on('changed', (d) => bus.publish('risk', { detection: d }));
  risk.on('changed', (reason: 'incidents' | 'gaps') => { if (reason === 'incidents') blind?.schedule(); });
  blind.on('changed', (zones: BlindSpotZone[], fresh: BlindSpotZone[], grown: BlindSpotGrowth[]) => {
    bus.publish('blindspots', { zones: zones.map(({ cells: _cells, ...z }) => z), revision: blind!.revision });
    for (const z of fresh) {
      if (z.type === 'access') continue;
      alerts.create({
        level: z.routes.length ? 'error' : 'warning', source: 'blindspot',
        title: L('alert.blindSpot', { id: z.id, type: z.label }),
        src: L('alert.blindSpot.src', { area: z.area_km2, near: z.nearest_support?.name ?? '—' }),
      });
    }
    for (const { zone: z, added_km2 } of grown) {
      if (z.type === 'access') continue;
      alerts.create({
        level: z.routes.length ? 'error' : 'warning', source: 'blindspot',
        title: L('alert.blindSpot.grown', { id: z.id, type: z.label, area: added_km2 }),
        src: L('alert.blindSpot.src', { area: z.area_km2, near: z.nearest_support?.name ?? '—' }),
      });
    }
  });
  sim.on('event', (e, s) => {
    if (e.type === 'incident') {
      const i = e.data as { type: string; severity: 'low' | 'medium' | 'high' | 'critical'; lat: number; lon: number; radius_m: number; confidence: number; evidence?: string[] };
      risk.add({ type: i.type, severity: i.severity, location: { lat: i.lat, lon: i.lon }, radius_m: i.radius_m, confidence: i.confidence, evidence: i.evidence ?? [], source: `sim:${s.id}`, human_validation_status: 'pending', ttl_s: 3600 });
    } else if (e.type === 'alert') {
      const a = e.data as { severity: string; message: import('./i18n/types').LText };
      const level = ({ critical: 'critical', high: 'error', medium: 'warning', low: 'info' } as const)[a.severity as 'critical'] ?? 'info';
      alerts.create({ level, title: a.message, src: L('alert.sim.src', { name: sim.meta(sim.find(s.id)!).name }), source: 'simulation' });
    }
    if (e.type !== 'position' && e.type !== 'step_complete') bus.publish('sim', sim.status());
  });
  sim.on('reset', (s) => { risk.remove((i) => i.source === `sim:${s.id}`); bus.publish('sim', sim.status()); });

  blind.recompute();
  return ctx;
}

/** Nearest-first list of points of interest within `radiusM` of a point (used by area analysis). */
export function nearby<T extends LatLon>(items: T[], center: LatLon, radiusM: number): Array<T & { distance_m: number }> {
  return items.map((x) => ({ ...x, distance_m: Math.round(distanceM(center, x)) })).filter((x) => x.distance_m <= radiusM).sort((a, b) => a.distance_m - b.distance_m);
}
