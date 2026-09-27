/**
 * Every console action goes through here: call the API, reconcile the store, report the outcome.
 */
import { ApiError, endpoint, get, mutate, publicPost, upload } from '../api/client';
import type { Alert, AreaAnalysis, Detection, Device, Incident, PaceKey, Plan, Resource, RiskCell, Role, Scenario, Session, SimStatus, Unit } from '../api/types';
import { useOps } from '../stores/ops';
import { useSession } from '../stores/session';
import { connectStream, disconnectStream } from '../realtime/streams';
import { translate, type TKey } from '../i18n';

const t = (key: TKey, vars?: Record<string, string | number>) => translate(useOps.getState().lang, key, vars);
const toast = (key: TKey, api?: string, vars?: Record<string, string | number>) => useOps.getState().showToast(t(key, vars), api);

function fail(e: unknown): void {
  const s = useOps.getState();
  const msg = e instanceof ApiError && e.status === 403 ? t('err.forbidden') : t('err.generic', { m: e instanceof Error ? e.message : String(e) });
  s.showToast(msg, undefined, 'error');
}

/** Runs a mutation; `onOk` gets the response, or is skipped (with a "queued" toast) when offline. */
async function act<T>(method: 'POST' | 'PATCH', path: string, body: unknown, onOk: (r: T) => void): Promise<void> {
  try {
    const r = await mutate<T>(method, path, body);
    if (r === null) { useOps.getState().showToast(t('off.queued'), endpoint(method, path)); return; }
    onOk(r);
  } catch (e) { fail(e); }
}

export async function login(username: string, password: string): Promise<void> {
  const s = await publicPost<Session>('/auth/login', { username, password });
  useSession.getState().setSession(s);
}

export function logout(): void {
  disconnectStream();
  useSession.getState().setSession(null);
  useOps.getState().reset();
}

export async function switchRole(role: Role): Promise<void> {
  try {
    const r = await mutate<Session>('POST', '/auth/switch-role', { role });
    if (!r) return;
    useSession.getState().setSession(r);
    connectStream(r.access_token);
  } catch (e) { fail(e); }
}

export async function bootstrap(token: string): Promise<void> {
  const s = useOps.getState();
  try {
    const [tl, al, grid, pl, sc, dv, dt, rs, inc] = await Promise.all([
      get<{ units: Unit[] }>('/v1/telemetry/latest'), get<{ alerts: Alert[]; server_time: number }>('/monitoring/alerts'),
      get<{ cells: RiskCell[] }>('/v1/risk/grid'), get<{ plans: Plan[] }>('/security/escort-plans'),
      get<{ scenarios: Scenario[]; status: SimStatus }>('/v1/scenarios'), get<{ devices: Device[] }>('/communication/devices'),
      get<{ detections: Detection[] }>('/threat/detections'), get<{ resources: Resource[] }>('/v1/resources'),
      get<{ incidents: Incident[] }>('/v1/incidents'),
    ]);
    s.set({
      units: Object.fromEntries(tl.units.map((u) => [u.id, u])), unitOrder: tl.units.map((u) => u.id), alerts: al.alerts,
      clockOffset: al.server_time - Date.now(), cells: grid.cells, incidents: inc.incidents, plans: pl.plans, scenarios: sc.scenarios, sim: sc.status,
      devices: dv.devices, detections: dt.detections, resources: rs.resources, loaded: true,
    });
    connectStream(token);
  } catch (e) { fail(e); }
}

// --- alerts
export const acknowledge = (a: Alert) => act<Alert>('POST', `/monitoring/alerts/${a.id}/acknowledge`, undefined, (r) => { useOps.getState().upsertAlert(r); toast('alert.acked', endpoint('POST', `/monitoring/alerts/${a.id}/acknowledge`)); });
export const resolve = (a: Alert) => act<Alert>('POST', `/monitoring/alerts/${a.id}/resolve`, undefined, (r) => { useOps.getState().upsertAlert(r); toast('alert.resolved', endpoint('POST', `/monitoring/alerts/${a.id}/resolve`)); });
export const escalate = (a: Alert) => act<Alert>('POST', `/monitoring/alerts/${a.id}/escalate`, undefined, (r) => { useOps.getState().upsertAlert(r); toast('alert.escalatedToast', endpoint('POST', `/monitoring/alerts/${a.id}/escalate`)); });
export const reportIncident = (unitName: string, unitId: string) =>
  act<Alert>('POST', '/monitoring/alerts', { level: 'warning', title: `گزارش رخداد · ${unitName}`, src: 'ثبت دستی از کنسول', unit: unitId }, (r) => { useOps.getState().upsertAlert(r); toast('act.reported', endpoint('POST', '/monitoring/alerts')); });
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
export const createPlan = (input: { origin: string; destination: string; vip_level: number; priority: Plan['priority'] }) =>
  act<Plan>('POST', '/security/escort-plan', input, (r) => { const s = useOps.getState(); s.upsertPlan(r); s.set({ planSel: r.id, newPlan: false, previewRoute: null }); toast('pl.computed', endpoint('POST', '/security/escort-plan'), { id: r.id }); });
