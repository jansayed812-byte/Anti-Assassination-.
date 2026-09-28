import { create } from 'zustand';
import type {
  Alert, AppConfig, AreaAnalysis, BlindSpot, BlindType, BranchGeo, BranchSummary, Detection, Device, DeviceType, Incident, LatLon,
  PaceKey, Person, Place, Plan, Priority, RankedSite, Resource, RiskCell, Scenario, SimStatus, SyncStatus, Unit, UnitTelemetry,
} from '../api/types';

export type Mode = 'live' | 'analysis' | 'planning' | 'sim' | 'assets' | 'admin';
export const MODES: Array<{ id: Mode; icon: string }> = [
  { id: 'live', icon: 'broadcast' }, { id: 'analysis', icon: 'crosshair' }, { id: 'planning', icon: 'path' },
  { id: 'sim', icon: 'flask' }, { id: 'assets', icon: 'cpu' }, { id: 'admin', icon: 'gear-six' },
];
export type AdminTab = 'sla' | 'maint' | 'gov' | 'sec' | 'train' | 'users' | 'branches' | 'reports';
export type Frame = 'auto' | 'wall' | 'desktop' | 'tabletL' | 'tabletP' | 'mobile';
export type Conn = 'connecting' | 'online' | 'offline';
export type Layers = { risk: boolean; extremes: boolean; blind: boolean; routes: boolean; units: boolean; pois: boolean; coverage: boolean; buildings: boolean; terrain: boolean };
export type AnSel = { kind: 'dangerous' | 'safest'; rank: number } | { kind: 'zone'; id: string } | { kind: 'area' } | null;
export type Picking = 'origin' | 'destination' | 'analysis' | null;
export interface Toast { id: number; msg: string; api?: string; tone?: 'info' | 'error' }
export interface PlanDraft { origin: Place | null; destination: Place | null; vip_level: number; priority: Priority; start: string }

interface Data {
  config: AppConfig | null; branches: BranchSummary[]; geo: BranchGeo | null; people: Record<string, Person>;
  units: Record<string, Unit>; unitOrder: string[]; alerts: Alert[]; cells: RiskCell[]; riskVersion: number; incidents: Incident[];
  extremes: { dangerous: RankedSite[]; safest: RankedSite[] } | null; blindspots: BlindSpot[]; plans: Plan[];
  scenarios: Scenario[]; sim: SimStatus | null; devices: Device[]; detections: Detection[]; resources: Resource[];
  sync: SyncStatus[]; analysis: AreaAnalysis | null; analysisState: 'idle' | 'running' | 'done';
  loaded: boolean; conn: Conn; offlineSim: boolean; outbox: number; clockOffset: number; e2eMs: number;
}

interface Ui {
  sel: string; liveTab: 'units' | 'alerts'; inspTab: 'sum' | 'video' | 'events'; view3d: boolean;
  layers: Layers; layersOpen: boolean; branchOpen: boolean;
  planSel: string; routeSel: PaceKey | null; editing: PaceKey | null; undo: LatLon[][];
  scenSel: string; devSel: string; devFilter: 'all' | DeviceType; adminTab: AdminTab;
  anTab: 'dangerous' | 'safest' | 'blind' | 'area'; anSel: AnSel; bsFilter: 'all' | BlindType;
  newPlan: boolean; draft: PlanDraft; picking: Picking; aLoc: string; radius: number; incl: { threats: boolean; routes: boolean; resources: boolean };
  listOpen: boolean | null; sheet: 'list' | 'insp'; sheetOpen: boolean; menuOpen: boolean; paletteOpen: boolean; panicOpen: boolean;
  q: string; toast: Toast | null; showApi: boolean; frame: Frame; focus: { lat: number; lon: number; zoom?: number; seq: number } | null;
}

type State = Data & Ui & {
  set: (patch: Partial<Data & Ui>) => void;
  setTelemetry: (units: UnitTelemetry[], ts: number) => void;
  upsertAlert: (a: Alert) => void;
  upsertPlan: (p: Plan) => void;
  upsertDevice: (d: Device) => void;
  upsertDetection: (d: Detection) => void;
  showToast: (msg: string, api?: string, tone?: Toast['tone']) => void;
  flyTo: (p: LatLon, zoom?: number) => void;
  closeOverlays: () => void;
  resetBranch: () => void;
  reset: () => void;
};

