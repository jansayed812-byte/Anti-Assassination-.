/**
 * Interface languages: Dari (dr, Afghan standard, locale fa-AF), Pashto (ps, ps-AF) and English (en).
 * UI strings come from the dictionaries here; server-generated text arrives as {dr, ps, en} and is picked with
 * `pick`. Dari and Pashto use Eastern Arabic-Indic digits and the Solar Hijri calendar with Afghan month names.
 */
import en from './en.json';
import dr from './dr.json';
import ps from './ps.json';

export type Lang = 'dr' | 'ps' | 'en';
export const LANGS: Lang[] = ['dr', 'ps', 'en'];
export type TKey = keyof typeof en;
export type Tri = { dr: string; ps: string; en: string };
export type LText = Tri | string;

export const LANG_META: Record<Lang, { label: string; short: string; dir: 'rtl' | 'ltr'; html: string; intl: string }> = {
  dr: { label: 'دری', short: 'دری', dir: 'rtl', html: 'fa-AF', intl: 'fa-AF' },
  ps: { label: 'پښتو', short: 'پښتو', dir: 'rtl', html: 'ps-AF', intl: 'ps-AF' },
  en: { label: 'English', short: 'EN', dir: 'ltr', html: 'en', intl: 'en-GB' },
};

const DICTS: Record<Lang, Record<string, string>> = { dr, ps, en };
const DIGITS = '۰۱۲۳۴۵۶۷۸۹';

export const isLang = (v: unknown): v is Lang => v === 'dr' || v === 'ps' || v === 'en';

/** Western digits → Eastern Arabic-Indic for Dari/Pashto (decimal point → ٫, % → ٪). */
export function digits(lang: Lang, v: string | number): string {
  const s = String(v);
  if (lang === 'en') return s;
  return s.replace(/\d/g, (d) => DIGITS[+d]).replace(/(?<=[۰-۹])\.(?=[۰-۹])/g, '٫').replace(/%/g, '٪');
}

export function translate(lang: Lang, key: TKey, vars?: Record<string, string | number>): string {
  const raw = DICTS[lang][key] ?? DICTS.en[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? (typeof vars[k] === 'number' ? digits(lang, vars[k]) : String(vars[k])) : `{${k}}`));
}

export const pick = (v: LText | null | undefined, lang: Lang): string => (v == null ? '' : typeof v === 'string' ? v : v[lang] ?? v.en);

/** Number with a fixed number of decimals, localised digits. */
export const fmt = (lang: Lang, n: number, decimals = 0): string => digits(lang, n.toFixed(decimals));

/** Distance: metres below 1 km, else km with one decimal, with localised unit. */
export function dist(lang: Lang, m: number): string {
  return m >= 1000 ? translate(lang, 'unit.km', { n: fmt(lang, m / 1000, 1) }) : translate(lang, 'unit.m', { n: fmt(lang, Math.round(m)) });
}

export const minutes = (lang: Lang, min: number): string => translate(lang, 'unit.min', { n: fmt(lang, min, min < 10 ? 1 : 0) });

/** Clock time (HH:MM) in Kabul time, localised digits. */
export function clock(lang: Lang, ts: number | string): string {
  const d = new Date(ts);
  const s = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kabul' }).format(d);
  return digits(lang, s);
}

/** Date + time: Solar Hijri with Afghan month names for Dari/Pashto, Gregorian for English. */
export function dateTime(lang: Lang, ts: number | string, withTime = true): string {
  const d = new Date(ts);
  const opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Kabul', ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}) };
  try {
    const loc = lang === 'en' ? 'en-GB' : `${LANG_META[lang].intl}-u-ca-persian-nu-arabext`;
    return new Intl.DateTimeFormat(loc, opts).format(d);
  } catch {
    return digits(lang, new Intl.DateTimeFormat('en-GB', opts).format(d));
  }
}

export const mmss = (lang: Lang, sec: number): string => {
  const s = Math.max(0, Math.round(sec));
  return digits(lang, `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`);
};
