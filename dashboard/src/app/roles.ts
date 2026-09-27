/**
 * Adaptive home: each role lands on its workspace and gets a "for you today" list derived from live data.
 */
import type { Role, AlertLevel } from '../api/types';
import type { Mode } from '../stores/ops';
import { useOps } from '../stores/ops';
import { translate } from '../i18n';

export const CONSOLE_ROLES: Role[] = ['operator', 'analyst', 'planner', 'commander', 'technical'];
export const ROLE_HOME: Record<Role, Mode> = { operator: 'live', commander: 'live', analyst: 'analysis', planner: 'planning', technical: 'assets', admin: 'admin', viewer: 'live' };
export const ROLE_INITIALS: Record<Role, string> = { operator: 'اپ', analyst: 'تح', planner: 'بر', commander: 'فر', technical: 'فن', admin: 'مد', viewer: 'نا' };

export interface RoleTask { text: string; mode: Mode; level: AlertLevel; tab?: 'alerts' | 'units'; plan?: string; dev?: string; adminTab?: 'sec' }

type S = ReturnType<typeof useOps.getState>;

export function roleTasks(role: Role, s: S): RoleTask[] {
  const t = (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) => translate(s.lang, k, v);
  const open = s.alerts.filter((a) => a.status === 'active' || a.status === 'escalated');
  const crit = open.filter((a) => a.level === 'critical' && a.status === 'active');
  const escalated = open.filter((a) => a.status === 'escalated');
  const running = s.plans.find((p) => p.status === 'running');
  const pending = s.plans.filter((p) => p.status === 'pending_approval');
  const lost = Object.values(s.units).filter((u) => u.comms === 'lost');
  const pendingDet = s.detections.filter((d) => d.status === 'pending');
  const hotCells = s.cells.filter((c) => c.level === 'high' || c.level === 'critical').length;
  const risky = s.plans.filter((p) => p.status !== 'closed').flatMap((p) => p.pace.filter((r) => r.risk > 0.5).map((r) => ({ p, r })));
  const devs = s.devices.filter((d) => d.state === 'warn' || d.state === 'off');
  const out: RoleTask[] = [];
  const push = (cond: unknown, task: RoleTask) => { if (cond) out.push(task); };

  switch (role) {
    case 'operator':
    case 'viewer':
      push(crit.length, { text: t('task.critAck', { n: crit.length }), mode: 'live', level: 'critical', tab: 'alerts' });
      push(running, { text: t('task.alphaRoute', { k: running?.active_route ?? '' }), mode: 'live', level: 'info', tab: 'units' });
      for (const u of lost) out.push({ text: t('task.commsLost', { name: u.name }), mode: 'live', level: 'error', tab: 'units' });
      break;
    case 'analyst':
      push(pendingDet.length, { text: t('task.detections', { n: pendingDet.length }), mode: 'analysis', level: 'warning' });
      push(running, { text: t('task.analyze', { id: running?.id ?? '' }), mode: 'analysis', level: 'info' });
      push(hotCells, { text: t('task.riskGrid', { n: hotCells }), mode: 'analysis', level: 'info' });
      break;
    case 'planner':
      for (const { p, r } of risky.slice(0, 2)) out.push({ text: t('task.planRisk', { id: p.id, k: r.k }), mode: 'planning', level: 'warning', plan: p.id });
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
      for (const d of devs) out.push({ text: t('task.deviceWarn', { name: d.name, detail: d.detail }), mode: 'assets', level: d.state === 'off' ? 'error' : 'warning', dev: d.id });
      break;
  }
  return out.slice(0, 4);
}

export { can } from './permissions';
