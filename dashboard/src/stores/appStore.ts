/**
 * Global App Store - Zustand
 * وضعیت مرکزی سامانه
 */
import { create } from 'zustand';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type MapMode = '2d' | '3d';
export type ConnectionStatus = 'connected' | 'disconnected' | 'degraded';

export interface Position {
  source_id: string;
  lat: number;
  lon: number;
  alt_m: number;
  speed_mps: number;
  accuracy_m: number;
  confidence: number;
  is_degraded: boolean;
  updated_at: string;
}

export interface Incident {
  incident_id: string;
  type: string;
  severity: RiskLevel;
  lat?: number;
  lon?: number;
  radius_m: number;
  observed_at: string;
  confidence: number;
  human_validation_status: 'pending' | 'confirmed' | 'rejected';
}

export interface Alert {
  id: string;
  type: string;
  severity: RiskLevel;
  message: string;
  at: string;
  acknowledged: boolean;
}

interface AppState {
  connectionStatus: ConnectionStatus;
  setConnectionStatus: (s: ConnectionStatus) => void;

  mapMode: MapMode;
  setMapMode: (m: MapMode) => void;
  mapCenter: { lat: number; lon: number };
  setMapCenter: (c: { lat: number; lon: number }) => void;

  positions: Map<string, Position>;
  updatePosition: (p: Position) => void;

  incidents: Incident[];
  setIncidents: (i: Incident[]) => void;
  addIncident: (i: Incident) => void;

  alerts: Alert[];
  addAlert: (a: Alert) => void;
  acknowledgeAlert: (id: string) => void;

  isOffline: boolean;
  pendingSyncCount: number;
  setOfflineState: (offline: boolean, pending?: number) => void;
}

export const useAppStore = create<AppState>((set) => ({
  connectionStatus: 'disconnected',
  setConnectionStatus: (s) => set({ connectionStatus: s }),

  mapMode: '2d',
  setMapMode: (m) => set({ mapMode: m }),
  mapCenter: { lat: 35.689, lon: 51.389 },
  setMapCenter: (c) => set({ mapCenter: c }),

  positions: new Map(),
  updatePosition: (p) =>
    set((state) => {
      const next = new Map(state.positions);
      next.set(p.source_id, p);
      return { positions: next };
    }),

  incidents: [],
  setIncidents: (i) => set({ incidents: i }),
  addIncident: (i) =>
    set((state) => ({ incidents: [...state.incidents, i] })),

  alerts: [],
  addAlert: (a) =>
    set((state) => ({ alerts: [a, ...state.alerts].slice(0, 100) })),
  acknowledgeAlert: (id) =>
    set((state) => ({
      alerts: state.alerts.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)),
    })),

  isOffline: false,
  pendingSyncCount: 0,
  setOfflineState: (offline, pending = 0) =>
    set({ isOffline: offline, pendingSyncCount: pending }),
}));
