import { create } from 'zustand';
import type { Alert, AreaAnalysis, Detection, Device, DeviceType, Incident, Plan, Resource, RiskCell, Scenario, SimStatus, Unit, UnitTelemetry } from '../api/types';
import type { Lang } from '../lib/format';

export type Mode = 'live' | 'analysis' | 'planning' | 'sim' | 'assets' | 'admin';
export const MODES: Array<{ id: Mode; icon: string }> = [
  { id: 'live', icon: 'broadcast' }, { id: 'analysis', icon: 'crosshair' }, { id: 'planning', icon: 'path' },
  { id: 'sim', icon: 'flask' }, { id: 'assets', icon: 'cpu' }, { id: 'admin', icon: 'gear-six' },
];
export type AdminTab = 'sla' | 'maint' | 'gov' | 'sec' | 'train' | 'users';
export type Frame = 'auto' | 'wall' | 'desktop' | 'tabletL' | 'tabletP' | 'mobile';
export type Conn = 'connecting' | 'online' | 'offline';
export interface Toast { id: number; msg: string; api?: string; tone?: 'info' | 'error' }

interface Data {
  units: Record<string, Unit>; unitOrder: string[]; alerts: Alert[]; cells: RiskCell[]; incidents: Incident[]; plans: Plan[];
  scenarios: Scenario[]; sim: SimStatus | null; devices: Device[]; detections: Detection[]; resources: Resource[];
  analysis: AreaAnalysis | null; analysisState: 'idle' | 'running' | 'done';
  loaded: boolean; conn: Conn; offlineSim: boolean; outbox: number; clockOffset: number; e2eMs: number;
}

interface Ui {
  lang: Lang; sel: string; liveTab: 'units' | 'alerts'; inspTab: 'sum' | 'video' | 'events'; view3d: boolean;
  layers: { risk: boolean; routes: boolean; units: boolean; terrain: boolean }; layersOpen: boolean;
  planSel: string; previewRoute: string | null; scenSel: string; devSel: string; devFilter: 'all' | DeviceType; adminTab: AdminTab;
  newPlan: boolean; aLoc: string; radius: number; incl: { threats: boolean; routes: boolean; resources: boolean };
  listOpen: boolean | null; sheet: 'list' | 'insp'; sheetOpen: boolean; menuOpen: boolean; paletteOpen: boolean; panicOpen: boolean;
  q: string; toast: Toast | null; showApi: boolean; frame: Frame;
}

type State = Data & Ui & {
  set: (patch: Partial<Data & Ui>) => void;
  setTelemetry: (units: UnitTelemetry[], ts: number) => void;
  upsertAlert: (a: Alert) => void;
  upsertPlan: (p: Plan) => void;
  upsertDevice: (d: Device) => void;
  upsertDetection: (d: Detection) => void;
  showToast: (msg: string, api?: string, tone?: Toast['tone']) => void;
  closeOverlays: () => void;
  reset: () => void;
};

const initialData: Data = {
  units: {}, unitOrder: [], alerts: [], cells: [], incidents: [], plans: [], scenarios: [], sim: null, devices: [], detections: [], resources: [],
  analysis: null, analysisState: 'idle', loaded: false, conn: 'connecting', offlineSim: false, outbox: 0, clockOffset: 0, e2eMs: 0,
};

const storedLang = (): Lang => { try { return localStorage.getItem('ops.lang') === 'en' ? 'en' : 'fa'; } catch { return 'fa'; } };

let toastTimer: ReturnType<typeof setTimeout> | undefined;
let toastId = 0;

export const useOps = create<State>((set, get) => ({
  ...initialData,
  lang: storedLang(), sel: 'alpha', liveTab: 'units', inspTab: 'sum', view3d: true,
  layers: { risk: true, routes: true, units: true, terrain: true }, layersOpen: false,
  planSel: 'ESC-0412', previewRoute: null, scenSel: 's1', devSel: 'D-01', devFilter: 'all', adminTab: 'sla',
  newPlan: false, aLoc: '35.6892, 51.3890', radius: 3000, incl: { threats: true, routes: true, resources: true },
  listOpen: null, sheet: 'insp', sheetOpen: true, menuOpen: false, paletteOpen: false, panicOpen: false,
  q: '', toast: null, showApi: false, frame: 'auto',

  set: (patch) => {
    if (patch.lang) { try { localStorage.setItem('ops.lang', patch.lang); } catch { /* ignore */ } }
    set(patch);
  },
  setTelemetry: (list, ts) => set((s) => {
    const units = { ...s.units };
    for (const t of list) if (units[t.id]) units[t.id] = { ...units[t.id], telemetry: t };
    return { units, e2eMs: Math.max(0, Math.round(Date.now() + s.clockOffset - ts)) };
  }),
  upsertAlert: (a) => set((s) => ({ alerts: s.alerts.some((x) => x.id === a.id) ? s.alerts.map((x) => (x.id === a.id ? a : x)) : [a, ...s.alerts] })),
  upsertPlan: (p) => set((s) => ({ plans: s.plans.some((x) => x.id === p.id) ? s.plans.map((x) => (x.id === p.id ? p : x)) : [...s.plans, p] })),
  upsertDevice: (d) => set((s) => ({ devices: s.devices.some((x) => x.id === d.id) ? s.devices.map((x) => (x.id === d.id ? d : x)) : [...s.devices, d] })),
  upsertDetection: (d) => set((s) => ({ detections: s.detections.map((x) => (x.id === d.id ? d : x)) })),
  showToast: (msg, api, tone = 'info') => {
    clearTimeout(toastTimer);
    set({ toast: { id: ++toastId, msg, api: get().showApi ? api : undefined, tone } });
    toastTimer = setTimeout(() => set({ toast: null }), tone === 'error' ? 4500 : 2800);
  },
  closeOverlays: () => set({ menuOpen: false, paletteOpen: false, panicOpen: false, layersOpen: false }),
  reset: () => set({ ...initialData }),
}));
