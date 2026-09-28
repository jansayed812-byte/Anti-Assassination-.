import { create } from 'zustand';
import type { Role, Session } from '../api/types';

const KEY = 'ops.session';

function load(): Session | null {
  try { const raw = sessionStorage.getItem(KEY); const s = raw ? (JSON.parse(raw) as Session) : null; return s && s.branch && s.user?.name ? s : null; } catch { return null; }
}

function save(s: Session | null): void {
  try { if (s) sessionStorage.setItem(KEY, JSON.stringify(s)); else sessionStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}

interface SessionState {
  session: Session | null;
  role: Role | null;
  branch: string | null;
  setSession: (s: Session | null) => void;
}

/** Signed-in user, tokens and the active branch (the server's claims are authoritative). */
export const useSession = create<SessionState>((set) => {
  const initial = load();
  return {
    session: initial, role: initial?.role ?? null, branch: initial?.branch ?? null,
    setSession: (s) => { save(s); set({ session: s, role: s?.role ?? null, branch: s?.branch ?? null }); },
  };
});