const initialData: Data = {
  config: null, branches: [], geo: null, people: {},
  units: {}, unitOrder: [], alerts: [], cells: [], riskVersion: 0, incidents: [], extremes: null, blindspots: [], plans: [],
  scenarios: [], sim: null, devices: [], detections: [], resources: [], sync: [], analysis: null, analysisState: 'idle',
  loaded: false, conn: 'connecting', offlineSim: false, outbox: 0, clockOffset: 0, e2eMs: 0,
};
const initialBranchUi = (): Partial<Ui> => ({
  sel: 'alpha', planSel: 'ESC-0412', routeSel: null, editing: null, undo: [], devSel: 'D-01', anSel: null,
  newPlan: false, picking: null, draft: { origin: null, destination: null, vip_level: 3, priority: 'security', start: '' },
});

const closedOverlays = { menuOpen: false, paletteOpen: false, panicOpen: false, layersOpen: false, branchOpen: false };

let toastTimer: ReturnType<typeof setTimeout> | undefined;
let toastId = 0;
let focusSeq = 0;

export const useOps = create<State>((set, get) => ({
  ...initialData,
  sel: 'alpha', liveTab: 'units', inspTab: 'sum', view3d: true,
  layers: { risk: true, extremes: true, blind: true, routes: true, units: true, pois: true, coverage: false, buildings: true, terrain: true },
  layersOpen: false, branchOpen: false,
  planSel: 'ESC-0412', routeSel: null, editing: null, undo: [], scenSel: 's1', devSel: 'D-01', devFilter: 'all', adminTab: 'branches',
  anTab: 'dangerous', anSel: null, bsFilter: 'all',
  newPlan: false, draft: { origin: null, destination: null, vip_level: 3, priority: 'security', start: '' }, picking: null,
  aLoc: '', radius: 2000, incl: { threats: true, routes: true, resources: true },
  listOpen: null, sheet: 'insp', sheetOpen: true, menuOpen: false, paletteOpen: false, panicOpen: false,
  q: '', toast: null, showApi: false, frame: 'auto', focus: null,

  set: (patch) => set(patch),
  setTelemetry: (list, ts) => set((s) => {
    const units = { ...s.units };
    for (const t of list) if (units[t.id]) units[t.id] = { ...units[t.id], telemetry: t };
    return { units, e2eMs: Math.max(0, Math.round(Date.now() + s.clockOffset - ts)) };
  }),
  upsertAlert: (a) => set((s) => ({ alerts: s.alerts.some((x) => x.id === a.id) ? s.alerts.map((x) => (x.id === a.id ? a : x)) : [a, ...s.alerts] })),
  upsertPlan: (p) => set((s) => ({ plans: s.plans.some((x) => x.id === p.id) ? s.plans.map((x) => (x.id === p.id ? p : x)) : [...s.plans, p] })),
  upsertDevice: (d) => set((s) => ({ devices: s.devices.some((x) => x.id === d.id) ? s.devices.map((x) => (x.id === d.id ? d : x)) : [...s.devices, d] })),
  upsertDetection: (d) => set((s) => ({ detections: s.detections.some((x) => x.id === d.id) ? s.detections.map((x) => (x.id === d.id ? d : x)) : [...s.detections, d] })),
  showToast: (msg, api, tone = 'info') => {
    clearTimeout(toastTimer);
    set({ toast: { id: ++toastId, msg, api: get().showApi ? api : undefined, tone } });
    toastTimer = setTimeout(() => set({ toast: null }), tone === 'error' ? 5000 : 3000);
  },
  flyTo: (p, zoom) => set({ focus: { lat: p.lat, lon: p.lon, zoom, seq: ++focusSeq } }),
  closeOverlays: () => set(closedOverlays),
  resetBranch: () => set({ ...initialData, config: get().config, conn: get().conn, ...initialBranchUi(), ...closedOverlays, analysis: null }),
  reset: () => set({ ...initialData, ...initialBranchUi(), ...closedOverlays, analysis: null }),
}));
