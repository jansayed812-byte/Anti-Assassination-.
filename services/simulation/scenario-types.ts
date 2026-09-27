/**
 * Phase 6: Simulation Engine scenario type definitions
 */

export interface ScenarioPosition {
  source_id: string; lat: number; lon: number;
  alt_m?: number; speed_mps?: number; accuracy_m?: number; confidence?: number;
}

export interface ScenarioIncident {
  type: string; severity: 'low' | 'medium' | 'high' | 'critical';
  lat: number; lon: number; radius_m: number; confidence: number; evidence?: string[];
}

export interface ScenarioAlert {
  type: string; severity: 'low' | 'medium' | 'high' | 'critical'; message: string;
}

export interface ScenarioStep {
  time_offset_ms: number;
  positions?: ScenarioPosition[];
  incidents?: ScenarioIncident[];
  alerts?: ScenarioAlert[];
}

export interface ScenarioConfig {
  id: string; name: string; description?: string;
  duration_ms: number; loop?: boolean;
  center: { lat: number; lon: number };
  steps: ScenarioStep[];
}

export interface ScenarioReport {
  scenario_id: string; scenario_name: string;
  started_at: string; finished_at: string; duration_ms: number;
  total_steps: number; events_emitted: number;
  positions_emitted: number; incidents_emitted: number; alerts_emitted: number;
}
