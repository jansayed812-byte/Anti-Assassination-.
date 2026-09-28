import { describe, it, expect } from 'vitest';
import { AlertService, ACK_SECONDS, TransitionError } from '../../services/server/domain/alerts';

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (s: number) => { t += s * 1000; } };
}

describe('AlertService lifecycle', () => {
  it('sets the ACK deadline from the level', () => {
    const c = clock();
    const svc = new AlertService(c.now);
    for (const level of ['critical', 'error', 'warning', 'info'] as const) {
      const a = svc.create({ level, title: level });
      expect(a.deadline - c.now()).toBe(ACK_SECONDS[level] * 1000);
      expect(a.status).toBe('active');
    }
  });

  it('active → acknowledged → resolved, recording who did what', () => {
    const svc = new AlertService(clock().now);
    const a = svc.create({ level: 'error', title: 'x' });
    svc.acknowledge(a.id, 'maryam');
    const r = svc.resolve(a.id, 'maryam');
    expect(r.status).toBe('resolved');
    expect(r.history.map((h) => h.status)).toEqual(['active', 'acknowledged', 'resolved']);
    expect(r.history[2].by).toBe('maryam');
  });

  it('rejects invalid transitions', () => {
    const svc = new AlertService(clock().now);
    const a = svc.create({ level: 'warning', title: 'x' });
    expect(() => svc.resolve(a.id, 'u')).toThrow(TransitionError);
    svc.acknowledge(a.id, 'u');
    expect(() => svc.acknowledge(a.id, 'u')).toThrow(/cannot acknowledge/);
    expect(() => svc.acknowledge('nope', 'u')).toThrow(/not found/);
  });

  it('auto-escalates only active alerts past their deadline', () => {
    const c = clock();
    const svc = new AlertService(c.now);
    const crit = svc.create({ level: 'critical', title: 'c' });
    const warn = svc.create({ level: 'warning', title: 'w' });
    const acked = svc.create({ level: 'critical', title: 'a' });
    svc.acknowledge(acked.id, 'u');
    c.advance(59);
    expect(svc.tick()).toHaveLength(0);
    c.advance(2);
    const esc = svc.tick();
    expect(esc.map((a) => a.id)).toEqual([crit.id]);
    expect(svc.get(crit.id)!.history.at(-1)!.by).toBe('auto');
    expect(svc.get(warn.id)!.status).toBe('active');
    expect(svc.get(acked.id)!.status).toBe('acknowledged');
    expect(svc.tick()).toHaveLength(0);
  });

  it('an escalated alert can still be acknowledged', () => {
    const svc = new AlertService(clock().now);
    const a = svc.create({ level: 'critical', title: 'x', status: 'escalated' });
    expect(svc.acknowledge(a.id, 'cmd').status).toBe('acknowledged');
  });

  it('emits changed for every mutation and sorts by severity', () => {
    const svc = new AlertService(clock().now);
    const seen: string[] = [];
    svc.on('changed', (a) => seen.push(`${a.id}:${a.status}`));
    const i = svc.create({ level: 'info', title: 'i' });
    const c = svc.create({ level: 'critical', title: 'c' });
    svc.escalate(i.id, 'u');
    expect(seen).toEqual([`${i.id}:active`, `${c.id}:active`, `${i.id}:escalated`]);
    expect(svc.list()[0].id).toBe(c.id);
  });
});
