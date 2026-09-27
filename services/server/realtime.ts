/**
 * Realtime envelope bus: every push carries a monotonically increasing seq and a sha256 integrity
 * hash, and the last N envelopes are kept so a reconnecting client can replay what it missed.
 */
import { createHash } from 'crypto';

export type Channel = 'telemetry' | 'risk' | 'alerts' | 'sim' | 'plans' | 'devices' | 'blindspots' | 'sync';

export interface Envelope<T = unknown> {
  seq: number; ts: number; channel: Channel; data: T; integrity: string; branch?: string;
}

export function integrityOf(channel: Channel, seq: number, data: unknown): string {
  return 'sha256:' + createHash('sha256').update(JSON.stringify({ channel, seq, data })).digest('hex');
}

export class RealtimeBus {
  private seq = 0;
  private buffer: Envelope[] = [];
  private listeners = new Set<(e: Envelope) => void>();

  /** `branch` tags every envelope so clients watching several branches can tell the streams apart. */
  constructor(private capacity = 10_000, readonly branch?: string) {}

  publish<T>(channel: Channel, data: T): Envelope<T> {
    const seq = ++this.seq;
    const env: Envelope<T> = { seq, ts: Date.now(), channel, data, integrity: integrityOf(channel, seq, data), ...(this.branch ? { branch: this.branch } : {}) };
    this.buffer.push(env);
    if (this.buffer.length > this.capacity) this.buffer.splice(0, this.buffer.length - this.capacity);
    for (const l of this.listeners) l(env);
    return env;
  }

  /** Envelopes after `lastSeq`, oldest first; high-rate channels are collapsed to their latest value. */
  since(lastSeq: number): Envelope[] {
    const missed = this.buffer.filter((e) => e.seq > lastSeq);
    const latest = new Map<Channel, Envelope>();
    const out: Envelope[] = [];
    for (const e of missed) {
      if (e.channel === 'telemetry' || e.channel === 'risk' || e.channel === 'sim' || e.channel === 'blindspots' || e.channel === 'sync') latest.set(e.channel, e);
      else out.push(e);
    }
    return [...out, ...latest.values()].sort((a, b) => a.seq - b.seq);
  }

  currentSeq(): number { return this.seq; }
  size(): number { return this.buffer.length; }
  subscribe(fn: (e: Envelope) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}
