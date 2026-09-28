/**
 * Realtime link: one Socket.IO connection in the active branch's room carrying server envelopes (telemetry,
 * risk, alerts, simulation, plans, devices, blind spots, sync). Reconnects with backoff, resumes from the last
 * seq, and drops duplicates.
 */
import { io, type Socket } from 'socket.io-client';
import type { Alert, BlindSpot, Detection, Device, Envelope, Incident, Plan, SimStatus, SyncStatus, UnitTelemetry } from '../api/types';
import { useOps } from '../stores/ops';
import { usePrefs } from '../stores/prefs';
import { useSession } from '../stores/session';
import { flushOutbox } from '../api/client';
import { EnvelopeTracker } from './envelopes';
import { pick, translate } from '../i18n';
import { refreshRisk } from '../app/actions';

let socket: Socket | null = null;
const tracker = new EnvelopeTracker();
let replayCounter: number | null = null;
let riskTimer: ReturnType<typeof setTimeout> | null = null;

function apply(env: Envelope): void {
  const s = useOps.getState();
  if (env.branch && env.branch !== useSession.getState().branch) return;
  const lang = usePrefs.getState().lang;
  switch (env.channel) {
    case 'telemetry': s.setTelemetry((env.data as { units: UnitTelemetry[] }).units, env.ts); break;
    case 'risk': {
      const d = env.data as { incidents?: Incident[]; detection?: Detection; version?: number };
      if (d.detection) s.upsertDetection(d.detection);
      if (d.incidents) s.set({ incidents: d.incidents });
      if (d.version !== undefined && d.version !== s.riskVersion) { if (riskTimer) clearTimeout(riskTimer); riskTimer = setTimeout(() => void refreshRisk(), 300); }
      break;
    }
    case 'alerts': {
      const a = env.data as Alert;
      const prev = s.alerts.find((x) => x.id === a.id);
      s.upsertAlert(a);
      if (replayCounter === null && env.ts > Date.now() + s.clockOffset - 5000) {
        if (!prev && (a.level === 'critical' || a.level === 'error')) s.showToast(translate(lang, 'alert.new', { title: pick(a.title, lang) }), 'WS env/alerts');
        else if (prev?.status === 'active' && a.status === 'escalated' && a.history.at(-1)?.by === 'auto') s.showToast(translate(lang, 'alert.autoEscalated', { title: pick(a.title, lang) }));
      }
      break;
    }
    case 'sim': s.set({ sim: env.data as SimStatus }); break;
    case 'plans': s.upsertPlan(env.data as Plan); break;
    case 'devices': s.upsertDevice(env.data as Device); break;
    case 'blindspots': s.set({ blindspots: (env.data as { zones: BlindSpot[] }).zones }); break;
    case 'sync': { const d = env.data as { status?: SyncStatus[] }; if (d.status) s.set({ sync: d.status }); break; }
  }
}

export function connectStream(token: string): void {
  disconnectStream();
  tracker.reset();
  const s = useOps.getState();
  s.set({ conn: 'connecting' });
  socket = io('/', { auth: { token }, transports: ['websocket', 'polling'], reconnectionDelay: 1000, reconnectionDelayMax: 15000 });

  socket.on('hello', async (h: { seq: number; server_time: number; branch: string }) => {
    const st = useOps.getState();
    st.set({ clockOffset: h.server_time - Date.now() });
    if (tracker.lastSeq > 0) {
      replayCounter = 0;
      socket?.emit('resume', { branch: h.branch, seq: tracker.lastSeq });
      setTimeout(async () => {
        const replayed = replayCounter ?? 0;
        replayCounter = null;
        const sent = await flushOutbox();
        const now = useOps.getState();
        now.set({ conn: 'online' });
        now.showToast(translate(usePrefs.getState().lang, 'off.synced', { n: sent, e: replayed }));
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
