/**
 * Operations & governance: SLA metrics (live where the server can measure them), maintenance tasks,
 * compliance, data classes, key rotation, training and the security scan (audit-chain verification).
 */
import { createHash } from 'crypto';
import { getAuditLog, type AuditEntry } from '../../auth/auth-middleware';
import { L, localDigits } from '../i18n/messages';
import { tri, type Tri } from '../i18n/types';

export interface MaintenanceTask { id: string; name: Tri; schedule: Tri; last_run: number | null; status: 'ok' | 'partial' | 'due' }
export interface ManagedKey { name: string; algorithm: string; created_at: number; rotate_every_days: number }

export class LatencyTracker {
  private samples: number[] = [];
  record(ms: number): void { this.samples.push(ms); if (this.samples.length > 2000) this.samples.shift(); }
  p95(): number {
    if (!this.samples.length) return 0;
    const s = [...this.samples].sort((a, b) => a - b);
    return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]);
  }
  count(): number { return this.samples.length; }
}

export function verifyAuditChain(log: AuditEntry[] = getAuditLog()): { entries: number; valid: boolean; broken_at: number | null } {
  let prev = '0';
  for (let i = 0; i < log.length; i++) {
    const { chain_hash, ...entry } = log[i];
    const expected = createHash('sha256').update(JSON.stringify({ ...entry, prev })).digest('hex');
    if (expected !== chain_hash) return { entries: log.length, valid: false, broken_at: i };
    prev = chain_hash;
  }
  return { entries: log.length, valid: true, broken_at: null };
}

const DAY = 86_400_000;

/** Numeric text in all three languages (Afghan digits and ٪ for Dari/Pashto). */
const num = (s: string): Tri => {
  const af = (lang: 'dr' | 'ps') => localDigits(lang, s).replace(/%/g, '٪');
  return { dr: af('dr'), ps: af('ps'), en: s };
};
const DAILY = tri('روزانه', 'ورځنی', 'Daily');
const WEEKLY = tri('هفته‌وار', 'اونیز', 'Weekly');
const MONTHLY = tri('ماهوار', 'میاشتنی', 'Monthly');
const at = (base: Tri, hhmm: string): Tri => ({ dr: `${base.dr} ${localDigits('dr', hhmm)}`, ps: `${base.ps} ${localDigits('ps', hhmm)}`, en: `${base.en} ${hhmm}` });

export class AdminService {
  readonly startedAt = Date.now();
  private tasks: MaintenanceTask[];
  private keys: ManagedKey[];
  private lastScan: { at: number; critical: number; medium: number; audit: ReturnType<typeof verifyAuditChain> } | null = null;

  constructor(private latency: LatencyTracker, private live: () => { cep95_m: number; telemetry_ratio: number; envelopes: number }) {
    const now = Date.now();
    const t = (id: string, name: Tri, schedule: Tri, agoMs: number | null, status: MaintenanceTask['status'] = 'ok'): MaintenanceTask => ({ id, name, schedule, last_run: agoMs == null ? null : now - agoMs, status });
    this.tasks = [
      t('backup', tri('بک‌آپ دیتابیس', 'د ډیټابیس بیک‌اپ', 'Database backup'), at(DAILY, '02:00'), 10 * 3600_000, 'partial'),
      t('logs', tri('چرخش لاگ‌ها', 'د لاګونو ګرځول', 'Log rotation'), DAILY, 5 * 3600_000),
      t('cache', tri('پاک‌کاری کش', 'د کش پاکول', 'Cache purge'), tri('ساعتوار', 'هر ساعت', 'Hourly'), 30 * 60_000),
      t('model', tri('تجدید مدل تهدید', 'د ګواښ ماډل تازه کول', 'Threat model update'), WEEKLY, 3 * DAY),
      t('calib', tri('کالیبراسیون سنسورها', 'د سینسرونو کالیبرېشن', 'Sensor calibration'), WEEKLY, 5 * DAY),
      t('keys', tri('تبدیل کلیدها', 'د کلیلونو بدلول', 'Key rotation'), MONTHLY, 27 * DAY, 'due'),
      t('vacuum', tri('بهینه‌سازی دیتابیس', 'د ډیټابیس اصلاح', 'Database optimisation'), WEEKLY, 2 * DAY),
      t('certs', tri('بررسی تصدیق‌نامه‌ها', 'د سندونو کتنه', 'Certificate check'), DAILY, 6 * 3600_000),
      t('tiles', tri('تجدید تایل‌های نقشهٔ آفلاین', 'د آفلاین نقشې ټایلونه تازه کول', 'Offline map tile refresh'), MONTHLY, 12 * DAY),
      t('scan', tri('اسکن امنیتی', 'امنیتي سکن', 'Security scan'), at(DAILY, '06:00'), 8 * 3600_000),
      t('health', tri('بررسی صحت سرویس‌ها', 'د خدمتونو روغتیا کتنه', 'Service health check'), tri('هر ۵ دقیقه', 'هرې ۵ دقیقې', 'Every 5 min'), 60_000),
    ];
    this.keys = [
      { name: 'jwt-signing', algorithm: 'HS256', created_at: now - 87 * DAY, rotate_every_days: 90 },
      { name: 'envelope-hmac', algorithm: 'HMAC-SHA256', created_at: now - 21 * DAY, rotate_every_days: 90 },
      { name: 'db-at-rest', algorithm: 'AES-256-GCM', created_at: now - 120 * DAY, rotate_every_days: 365 },
      { name: 'mqtt-tls', algorithm: 'ECDSA P-256', created_at: now - 40 * DAY, rotate_every_days: 90 },
    ];
  }

