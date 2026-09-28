/**
 * Performance and stability checks with budgets (exit code 1 when a budget is missed):
 *   1. REST load    — autocannon mix of the dashboard's read endpoints; p97.5 latency < 200 ms (so p95 is too), 0 errors
 *   2. Realtime     — 100 concurrent Socket.IO clients on live telemetry; all connected, no drops, bounded server memory
 *   3. Routing      — PACE (4 risk-aware routes + analysis) on each branch's road graph and on a 25 600-node
 *                     street lattice (the size of a real OpenStreetMap city extract); p95 < 150 ms
 *   4. Bundle       — initial dashboard JavaScript ≤ 200 KB gzip (the MapLibre chunk loads lazily)
 *
 *   npm run build && npm run test:perf            # full run (REST 20 s, sockets 60 s)
 *   PERF_SMOKE=1 npm run test:perf                # CI smoke (REST 8 s, sockets 20 s)
 *
 * Results: tests/perf/results/latest.json
 */
import autocannon from 'autocannon';
import { spawn, type ChildProcess } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { gzipSync } from 'zlib';
import { io, type Socket } from 'socket.io-client';
import { createBranchContext } from '../../services/server/branch-context';
import { branchDef } from '../../services/server/geodata/branches';
import { loadScenarios } from '../../services/server/domain/sim';
import { distanceM, offset, type LatLon } from '../../services/server/geo';
import { RoadGraph } from '../../services/server/routing/graph';
import { RoutePlanner } from '../../services/server/routing/planner';
import type { RiskModel } from '../../services/server/domain/risk';
import type { BranchGeo, Road } from '../../services/server/geodata/types';

const ROOT = resolve(__dirname, '../..');
const SMOKE = process.env.PERF_SMOKE === '1';
const PORT = Number(process.env.PERF_PORT ?? 8130);
const BASE = `http://127.0.0.1:${PORT}`;
const REST_S = Number(process.env.PERF_REST_S ?? (SMOKE ? 8 : 20));
const SOCK_S = Number(process.env.PERF_SOCKET_S ?? (SMOKE ? 20 : 60));
const SOCKETS = Number(process.env.PERF_SOCKETS ?? 100);
// Latency budgets can be scaled for slower shared CI runners (the full local run uses the real budgets).
const SCALE = Number(process.env.PERF_BUDGET_SCALE ?? 1);
const BUDGET = { restP975Ms: 200 * SCALE, routingP95Ms: 150 * SCALE, initialJsGzipKb: 200, socketRssGrowthMb: 150 };

