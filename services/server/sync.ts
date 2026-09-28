/**
 * Inter-branch synchronisation of essential data (store-and-forward).
 *
 * Each branch publishes envelopes {origin, kind, id, version} to its outbox; the hub forwards them to the target
 * branches while both links are up. Receivers deduplicate by (origin, kind, id, version) and apply last-writer-wins
 * by version per (origin, kind, id), so re-sends after a link outage, duplicates and out-of-order delivery are
 * harmless. Links can be taken down to exercise the outage path (outbox grows, then drains on reconnection).
 *
 * Replicated kinds: alert — critical/escalated branch alerts to HQ (and later state changes of those alerts);
 * advisory — HQ alerts broadcast to every branch; incident — confirmed high/critical incidents to HQ;
 * plan — escort plan status changes to HQ.
 */
import { EventEmitter } from 'events';

export type SyncKind = 'alert' | 'advisory' | 'incident' | 'plan';
export interface SyncEnvelope<T = unknown> { origin: string; kind: SyncKind; id: string; version: number; at: number; payload: T }
export interface SyncBranchStatus {
  branch: string; link: 'up' | 'down'; outbox: number; sent: number; received: number; duplicates: number; stale: number; last_sync: number | null;
}
export type ReceiveResult = 'applied' | 'duplicate' | 'stale';

interface Pending { env: SyncEnvelope; targets: Set<string> }
const FEED_MAX = 200;

export class SyncHub extends EventEmitter {
  private outbox = new Map<string, Pending[]>();
  private versions = new Map<string, Map<string, number>>();
  private seen = new Map<string, Set<string>>();
  private links = new Map<string, boolean>();
  private stats = new Map<string, { sent: number; received: number; duplicates: number; stale: number; last_sync: number | null }>();
  private feeds = new Map<string, SyncEnvelope[]>();

  constructor(private branches: string[], private deliver: (target: string, env: SyncEnvelope) => void, private now: () => number = Date.now) {
    super();
    for (const b of branches) {
      this.outbox.set(b, []); this.versions.set(b, new Map()); this.seen.set(b, new Set()); this.links.set(b, true);
      this.stats.set(b, { sent: 0, received: 0, duplicates: 0, stale: 0, last_sync: null }); this.feeds.set(b, []);
    }
  }

  /** Queue an envelope from `origin` for `targets` and try to deliver it right away. */
  publish(env: Omit<SyncEnvelope, 'at'>, targets: string[]): void {
    const to = targets.filter((t) => t !== env.origin && this.links.has(t));
    if (!to.length || !this.outbox.has(env.origin)) return;
    this.outbox.get(env.origin)!.push({ env: { ...env, at: this.now() }, targets: new Set(to) });
    this.flush();
  }

  /** Deliver everything deliverable: origin link up and target link up. */
  flush(): number {
    let delivered = 0;
    for (const [origin, queue] of this.outbox) {
      if (!this.links.get(origin) || !queue.length) continue;
      let deliveredHere = 0;
      for (const item of queue) {
        for (const target of [...item.targets]) {
          if (!this.links.get(target)) continue;
          this.receive(target, item.env);
          item.targets.delete(target);
          this.stats.get(origin)!.sent++;
          deliveredHere++;
        }
      }
      this.outbox.set(origin, queue.filter((i) => i.targets.size > 0));
      if (deliveredHere) this.stats.get(origin)!.last_sync = this.now();
      delivered += deliveredHere;
    }
    if (delivered) this.emit('status', this.status());
    return delivered;
  }

  /** Apply one envelope at a target with dedupe and last-writer-wins; exposed for tests of re-delivery. */
  receive(target: string, env: SyncEnvelope): ReceiveResult {
    const st = this.stats.get(target)!;
    const key = `${env.origin}|${env.kind}|${env.id}`;
    const vkey = `${key}|${env.version}`;
    const seen = this.seen.get(target)!;
    if (seen.has(vkey)) { st.duplicates++; return 'duplicate'; }
    seen.add(vkey);
    const versions = this.versions.get(target)!;
    if ((versions.get(key) ?? -1) >= env.version) { st.stale++; return 'stale'; }
    versions.set(key, env.version);
    st.received++;
    st.last_sync = this.now();
    const feed = this.feeds.get(target)!;
    const i = feed.findIndex((e) => `${e.origin}|${e.kind}|${e.id}` === key);
    if (i >= 0) feed.splice(i, 1);
    feed.unshift(env);
    if (feed.length > FEED_MAX) feed.length = FEED_MAX;
    this.deliver(target, env);
    return 'applied';
  }

  setLink(branch: string, up: boolean): SyncBranchStatus {
    if (!this.links.has(branch)) throw new Error(`unknown branch: ${branch}`);
    this.links.set(branch, up);
    if (up) this.flush();
    this.emit('status', this.status());
    return this.status().find((s) => s.branch === branch)!;
  }

  status(): SyncBranchStatus[] {
    return this.branches.map((b) => {
      const st = this.stats.get(b)!;
      return { branch: b, link: this.links.get(b) ? 'up' : 'down', outbox: this.outbox.get(b)!.reduce((n, i) => n + i.targets.size, 0), ...st };
    });
  }

  /** Envelopes received by a branch, newest first (latest version per record). */
  feed(target: string, kind?: SyncKind): SyncEnvelope[] { return (this.feeds.get(target) ?? []).filter((e) => !kind || e.kind === kind); }
}
