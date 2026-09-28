/**
 * Shared E2E helpers: blocks external tile/DEM hosts, logs in through the real form, and talks to the API
 * directly to set or read server-side preferences.
 */
import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';

export type Lang = 'dr' | 'ps' | 'en';
export const PASSWORD = 'demo';
export const HTML_LANG: Record<Lang, string> = { dr: 'fa-AF', ps: 'ps-AF', en: 'en' };
const EXTERNAL = /tiles\.openfreemap\.org|tile\.openstreetmap\.org|elevation-tiles-prod|amazonaws\.com|fonts\.(googleapis|gstatic)\.com/;

export const test = base.extend<{ errors: string[] }>({
  context: async ({ context }, use) => {
    await context.route(EXTERNAL, (r) => r.abort());
    await use(context);
  },
  // Uncaught page errors fail the test (console noise from blocked tiles does not).
  errors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`${e.message}\n${(e.stack ?? '').split('\n').slice(1, 6).join('\n')}`));
    await use(errors);
    expect(errors, 'uncaught page errors').toEqual([]);
  }, { auto: true }],
});
export { expect };

export async function apiLogin(request: APIRequestContext, username: string): Promise<string> {
  const r = await request.post('/api/auth/login', { data: { username, password: PASSWORD } });
  expect(r.ok()).toBeTruthy();
  return (await r.json()).access_token as string;
}

export async function setServerPrefs(request: APIRequestContext, username: string, prefs: { lang?: Lang; theme?: 'dark' | 'light' }): Promise<void> {
  const token = await apiLogin(request, username);
  const r = await request.patch('/api/auth/me/preferences', { data: prefs, headers: { authorization: `Bearer ${token}` } });
  expect(r.ok()).toBeTruthy();
}

export async function serverPrefs(request: APIRequestContext, username: string): Promise<{ lang: Lang; theme: string }> {
  const token = await apiLogin(request, username);
  const r = await request.get('/api/auth/me', { headers: { authorization: `Bearer ${token}` } });
  return (await r.json()).user.prefs;
}

/** Logs in through the form and waits for the workspace shell. */
export async function login(page: Page, username: string, path?: string): Promise<void> {
  await page.goto('/login');
  await page.fill('input[name=username]', username);
  await page.fill('input[name=password]', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await expect(page.locator('header')).toBeVisible();
  if (path) await page.goto(path);
}

/** Waits until the MapLibre map exists, has loaded a style and is idle. */
export async function mapReady(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const m = (window as unknown as { __opsMap?: { loaded(): boolean; isStyleLoaded(): boolean } }).__opsMap;
    return !!m && m.isStyleLoaded();
  }, undefined, { timeout: 60_000 });
  await page.evaluate(() => new Promise<void>((resolve) => {
    const m = (window as unknown as { __opsMap: { loaded(): boolean; once(e: string, f: () => void): void } }).__opsMap;
    if (m.loaded()) resolve(); else m.once('idle', () => resolve());
    setTimeout(resolve, 8000);
  }));
}

export const htmlAttrs = (page: Page) => page.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir }));

/** True when the page has not been reloaded since `markPage` was called. */
export const markPage = (page: Page) => page.evaluate(() => { (window as unknown as { __e2eMark: number }).__e2eMark = 1; });
export const stillSamePage = (page: Page) => page.evaluate(() => (window as unknown as { __e2eMark?: number }).__e2eMark === 1);
