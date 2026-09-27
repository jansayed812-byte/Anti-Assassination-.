/**
 * Boots the real operations backend on a random port and drives it over HTTP and Socket.IO.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { createOpsServer } from '../../services/server/app';

const SECRET = 'integration-secret-0123456789abcdef';
let base = '';
let server: ReturnType<typeof createOpsServer>;

async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}
const login = async (username: string) => (await call('POST', '/auth/login', undefined, { username, password: 'demo' })).body.access_token as string;

beforeAll(async () => {
  server = createOpsServer({ jwtSecret: SECRET, demoPassword: 'demo', demoMode: true, telemetryHz: 5 });
  const port = await server.start(0, '127.0.0.1');
  base = `http://127.0.0.1:${port}`;
});
afterAll(async () => { await server.stop(); });

describe('ops server: auth & RBAC', () => {
  it('rejects bad credentials and unauthenticated calls', async () => {
    expect((await call('POST', '/auth/login', undefined, { username: 'maryam', password: 'nope' })).status).toBe(401);
    expect((await call('POST', '/auth/login', undefined, { username: 'test', password: 'demo' })).status).toBe(401);
    expect((await call('GET', '/monitoring/alerts')).status).toBe(401);
  });

  it('issues a JWT carrying the role', async () => {
    const r = await call('POST', '/auth/login', undefined, { username: 'reza', password: 'demo' });
    expect(r.status).toBe(200);
    expect(r.body.user.role).toBe('analyst');
    const me = await call('GET', '/auth/me', r.body.access_token);
    expect(me.body.claims.role).toBe('analyst');
  });

  it('enforces permissions per role', async () => {
    const op = await login('maryam');
    expect((await call('POST', '/security/escort-plan/ESC-0415/approve', op)).status).toBe(403);
    expect((await call('POST', '/v1/locations/analyze', op, { lat: 35.69, lon: 51.39 })).status).toBe(403);
    expect((await call('POST', '/advanced-security/scan', op)).status).toBe(403);
  });

  it('switches role in demo mode', async () => {
    const op = await login('maryam');
    const r = await call('POST', '/auth/switch-role', op, { role: 'commander' });
    expect(r.body.user.role).toBe('commander');
  });
});

describe('ops server: operations', () => {
  it('serves fused telemetry for every unit', async () => {
    await new Promise((r) => setTimeout(r, 1200));
    const r = await call('GET', '/v1/telemetry/latest', await login('maryam'));
    expect(r.body.units.map((u: { id: string }) => u.id)).toEqual(['alpha', 'drone', 'bravo', 'charlie']);
    const alpha = r.body.units[0].telemetry;
    expect(alpha.cep95_m).toBeGreaterThan(0);
    expect(alpha.cep95_m).toBeLessThan(20);
    expect(alpha.fusion.map((f: { source: string }) => f.source)).toEqual(['GNSS', 'Wi-Fi', 'BLE']);
    expect(alpha.route).toBe('P');
  });

  it('runs the alert lifecycle and rejects invalid transitions with 409', async () => {
    const op = await login('maryam');
    const created = await call('POST', '/monitoring/alerts', op, { level: 'warning', title: 'test alert' });
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect((await call('POST', `/monitoring/alerts/${id}/resolve`, op)).status).toBe(409);
    expect((await call('POST', `/monitoring/alerts/${id}/acknowledge`, op)).body.status).toBe('acknowledged');
    expect((await call('POST', `/monitoring/alerts/${id}/resolve`, op)).body.status).toBe('resolved');
  });

  it('computes PACE routes and lets only the commander approve', async () => {
    const plans = (await call('GET', '/security/escort-plans', await login('ali'))).body.plans;
    const running = plans.find((p: { id: string }) => p.id === 'ESC-0412');
    expect(running.pace.map((r: { k: string }) => r.k)).toEqual(['P', 'A', 'C', 'E']);
    for (const r of running.pace) { expect(r.km).toBeGreaterThan(0); expect(r.checkpoints.at(-1).id).toBe('DEST'); }
    const created = await call('POST', '/security/escort-plan', await login('ali'), { origin: 'A', destination: 'B', vip_level: 4, priority: 'time' });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('draft');
    const approved = await call('POST', `/security/escort-plan/${created.body.id}/approve`, await login('ahmadi'));
    expect(approved.body.status).toBe('approved');
    expect(approved.body.approved_by).toBe('سرگرد احمدی');
  });

  it('analyzes an area and folds confirmed detections into the risk model', async () => {
    const an = await login('reza');
    const before = await call('POST', '/v1/locations/analyze', an, { lat: 35.6928, lon: 51.3956, radius_m: 500 });
    expect(before.status).toBe(200);
    expect(before.body.factors).toHaveProperty('severity');
    const confirm = await call('POST', '/threat/analyze', an, { detection_id: 't2', decision: 'confirm' });
    expect(confirm.body.status).toBe('confirmed');
    const incidents = (await call('GET', '/v1/incidents', an)).body.incidents;
    expect(incidents.some((i: { evidence: string[] }) => i.evidence.includes('detection:t2'))).toBe(true);
    expect((await call('POST', '/threat/analyze', an, { detection_id: 't2', decision: 'reject' })).status).toBe(409);
  });

  it('rejects commands to offline devices and unsupported commands', async () => {
    const op = await login('maryam');
    expect((await call('POST', '/communication/command/D-01', op, { command: 'بازگشت به خانه' })).body.device.state).toBe('idle');
    expect((await call('POST', '/communication/command/IOT-12', op, { command: 'ریستارت' })).status).toBe(409);
    expect((await call('POST', '/communication/command/CAM-03', op, { command: 'بازگشت به خانه' })).status).toBe(409);
  });

  it('verifies the audit hash chain in a security scan', async () => {
    const r = await call('POST', '/advanced-security/scan', await login('sara'));
    expect(r.body.audit.valid).toBe(true);
    expect(r.body.audit.entries).toBeGreaterThan(0);
  });
});

describe('ops server: realtime', () => {
  it('refuses sockets without a valid token', async () => {
    const s = io(base, { auth: { token: 'bogus' }, transports: ['websocket'], reconnection: false });
    const err = await new Promise<Error>((resolve) => s.on('connect_error', resolve));
    expect(err.message).toBe('unauthorized');
    s.close();
  });

  it('streams signed envelopes and replays after resume', async () => {
    const token = await login('maryam');
    const s: Socket = io(base, { auth: { token }, transports: ['websocket'], reconnection: false });
    const hello = await new Promise<{ seq: number }>((resolve) => s.on('hello', resolve));
    const got: Array<{ seq: number; channel: string; integrity: string }> = [];
    s.on('env', (e) => got.push(e));
    await new Promise((r) => setTimeout(r, 1300));
    expect(got.some((e) => e.channel === 'telemetry')).toBe(true);
    expect(got.some((e) => e.channel === 'risk')).toBe(true);
    expect(got.every((e) => /^sha256:/.test(e.integrity))).toBe(true);
    await call('POST', '/monitoring/alerts', token, { level: 'info', title: 'replay me' });
    got.length = 0;
    s.emit('resume', hello.seq);
    await new Promise((r) => setTimeout(r, 300));
    expect(got.some((e) => e.channel === 'alerts' && (e as unknown as { data: { title: string } }).data.title === 'replay me')).toBe(true);
    s.close();
  });
});
