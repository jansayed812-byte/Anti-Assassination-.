/**
 * Boots the real operations backend on a random port and drives it over HTTP and Socket.IO:
 * auth & RBAC, branch isolation and regional access, language preference, risk and blind spots,
 * escort planning with manual route editing, inter-branch sync, per-branch reports and realtime rooms.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { createOpsServer } from '../../services/server/app';

const SECRET = 'integration-secret-0123456789abcdef';
let base = '';
let server: ReturnType<typeof createOpsServer>;

type Res = { status: number; body: any; text: string; type: string };
async function call(method: string, path: string, token?: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  const res = await fetch(`${base}/api${path}`, {
    method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, body: type.includes('json') ? JSON.parse(text) : null, text, type };
}
const session = async (username: string) => (await call('POST', '/auth/login', undefined, { username, password: 'demo' })).body;
const login = async (username: string) => (await session(username)).access_token as string;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  server = createOpsServer({ jwtSecret: SECRET, demoPassword: 'demo', demoMode: true, telemetryHz: 5 });
  const port = await server.start(0, '127.0.0.1');
  base = `http://127.0.0.1:${port}`;
});
afterAll(async () => { await server.stop(); });

describe('config & auth', () => {
  it('publishes branch and map configuration without auth, Mazar-i-Sharif by default', async () => {
    const r = await call('GET', '/config');
    expect(r.status).toBe(200);
    expect(r.body.default_branch).toBe('MZR');
    expect(r.body.languages).toEqual(['dr', 'ps', 'en']);
    const mzr = r.body.branches.find((b: any) => b.id === 'MZR');
    expect(mzr.center.lat).toBeCloseTo(36.709, 2);
    expect(mzr.center.lon).toBeCloseTo(67.111, 2);
    const [w, s, e, n] = mzr.bbox;
    expect(w).toBeLessThan(mzr.center.lon); expect(e).toBeGreaterThan(mzr.center.lon);
    expect(s).toBeLessThan(mzr.center.lat); expect(n).toBeGreaterThan(mzr.center.lat);
    expect(r.body.map.style_url).toMatch(/^https:\/\//);
  });

  it('rejects bad credentials, inactive users and unauthenticated calls', async () => {
    expect((await call('POST', '/auth/login', undefined, { username: 'maryam', password: 'nope' })).status).toBe(401);
    expect((await call('POST', '/auth/login', undefined, { username: 'test', password: 'demo' })).status).toBe(401);
    expect((await call('GET', '/monitoring/alerts')).status).toBe(401);
  });

  it('issues a JWT carrying role, active branch and readable branches', async () => {
    const r = await session('reza');
    expect(r.role).toBe('analyst');
    expect(r.branch).toBe('MZR');
    expect(r.user.name).toEqual({ dr: 'رضا رحیمی', ps: 'رضا رحیمي', en: 'Reza Rahimi' });
    const me = await call('GET', '/auth/me', r.access_token);
    expect(me.body.claims).toMatchObject({ role: 'analyst', branch: 'MZR', branches: ['MZR'] });
  });

  it('enforces permissions per role', async () => {
    const op = await login('maryam');
    expect((await call('POST', '/security/escort-plan/ESC-0415/approve', op)).status).toBe(403);
    expect((await call('POST', '/v1/locations/analyze', op, { lat: 36.71, lon: 67.11 })).status).toBe(403);
    expect((await call('POST', '/advanced-security/scan', op)).status).toBe(403);
  });

  it('switches role within the active branch in demo mode', async () => {
    const r = await call('POST', '/auth/switch-role', await login('maryam'), { role: 'commander' });
    expect(r.body.role).toBe('commander');
    expect(r.body.user.username).toBe('ahmadi');
  });

  it('stores the language preference server-side and returns it at the next login', async () => {
    const token = await login('farida');
    expect((await call('PATCH', '/auth/me/preferences', token, { lang: 'fa' })).status).toBe(400);
    const r = await call('PATCH', '/auth/me/preferences', token, { lang: 'ps' });
    expect(r.body.user.prefs.lang).toBe('ps');
    expect((await session('farida')).user.prefs.lang).toBe('ps');
    await call('PATCH', '/auth/me/preferences', token, { lang: 'en' });
    expect((await session('farida')).user.prefs.lang).toBe('en');
  });

  it('refreshes tokens with fresh branch claims', async () => {
    const s = await session('ali');
    const r = await call('POST', '/auth/refresh', undefined, { refresh_token: s.refresh_token, branch: 'KBL' });
    expect(r.status).toBe(200);
    expect(r.body.branch).toBe('KBL');
    expect(r.body.role).toBe('planner');
    expect((await call('POST', '/auth/refresh', undefined, { refresh_token: s.refresh_token })).status).toBe(401);
  });
});

describe('branches: isolation, regional access, switching', () => {
  it('keeps branch data separate', async () => {
    const mzr = (await call('GET', '/communication/devices', await login('maryam'))).body.devices;
    const kbl = (await call('GET', '/communication/devices', await login('farida'))).body.devices;
    expect(mzr.length).toBeGreaterThan(0);
    const mzrRelay = mzr.find((d: any) => d.id === 'REL-01'), kblRelay = kbl.find((d: any) => d.id === 'REL-01');
    expect(mzrRelay.geo.lat).toBeCloseTo(36.7, 0);
    expect(kblRelay.geo.lat).toBeCloseTo(34.5, 0);
  });

  it('denies other branches to branch-scoped users (403) and unknown branches (404)', async () => {
    const op = await login('maryam');
    expect((await call('GET', '/monitoring/alerts', op, undefined, { 'x-branch': 'KBL' })).status).toBe(403);
    expect((await call('GET', '/monitoring/alerts?branch=HRT', op)).status).toBe(403);
    expect((await call('GET', '/monitoring/alerts', op, undefined, { 'x-branch': 'XXX' })).status).toBe(404);
    expect((await call('POST', '/auth/switch-branch', op, { branch: 'KBL' })).status).toBe(403);
  });

  it('gives regional staff read-only access to other branches', async () => {
    const cmd = await login('ahmadi');
    const alerts = await call('GET', '/monitoring/alerts', cmd, undefined, { 'x-branch': 'KBL' });
    expect(alerts.status).toBe(200);
    expect(alerts.body.alerts.every((a: any) => a.branch === 'KBL')).toBe(true);
    expect((await call('POST', '/monitoring/alerts', cmd, { level: 'info', title: 'x' }, { 'x-branch': 'KBL' })).status).toBe(403);
    const list = (await call('GET', '/branches', cmd)).body.branches;
    expect(list.map((b: any) => b.id)).toEqual(['MZR', 'KBL', 'HRT']);
  });

  it('lets a multi-branch member act in another branch after switching', async () => {
    const ali = await login('ali');
    const sw = await call('POST', '/auth/switch-branch', ali, { branch: 'KBL' });
    expect(sw.status).toBe(200);
    expect(sw.body).toMatchObject({ branch: 'KBL', role: 'planner' });
    const plans = await call('GET', '/security/escort-plans', sw.body.access_token);
    expect(plans.body.plans[0].origin.name.en).toBe('Kabul HQ');
  });
});

describe('risk & blind spots', () => {
  it('serves an H3 risk grid clipped to the city with ranked dangerous and safest sites', async () => {
    const an = await login('reza');
    const grid = (await call('GET', '/v1/risk/grid', an)).body;
    expect(grid.cells.length).toBeGreaterThan(300);
    expect(grid.cells.some((c: any) => c.level === 'critical')).toBe(true);
    const ex = (await call('GET', '/v1/risk/extremes?n=5', an)).body;
    expect(ex.dangerous).toHaveLength(5);
    expect(ex.safest).toHaveLength(5);
    expect(ex.dangerous[0].score).toBeGreaterThan(ex.safest[0].score);
    expect(ex.dangerous[0].level).toBe('critical');
    for (let i = 1; i < 5; i++) expect(ex.dangerous[i].score).toBeLessThanOrEqual(ex.dangerous[i - 1].score);
  });

  it('reports blind spots with type, area, polygon and mitigation in three languages', async () => {
    const r = (await call('GET', '/v1/blindspots', await login('reza'))).body;
    expect(r.zones.length).toBeGreaterThan(0);
    const types = new Set(r.zones.map((z: any) => z.type));
    expect(types.has('network') || types.has('monitoring')).toBe(true);
    const z = r.zones[0];
    expect(z.area_km2).toBeGreaterThan(0);
    expect(z.polygon[0][0].length).toBeGreaterThan(3);
    expect(Object.keys(z.mitigation)).toEqual(['dr', 'ps', 'en']);
    const detail = await call('GET', `/v1/blindspots/${z.id}`, await login('reza'));
    expect(detail.body.cells.length).toBe(z.cell_count);
  });

  it('detects a new network blind spot and raises an alert when a relay goes offline', async () => {
    const tech = await login('sara');
    const r = await call('POST', '/communication/command/REL-04', tech, { command: 'dev.cmd.power' });
    expect(r.body.device.state).toBe('off');
    await wait(600);
    const alerts = (await call('GET', '/monitoring/alerts', tech)).body.alerts;
    expect(alerts.some((a: any) => a.title.en === 'Relay REL-04 went offline')).toBe(true);
    expect(alerts.some((a: any) => a.source === 'blindspot' && a.title.en.startsWith('New blind spot'))).toBe(true);
    await call('POST', '/communication/command/REL-04', tech, { command: 'dev.cmd.power' });
  });

  it('analyzes an area around the city centre', async () => {
    const an = await login('reza');
    const r = await call('POST', '/v1/locations/analyze', an, { lat: 36.709, lon: 67.111, radius_m: 3000 });
    expect(r.status).toBe(200);
    expect(r.body.cells.count).toBeGreaterThan(10);
    expect(r.body.resources.length).toBeGreaterThan(0);
    const confirm = await call('POST', '/threat/analyze', an, { detection_id: 't2', decision: 'confirm' });
    expect(confirm.body.status).toBe('confirmed');
    const incidents = (await call('GET', '/v1/incidents', an)).body.incidents;
    expect(incidents.some((i: any) => i.evidence.includes('detection:t2'))).toBe(true);
    expect((await call('POST', '/threat/analyze', an, { detection_id: 't2', decision: 'reject' })).status).toBe(409);
  });
});

describe('escort planning', () => {
  it('computes PACE routes on the road network with segments, stops and alerts', async () => {
    const plans = (await call('GET', '/security/escort-plans', await login('ali'))).body.plans;
    const running = plans.find((p: any) => p.id === 'ESC-0412');
    expect(running.pace.map((r: any) => r.k)).toEqual(['P', 'A', 'C', 'E']);
    for (const r of running.pace) {
      expect(r.distance_m).toBeGreaterThan(500);
      expect(r.eta_min).toBeGreaterThan(0);
      expect(r.checkpoints.at(-1).id).toBe('DEST');
      expect(Math.abs(r.segments.reduce((s: number, x: any) => s + x.length_m, 0) - r.distance_m)).toBeLessThan(10);
    }
    const p = running.pace[0];
    expect(p.max_risk).toBeLessThan(0.6);
    expect(p.path[0].lat).toBeCloseTo(running.origin.lat, 2);
  });

  it('creates a plan between facilities, edits a route and requires re-approval', async () => {
    const planner = await login('ali');
    const geo = (await call('GET', '/branches/MZR/geo', planner)).body;
    const police = geo.pois.filter((p: any) => p.kind === 'police');
    const created = await call('POST', '/security/escort-plan', planner, { origin: { poi: police[0].id }, destination: { poi: police[2].id }, vip_level: 4, priority: 'security' });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('draft');
    expect(created.body.title.en).toContain('→');
    const id = created.body.id;
    const approved = await call('POST', `/security/escort-plan/${id}/approve`, await login('ahmadi'));
    expect(approved.body.status).toBe('approved');
    expect(approved.body.approved_by).toBe('ahmadi');

    const before = approved.body.pace.find((r: any) => r.k === 'A');
    const mid = before.path[Math.floor(before.path.length / 2)];
    const wp = { lat: mid.lat + 0.004, lon: mid.lon + 0.004 };
    const edited = await call('PUT', `/security/escort-plan/${id}/routes/A`, planner, { waypoints: [wp] });
    expect(edited.status).toBe(200);
    expect(edited.body.status).toBe('pending_approval');
    expect(edited.body.routes.A).toMatchObject({ edited: true, version: 2, edited_by: 'ali' });
    const after = edited.body.pace.find((r: any) => r.k === 'A');
    expect(after.waypoints).toHaveLength(1);
    const nearest = Math.min(...after.path.map((p: any) => Math.hypot(p.lat - wp.lat, p.lon - wp.lon)));
    expect(nearest).toBeLessThan(0.004);
    expect(edited.body.validation.some((v: any) => v.text.en.includes('edited manually'))).toBe(true);
    expect((await call('PUT', `/security/escort-plan/${id}/routes/Z`, planner, { waypoints: [] })).status).toBe(400);
    expect((await call('PUT', `/security/escort-plan/${id}/routes/A`, planner, { waypoints: [{ lat: 999, lon: 0 }] })).status).toBe(400);
  });

  it('previews routes without saving and rejects points outside the branch', async () => {
    const planner = await login('ali');
    const cfg = (await call('GET', '/config')).body.branches[0];
    const r = await call('POST', '/security/route-preview', planner, { origin: { lat: cfg.center.lat, lon: cfg.center.lon }, destination: { lat: cfg.center.lat + 0.02, lon: cfg.center.lon + 0.03 } });
    expect(r.status).toBe(200);
    expect(r.body.pace.length).toBeGreaterThanOrEqual(3);
    expect((await call('POST', '/security/route-preview', planner, { origin: { lat: 34.5, lon: 69.17 }, destination: { lat: cfg.center.lat, lon: cfg.center.lon } })).status).toBe(400);
  });
});

describe('operations', () => {
  it('serves fused telemetry for every unit, alpha driving the active route', async () => {
    await wait(1200);
    const r = await call('GET', '/v1/telemetry/latest', await login('maryam'));
    expect(r.body.units.map((u: any) => u.id)).toEqual(['alpha', 'drone', 'bravo', 'charlie']);
    const alpha = r.body.units[0].telemetry;
    expect(alpha.cep95_m).toBeGreaterThan(0);
    expect(alpha.cep95_m).toBeLessThan(20);
    expect(alpha.fusion.map((f: any) => f.source)).toEqual(['GNSS', 'Wi-Fi', 'BLE']);
    expect(alpha.route).toBe('P');
    expect(Math.abs(alpha.lat - 36.709)).toBeLessThan(0.1);
  });

  it('runs the alert lifecycle and rejects invalid transitions with 409', async () => {
    const op = await login('maryam');
    const created = await call('POST', '/monitoring/alerts', op, { level: 'warning', title: 'test alert' });
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect(id).toMatch(/^MZR-A\d{4}$/);
    expect((await call('POST', `/monitoring/alerts/${id}/resolve`, op)).status).toBe(409);
    expect((await call('POST', `/monitoring/alerts/${id}/acknowledge`, op)).body.status).toBe('acknowledged');
    expect((await call('POST', `/monitoring/alerts/${id}/resolve`, op)).body.status).toBe('resolved');
  });

  it('validates device commands by key', async () => {
    const op = await login('maryam');
    expect((await call('POST', '/communication/command/D-02', op, { command: 'dev.cmd.rth' })).body.device.state).toBe('idle');
    expect((await call('POST', '/communication/command/IOT-12', op, { command: 'dev.cmd.restart' })).status).toBe(409);
    expect((await call('POST', '/communication/command/CAM-01', op, { command: 'dev.cmd.rth' })).status).toBe(409);
  });

  it('verifies the audit hash chain in a security scan', async () => {
    const r = await call('POST', '/advanced-security/scan', await login('sara'));
    expect(r.body.audit.valid).toBe(true);
    expect(r.body.audit.entries).toBeGreaterThan(0);
  });
});

describe('inter-branch sync', () => {
  it('replicates a critical Kabul alert to headquarters and later state changes too', async () => {
    const kbl = await login('farida');
    const a = (await call('POST', '/monitoring/alerts', kbl, { level: 'critical', title: 'KBL convoy contact' })).body;
    await wait(100);
    const hq = await login('ahmadi');
    const replica = (await call('GET', '/monitoring/alerts', hq)).body.alerts.find((x: any) => x.id === a.id);
    expect(replica).toBeDefined();
    expect(replica).toMatchObject({ source: 'sync', origin_branch: 'KBL', branch: 'MZR' });
    expect(replica.title.en).toBe('Synced from Kabul: KBL convoy contact');
    await call('POST', `/monitoring/alerts/${a.id}/acknowledge`, kbl);
    await wait(100);
    expect((await call('GET', '/monitoring/alerts', hq)).body.alerts.find((x: any) => x.id === a.id).status).toBe('acknowledged');
  });

  it('queues while a link is down and drains on reconnection', async () => {
    const tech = await login('sara');
    expect((await call('POST', '/sync/link', tech, { branch: 'HRT', up: false })).body.link).toBe('down');
    const hrt = await login('wahidi');
    const a = (await call('POST', '/monitoring/alerts', hrt, { level: 'critical', title: 'HRT outage test' })).body;
    const hq = await login('ahmadi');
    expect((await call('GET', '/monitoring/alerts', hq)).body.alerts.some((x: any) => x.id === a.id)).toBe(false);
    const st = (await call('GET', '/sync/status', hq)).body.status.find((s: any) => s.branch === 'HRT');
    expect(st.outbox).toBeGreaterThan(0);
    await call('POST', '/sync/link', tech, { branch: 'HRT', up: true });
    expect((await call('GET', '/monitoring/alerts', hq)).body.alerts.some((x: any) => x.id === a.id)).toBe(true);
    expect((await call('GET', '/sync/status', hq)).body.status.find((s: any) => s.branch === 'HRT').outbox).toBe(0);
  });

  it('broadcasts headquarters advisories to every branch; branches cannot broadcast', async () => {
    const a = (await call('POST', '/monitoring/alerts', await login('ahmadi'), { level: 'warning', title: 'Regional advisory', broadcast: true })).body;
    await wait(100);
    for (const u of ['farida', 'wahidi']) expect((await call('GET', '/monitoring/alerts', await login(u))).body.alerts.some((x: any) => x.id === a.id)).toBe(true);
    expect((await call('POST', '/monitoring/alerts', await login('farida'), { level: 'warning', title: 'x', broadcast: true })).status).toBe(400);
  });
});

describe('per-branch reports', () => {
  it('returns JSON, CSV and HTML in the requested language', async () => {
    const cmd = await login('ahmadi');
    const json = await call('GET', '/branches/MZR/reports/summary', cmd);
    expect(json.body.branch).toBe('MZR');
    expect(json.body.alerts.total).toBeGreaterThan(0);
    const csv = await call('GET', '/branches/KBL/reports/summary?format=csv&lang=ps', cmd);
    expect(csv.type).toContain('text/csv');
    expect(csv.text).toContain('د کابل څانګه');
    const html = await call('GET', '/branches/MZR/reports/summary?format=html&lang=dr', cmd);
    expect(html.text).toContain('dir="rtl"');
    expect(html.text).toContain('lang="fa-AF"');
    expect(html.text).toContain('راپور خلاصهٔ');
    const en = await call('GET', '/branches/HRT/reports/summary?format=html&lang=en', cmd);
    expect(en.text).toContain('Herat branch summary report');
    expect((await call('GET', '/branches/KBL/reports/summary', await login('maryam'))).status).toBe(403);
  });
});

describe('realtime', () => {
  it('refuses sockets without a valid token', async () => {
    const s = io(base, { auth: { token: 'bogus' }, transports: ['websocket'], reconnection: false });
    const err = await new Promise<Error>((resolve) => s.on('connect_error', resolve));
    expect(err.message).toBe('unauthorized');
    s.close();
  });

  it('streams signed branch envelopes and replays after resume', async () => {
    const token = await login('maryam');
    const s: Socket = io(base, { auth: { token }, transports: ['websocket'], reconnection: false });
    const hello = await new Promise<{ seq: number; branch: string }>((resolve) => s.on('hello', resolve));
    expect(hello.branch).toBe('MZR');
    const got: any[] = [];
    s.on('env', (e) => got.push(e));
    await wait(1300);
    expect(got.some((e) => e.channel === 'telemetry')).toBe(true);
    expect(got.every((e) => /^sha256:/.test(e.integrity) && e.branch === 'MZR')).toBe(true);
    await call('POST', '/monitoring/alerts', token, { level: 'info', title: 'replay me' });
    got.length = 0;
    s.emit('resume', { branch: 'MZR', seq: hello.seq });
    await wait(300);
    expect(got.some((e) => e.channel === 'alerts' && e.data.title === 'replay me')).toBe(true);
    s.close();
  });

  it('keeps sockets inside readable branches', async () => {
    const s: Socket = io(base, { auth: { token: await login('maryam') }, transports: ['websocket'], reconnection: false });
    await new Promise((resolve) => s.on('hello', resolve));
    const denied = await new Promise<{ ok: boolean }>((resolve) => s.emit('watch', 'KBL', resolve));
    expect(denied.ok).toBe(false);
    s.emit('subscribe', ['branch:KBL']);
    const got: any[] = [];
    s.on('env', (e) => got.push(e));
    await wait(700);
    expect(got.length).toBeGreaterThan(0);
    expect(got.every((e) => e.branch === 'MZR')).toBe(true);
    s.close();

    const r: Socket = io(base, { auth: { token: await login('ahmadi') }, transports: ['websocket'], reconnection: false });
    await new Promise((resolve) => r.on('hello', resolve));
    const ok = await new Promise<{ ok: boolean }>((resolve) => r.emit('watch', 'KBL', resolve));
    expect(ok.ok).toBe(true);
    const kbl: any[] = [];
    r.on('env', (e) => kbl.push(e));
    await wait(700);
    expect(kbl.length).toBeGreaterThan(0);
    expect(kbl.every((e) => e.branch === 'KBL')).toBe(true);
    r.close();
  });
});
