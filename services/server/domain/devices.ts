/**
 * Field device registry: drones, GNSS receivers, IoT trackers, cameras and BLE beacons,
 * with per-type command sets and a per-device history.
 */
import { EventEmitter } from 'events';

export type DeviceType = 'drone' | 'gps' | 'iot' | 'camera' | 'ble';
export type DeviceState = 'on' | 'idle' | 'warn' | 'off';

export interface Device {
  id: string; name: string; type: DeviceType; protocol: string; detail: string; state: DeviceState;
  battery_pct: number | null; firmware: string; signal_dbm: number | null; last_seen: number;
  history: Array<{ at: number; message: string }>;
}

export const COMMANDS: Record<DeviceType, string[]> = {
  drone: ['بازگشت به خانه', 'پرواز به مختصات', 'تغییر کیفیت ویدئو', 'درخواست تماس'],
  camera: ['ضبط کلیپ', 'تغییر کیفیت', 'ریستارت'],
  gps: ['تغییر نرخ ارسال', 'کالیبراسیون', 'ریستارت', 'درخواست تماس'],
  iot: ['تغییر نرخ ارسال', 'کالیبراسیون', 'ریستارت', 'درخواست تماس'],
  ble: ['تغییر نرخ ارسال', 'کالیبراسیون', 'ریستارت'],
};

export type DeviceView = Device & { commands: string[] };
const view = (d: Device): DeviceView => ({ ...d, commands: COMMANDS[d.type] });

export class DeviceError extends Error {}

export class DeviceRegistry extends EventEmitter {
  private devices = new Map<string, Device>();

  constructor(seed: Device[]) { super(); for (const d of seed) this.devices.set(d.id, d); }

  list(type?: DeviceType): DeviceView[] { return [...this.devices.values()].filter((d) => !type || d.type === type).map(view); }
  get(id: string): DeviceView | undefined { const d = this.devices.get(id); return d && view(d); }

  register(input: { id: string; name: string; type: DeviceType; protocol: string }): DeviceView {
    if (!input.id || !input.name || !(input.type in COMMANDS)) throw new DeviceError('id, name and a valid type are required');
    if (this.devices.has(input.id)) throw new DeviceError(`device ${input.id} already registered`);
    const d: Device = { ...input, detail: `${input.protocol} · ثبت جدید`, state: 'idle', battery_pct: null, firmware: 'v2.4.1', signal_dbm: null, last_seen: Date.now(), history: [{ at: Date.now(), message: 'ثبت دستگاه' }] };
    this.devices.set(d.id, d);
    this.emit('changed', view(d));
    return view(d);
  }

  command(id: string, command: string, by: string): { device: DeviceView; command_id: string } {
    const d = this.devices.get(id);
    if (!d) throw new DeviceError(`device not found: ${id}`);
    if (!COMMANDS[d.type].includes(command)) throw new DeviceError(`command not supported for ${d.type}: ${command}`);
    if (d.state === 'off') throw new DeviceError(`${d.name} آفلاین است و فرمان را دریافت نمی‌کند`);
    const command_id = `CMD-${Date.now().toString(36)}`;
    const next: Device = { ...d, history: [{ at: Date.now(), message: `فرمان «${command}» توسط ${by}` }, ...d.history].slice(0, 20) };
    if (d.type === 'drone' && command === 'بازگشت به خانه') { next.state = 'idle'; next.detail = `${d.protocol} · در حال بازگشت`; }
    this.devices.set(id, next);
    this.emit('changed', view(next));
    return { device: view(next), command_id };
  }

  /** Mark a device as heard from (called by the ingest endpoints). */
  touch(id: string, message?: string): void {
    const d = this.devices.get(id);
    if (!d) return;
    const next: Device = { ...d, last_seen: Date.now(), state: d.state === 'off' ? 'on' : d.state, history: message ? [{ at: Date.now(), message }, ...d.history].slice(0, 20) : d.history };
    this.devices.set(id, next);
    this.emit('changed', view(next));
  }

  drainBattery(id: string, pct: number): void {
    const d = this.devices.get(id);
    if (!d || d.battery_pct == null) return;
    this.devices.set(id, { ...d, battery_pct: Math.max(0, +(d.battery_pct - pct).toFixed(2)), last_seen: Date.now() });
  }
}
