import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useOps, MODES, type Mode } from '../stores/ops';
import { translate, type TKey } from '../i18n';
import { num } from '../lib/format';

export function useT() {
  const lang = useOps((s) => s.lang);
  return {
    lang,
    t: (key: TKey, vars?: Record<string, string | number>) => translate(lang, key, vars),
    N: (v: string | number) => num(lang, v),
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
