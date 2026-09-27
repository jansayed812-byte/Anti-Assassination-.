import { describe, it, expect } from 'vitest';
import { RealtimeBus, integrityOf } from '../../services/server/realtime';
import { EnvelopeTracker, Outbox } from '../../dashboard/src/realtime/envelopes';

describe('RealtimeBus', () => {
  it('numbers envelopes and signs them with a sha256 integrity hash', () => {
    const bus = new RealtimeBus();
    const a = bus.publish('alerts', { id: 1 });
    const b = bus.publish('alerts', { id: 2 });
    expect(b.seq).toBe(a.seq + 1);
    expect(a.integrity).toBe(integrityOf('alerts', a.seq, { id: 1 }));
    expect(a.integrity).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('replays missed envelopes, collapsing high-rate channels to the latest', () => {
    const bus = new RealtimeBus();
    const start = bus.publish('telemetry', { n: 0 }).seq;
    bus.publish('alerts', { id: 'A' });
    bus.publish('telemetry', { n: 1 });
    bus.publish('plans', { id: 'P' });
    bus.publish('telemetry', { n: 2 });
    const replay = bus.since(start);
    expect(replay.map((e) => e.channel)).toEqual(['alerts', 'plans', 'telemetry']);
    expect(replay.at(-1)!.data).toEqual({ n: 2 });
    expect(bus.since(bus.currentSeq())).toEqual([]);
  });

  it('keeps a bounded buffer', () => {
    const bus = new RealtimeBus(3);
    for (let i = 0; i < 10; i++) bus.publish('alerts', { i });
    expect(bus.size()).toBe(3);
    expect(bus.since(0).map((e) => (e.data as { i: number }).i)).toEqual([7, 8, 9]);
  });
});

describe('EnvelopeTracker', () => {
  it('drops duplicates by integrity and tracks the highest seq', () => {
    const t = new EnvelopeTracker();
    expect(t.accept({ seq: 5, integrity: 'sha256:a' })).toBe(true);
    expect(t.accept({ seq: 5, integrity: 'sha256:a' })).toBe(false);
    expect(t.accept({ seq: 3, integrity: 'sha256:b' })).toBe(true);
    expect(t.lastSeq).toBe(5);
  });
});

describe('Outbox', () => {
  it('replays queued actions in order and empties even when some fail', async () => {
    const box = new Outbox(2);
    box.push({ method: 'POST', path: '/a' });
    box.push({ method: 'POST', path: '/b' });
    box.push({ method: 'PATCH', path: '/c' });
    expect(box.size()).toBe(2);
    const sent: string[] = [];
    const n = await box.drain(async (a) => { sent.push(a.path); if (a.path === '/b') throw new Error('409'); });
    expect(sent).toEqual(['/b', '/c']);
    expect(n).toBe(2);
    expect(box.size()).toBe(0);
  });
});
