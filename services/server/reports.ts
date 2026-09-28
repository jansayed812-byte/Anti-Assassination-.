/**
 * Per-branch summary reports (alerts, ACK times, incidents, plans, blind spots, device health, simulation
 * exercises, inter-branch sync) rendered as JSON, CSV or printable HTML in Dari, Pashto or English.
 */
import type { BranchContext } from './branch-context';
import { L, localDigits, t } from './i18n/messages';
import type { Lang, Tri } from './i18n/types';
import { pick } from './i18n/types';
import type { SyncBranchStatus } from './sync';

export interface BranchSummary {
  branch: string; branch_name: Tri; from: string; to: string; generated_at: string; generated_by: string;
  alerts: { total: number; by_level: Record<string, number>; by_status: Record<string, number>; ack_median_s: number | null; open: number };
  incidents: { active: number; by_severity: Record<string, number> };
  risk: { cells: number; by_level: Record<string, number>; max_score: number };
  plans: { total: number; by_status: Record<string, number>; edited_routes: number };
  blind_spots: { total: number; by_type: Record<string, number>; area_km2: number; crossing_routes: number };
  devices: { total: number; online: number; warn: number; offline: number; low_battery: number };
  sims: Array<{ scenario_id: string; name: Tri; generated_at: string; events: number }>;
  sync: SyncBranchStatus | null;
}

