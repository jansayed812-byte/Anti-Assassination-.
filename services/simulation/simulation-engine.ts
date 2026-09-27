/**
 * Phase 6: Simulation Engine
 * Plays a scenario on a virtual clock that supports pause/resume and speed changes.
 */
import { EventEmitter } from 'events';
import { scenarioText, type ScenarioConfig, type ScenarioStep, type ScenarioReport, type ScenarioTimelineEvent } from './scenario-types';

export type SimulationEvent =
  | { type: 'position'; data: unknown }
  | { type: 'incident'; data: unknown }
  | { type: 'alert'; data: unknown }
  | { type: 'timeline'; data: ScenarioTimelineEvent & { t_ms: number } }
  | { type: 'step_complete'; step: number }
  | { type: 'scenario_complete'; report: ScenarioReport };

export class SimulationEngine extends EventEmitter {
  private running = false;
  private started = false;
  private finished = false;
  private currentScenario: ScenarioConfig | null = null;
  private stepIndex = 0;
  private startTime = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private counters = { events: 0, positions: 0, incidents: 0, alerts: 0 };
  private speed = 1;
  private elapsedMs = 0;
  private resumedAt = 0;
  private pending: ScenarioStep[] = [];

  load(scenario: ScenarioConfig): void {
    this.stop();
    this.currentScenario = scenario;
    this.stepIndex = 0;
    this.elapsedMs = 0;
    this.started = false;
    this.finished = false;
    this.pending = [];
  }

  start(speed = this.speed): void {
    const scenario = this.currentScenario;
    if (!scenario || this.running) return;
    this.speed = speed;
    this.startTime = Date.now();
    this.counters = { events: 0, positions: 0, incidents: 0, alerts: 0 };
    this.elapsedMs = 0;
    this.stepIndex = 0;
    this.started = true;
    this.finished = false;
    this.pending = [...scenario.steps].sort((a, b) => a.time_offset_ms - b.time_offset_ms);
    this._schedule();
  }

  pause(): void {
    if (!this.running) return;
    this.elapsedMs = this.elapsed();
    this._clearTimers();
    this.running = false;
  }

  resume(): void {
    if (this.running || !this.started || this.finished) return;
    this._schedule();
  }

  setSpeed(speed: number): void {
    if (!(speed > 0)) throw new Error('speed must be positive');
    if (this.running) { this.pause(); this.speed = speed; this._schedule(); }
    else this.speed = speed;
  }

  stop(): void { this.running = false; this._clearTimers(); }
  isRunning(): boolean { return this.running; }
  isStarted(): boolean { return this.started; }
  isFinished(): boolean { return this.finished; }
  getSpeed(): number { return this.speed; }
  getScenario(): ScenarioConfig | null { return this.currentScenario; }

  /** Virtual scenario time elapsed, in ms. */
  elapsed(): number {
    if (!this.running) return this.elapsedMs;
    const d = this.currentScenario?.duration_ms ?? Infinity;
    return Math.min(d, this.elapsedMs + (Date.now() - this.resumedAt) * this.speed);
  }

  /** Progress 0–100. */
  progress(): number {
    const d = this.currentScenario?.duration_ms;
    if (!d) return 0;
    return this.finished ? 100 : Math.min(100, (this.elapsed() / d) * 100);
  }

  private _schedule(): void {
    const scenario = this.currentScenario!;
    this.running = true;
    this.resumedAt = Date.now();
    this.timers = [];
    for (const step of this.pending) {
      const wait = Math.max(0, (step.time_offset_ms - this.elapsedMs) / this.speed);
      this.timers.push(setTimeout(() => this._executeStep(step), wait));
    }
    this.timers.push(setTimeout(() => this._finish(), Math.max(0, (scenario.duration_ms - this.elapsedMs) / this.speed)));
  }

  private _clearTimers(): void { for (const t of this.timers) clearTimeout(t); this.timers = []; }

  private _executeStep(step: ScenarioStep): void {
    if (!this.running) return;
    this.pending = this.pending.filter((s) => s !== step);
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
    for (const ev of step.events ?? []) {
      this.emit('event', { type: 'timeline', data: { ...ev, t_ms: step.time_offset_ms } } as SimulationEvent);
      this.counters.events++;
    }
    this.stepIndex++;
    this.emit('event', { type: 'step_complete', step: this.stepIndex } as SimulationEvent);
  }

  private _finish(): void {
    const scenario = this.currentScenario!;
    const report: ScenarioReport = { scenario_id: scenario.id, scenario_name: scenarioText(scenario.name), started_at: new Date(this.startTime).toISOString(), finished_at: new Date().toISOString(), duration_ms: Date.now()-this.startTime, total_steps: scenario.steps.length, events_emitted: this.counters.events, positions_emitted: this.counters.positions, incidents_emitted: this.counters.incidents, alerts_emitted: this.counters.alerts };
    this.running = false;
    this.finished = true;
    this.elapsedMs = scenario.duration_ms;
    this.pending = [];
    this._clearTimers();
    this.emit('event', { type: 'scenario_complete', report } as SimulationEvent);
    if (scenario.loop) this.start();
  }
}
