/**
 * Display preferences: language and theme. Switching is store-only (no reload): the document's lang/dir/theme
 * update in place. Preferences persist locally and, once signed in, on the server so they follow the user.
 */
import { create } from 'zustand';
import { LANG_META, isLang, type Lang } from '../i18n';

export type Theme = 'dark' | 'light';
const KEY = 'ops.prefs';

function load(): { lang: Lang; theme: Theme } {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { lang?: unknown; theme?: unknown };
    return { lang: isLang(raw.lang) ? raw.lang : 'dr', theme: raw.theme === 'light' ? 'light' : 'dark' };
  } catch { return { lang: 'dr', theme: 'dark' }; }
}

export function applyDocument(lang: Lang, theme: Theme): void {
  const el = document.documentElement;
  el.lang = LANG_META[lang].html;
  el.dir = LANG_META[lang].dir;
  el.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0a101b' : '#f1eee6');
}

interface PrefsState {
  lang: Lang; theme: Theme;
  /** The user picked a language before signing in; it wins over the stored server preference. */
  touched: boolean;
  setLang: (lang: Lang, touched?: boolean) => void;
  setTheme: (theme: Theme) => void;
}

export const usePrefs = create<PrefsState>((set, get) => {
  const initial = load();
  applyDocument(initial.lang, initial.theme);
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify({ lang: get().lang, theme: get().theme })); } catch { /* storage unavailable */ } };
  return {
    ...initial, touched: false,
    setLang: (lang, touched = false) => { set({ lang, touched: get().touched || touched }); applyDocument(lang, get().theme); persist(); },
    setTheme: (theme) => { set({ theme }); applyDocument(get().lang, theme); persist(); },
  };
});
