/** Shapes of the operations API (services/server). Server-generated text is trilingual ({dr, ps, en}). */
import type { LText, Tri, Lang } from '../i18n';

export type Role = 'viewer' | 'operator' | 'analyst' | 'planner' | 'commander' | 'technical' | 'admin';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type AlertLevel = 'critical' | 'error' | 'warning' | 'info';
export type AlertStatus = 'active' | 'acknowledged' | 'escalated' | 'resolved';
export type PaceKey = 'P' | 'A' | 'C' | 'E';
export type LatLon = { lat: number; lon: number };
export type LngLat = [number, number];
export type BBox = [number, number, number, number];

export interface Membership { branch: string; role: Role }
export interface User {
  id: string; username: string; name: Tri; role: Role; home_branch: string; memberships: Membership[];
  scope: 'branch' | 'regional'; active: boolean; last_login: number | null; prefs: { lang: Lang; theme: 'dark' | 'light' };
}
export interface Session {
  access_token: string; refresh_token: string; expires_in: number; user: User; branch: string; role: Role; branches: string[];
}

export interface Branch {
  id: string; name: Tri; city: Tri; province: Tri; hq: boolean; center: LatLon; bbox: BBox; boundary: LngLat[];
  timezone: string; data_source: 'osm' | 'synthetic';
}
export interface BranchSummary extends Omit<Branch, 'boundary'> { open_alerts: number; running_plans: number; blind_spots: number; role: Role | null }
export interface AppConfig {
  default_branch: string; branches: Branch[]; languages: Lang[]; default_language: Lang; demo_mode: boolean; exercise_data: boolean;
  map: { style_url: string; terrain_url: string; terrain_encoding: 'terrarium' | 'mapbox'; attribution: string };
}

export type PoiKind = 'hospital' | 'clinic' | 'police' | 'fuel' | 'safe_house' | 'hq' | 'airport' | 'government';
export interface Poi { id: string; kind: PoiKind; name: Tri; lat: number; lon: number; synthetic: boolean }
export interface Resource extends Poi { icon: string; distance_m?: number }
export interface RestrictedZone { id: string; name: Tri; ring: LngLat[] }
export interface BranchGeo {
  branch: string; source: 'osm' | 'synthetic'; bbox: BBox; boundary: LngLat[]; pois: Poi[]; restricted: RestrictedZone[];
  roads: { type: 'FeatureCollection'; features: Array<{ type: 'Feature'; properties: { id: string; cls: string; name: Tri | null }; geometry: { type: 'LineString'; coordinates: LngLat[] } }> };
}

export interface UnitMeta { id: string; name: Tri; icon: string; group: 'mission' | 'standby'; sub: Tri; mission: string | null; comms: 'ok' | 'lost'; device?: string }
export interface UnitTelemetry {
  id: string; lat: number; lon: number; alt_m: number; speed_kmh: number; heading_deg: number; accel_mps2: number;
  cep95_m: number; confidence: number; degraded: boolean; mode: 'fused' | 'gnss' | 'dead_reckoning';
  fusion: Array<{ source: string; share: number }>; risk_score: number; risk_level: RiskLevel; route?: PaceKey; route_progress?: number;
}
export interface Unit extends UnitMeta { telemetry: UnitTelemetry | null }

export interface Alert {
  id: string; level: AlertLevel; title: LText; src: LText; unit: string | null; status: AlertStatus; branch: string; origin_branch?: string;
  created_at: string; deadline: number; source: 'system' | 'user' | 'simulation' | 'panic' | 'sync' | 'blindspot';
  history: Array<{ at: string; status: AlertStatus; by: string }>;
}

export interface RiskFactors { threat: number; severity: number; likelihood: number; exposure: number; confidence: number; support_m: number; coverage_gap: boolean; context: number; incidents: string[] }
export interface RiskCell { id: string; lat: number; lon: number; score: number; level: RiskLevel; restricted: boolean; factors: RiskFactors }
export interface RankedSite { rank: number; cell: string; lat: number; lon: number; score: number; level: RiskLevel; factors: RiskFactors; nearest: { id: string; name: Tri; distance_m: number } | null }
export interface Incident { incident_id: string; type: string; severity: RiskLevel; location?: LatLon; radius_m: number; confidence: number; source: string; evidence: string[]; human_validation_status?: string }

export type BlindType = 'network' | 'monitoring' | 'access';
export interface BlindSpot {
  id: string; type: BlindType; label: Tri; cell_count: number; area_km2: number; centroid: LatLon; polygon: number[][][][];
  max_risk: number; avg_risk: number; routes: Array<{ plan: string; route: string; length_m: number }>;
  nearest_support: { id: string; name: Tri; distance_m: number } | null; detail: Tri; mitigation: Tri; first_seen: number; cells?: string[];
}

