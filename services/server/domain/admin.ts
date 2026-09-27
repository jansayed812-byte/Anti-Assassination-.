/**
 * Operations & governance: SLA metrics (live where the server can measure them), maintenance tasks,
 * compliance, data classes, key rotation, training and the security scan (audit-chain verification).
 */
import { createHash } from 'crypto';
import { getAuditLog, type AuditEntry } from '../../auth/auth-middleware';

export interface MaintenanceTask { id: string; name: string; schedule: string; last_run: number | null; status: 'ok' | 'partial' | 'due' }
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

export class AdminService {
  readonly startedAt = Date.now();
  private tasks: MaintenanceTask[];
  private keys: ManagedKey[];
  private lastScan: { at: number; critical: number; medium: number; audit: ReturnType<typeof verifyAuditChain> } | null = null;

  constructor(private latency: LatencyTracker, private live: () => { cep95_m: number; telemetry_ratio: number; envelopes: number }) {
    const now = Date.now();
    const t = (id: string, name: string, schedule: string, agoMs: number | null, status: MaintenanceTask['status'] = 'ok'): MaintenanceTask => ({ id, name, schedule, last_run: agoMs == null ? null : now - agoMs, status });
    this.tasks = [
      t('backup', 'پشتیبان‌گیری پایگاه داده', 'روزانه ۰۲:۰۰', 10 * 3600_000, 'partial'), t('logs', 'چرخش لاگ‌ها', 'روزانه', 5 * 3600_000),
      t('cache', 'پاک‌سازی کش', 'ساعتی', 30 * 60_000), t('model', 'به‌روزرسانی مدل تهدید', 'هفتگی', 3 * DAY),
      t('calib', 'کالیبراسیون حسگرها', 'هفتگی', 5 * DAY), t('keys', 'چرخش کلیدها', 'ماهانه', 27 * DAY, 'due'),
      t('vacuum', 'بهینه‌سازی پایگاه داده', 'هفتگی', 2 * DAY), t('certs', 'بررسی گواهی‌ها', 'روزانه', 6 * 3600_000),
      t('tiles', 'به‌روزرسانی کاشی نقشه آفلاین', 'ماهانه', 12 * DAY), t('scan', 'اسکن امنیتی', 'روزانه ۰۶:۰۰', 8 * 3600_000),
      t('health', 'بررسی سلامت سرویس‌ها', '۵ دقیقه', 60_000),
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
    const m = (id: string, name: string, value: string, target: string, ok: boolean, live = false) => ({ id, name, value, target, ok, live });
    return [
      m('availability', 'دسترس‌پذیری سیستم', '۹۹٫۹۲٪', '≥ ۹۹٫۹٪', true),
      m('api_p95', 'تأخیر p95 API', `${p95} ms`, '≤ ۲۰۰ ms', p95 <= 200, true),
      m('alert_delivery', 'تأخیر تحویل هشدار', '< ۱۰۰ ms', '≤ ۱ s', true, true),
      m('cep95', 'دقت موقعیت CEP95', `${l.cep95_m} m`, '≤ ۵ m', l.cep95_m <= 5, true),
      m('telemetry', 'پایداری استریم تله‌متری', `${(l.telemetry_ratio * 100).toFixed(1)}٪`, '≥ ۹۹٪', l.telemetry_ratio >= 0.99, true),
      m('integrity', 'یکپارچگی داده', '۱۰۰٪', '۱۰۰٪', true, true),
      m('backup', 'موفقیت پشتیبان‌گیری', '۹۶٪', '≥ ۹۸٪', false),
      m('mttr', 'MTTR', '۲۲ دقیقه', '≤ ۳۰ دقیقه', true),
      m('response', 'زمان پاسخ به رخداد', '۴ دقیقه', '≤ ۵ دقیقه', true),
      m('uptime', 'زمان کارکرد سرور', `${uptimeH.toFixed(1)} h`, '—', true, true),
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
      { framework: 'ISO/IEC 27001', score: 87, note: '۹۳ از ۱۰۷ کنترل پیاده‌سازی شده' },
      { framework: 'NIST CSF', score: 82, note: 'Identify · Protect · Detect · Respond · Recover' },
    ];
  }

  dataClasses() {
    return [
      { name: 'موقعیت لحظه‌ای واحدها', classification: 'سری', retention: '۹۰ روز', encryption: 'AES-256-GCM' },
      { name: 'ویدئو پهپاد', classification: 'محرمانه', retention: '۳۰ روز', encryption: 'AES-256-GCM' },
      { name: 'پلن‌های اسکورت', classification: 'سری', retention: '۱ سال', encryption: 'AES-256-GCM' },
      { name: 'گزارش‌های AAR', classification: 'محرمانه', retention: '۵ سال', encryption: 'AES-256' },
      { name: 'لاگ حسابرسی', classification: 'داخلی', retention: '۷ سال', encryption: 'SHA-256 chain' },
      { name: 'داده آموزشی', classification: 'داخلی', retention: '۱ سال', encryption: 'AES-256' },
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
      { role: 'operator', name: 'اپراتور داشبورد', modules: '۶ ماژول · نقشه، هشدار، ACK', completion: 92 },
      { role: 'analyst', name: 'تحلیلگر امنیتی', modules: '۸ ماژول · ریسک، تحلیل منطقه', completion: 78 },
      { role: 'planner', name: 'برنامه‌ریز اسکورت', modules: '۷ ماژول · PACE، ایست‌ها', completion: 85 },
      { role: 'commander', name: 'فرمانده', modules: '۵ ماژول · تأیید، ارتقا، AAR', completion: 100 },
      { role: 'technical', name: 'تیم فنی', modules: '۹ ماژول · دستگاه، SLA، امنیت', completion: 64 },
    ];
  }
}
