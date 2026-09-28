import { useSession } from '../stores/session';
import { useOps } from '../stores/ops';
import { Outbox } from '../realtime/envelopes';
import type { Session } from './types';

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

export const outbox = new Outbox();
export const endpoint = (method: string, path: string): string => `${method} /api${path}`;

let refreshing: Promise<boolean> | null = null;

/** Rotate the access token with the refresh token once (keeps the active branch). */
async function refresh(): Promise<boolean> {
  const s = useSession.getState().session;
  if (!s?.refresh_token) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token: s.refresh_token, branch: s.branch }) });
      if (!res.ok) return false;
      const next = (await res.json()) as Session;
      useSession.getState().setSession(next);
      return true;
    } catch { return false; } finally { setTimeout(() => { refreshing = null; }, 0); }
  })();
  return refreshing;
}

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const token = useSession.getState().session?.access_token;
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body instanceof Blob) { payload = body; headers['content-type'] = body.type || 'application/octet-stream'; }
  else if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
  let res: Response;
  try { res = await fetch(`/api${path}`, { method, headers, body: payload }); }
  catch { throw new ApiError('network', 0, 'network'); }
  if (res.status === 401 && token && retry && !path.startsWith('/auth/login')) {
    if (await refresh()) return request<T>(method, path, body, false);
    useSession.getState().setSession(null);
  }
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; code?: string };
    throw new ApiError(d.error || res.statusText, res.status, d.code);
  }
  return data as T;
}

export const get = <T>(path: string) => request<T>('GET', path);
export const send = <T>(method: 'POST' | 'PATCH' | 'PUT', path: string, body?: unknown) => request<T>(method, path, body);

/**
 * State-changing call. While the realtime link is down the call is queued in the outbox and replayed in order
 * on reconnect; the caller gets `null` instead of a response.
 */
export async function mutate<T>(method: 'POST' | 'PATCH' | 'PUT', path: string, body?: unknown): Promise<T | null> {
  if (useOps.getState().conn !== 'online') {
    outbox.push({ method, path, body });
    useOps.getState().set({ outbox: outbox.size() });
    return null;
  }
  return request<T>(method, path, body);
}

export const upload = <T>(path: string, blob: Blob) => request<T>('POST', path, blob);

export async function flushOutbox(): Promise<number> {
  const sent = await outbox.drain((a) => request(a.method, a.path, a.body).then(() => undefined));
  useOps.getState().set({ outbox: outbox.size() });
  return sent;
}
