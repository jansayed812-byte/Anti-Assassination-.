/**
 * Realtime link: one Socket.IO connection carrying server envelopes (telemetry 5 Hz, risk 1 Hz, alerts,
 * sim, plans, devices). Reconnects with backoff, resumes from the last seq, and drops duplicates.
 */
import { io, type Socket } from 'socket.io-client';
import type { Alert, Detection, Device, Envelope, Incident, Plan, RiskCell, SimStatus, UnitTelemetry } from '../api/types';
import { useOps } from '../stores/ops';
import { flushOutbox } from '../api/client';
import { EnvelopeTracker } from './envelopes';
import { translate } from '../i18n';

let socket: Socket | null = null;
const tracker = new EnvelopeTracker();
let replayCounter: number | null = null;

function apply(env: Envelope): void {
  const s = useOps.getState();
  switch (env.channel) {
    case 'telemetry': s.setTelemetry((env.data as { units: UnitTelemetry[] }).units, env.ts); break;
    case 'risk': {
      const d = env.data as { cells: RiskCell[]; incidents?: Incident[]; detection?: Detection };
      s.set(d.incidents ? { cells: d.cells, incidents: d.incidents } : { cells: d.cells });
      if (d.detection) s.upsertDetection(d.detection);
      break;
    }
    case 'alerts': {
      const a = env.data as Alert;
      const prev = s.alerts.find((x) => x.id === a.id);
      s.upsertAlert(a);
      if (replayCounter === null && env.ts > Date.now() + s.clockOffset - 5000) {
        if (!prev && (a.level === 'critical' || a.level === 'error')) s.showToast(translate(s.lang, 'alert.new', { title: a.title }), 'WS /api/v1/stream/alerts');
        else if (prev?.status === 'active' && a.status === 'escalated' && a.history.at(-1)?.by === 'auto') s.showToast(translate(s.lang, 'alert.autoEscalated', { title: a.title }), `POST /api/monitoring/alerts/${a.id}/escalate`);
      }
      break;
    }
    case 'sim': s.set({ sim: env.data as SimStatus }); break;
    case 'plans': s.upsertPlan(env.data as Plan); break;
    case 'devices': s.upsertDevice(env.data as Device); break;
  }
}

export function connectStream(token: string): void {
  disconnectStream();
  tracker.reset();
  const s = useOps.getState();
  s.set({ conn: 'connecting' });
  socket = io('/', { auth: { token }, transports: ['websocket', 'polling'], reconnectionDelay: 1000, reconnectionDelayMax: 15000 });

  socket.on('hello', async (h: { seq: number; server_time: number }) => {
    const st = useOps.getState();
    st.set({ clockOffset: h.server_time - Date.now() });
    if (tracker.lastSeq > 0) {
      replayCounter = 0;
      socket?.emit('resume', tracker.lastSeq);
      setTimeout(async () => {
        const replayed = replayCounter ?? 0;
        replayCounter = null;
        const sent = await flushOutbox();
        const now = useOps.getState();
        now.set({ conn: 'online' });
        now.showToast(translate(now.lang, 'off.synced', { n: sent, e: replayed }));
      }, 400);
    } else {
      tracker.lastSeq = h.seq;
      st.set({ conn: 'online' });
      await flushOutbox();
    }
  });
  socket.on('env', (env: Envelope) => {
    if (!tracker.accept(env)) return;
    if (replayCounter !== null) replayCounter++;
    apply(env);
  });
  socket.on('disconnect', () => useOps.getState().set({ conn: 'offline' }));
  socket.on('connect_error', () => useOps.getState().set({ conn: 'offline' }));
}

export function disconnectStream(): void {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
}

/** "Simulate network loss": drop the link for real, so buffering and resync are exercised end to end. */
export function setSimulatedOffline(on: boolean): void {
  useOps.getState().set({ offlineSim: on });
  if (!socket) return;
  if (on) { socket.io.reconnection(false); socket.disconnect(); useOps.getState().set({ conn: 'offline' }); }
  else { socket.io.reconnection(true); socket.connect(); }
}
