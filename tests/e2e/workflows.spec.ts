/**
 * Requirements 2–5 — risk extremes, blind spots, escort planning with manual route editing and approval,
 * branch isolation and per-branch reports, exercised through the UI as each role would.
 */
import type { Page, Response } from '@playwright/test';
import { test, expect, login, mapReady, apiLogin } from './fixtures';

const mapCenter = (page: Page) => page.evaluate(() => { const c = (window as unknown as { __opsMap: { getCenter(): { lat: number; lng: number } } }).__opsMap.getCenter(); return { lat: c.lat, lon: c.lng }; });
const mapZoom = (page: Page) => page.evaluate(() => (window as unknown as { __opsMap: { getZoom(): number } }).__opsMap.getZoom());
const idle = (page: Page) => page.evaluate(() => new Promise<void>((r) => { const m = (window as unknown as { __opsMap: { isMoving(): boolean; once(e: string, f: () => void): void } }).__opsMap; if (!m.isMoving()) setTimeout(r, 400); else m.once('moveend', () => setTimeout(r, 400)); }));
const api = (method: string, path: string) => (r: Response) => r.url().includes(`/api${path}`) && r.request().method() === method;
const signOut = async (page: Page) => { await page.evaluate(() => { sessionStorage.clear(); }); await page.goto('/login'); };

test.describe('risk analysis', () => {
  test('lists the 10 most dangerous and 10 safest places and flies to them', async ({ page }) => {
    await login(page, 'reza', '/analysis');
    await mapReady(page);
    await expect(page.locator('[data-testid^=dangerous-]')).toHaveCount(10);
    const before = await mapCenter(page);
    await page.locator('[data-testid=dangerous-1]').click();
    await expect(page.locator('[data-testid=dangerous-1]')).toHaveAttribute('aria-current', 'true');
    await idle(page);
    expect(await mapZoom(page)).toBeGreaterThan(15);
    const after = await mapCenter(page);
    expect(Math.abs(after.lat - before.lat) + Math.abs(after.lon - before.lon)).toBeGreaterThan(0.0005);

    const token = await apiLogin(page.request, 'reza');
    const ext = await (await page.request.get('/api/v1/risk/extremes', { headers: { authorization: `Bearer ${token}` } })).json();
    const top = ext.dangerous[0];
    expect(Math.abs(after.lat - top.lat)).toBeLessThan(0.004);
    expect(Math.abs(after.lon - top.lon)).toBeLessThan(0.005);

    await page.getByRole('tab').nth(1).click();
    await expect(page.locator('[data-testid^=safest-]')).toHaveCount(10);
  });

  test('shows blind spots with a detailed report', async ({ page }) => {
    await login(page, 'reza', '/analysis');
    await mapReady(page);
    await page.getByRole('tab').nth(2).click();
    const zones = page.locator('[data-testid^=zone-]');
    await expect(zones.first()).toBeVisible();
    const id = (await zones.first().getAttribute('data-testid'))!.replace('zone-', '');
    const zone = page.locator(`[data-testid=zone-${id}]`);
    await zone.click();
    await expect(zone).toHaveAttribute('aria-current', 'true');
    // The inspector names the zone and gives its area, nearest support and mitigation — and keeps showing it
    // across the periodic recomputation (zones keep their ids while drones move).
    const heading = page.locator('h2').filter({ hasText: id });
    await expect(heading).toBeVisible();
    await expect(page.getByText(/km²|کیلومتر مربع|مربع کیلومتره/).first()).toBeVisible();
    await page.waitForTimeout(11_000);
    await expect(heading).toBeVisible();
    await expect(zone).toHaveAttribute('aria-current', 'true');
  });
});

