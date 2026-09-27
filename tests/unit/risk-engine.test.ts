/**
 * Phase 12: Unit tests — Risk Engine
 */
import { describe, it, expect } from 'vitest';
import { RiskEngine } from '../../services/threat/risk-engine';

describe('RiskEngine.calculate', () => {
  it('returns critical level for high product', () => {
    const result = RiskEngine.calculate({
      severity: 0.9, likelihood: 0.9, exposure: 0.9, data_confidence: 0.9,
    });
    expect(result.level).toBe('critical');
    expect(result.score).toBeGreaterThanOrEqual(0.6);
    expect(result.color).toBe('#EF4444');
  });

  it('returns low level for low product', () => {
    const result = RiskEngine.calculate({
      severity: 0.1, likelihood: 0.1, exposure: 0.1, data_confidence: 0.5,
    });
    expect(result.level).toBe('low');
    expect(result.score).toBeLessThan(0.15);
    expect(result.color).toBe('#22C55E');
  });

  it('returns medium level for mid product', () => {
    const result = RiskEngine.calculate({
      severity: 0.5, likelihood: 0.5, exposure: 0.5, data_confidence: 0.5,
    });
    expect(result.level).toBe('medium');
  });

  it('score is exactly severity × likelihood × exposure × confidence', () => {
    const input = { severity: 0.5, likelihood: 0.6, exposure: 0.7, data_confidence: 0.8 };
    const result = RiskEngine.calculate(input);
    const expected = Math.round(0.5 * 0.6 * 0.7 * 0.8 * 1000) / 1000;
    expect(result.score).toBe(expected);
  });

  it('provenance includes all factors', () => {
    const result = RiskEngine.calculate({
      severity: 0.5, likelihood: 0.5, exposure: 0.5, data_confidence: 0.5, source: 'test',
    });
    expect(result.provenance).toContain('severity=');
    expect(result.provenance).toContain('source=test');
  });

  it('human_validated is false by default', () => {
    const result = RiskEngine.calculate({
      severity: 0.5, likelihood: 0.5, exposure: 0.5, data_confidence: 0.5,
    });
    expect(result.human_validated).toBe(false);
  });
});

describe('RiskEngine.buildGrid', () => {
  it('returns 100 cells for 10×10 grid', () => {
    const grid = RiskEngine.buildGrid([], { lat: 35.689, lon: 51.389 }, 1, 10);
    expect(grid).toHaveLength(100);
  });

  it('each cell has lat, lon, risk', () => {
    const grid = RiskEngine.buildGrid([], { lat: 35.689, lon: 51.389 }, 1, 5);
    for (const cell of grid) {
      expect(cell).toHaveProperty('lat');
      expect(cell).toHaveProperty('lon');
      expect(cell.risk).toHaveProperty('level');
    }
  });

  it('cells near incident have higher risk', () => {
    const incidents = [{
      incident_id: 'i1',
      type: 'test',
      severity: 'critical' as const,
      location: { lat: 35.689, lon: 51.389 },
      radius_m: 500,
      observed_at: new Date().toISOString(),
      valid_until: new Date().toISOString(),
      confidence: 0.9,
      evidence: [],
      source: 'test',
      human_validation_status: 'pending' as const,
    }];
    const grid = RiskEngine.buildGrid(incidents, { lat: 35.689, lon: 51.389 }, 1, 5);
    const maxScore = Math.max(...grid.map((c) => c.risk.score));
    expect(maxScore).toBeGreaterThan(0);
  });
});

describe('RiskEngine.assessPoint', () => {
  const inc = (id: string, severity: 'low' | 'medium' | 'high' | 'critical', lat: number, lon: number, radius_m: number, confidence = 0.9) => ({
    incident_id: id, type: 't', severity, location: { lat, lon }, radius_m, observed_at: '', valid_until: '', confidence, evidence: [], source: 's', human_validation_status: 'confirmed' as const,
  });

  it('is zero outside every incident radius', () => {
    expect(RiskEngine.assessPoint([inc('a', 'critical', 35.7, 51.4, 100)], 35.6, 51.3).score).toBe(0);
  });

  it('peaks at the incident and falls off with distance', () => {
    const list = [inc('a', 'critical', 35.7, 51.4, 1000)];
    const center = RiskEngine.assessPoint(list, 35.7, 51.4);
    const edge = RiskEngine.assessPoint(list, 35.7063, 51.4);
    expect(center.score).toBeGreaterThan(edge.score);
    expect(center.input.severity).toBe(1);
    expect(center.input.evidence).toEqual(['a']);
  });

  it('corroborating incidents raise likelihood and the level', () => {
    const one = RiskEngine.assessPoint([inc('a', 'critical', 35.7, 51.4, 500)], 35.7, 51.4);
    const three = RiskEngine.assessPoint([inc('a', 'critical', 35.7, 51.4, 500), inc('b', 'high', 35.7, 51.4, 500), inc('c', 'high', 35.7, 51.4, 500)], 35.7, 51.4);
    expect(three.input.likelihood).toBeGreaterThan(one.input.likelihood);
    expect(three.level).toBe('critical');
  });
});

describe('RiskEngine.distanceM', () => {
  it('returns ~0 for identical points', () => {
    expect(RiskEngine.distanceM(35.0, 51.0, 35.0, 51.0)).toBeCloseTo(0, 0);
  });

  it('returns correct distance for known points', () => {
    const d = RiskEngine.distanceM(35.689, 51.389, 35.699, 51.389);
    expect(d).toBeGreaterThan(900);
    expect(d).toBeLessThan(1200);
  });
});