const count = <T>(xs: T[], key: (x: T) => string) => xs.reduce<Record<string, number>>((m, x) => { const k = key(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});

export function branchSummary(ctx: BranchContext, opts: { from?: number; to?: number; by: string; sync?: SyncBranchStatus | null }): BranchSummary {
  const to = opts.to ?? Date.now(), from = opts.from ?? to - 24 * 3600_000;
  const alerts = ctx.alerts.list().filter((a) => { const t0 = Date.parse(a.created_at); return t0 >= from && t0 <= to; });
  // Time from raising to the first ACK; alerts that arrived already acknowledged (imports, replicas) are left out.
  const ackTimes = alerts.filter((a) => a.history[0]?.status !== 'acknowledged').flatMap((a) => {
    const ack = a.history.find((h) => h.status === 'acknowledged');
    return ack ? [(Date.parse(ack.at) - Date.parse(a.created_at)) / 1000] : [];
  }).sort((a, b) => a - b);
  const median = ackTimes.length ? (ackTimes.length % 2 ? ackTimes[(ackTimes.length - 1) / 2] : (ackTimes[ackTimes.length / 2 - 1] + ackTimes[ackTimes.length / 2]) / 2) : null;
  const incidents = ctx.risk.list();
  const grid = ctx.risk.grid();
  const plans = ctx.plans.raw();
  const zones = ctx.blind.zones();
  const devices = ctx.devices.raw();
  return {
    branch: ctx.id, branch_name: ctx.def.name, from: new Date(from).toISOString(), to: new Date(to).toISOString(), generated_at: new Date().toISOString(), generated_by: opts.by,
    alerts: { total: alerts.length, by_level: count(alerts, (a) => a.level), by_status: count(alerts, (a) => a.status), ack_median_s: median == null ? null : Math.round(median), open: alerts.filter((a) => a.status === 'active' || a.status === 'escalated').length },
    incidents: { active: incidents.length, by_severity: count(incidents, (i) => i.severity) },
    risk: { cells: grid.length, by_level: count(grid, (c) => c.level), max_score: grid.reduce((m, c) => Math.max(m, c.score), 0) },
    plans: { total: plans.length, by_status: count(plans, (p) => p.status), edited_routes: plans.reduce((n, p) => n + Object.values(p.routes).filter((r) => r.edited).length, 0) },
    blind_spots: { total: zones.length, by_type: count(zones, (z) => z.type), area_km2: +zones.reduce((s, z) => s + z.area_km2, 0).toFixed(2), crossing_routes: zones.filter((z) => z.routes.length).length },
    devices: { total: devices.length, online: devices.filter((d) => d.state === 'on').length, warn: devices.filter((d) => d.state === 'warn').length, offline: devices.filter((d) => d.state === 'off').length, low_battery: devices.filter((d) => d.battery_pct != null && d.battery_pct < 20).length },
    sims: ctx.sim.allReports().map((r) => ({ scenario_id: r.scenario_id, name: r.scenario_name, generated_at: r.generated_at, events: r.report.events_emitted })),
    sync: opts.sync ?? null,
  };
}

const WORDS: Record<string, Tri> = {
  total: { dr: 'مجموع', ps: 'ټول', en: 'Total' }, open: { dr: 'باز', ps: 'پرانیستې', en: 'Open' },
  critical: { dr: 'بحرانی', ps: 'بحراني', en: 'Critical' }, error: { dr: 'خطا', ps: 'تېروتنه', en: 'Error' }, warning: { dr: 'اخطار', ps: 'خبرداری', en: 'Warning' }, info: { dr: 'معلومات', ps: 'معلومات', en: 'Info' },
  high: { dr: 'بلند', ps: 'لوړ', en: 'High' }, medium: { dr: 'متوسط', ps: 'منځنی', en: 'Medium' }, low: { dr: 'کم', ps: 'ټیټ', en: 'Low' },
  active: { dr: 'فعال', ps: 'فعال', en: 'Active' }, acknowledged: { dr: 'تأیید شده', ps: 'تایید شوی', en: 'Acknowledged' }, escalated: { dr: 'ارتقا یافته', ps: 'لوړ شوی', en: 'Escalated' }, resolved: { dr: 'حل شده', ps: 'حل شوی', en: 'Resolved' },
  running: { dr: 'در جریان', ps: 'روان', en: 'Running' }, pending_approval: { dr: 'منتظر تأیید', ps: 'تایید ته انتظار', en: 'Pending approval' }, approved: { dr: 'تأیید شده', ps: 'تایید شوی', en: 'Approved' }, closed: { dr: 'بسته', ps: 'تړل شوی', en: 'Closed' }, draft: { dr: 'مسوده', ps: 'مسوده', en: 'Draft' },
  network: { dr: 'بدون شبکه', ps: 'بې شبکې', en: 'No network' }, monitoring: { dr: 'بدون نظارت', ps: 'بې څارنې', en: 'Unmonitored' }, access: { dr: 'دسترسی محدود', ps: 'محدود لاسرسی', en: 'Limited access' },
  online: { dr: 'آنلاین', ps: 'آنلاین', en: 'Online' }, offline: { dr: 'آفلاین', ps: 'آفلاین', en: 'Offline' }, low_battery: { dr: 'بتری کم', ps: 'ټیټه بېټري', en: 'Low battery' },
  area_km2: { dr: 'مساحت (کیلومتر مربع)', ps: 'مساحت (مربع کیلومتره)', en: 'Area (km²)' }, crossing_routes: { dr: 'روی مسیر فعال', ps: 'په فعاله لاره کې', en: 'On an active route' },
  edited_routes: { dr: 'مسیرهای ویرایش‌شده', ps: 'سمې شوې لارې', en: 'Edited routes' }, cells: { dr: 'خانه‌های شبکهٔ ریسک', ps: 'د خطر شبکې خانې', en: 'Risk grid cells' }, max_score: { dr: 'بیشترین نمرهٔ ریسک', ps: 'د خطر تر ټولو لوړه نمره', en: 'Highest risk score' },
  outbox: { dr: 'در صف ارسال', ps: 'د لېږلو په کتار کې', en: 'Queued to send' }, sent: { dr: 'ارسال‌شده', ps: 'لېږل شوي', en: 'Sent' }, received: { dr: 'دریافت‌شده', ps: 'ترلاسه شوي', en: 'Received' }, duplicates: { dr: 'تکراری (رد شده)', ps: 'تکراري (رد شوي)', en: 'Duplicates (ignored)' }, link: { dr: 'وضعیت اتصال', ps: 'د نښلېدو حالت', en: 'Link' }, up: { dr: 'وصل', ps: 'نښلول شوی', en: 'Up' }, down: { dr: 'قطع', ps: 'پرې', en: 'Down' },
};
const w = (k: string, lang: Lang) => WORDS[k]?.[lang] ?? k;

/** Flat (section, metric, value) rows in the requested language. */
export function summaryRows(s: BranchSummary, lang: Lang): Array<[string, string, string]> {
  const n = (v: number | string | null) => (v == null ? '—' : localDigits(lang, v));
  const rows: Array<[string, string, string]> = [];
  const sec = (key: Parameters<typeof t>[1]) => t(lang, key);
  rows.push([sec('rep.alerts'), w('total', lang), n(s.alerts.total)], [sec('rep.alerts'), w('open', lang), n(s.alerts.open)]);
  for (const [k, v] of Object.entries(s.alerts.by_level)) rows.push([sec('rep.alerts'), w(k, lang), n(v)]);
  for (const [k, v] of Object.entries(s.alerts.by_status)) rows.push([sec('rep.alerts'), w(k, lang), n(v)]);
  rows.push([sec('rep.ackMedian'), sec('rep.value'), s.alerts.ack_median_s == null ? '—' : t(lang, 'unit.min', { n: (s.alerts.ack_median_s / 60).toFixed(1) })]);
  rows.push([sec('rep.incidents'), w('total', lang), n(s.incidents.active)]);
  for (const [k, v] of Object.entries(s.incidents.by_severity)) rows.push([sec('rep.incidents'), w(k, lang), n(v)]);
  rows.push([sec('rep.incidents'), w('cells', lang), n(s.risk.cells)], [sec('rep.incidents'), w('max_score', lang), n(s.risk.max_score.toFixed(2))]);
  rows.push([sec('rep.plans'), w('total', lang), n(s.plans.total)], [sec('rep.plans'), w('edited_routes', lang), n(s.plans.edited_routes)]);
  for (const [k, v] of Object.entries(s.plans.by_status)) rows.push([sec('rep.plans'), w(k, lang), n(v)]);
  rows.push([sec('rep.blindSpots'), w('total', lang), n(s.blind_spots.total)], [sec('rep.blindSpots'), w('area_km2', lang), n(s.blind_spots.area_km2)], [sec('rep.blindSpots'), w('crossing_routes', lang), n(s.blind_spots.crossing_routes)]);
  for (const [k, v] of Object.entries(s.blind_spots.by_type)) rows.push([sec('rep.blindSpots'), w(k, lang), n(v)]);
  for (const k of ['total', 'online', 'warn', 'offline', 'low_battery'] as const) rows.push([sec('rep.devices'), w(k === 'warn' ? 'warning' : k, lang), n(s.devices[k])]);
  rows.push([sec('rep.sims'), w('total', lang), n(s.sims.length)]);
  for (const r of s.sims) rows.push([sec('rep.sims'), pick(r.name, lang), n(r.events)]);
  if (s.sync) {
    rows.push([sec('rep.sync'), w('link', lang), w(s.sync.link, lang)]);
    for (const k of ['outbox', 'sent', 'received', 'duplicates'] as const) rows.push([sec('rep.sync'), w(k, lang), n(s.sync[k])]);
  }
  return rows;
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function summaryCsv(s: BranchSummary, lang: Lang): string {
  const head = [t(lang, 'rep.title', { branch: s.branch_name }), t(lang, 'rep.period', { from: s.from.slice(0, 16).replace('T', ' '), to: s.to.slice(0, 16).replace('T', ' ') })];
  const lines = [...head.map((h) => csvCell(h)), '', ['', t(lang, 'rep.metric'), t(lang, 'rep.value')].map(csvCell).join(',')];
  for (const r of summaryRows(s, lang)) lines.push(r.map(csvCell).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function summaryHtml(s: BranchSummary, lang: Lang): string {
  const rtl = lang !== 'en';
  const htmlLang = lang === 'dr' ? 'fa-AF' : lang === 'ps' ? 'ps-AF' : 'en';
  const date = (iso: string) => new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : `${htmlLang}-u-ca-persian`, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kabul' }).format(new Date(iso));
  const rows = summaryRows(s, lang);
  let body = '', last = '';
  for (const [section, metric, value] of rows) {
    if (section !== last) { if (last) body += '</tbody></table>'; body += `<h2>${esc(section)}</h2><table><thead><tr><th>${esc(t(lang, 'rep.metric'))}</th><th>${esc(t(lang, 'rep.value'))}</th></tr></thead><tbody>`; last = section; }
    body += `<tr><td>${esc(metric)}</td><td class="v">${esc(value)}</td></tr>`;
  }
  if (last) body += '</tbody></table>';
  const title = t(lang, 'rep.title', { branch: s.branch_name });
  return `<!doctype html><html lang="${htmlLang}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
:root{--ink:#14202b;--muted:#5b6b78;--line:#d6dde3;--accent:#0f6b73;--bg:#ffffff}
body{font-family:"Noto Sans Arabic","Noto Naskh Arabic",Tahoma,system-ui,sans-serif;color:var(--ink);background:var(--bg);margin:0;padding:32px;max-width:900px;margin-inline:auto;line-height:1.6}
h1{font-size:22px;margin:0 0 4px;color:var(--accent)}p.meta{color:var(--muted);margin:0 0 24px;font-size:13px}
h2{font-size:15px;margin:24px 0 8px;border-bottom:2px solid var(--accent);padding-bottom:4px}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:6px 10px;border-bottom:1px solid var(--line);text-align:start}th{color:var(--muted);font-weight:600}
td.v{font-variant-numeric:tabular-nums;font-weight:600;width:30%}
.badge{display:inline-block;font-size:11px;padding:2px 8px;border-radius:10px;background:#fff4d6;color:#7a5200;margin-inline-start:8px}
@media print{body{padding:0}h2{break-after:avoid}table{break-inside:auto}}
</style></head><body>
<h1>${esc(title)}<span class="badge">${esc(lang === 'en' ? 'Exercise data' : lang === 'ps' ? 'د تمرین معلومات' : 'معلومات تمرینی')}</span></h1>
<p class="meta">${esc(t(lang, 'rep.period', { from: date(s.from), to: date(s.to) }))} · ${esc(t(lang, 'rep.generated', { at: date(s.generated_at), by: s.generated_by }))}</p>
${body}
</body></html>`;
}

export const reportTitle = (s: BranchSummary): Tri => L('rep.title', { branch: s.branch_name });