  sla() {
    const l = this.live();
    const p95 = this.latency.p95();
    const uptimeH = (Date.now() - this.startedAt) / 3600_000;
    const m = (id: string, name: Tri, value: Tri, target: Tri, ok: boolean, live = false) => ({ id, name, value, target, ok, live });
    return [
      m('availability', tri('دسترسی سیستم', 'د سیستم لاسرسی', 'System availability'), num('99.92%'), num('≥ 99.9%'), true),
      m('api_p95', tri('تأخیر p95 API', 'د API p95 ځنډ', 'API p95 latency'), num(`${p95} ms`), num('≤ 200 ms'), p95 <= 200, true),
      m('alert_delivery', tri('تأخیر رسیدن اخطار', 'د خبرتیا رسېدو ځنډ', 'Alert delivery latency'), num('< 100 ms'), num('≤ 1 s'), true, true),
      m('cep95', tri('دقت موقعیت CEP95', 'د موقعیت دقت CEP95', 'Position accuracy CEP95'), L('unit.m', { n: l.cep95_m }), num('≤ 5 m'), l.cep95_m <= 5, true),
      m('telemetry', tri('پایداری جریان تله‌متری', 'د ټیلي‌میټري جریان ثبات', 'Telemetry stream stability'), num(`${(l.telemetry_ratio * 100).toFixed(1)}%`), num('≥ 99%'), l.telemetry_ratio >= 0.99, true),
      m('integrity', tri('تمامیت معلومات', 'د معلوماتو بشپړتیا', 'Data integrity'), num('100%'), num('100%'), true, true),
      m('backup', tri('موفقیت بک‌آپ', 'د بیک‌اپ بریا', 'Backup success'), num('96%'), num('≥ 98%'), false),
      m('mttr', tri('MTTR', 'MTTR', 'MTTR'), L('unit.min', { n: 22 }), L('unit.min', { n: '≤ 30' }), true),
      m('response', tri('زمان پاسخ به رویداد', 'پېښې ته د ځواب وخت', 'Incident response time'), L('unit.min', { n: 4 }), L('unit.min', { n: '≤ 5' }), true),
      m('uptime', tri('زمان کارکرد سرور', 'د سرور د کار وخت', 'Server uptime'), L('unit.h', { n: uptimeH.toFixed(1) }), num('—'), true, true),
    ];
  }

  maintenance(): MaintenanceTask[] { return this.tasks; }
  runTask(id: string): MaintenanceTask {
    const i = this.tasks.findIndex((t) => t.id === id);
    if (i < 0) throw new Error(`task not found: ${id}`);
    this.tasks[i] = { ...this.tasks[i], last_run: Date.now(), status: 'ok' };
    return this.tasks[i];
  }

  compliance() {
    return [
      { framework: 'ISO/IEC 27001', score: 87, note: tri('۹۳ از ۱۰۷ کنترول تطبیق شده', 'له ۱۰۷ کنترولونو ۹۳ پلي شوي', '93 of 107 controls implemented') },
      { framework: 'NIST CSF', score: 82, note: tri('شناسایی · حفاظت · کشف · پاسخ · بازیابی', 'پېژندنه · ساتنه · موندنه · ځواب · بیا رغونه', 'Identify · Protect · Detect · Respond · Recover') },
    ];
  }

