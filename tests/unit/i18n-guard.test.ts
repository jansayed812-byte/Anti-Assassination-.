/**
 * Language guard: the product speaks Dari (Afghan standard), Pashto and English.
 *  - No Iranian-Persian vocabulary anywhere in the repository (docs/i18n/GLOSSARY.md documents the mapping and is
 *    the one exception). The forbidden list is written with \u escapes so this file does not match itself.
 *  - The three dashboard dictionaries have identical keys and placeholders; server messages are complete.
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join } from 'path';
import { L, LANGS } from '../../services/server/i18n/messages';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const u = (s: string) => JSON.parse(`"${s}"`) as string;

/** Iranian-Persian term → Afghan Dari term (see docs/i18n/GLOSSARY.md). */
const FORBIDDEN: Array<[string, string]> = [
  ['\\u0628\\u06cc\\u0645\\u0627\\u0631\\u0633\\u062a\\u0627\\u0646', 'شفاخانه'],
  ['\\u067e\\u0644\\u06cc\\u0633', 'پولیس'],
  ['\\u062f\\u0627\\u0646\\u0634\\u06af\\u0627\\u0647', 'پوهنتون'],
  ['\\u0641\\u0631\\u0645\\u0627\\u0646\\u062f\\u0647', 'قوماندان'],
  ['\\u0627\\u06cc\\u0633\\u062a \\u0628\\u0627\\u0632\\u0631\\u0633\\u06cc', 'پوستهٔ تلاشی'],
  ['\\u067e\\u0647\\u067e\\u0627\\u062f', 'درون'],
  ['\\u062f\\u0648\\u0631\\u0628\\u06cc\\u0646', 'کمره'],
  ['\\u062e\\u0648\\u062f\\u0631\\u0648', 'موتر'],
  ['\\u0628\\u0632\\u0631\\u06af\\u0631\\u0627\\u0647', 'شاهراه'],
  ['\\u062e\\u06cc\\u0627\\u0628\\u0627\\u0646', 'سرک'],
  ['\\u0641\\u0631\\u0648\\u062f\\u06af\\u0627\\u0647', 'میدان هوایی'],
  ['\\u0634\\u0647\\u0631\\u062f\\u0627\\u0631\\u06cc', 'شاروالی'],
  ['\\u0627\\u0633\\u062a\\u0627\\u0646', 'ولایت'],
  ['\\u0634\\u0647\\u0631\\u0633\\u062a\\u0627\\u0646', 'ولسوالی'],
  ['\\u0633\\u0631\\u06af\\u0631\\u062f', 'جگړن'],
  ['\\u0633\\u0631\\u0647\\u0646\\u06af', 'دگروال'],
  ['\\u0633\\u062a\\u0648\\u0627\\u0646', 'بریدمل'],
  ['\\u067e\\u0645\\u067e \\u0628\\u0646\\u0632\\u06cc\\u0646', 'تانک تیل'],
  ['\\u0631\\u0627\\u06cc\\u0627\\u0646\\u0647', 'کمپیوتر'],
  ['\\u0631\\u0627\\u0646\\u0646\\u062f\\u0647', 'دریور'],
  ['\\u0627\\u0631\\u062a\\u0634', 'اردو'],
  ['\\u067e\\u0627\\u0633\\u06af\\u0627\\u0647', 'پوستهٔ پولیس'],
  ['\\u0628\\u0631\\u0646\\u0627\\u0645\\u0647\\u200c\\u0631\\u06cc\\u0632\\u06cc', 'پلانگذاری'],
  ['\\u0628\\u0627\\u062a\\u0631\\u06cc', 'بتری'],
  ['\\u0633\\u06cc\\u06af\\u0646\\u0627\\u0644', 'سگنال'],
  ['\\u0633\\u0627\\u0645\\u0627\\u0646\\u0647', 'سیستم'],
  ['\\u067e\\u0627\\u06cc\\u0634', 'نظارت'],
  ['\\u0647\\u0645\\u06af\\u0627\\u0645', 'هماهنگ'],
  ['\\u0641\\u0646\\u06cc', 'تخنیکی'],
  ['\\u0641\\u0627\\u0631\\u0633\\u06cc', 'دری'],
].map(([term, dari]) => [u(term), dari]);

const LETTER = '[\\u0600-\\u06FF\\u200c]';
const pattern = (term: string) => new RegExp(`(?<!${LETTER})${term.replace(/ /g, '\\s+')}(?!${LETTER})`, 'u');
const EXEMPT = new Set(['docs/i18n/GLOSSARY.md']);
const TEXT = /\.(ts|tsx|js|mjs|cjs|json|md|html|css|sql|yml|yaml|sh|txt|env|example)$|^(Makefile|Dockerfile)$|\/(Makefile|Dockerfile)$/;

