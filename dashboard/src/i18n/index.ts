import fa from './fa.json';
import en from './en.json';
import type { Lang } from '../lib/format';

export type TKey = keyof typeof fa;
const DICTS: Record<Lang, Record<string, string>> = { fa, en };

export function translate(lang: Lang, key: TKey, vars?: Record<string, string | number>): string {
  const raw = DICTS[lang][key] ?? DICTS.fa[key] ?? key;
  return vars ? raw.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`)) : raw;
}
