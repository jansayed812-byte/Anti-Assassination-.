/**
 * Escort plans: origin/destination, VIP level and the four PACE routes computed by the RoutePlanner on the
 * branch road graph. Routes can be edited manually (waypoints); each edit bumps the route version, and editing
 * an approved plan sends it back for approval.
 */
import { EventEmitter } from 'events';
import type { LatLon } from '../geo';
import { L, asTri } from '../i18n/messages';
import type { LText, Tri } from '../i18n/types';
import { PACE_KEYS, type PaceKey, type RoutePlan, type RoutePlanner } from '../routing/planner';

export type PlanStatus = 'running' | 'pending_approval' | 'approved' | 'closed' | 'draft';
export type Priority = 'security' | 'time' | 'balanced';
export interface Place { name: LText; lat: number; lon: number }
export interface RouteState { waypoints: LatLon[]; edited: boolean; version: number; edited_by?: string; edited_at?: number }

export interface EscortPlan {
  id: string; title: LText; status: PlanStatus; vip_level: number; priority: Priority;
  origin: Place; destination: Place; start: LText; vehicles: number; active_route: PaceKey; resources: LText[];
  routes: Record<PaceKey, RouteState>; approved_by?: string; submitted_by?: string; version: number;
}

export interface PlanView extends EscortPlan { pace: RoutePlan[]; validation: Array<{ ok: boolean; text: Tri }> }

export const RISK_THRESHOLD = 0.5;

/** "origin → destination" in each language (the arrow points along the reading direction). */
export function planTitle(origin: Place, destination: Place): Tri {
  const o = asTri(origin.name), d = asTri(destination.name);
  return { dr: `${o.dr} ← ${d.dr}`, ps: `${o.ps} ← ${d.ps}`, en: `${o.en} → ${d.en}` };
}
export class PlanError extends Error { constructor(public code: string, message: string) { super(message); } }

const freshRoutes = (): Record<PaceKey, RouteState> => ({ P: { waypoints: [], edited: false, version: 1 }, A: { waypoints: [], edited: false, version: 1 }, C: { waypoints: [], edited: false, version: 1 }, E: { waypoints: [], edited: false, version: 1 } });

export class PlanService extends EventEmitter {
  private plans = new Map<string, EscortPlan>();
  private cache = new Map<string, { key: string; view: PlanView }>();
  private next = 416;

  constructor(private planner: RoutePlanner, private stamp: () => string, seed: Array<Omit<EscortPlan, 'routes' | 'version'>>) {
    super();
    for (const p of seed) this.plans.set(p.id, { ...p, routes: freshRoutes(), version: 1 });
  }

  list(): PlanView[] { return [...this.plans.values()].map((p) => this.view(p)); }
  get(id: string): PlanView | undefined { const p = this.plans.get(id); return p && this.view(p); }
  running(): PlanView | undefined { const p = [...this.plans.values()].find((x) => x.status === 'running'); return p && this.view(p); }
  raw(): EscortPlan[] { return [...this.plans.values()]; }

  /** Active-route corridors of plans that are live or about to be (used by the blind-spot analysis). */
  corridors(): Array<{ plan: string; route: string; path: LatLon[] }> {
    return this.list().filter((p) => p.status !== 'closed').flatMap((p) => {
      const r = p.pace.find((x) => x.k === p.active_route);
      return r ? [{ plan: p.id, route: r.k, path: r.path }] : [];
    });
  }

  create(input: { origin: Place; destination: Place; vip_level: number; priority: Priority; start?: LText }, by: string): PlanView {
    const id = `ESC-0${this.next++}`;
    const plan: EscortPlan = {
      id, title: planTitle(input.origin, input.destination),
      status: 'draft', vip_level: input.vip_level, priority: input.priority, origin: input.origin, destination: input.destination,
      start: input.start ?? L('plan.tbd'), vehicles: input.vip_level >= 4 ? 4 : 3, active_route: 'P',
      resources: [L('res.armored', { n: input.vip_level >= 4 ? 3 : 2 })], routes: freshRoutes(), submitted_by: by, version: 1,
    };
    this.plans.set(id, plan);
    const v = this.view(plan);
    if (input.priority === 'time') {
      const fastest = [...v.pace].filter((r) => r.k !== 'E').sort((a, b) => a.eta_min - b.eta_min)[0];
      if (fastest) plan.active_route = fastest.k;
    }
    this.emit('changed', this.view(plan));
    return this.view(plan);
  }