type Check = { name: string; value: number | string; budget: string; ok: boolean };
const checks: Check[] = [];
const check = (name: string, value: number | string, budget: string, ok: boolean) => { checks.push({ name, value, budget, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${value}  (budget ${budget})`); };
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rssMb = (pid: number): number | null => { try { const m = /VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8')); return m ? +(+m[1] / 1024).toFixed(1) : null; } catch { return null; } };

async function startServer(): Promise<ChildProcess> {
  // One node process (no npm/tsx wrapper) so its memory can be read directly.
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: join(ROOT, 'services'), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', JWT_SECRET: 'perf-secret-0123456789abcdef0123456789', RATE_LIMIT_RPM: '100000000', NODE_ENV: 'test' },
  });
  let log = '';
  child.stdout!.on('data', (d) => { log += d; }); child.stderr!.on('data', (d) => { log += d; });
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return child; } catch { /* not yet */ }
    await sleep(500);
  }
  child.kill();
  throw new Error(`server did not start:\n${log}`);
}

async function token(username: string): Promise<string> {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: 'demo' }) });
  return (await r.json()).access_token;
}

async function restLoad(): Promise<Record<string, unknown>> {
  const auth = { authorization: `Bearer ${await token('reza')}` };
  const result = await autocannon({
    url: BASE, connections: 50, duration: REST_S,
    requests: [
      { method: 'GET', path: '/api/config' },
      { method: 'GET', path: '/api/v1/risk/grid', headers: auth },
      { method: 'GET', path: '/api/v1/risk/extremes', headers: auth },
      { method: 'GET', path: '/api/v1/blindspots', headers: auth },
      { method: 'GET', path: '/api/security/escort-plans', headers: auth },
      { method: 'GET', path: '/api/monitoring/alerts', headers: auth },
      { method: 'GET', path: '/api/v1/telemetry/latest', headers: auth },
    ],
  });
  const errors = result.errors + result.timeouts + result.non2xx;
  const out = { duration_s: REST_S, connections: 50, requests: result.requests.total, rps: Math.round(result.requests.average), p50_ms: result.latency.p50, p90_ms: result.latency.p90, p975_ms: result.latency.p97_5, p99_ms: result.latency.p99, max_ms: result.latency.max, errors };
  check('REST p97.5 latency (ms)', out.p975_ms, `< ${BUDGET.restP975Ms}`, out.p975_ms < BUDGET.restP975Ms);
  check('REST errors / non-2xx / timeouts', errors, '= 0', errors === 0);
  return out;
}

async function socketSoak(server: ChildProcess): Promise<Record<string, unknown>> {
  const users = ['maryam', 'reza', 'ahmadi', 'ali', 'farida', 'karimi', 'sultani', 'wahidi', 'sara', 'admin'];
  const tokens = await Promise.all(users.map(token));
  const rss0 = rssMb(server.pid!);
  const clients: Socket[] = [];
  const received = new Array(SOCKETS).fill(0);
  let disconnects = 0, connectErrors = 0;
  await Promise.all(Array.from({ length: SOCKETS }, (_, i) => new Promise<void>((done) => {
    const s = io(BASE, { auth: { token: tokens[i % tokens.length] }, transports: ['websocket'], reconnection: false, forceNew: true });
    clients.push(s);
    s.on('env', () => { received[i]++; });
    s.on('disconnect', (reason) => { if (reason !== 'io client disconnect') disconnects++; });
    s.on('connect_error', () => { connectErrors++; done(); });
    s.on('hello', () => done());
  })));
  const connected = clients.filter((c) => c.connected).length;
  const samples: number[] = [];
  for (let t = 0; t < SOCK_S; t += 5) { await sleep(5000); const r = rssMb(server.pid!); if (r != null) samples.push(r); }
  const rss1 = rssMb(server.pid!);
  for (const c of clients) c.disconnect();
  const perClient = received.map((n) => n / SOCK_S);
  const out = {
    clients: SOCKETS, connected, connect_errors: connectErrors, unexpected_disconnects: disconnects, duration_s: SOCK_S,
    msgs_per_client_per_s_min: +Math.min(...perClient).toFixed(2), msgs_per_client_per_s_avg: +(perClient.reduce((a, b) => a + b, 0) / SOCKETS).toFixed(2),
    server_rss_start_mb: rss0, server_rss_end_mb: rss1, server_rss_peak_mb: samples.length ? Math.max(...samples) : null,
  };
  check('Socket.IO clients connected', `${connected}/${SOCKETS}`, `${SOCKETS}/${SOCKETS}`, connected === SOCKETS && connectErrors === 0);
  check('Socket.IO unexpected disconnects', disconnects, '= 0', disconnects === 0);
  check('Socket.IO every client receives live updates (msg/s, slowest client)', out.msgs_per_client_per_s_min, '> 0.5', out.msgs_per_client_per_s_min > 0.5);
  if (rss0 != null && out.server_rss_peak_mb != null) {
    const growth = +(out.server_rss_peak_mb - rss0).toFixed(1);
    check('Server RSS growth under 100 sockets (MB)', growth, `< ${BUDGET.socketRssGrowthMb}`, growth < BUDGET.socketRssGrowthMb);
  }
  return out;
}

function routingBench(): Record<string, unknown> {
  const scenarios = loadScenarios(join(ROOT, 'services/simulation/scenarios'));
  const out: Record<string, unknown> = {};
  for (const id of ['MZR', 'KBL', 'HRT']) {
    const ctx = createBranchContext(branchDef(id)!, { dataDir: join(ROOT, 'services/data/osm'), scenarios });
    ctx.blind.recompute();
    const pois = ctx.geo.pois.filter((p) => p.kind !== 'safe_house');
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const times: number[] = [];
    let routes = 0;
    for (let i = 0; i < (SMOKE ? 20 : 50) + 3; i++) {
      const a = pois[Math.floor(rnd() * pois.length)], b = pois[Math.floor(rnd() * pois.length)];
      if (a === b) continue;
      const t0 = performance.now();
      routes += ctx.planner.pace(a, b).length;
      if (i >= 3) times.push(performance.now() - t0); // first calls warm the risk cache
    }
    ctx.stop();
    const r = { plans: times.length, routes, graph_nodes: ctx.graph.nodes.length, graph_edges: ctx.graph.edges.length, p50_ms: +pct(times, 50).toFixed(1), p95_ms: +pct(times, 95).toFixed(1), max_ms: +Math.max(...times).toFixed(1) };
    out[id] = r;
    check(`PACE planning p95, ${id} (ms)`, r.p95_ms, `< ${BUDGET.routingP95Ms}`, r.p95_ms < BUDGET.routingP95Ms);
  }
  return out;
}

/** PACE on a 160 × 160 street lattice (80 m blocks, ≈ 12.8 km across) with a 1.2 km danger zone in the middle. */
function osmScaleBench(): Record<string, unknown> {
  const N = 160, STEP = 80, O = offset(branchDef('MZR')!.center, -6400, -6400);
  const at = (i: number, j: number) => offset(O, i * STEP, j * STEP);
  const ll = (p: LatLon): [number, number] => [p.lon, p.lat];
  const roads: Road[] = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N - 1; i++) roads.push({ id: `h${i}-${j}`, cls: j % 10 === 0 ? 'primary' : 'residential', oneway: false, coords: [ll(at(i, j)), ll(at(i + 1, j))] });
  for (let i = 0; i < N; i++) for (let j = 0; j < N - 1; j++) roads.push({ id: `v${i}-${j}`, cls: i % 10 === 0 ? 'secondary' : 'residential', oneway: false, coords: [ll(at(i, j)), ll(at(i, j + 1))] });
  const t0 = performance.now();
  const graph = new RoadGraph(roads);
  const buildMs = performance.now() - t0;
  const danger = at(80, 80);
  const risk = { version: 1, scoreAt: (p: LatLon) => (distanceM(p, danger) < 1200 ? 0.7 : 0.03) } as unknown as RiskModel;
  const pois = [1, 2, 3, 4, 5, 6].map((k) => { const p = at(20 * k, 150 - 20 * k); return { id: `SH${k}`, kind: 'safe_house' as const, name: { dr: '', ps: '', en: '' }, lat: p.lat, lon: p.lon, synthetic: true }; });
  const planner = new RoutePlanner(graph, risk, { pois } as unknown as BranchGeo, () => ({ network: new Set(), monitoring: new Set(), zoneOf: () => undefined }), () => '');
  const times: number[] = [];
  for (let k = 0; k < (SMOKE ? 8 : 20) + 2; k++) {
    const a = at(5 + (k % 12) * 3, 10 + k), b = at(150 - (k % 12) * 2, 140 - (k % 15) * 3);
    const t = performance.now();
    planner.pace(a, b);
    if (k >= 2) times.push(performance.now() - t);
  }
  const r = { graph_nodes: graph.nodes.length, graph_edges: graph.edges.length, build_ms: Math.round(buildMs), plans: times.length, p50_ms: +pct(times, 50).toFixed(1), p95_ms: +pct(times, 95).toFixed(1), max_ms: +Math.max(...times).toFixed(1) };
  check('PACE planning p95, 25 600-node city lattice (ms)', r.p95_ms, `< ${BUDGET.routingP95Ms}`, r.p95_ms < BUDGET.routingP95Ms);
  return r;
}

function bundleBudget(): Record<string, unknown> {
  const dist = join(ROOT, 'dashboard/dist');
  if (!existsSync(join(dist, 'index.html'))) { check('Dashboard built', 'missing dashboard/dist', 'run npm run build', false); return {}; }
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const initial = [...html.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"|<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)].map((m) => m[1] ?? m[2]);
  const css = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) => m[1]);
  const gz = (p: string) => gzipSync(readFileSync(join(dist, p.replace(/^\//, '')))).length / 1024;
  const files = initial.map((p) => ({ file: p, gzip_kb: +gz(p).toFixed(1) }));
  const total = +files.reduce((s, f) => s + f.gzip_kb, 0).toFixed(1);
  const lazyMap = readdirSafe(join(dist, 'assets')).filter((f) => /^MapView-.*\.js$/.test(f)).map((f) => ({ file: f, gzip_kb: +gz(`assets/${f}`).toFixed(1) }));
  check('Initial JS (gzip KB)', total, `≤ ${BUDGET.initialJsGzipKb}`, total <= BUDGET.initialJsGzipKb);
  check('Map chunk is lazy (not in initial HTML)', initial.some((p) => /MapView/.test(p)) ? 'eager' : 'lazy', 'lazy', !initial.some((p) => /MapView/.test(p)));
  return { initial: files, initial_js_gzip_kb: total, css: css.map((p) => ({ file: p, gzip_kb: +gz(p).toFixed(1) })), lazy_map_chunk: lazyMap };
}
function readdirSafe(dir: string): string[] { try { return require('fs').readdirSync(dir); } catch { return []; } }

(async () => {
  const started = Date.now();
  const results: Record<string, unknown> = { mode: SMOKE ? 'smoke' : 'full', budget_scale: SCALE, node: process.version, platform: `${process.platform} ${process.arch}`, cpus: require('os').cpus().length, started_at: new Date(started).toISOString() };
  console.log(`\n== bundle`); results.bundle = bundleBudget();
  console.log(`\n== routing`); results.routing = routingBench(); results.routing_osm_scale = osmScaleBench();
  console.log(`\n== server`);
  const server = await startServer();
  try {
    console.log(`\n== REST load (${REST_S} s)`); results.rest = await restLoad();
    console.log(`\n== ${SOCKETS} sockets (${SOCK_S} s)`); results.sockets = await socketSoak(server);
  } finally { server.kill(); }
  results.checks = checks;
  results.duration_s = Math.round((Date.now() - started) / 1000);
  const dir = join(ROOT, 'tests/perf/results');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'latest.json'), JSON.stringify(results, null, 2));
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed — tests/perf/results/latest.json`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
