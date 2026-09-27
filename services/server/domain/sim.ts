/**
 * Scenario runner around SimulationEngine: one active scenario at a time, with speed/pause control,
 * a timeline for the console and an after-action report once it completes.
 */
import { EventEmitter } from 'events';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { SimulationEngine, type SimulationEvent } from '../../simulation/simulation-engine';
import type { ScenarioConfig, ScenarioReport } from '../../simulation/scenario-types';

export interface TimelineEntry { t_ms: number; message: string; level: 'critical' | 'error' | 'warning' | 'info' }

export interface SimStatus {
  scenario_id: string | null; running: boolean; finished: boolean; progress: number; speed: number;
  elapsed_ms: number; duration_ms: number; events: TimelineEntry[];
}

export interface AfterActionReport {
  scenario_id: string; scenario_name: string; category?: string; generated_at: string;
  report: ScenarioReport; timeline: TimelineEntry[]; metrics: ScenarioConfig['metrics'];
}

export function loadScenarios(dir: string): ScenarioConfig[] {
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as ScenarioConfig);
}

export class SimService extends EventEmitter {
  private engine = new SimulationEngine();
  private active: ScenarioConfig | null = null;
  private timeline: TimelineEntry[] = [];
  private reports = new Map<string, AfterActionReport>();

  constructor(private scenarios: ScenarioConfig[]) {
    super();
    this.engine.on('event', (e: SimulationEvent) => this.onEvent(e));
  }

  list(): Array<Omit<ScenarioConfig, 'steps'> & { step_count: number }> {
    return this.scenarios.map(({ steps, ...meta }) => ({ ...meta, step_count: steps.length }));
  }

  find(id: string): ScenarioConfig | undefined { return this.scenarios.find((s) => s.id === id); }

  run(id: string, speed?: number): SimStatus {
    const s = this.find(id);
    if (!s) throw new Error(`scenario not found: ${id}`);
    if (this.active?.id === id && this.engine.isStarted() && !this.engine.isFinished()) {
      if (speed) this.engine.setSpeed(speed);
      this.engine.resume();
    } else {
      this.reset();
      this.active = s;
      this.engine.load(s);
      this.emit('started', s);
      this.engine.start(speed ?? this.engine.getSpeed());
    }
    return this.status();
  }

  pause(): SimStatus { this.engine.pause(); return this.status(); }
  setSpeed(speed: number): SimStatus { this.engine.setSpeed(speed); return this.status(); }

  reset(): SimStatus {
    this.engine.stop();
    const prev = this.active;
    this.active = null;
    this.timeline = [];
    if (prev) this.emit('reset', prev);
    return this.status();
  }

  status(): SimStatus {
    return {
      scenario_id: this.active?.id ?? null, running: this.engine.isRunning(), finished: this.engine.isFinished() && !!this.active,
      progress: this.active ? +this.engine.progress().toFixed(1) : 0, speed: this.engine.getSpeed(),
      elapsed_ms: this.active ? Math.round(this.engine.elapsed()) : 0, duration_ms: this.active?.duration_ms ?? 0,
      events: [...this.timeline],
    };
  }

  report(id: string): AfterActionReport | undefined { return this.reports.get(id); }

  private onEvent(e: SimulationEvent): void {
    const s = this.active;
    if (!s) return;
    if (e.type === 'timeline') this.timeline.push({ t_ms: e.data.t_ms, message: e.data.message, level: e.data.level });
    if (e.type === 'scenario_complete') {
      this.reports.set(s.id, { scenario_id: s.id, scenario_name: s.name, category: s.category, generated_at: new Date().toISOString(), report: e.report, timeline: [...this.timeline], metrics: s.metrics });
    }
    this.emit('event', e, s);
  }
}
