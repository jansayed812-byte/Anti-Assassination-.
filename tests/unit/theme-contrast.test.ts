/**
 * WCAG 2.1 contrast of the console's text/ground pairs in both themes (dashboard/src/styles/theme.css).
 * Body and caption text need 4.5:1 (AA); large headings, icons and UI boundaries need 3:1.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const css = readFileSync(fileURLToPath(new URL('../../dashboard/src/styles/theme.css', import.meta.url)), 'utf8');

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const block = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1], m[2]]));
}

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const THEMES = { dark: tokens(":root[data-theme='dark']"), light: tokens(":root[data-theme='light']") };
const GROUNDS = ['bg', 'bg-2', 'surface', 'surface-2'];

describe.each(Object.entries(THEMES))('%s theme contrast', (_name, t) => {
  it('defines every token it is checked on', () => {
    for (const k of ['text', 'text-2', 'text-3', 'accent', 'accent-ink', 'danger', 'warning', 'success', 'info', ...GROUNDS]) expect(t[k], k).toMatch(/^#/);
  });

  it.each(['text', 'text-2', 'text-3'])('%s is readable (AA 4.5:1) on every ground', (fg) => {
    for (const g of GROUNDS) expect(contrast(t[fg], t[g]), `${fg} on ${g}`).toBeGreaterThanOrEqual(4.5);
  });

  it('text on the accent fill (primary buttons) meets AA', () => {
    expect(contrast(t['accent-ink'], t.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it('status colours used as text meet AA on surfaces', () => {
    for (const c of ['accent', 'danger', 'warning', 'success', 'info']) for (const g of ['surface', 'surface-2']) expect(contrast(t[c], t[g]), `${c} on ${g}`).toBeGreaterThanOrEqual(4.5);
  });

  it('risk colours are distinguishable from the ground as UI graphics (3:1)', () => {
    for (const c of ['risk-low', 'risk-medium', 'risk-high', 'risk-critical']) expect(contrast(t[c], t.surface), c).toBeGreaterThanOrEqual(3);
  });

  it('the risk scale steps monotonically in lightness (not hue alone), so it reads without colour vision', () => {
    const l = ['risk-low', 'risk-medium', 'risk-high', 'risk-critical'].map((k) => lum(t[k]));
    for (let i = 1; i < l.length; i++) expect(l[i - 1] - l[i], `step ${i}`).toBeGreaterThan(0.04);
  });
});
