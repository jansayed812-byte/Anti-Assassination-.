/**
 * Every console action goes through here: call the API, reconcile the store, report the outcome in the
 * user's language.
 */
import { ApiError, endpoint, get, mutate, send, upload } from '../api/client';
import type {
  Alert, AppConfig, AreaAnalysis, BlindSpot, BranchGeo, BranchSummary, Detection, Device, Incident, LatLon, PaceKey, Person, Place,
  Plan, RankedSite, Resource, RiskCell, Role, Scenario, Session, SimStatus, SyncStatus, Unit,
} from '../api/types';
import { useOps } from '../stores/ops';
import { usePrefs, type Theme } from '../stores/prefs';
import { useSession } from '../stores/session';
import { connectStream, disconnectStream } from '../realtime/streams';
import { pick, translate, type Lang, type TKey } from '../i18n';

const lang = () => usePrefs.getState().lang;
const t = (key: TKey, vars?: Record<string, string | number>) => translate(lang(), key, vars);
const toast = (key: TKey, api?: string, vars?: Record<string, string | number>) => useOps.getState().showToast(t(key, vars), api);

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'network') return t('err.network');
    const key = `err.code.${e.code}` as TKey;
    if (e.code && translate('en', key) !== key) return t(key);
    if (e.status === 403) return t('err.forbidden');
  }
  return t('err.generic', { m: e instanceof Error ? e.message : String(e) });
}

function fail(e: unknown): void { useOps.getState().showToast(errorText(e), undefined, 'error'); }

/** Runs a mutation; `onOk` gets the response, or is skipped (with a "queued" toast) when offline. */
async function act<T>(method: 'POST' | 'PATCH' | 'PUT', path: string, body: unknown, onOk: (r: T) => void): Promise<boolean> {
  try {
    const r = await mutate<T>(method, path, body);
    if (r === null) { useOps.getState().showToast(t('off.queued'), endpoint(method, path)); return false; }
    onOk(r);
    return true;
  } catch (e) { fail(e); return false; }
}

// --- session, branch, preferences
export async function loadConfig(): Promise<AppConfig | null> {
  try { const c = await get<AppConfig>('/config'); useOps.getState().set({ config: c }); return c; } catch { return null; }
}

function adoptSession(s: Session): void {
  useSession.getState().setSession(s);
  const prefs = usePrefs.getState();
  if (prefs.touched && s.user.prefs.lang !== prefs.lang) void send('PATCH', '/auth/me/preferences', { lang: prefs.lang }).catch(() => undefined);
  else if (s.user.prefs.lang !== prefs.lang) prefs.setLang(s.user.prefs.lang);
  if (s.user.prefs.theme && s.user.prefs.theme !== prefs.theme) prefs.setTheme(s.user.prefs.theme);
}

export async function login(username: string, password: string): Promise<void> {
  const s = await send<Session>('POST', '/auth/login', { username, password });
  adoptSession(s);
}

export function logout(): void {
  disconnectStream();
  useSession.getState().setSession(null);
  useOps.getState().reset();
}

export async function setLanguage(l: Lang): Promise<void> {
  const signedIn = !!useSession.getState().session;
  usePrefs.getState().setLang(l, !signedIn);
  if (signedIn) { try { await send('PATCH', '/auth/me/preferences', { lang: l }); } catch { /* kept locally; retried at next login */ } }
}

export async function setTheme(theme: Theme): Promise<void> {
  usePrefs.getState().setTheme(theme);
  if (useSession.getState().session) { try { await send('PATCH', '/auth/me/preferences', { theme }); } catch { /* local only */ } }
}

