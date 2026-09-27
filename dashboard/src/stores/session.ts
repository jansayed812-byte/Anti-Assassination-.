import { create } from 'zustand';
import type { Role, Session } from '../api/types';

const KEY = 'ops.session';

function load(): Session | null {
  try { const raw = sessionStorage.getItem(KEY); return raw ? (JSON.parse(raw) as Session) : null; } catch { return null; }
}

function save(s: Session | null): void {
  try { if (s) sessionStorage.setItem(KEY, JSON.stringify(s)); else sessionStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}

/** Reads the role claim out of the JWT payload (the server remains the authority on permissions). */
export function roleFromToken(token: string | undefined): Role | null {
  try {
    const payload = token?.split('.')[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return (JSON.parse(json) as { role?: Role }).role ?? null;
  } catch { return null; }
}

interface SessionState {
  session: Session | null;
  role: Role | null;
  setSession: (s: Session | null) => void;
}

export const useSession = create<SessionState>((set) => {
  const initial = load();
  return {
    session: initial,
    role: roleFromToken(initial?.access_token),
    setSession: (s) => { save(s); set({ session: s, role: roleFromToken(s?.access_token) }); },
  };
});
