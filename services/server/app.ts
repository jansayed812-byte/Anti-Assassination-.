/**
 * Operations console backend: REST API + Socket.IO envelope stream over the platform services, one isolated
 * BranchContext per branch (Mazar-i-Sharif HQ, Kabul, Herat) plus inter-branch sync and per-branch reports.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer, type Server } from 'http';
import { existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import type { Socket } from 'socket.io';
import { branchScope, getAuditLog, hasPermission, jwtAuth, requirePermission, setRateLimit, verifyJWT, type JWTClaims, type Role } from '../auth/auth-middleware';
import { TokenService } from '../auth/token-service';
import { WebSocketGateway } from '../comms/websocket-gateway';
import { createDeviceRouter } from '../comms/rest-device-handler';
import { VideoStreamManager } from '../vision/video-stream-manager';
import { RiskEngine } from '../threat/risk-engine';
import { createBranchContext, nearby, type BranchContext } from './branch-context';
import { BRANCHES, HQ_BRANCH, branchDef } from './geodata/branches';
import { distanceM, type LatLon } from './geo';
import { L, localDigits } from './i18n/messages';
import { LANGS, tri, type Lang, type Tri } from './i18n/types';
import { AlertService, TransitionError, type Alert, type AlertLevel } from './domain/alerts';
import { AdminService, LatencyTracker } from './domain/admin';
import { DetectionError } from './domain/detections';
import { DeviceError, type DeviceType } from './domain/devices';
import { PlanError, type Place, type Priority } from './domain/plans';
import { loadScenarios } from './domain/sim';
import { UserDirectory, UserError, type PublicUser } from './domain/users';
import { PACE_KEYS, type PaceKey } from './routing/planner';
import { SyncHub, type SyncEnvelope } from './sync';
import { branchSummary, summaryCsv, summaryHtml } from './reports';

export interface ServerOptions {
  jwtSecret: string;
  demoPassword?: string;
  demoMode?: boolean;
  corsOrigins?: string[];
  staticDir?: string;
  scenariosDir?: string;
  osmDir?: string;
  telemetryHz?: number;
  branches?: string[];
  rateLimitRpm?: number;
  map?: { styleUrl?: string; terrainUrl?: string; terrainEncoding?: 'terrarium' | 'mapbox'; attribution?: string };
}

type Req = Request & { user: JWTClaims; ctx: BranchContext; branch: string };
const R = (req: Request) => req as Req;
const ALERT_LEVELS: AlertLevel[] = ['critical', 'error', 'warning', 'info'];
const DEFAULT_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const DEFAULT_TERRAIN = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

const wrap = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
  try { const r = fn(req, res); if (r instanceof Promise) r.catch(next); } catch (e) { next(e); }
};

class BadRequest extends Error { constructor(public code: string, message: string) { super(message); } }
const bad = (code: string, message: string) => new BadRequest(code, message);

const isLatLon = (p: unknown): p is LatLon => !!p && typeof p === 'object' && Number.isFinite((p as LatLon).lat) && Number.isFinite((p as LatLon).lon) && Math.abs((p as LatLon).lat) <= 90 && Math.abs((p as LatLon).lon) <= 180;
const origin = (u: string) => { try { return new URL(u.replace(/\{[^}]+\}/g, '0')).origin; } catch { return null; } };

export function createOpsServer(opts: ServerOptions) {
  setRateLimit(opts.rateLimitRpm ?? 1200);
  const tokens = new TokenService(opts.jwtSecret);
  const branchIds = (opts.branches ?? BRANCHES.map((b) => b.id)).filter((id) => branchDef(id));
  const users = new UserDirectory(opts.demoPassword ?? 'demo', branchIds);
  const latency = new LatencyTracker();
  const scenarios = loadScenarios(opts.scenariosDir ?? fileURLToPath(new URL('../simulation/scenarios', import.meta.url)));
  const osmDir = opts.osmDir ?? fileURLToPath(new URL('../data/osm', import.meta.url));
  const contexts = new Map<string, BranchContext>(branchIds.map((id) => [id, createBranchContext(branchDef(id)!, { dataDir: osmDir, scenarios })]));
  const hqId = contexts.has(HQ_BRANCH) ? HQ_BRANCH : branchIds[0];
  const hq = contexts.get(hqId)!;
  const ctxOf = (id: string) => contexts.get(id);
  const startedAt = Date.now();
  const hz = opts.telemetryHz ?? 5;
  const mapCfg = { style_url: opts.map?.styleUrl ?? DEFAULT_STYLE, terrain_url: opts.map?.terrainUrl ?? DEFAULT_TERRAIN, terrain_encoding: opts.map?.terrainEncoding ?? 'terrarium', attribution: opts.map?.attribution ?? '© OpenStreetMap contributors · OpenFreeMap · Terrain: Mapzen/AWS' };

  const video = new VideoStreamManager();
  video.addStream({ stream_id: 'D-01', source_url: 'webrtc://d-01', fps_target: 30, resolution: { w: 3840, h: 2160 } });
  video.addStream({ stream_id: 'CAM-03', source_url: 'rtsp://cam-03/stream', fps_target: 25, resolution: { w: 1920, h: 1080 } });

  const admin = new AdminService(latency, () => ({
    cep95_m: hq.units.get('alpha')?.cep95_m ?? 0,
    telemetry_ratio: Math.min(1, hq.telemetryTicks / Math.max(1, ((Date.now() - startedAt) / 1000) * hz)),
    envelopes: hq.bus.currentSeq(),
  }));

  // --- inter-branch sync
  const cityOf = (id: string): Tri => ctxOf(id)?.def.city ?? tri(id, id, id);
  const hub = new SyncHub(branchIds, (target, env: SyncEnvelope) => {
    const ctx = ctxOf(target);
    if (!ctx) return;
    if (env.kind === 'alert' || env.kind === 'advisory') {
      const a = env.payload as Alert;
      ctx.alerts.upsertReplica({ ...a, title: L('alert.sync', { branch: cityOf(env.origin), title: a.title }), origin_branch: env.origin });
    }
    ctx.bus.publish('sync', { envelope: env, status: hub.status() });
  });
  const replicated = new Set<string>();
  for (const ctx of contexts.values()) {
    ctx.alerts.on('changed', (a: Alert) => {
      if (a.source === 'sync' || ctx.id === hqId) return;
      if (a.level === 'critical' || a.status === 'escalated' || replicated.has(a.id)) {
        replicated.add(a.id);
        hub.publish({ origin: ctx.id, kind: 'alert', id: a.id, version: a.history.length, payload: a }, [hqId]);
      }
    });
    ctx.detections.on('changed', (d) => {
      if (d.status !== 'confirmed' || (d.severity !== 'critical' && d.severity !== 'high') || ctx.id === hqId) return;
      hub.publish({ origin: ctx.id, kind: 'incident', id: d.incident_id ?? d.id, version: 1, payload: { ...d, branch: ctx.id } }, [hqId]);
    });
    ctx.plans.on('changed', (p) => {
      if (ctx.id === hqId || p.status === 'draft') return;
      hub.publish({ origin: ctx.id, kind: 'plan', id: p.id, version: p.version, payload: { id: p.id, title: p.title, status: p.status, vip_level: p.vip_level, approved_by: p.approved_by ?? null, submitted_by: p.submitted_by ?? null, branch: ctx.id } }, [hqId]);
    });
  }

  // --- HTTP
  const app = express();
  app.disable('x-powered-by');
  const mapHosts = [mapCfg.style_url, mapCfg.terrain_url].map(origin).filter((x): x is string => !!x);
  const tileHosts = [...new Set([...mapHosts, 'https://tiles.openfreemap.org', 'https://tile.openstreetmap.org', 'https://s3.amazonaws.com'])];
  app.use(helmet({ contentSecurityPolicy: { directives: {
    'img-src': ["'self'", 'data:', 'blob:', ...tileHosts], 'connect-src': ["'self'", 'ws:', 'wss:', ...tileHosts],
    'worker-src': ["'self'", 'blob:'], 'child-src': ["'self'", 'blob:'], 'font-src': ["'self'", 'data:', ...tileHosts],
  } } }));
  app.use(cors({ origin: opts.corsOrigins ?? ['http://localhost:3000', 'http://127.0.0.1:3000'] }));
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', (req, res, next) => { const t = process.hrtime.bigint(); res.on('finish', () => latency.record(Number(process.hrtime.bigint() - t) / 1e6)); next(); });

  const api = express.Router();
  const auth = jwtAuth(opts.jwtSecret);
  const scope = branchScope(ctxOf, hqId);
  const can = (p: string) => [auth, scope, requirePermission(p)];

  api.get('/health', (_req, res) => { res.json({ status: 'ok', uptime_s: Math.round((Date.now() - startedAt) / 1000), branches: branchIds, seq: Object.fromEntries([...contexts].map(([id, c]) => [id, c.bus.currentSeq()])), clients: gateway.getClientCount() }); });

  const branchInfo = (c: BranchContext) => ({ id: c.id, name: c.def.name, city: c.def.city, province: c.def.province, hq: c.id === hqId, center: c.def.center, bbox: c.geo.bbox, boundary: c.geo.boundary, timezone: c.def.timezone, data_source: c.geo.source });
  api.get('/config', (_req, res) => {
    res.json({ default_branch: hqId, branches: [...contexts.values()].map(branchInfo), languages: LANGS, default_language: 'dr', map: mapCfg, demo_mode: !!opts.demoMode, exercise_data: true });
  });

  // --- auth
  const claimsFor = (u: PublicUser, branch: string) => {
    const role: Role = users.roleIn(u.id, branch) ?? 'viewer';
    return { role, branch, branches: users.readable(u.id), scope: u.scope };
  };
  const session = (u: PublicUser, branch = u.home_branch) => {
    const c = claimsFor(u, branch);
    const { role, ...extra } = c;
    return { ...tokens.issue(u.id, u.name.en, role, extra), user: users.byId(u.id), branch, role, branches: c.branches };
  };
  const actor = (req: Request) => users.byId(R(req).user.sub);
  const by = (req: Request) => actor(req)?.username ?? R(req).user.name;

  api.post('/auth/login', wrap((req, res) => {
    const { username, password } = req.body ?? {};
    const u = typeof username === 'string' && typeof password === 'string' ? users.authenticate(username, password) : null;
    if (!u) return res.status(401).json({ error: 'invalid username or password', code: 'bad_credentials' });
    res.json(session(u));
  }));
  api.post('/auth/refresh', wrap((req, res) => {
    const { refresh_token, branch } = req.body ?? {};
    const owner = typeof refresh_token === 'string' ? tokens.owner(refresh_token) : null;
    const u = owner ? users.byId(owner) : null;
    if (!u || !u.active) return res.status(401).json({ error: 'invalid refresh token', code: 'bad_refresh' });
    const active = typeof branch === 'string' && users.readable(u.id).includes(branch) ? branch : u.home_branch;
    const { role, ...extra } = claimsFor(u, active);
    const pair = tokens.refresh(refresh_token, u.name.en, { role, ...extra });
    if (!pair) return res.status(401).json({ error: 'invalid refresh token', code: 'bad_refresh' });
    res.json({ ...pair, user: u, branch: active, role, branches: extra.branches });
  }));
  api.get('/auth/me', auth, (req, res) => { res.json({ user: actor(req), claims: R(req).user }); });
  api.patch('/auth/me/preferences', auth, wrap((req, res) => {
    const { lang, theme } = req.body ?? {};
    res.json({ user: users.setPreferences(R(req).user.sub, { ...(lang !== undefined ? { lang: lang as Lang } : {}), ...(theme !== undefined ? { theme } : {}) }) });
  }));
  api.post('/auth/switch-branch', auth, wrap((req, res) => {
    const target = String(req.body?.branch ?? '');
    const u = actor(req);
    if (!u) return res.status(401).json({ error: 'unknown user', code: 'user_not_found' });
    if (!contexts.has(target)) return res.status(404).json({ error: `unknown branch: ${target}`, code: 'branch_not_found' });
    if (!users.readable(u.id).includes(target)) return res.status(403).json({ error: `no access to branch ${target}`, code: 'branch_forbidden' });
    res.json(session(u, target));
  }));
  api.post('/auth/switch-role', auth, wrap((req, res) => {
    if (!opts.demoMode) return res.status(403).json({ error: 'role switching is only available in demo mode', code: 'demo_only' });
    const branch = R(req).user.branch ?? hqId;
    const target = users.byRole(req.body?.role as Role, branch);
    if (!target) return res.status(404).json({ error: 'no active user with that role in this branch', code: 'role_not_found' });
    users.touch(target.id);
    res.json(session(target, branch));
  }));
  api.get('/auth/people', auth, (req, res) => { res.json({ people: users.people(R(req).user.branches ?? [R(req).user.branch ?? hqId]) }); });
  api.get('/auth/users', ...can('read:admin'), (req, res) => { res.json({ users: users.list(R(req).branch) }); });
  api.get('/auth/audit', ...can('read:admin'), (_req, res) => { res.json({ entries: getAuditLog().slice(-200) }); });

  // --- branches
  api.get('/branches', auth, (req, res) => {
    const readable = R(req).user.branches ?? [R(req).user.branch ?? hqId];
    res.json({ branches: [...contexts.values()].filter((c) => readable.includes(c.id)).map((c) => ({
      ...branchInfo(c), boundary: undefined, open_alerts: c.alerts.openCount(), running_plans: c.plans.raw().filter((p) => p.status === 'running').length,
      blind_spots: c.blind.zones().length, role: users.roleIn(R(req).user.sub, c.id),
    })) });
  });
  api.get('/branches/:branch/geo', ...can('read:positions'), (req, res) => {
    const g = R(req).ctx.geo;
    res.json({
      branch: g.def.id, source: g.source, bbox: g.bbox, boundary: g.boundary, pois: g.pois, restricted: g.restricted,
      roads: { type: 'FeatureCollection', features: g.roads.map((r) => ({ type: 'Feature', properties: { id: r.id, cls: r.cls, name: r.name ?? null }, geometry: { type: 'LineString', coordinates: r.coords } })) },
    });
  });
  api.get('/branches/:branch/reports/summary', ...can('read:alerts'), wrap((req, res) => {
    const q = req.query;
    const lang = (LANGS as string[]).includes(String(q.lang)) ? (q.lang as Lang) : (actor(req)?.prefs.lang ?? 'dr');
    const from = q.from ? Date.parse(String(q.from)) : undefined, to = q.to ? Date.parse(String(q.to)) : undefined;
    if ((from !== undefined && Number.isNaN(from)) || (to !== undefined && Number.isNaN(to))) throw bad('bad_period', 'from/to must be ISO dates');
    const s = branchSummary(R(req).ctx, { from, to, by: by(req), sync: hub.status().find((x) => x.branch === R(req).branch) ?? null });
    const format = String(q.format ?? 'json');
    const file = `report-${s.branch}-${s.generated_at.slice(0, 10)}`;
    if (format === 'csv') { res.setHeader('Content-Disposition', `attachment; filename="${file}.csv"`); return res.type('text/csv; charset=utf-8').send(summaryCsv(s, lang)); }
    if (format === 'html') return res.type('text/html; charset=utf-8').send(summaryHtml(s, lang));
    res.json(s);
  }));

  // --- telemetry, risk, blind spots
  api.get('/v1/telemetry/latest', ...can('read:positions'), (req, res) => { const c = R(req).ctx; res.json({ units: c.units.meta().map((m) => ({ ...m, telemetry: c.units.get(m.id) ?? null })) }); });
  api.get('/v1/risk/grid', ...can('read:incidents'), (req, res) => { const c = R(req).ctx; res.json({ cells: c.risk.grid(), incidents: c.risk.list(), version: c.risk.version }); });
  api.get('/v1/risk/extremes', ...can('read:incidents'), (req, res) => {
    const c = R(req).ctx;
    const n = Math.min(25, Math.max(1, Number(req.query.n) || 10));
    res.json({ ...c.risk.extremes(c.geo.pois, n), version: c.risk.version });
  });
  api.get('/v1/incidents', ...can('read:incidents'), (req, res) => { res.json({ incidents: R(req).ctx.risk.list() }); });
  api.post('/v1/risk/calculate', ...can('read:incidents'), wrap((req, res) => {
    const b = req.body ?? {};
    if (![b.severity, b.likelihood, b.exposure, b.data_confidence].every((v) => typeof v === 'number' && v >= 0 && v <= 1)) throw bad('bad_factors', 'severity, likelihood, exposure, data_confidence required (0-1)');
    res.json(RiskEngine.calculate(b));
  }));
  api.get('/v1/resources', ...can('read:positions'), (req, res) => { res.json({ resources: R(req).ctx.resources() }); });
  api.get('/v1/blindspots', ...can('read:incidents'), (req, res) => {
    const c = R(req).ctx;
    res.json({ zones: c.blind.zones().map(({ cells: _cells, ...z }) => z), revision: c.blind.revision });
  });
  api.get('/v1/blindspots/:id', ...can('read:incidents'), wrap((req, res) => {
    const z = R(req).ctx.blind.zones().find((x) => x.id === req.params.id);
    if (!z) return res.status(404).json({ error: 'blind spot not found', code: 'blindspot_not_found' });
    res.json(z);
  }));

  // --- alerts
  api.get('/monitoring/alerts', ...can('read:alerts'), (req, res) => { res.json({ alerts: R(req).ctx.alerts.list(), server_time: Date.now() }); });
  api.post('/monitoring/alerts', ...can('write:alerts'), wrap((req, res) => {
    const { level, title, src, unit, broadcast } = req.body ?? {};
    if (!ALERT_LEVELS.includes(level) || typeof title !== 'string' || !title.trim()) throw bad('bad_alert', 'level and title are required');
    const c = R(req).ctx;
    if (broadcast && c.id !== hqId) throw bad('broadcast_hq_only', 'only headquarters can broadcast alerts');
    const a = c.alerts.create({ level, title: title.trim().slice(0, 200), src: typeof src === 'string' ? src.slice(0, 200) : undefined, unit: typeof unit === 'string' ? unit : null, source: 'user' }, by(req));
    if (broadcast) hub.publish({ origin: c.id, kind: 'advisory', id: a.id, version: a.history.length, payload: a }, branchIds);
    res.status(201).json(a);
  }));
  for (const action of ['acknowledge', 'resolve', 'escalate'] as const) {
    api.post(`/monitoring/alerts/:id/${action}`, ...can('ack:alerts'), wrap((req, res) => { res.json(R(req).ctx.alerts[action](req.params.id, by(req))); }));
  }
  api.post('/monitoring/panic', auth, scope, wrap((req, res) => {
    const c = R(req).ctx, u = actor(req);
    if (c.id !== (R(req).user.branch ?? hqId)) return res.status(403).json({ error: 'panic must be raised in your active branch', code: 'branch_readonly' });
    const alpha = c.units.get('alpha');
    const running = c.plans.running();
    if (running) c.plans.setActiveRoute(running.id, 'E');
    const pos = alpha ? `(${alpha.lat.toFixed(5)}, ${alpha.lon.toFixed(5)})` : '';
    const alert = c.alerts.create({ level: 'critical', title: L('alert.panic', { name: u?.name ?? R(req).user.name }), src: L('alert.panic.src', { pos }), unit: 'alpha', status: 'escalated', source: 'panic' }, by(req));
    res.status(201).json({ alert, plan: running ? c.plans.get(running.id) : null });
  }));

  // --- analysis & threats
  api.post('/v1/locations/analyze', ...can('run:analysis'), wrap((req, res) => {
    const { lat, lon, radius_m, include = {} } = req.body ?? {};
    if (!isLatLon({ lat, lon })) throw bad('bad_point', 'lat and lon required');
    const c = R(req).ctx;
    const radius = Math.min(20_000, Math.max(100, Number(radius_m) || 3000));
    const center: LatLon = { lat, lon };
    const inArea = c.risk.list().filter((i) => i.location && distanceM(center, i.location) <= radius + i.radius_m);
    const area = RiskEngine.assessPoint(inArea.map((i) => ({ ...i, radius_m: radius + i.radius_m })), lat, lon, 0, 'area');
    const confs = inArea.map((i) => i.confidence);
    const spread = confs.length > 1 ? Math.sqrt(confs.reduce((s, x) => s + (x - area.input.data_confidence) ** 2, 0) / confs.length) : 0.1;
    const cells = c.risk.grid().filter((g) => distanceM(center, g) <= radius);
    const zones = c.blind.zones().filter((z) => distanceM(center, z.centroid) <= radius);
    res.json({
      center, radius_m: radius, score: area.score, level: area.level, uncertainty: +(spread * area.score + 0.02).toFixed(2), confidence: area.input.data_confidence,
      factors: { severity: area.input.severity, likelihood: area.input.likelihood, exposure: area.input.exposure, data_confidence: area.input.data_confidence },
      point: c.risk.cellAt(center) ?? null,
      cells: { count: cells.length, max: cells.reduce((m, g) => Math.max(m, g.score), 0), by_level: cells.reduce<Record<string, number>>((m, g) => { m[g.level] = (m[g.level] ?? 0) + 1; return m; }, {}) },
      incidents: inArea.map((i) => ({ id: i.incident_id, type: i.type, severity: i.severity, confidence: i.confidence, distance_m: Math.round(distanceM(center, i.location!)) })),
      threats: include.threats === false ? [] : c.detections.list().filter((d) => distanceM(center, d) <= radius),
      blind_spots: zones.map(({ id, type, label, area_km2, centroid }) => ({ id, type, label, area_km2, centroid, distance_m: Math.round(distanceM(center, centroid)) })),
      routes: include.routes === false ? [] : (c.plans.running()?.pace ?? []).map(({ k, label, max_risk, avg_risk, risk_level, eta_min, distance_m }) => ({ k, label, max_risk, avg_risk, risk_level, eta_min, distance_m })),
      resources: include.resources === false ? [] : nearby(c.resources(), center, radius),
      provenance: [...new Set(inArea.flatMap((i) => i.evidence))], analyzed_at: new Date().toISOString(),
    });
  }));
  api.get('/threat/detections', ...can('read:incidents'), (req, res) => { res.json({ detections: R(req).ctx.detections.list() }); });
  api.post('/threat/analyze', ...can('validate:incidents'), wrap((req, res) => {
    const { detection_id, decision } = req.body ?? {};
    if (decision !== 'confirm' && decision !== 'reject') throw bad('bad_decision', 'decision must be confirm or reject');
    res.json(R(req).ctx.detections.decide(String(detection_id), decision, by(req)));
  }));
  api.post('/threat/detect/image', ...can('run:analysis'), express.raw({ type: ['image/*', 'application/octet-stream'], limit: '10mb' }), wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw bad('image_required', 'image body required');
    res.json(await R(req).ctx.detections.analyzeImage(req.body, 'upload'));
  }));
  api.get('/vision/streams', ...can('read:devices'), (_req, res) => { res.json({ streams: video.listStreams() }); });

  // --- escort planning
  const toPlace = (c: BranchContext, v: unknown, fallback: Tri): Place => {
    const o = (v ?? {}) as { poi?: string; lat?: number; lon?: number; name?: string };
    if (typeof o.poi === 'string') {
      const p = c.geo.pois.find((x) => x.id === o.poi);
      if (!p) throw bad('bad_place', `unknown facility: ${o.poi}`);
      return { name: p.name, lat: p.lat, lon: p.lon };
    }
    if (!isLatLon(o)) throw bad('bad_place', 'origin and destination need {poi} or {lat, lon}');
    const p: LatLon = { lat: o.lat, lon: o.lon };
    if (distanceM(c.def.center, p) > 40_000) throw bad('out_of_area', 'point is outside the branch area');
    const coords = `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
    const label = (v as { name?: unknown }).name;
    const name = typeof label === 'string' && label.trim() ? label.trim().slice(0, 80) : { dr: `${fallback.dr} (${localDigits('dr', coords)})`, ps: `${fallback.ps} (${localDigits('ps', coords)})`, en: `${fallback.en} (${coords})` };
    return { name, lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6) };
  };
  const waypointsOf = (v: unknown): LatLon[] => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.length > 12 || !v.every(isLatLon)) throw bad('bad_waypoints', 'waypoints must be at most 12 {lat, lon} points');
    return v.map((w) => ({ lat: w.lat, lon: w.lon }));
  };
  const ORIGIN = tri('مبدأ', 'پیل ځای', 'Origin'), DEST = tri('مقصد', 'منزل', 'Destination');

  api.get('/security/escort-plans', ...can('read:plans'), (req, res) => { res.json({ plans: R(req).ctx.plans.list() }); });
  api.get('/security/escort-plan/:id', ...can('read:plans'), wrap((req, res) => { const p = R(req).ctx.plans.get(req.params.id); if (!p) return res.status(404).json({ error: 'plan not found', code: 'plan_not_found' }); res.json(p); }));
  api.post('/security/route-preview', ...can('read:plans'), wrap((req, res) => {
    const c = R(req).ctx;
    const o = toPlace(c, req.body?.origin, ORIGIN), d = toPlace(c, req.body?.destination, DEST);
    const wps = req.body?.waypoints && typeof req.body.waypoints === 'object' ? Object.fromEntries(PACE_KEYS.map((k) => [k, waypointsOf(req.body.waypoints[k])])) : {};
    res.json({ origin: o, destination: d, pace: c.planner.pace(o, d, wps) });
  }));
  api.post('/security/escort-plan', ...can('write:plans'), wrap((req, res) => {
    const c = R(req).ctx;
    const { vip_level, priority, start } = req.body ?? {};
    const o = toPlace(c, req.body?.origin, ORIGIN), d = toPlace(c, req.body?.destination, DEST);
    if (distanceM(o, d) < 100) throw bad('same_place', 'origin and destination are the same place');
    const pr: Priority = ['security', 'time', 'balanced'].includes(priority) ? priority : 'security';
    res.status(201).json(c.plans.create({ origin: o, destination: d, vip_level: Math.min(5, Math.max(1, Number(vip_level) || 3)), priority: pr, ...(typeof start === 'string' && start.trim() ? { start: start.trim().slice(0, 40) } : {}) }, by(req)));
  }));
  api.patch('/security/escort-plan/:id', ...can('switch:route'), wrap((req, res) => {
    const k = req.body?.active_route as PaceKey;
    if (!PACE_KEYS.includes(k)) throw bad('bad_route', 'active_route must be P, A, C or E');
    res.json(R(req).ctx.plans.setActiveRoute(req.params.id, k));
  }));
  api.put('/security/escort-plan/:id/routes/:k', ...can('write:plans'), wrap((req, res) => {
    const k = req.params.k as PaceKey;
    if (!PACE_KEYS.includes(k)) throw bad('bad_route', 'route must be P, A, C or E');
    res.json(R(req).ctx.plans.editRoute(req.params.id, k, waypointsOf(req.body?.waypoints ?? []), by(req)));
  }));
  api.post('/security/escort-plan/:id/submit', ...can('write:plans'), wrap((req, res) => {
    const c = R(req).ctx;
    const p = c.plans.submit(req.params.id, by(req));
    c.alerts.create({ level: 'info', title: L('alert.planPending', { id: p.id }), src: L('alert.planPending.src', { name: actor(req)?.name ?? by(req) }), source: 'user' }, by(req));
    res.json(p);
  }));
  api.post('/security/escort-plan/:id/approve', ...can('approve:plans'), wrap((req, res) => { res.json(R(req).ctx.plans.approve(req.params.id, by(req))); }));

  // --- simulation
  api.get('/v1/scenarios', ...can('read:scenarios'), (req, res) => { const s = R(req).ctx.sim; res.json({ scenarios: s.list(), status: s.status() }); });
  api.get('/v1/scenarios/status', ...can('read:scenarios'), (req, res) => { res.json(R(req).ctx.sim.status()); });
  api.post('/v1/scenarios/pause', ...can('run:scenarios'), (req, res) => { const c = R(req).ctx; const s = c.sim.pause(); c.bus.publish('sim', s); res.json(s); });
  api.post('/v1/scenarios/reset', ...can('run:scenarios'), (req, res) => { res.json(R(req).ctx.sim.reset()); });
  api.post('/v1/scenarios/speed', ...can('run:scenarios'), wrap((req, res) => {
    const speed = Number(req.body?.speed);
    if (![1, 2, 4].includes(speed)) throw bad('bad_speed', 'speed must be 1, 2 or 4');
    const c = R(req).ctx; const s = c.sim.setSpeed(speed); c.bus.publish('sim', s); res.json(s);
  }));
  api.post('/v1/scenarios/:id/run', ...can('run:scenarios'), wrap((req, res) => {
    const c = R(req).ctx;
    if (!c.sim.find(req.params.id)) return res.status(404).json({ error: 'scenario not found', code: 'scenario_not_found' });
    const speed = req.body?.speed ? Number(req.body.speed) : undefined;
    const s = c.sim.run(req.params.id, speed && [1, 2, 4].includes(speed) ? speed : undefined); c.bus.publish('sim', s); res.json(s);
  }));
  api.get('/v1/reports/:id', ...can('read:scenarios'), wrap((req, res) => { const r = R(req).ctx.sim.report(req.params.id); if (!r) return res.status(404).json({ error: 'no completed run for this scenario', code: 'report_not_found' }); res.json(r); }));

  // --- devices
  api.get('/communication/devices', ...can('read:devices'), (req, res) => { res.json({ devices: R(req).ctx.devices.list(req.query.type as DeviceType | undefined) }); });
  api.post('/communication/devices', ...can('write:devices'), wrap((req, res) => { res.status(201).json(R(req).ctx.devices.register(req.body ?? {})); }));
  api.post('/communication/command/:id', ...can('command:devices'), wrap((req, res) => { res.json(R(req).ctx.devices.command(req.params.id, String(req.body?.command ?? ''), by(req))); }));
  api.use('/communication/ingest', ...can('write:devices'), (req, res, next) => createDeviceRouter((p) => R(req).ctx.devices.touch(p.device_id, { lat: p.lat, lon: p.lon }))(req, res, next));

  // --- inter-branch sync
  api.get('/sync/status', ...can('read:alerts'), (req, res) => { res.json({ branch: R(req).branch, hq: hqId, status: hub.status() }); });
  api.get('/sync/feed', ...can('read:alerts'), (req, res) => { res.json({ branch: R(req).branch, items: hub.feed(R(req).branch) }); });
  api.post('/sync/link', ...can('run:maintenance'), wrap((req, res) => {
    const { branch, up } = req.body ?? {};
    if (typeof branch !== 'string' || !contexts.has(branch) || typeof up !== 'boolean') throw bad('bad_link', 'branch and up (boolean) are required');
    const st = hub.setLink(branch, up);
    for (const c of contexts.values()) c.bus.publish('sync', { status: hub.status() });
    res.json(st);
  }));

  // --- operations & governance (headquarters-wide)
  api.get('/operations/sla/metrics', ...can('read:admin'), (_req, res) => { res.json({ metrics: admin.sla() }); });
  api.get('/operations/maintenance/tasks', ...can('read:admin'), (_req, res) => { res.json({ tasks: admin.maintenance() }); });
  api.post('/operations/maintenance/:id/run', ...can('run:maintenance'), wrap((req, res) => { res.json(admin.runTask(req.params.id)); }));
  api.get('/governance/compliance', ...can('read:admin'), (_req, res) => { res.json({ frameworks: admin.compliance(), data_classes: admin.dataClasses() }); });
  api.get('/advanced-security/keys', ...can('read:admin'), (_req, res) => { res.json({ keys: admin.keyList(), last_scan: admin.lastScanResult() }); });
  api.post('/advanced-security/keys/:name/rotate', ...can('manage:keys'), wrap((req, res) => { res.json(admin.rotateKey(req.params.name)); }));
  api.post('/advanced-security/scan', ...can('manage:keys'), (_req, res) => { res.json(admin.scan()); });
  api.get('/training/programs', ...can('read:admin'), (_req, res) => { res.json({ programs: admin.training() }); });

  app.use('/api', api);
  app.use('/api', (_req, res) => { res.status(404).json({ error: 'not found', code: 'not_found' }); });

  const staticDir = opts.staticDir;
  if (staticDir && existsSync(join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => { res.sendFile(join(staticDir, 'index.html')); });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string }).code;
    const typed = err instanceof TransitionError || err instanceof DeviceError || err instanceof PlanError || err instanceof DetectionError || err instanceof UserError || err instanceof BadRequest;
    let status = 500;
    if (err instanceof BadRequest || err instanceof UserError) status = 400;
    else if (typed && code && /not_found$/.test(code)) status = 404;
    else if (code === 'bad_transition') status = 409;
    else if (typed && code && /^(bad_|invalid|too_many)/.test(code)) status = 400;
    else if (typed) status = 409;
    else if (/not found/.test(msg)) status = 404;
    else if ((err as { type?: string }).type === 'entity.parse.failed') status = 400;
    if (status === 500) console.error(err);
    res.status(status).json({ error: msg, ...(typeof code === 'string' ? { code } : {}) });
  });

  // --- realtime
  const httpServer: Server = createServer(app);
  const readable = (socket: Socket) => { const c = socket.data.user as JWTClaims; return c.branches ?? [c.branch ?? hqId]; };
  const gateway = new WebSocketGateway(httpServer, {
    corsOrigins: opts.corsOrigins ?? ['http://localhost:3000', 'http://127.0.0.1:3000'],
    authenticate: (token) => (token ? verifyJWT(token, opts.jwtSecret) : null),
    authorizeRoom: (socket, room) => room.startsWith('branch:') && readable(socket).includes(room.slice(7)),
    onConnection: (socket) => {
      const claims = socket.data.user as JWTClaims;
      const active = claims.branch ?? hqId;
      socket.join(`branch:${active}`);
      socket.emit('hello', { seq: ctxOf(active)?.bus.currentSeq() ?? 0, server_time: Date.now(), role: claims.role, branch: active, branches: readable(socket) });
      socket.on('watch', (branch: unknown, ack?: (r: { ok: boolean; seq?: number }) => void) => {
        if (typeof branch !== 'string' || !contexts.has(branch) || !readable(socket).includes(branch)) return ack?.({ ok: false });
        for (const r of socket.rooms) if (r.startsWith('branch:')) socket.leave(r);
        socket.join(`branch:${branch}`);
        ack?.({ ok: true, seq: ctxOf(branch)!.bus.currentSeq() });
      });
      socket.on('resume', (arg: unknown) => {
        const { branch, seq } = typeof arg === 'object' && arg ? (arg as { branch?: string; seq?: number }) : { branch: active, seq: Number(arg) };
        const b = branch ?? active;
        const n = Number(seq);
        if (!contexts.has(b) || !readable(socket).includes(b) || !Number.isFinite(n) || n < 0) return;
        for (const env of ctxOf(b)!.bus.since(n)) socket.emit('env', env);
      });
      socket.on('can', (perm: string, ack?: (ok: boolean) => void) => ack?.(hasPermission(claims.role, perm)));
    },
  });
  for (const c of contexts.values()) c.bus.subscribe((env) => gateway.sendToRoom(`branch:${c.id}`, 'env', env));

  const timers: ReturnType<typeof setInterval>[] = [];
  let ticking = false;
  const start = (port: number, host = '0.0.0.0') => new Promise<number>((resolve) => {
    timers.push(setInterval(async () => {
      if (ticking) return;
      ticking = true;
      try { for (const c of contexts.values()) await c.tick(1 / hz); }
      catch (e) { console.error('telemetry tick failed', e); }
      finally { ticking = false; }
    }, 1000 / hz));
    timers.push(setInterval(() => {
      for (const c of contexts.values()) { c.alerts.tick(); if (c.sim.status().running) c.bus.publish('sim', c.sim.status()); }
      hub.flush();
    }, 1000));
    // Risk grid heartbeat and a periodic blind-spot refresh (the escort drone's footprint moves).
    timers.push(setInterval(() => { for (const c of contexts.values()) { c.bus.publish('risk', { version: c.risk.version, cells: c.risk.grid(), incidents: c.risk.list() }); c.blind.schedule(); } }, 10_000));
    for (const c of contexts.values()) c.risk.on('changed', () => c.bus.publish('risk', { version: c.risk.version, cells: c.risk.grid(), incidents: c.risk.list() }));
    httpServer.listen(port, host, () => { const a = httpServer.address(); resolve(typeof a === 'object' && a ? a.port : port); });
  });
  const stop = async () => {
    for (const t of timers) clearInterval(t);
    for (const c of contexts.values()) c.stop();
    await gateway.close();
    await new Promise<void>((r) => httpServer.close(() => r()));
  };

  return { app, httpServer, start, stop, contexts, hub, users, tokens, admin, services: { ...serviceView(hq), admin, users, tokens, hub } };
}

/** HQ services under their historical names (used by tests and tooling). */
function serviceView(c: BranchContext) {
  return { alerts: c.alerts as AlertService, risk: c.risk, plans: c.plans, units: c.units, sim: c.sim, devices: c.devices, detections: c.detections, blind: c.blind, bus: c.bus };
}
