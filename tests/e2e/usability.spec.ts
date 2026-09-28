/**
 * Requirement 6 — responsive on phone, tablet, desktop and wall screens; accessible (axe-core WCAG 2.1 A/AA,
 * no serious or critical violations); keyboard reachable; fast first paint.
 */
import AxeBuilder from '@axe-core/playwright';
import { test, expect, login, mapReady, htmlAttrs } from './fixtures';

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844, mobile: true },
  { name: 'tablet', width: 820, height: 1180, mobile: true },
  { name: 'desktop', width: 1440, height: 900, mobile: false },
  { name: 'wall', width: 2560, height: 1440, mobile: false },
];
const PAGES = ['/live', '/analysis', '/planning'];

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} ${vp.width}×${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.mobile, hasTouch: vp.mobile });

    test('has no horizontal overflow and keeps the language switcher reachable', async ({ page }) => {
      await login(page, 'reza');
      for (const path of PAGES) {
        await page.goto(path);
        await expect(page.locator('header')).toBeVisible();
        await page.waitForTimeout(1200);
        const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
        expect(sw, `${path} scrollWidth`).toBeLessThanOrEqual(cw + 1);
        await expect(page.locator('[data-testid=lang-switcher]:visible').first(), `${path} language switcher`).toBeVisible();
      }
    });
  });
}

test.describe('accessibility', () => {
  const audit = async (page: import('@playwright/test').Page) => {
    const r = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .exclude('.maplibregl-canvas-container') // WebGL canvas: map content is also listed in the side panels
      .analyze();
    return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  };

  test('login page', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[name=username]')).toBeVisible();
    expect(await audit(page)).toEqual([]);
  });

  for (const path of PAGES) {
    for (const theme of ['dark', 'light'] as const) {
      test(`${path} (${theme})`, async ({ page }) => {
        await page.addInitScript((theme) => localStorage.setItem('ops.prefs', JSON.stringify({ lang: 'dr', theme })), theme);
        await login(page, 'reza', path);
        await mapReady(page);
        await page.evaluate((theme) => document.documentElement.setAttribute('data-theme', theme), theme);
        expect(await audit(page)).toEqual([]);
      });
    }
  }
});

test.describe('keyboard', () => {
  test('signs in and reaches navigation and the language switcher with the keyboard only', async ({ page }) => {
    await page.goto('/login');
    await page.locator('input[name=username]').focus();
    await page.keyboard.press('ControlOrMeta+A'); // the demo form pre-fills a username
    await page.keyboard.type('maryam');
    await page.keyboard.press('Tab');
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('demo');
    await page.keyboard.press('Enter');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
    await expect(page.locator('header')).toBeVisible();

    const reached = new Set<string>();
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return null;
        const ring = getComputedStyle(el);
        return { lang: el.closest('[data-testid=lang-switcher]') ? el.getAttribute('lang') : null, nav: el.closest('header nav') ? (el.textContent ?? '').trim() : null, outline: ring.outlineStyle !== 'none' || ring.boxShadow !== 'none' };
      });
      if (info?.lang) reached.add(`lang:${info.lang}`);
      if (info?.nav) reached.add(`nav:${info.nav}`);
      if (info) expect(info.outline, 'focused element shows a focus indicator').toBe(true);
    }
    expect([...reached].filter((r) => r.startsWith('nav:')).length).toBeGreaterThanOrEqual(5); // every workspace tab
    expect(reached.has('lang:en')).toBe(true);

    // Activate English from the keyboard.
    await page.locator('[data-testid=lang-switcher] button[lang=en]').first().focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => htmlAttrs(page)).toEqual({ lang: 'en', dir: 'ltr' });
    await page.locator('[data-testid=lang-switcher] button[lang=fa-AF]').first().focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => htmlAttrs(page)).toEqual({ lang: 'fa-AF', dir: 'rtl' });
  });
});

test.describe('performance in the browser', () => {
  test('login paints fast and the map chunk loads only after sign-in', async ({ page }) => {
    const scripts: string[] = [];
    page.on('request', (r) => { if (r.resourceType() === 'script') scripts.push(new URL(r.url()).pathname); });
    await page.goto('/login');
    await expect(page.locator('input[name=username]')).toBeVisible();
    const fcp = await page.evaluate(() => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? performance.now());
    expect(fcp).toBeLessThan(2500);
    expect(scripts.some((s) => /MapView/.test(s))).toBe(false);
    await login(page, 'maryam', '/live');
    await mapReady(page);
    expect(scripts.some((s) => /MapView/.test(s))).toBe(true);
  });
});
