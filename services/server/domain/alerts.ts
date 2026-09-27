/**
 * Alert lifecycle: active → acknowledged → resolved; an active alert whose ACK deadline passes is
 * escalated automatically. Deadlines: critical 60 s, error 3 min, warning 10 min, info 30 min.
 */
import { EventEmitter } from 'events';

export type AlertLevel = 'critical' | 'error' | 'warning' | 'info';
export type AlertStatus = 'active' | 'acknowledged' | 'escalated' | 'resolved';

export const ACK_SECONDS: Record<AlertLevel, number> = { critical: 60, error: 180, warning: 600, info: 1800 };
export const LEVEL_RANK: Record<AlertLevel, number> = { critical: 4, error: 3, warning: 2, info: 1 };

export interface AlertHistoryEntry { at: string; status: AlertStatus; by: string }

export interface Alert {
  id: string; level: AlertLevel; title: string; src: string; unit: string | null;
  status: AlertStatus; created_at: string; deadline: number; history: AlertHistoryEntry[];
  source: 'system' | 'user' | 'simulation' | 'panic';
}

export interface NewAlert {
  level: AlertLevel; title: string; src?: string; unit?: string | null;
  source?: Alert['source']; status?: AlertStatus; ackInSeconds?: number;
}

export class TransitionError extends Error {}

const ALLOWED: Record<'acknowledge' | 'resolve' | 'escalate', AlertStatus[]> = {
  acknowledge: ['active', 'escalated'],
  resolve: ['acknowledged'],
  escalate: ['active', 'acknowledged'],
};

export class AlertService extends EventEmitter {
  private alerts = new Map<string, Alert>();
  private counter = 0;

  constructor(private now: () => number = Date.now) { super(); }

  list(): Alert[] {
    return [...this.alerts.values()].sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || b.created_at.localeCompare(a.created_at));
  }

  get(id: string): Alert | undefined { return this.alerts.get(id); }

  create(input: NewAlert, by = 'system'): Alert {
    if (!(input.level in ACK_SECONDS)) throw new TransitionError(`unknown level: ${input.level}`);
    const t = this.now();
    const status = input.status ?? 'active';
    const alert: Alert = {
      id: `ALR-${String(++this.counter).padStart(4, '0')}`, level: input.level, title: input.title,
      src: input.src ?? '', unit: input.unit ?? null, status, source: input.source ?? 'system',
      created_at: new Date(t).toISOString(),
      deadline: t + 1000 * (input.ackInSeconds ?? ACK_SECONDS[input.level]),
      history: [{ at: new Date(t).toISOString(), status, by }],
    };
    this.alerts.set(alert.id, alert);
    this.emit('changed', alert);
    return alert;
  }

  acknowledge(id: string, by: string): Alert { return this.transition(id, 'acknowledge', 'acknowledged', by); }
  resolve(id: string, by: string): Alert { return this.transition(id, 'resolve', 'resolved', by); }
  escalate(id: string, by: string): Alert { return this.transition(id, 'escalate', 'escalated', by); }

  /** Escalates every active alert whose ACK deadline has passed. Returns the escalated alerts. */
  tick(): Alert[] {
    const t = this.now();
    const escalated: Alert[] = [];
    for (const a of this.alerts.values()) {
      if (a.status === 'active' && a.deadline <= t) escalated.push(this.transition(a.id, 'escalate', 'escalated', 'auto'));
    }
    return escalated;
  }

  openCount(): number { return this.list().filter((a) => a.status === 'active' || a.status === 'escalated').length; }

  private transition(id: string, action: keyof typeof ALLOWED, to: AlertStatus, by: string): Alert {
    const a = this.alerts.get(id);
    if (!a) throw new TransitionError(`alert not found: ${id}`);
    if (!ALLOWED[action].includes(a.status)) throw new TransitionError(`cannot ${action} an alert that is ${a.status}`);
    const next: Alert = { ...a, status: to, history: [...a.history, { at: new Date(this.now()).toISOString(), status: to, by }] };
    this.alerts.set(id, next);
    this.emit('changed', next);
    return next;
  }
}
