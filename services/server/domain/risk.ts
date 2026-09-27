/**
 * Risk picture: the incident set feeding the risk model, and the hex risk grid pushed to clients.
 */
import { EventEmitter } from 'events';
import { RiskEngine, type IncidentEvent, type RiskLevel, type RiskResult } from '../../threat/risk-engine';
import { toLatLon, METERS_PER_UNIT, type XZ, type LatLon } from '../geo';

export interface RiskCell { id: string; q: number; r: number; lat: number; lon: number; score: number; level: RiskLevel }

const HEX_SIZE_UNITS = 4.4;
const HEX_CENTER: XZ = [-10, 0];
const HEX_RINGS = 6;

/** Axial hex layout (pointy-top) covering the operations area; 127 cells for 6 rings. */
export const HEX_CELLS: Array<{ id: string; q: number; r: number; xz: XZ }> = (() => {
  const out: Array<{ id: string; q: number; r: number; xz: XZ }> = [];
  for (let q = -HEX_RINGS; q <= HEX_RINGS; q++) for (let r = -HEX_RINGS; r <= HEX_RINGS; r++) {
    if (Math.abs(q + r) > HEX_RINGS) continue;
    out.push({ id: `h${q}_${r}`, q, r, xz: [HEX_CENTER[0] + HEX_SIZE_UNITS * Math.sqrt(3) * (q + r / 2), HEX_CENTER[1] + HEX_SIZE_UNITS * 1.5 * r] });
  }
  return out;
})();

export const HEX_RADIUS_M = HEX_SIZE_UNITS * METERS_PER_UNIT;

export class RiskModel extends EventEmitter {
  private incidents = new Map<string, IncidentEvent>();
  private counter = 0;

  add(input: Omit<IncidentEvent, 'incident_id' | 'observed_at' | 'valid_until'> & { incident_id?: string; ttl_s?: number }): IncidentEvent {
    const now = Date.now();
    const inc: IncidentEvent = {
      ...input,
      incident_id: input.incident_id ?? `INC-${String(++this.counter).padStart(4, '0')}`,
      observed_at: new Date(now).toISOString(),
      valid_until: new Date(now + 1000 * (input.ttl_s ?? 6 * 3600)).toISOString(),
    };
    this.incidents.set(inc.incident_id, inc);
    this.emit('changed');
    return inc;
  }

  remove(predicate: (i: IncidentEvent) => boolean): number {
    let n = 0;
    for (const [id, inc] of this.incidents) if (predicate(inc)) { this.incidents.delete(id); n++; }
    if (n) this.emit('changed');
    return n;
  }

  list(): IncidentEvent[] {
    const now = new Date().toISOString();
    return [...this.incidents.values()].filter((i) => i.valid_until > now && i.human_validation_status !== 'rejected');
  }

  assess(p: LatLon, marginM = 0, source = 'point'): RiskResult { return RiskEngine.assessPoint(this.list(), p.lat, p.lon, marginM, source); }

  grid(): RiskCell[] {
    const incidents = this.list();
    return HEX_CELLS.map(({ id, q, r, xz }) => {
      const p = toLatLon(xz);
      const risk = RiskEngine.assessPoint(incidents, p.lat, p.lon, HEX_RADIUS_M / 2, 'grid');
      return { id, q, r, ...p, score: risk.score, level: risk.level };
    });
  }
}
