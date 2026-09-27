/**
 * Phase 6: Simulation Engine scenario type definitions.
 *
 * Text fields accept either a plain string or a per-language object ({ dr, ps, en }). Scenario files on disk
 * (ScenarioDef) place positions and incidents with anchors relative to the branch geography — the running
 * escort route, a unit, a facility or the branch centre — so one scenario plays in every branch; the server
 * resolves the anchors to coordinates (ScenarioConfig) when the scenario starts.
 */

export type ScenarioText = string | { dr: string; ps: string; en: string };
export const scenarioText = (t: ScenarioText | undefined, lang: 'dr' | 'ps' | 'en' = 'en'): string => (t == null ? '' : typeof t === 'string' ? t : t[lang]);

export interface ScenarioPosition {
  source_id: string; lat: number; lon: number;
  alt_m?: number; speed_mps?: number; accuracy_m?: number; confidence?: number;
}

export interface ScenarioIncident {
  type: string; severity: 'low' | 'medium' | 'high' | 'critical';
  lat: number; lon: number; radius_m: number; confidence: number; evidence?: string[];
}

export interface ScenarioAlert {
  type: string; severity: 'low' | 'medium' | 'high' | 'critical'; message: ScenarioText;
}

export interface ScenarioTimelineEvent {
  message: ScenarioText; level: 'critical' | 'error' | 'warning' | 'info';
}

export interface ScenarioStep {
  time_offset_ms: number;
  positions?: ScenarioPosition[];
  incidents?: ScenarioIncident[];
  alerts?: ScenarioAlert[];
  events?: ScenarioTimelineEvent[];
}

/** Target figures the exercise is scored against (shown in the after-action report). */
export interface ScenarioMetrics {
  detection_s: number; ack_s: number; compliance_pct: number; route_decision: ScenarioText;
}

export interface ScenarioConfig {
  id: string; name: ScenarioText; description?: ScenarioText;
  category?: ScenarioText; difficulty?: 'easy' | 'medium' | 'hard'; nominal_minutes?: number;
  duration_ms: number; loop?: boolean;
  center?: { lat: number; lon: number };
  steps: ScenarioStep[];
  metrics?: ScenarioMetrics;
}

/**
 * Where a scenario position or incident happens. Resolution: a point `frac` (0–1) along PACE route `route` of
 * the running plan, else a unit's current position, else a facility (POI id or kind), else the first restricted
 * zone, else the branch centre; then `side_m` is applied perpendicular to the route (positive = right of travel)
 * and `east_m` / `north_m` as a plain offset.
 */
export interface ScenarioAnchor {
  route?: 'P' | 'A' | 'C' | 'E'; frac?: number; side_m?: number;
  unit?: string; poi?: string; restricted?: boolean;
  east_m?: number; north_m?: number;
}

export type ScenarioPositionDef = Omit<ScenarioPosition, 'lat' | 'lon'> & { at: ScenarioAnchor };
export type ScenarioIncidentDef = Omit<ScenarioIncident, 'lat' | 'lon'> & { at: ScenarioAnchor };
export interface ScenarioStepDef extends Omit<ScenarioStep, 'positions' | 'incidents'> {
  positions?: ScenarioPositionDef[]; incidents?: ScenarioIncidentDef[];
}
export interface ScenarioDef extends Omit<ScenarioConfig, 'steps' | 'center'> { steps: ScenarioStepDef[] }

export interface ScenarioReport {
  scenario_id: string; scenario_name: string;
  started_at: string; finished_at: string; duration_ms: number;
  total_steps: number; events_emitted: number;
  positions_emitted: number; incidents_emitted: number; alerts_emitted: number;
}