export const submitPlan = (id: string) => act<Plan>('POST', `/security/escort-plan/${id}/submit`, undefined, (r) => { useOps.getState().upsertPlan(r); toast('pl.submitted', endpoint('POST', `/security/escort-plan/${id}/submit`)); });
export const approvePlan = (id: string) => act<Plan>('POST', `/security/escort-plan/${id}/approve`, undefined, (r) => { useOps.getState().upsertPlan(r); toast('pl.approved', endpoint('POST', `/security/escort-plan/${id}/approve`)); });

// --- analysis & detections
export async function runAnalysis(): Promise<void> {
  const s = useOps.getState();
  const [lat, lon] = s.aLoc.split(',').map((x) => parseFloat(x.trim()));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) { s.showToast(t('an.badLoc'), undefined, 'error'); return; }
  s.set({ analysisState: 'running' });
  await act<AreaAnalysis>('POST', '/v1/locations/analyze', { lat, lon, radius_m: s.radius, include: s.incl }, (r) => {
    useOps.getState().set({ analysis: r, analysisState: 'done' });
  });
  if (useOps.getState().analysisState === 'running') useOps.getState().set({ analysisState: useOps.getState().analysis ? 'done' : 'idle' });
}
export const decideDetection = (d: Detection, decision: 'confirm' | 'reject') =>
  act<Detection>('POST', '/threat/analyze', { detection_id: d.id, decision }, (r) => {
    const s = useOps.getState();
    s.upsertDetection(r);
    if (s.analysis) s.set({ analysis: { ...s.analysis, threats: s.analysis.threats.map((x) => (x.id === r.id ? r : x)) } });
    toast(decision === 'confirm' ? 'an.confirmToast' : 'an.rejectToast', endpoint('POST', '/threat/analyze'));
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
  if (st?.running && st.scenario_id === sc.id) return act<SimStatus>('POST', '/v1/scenarios/pause', undefined, (r) => useOps.getState().set({ sim: r }));
  const fresh = !st || st.scenario_id !== sc.id || st.finished;
  return act<SimStatus>('POST', `/v1/scenarios/${sc.id}/run`, { speed: st?.speed ?? 1 }, (r) => { useOps.getState().set({ sim: r }); if (fresh) toast('sim.started', endpoint('POST', `/v1/scenarios/${sc.id}/run`)); });
}
export const simReset = () => act<SimStatus>('POST', '/v1/scenarios/reset', undefined, (r) => useOps.getState().set({ sim: r }));
export const simSpeed = (speed: number) => act<SimStatus>('POST', '/v1/scenarios/speed', { speed }, (r) => useOps.getState().set({ sim: r }));
export async function makeAAR(id: string): Promise<void> {
  try {
    const r = await get<{ timeline: unknown[]; scenario_name: string }>(`/v1/reports/${id}`);
    const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `AAR-${id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('sim.aarReady', endpoint('GET', `/v1/reports/${id}`), { n: r.timeline.length });
  } catch (e) { fail(e); }
}

// --- devices
export const sendCommand = (dev: Device, command: string) =>
  act<{ device: Device }>('POST', `/communication/command/${dev.id}`, { command }, (r) => { useOps.getState().upsertDevice(r.device); toast('dv.cmdSent', endpoint('POST', `/communication/command/${dev.id}`), { c: command }); });
export const registerDevice = (input: { id: string; name: string; type: Device['type']; protocol: string }) =>
  act<Device>('POST', '/communication/devices', input, (r) => { const s = useOps.getState(); s.upsertDevice(r); s.set({ devSel: r.id }); toast('dv.registered', endpoint('POST', '/communication/devices'), { id: r.id }); });

// --- admin
export async function loadAdmin<T>(path: string): Promise<T | null> {
  try { return await get<T>(path); } catch (e) { if (!(e instanceof ApiError && e.status === 403)) fail(e); return null; }
}
export const adminPost = <T>(path: string, okKey: TKey, vars: Record<string, string | number>, onOk: (r: T) => void) =>
  act<T>('POST', path, undefined, (r) => { onOk(r); toast(okKey, endpoint('POST', path), vars); });
