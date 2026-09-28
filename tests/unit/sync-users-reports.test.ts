/**
 * Inter-branch sync (dedupe, last-writer-wins, store-and-forward), user directory and access across branches,
 * language/theme preferences, and per-branch reports in Dari, Pashto and English.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { SyncHub, type SyncEnvelope } from '../../services/server/sync';
import { UserDirectory, UserError } from '../../services/server/domain/users';
import { createBranchContext, type BranchContext } from '../../services/server/branch-context';
import { branchDef } from '../../services/server/geodata/branches';
import { loadScenarios } from '../../services/server/domain/sim';
import { branchSummary, summaryCsv, summaryHtml, summaryRows } from '../../services/server/reports';

const BRANCHES = ['MZR', 'KBL', 'HRT'];
function hub() {
  const got: Array<[string, SyncEnvelope]> = [];
  let clock = 1_000;
  const h = new SyncHub(BRANCHES, (target, env) => got.push([target, env]), () => clock++);
  return { h, got };
}
const env = (origin: string, id: string, version: number, payload: unknown = {}) => ({ origin, kind: 'alert' as const, id, version, payload });

describe('SyncHub', () => {
  it('delivers to targets only, never back to the origin', () => {
    const { h, got } = hub();
    h.publish(env('KBL', 'a1', 1), ['MZR', 'KBL']);
    expect(got.map(([t]) => t)).toEqual(['MZR']);
    expect(h.status().find((s) => s.branch === 'KBL')!.sent).toBe(1);
    expect(h.status().find((s) => s.branch === 'MZR')!.received).toBe(1);
  });

  it('drops duplicates and stale versions (last writer wins)', () => {
    const { h, got } = hub();
    const e2 = { ...env('KBL', 'a1', 2, { status: 'acknowledged' }), at: 5 };
    expect(h.receive('MZR', e2)).toBe('applied');
    expect(h.receive('MZR', e2)).toBe('duplicate');
    expect(h.receive('MZR', { ...env('KBL', 'a1', 1, { status: 'active' }), at: 6 })).toBe('stale');
    expect(h.receive('MZR', { ...env('KBL', 'a1', 3, { status: 'resolved' }), at: 7 })).toBe('applied');
    expect(got).toHaveLength(2);
    // The feed keeps only the latest version per record.
    expect(h.feed('MZR')).toHaveLength(1);
    expect(h.feed('MZR')[0].version).toBe(3);
    const st = h.status().find((s) => s.branch === 'MZR')!;
    expect([st.received, st.duplicates, st.stale]).toEqual([2, 1, 1]);
  });

  it('keys records by origin: the same id from two branches does not collide', () => {
    const { h } = hub();
    expect(h.receive('MZR', { ...env('KBL', 'x', 1), at: 1 })).toBe('applied');
    expect(h.receive('MZR', { ...env('HRT', 'x', 1), at: 1 })).toBe('applied');
    expect(h.feed('MZR')).toHaveLength(2);
  });

  it('stores and forwards while a link is down, then drains in order', () => {
    const { h, got } = hub();
    h.setLink('MZR', false);
    h.publish(env('KBL', 'a1', 1), ['MZR']);
    h.publish(env('KBL', 'a1', 2), ['MZR']);
    h.publish(env('HRT', 'b1', 1), ['MZR', 'KBL']);
    expect(got.map(([t, e]) => `${t}:${e.id}`)).toEqual(['KBL:b1']);
    expect(h.status().find((s) => s.branch === 'KBL')!.outbox).toBe(2);
    expect(h.status().find((s) => s.branch === 'MZR')!.link).toBe('down');
    h.setLink('MZR', true);
    expect(got.map(([t, e]) => `${t}:${e.id}@${e.version}`)).toEqual(['KBL:b1@1', 'MZR:a1@1', 'MZR:a1@2', 'MZR:b1@1']);
    expect(h.status().every((s) => s.outbox === 0)).toBe(true);
  });

  it('holds messages from an origin whose own link is down', () => {
    const { h, got } = hub();
    h.setLink('HRT', false);
    h.publish(env('HRT', 'c1', 1), ['MZR']);
    expect(got).toHaveLength(0);
    h.setLink('HRT', true);
    expect(got).toHaveLength(1);
  });

  it('rejects unknown branches', () => {
    const { h } = hub();
    expect(() => h.setLink('XYZ', false)).toThrow();
    h.publish(env('KBL', 'a', 1), ['XYZ']);
    expect(h.status().every((s) => s.outbox === 0)).toBe(true);
  });
});

describe('UserDirectory', () => {
  const users = new UserDirectory('demo');

  it('authenticates active users only', () => {
    expect(users.authenticate('maryam', 'demo')?.username).toBe('maryam');
    expect(users.authenticate('maryam', 'wrong')).toBeNull();
    expect(users.authenticate('test', 'demo')).toBeNull(); // inactive
    expect(users.authenticate('nobody', 'demo')).toBeNull();
    expect((users.byUsername('maryam') as Record<string, unknown>).hash).toBeUndefined();
  });

  it('gives per-branch roles and readable branches', () => {
    const ali = users.byUsername('ali')!, ahmadi = users.byUsername('ahmadi')!, farida = users.byUsername('farida')!;
    expect(users.roleIn(ali.id, 'MZR')).toBe('planner');
    expect(users.roleIn(ali.id, 'KBL')).toBe('planner');
    expect(users.roleIn(ali.id, 'HRT')).toBeNull();
    expect(users.readable(ali.id).sort()).toEqual(['KBL', 'MZR']);
    expect(users.readable(ahmadi.id).sort()).toEqual(['HRT', 'KBL', 'MZR']); // regional HQ commander
    expect(users.roleIn(ahmadi.id, 'KBL')).toBeNull(); // reads Kabul, holds no role there
    expect(users.readable(farida.id)).toEqual(['KBL']);
    expect(users.list('HRT').map((u) => u.username).sort()).toEqual(['admin', 'sara', 'sultani', 'wahidi']);
    expect(users.byRole('commander', 'KBL')?.username).toBe('karimi');
  });

  it('stores validated language and theme preferences', () => {
    const id = users.byUsername('reza')!.id;
    expect(users.byId(id)!.prefs).toEqual({ lang: 'dr', theme: 'dark' });
    expect(users.setPreferences(id, { lang: 'ps' }).prefs).toEqual({ lang: 'ps', theme: 'dark' });
    expect(users.setPreferences(id, { theme: 'light' }).prefs).toEqual({ lang: 'ps', theme: 'light' });
    expect(() => users.setPreferences(id, { lang: 'fa' as never })).toThrow(UserError);
    expect(() => users.setPreferences(id, { theme: 'blue' as never })).toThrow(UserError);
    expect(() => users.setPreferences('nope', { lang: 'en' })).toThrow(UserError);
    expect(users.byUsername('ali')!.prefs.lang).toBe('ps');
    expect(users.byUsername('admin')!.prefs.lang).toBe('en');
  });
});

describe('per-branch reports', () => {
  let mzr: BranchContext, kbl: BranchContext;
  beforeAll(() => {
    const scenarios = loadScenarios(join(__dirname, '../../services/simulation/scenarios'));
    mzr = createBranchContext(branchDef('MZR')!, { dataDir: '/nonexistent-osm-dir', scenarios });
    kbl = createBranchContext(branchDef('KBL')!, { dataDir: '/nonexistent-osm-dir', scenarios });
    mzr.blind.recompute(); kbl.blind.recompute();
  });
  afterAll(() => { mzr.stop(); kbl.stop(); });

  it('summarises only the branch’s own data', () => {
    const a = branchSummary(mzr, { by: 'ahmadi' }), b = branchSummary(kbl, { by: 'karimi' });
    expect(a.branch).toBe('MZR'); expect(b.branch).toBe('KBL');
    expect(a.branch_name.en).toContain('Mazar');
    expect(b.branch_name.en).toContain('Kabul');
    expect(a.risk.cells).toBe(mzr.risk.grid().length);
    expect(b.risk.cells).toBe(kbl.risk.grid().length);
    expect(a.risk.cells).not.toBe(b.risk.cells);
    expect(a.plans.total).toBe(mzr.plans.raw().length);
    expect(a.devices.total).toBe(mzr.devices.raw().length);
    expect(a.blind_spots.total).toBe(mzr.blind.zones().length);
    expect(a.incidents.active).toBeGreaterThan(0);
    expect(a.generated_by).toBe('ahmadi');
  });

  it('respects the requested period', () => {
    const future = Date.now() + 3600_000;
    const s = branchSummary(mzr, { by: 'x', from: future, to: future + 1000 });
    expect(s.alerts.total).toBe(0);
    expect(s.alerts.ack_median_s).toBeNull();
  });

  it('renders rows in Dari (Afghan digits), Pashto and English', () => {
    const s = branchSummary(mzr, { by: 'ahmadi' });
    const en = summaryRows(s, 'en'), dr = summaryRows(s, 'dr'), ps = summaryRows(s, 'ps');
    expect(dr.length).toBe(en.length);
    expect(ps.length).toBe(en.length);
    expect(en.some(([, , v]) => /\d/.test(v))).toBe(true);
    expect(dr.every(([, , v]) => !/[0-9]/.test(v))).toBe(true);
    expect(dr.some(([, , v]) => /[۰-۹]/.test(v))).toBe(true);
    expect(en.some(([sec]) => sec === 'Alerts' || /Alert/.test(sec))).toBe(true);
    expect(dr.some(([sec]) => /اخطار/.test(sec))).toBe(true);
    expect(ps.some(([sec]) => /خبرتیا/.test(sec))).toBe(true);
  });

  it('exports CSV with a UTF-8 BOM and printable HTML with lang/dir', () => {
    const s = branchSummary(mzr, { by: 'ahmadi' });
    const csv = summaryCsv(s, 'dr');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('\r\n');
    expect(csv.split('\r\n').length).toBeGreaterThan(summaryRows(s, 'dr').length);
    const dr = summaryHtml(s, 'dr'), ps = summaryHtml(s, 'ps'), en = summaryHtml(s, 'en');
    expect(dr).toContain('lang="fa-AF" dir="rtl"');
    expect(ps).toContain('lang="ps-AF" dir="rtl"');
    expect(en).toContain('lang="en" dir="ltr"');
    expect(en).toContain('Exercise data');
    expect(dr).toContain('معلومات تمرینی');
    // Solar Hijri dates with Afghan month names in Dari.
    expect(/حمل|ثور|جوزا|سرطان|اسد|سنبله|میزان|عقرب|قوس|جدی|دلو|حوت/.test(dr)).toBe(true);
    expect(dr).not.toMatch(/<script/i);
  });
});
