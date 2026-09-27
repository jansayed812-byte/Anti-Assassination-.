import { useSession } from '../stores/session';
import { useOps } from '../stores/ops';
import { Outbox } from '../realtime/envelopes';

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export const outbox = new Outbox();

export function endpoint(method: string, path: string): string { return `${method} /api${path}`; }

async function request<T>(method: string, path: string, body?: unknown, contentType?: string): Promise<T> {
  const token = useSession.getState().session?.access_token;
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body instanceof Blob) { payload = body; headers['content-type'] = contentType ?? (body.type || 'application/octet-stream'); }
  else if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
  const res = await fetch(`/api${path}`, { method, headers, body: payload });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (res.status === 401 && token) useSession.getState().setSession(null);
  if (!res.ok) throw new ApiError((data && data.error) || res.statusText, res.status);
  return data as T;
}

export const get = <T>(path: string) => request<T>('GET', path);

/**
 * State-changing call. While the realtime link is down the call is queued in the outbox and replayed
 * in order on reconnect; the caller gets `null` instead of a response.
 */
export async function mutate<T>(method: 'POST' | 'PATCH', path: string, body?: unknown): Promise<T | null> {
  if (useOps.getState().conn !== 'online') {
    outbox.push({ method, path, body });
    useOps.getState().set({ outbox: outbox.size() });
    return null;
  }
  return request<T>(method, path, body);
}

export const upload = <T>(path: string, blob: Blob) => request<T>('POST', path, blob);
export const publicPost = <T>(path: string, body: unknown) => request<T>('POST', path, body);

export async function flushOutbox(): Promise<number> {
  const sent = await outbox.drain((a) => request(a.method, a.path, a.body).then(() => undefined));
  useOps.getState().set({ outbox: outbox.size() });
  return sent;
}