export async function bootstrap(token: string): Promise<void> {
  const s = useOps.getState();
  const branch = useSession.getState().branch!;
  try {
    const [cfg, br, geo, tl, al, grid, ex, bs, pl, sc, dv, dt, rs, inc, pp, sy] = await Promise.all([
      s.config ? Promise.resolve(s.config) : get<AppConfig>('/config'),
      get<{ branches: BranchSummary[] }>('/branches'), get<BranchGeo>(`/branches/${branch}/geo`),
      get<{ units: Unit[] }>('/v1/telemetry/latest'), get<{ alerts: Alert[]; server_time: number }>('/monitoring/alerts'),
      get<{ cells: RiskCell[]; version: number }>('/v1/risk/grid'), get<{ dangerous: RankedSite[]; safest: RankedSite[] }>('/v1/risk/extremes?n=10'),
      get<{ zones: BlindSpot[] }>('/v1/blindspots'), get<{ plans: Plan[] }>('/security/escort-plans'),
      get<{ scenarios: Scenario[]; status: SimStatus }>('/v1/scenarios'), get<{ devices: Device[] }>('/communication/devices'),
      get<{ detections: Detection[] }>('/threat/detections'), get<{ resources: Resource[] }>('/v1/resources'),
      get<{ incidents: Incident[] }>('/v1/incidents'), get<{ people: Person[] }>('/auth/people'), get<{ status: SyncStatus[] }>('/sync/status'),
    ]);
    const running = pl.plans.find((p) => p.status === 'running');
    s.set({
      config: cfg, branches: br.branches, geo, people: Object.fromEntries(pp.people.map((p) => [p.username, p])),
      units: Object.fromEntries(tl.units.map((u) => [u.id, u])), unitOrder: tl.units.map((u) => u.id), alerts: al.alerts,
      clockOffset: al.server_time - Date.now(), cells: grid.cells, riskVersion: grid.version, incidents: inc.incidents, extremes: ex,
      blindspots: bs.zones, plans: pl.plans, planSel: running?.id ?? pl.plans[0]?.id ?? '', scenarios: sc.scenarios, sim: sc.status,
      devices: dv.devices, detections: dt.detections, resources: rs.resources, sync: sy.status, loaded: true,
      aLoc: `${cfg.branches.find((b) => b.id === branch)?.center.lat.toFixed(5)}, ${cfg.branches.find((b) => b.id === branch)?.center.lon.toFixed(5)}`,
    });
    connectStream(token);
  } catch (e) { fail(e); }
}

/** Switch the active branch: new token for that branch (role there, or read-only for regional staff). */
export async function switchBranch(id: string): Promise<void> {
  try {
    const s = await send<Session>('POST', '/auth/switch-branch', { branch: id });
    disconnectStream();
    useSession.getState().setSession(s);
    const ops = useOps.getState();
    ops.resetBranch();
    await bootstrap(s.access_token);
    const b = useOps.getState().config?.branches.find((x) => x.id === id);
    if (b) useOps.getState().showToast(t('branch.switched', { name: pick(b.name, lang()) }), endpoint('POST', '/auth/switch-branch'));
  } catch (e) { fail(e); }
}

export async function switchRole(role: Role): Promise<void> {
  try {
    const r = await send<Session>('POST', '/auth/switch-role', { role });
    disconnectStream();
    useSession.getState().setSession(r);
    connectStream(r.access_token);
  } catch (e) { fail(e); }
}

// --- risk & blind spots (pulled on change notifications)
export async function refreshRisk(): Promise<void> {
  try {
    const [ex, grid] = await Promise.all([get<{ dangerous: RankedSite[]; safest: RankedSite[] }>('/v1/risk/extremes?n=10'), get<{ cells: RiskCell[]; version: number; incidents: Incident[] }>('/v1/risk/grid')]);
    useOps.getState().set({ extremes: ex, cells: grid.cells, riskVersion: grid.version, incidents: grid.incidents });
  } catch { /* next heartbeat */ }
}

export async function loadZone(id: string): Promise<BlindSpot | null> {
  try { return await get<BlindSpot>(`/v1/blindspots/${id}`); } catch (e) { fail(e); return null; }
}

// --- alerts
export const acknowledge = (a: Alert) => act<Alert>('POST', `/monitoring/alerts/${a.id}/acknowledge`, undefined, (r) => { useOps.getState().upsertAlert(r); toast('alert.acked', endpoint('POST', `/monitoring/alerts/${a.id}/acknowledge`)); });
export const resolve = (a: Alert) => act<Alert>('POST', `/monitoring/alerts/${a.id}/resolve`, undefined, (r) => { useOps.getState().upsertAlert(r); toast('alert.resolved', endpoint('POST', `/monitoring/alerts/${a.id}/resolve`)); });
export const escalate = (a: Alert) => act<Alert>('POST', `/monitoring/alerts/${a.id}/escalate`, undefined, (r) => { useOps.getState().upsertAlert(r); toast('alert.escalatedToast', endpoint('POST', `/monitoring/alerts/${a.id}/escalate`)); });
export const reportIncident = (unitName: string, unitId: string) =>
  act<Alert>('POST', '/monitoring/alerts', { level: 'warning', title: t('alert.report', { unit: unitName }), src: t('alert.reportSrc'), unit: unitId }, (r) => { useOps.getState().upsertAlert(r); toast('act.reported', endpoint('POST', '/monitoring/alerts')); });
