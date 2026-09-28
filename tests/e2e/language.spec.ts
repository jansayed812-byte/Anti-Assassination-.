/**
 * Requirement 8 — Dari / Pashto / English everywhere, switched without a reload and stored in the system.
 */
import { test, expect, login, setServerPrefs, serverPrefs, htmlAttrs, markPage, stillSamePage, HTML_LANG, type Lang } from './fixtures';

const NAV_LIVE: Record<Lang, string> = { dr: 'زنده', ps: 'ژوندی', en: 'Live' };
const switchTo = (page: import('@playwright/test').Page, lang: Lang) => page.locator(`[data-testid=lang-switcher] button[lang="${HTML_LANG[lang]}"]`).first().click();

test.describe('language switcher', () => {
  test.afterEach(async ({ request }) => {
    await setServerPrefs(request, 'maryam', { lang: 'dr', theme: 'dark' });
  });

  test('is on the login page and switches without a reload', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('[data-testid=lang-switcher]')).toBeVisible();
    await markPage(page);
    for (const lang of ['en', 'ps', 'dr'] as Lang[]) {
      await switchTo(page, lang);
      await expect.poll(() => htmlAttrs(page)).toEqual({ lang: HTML_LANG[lang], dir: lang === 'en' ? 'ltr' : 'rtl' });
      await expect(page.locator(`[data-testid=lang-switcher] button[lang="${HTML_LANG[lang]}"]`).first()).toHaveAttribute('aria-pressed', 'true');
    }
    expect(await stillSamePage(page)).toBe(true);
  });

  for (const [user, lang] of [['maryam', 'dr'], ['ali', 'ps'], ['admin', 'en']] as Array<[string, Lang]>) {
    test(`${user} signs in to their saved language (${lang})`, async ({ page, request }) => {
      await setServerPrefs(request, user, { lang });
      await login(page, user, '/live');
      await expect.poll(() => htmlAttrs(page)).toEqual({ lang: HTML_LANG[lang], dir: lang === 'en' ? 'ltr' : 'rtl' });
      await expect(page.locator('nav, header').getByText(NAV_LIVE[lang], { exact: true }).first()).toBeVisible();
    });
  }

  test('switching in the app is instant, saved on the server and follows the user to a new device', async ({ page, request, browser }) => {
    await login(page, 'maryam', '/analysis');
    await expect(page.locator('header').getByText(NAV_LIVE.dr, { exact: true }).first()).toBeVisible();
    await markPage(page);
    const path = new URL(page.url()).pathname;

    await switchTo(page, 'en');
    await expect.poll(() => htmlAttrs(page)).toEqual({ lang: 'en', dir: 'ltr' });
    await expect(page.locator('header').getByText('Live', { exact: true }).first()).toBeVisible();
    expect(await stillSamePage(page)).toBe(true);
    expect(new URL(page.url()).pathname).toBe(path);
    // No Arabic-script text left in the navigation after switching to English.
    expect(await page.locator('header nav, header [role=tablist]').first().innerText()).not.toMatch(/[؀-ۿ]/);

    await expect.poll(async () => (await serverPrefs(request, 'maryam')).lang).toBe('en');
    await page.reload();
    await expect.poll(() => htmlAttrs(page)).toEqual({ lang: 'en', dir: 'ltr' });

    // A fresh browser context (another device, empty localStorage) gets English from the server at sign-in.
    const other = await browser.newContext();
    await other.route(/tiles\.openfreemap\.org|tile\.openstreetmap\.org|amazonaws\.com/, (r) => r.abort());
    const p2 = await other.newPage();
    await login(p2, 'maryam');
    await expect.poll(() => htmlAttrs(p2)).toEqual({ lang: 'en', dir: 'ltr' });
    await other.close();

    await markPage(page); // the reload above cleared the previous mark
    await switchTo(page, 'ps');
    await expect.poll(() => htmlAttrs(page)).toEqual({ lang: 'ps-AF', dir: 'rtl' });
    await expect(page.locator('header').getByText(NAV_LIVE.ps, { exact: true }).first()).toBeVisible();
    expect(await stillSamePage(page)).toBe(true);
  });

  test('uses Afghan digits in Dari and Pashto, Latin digits in English', async ({ page }) => {
    await login(page, 'maryam', '/live');
    const bodyText = () => page.locator('main').innerText();
    await expect.poll(async () => /[۰-۹]/.test(await bodyText())).toBe(true);
    await switchTo(page, 'en');
    await expect.poll(async () => /[۰-۹]/.test(await bodyText())).toBe(false);
  });
});
