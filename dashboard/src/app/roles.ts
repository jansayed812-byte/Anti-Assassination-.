/**
 * Adaptive home: each role lands on its workspace and gets a "for you today" list derived from live data.
 */
import type { AlertLevel, Role } from '../api/types';
import { MODES, useOps, type Mode } from '../stores/ops';
import { pick, translate, type Lang } from '../i18n';
import { can } from './permissions';

export const CONSOLE_ROLES: Role[] = ['operator', 'analyst', 'planner', 'commander', 'technical'];
export const ROLE_HOME: Record<Role, Mode> = { operator: 'live', commander: 'live', analyst: 'analysis', planner: 'planning', technical: 'assets', admin: 'admin', viewer: 'live' };
export const ROLE_ICON: Record<Role, string> = { operator: 'headset', analyst: 'chart-line-up', planner: 'path', commander: 'star', technical: 'wrench', admin: 'shield-check', viewer: 'eye' };

/** Workspace tabs this role may open — the Admin workspace needs `read:admin`, same as its API routes. */
export const visibleModes = (role: Role | null) => MODES.filter((m) => m.id !== 'admin' || can(role, 'read:admin'));

export interface RoleTask { text: string; mode: Mode; level: AlertLevel; tab?: 'alerts' | 'units'; plan?: string; dev?: string; zone?: string }

type S = ReturnType<typeof useOps.getState>;

export function roleTasks(role: Role, s: S, lang: Lang): RoleTask[] {
  const t = (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) => translate(lang, k, v);
  const open = s.alerts.filter((a) => a.status === 'active' || a.status === 'escalated');
  const crit = open.filter((a) => a.level === 'critical' && a.status === 'active');
  const escalated = open.filter((a) => a.status === 'escalated');
  const running = s.plans.find((p) => p.status === 'running');
  const pending = s.plans.filter((p) => p.status === 'pending_approval');
  const lost = Object.values(s.units).filter((u) => u.comms === 'lost');
  const pendingDet = s.detections.filter((d) => d.status === 'pending');
  const hotCells = s.cells.filter((c) => c.level === 'high' || c.level === 'critical').length;
  const risky = s.plans.filter((p) => p.status !== 'closed').flatMap((p) => p.pace.filter((r) => r.max_risk > 0.5).map((r) => ({ p, r })));
  const blindOnRoutes = s.blindspots.filter((z) => z.routes.length > 0);
  const devs = s.devices.filter((d) => d.state === 'warn' || d.state === 'off');
  const linksDown = s.sync.filter((x) => x.link === 'down');
  const out: RoleTask[] = [];
  const push = (cond: unknown, task: RoleTask) => { if (cond) out.push(task); };

  switch (role) {
    case 'operator':
    case 'viewer':
      push(crit.length, { text: t('task.critAck', { n: crit.length }), mode: 'live', level: 'critical', tab: 'alerts' });
      push(running, { text: t('task.alphaRoute', { k: running?.active_route ?? '' }), mode: 'live', level: 'info', tab: 'units' });
      for (const u of lost) out.push({ text: t('task.commsLost', { name: pick(u.name, lang) }), mode: 'live', level: 'error', tab: 'units' });
      break;
    case 'analyst':
      push(pendingDet.length, { text: t('task.detections', { n: pendingDet.length }), mode: 'analysis', level: 'warning' });
      push(blindOnRoutes.length, { text: t('task.blind', { n: blindOnRoutes.length }), mode: 'analysis', level: 'warning', zone: blindOnRoutes[0]?.id });
      push(hotCells, { text: t('task.riskGrid', { n: hotCells }), mode: 'analysis', level: 'info' });
      break;
    case 'planner':
      for (const { p, r } of risky.slice(0, 2)) out.push({ text: t('task.planRisk', { id: p.id, k: r.k }), mode: 'planning', level: 'warning', plan: p.id });
      push(blindOnRoutes.length, { text: t('task.blind', { n: blindOnRoutes.length }), mode: 'analysis', level: 'warning', zone: blindOnRoutes[0]?.id });
      push(running, { text: t('task.planRunning', { id: running?.id ?? '', k: running?.active_route ?? '' }), mode: 'live', level: 'info' });
      for (const p of pending) out.push({ text: t('task.planPending', { id: p.id }), mode: 'planning', level: 'info', plan: p.id });
      break;
    case 'commander':
      for (const p of pending) out.push({ text: t('task.planPending', { id: p.id }), mode: 'planning', level: 'warning', plan: p.id });
      push(escalated.length, { text: t('task.escalated', { n: escalated.length }), mode: 'live', level: 'critical', tab: 'alerts' });
      push(crit.length, { text: t('task.critAck', { n: crit.length }), mode: 'live', level: 'critical', tab: 'alerts' });
      break;
    case 'technical':
    case 'admin':
      for (const l of linksDown) out.push({ text: t('task.syncDown', { b: l.branch }), mode: 'admin', level: 'error' });
      for (const d of devs) out.push({ text: t('task.deviceWarn', { name: pick(d.name, lang), detail: pick(d.detail, lang) }), mode: 'assets', level: d.state === 'off' ? 'error' : 'warning', dev: d.id });
      break;
  }
  return out.slice(0, 4);
}

export { can } from './permissions';
