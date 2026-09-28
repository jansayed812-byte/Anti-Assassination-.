/**
 * Requirements 1–2 — the 3D map opens on Mazar-i-Sharif with the whole urban area in view; zoom, 2D/3D and
 * "show the whole city" work; map chrome does not overlap in either writing direction.
 */
import type { Page } from '@playwright/test';
import { test, expect, login, mapReady, setServerPrefs } from './fixtures';

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** Fraction of the branch boundary vertices that project inside the visible map canvas. */
async function boundaryInView(page: Page, branch: string): Promise<{ inside: number; total: number; center: { lng: number; lat: number }; zoom: number }> {
  const cfg = await (await page.request.get('/api/config')).json();
  const ring: [number, number][] = cfg.branches.find((b: { id: string }) => b.id === branch).boundary;
  return page.evaluate((ring) => {
    const m = (window as unknown as { __opsMap: { project(p: [number, number]): { x: number; y: number }; getCanvas(): HTMLCanvasElement; getCenter(): { lng: number; lat: number }; getZoom(): number } }).__opsMap;
    const c = m.getCanvas(), w = c.clientWidth, h = c.clientHeight;
    const inside = ring.filter((p) => { const s = m.project(p); return s.x >= -2 && s.y >= -2 && s.x <= w + 2 && s.y <= h + 2; }).length;
    return { inside, total: ring.length, center: m.getCenter(), zoom: m.getZoom() };
  }, ring);
}
const settle = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => {
  const m = (window as unknown as { __opsMap: { isMoving(): boolean; once(e: string, f: () => void): void } }).__opsMap;
  if (!m.isMoving()) setTimeout(resolve, 300); else m.once('moveend', () => setTimeout(resolve, 300));
}));

test.describe('map', () => {
  test('opens on Mazar-i-Sharif with the whole city visible', async ({ page }) => {
    await login(page, 'maryam', '/live');
    await mapReady(page);
    await settle(page);
    const v = await boundaryInView(page, 'MZR');
    expect(v.center.lat).toBeGreaterThan(36.6); expect(v.center.lat).toBeLessThan(36.8);
    expect(v.center.lng).toBeGreaterThan(67.0); expect(v.center.lng).toBeLessThan(67.25);
    expect(v.inside / v.total).toBeGreaterThanOrEqual(0.98);
    expect(v.zoom).toBeGreaterThan(10);
    await expect(page.locator('[data-testid=map] canvas.maplibregl-canvas, canvas.maplibregl-canvas').first()).toBeVisible();
  });

  test('zooms, toggles 2D/3D and returns to the whole city', async ({ page }) => {
    await login(page, 'maryam', '/live');
    await mapReady(page);
    await settle(page);
    const zoom = () => page.evaluate(() => (window as unknown as { __opsMap: { getZoom(): number } }).__opsMap.getZoom());
    const pitch = () => page.evaluate(() => (window as unknown as { __opsMap: { getPitch(): number } }).__opsMap.getPitch());
    const z0 = await zoom();
    await page.locator('main button[aria-label]').filter({ has: page.locator('.ph-plus') }).first().click();
    await settle(page);
    expect(await zoom()).toBeGreaterThan(z0 + 0.5);

    await page.getByRole('button', { name: '2D', exact: true }).click();
    await expect.poll(pitch).toBeLessThan(1);
    await page.getByRole('button', { name: '3D', exact: true }).click();
    await expect.poll(pitch).toBeGreaterThan(30);

    await page.locator('[data-testid=fit-city]').click();
    await settle(page);
    const v = await boundaryInView(page, 'MZR');
    expect(v.inside / v.total).toBeGreaterThanOrEqual(0.98);
  });

  test('keeps coordinates to six decimals under the cursor', async ({ page }) => {
    await login(page, 'reza', '/analysis');
    await mapReady(page);
    const canvas = page.locator('canvas.maplibregl-canvas').first();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('[data-testid=cursor]')).toBeVisible();
    const text = await page.locator('[data-testid=cursor]').innerText();
    // Afghan or Latin digits, six decimals each: "36.709012, 67.110934"
    expect(text).toMatch(/[\d۰-۹]+[.٫][\d۰-۹]{6},\s*[\d۰-۹]+[.٫][\d۰-۹]{6}/);
  });

  for (const lang of ['dr', 'en'] as const) {
    test(`legend, status and attribution do not overlap (${lang})`, async ({ page, request }) => {
      await setServerPrefs(request, 'reza', { lang });
      await login(page, 'reza', '/analysis');
      await mapReady(page);
      const legend = (await page.locator('[data-testid=legend]').boundingBox())!;
      const status = (await page.locator('[data-testid=map-status]').boundingBox())!;
      const others = [await page.locator('.maplibregl-ctrl-scale').boundingBox(), await page.locator('.maplibregl-ctrl-attrib').boundingBox()].filter(Boolean) as Box[];
      expect(others.length).toBeGreaterThan(0);
      for (const o of others) { expect(overlaps(legend, o)).toBe(false); expect(overlaps(status, o)).toBe(false); }
      expect(overlaps(legend, status)).toBe(false);
      await setServerPrefs(request, 'reza', { lang: 'dr' });
    });
  }
});
