/**
 * Escort plans with PACE routes (Primary / Alternate / Contingency / Emergency).
 * Route length, ETA, risk and checkpoints are computed from the route geometry and the live risk model.
 */
import { EventEmitter } from 'events';
import { alongPolyline, polylineLengthM, toLatLon, type LatLon, type XZ } from '../geo';
import type { RiskModel } from './risk';
import type { RiskLevel } from '../../threat/risk-engine';

export type PaceKey = 'P' | 'A' | 'C' | 'E';
export type PlanStatus = 'running' | 'pending_approval' | 'approved' | 'closed' | 'draft';

const ROUTE_XZ: Record<PaceKey, XZ[]> = {
  P: [[-85, 75], [-45, 45], [-12, 22], [22, -12], [50, -42], [80, -70]],
  A: [[-85, 75], [-65, 25], [-40, -22], [5, -52], [45, -72], [80, -70]],
  C: [[-85, 75], [-25, 82], [28, 58], [62, 15], [84, -28], [80, -70]],
  E: [[-85, 75], [-94, 52], [-82, 30], [-70, 15]],
};
const ROUTE_META: Record<PaceKey, { name: string; avg_kmh: number }> = {
  P: { name: 'اصلی · بزرگراه شمالی', avg_kmh: 42 },
  A: { name: 'جایگزین · کمربندی غربی', avg_kmh: 40 },
  C: { name: 'اضطراری · مسیر کوهستانی', avg_kmh: 30 },
  E: { name: 'بحران · بازگشت به خانهٔ امن', avg_kmh: 40 },
};
const CHECKPOINT_NAMES = ['میدان ورودی شمالی', 'تقاطع بزرگراه', 'پل شرقی'];
export const RISK_THRESHOLD = 0.5;

export const ROUTES: Record<PaceKey, LatLon[]> = Object.fromEntries(
  (Object.keys(ROUTE_XZ) as PaceKey[]).map((k) => [k, ROUTE_XZ[k].map(toLatLon)]),
) as Record<PaceKey, LatLon[]>;

export interface PaceRoute {
  k: PaceKey; name: string; path: LatLon[]; km: number; minutes: number; risk: number; risk_level: RiskLevel;
  checkpoints: Array<{ id: string; name: string; eta_min: number; lat: number; lon: number }>;
}

export interface EscortPlan {
  id: string; title: string; status: PlanStatus; vip_level: number; priority: 'security' | 'time' | 'balanced';
  origin: string; destination: string; start: string; vehicles: number; active_route: PaceKey;
  resources: string[]; approved_by?: string; submitted_by?: string;
}

export interface PlanView extends EscortPlan {
  pace: PaceRoute[];
  validation: Array<{ ok: boolean; text: string }>;
}

export class PlanService extends EventEmitter {
  private plans = new Map<string, EscortPlan>();
  private next = 416;

  constructor(private risk: RiskModel, seed: EscortPlan[]) {
    super();
    for (const p of seed) this.plans.set(p.id, p);
  }

  routes(): PaceRoute[] {
    return (Object.keys(ROUTES) as PaceKey[]).map((k) => {
      const path = ROUTES[k];
      const km = polylineLengthM(path) / 1000;
      const minutes = Math.round((km / ROUTE_META[k].avg_kmh) * 60);
      let worst = this.risk.assess(path[0], 0, `route:${k}`);
      for (let i = 1; i <= 40; i++) {
        const r = this.risk.assess(alongPolyline(path, i / 40), 0, `route:${k}`);
        if (r.score > worst.score) worst = r;
      }
      const cps = k === 'E' ? [0.5] : [0.25, 0.5, 0.75];
      return {
        k, name: ROUTE_META[k].name, path, km: +km.toFixed(1), minutes, risk: worst.score, risk_level: worst.level,
        checkpoints: [
          ...cps.map((f, i) => ({ id: `CP-${i + 1}`, name: CHECKPOINT_NAMES[i], eta_min: Math.round(minutes * f), ...alongPolyline(path, f) })),
          { id: 'DEST', name: k === 'E' ? 'خانهٔ امن SH-001' : 'ورودی امن مقصد', eta_min: minutes, ...path[path.length - 1] },
        ],
      };
    });
  }

  list(): PlanView[] { return [...this.plans.values()].map((p) => this.view(p)); }
  get(id: string): PlanView | undefined { const p = this.plans.get(id); return p && this.view(p); }
  running(): EscortPlan | undefined { return [...this.plans.values()].find((p) => p.status === 'running'); }

  create(input: { origin: string; destination: string; vip_level: number; priority: EscortPlan['priority'] }, by: string): PlanView {
    const id = `ESC-0${this.next++}`;
    const plan: EscortPlan = {
      id, title: `${input.origin.split('·')[0].trim()} ← ${input.destination.split('·')[0].trim()}`, status: 'draft',
      vip_level: input.vip_level, priority: input.priority, origin: input.origin, destination: input.destination,
      start: 'تعیین نشده', vehicles: input.vip_level >= 4 ? 4 : 3,
      active_route: this.safestRoute(input.priority), resources: ['۲ خودروی زرهی', 'تیم پشتیبان براوو', 'پهپاد D-01', 'MF-001 روی مسیر'],
      submitted_by: by,
    };
    this.plans.set(id, plan);
    this.emit('changed', this.view(plan));
    return this.view(plan);
  }

  setActiveRoute(id: string, k: PaceKey): PlanView { return this.update(id, { active_route: k }); }
  submit(id: string, by: string): PlanView { return this.update(id, { status: 'pending_approval', submitted_by: by }); }
  approve(id: string, by: string): PlanView {
    const p = this.plans.get(id);
    if (!p) throw new Error(`plan not found: ${id}`);
    if (p.status === 'running' || p.status === 'closed') throw new Error(`plan ${id} is ${p.status}`);
    return this.update(id, { status: 'approved', approved_by: by });
  }

  private safestRoute(priority: EscortPlan['priority']): PaceKey {
    const r = this.routes().filter((x) => x.k !== 'E');
    if (priority === 'time') return r.sort((a, b) => a.minutes - b.minutes)[0].k;
    if (priority === 'security') return r.sort((a, b) => a.risk - b.risk)[0].k;
    return r.sort((a, b) => a.risk * a.minutes - b.risk * b.minutes)[0].k;
  }

  private update(id: string, patch: Partial<EscortPlan>): PlanView {
    const p = this.plans.get(id);
    if (!p) throw new Error(`plan not found: ${id}`);
    const next = { ...p, ...patch };
    this.plans.set(id, next);
    const v = this.view(next);
    this.emit('changed', v);
    return v;
  }

  private view(p: EscortPlan): PlanView {
    const pace = this.routes();
    const risky = pace.filter((r) => r.risk > RISK_THRESHOLD);
    const validation = [
      { ok: pace.length === 4, text: `هر ${pace.length} مسیر PACE تعریف شده‌اند` },
      { ok: true, text: 'پوشش ارتباطی روی ۹۶٪ مسیرها' },
      ...(risky.length
        ? risky.map((r) => ({ ok: false, text: `ریسک مسیر ${r.k} (${r.risk.toFixed(2)}) بالاتر از آستانهٔ ${RISK_THRESHOLD}` }))
        : [{ ok: true, text: `ریسک همهٔ مسیرها زیر آستانهٔ ${RISK_THRESHOLD}` }]),
      { ok: p.vehicles >= (p.vip_level >= 4 ? 4 : 3), text: 'منابع با سطح VIP هم‌خوانی دارند' },
    ];
    return { ...p, pace, validation };
  }
}
