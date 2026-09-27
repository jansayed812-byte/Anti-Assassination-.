/**
 * Scenario runner around SimulationEngine: one active scenario per branch, with speed/pause control, a timeline
 * for the console and an after-action report once it completes. Scenario files are branch-agnostic
 * (ScenarioDef with anchors); anchors are resolved against the branch geography when a run starts.
 */
import { EventEmitter } from 'events';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { SimulationEngine, type SimulationEvent } from '../../simulation/simulation-engine';
import type { ScenarioAnchor, ScenarioConfig, ScenarioDef, ScenarioMetrics, ScenarioReport, ScenarioText } from '../../simulation/scenario-types';
import type { LatLon } from '../geo';
import { asTri } from '../i18n/messages';
import type { Tri } from '../i18n/types';

export interface TimelineEntry { t_ms: number; message: Tri; level: 'critical' | 'error' | 'warning' | 'info' }

export interface SimStatus {
  scenario_id: string | null; running: boolean; finished: boolean; progress: number; speed: number;
  elapsed_ms: number; duration_ms: number; events: TimelineEntry[];
}

export interface ScenarioMeta {
  id: string; name: Tri; description: Tri; category: Tri; difficulty: ScenarioDef['difficulty']; nominal_minutes?: number;
  duration_ms: number; step_count: number; metrics?: Omit<ScenarioMetrics, 'route_decision'> & { route_decision: Tri };
}

export interface AfterActionReport {
  scenario_id: string; scenario_name: Tri; category: Tri; generated_at: string; branch: string;
  report: ScenarioReport; timeline: TimelineEntry[]; metrics: ScenarioMeta['metrics'];
}

export function loadScenarios(dir: string): ScenarioDef[] {
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as ScenarioDef);
}

const tx = (t: ScenarioText | undefined): Tri => asTri(t ?? '');
const round = (p: LatLon) => ({ lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6) });

/** Turns a scenario definition into a playable config by resolving every anchor to coordinates. */
export function resolveScenario(def: ScenarioDef, anchor: (a: ScenarioAnchor) => LatLon): ScenarioConfig {
  return {
    ...def,
    steps: def.steps.map((s) => ({
      ...s,
      positions: s.positions?.map(({ at, ...p }) => ({ ...p, ...round(anchor(at)) })),
      incidents: s.incidents?.map(({ at, ...i }) => ({ ...i, ...round(anchor(at)) })),
    })),
  };
}

export class SimService extends EventEmitter {
  private engine = new SimulationEngine();
  private active: ScenarioConfig | null = null;
  private timeline: TimelineEntry[] = [];
  private reports = new Map<string, AfterActionReport>();

  constructor(private scenarios: ScenarioDef[], private anchor: (a: ScenarioAnchor) => LatLon, private branch = 'MZR') {
    super();
    this.engine.on('event', (e: SimulationEvent) => this.onEvent(e));
  }

  list(): ScenarioMeta[] { return this.scenarios.map((s) => this.meta(s)); }

  meta(s: ScenarioDef): ScenarioMeta {
    return {
      id: s.id, name: tx(s.name), description: tx(s.description), category: tx(s.category), difficulty: s.difficulty,
      nominal_minutes: s.nominal_minutes, duration_ms: s.duration_ms, step_count: s.steps.length,
      metrics: s.metrics && { ...s.metrics, route_decision: tx(s.metrics.route_decision) },
    };
  }

  find(id: string): ScenarioDef | undefined { return this.scenarios.find((s) => s.id === id); }
  activeConfig(): ScenarioConfig | null { return this.active; }

  run(id: string, speed?: number): SimStatus {
    const s = this.find(id);
    if (!s) throw new Error(`scenario not found: ${id}`);
    if (this.active?.id === id && this.engine.isStarted() && !this.engine.isFinished()) {
      if (speed) this.engine.setSpeed(speed);
      this.engine.resume();
    } else {
      this.reset();
      this.active = resolveScenario(s, this.anchor);
      this.engine.load(this.active);
      this.emit('started', this.active);
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
  allReports(): AfterActionReport[] { return [...this.reports.values()]; }

  private onEvent(e: SimulationEvent): void {
    const s = this.active;
    if (!s) return;
    if (e.type === 'timeline') this.timeline.push({ t_ms: e.data.t_ms, message: tx(e.data.message), level: e.data.level });
    if (e.type === 'scenario_complete') {
      const def = this.find(s.id)!;
      this.reports.set(s.id, { scenario_id: s.id, scenario_name: tx(s.name), category: tx(s.category), generated_at: new Date().toISOString(), branch: this.branch, report: e.report, timeline: [...this.timeline], metrics: this.meta(def).metrics });
    }
    this.emit('event', e, s);
  }
}
