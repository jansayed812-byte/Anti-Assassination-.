export type Role = 'viewer' | 'operator' | 'analyst' | 'planner' | 'commander' | 'technical' | 'admin';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type AlertLevel = 'critical' | 'error' | 'warning' | 'info';
export type AlertStatus = 'active' | 'acknowledged' | 'escalated' | 'resolved';
export type PaceKey = 'P' | 'A' | 'C' | 'E';
export type LatLon = { lat: number; lon: number };

export interface User { id: string; username: string; name: string; role: Role; active: boolean; last_login: number | null }
export interface Session { access_token: string; refresh_token: string; expires_in: number; user: User }

export interface UnitMeta { id: string; name: string; icon: string; group: 'mission' | 'standby'; sub: string; mission: string | null; comms: 'ok' | 'lost' }
export interface UnitTelemetry {
  id: string; lat: number; lon: number; alt_m: number; speed_kmh: number; heading_deg: number; accel_mps2: number;
  cep95_m: number; confidence: number; degraded: boolean; mode: string; fusion: Array<{ source: string; share: number }>;
  risk_score: number; risk_level: RiskLevel; route?: PaceKey; route_progress?: number;
}
export interface Unit extends UnitMeta { telemetry: UnitTelemetry | null }

export interface Alert {
  id: string; level: AlertLevel; title: string; src: string; unit: string | null; status: AlertStatus;
  created_at: string; deadline: number; source: 'system' | 'user' | 'simulation' | 'panic';
  history: Array<{ at: string; status: AlertStatus; by: string }>;
}

export interface RiskCell { id: string; q: number; r: number; lat: number; lon: number; score: number; level: RiskLevel }
export interface Incident { incident_id: string; type: string; severity: RiskLevel; location?: LatLon; radius_m: number; confidence: number; source: string }

export interface PaceRoute {
  k: PaceKey; name: string; path: LatLon[]; km: number; minutes: number; risk: number; risk_level: RiskLevel;
  checkpoints: Array<{ id: string; name: string; eta_min: number; lat: number; lon: number }>;
}
export interface Plan {
  id: string; title: string; status: 'running' | 'pending_approval' | 'approved' | 'closed' | 'draft'; vip_level: number;
  priority: 'security' | 'time' | 'balanced'; origin: string; destination: string; start: string; vehicles: number;
  active_route: PaceKey; resources: string[]; approved_by?: string; submitted_by?: string;
  pace: PaceRoute[]; validation: Array<{ ok: boolean; text: string }>;
}

export interface Scenario {
  id: string; name: string; description?: string; category?: string; difficulty?: string; nominal_minutes?: number;
  duration_ms: number; step_count: number;
  metrics?: { detection_time: string; ack_time: string; protocol_compliance: string; route_decision: string };
}
export interface SimStatus {
  scenario_id: string | null; running: boolean; finished: boolean; progress: number; speed: number;
  elapsed_ms: number; duration_ms: number; events: Array<{ t_ms: number; message: string; level: AlertLevel }>;
}

export type DeviceType = 'drone' | 'gps' | 'iot' | 'camera' | 'ble';
export interface Device {
  id: string; name: string; type: DeviceType; protocol: string; detail: string; state: 'on' | 'idle' | 'warn' | 'off';
  battery_pct: number | null; firmware: string; signal_dbm: number | null; last_seen: number;
  history: Array<{ at: number; message: string }>; commands: string[];
}

export interface Detection {
  id: string; label: string; source: string; confidence: number; observed_at: string; lat: number; lon: number;
  severity: RiskLevel; radius_m: number; status: 'pending' | 'confirmed' | 'rejected'; decided_by?: string;
}

export interface Resource { id: string; icon: string; name: string; lat: number; lon: number; distance_m?: number }

export interface AreaAnalysis {
  center: LatLon; radius_m: number; score: number; level: RiskLevel; uncertainty: number; confidence: number;
  factors: { severity: number; likelihood: number; exposure: number; data_confidence: number };
  incidents: Array<{ id: string; type: string; severity: RiskLevel; confidence: number; distance_m: number }>;
  threats: Detection[]; routes: Array<{ k: PaceKey; name: string; risk: number; risk_level: RiskLevel }>;
  resources: Resource[]; provenance: string[]; analyzed_at: string;
}

export interface SlaMetric { id: string; name: string; value: string; target: string; ok: boolean; live: boolean }
export interface MaintenanceTask { id: string; name: string; schedule: string; last_run: number | null; status: 'ok' | 'partial' | 'due' }
export interface ManagedKey { name: string; algorithm: string; age_days: number; next_rotation_days: number }
export interface ScanResult { at: number; critical: number; medium: number; audit: { entries: number; valid: boolean; broken_at: number | null } }

export interface Envelope<T = unknown> { seq: number; ts: number; channel: 'telemetry' | 'risk' | 'alerts' | 'sim' | 'plans' | 'devices'; data: T; integrity: string }
