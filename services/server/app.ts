/**
 * Operations console backend: REST API + Socket.IO envelope stream over the platform services.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer, type Server } from 'http';
import { existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { jwtAuth, requirePermission, verifyJWT, hasPermission, getAuditLog, type JWTClaims, type Role } from '../auth/auth-middleware';
import { TokenService } from '../auth/token-service';
import { WebSocketGateway } from '../comms/websocket-gateway';
import { createDeviceRouter } from '../comms/rest-device-handler';
import { VideoStreamManager } from '../vision/video-stream-manager';
import { RiskEngine } from '../threat/risk-engine';
import { RealtimeBus } from './realtime';
import { AlertService, TransitionError, type AlertLevel } from './domain/alerts';
import { RiskModel } from './domain/risk';
import { PlanService, ROUTES, type PaceKey } from './domain/plans';
import { UnitTracker } from './domain/units';
import { SimService, loadScenarios } from './domain/sim';
import { DeviceRegistry, DeviceError, type DeviceType } from './domain/devices';
import { DetectionService } from './domain/detections';
import { AdminService, LatencyTracker } from './domain/admin';
import { UserDirectory } from './domain/users';
import { ALERTS, DETECTIONS, DEVICES, PLANS, RESOURCES, UNITS, seedIncidents } from './seed';
import { distanceM, type LatLon } from './geo';

export interface ServerOptions {
  jwtSecret: string;
  demoPassword?: string;
  demoMode?: boolean;
  corsOrigins?: string[];
  staticDir?: string;
  scenariosDir?: string;
  telemetryHz?: number;
}

type AuthedRequest = Request & { user: JWTClaims };
const user = (req: Request) => (req as AuthedRequest).user;
const ALERT_LEVELS: AlertLevel[] = ['critical', 'error', 'warning', 'info'];
const SIM_TO_ALERT: Record<string, AlertLevel> = { critical: 'critical', high: 'error', medium: 'warning', low: 'info' };

const wrap = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
  try { const r = fn(req, res); if (r instanceof Promise) r.catch(next); } catch (e) { next(e); }
};

export function createOpsServer(opts: ServerOptions) {
  const tokens = new TokenService(opts.jwtSecret);
  const users = new UserDirectory(opts.demoPassword ?? 'demo');
  const bus = new RealtimeBus();
  const latency = new LatencyTracker();
  const alerts = new AlertService();
  const risk = new RiskModel();
  seedIncidents(risk);
  const plans = new PlanService(risk, PLANS);
  const runningRoute = () => { const p = plans.running(); return p ? { key: p.active_route, path: ROUTES[p.active_route] } : undefined; };
  const units = new UnitTracker(risk, runningRoute, UNITS);
  const sim = new SimService(loadScenarios(opts.scenariosDir ?? fileURLToPath(new URL('../simulation/scenarios', import.meta.url))));
  const devices = new DeviceRegistry(DEVICES());
  const detections = new DetectionService(risk, DETECTIONS());
  const video = new VideoStreamManager();
  video.addStream({ stream_id: 'D-01', source_url: 'webrtc://d-01', fps_target: 30, resolution: { w: 3840, h: 2160 } });
  video.addStream({ stream_id: 'CAM-03', source_url: 'rtsp://cam-03/stream', fps_target: 25, resolution: { w: 1920, h: 1080 } });
  let telemetryTicks = 0;
  const startedAt = Date.now();
  const hz = opts.telemetryHz ?? 5;
  const admin = new AdminService(latency, () => ({
    cep95_m: units.get('alpha')?.cep95_m ?? 0,
    telemetry_ratio: Math.min(1, telemetryTicks / Math.max(1, ((Date.now() - startedAt) / 1000) * hz)),
    envelopes: bus.currentSeq(),
  }));
  for (const a of ALERTS) alerts.create({ ...a, source: 'system' });

  alerts.on('changed', (a) => bus.publish('alerts', a));
  plans.on('changed', (p) => bus.publish('plans', p));
  devices.on('changed', (d) => bus.publish('devices', d));
  detections.on('changed', (d) => bus.publish('risk', { detection: d, cells: risk.grid(), incidents: risk.list() }));
  sim.on('event', (e, s) => {
    if (e.type === 'incident') {
      const i = e.data as { type: string; severity: 'low' | 'medium' | 'high' | 'critical'; lat: number; lon: number; radius_m: number; confidence: number; evidence?: string[] };
      risk.add({ type: i.type, severity: i.severity, location: { lat: i.lat, lon: i.lon }, radius_m: i.radius_m, confidence: i.confidence, evidence: i.evidence ?? [], source: `sim:${s.id}`, human_validation_status: 'pending', ttl_s: 3600 });
    } else if (e.type === 'alert') {
      const a = e.data as { severity: string; message: string };
      alerts.create({ level: SIM_TO_ALERT[a.severity] ?? 'info', title: a.message, src: `شبیه‌سازی · ${s.name}`, source: 'simulation' });
    }
    if (e.type !== 'position' && e.type !== 'step_complete') bus.publish('sim', sim.status());
  });
  sim.on('reset', (s) => { risk.remove((i) => i.source === `sim:${s.id}`); bus.publish('sim', sim.status()); });

  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { 'img-src': ["'self'", 'data:', 'blob:'], 'connect-src': ["'self'", 'ws:', 'wss:'] } } }));
  app.use(cors({ origin: opts.corsOrigins ?? ['http://localhost:3000', 'http://127.0.0.1:3000'] }));
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', (req, res, next) => { const t = process.hrtime.bigint(); res.on('finish', () => latency.record(Number(process.hrtime.bigint() - t) / 1e6)); next(); });

  const api = express.Router();
  const auth = jwtAuth(opts.jwtSecret);
  const can = (p: string) => [auth, requirePermission(p)];

  api.get('/health', (_req, res) => { res.json({ status: 'ok', uptime_s: Math.round((Date.now() - startedAt) / 1000), seq: bus.currentSeq(), clients: gateway.getClientCount() }); });

  // --- auth
  const session = (u: { id: string; name: string; role: Role }) => ({ ...tokens.issue(u.id, u.name, u.role), user: users.byId(u.id) });
  api.post('/auth/login', wrap((req, res) => {
    const { username, password } = req.body ?? {};
    const u = typeof username === 'string' && typeof password === 'string' ? users.authenticate(username, password) : null;
    if (!u) return res.status(401).json({ error: 'نام کاربری یا گذرواژه نادرست است' });
    res.json(session(u));
  }));
  api.post('/auth/refresh', wrap((req, res) => {
    const { refresh_token, user_id } = req.body ?? {};
    const u = typeof user_id === 'string' ? users.byId(user_id) : null;
    const pair = u && typeof refresh_token === 'string' ? tokens.refresh(refresh_token, u.name) : null;
    if (!pair || !u) return res.status(401).json({ error: 'invalid refresh token' });
    res.json({ ...pair, user: u });
  }));
  api.get('/auth/me', auth, (req, res) => { res.json({ user: users.byId(user(req).sub), claims: user(req) }); });
  api.post('/auth/switch-role', auth, wrap((req, res) => {
    if (!opts.demoMode) return res.status(403).json({ error: 'role switching is only available in demo mode' });
    const target = users.byRole(req.body?.role as Role);
    if (!target) return res.status(404).json({ error: 'no active user with that role' });
    users.touch(target.id);
    res.json(session(target));
  }));
  api.get('/auth/users', ...can('read:admin'), (_req, res) => { res.json({ users: users.list() }); });
  api.get('/auth/audit', ...can('read:admin'), (_req, res) => { res.json({ entries: getAuditLog().slice(-200) }); });

  // --- telemetry & risk
  api.get('/v1/telemetry/latest', ...can('read:positions'), (_req, res) => { res.json({ units: units.meta().map((m) => ({ ...m, telemetry: units.get(m.id) ?? null })) }); });
  api.get('/v1/risk/grid', ...can('read:incidents'), (_req, res) => { res.json({ cells: risk.grid() }); });
  api.get('/v1/incidents', ...can('read:incidents'), (_req, res) => { res.json({ incidents: risk.list() }); });
  api.post('/v1/risk/calculate', ...can('read:incidents'), wrap((req, res) => {
    const b = req.body ?? {};
    if (![b.severity, b.likelihood, b.exposure, b.data_confidence].every((v) => typeof v === 'number' && v >= 0 && v <= 1)) return res.status(400).json({ error: 'severity, likelihood, exposure, data_confidence required (0-1)' });
    res.json(RiskEngine.calculate(b));
  }));
  api.get('/v1/resources', ...can('read:positions'), (_req, res) => { res.json({ resources: RESOURCES }); });

  // --- alerts
  api.get('/monitoring/alerts', ...can('read:alerts'), (_req, res) => { res.json({ alerts: alerts.list(), server_time: Date.now() }); });
  api.post('/monitoring/alerts', ...can('write:alerts'), wrap((req, res) => {
    const { level, title, src, unit } = req.body ?? {};
    if (!ALERT_LEVELS.includes(level) || typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'level and title are required' });
    res.status(201).json(alerts.create({ level, title, src, unit, source: 'user' }, user(req).name));
  }));
  for (const action of ['acknowledge', 'resolve', 'escalate'] as const) {
    api.post(`/monitoring/alerts/:id/${action}`, ...can('ack:alerts'), wrap((req, res) => { res.json(alerts[action](req.params.id, user(req).name)); }));
  }
  api.post('/monitoring/panic', auth, wrap((req, res) => {
    const u = user(req);
    const alpha = units.get('alpha');
    const running = plans.running();
    if (running) plans.setActiveRoute(running.id, 'E');
    const alert = alerts.create({ level: 'critical', title: `PANIC فعال شد — ${u.name}`, src: `موقعیت ثبت شد${alpha ? ` (${alpha.lat.toFixed(4)}, ${alpha.lon.toFixed(4)})` : ''} · مسیر E فعال شد`, unit: 'alpha', status: 'escalated', source: 'panic' }, u.name);
    res.status(201).json({ alert, plan: running ? plans.get(running.id) : null });
  }));

  // --- analysis & threats
  api.post('/v1/locations/analyze', ...can('run:analysis'), wrap((req, res) => {
    const { lat, lon, radius_m, include = {} } = req.body ?? {};
    if (typeof lat !== 'number' || typeof lon !== 'number' || Math.abs(lat) > 90 || Math.abs(lon) > 180) return res.status(400).json({ error: 'lat and lon required' });
    const radius = Math.min(20_000, Math.max(100, Number(radius_m) || 3000));
    const center: LatLon = { lat, lon };
    const inArea = risk.list().filter((i) => i.location && distanceM(center, i.location) <= radius + i.radius_m);
    const area = RiskEngine.assessPoint(inArea.map((i) => ({ ...i, radius_m: radius + i.radius_m })), lat, lon, 0, 'area');
    const confs = inArea.map((i) => i.confidence);
    const spread = confs.length > 1 ? Math.sqrt(confs.reduce((s, c) => s + (c - area.input.data_confidence) ** 2, 0) / confs.length) : 0.1;
    res.json({
      center, radius_m: radius, score: area.score, level: area.level, uncertainty: +(spread * area.score + 0.02).toFixed(2), confidence: area.input.data_confidence,
      factors: { severity: area.input.severity, likelihood: area.input.likelihood, exposure: area.input.exposure, data_confidence: area.input.data_confidence },
      incidents: inArea.map((i) => ({ id: i.incident_id, type: i.type, severity: i.severity, confidence: i.confidence, distance_m: Math.round(distanceM(center, i.location!)) })),
      threats: include.threats === false ? [] : detections.list().filter((d) => distanceM(center, d) <= radius),
      routes: include.routes === false ? [] : plans.routes().map(({ k, name, risk: r, risk_level }) => ({ k, name, risk: r, risk_level })),
      resources: include.resources === false ? [] : RESOURCES.map((r) => ({ ...r, distance_m: Math.round(distanceM(center, r)) })).filter((r) => r.distance_m <= radius).sort((a, b) => a.distance_m - b.distance_m),
      provenance: [...new Set(inArea.flatMap((i) => i.evidence))], analyzed_at: new Date().toISOString(),
    });
  }));
  api.get('/threat/detections', ...can('read:incidents'), (_req, res) => { res.json({ detections: detections.list() }); });
  api.post('/threat/analyze', ...can('validate:incidents'), wrap((req, res) => {
    const { detection_id, decision } = req.body ?? {};
    if (decision !== 'confirm' && decision !== 'reject') return res.status(400).json({ error: 'decision must be confirm or reject' });
    res.json(detections.decide(String(detection_id), decision, user(req).name));
  }));
  api.post('/threat/detect/image', ...can('run:analysis'), express.raw({ type: ['image/*', 'application/octet-stream'], limit: '10mb' }), wrap(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: 'image body required' });
    res.json(await detections.analyzeImage(req.body, 'upload'));
  }));
  api.get('/vision/streams', ...can('read:devices'), (_req, res) => { res.json({ streams: video.listStreams() }); });

  // --- escort planning
  api.get('/security/escort-plans', ...can('read:plans'), (_req, res) => { res.json({ plans: plans.list() }); });
  api.get('/security/escort-plan/:id', ...can('read:plans'), wrap((req, res) => { const p = plans.get(req.params.id); if (!p) return res.status(404).json({ error: 'plan not found' }); res.json(p); }));
  api.post('/security/escort-plan', ...can('write:plans'), wrap((req, res) => {
    const { origin, destination, vip_level, priority } = req.body ?? {};
    if (typeof origin !== 'string' || typeof destination !== 'string' || !origin.trim() || !destination.trim()) return res.status(400).json({ error: 'origin and destination required' });
    const pr = ['security', 'time', 'balanced'].includes(priority) ? priority : 'security';
    res.status(201).json(plans.create({ origin, destination, vip_level: Math.min(5, Math.max(1, Number(vip_level) || 3)), priority: pr }, user(req).name));
  }));
  api.patch('/security/escort-plan/:id', ...can('switch:route'), wrap((req, res) => {
    const k = req.body?.active_route as PaceKey;
    if (!['P', 'A', 'C', 'E'].includes(k)) return res.status(400).json({ error: 'active_route must be P, A, C or E' });
    res.json(plans.setActiveRoute(req.params.id, k));
  }));
  api.post('/security/escort-plan/:id/submit', ...can('write:plans'), wrap((req, res) => {
    const p = plans.submit(req.params.id, user(req).name);
    alerts.create({ level: 'info', title: `پلن ${p.id} منتظر تأیید فرمانده`, src: `ارسال توسط ${user(req).name}`, source: 'user' }, user(req).name);
    res.json(p);
  }));
  api.post('/security/escort-plan/:id/approve', ...can('approve:plans'), wrap((req, res) => { res.json(plans.approve(req.params.id, user(req).name)); }));

  // --- simulation
  api.get('/v1/scenarios', ...can('read:scenarios'), (_req, res) => { res.json({ scenarios: sim.list(), status: sim.status() }); });
  api.get('/v1/scenarios/status', ...can('read:scenarios'), (_req, res) => { res.json(sim.status()); });
  api.post('/v1/scenarios/pause', ...can('run:scenarios'), (_req, res) => { const s = sim.pause(); bus.publish('sim', s); res.json(s); });
  api.post('/v1/scenarios/reset', ...can('run:scenarios'), (_req, res) => { res.json(sim.reset()); });
  api.post('/v1/scenarios/speed', ...can('run:scenarios'), wrap((req, res) => {
    const speed = Number(req.body?.speed);
    if (![1, 2, 4].includes(speed)) return res.status(400).json({ error: 'speed must be 1, 2 or 4' });
    const s = sim.setSpeed(speed); bus.publish('sim', s); res.json(s);
  }));
  api.post('/v1/scenarios/:id/run', ...can('run:scenarios'), wrap((req, res) => {
    if (!sim.find(req.params.id)) return res.status(404).json({ error: 'scenario not found' });
    const speed = req.body?.speed ? Number(req.body.speed) : undefined;
    const s = sim.run(req.params.id, speed && [1, 2, 4].includes(speed) ? speed : undefined); bus.publish('sim', s); res.json(s);
  }));
  api.get('/v1/reports/:id', ...can('read:scenarios'), wrap((req, res) => { const r = sim.report(req.params.id); if (!r) return res.status(404).json({ error: 'no completed run for this scenario' }); res.json(r); }));

  // --- devices
  api.get('/communication/devices', ...can('read:devices'), (req, res) => { res.json({ devices: devices.list(req.query.type as DeviceType | undefined) }); });
  api.post('/communication/devices', ...can('write:devices'), wrap((req, res) => { res.status(201).json(devices.register(req.body ?? {})); }));
  api.post('/communication/command/:id', ...can('command:devices'), wrap((req, res) => { res.json(devices.command(req.params.id, String(req.body?.command ?? ''), user(req).name)); }));
  api.use('/communication/ingest', ...can('write:devices'), createDeviceRouter((p) => devices.touch(p.device_id, `موقعیت ${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`)));

  // --- operations & governance
  api.get('/operations/sla/metrics', ...can('read:admin'), (_req, res) => { res.json({ metrics: admin.sla() }); });
  api.get('/operations/maintenance/tasks', ...can('read:admin'), (_req, res) => { res.json({ tasks: admin.maintenance() }); });
  api.post('/operations/maintenance/:id/run', ...can('run:maintenance'), wrap((req, res) => { res.json(admin.runTask(req.params.id)); }));
  api.get('/governance/compliance', ...can('read:admin'), (_req, res) => { res.json({ frameworks: admin.compliance(), data_classes: admin.dataClasses() }); });
  api.get('/advanced-security/keys', ...can('read:admin'), (_req, res) => { res.json({ keys: admin.keyList(), last_scan: admin.lastScanResult() }); });
  api.post('/advanced-security/keys/:name/rotate', ...can('manage:keys'), wrap((req, res) => { res.json(admin.rotateKey(req.params.name)); }));
  api.post('/advanced-security/scan', ...can('manage:keys'), (_req, res) => { res.json(admin.scan()); });
  api.get('/training/programs', ...can('read:admin'), (_req, res) => { res.json({ programs: admin.training() }); });

  app.use('/api', api);
  app.use('/api', (_req, res) => { res.status(404).json({ error: 'not found' }); });

  const staticDir = opts.staticDir;
  if (staticDir && existsSync(join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => { res.sendFile(join(staticDir, 'index.html')); });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const msg = err instanceof Error ? err.message : String(err);
    const status = err instanceof TransitionError || err instanceof DeviceError ? 409 : /not found/.test(msg) ? 404 : /already|cannot|is (running|closed)/.test(msg) ? 409 : 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: msg });
  });

  const httpServer: Server = createServer(app);
  const gateway = new WebSocketGateway(httpServer, {
    corsOrigins: opts.corsOrigins ?? ['http://localhost:3000', 'http://127.0.0.1:3000'],
    authenticate: (token) => (token ? verifyJWT(token, opts.jwtSecret) : null),
    onConnection: (socket) => {
      const claims = socket.data.user as JWTClaims;
      socket.emit('hello', { seq: bus.currentSeq(), server_time: Date.now(), role: claims.role });
      socket.on('resume', (lastSeq: unknown) => {
        const n = Number(lastSeq);
        if (Number.isFinite(n) && n >= 0) for (const env of bus.since(n)) socket.emit('env', env);
      });
      socket.on('can', (perm: string, ack?: (ok: boolean) => void) => ack?.(hasPermission(claims.role, perm)));
    },
  });
  bus.subscribe((env) => gateway.broadcast('env', env));

  const timers: ReturnType<typeof setInterval>[] = [];
  let ticking = false;
  const start = (port: number, host = '0.0.0.0') => new Promise<number>((resolve) => {
    timers.push(setInterval(async () => {
      if (ticking) return;
      ticking = true;
      try { bus.publish('telemetry', { units: await units.tick(1 / hz) }); telemetryTicks++; devices.drainBattery('D-01', 0.0005); }
      catch (e) { console.error('telemetry tick failed', e); }
      finally { ticking = false; }
    }, 1000 / hz));
    timers.push(setInterval(() => { alerts.tick(); bus.publish('risk', { cells: risk.grid(), incidents: risk.list() }); if (sim.status().running) bus.publish('sim', sim.status()); }, 1000));
    httpServer.listen(port, host, () => { const a = httpServer.address(); resolve(typeof a === 'object' && a ? a.port : port); });
  });
  const stop = async () => { for (const t of timers) clearInterval(t); sim.reset(); await gateway.close(); await new Promise<void>((r) => httpServer.close(() => r())); };

  return { app, httpServer, start, stop, services: { alerts, risk, plans, units, sim, devices, detections, admin, users, bus, tokens } };
}
