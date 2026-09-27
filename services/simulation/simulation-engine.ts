/**
 * Phase 6: Simulation Engine
 */
import { EventEmitter } from 'events';
import { ScenarioConfig, ScenarioStep, ScenarioReport } from './scenario-types';

export type SimulationEvent =
  | { type: 'position'; data: unknown }
  | { type: 'incident'; data: unknown }
  | { type: 'alert'; data: unknown }
  | { type: 'step_complete'; step: number }
  | { type: 'scenario_complete'; report: ScenarioReport };

export class SimulationEngine extends EventEmitter {
  private running = false;
  private currentScenario: ScenarioConfig | null = null;
  private stepIndex = 0;
  private startTime = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private counters = { events: 0, positions: 0, incidents: 0, alerts: 0 };

  load(scenario: ScenarioConfig): void { this.stop(); this.currentScenario = scenario; this.stepIndex = 0; }

  start(): void {
    const scenario = this.currentScenario;
    if (!scenario || this.running) return;
    this.running = true;
    this.startTime = Date.now();
    this.counters = { events: 0, positions: 0, incidents: 0, alerts: 0 };
    this.timers = [];
    for (const step of scenario.steps) this.timers.push(setTimeout(() => this._executeStep(step), step.time_offset_ms));
    this.timers.push(setTimeout(() => this._finish(), scenario.duration_ms));
  }

  stop(): void { this.running = false; for (const t of this.timers) clearTimeout(t); this.timers = []; }
  isRunning(): boolean { return this.running; }

  private _executeStep(step: ScenarioStep): void {
    if (!this.running) return;
    for (const pos of step.positions ?? []) {
      this.emit('event', { type: 'position', data: { source_id: pos.source_id, lat: pos.lat, lon: pos.lon, alt_m: pos.alt_m??0, speed_mps: pos.speed_mps??0, accuracy_m: pos.accuracy_m??5, confidence: pos.confidence??0.9, is_degraded: false, updated_at: new Date().toISOString() } } as SimulationEvent);
      this.counters.positions++; this.counters.events++;
    }
    for (const inc of step.incidents ?? []) {
      this.emit('event', { type: 'incident', data: { incident_id: `sim-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, ...inc, observed_at: new Date().toISOString(), human_validation_status: 'pending' } } as SimulationEvent);
      this.counters.incidents++; this.counters.events++;
    }
    for (const alert of step.alerts ?? []) {
      this.emit('event', { type: 'alert', data: { id: `sim-alert-${Date.now()}`, ...alert, at: new Date().toISOString(), acknowledged: false } } as SimulationEvent);
      this.counters.alerts++; this.counters.events++;
    }
    this.stepIndex++;
    this.emit('event', { type: 'step_complete', step: this.stepIndex } as SimulationEvent);
  }

  private _finish(): void {
    const scenario = this.currentScenario!;
    const report: ScenarioReport = { scenario_id: scenario.id, scenario_name: scenario.name, started_at: new Date(this.startTime).toISOString(), finished_at: new Date().toISOString(), duration_ms: Date.now()-this.startTime, total_steps: scenario.steps.length, events_emitted: this.counters.events, positions_emitted: this.counters.positions, incidents_emitted: this.counters.incidents, alerts_emitted: this.counters.alerts };
    this.running = false;
    this.emit('event', { type: 'scenario_complete', report } as SimulationEvent);
    if (scenario.loop) this.start();
  }
}