export const panic = () => act<{ alert: Alert; plan: Plan | null }>('POST', '/monitoring/panic', undefined, (r) => {
  const s = useOps.getState();
  s.upsertAlert(r.alert);
  if (r.plan) s.upsertPlan(r.plan);
  s.set({ panicOpen: false, sel: 'alpha' });
  toast('panic.sent', endpoint('POST', '/monitoring/panic'));
});

// --- routes & plans
export const setActiveRoute = (planId: string, k: PaceKey, name: string) =>
  act<Plan>('PATCH', `/security/escort-plan/${planId}`, { active_route: k }, (r) => { useOps.getState().upsertPlan(r); toast('route.set', endpoint('PATCH', `/security/escort-plan/${planId}`), { name }); });

const placeBody = (p: Place) => (p as Place & { poi?: string }).poi ? { poi: (p as Place & { poi?: string }).poi } : { lat: p.lat, lon: p.lon, ...(typeof p.name === 'string' ? { name: p.name } : {}) };

export async function createPlan(): Promise<void> {
  const s = useOps.getState();
  const d = s.draft;
  if (!d.origin || !d.destination) { s.showToast(t('pl.needBoth'), undefined, 'error'); return; }
  await act<Plan>('POST', '/security/escort-plan', { origin: placeBody(d.origin), destination: placeBody(d.destination), vip_level: d.vip_level, priority: d.priority, ...(d.start.trim() ? { start: d.start.trim() } : {}) }, (r) => {
    const st = useOps.getState();
    st.upsertPlan(r);
    st.set({ planSel: r.id, routeSel: r.active_route, newPlan: false, picking: null, draft: { origin: null, destination: null, vip_level: 3, priority: 'security', start: '' } });
    toast('pl.computed', endpoint('POST', '/security/escort-plan'), { id: r.id });
  });
}

/** Replace route k's waypoints (manual editing). The previous list goes on the undo stack. */
export async function editRoute(plan: Plan, k: PaceKey, waypoints: LatLon[], pushUndo = true): Promise<void> {
  const prev = plan.routes[k]?.waypoints ?? [];
  const ok = await act<Plan>('PUT', `/security/escort-plan/${plan.id}/routes/${k}`, { waypoints }, (r) => {
    const s = useOps.getState();
    s.upsertPlan(r);
    if (pushUndo) s.set({ undo: [...s.undo, prev].slice(-20) });
    toast('pl.edited', endpoint('PUT', `/security/escort-plan/${plan.id}/routes/${k}`), { k, v: r.routes[k].version });
  });
  if (!ok) useOps.getState().upsertPlan({ ...plan });
}

export async function undoEdit(plan: Plan, k: PaceKey): Promise<void> {
  const s = useOps.getState();
  const prev = s.undo[s.undo.length - 1];
  if (!prev) return;
  s.set({ undo: s.undo.slice(0, -1) });
  await editRoute(plan, k, prev, false);
}

export const submitPlan = (id: string) => act<Plan>('POST', `/security/escort-plan/${id}/submit`, undefined, (r) => { useOps.getState().upsertPlan(r); toast('pl.submitted', endpoint('POST', `/security/escort-plan/${id}/submit`)); });
export const approvePlan = (id: string) => act<Plan>('POST', `/security/escort-plan/${id}/approve`, undefined, (r) => { useOps.getState().upsertPlan(r); toast('pl.approved', endpoint('POST', `/security/escort-plan/${id}/approve`)); });

