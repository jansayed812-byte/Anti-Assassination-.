/**
 * Initial operating picture for a fresh server start (units, plans, devices, incidents, alerts).
 */
import { toLatLon } from './geo';
import type { UnitMeta } from './domain/units';
import type { EscortPlan } from './domain/plans';
import type { Device } from './domain/devices';
import type { Detection } from './domain/detections';
import type { NewAlert } from './domain/alerts';
import type { RiskModel } from './domain/risk';

export const UNITS: UnitMeta[] = [
  { id: 'alpha', name: 'اسکورت آلفا', icon: 'car-profile', group: 'mission', sub: 'ESC-0412 · GNSS+Wi-Fi+BLE', mission: 'ESC-0412', sources: ['gnss', 'wifi', 'ble'], comms: 'ok' },
  { id: 'drone', name: 'پهپاد D-01', icon: 'drone', group: 'mission', sub: 'پوشش هوایی · 4K', mission: 'ESC-0412', sources: ['gnss'], comms: 'ok' },
  { id: 'bravo', name: 'تیم براوو', icon: 'users-three', group: 'standby', sub: 'ثابت · GNSS+BLE', mission: null, sources: ['gnss', 'ble'], comms: 'ok' },
  { id: 'charlie', name: 'تیم چارلی', icon: 'users-three', group: 'standby', sub: 'فقط سلولی · ارتباط قطع', mission: null, sources: ['cellular'], comms: 'lost' },
];

export const PLANS: EscortPlan[] = [
  { id: 'ESC-0412', title: 'پایگاه شمالی ← مجموعهٔ جنوبی', status: 'running', vip_level: 3, priority: 'security', origin: 'پایگاه شمالی · 35.742, 51.301', destination: 'مجموعهٔ جنوبی · 35.612, 51.468', start: '۱۴:۰۵', vehicles: 4, active_route: 'P', resources: ['۲ خودروی زرهی', 'تیم پشتیبان براوو', 'پهپاد D-01', 'MF-001 روی مسیر'], approved_by: 'ahmadi' },
  { id: 'ESC-0415', title: 'فرودگاه ← ساختمان مرکزی', status: 'pending_approval', vip_level: 4, priority: 'security', origin: 'فرودگاه · 35.689, 51.313', destination: 'ساختمان مرکزی · 35.700, 51.420', start: 'فردا ۰۸:۳۰', vehicles: 4, active_route: 'A', resources: ['۳ خودروی زرهی', 'تیم پشتیبان براوو', 'پهپاد D-02'], submitted_by: 'ali' },
  { id: 'ESC-0409', title: 'مجموعهٔ جنوبی ← پایگاه شمالی', status: 'closed', vip_level: 3, priority: 'balanced', origin: 'مجموعهٔ جنوبی', destination: 'پایگاه شمالی', start: 'دیروز', vehicles: 3, active_route: 'P', resources: ['۲ خودروی زرهی', 'پهپاد D-01'], approved_by: 'ahmadi' },
];

export const RESOURCES = [
  { id: 'SH-001', icon: 'house-line', name: 'خانهٔ امن SH-001', ...toLatLon([-70, 15]) },
  { id: 'MF-001', icon: 'first-aid', name: 'مرکز درمانی MF-001', ...toLatLon([20, -30]) },
  { id: 'PS-004', icon: 'shield', name: 'پاسگاه انتظامی', ...toLatLon([-30, 55]) },
];

export function seedIncidents(risk: RiskModel): void {
  const add = (type: string, severity: 'low' | 'medium' | 'high' | 'critical', xz: [number, number], radius_m: number, confidence: number, evidence: string[]) =>
    risk.add({ type, severity, location: toLatLon(xz), radius_m, confidence, evidence, source: 'seed', human_validation_status: 'confirmed' });
  add('armed_threat', 'critical', [-5, -5], 450, 0.92, ['D-01', 'yolov8']);
  add('suspicious_vehicle', 'high', [-18, 8], 320, 0.74, ['CAM-03']);
  add('unusual_gathering', 'medium', [8, -16], 360, 0.61, ['D-01']);
  add('roadside_object', 'medium', [-26, -22], 260, 0.7, ['field_report']);
}

export const DETECTIONS = (): Detection[] => {
  const d = (id: string, label: string, source: string, confidence: number, minsAgo: number, xz: [number, number], severity: Detection['severity'], radius_m: number): Detection =>
    ({ id, label, source, confidence, observed_at: new Date(Date.now() - minsAgo * 60_000).toISOString(), ...toLatLon(xz), severity, radius_m, status: 'pending' });
  return [
    d('t1', 'افراد مسلح ×۳', 'D-01', 0.89, 3, [-2, 12], 'critical', 300),
    d('t2', 'خودروی مشکوک', 'CAM-03', 0.74, 14, [30, -20], 'high', 250),
    d('t3', 'تجمع غیرعادی', 'D-01', 0.61, 37, [-40, 30], 'medium', 300),
  ];
};

export const DEVICES = (): Device[] => {
  const now = Date.now();
  const dv = (id: string, name: string, type: Device['type'], protocol: string, detail: string, state: Device['state'], battery: number | null, signal: number | null, seenAgoMs = 0): Device =>
    ({ id, name, type, protocol, detail, state, battery_pct: battery, firmware: 'v2.4.1', signal_dbm: signal, last_seen: now - seenAgoMs, history: [{ at: now - 90 * 60_000, message: 'به‌روزرسانی firmware' }, { at: now - 5 * 3600_000, message: 'کالیبراسیون موفق' }] });
  return [
    dv('D-01', 'پهپاد D-01', 'drone', 'MAVLink', 'باتری ۶۴٪ · 4K', 'on', 64, -58),
    dv('D-02', 'پهپاد D-02', 'drone', 'MAVLink', 'در شارژ', 'idle', 97, -60),
    dv('GPS-07', 'رسیور GPS-07', 'gps', 'NMEA', 'HDOP ۳٫۲', 'warn', null, -71),
    dv('GPS-02', 'رسیور GPS-02', 'gps', 'NMEA', 'HDOP ۰٫۹', 'on', null, -55),
    dv('IOT-12', 'ردیاب IoT-12', 'iot', 'MQTT', 'آخرین سیگنال ۲ ساعت پیش', 'off', 3, null, 2 * 3600_000),
    dv('IOT-04', 'ردیاب IoT-04', 'iot', 'MQTT', 'باتری ۸۱٪', 'on', 81, -66),
    dv('CAM-03', 'دوربین CAM-03', 'camera', 'HTTP', '1080p', 'on', null, -49),
    dv('BLE-03', 'بیکن BLE-03', 'ble', 'BLE', 'RSSI −62', 'on', 77, -62),
  ];
};

export const ALERTS: NewAlert[] = [
  { level: 'critical', title: 'حرکت غیرمجاز در منطقهٔ ممنوعه', src: 'پهپاد D-01 · YOLOv8 ۹۲٪ · ۳۰۰ متری آلفا', unit: 'alpha', ackInSeconds: 42 },
  { level: 'error', title: 'قطع ارتباط تیم چارلی', src: 'آخرین سیگنال ۳ دقیقه پیش · ردیابی سلولی', unit: 'charlie', ackInSeconds: 170 },
  { level: 'warning', title: 'HDOP بالا در رسیور GPS-07', src: 'دقت موقعیت کاهش یافته · CEP95 ۹٫۸m', unit: null, ackInSeconds: 540 },
  { level: 'info', title: 'به‌روزرسانی شبکهٔ ریسک منطقهٔ ۴', src: 'risk stream · ۱۲۷ سلول', unit: null, status: 'acknowledged' },
];
