/**
 * Phase 12: Unit tests — Simulation Engine
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SimulationEngine } from '../../services/simulation/simulation-engine';
import type { ScenarioConfig } from '../../services/simulation/scenario-types';

const SAMPLE_SCENARIO: ScenarioConfig = {
  id: 'test-01',
  name: 'آزمایش ساده',
  duration_ms: 500,
  loop: false,
  center: { lat: 35.689, lon: 51.389 },
  steps: [
    {
      time_offset_ms: 0,
      positions: [{ source_id: 'u1', lat: 35.689, lon: 51.389 }],
    },
    {
      time_offset_ms: 100,
      incidents: [{ type: 'test', severity: 'low', lat: 35.69, lon: 51.39, radius_m: 100, confidence: 0.8 }],
    },
    {
      time_offset_ms: 200,
      alerts: [{ type: 'test_alert', severity: 'medium', message: 'آزمایش' }],
    },
  ],
};

describe('SimulationEngine', () => {
  let engine: SimulationEngine;

  beforeEach(() => {
    engine = new SimulationEngine();
    vi.useFakeTimers();
  });

  it('starts and emits position events', async () => {
    engine.load(SAMPLE_SCENARIO);
    const events: unknown[] = [];
    engine.on('event', (e) => events.push(e));
    engine.start();
    expect(engine.isRunning()).toBe(true);
    vi.advanceTimersByTime(50);
    const posEvents = events.filter((e: any) => e.type === 'position');
    expect(posEvents.length).toBeGreaterThan(0);
  });

  it('emits incident events', () => {
    engine.load(SAMPLE_SCENARIO);
    const events: any[] = [];
    engine.on('event', (e) => events.push(e));
    engine.start();
    vi.advanceTimersByTime(150);
    expect(events.some((e) => e.type === 'incident')).toBe(true);
  });

  it('emits alert events', () => {
    engine.load(SAMPLE_SCENARIO);
    const events: any[] = [];
    engine.on('event', (e) => events.push(e));
    engine.start();
    vi.advanceTimersByTime(250);
    expect(events.some((e) => e.type === 'alert')).toBe(true);
  });

  it('emits scenario_complete with report', () => {
    engine.load(SAMPLE_SCENARIO);
    let report: any = null;
    engine.on('event', (e: any) => {
      if (e.type === 'scenario_complete') report = e.report;
    });
    engine.start();
    vi.advanceTimersByTime(600);
    expect(report).not.toBeNull();
    expect(report.scenario_id).toBe('test-01');
    expect(report.positions_emitted).toBe(1);
    expect(report.incidents_emitted).toBe(1);
    expect(report.alerts_emitted).toBe(1);
  });

  it('stops cleanly', () => {
    engine.load(SAMPLE_SCENARIO);
    engine.start();
    engine.stop();
    expect(engine.isRunning()).toBe(false);
  });
});