  setActiveRoute(id: string, k: PaceKey): PlanView { return this.update(id, (p) => ({ ...p, active_route: k })); }

  editRoute(id: string, k: PaceKey, waypoints: LatLon[], by: string): PlanView {
    if (!PACE_KEYS.includes(k)) throw new PlanError('bad_route', 'route must be P, A, C or E');
    if (waypoints.length > 12) throw new PlanError('too_many_waypoints', 'at most 12 waypoints');
    for (const w of waypoints) if (!Number.isFinite(w.lat) || !Number.isFinite(w.lon) || Math.abs(w.lat) > 90 || Math.abs(w.lon) > 180) throw new PlanError('bad_waypoint', 'invalid waypoint');
    return this.update(id, (p) => {
      if (p.status === 'closed') throw new PlanError('plan_closed', `plan ${id} is closed`);
      const prev = p.routes[k];
      const routes = { ...p.routes, [k]: { waypoints: waypoints.map((w) => ({ lat: +w.lat.toFixed(6), lon: +w.lon.toFixed(6) })), edited: waypoints.length > 0, version: prev.version + 1, edited_by: by, edited_at: Date.now() } };
      const reApprove = p.status === 'approved';
      return { ...p, routes, status: reApprove ? 'pending_approval' : p.status, approved_by: reApprove ? undefined : p.approved_by };
    });
  }

  submit(id: string, by: string): PlanView {
    return this.update(id, (p) => {
      if (p.status === 'running' || p.status === 'closed') throw new PlanError('plan_state', `plan ${id} is ${p.status}`);
      return { ...p, status: 'pending_approval', submitted_by: by };
    });
  }

  approve(id: string, by: string): PlanView {
    return this.update(id, (p) => {
      if (p.status === 'running' || p.status === 'closed') throw new PlanError('plan_state', `plan ${id} is ${p.status}`);
      return { ...p, status: 'approved', approved_by: by };
    });
  }

  private update(id: string, fn: (p: EscortPlan) => EscortPlan): PlanView {
    const p = this.plans.get(id);
    if (!p) throw new PlanError('plan_not_found', `plan not found: ${id}`);
    const next = { ...fn(p), version: p.version + 1 };
    this.plans.set(id, next);
    const v = this.view(next);
    this.emit('changed', v);
    return v;
  }

  /** Views are cached per plan version and risk/coverage state. */
  private view(p: EscortPlan): PlanView {
    const key = `${p.version}|${this.stamp()}`;
    const hit = this.cache.get(p.id);
    if (hit && hit.key === key) return hit.view;
    const wps = Object.fromEntries(PACE_KEYS.map((k) => [k, p.routes[k].waypoints])) as Record<PaceKey, LatLon[]>;
    const pace = this.planner.pace(p.origin, p.destination, wps);
    const risky = pace.filter((r) => r.max_risk > RISK_THRESHOLD);
    const primary = pace.find((r) => r.k === 'P');
    const minVehicles = p.vip_level >= 4 ? 4 : 3;
    const validation = [
      pace.length === 4 ? { ok: true, text: L('val.pace', { n: 4 }) } : { ok: false, text: L('val.paceMissing', { n: pace.length }) },
      { ok: (primary?.coverage_pct ?? 0) >= 90, text: L('val.coverage', { pct: primary?.coverage_pct ?? 0 }) },
      ...(risky.length ? risky.map((r) => ({ ok: false, text: L('val.risk', { k: r.k, risk: r.max_risk.toFixed(2), th: RISK_THRESHOLD }) })) : [{ ok: true, text: L('val.riskOk', { th: RISK_THRESHOLD }) }]),
      p.vehicles >= minVehicles ? { ok: true, text: L('val.resources') } : { ok: false, text: L('val.resourcesLow', { v: p.vip_level, n: minVehicles }) },
      ...PACE_KEYS.filter((k) => p.routes[k].edited).map((k) => ({ ok: true, text: L('val.edited', { k, v: p.routes[k].version }) })),
    ];
    const view: PlanView = { ...p, pace, validation };
    this.cache.set(p.id, { key, view });
    return view;
  }
}