test.describe('escort planning', () => {
  test('planner creates a plan, edits a route by hand, submits; commander approves; a later edit needs re-approval', async ({ page }) => {
    await login(page, 'ali', '/planning');
    await mapReady(page);
    await page.locator('[data-testid=new-plan-toggle]').click();
    const form = page.locator('[data-testid=new-plan]');
    const options = await form.locator('[data-testid=select-origin] option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
    expect(options.length).toBeGreaterThan(3);
    await form.locator('[data-testid=select-origin]').selectOption(options[0]);
    await form.locator('[data-testid=select-destination]').selectOption(options[options.length - 1]);
    const [created] = await Promise.all([page.waitForResponse(api('POST', '/security/escort-plan')), form.locator('button[type=submit]').click()]);
    expect(created.status()).toBe(201);
    const plan = await created.json();
    const pace = (k: string) => plan.pace.find((r: { k: string }) => r.k === k);
    expect(plan.pace.map((r: { k: string }) => r.k)).toEqual(['P', 'A', 'C', 'E']);
    for (const k of ['P', 'A', 'C', 'E']) await expect(page.locator(`[data-testid=route-${k}]`)).toBeVisible();
    expect(pace('P').eta_min).toBeGreaterThan(0);
    expect(pace('P').segments.length).toBeGreaterThan(0);
    expect(plan.status).toBe('draft');

    // Manual edit: click on route A on the map to add a waypoint.
    await page.locator('[data-testid=route-A]').click();
    await page.locator('[data-testid=edit-route]').click();
    await expect(page.locator('[data-testid=route-editor]')).toBeVisible();
    const path: Array<{ lat: number; lon: number }> = pace('A').path;
    await page.evaluate((path) => {
      const m = (window as unknown as { __opsMap: { fitBounds(b: [[number, number], [number, number]], o: object): void } }).__opsMap;
      const lons = path.map((p) => p.lon), lats = path.map((p) => p.lat);
      m.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 120, duration: 0, pitch: 0, bearing: 0 });
    }, path);
    await idle(page);
    const q = path[Math.floor(path.length * 0.45)];
    const pt = await page.evaluate((q) => {
      const m = (window as unknown as { __opsMap: { project(p: [number, number]): { x: number; y: number }; getCanvas(): HTMLCanvasElement } }).__opsMap;
      const s = m.project([q.lon, q.lat]), r = m.getCanvas().getBoundingClientRect();
      return { x: r.left + s.x, y: r.top + s.y };
    }, q);
    const [edited] = await Promise.all([page.waitForResponse(api('PUT', `/security/escort-plan/${plan.id}/routes/A`)), page.mouse.click(pt.x, pt.y)]);
    expect(edited.status()).toBe(200);
    const afterEdit = await edited.json();
    expect(afterEdit.routes.A.waypoints.length).toBe(1);
    expect(afterEdit.routes.A.edited).toBe(true);
    expect(afterEdit.routes.A.version).toBeGreaterThan(plan.routes.A.version ?? 0);
    await expect(page.locator('[data-testid=toast]').first()).toBeVisible();

    const [submitted] = await Promise.all([page.waitForResponse(api('POST', `/security/escort-plan/${plan.id}/submit`)), page.locator('[data-testid=submit]').click()]);
    expect((await submitted.json()).status).toBe('pending_approval');

    // Commander approves.
    await signOut(page);
    await login(page, 'ahmadi', '/planning');
    await page.locator(`[data-testid=plan-${plan.id}]`).click();
    const [approved] = await Promise.all([page.waitForResponse(api('POST', `/security/escort-plan/${plan.id}/approve`)), page.locator('[data-testid=approve]').click()]);
    expect((await approved.json()).status).toBe('approved');
    await expect(page.locator('[data-testid=approve]')).toBeDisabled();

    // Any later route edit sends the plan back for approval.
    const token = await apiLogin(page.request, 'ali');
    const r = await page.request.put(`/api/security/escort-plan/${plan.id}/routes/A`, { data: { waypoints: [] }, headers: { authorization: `Bearer ${token}` } });
    expect(r.ok()).toBeTruthy();
    expect((await r.json()).status).toBe('pending_approval');
  });

  test('an operator can view plans but not create or edit them', async ({ page }) => {
    await login(page, 'maryam', '/planning');
    await expect(page.locator('[data-testid^=plan-]').first()).toBeVisible();
    await expect(page.locator('[data-testid=new-plan-toggle]')).toHaveCount(0);
    await page.locator('[data-testid^=plan-]').first().click();
    await expect(page.locator('[data-testid=edit-route]')).toHaveCount(0);
  });
});