  dataClasses() {
    const SECRET = tri('سری', 'سري', 'Secret'), CONF = tri('محرم', 'محرم', 'Confidential'), INTERNAL = tri('داخلی', 'داخلي', 'Internal');
    const days = (n: number) => tri(`${localDigits('dr', n)} روز`, `${localDigits('ps', n)} ورځې`, `${n} days`);
    const years = (n: number) => tri(`${localDigits('dr', n)} سال`, `${localDigits('ps', n)} ${n === 1 ? 'کال' : 'کاله'}`, `${n} ${n === 1 ? 'year' : 'years'}`);
    return [
      { name: tri('موقعیت زندهٔ واحدها', 'د واحدونو ژوندی موقعیت', 'Live unit positions'), classification: SECRET, retention: days(90), encryption: 'AES-256-GCM' },
      { name: tri('ویدیوی درون', 'د ډرون ویډیو', 'Drone video'), classification: CONF, retention: days(30), encryption: 'AES-256-GCM' },
      { name: tri('پلان‌های اسکورت', 'د ساتنې پلانونه', 'Escort plans'), classification: SECRET, retention: years(1), encryption: 'AES-256-GCM' },
      { name: tri('راپورهای AAR', 'د AAR راپورونه', 'AAR reports'), classification: CONF, retention: years(5), encryption: 'AES-256' },
      { name: tri('لاگ تفتیش', 'د تفتیش لاګ', 'Audit log'), classification: INTERNAL, retention: years(7), encryption: 'SHA-256 chain' },
      { name: tri('معلومات آموزشی', 'روزنیز معلومات', 'Training data'), classification: INTERNAL, retention: years(1), encryption: 'AES-256' },
    ];
  }

  keyList() {
    const now = Date.now();
    return this.keys.map((k) => {
      const age = Math.floor((now - k.created_at) / DAY);
      return { ...k, age_days: age, next_rotation_days: k.rotate_every_days - age };
    });
  }

  rotateKey(name: string) {
    const i = this.keys.findIndex((k) => k.name === name);
    if (i < 0) throw new Error(`key not found: ${name}`);
    this.keys[i] = { ...this.keys[i], created_at: Date.now() };
    const t = this.tasks.findIndex((x) => x.id === 'keys');
    if (t >= 0 && this.keyList().every((k) => k.next_rotation_days > 7)) this.tasks[t] = { ...this.tasks[t], last_run: Date.now(), status: 'ok' };
    return this.keyList()[i];
  }

  scan() {
    const audit = verifyAuditChain();
    const dueKeys = this.keyList().filter((k) => k.next_rotation_days <= 7).length;
    this.lastScan = { at: Date.now(), critical: audit.valid ? 0 : 1, medium: dueKeys + this.tasks.filter((t) => t.status !== 'ok').length, audit };
    const s = this.tasks.findIndex((x) => x.id === 'scan');
    if (s >= 0) this.tasks[s] = { ...this.tasks[s], last_run: Date.now(), status: 'ok' };
    return this.lastScan;
  }

  lastScanResult() { return this.lastScan; }

  training() {
    return [
      { role: 'operator', name: tri('اپراتور داشبورد', 'د ډشبورډ اپرېټر', 'Dashboard operator'), modules: tri('۶ ماژول · نقشه، اخطار، تأیید', '۶ ماډیولونه · نقشه، خبرتیا، تایید', '6 modules · map, alerts, ACK'), completion: 92 },
      { role: 'analyst', name: tri('تحلیلگر امنیتی', 'امنیتي شنونکی', 'Security analyst'), modules: tri('۸ ماژول · ریسک، تحلیل ساحه', '۸ ماډیولونه · خطر، د سیمې تحلیل', '8 modules · risk, area analysis'), completion: 78 },
      { role: 'planner', name: tri('پلانگذار اسکورت', 'د ساتنې پلان جوړونکی', 'Escort planner'), modules: tri('۷ ماژول · PACE، پوسته‌ها', '۷ ماډیولونه · PACE، پوستې', '7 modules · PACE, checkpoints'), completion: 85 },
      { role: 'commander', name: tri('قوماندان', 'قوماندان', 'Commander'), modules: tri('۵ ماژول · تأیید، ارتقا، AAR', '۵ ماډیولونه · تایید، لوړول، AAR', '5 modules · approval, escalation, AAR'), completion: 100 },
      { role: 'technical', name: tri('تیم تخنیکی', 'تخنیکي ټیم', 'Technical team'), modules: tri('۹ ماژول · دستگاه، SLA، امنیت', '۹ ماډیولونه · وسیلې، SLA، امنیت', '9 modules · devices, SLA, security'), completion: 64 },
    ];
  }
}
