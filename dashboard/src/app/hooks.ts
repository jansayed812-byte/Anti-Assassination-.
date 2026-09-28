import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useOps, MODES, type Mode } from '../stores/ops';
import { usePrefs } from '../stores/prefs';
import { clock, dateTime, digits, dist, fmt, minutes, pick, translate, type LText, type TKey } from '../i18n';

/** Translation helpers bound to the current language. */
export function useT() {
  const lang = usePrefs((s) => s.lang);
  const people = useOps((s) => s.people);
  return {
    lang,
    t: (key: TKey, vars?: Record<string, string | number>) => translate(lang, key, vars),
    /** Server text ({dr, ps, en} or free text). */
    x: (v: LText | null | undefined) => pick(v, lang),
    N: (v: string | number) => digits(lang, v),
    F: (n: number, decimals = 0) => fmt(lang, n, decimals),
    D: (m: number) => dist(lang, m),
    M: (min: number) => minutes(lang, min),
    clock: (ts: number | string) => clock(lang, ts),
    date: (ts: number | string, withTime = true) => dateTime(lang, ts, withTime),
    /** Display name for a username stored in records. */
    who: (username: string | undefined) => (username ? (people[username] ? pick(people[username].name, lang) : username) : '—'),
  };
}

/** Re-renders every `ms` and returns the server-aligned clock. */
export function useNow(ms = 1000): number {
  const offset = useOps((s) => s.clockOffset);
  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((x) => x + 1), ms); return () => clearInterval(id); }, [ms]);
  return Date.now() + offset;
}

export function useMode(): Mode {
  const { mode } = useParams();
  return (MODES.find((m) => m.id === mode)?.id ?? 'live') as Mode;
}

export type Layout = 'mobile' | 'tablet' | 'desktop' | 'wall';
export const layoutFor = (w: number): Layout => (w < 700 ? 'mobile' : w < 1280 ? 'tablet' : w < 2200 ? 'desktop' : 'wall');

export function useViewport() {
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => { const f = () => setVp({ w: window.innerWidth, h: window.innerHeight }); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  return vp;
}