function trackedTextFiles(): string[] {
  const out = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  return out.filter((f) => !EXEMPT.has(f) && !/package-lock\.json$/.test(f) && (TEXT.test(f) || f === '.env.example'));
}

describe('no Iranian-Persian vocabulary in the repository', () => {
  const files = trackedTextFiles();

  it('scans a meaningful set of files', () => { expect(files.length).toBeGreaterThan(80); });

  it.each(FORBIDDEN.map(([term, dari]) => [dari, term] as const))('uses «%s» (Afghan Dari), never the Iranian term', (_dari, term) => {
    const re = pattern(term);
    const hits = files.filter((f) => { try { return re.test(readFileSync(join(ROOT, f), 'utf8')); } catch { return false; } });
    expect(hits).toEqual([]);
  });

  it('has no Iranian locale code or Persian dictionary file', () => {
    // Built from parts so this file does not match its own pattern.
    const iranLocale = new RegExp(['fa', 'IR'].join('-'));
    const hits = files.filter((f) => iranLocale.test(readFileSync(join(ROOT, f), 'utf8')));
    expect(hits).toEqual([]);
    expect(files.some((f) => /i18n\/fa\.json$/.test(f))).toBe(false);
  });
});

describe('dashboard dictionaries', () => {
  const load = (l: string) => JSON.parse(readFileSync(join(ROOT, `dashboard/src/i18n/${l}.json`), 'utf8')) as Record<string, string>;
  const en = load('en'), dr = load('dr'), ps = load('ps');
  const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();

  it.each([['dr', dr], ['ps', ps]] as const)('%s has exactly the English keys', (_l, d) => {
    expect(Object.keys(d).sort()).toEqual(Object.keys(en).sort());
  });

  it.each([['dr', dr], ['ps', ps]] as const)('%s keeps every placeholder and leaves nothing empty', (_l, d) => {
    for (const k of Object.keys(en)) {
      expect(d[k].trim(), k).not.toBe('');
      expect(holes(d[k]), k).toBe(holes(en[k]));
    }
  });

  it('Dari and Pashto are actually translated (Arabic script, and Pashto differs from Dari)', () => {
    const script = /[؀-ۿ]/;
    const keys = Object.keys(en).filter((k) => /[a-z]{3}/i.test(en[k].replace(/\{\w+\}/g, '')) && !/^(ad\.src\.osm|unit\.dbm)$/.test(k));
    const drScript = keys.filter((k) => script.test(dr[k])).length / keys.length;
    const psScript = keys.filter((k) => script.test(ps[k])).length / keys.length;
    const psDistinct = keys.filter((k) => ps[k] !== dr[k]).length / keys.length;
    expect(drScript).toBeGreaterThan(0.95);
    expect(psScript).toBeGreaterThan(0.95);
    expect(psDistinct).toBeGreaterThan(0.85);
  });

  it('Pashto uses Pashto letters (ټ ډ ړ ږ ښ ګ ڼ ې ۍ ځ څ)', () => {
    const pashto = /[ټډړږښګڼېۍځڅ]/;
    const withScript = Object.values(ps).filter((v) => /[؀-ۿ]{3}/.test(v));
    expect(withScript.filter((v) => pashto.test(v)).length / withScript.length).toBeGreaterThan(0.6);
  });
});

describe('server messages', () => {
  it('every message renders in all three languages with the same parameters', () => {
    const src = readFileSync(join(ROOT, 'services/server/i18n/messages.ts'), 'utf8');
    const keys = [...src.matchAll(/^\s*'([\w.]+)': tri\(/gm)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(80);
    for (const k of keys) {
      const m = L(k as Parameters<typeof L>[0]);
      for (const l of LANGS) expect(m[l].trim(), `${k}.${l}`).not.toBe('');
      const holes = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
      expect(holes(m.dr), k).toBe(holes(m.en));
      expect(holes(m.ps), k).toBe(holes(m.en));
    }
  });

  it('formats numbers with Afghan digits in Dari and Pashto', () => {
    const m = L('unit.km', { n: '12.5' });
    expect(m.dr).toBe('۱۲٫۵ کیلومتر');
    expect(m.ps).toBe('۱۲٫۵ کیلومتره');
    expect(m.en).toBe('12.5 km');
  });
});