test.describe('branches', () => {
  test('HQ commander switches to Kabul read-only; the map and data follow the branch', async ({ page }) => {
    await login(page, 'ahmadi', '/live');
    await mapReady(page);
    const mzr = await mapCenter(page);
    expect(mzr.lat).toBeGreaterThan(36.5);
    await page.locator('[data-testid=branch-switcher]').click();
    await expect(page.getByRole('menuitem')).toHaveCount(3);
    await Promise.all([page.waitForResponse(api('POST', '/auth/switch-branch')), page.getByRole('menuitem').filter({ hasText: 'KBL' }).click()]);
    await expect(page.locator('[data-testid=branch-switcher] .chip-warning')).toBeVisible(); // read-only badge
    await mapReady(page);
    await idle(page);
    const kbl = await mapCenter(page);
    expect(kbl.lat).toBeGreaterThan(34.4); expect(kbl.lat).toBeLessThan(34.7);
    expect(kbl.lon).toBeGreaterThan(69.0); expect(kbl.lon).toBeLessThan(69.35);
    await page.goto('/planning');
    await expect(page.locator('[data-testid=new-plan-toggle]')).toHaveCount(0);
  });

  test('a Kabul operator sees only Kabul and is refused Mazar data', async ({ page }) => {
    await login(page, 'farida', '/live');
    await page.locator('[data-testid=branch-switcher]').click();
    await expect(page.getByRole('menuitem')).toHaveCount(1);
    const token = await apiLogin(page.request, 'farida');
    const denied = await page.request.get('/api/v1/risk/extremes', { headers: { authorization: `Bearer ${token}`, 'x-branch': 'MZR' } });
    expect(denied.status()).toBe(403);
    const own = await page.request.get('/api/v1/risk/extremes', { headers: { authorization: `Bearer ${token}` } });
    expect(own.status()).toBe(200);
  });

  test('admin opens a per-branch printable report in the chosen language', async ({ page }) => {
    await login(page, 'admin', '/admin');
    await page.locator('button.list-item:has(.ph-file-text)').click();
    await page.locator('[data-testid=report-branch]').selectOption('HRT');
    await expect(page.locator('[data-testid=report-kpis]')).toBeVisible();
    await page.locator('select').filter({ has: page.locator('option[value=ps]') }).selectOption('ps');
    const [popup] = await Promise.all([page.waitForEvent('popup'), page.locator('[data-testid=report-open]').click()]);
    await popup.waitForLoadState();
    await expect.poll(() => popup.evaluate(() => document.documentElement.lang)).toBe('ps-AF');
    expect(await popup.evaluate(() => document.documentElement.dir)).toBe('rtl');
    await expect(popup.locator('h1')).toContainText('هرات');
  });
});

test.describe('access control', () => {
  test('the Admin workspace is only reachable by the admin role, in the nav and by direct URL', async ({ page }) => {
    await login(page, 'maryam', '/live'); // operator: no read:admin
    await expect(page.locator('header nav button', { hasText: 'Admin' })).toHaveCount(0);
    const token = await apiLogin(page.request, 'maryam');
    for (const path of ['/api/auth/audit', '/api/auth/users', '/api/operations/sla/metrics']) {
      expect((await page.request.get(path, { headers: { authorization: `Bearer ${token}` } })).status(), path).toBe(403);
    }
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/live$/); // ModeGuard bounces an unauthorized deep link home
    await expect(page.locator('[data-testid=report-branch]')).toHaveCount(0);

    await signOut(page);
    await login(page, 'admin', '/live');
    await expect(page.locator('header nav button', { hasText: 'Admin' })).toBeVisible();
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin$/);
  });
});
