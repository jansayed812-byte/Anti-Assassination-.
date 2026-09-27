/** The three interface languages: Dari (locale fa-AF), Pashto (ps-AF), English. */
export type Lang = 'dr' | 'ps' | 'en';
export const LANGS: Lang[] = ['dr', 'ps', 'en'];

/** Text carried in all three languages. */
export type Tri = { dr: string; ps: string; en: string };

/** Server-originated display text: trilingual, or free text typed by a user (shown as written). */
export type LText = Tri | string;

export const tri = (dr: string, ps: string, en: string): Tri => ({ dr, ps, en });
export const isTri = (v: unknown): v is Tri => !!v && typeof v === 'object' && 'dr' in v && 'ps' in v && 'en' in v;
export const pick = (v: LText, lang: Lang): string => (typeof v === 'string' ? v : v[lang] ?? v.en);