export interface RouteSegment { level: RiskLevel; coords: LngLat[]; start_m: number; length_m: number }
export interface RouteStop { id: string; kind: PoiKind; name: Tri; lat: number; lon: number; at_m: number; eta_min: number; offset_m: number }
export interface RoutePlan {
  k: PaceKey; label: Tri; waypoints: LatLon[]; path: LatLon[]; distance_m: number; eta_min: number; high_risk_min: number;
  max_risk: number; avg_risk: number; risk_level: RiskLevel; segments: RouteSegment[];
  alerts: Array<{ level: 'high' | 'critical' | 'blind'; at_m: number; length_m: number; text: Tri }>;
  safe_stops: RouteStop[]; support_points: RouteStop[];
  checkpoints: Array<{ id: string; name: Tri; lat: number; lon: number; at_m: number; eta_min: number }>;
  profile: Array<{ at_m: number; score: number }>; coverage_pct: number;
}
export type PlanStatus = 'running' | 'pending_approval' | 'approved' | 'closed' | 'draft';
export type Priority = 'security' | 'time' | 'balanced';
export interface Place { name: LText; lat: number; lon: number }
export interface RouteState { waypoints: LatLon[]; edited: boolean; version: number; edited_by?: string; edited_at?: number }
export interface Plan {
  id: string; title: LText; status: PlanStatus; vip_level: number; priority: Priority; origin: Place; destination: Place;
  start: LText; vehicles: number; active_route: PaceKey; resources: LText[]; approved_by?: string; submitted_by?: string;
  routes: Record<PaceKey, RouteState>; version: number; pace: RoutePlan[]; validation: Array<{ ok: boolean; text: Tri }>;
}

export interface ScenarioMetrics { detection_s: number; ack_s: number; compliance_pct: number; route_decision: Tri }
export interface Scenario {
  id: string; name: Tri; description: Tri; category: Tri; difficulty?: 'easy' | 'medium' | 'hard'; nominal_minutes?: number;
  duration_ms: number; step_count: number; metrics?: ScenarioMetrics;
}
export interface SimStatus {
  scenario_id: string | null; running: boolean; finished: boolean; progress: number; speed: number;
  elapsed_ms: number; duration_ms: number; events: Array<{ t_ms: number; message: Tri; level: AlertLevel }>;
}

export type DeviceType = 'drone' | 'relay' | 'gps' | 'iot' | 'camera' | 'ble';
export type Coverage =
  | { kind: 'camera'; heading_deg: number; fov_deg: number; range_m: number }
  | { kind: 'radio'; tx_dbm: number; gain_db: number }
  | { kind: 'drone'; footprint_m: number };
export interface Device {
  id: string; name: Tri; type: DeviceType; protocol: string; detail: LText; state: 'on' | 'idle' | 'warn' | 'off';
  battery_pct: number | null; firmware: string; signal_dbm: number | null; last_seen: number; geo: LatLon | null; coverage: Coverage | null;
  history: Array<{ at: number; message: LText }>; commands: Array<{ id: string; label: Tri }>;
}

export interface Detection {
  id: string; label: Tri; source: string; confidence: number; observed_at: string; lat: number; lon: number;
  severity: RiskLevel; radius_m: number; status: 'pending' | 'confirmed' | 'rejected'; decided_by?: string; incident_id?: string;
}

export interface AreaAnalysis {
  center: LatLon; radius_m: number; score: number; level: RiskLevel; uncertainty: number; confidence: number;
  factors: { severity: number; likelihood: number; exposure: number; data_confidence: number };
  point: RiskCell | null; cells: { count: number; max: number; by_level: Partial<Record<RiskLevel, number>> };
  incidents: Array<{ id: string; type: string; severity: RiskLevel; confidence: number; distance_m: number }>;
  threats: Detection[]; blind_spots: Array<{ id: string; type: BlindType; label: Tri; area_km2: number; centroid: LatLon; distance_m: number }>;
  routes: Array<{ k: PaceKey; label: Tri; max_risk: number; avg_risk: number; risk_level: RiskLevel; eta_min: number; distance_m: number }>;
  resources: Resource[]; provenance: string[]; analyzed_at: string;
}

export interface SyncStatus { branch: string; link: 'up' | 'down'; outbox: number; sent: number; received: number; duplicates: number; stale: number; last_sync: number | null }
export interface SyncEnvelope { origin: string; kind: 'alert' | 'advisory' | 'incident' | 'plan'; id: string; version: number; at: number; payload: Record<string, unknown> }
export interface Person { username: string; name: Tri; branches: string[] }

export interface SlaMetric { id: string; name: Tri; value: Tri; target: Tri; ok: boolean; live: boolean }
export interface MaintenanceTask { id: string; name: Tri; schedule: Tri; last_run: number | null; status: 'ok' | 'partial' | 'due' }
export interface ManagedKey { name: string; algorithm: string; age_days: number; next_rotation_days: number }
export interface ScanResult { at: number; critical: number; medium: number; audit: { entries: number; valid: boolean; broken_at: number | null } }

export type Channel = 'telemetry' | 'risk' | 'alerts' | 'sim' | 'plans' | 'devices' | 'blindspots' | 'sync';
export interface Envelope<T = unknown> { seq: number; ts: number; channel: Channel; data: T; integrity: string; branch?: string }
