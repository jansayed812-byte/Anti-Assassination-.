import type { Envelope } from '../api/types';

/** Drops envelopes already applied: replays after a reconnect can overlap what was received live. */
export class EnvelopeTracker {
  lastSeq = 0;
  private seen = new Set<string>();
  private order: string[] = [];

  constructor(private memory = 5000) {}

  accept(env: Pick<Envelope, 'seq' | 'integrity'>): boolean {
    if (!env.integrity || this.seen.has(env.integrity)) return false;
    this.seen.add(env.integrity);
    this.order.push(env.integrity);
    if (this.order.length > this.memory) this.seen.delete(this.order.shift()!);
    if (env.seq > this.lastSeq) this.lastSeq = env.seq;
    return true;
  }

  reset(): void { this.lastSeq = 0; this.seen.clear(); this.order = []; }
}

export interface QueuedAction { id: string; method: 'POST' | 'PATCH' | 'PUT'; path: string; body?: unknown; queued_at: number }

/** Mutations made while disconnected, replayed in order once the link is back (capped like the edge buffer). */
export class Outbox {
  private items: QueuedAction[] = [];
  private n = 0;
  constructor(private capacity = 10_000) {}

  push(a: Omit<QueuedAction, 'id' | 'queued_at'>): QueuedAction {
    const item = { ...a, id: `q${++this.n}`, queued_at: Date.now() };
    this.items.push(item);
    if (this.items.length > this.capacity) this.items.shift();
    return item;
  }

  async drain(send: (a: QueuedAction) => Promise<void>): Promise<number> {
    let sent = 0;
    while (this.items.length) {
      const next = this.items[0];
      try { await send(next); } catch { /* the server rejected it (e.g. invalid transition by now) — drop it */ }
      this.items.shift();
      sent++;
    }
    return sent;
  }

  size(): number { return this.items.length; }
}