// --- analysis & detections
export async function runAnalysis(): Promise<void> {
  const s = useOps.getState();
  const [lat, lon] = s.aLoc.split(',').map((v) => parseFloat(v.trim()));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) { s.showToast(t('an.badLoc'), undefined, 'error'); return; }
  s.set({ analysisState: 'running', anSel: { kind: 'area' }, anTab: 'area' });
  await act<AreaAnalysis>('POST', '/v1/locations/analyze', { lat, lon, radius_m: s.radius, include: s.incl }, (r) => useOps.getState().set({ analysis: r, analysisState: 'done' }));
  if (useOps.getState().analysisState === 'running') useOps.getState().set({ analysisState: useOps.getState().analysis ? 'done' : 'idle' });
}
export const decideDetection = (d: Detection, decision: 'confirm' | 'reject') =>
  act<Detection>('POST', '/threat/analyze', { detection_id: d.id, decision }, (r) => {
    const s = useOps.getState();
    s.upsertDetection(r);
    if (s.analysis) s.set({ analysis: { ...s.analysis, threats: s.analysis.threats.map((x) => (x.id === r.id ? r : x)) } });
    toast(decision === 'confirm' ? 'an.confirmToast' : 'an.rejectToast', endpoint('POST', '/threat/analyze'));
    void refreshRisk();
  });
export async function uploadImage(file: File): Promise<void> {
  try {
    const r = await upload<{ detections: unknown[] }>('/threat/detect/image', file);
    toast('an.uploadDone', endpoint('POST', '/threat/detect/image'), { n: r.detections.length });
  } catch (e) { fail(e); }
}

// --- simulation
export async function simToggle(sc: Scenario): Promise<void> {
  const st = useOps.getState().sim;
  if (st?.running && st.scenario_id === sc.id) { await act<SimStatus>('POST', '/v1/scenarios/pause', undefined, (r) => useOps.getState().set({ sim: r })); return; }
  const fresh = !st || st.scenario_id !== sc.id || st.finished;
  await act<SimStatus>('POST', `/v1/scenarios/${sc.id}/run`, { speed: st?.speed ?? 1 }, (r) => { useOps.getState().set({ sim: r }); if (fresh) toast('sim.started', endpoint('POST', `/v1/scenarios/${sc.id}/run`)); });
}
export const simReset = () => act<SimStatus>('POST', '/v1/scenarios/reset', undefined, (r) => useOps.getState().set({ sim: r }));
export const simSpeed = (speed: number) => act<SimStatus>('POST', '/v1/scenarios/speed', { speed }, (r) => useOps.getState().set({ sim: r }));

export function download(name: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function makeAAR(id: string): Promise<void> {
  try {
    const r = await get<{ timeline: unknown[] }>(`/v1/reports/${id}`);
    download(`AAR-${id}.json`, JSON.stringify(r, null, 2), 'application/json');
    toast('sim.aarReady', endpoint('GET', `/v1/reports/${id}`), { n: r.timeline.length });
  } catch (e) { fail(e); }
}

// --- devices
export const sendCommand = (dev: Device, command: string, label: string) =>
  act<{ device: Device }>('POST', `/communication/command/${dev.id}`, { command }, (r) => { useOps.getState().upsertDevice(r.device); toast('dv.cmdSent', endpoint('POST', `/communication/command/${dev.id}`), { c: label }); });
export const registerDevice = (input: { id: string; name: string; type: Device['type']; protocol: string }) =>
  act<Device>('POST', '/communication/devices', input, (r) => { const s = useOps.getState(); s.upsertDevice(r); s.set({ devSel: r.id }); toast('dv.registered', endpoint('POST', '/communication/devices'), { id: r.id }); });

// --- admin, sync & reports
export async function loadAdmin<T>(path: string): Promise<T | null> {
  try { return await get<T>(path); } catch (e) { if (!(e instanceof ApiError && e.status === 403)) fail(e); return null; }
}
export const adminPost = <T>(path: string, okKey: TKey, vars: Record<string, string | number>, onOk: (r: T) => void, body?: unknown) =>
  act<T>('POST', path, body, (r) => { onOk(r); toast(okKey, endpoint('POST', path), vars); });

export async function reportText(branch: string, format: 'csv' | 'html' | 'json', from: string, l: Lang): Promise<string | null> {
  const token = useSession.getState().session?.access_token;
  try {
    const res = await fetch(`/api/branches/${branch}/reports/summary?format=${format}&lang=${l}&from=${encodeURIComponent(from)}`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new ApiError(res.statusText, res.status);
    return await res.text();
  } catch (e) { fail(e); return null; }
}
