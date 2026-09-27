/**
 * Field device registry: drones, relays, GNSS receivers, IoT trackers, cameras and BLE beacons, with
 * positions and coverage specs (used by the blind-spot analysis), per-type command sets and a history.
 */
import { EventEmitter } from 'events';
import type { LatLon } from '../geo';
import { L, type MsgKey } from '../i18n/messages';
import type { LText, Tri } from '../i18n/types';

export type DeviceType = 'drone' | 'relay' | 'gps' | 'iot' | 'camera' | 'ble';
export type DeviceState = 'on' | 'idle' | 'warn' | 'off';

export type Coverage =
  | { kind: 'camera'; heading_deg: number; fov_deg: number; range_m: number }
  | { kind: 'radio'; tx_dbm: number; gain_db: number }
  | { kind: 'drone'; footprint_m: number };

export interface Device {
  id: string; name: Tri; type: DeviceType; protocol: string; detail: LText; state: DeviceState;
  battery_pct: number | null; firmware: string; signal_dbm: number | null; last_seen: number;
  geo: LatLon | null; coverage: Coverage | null;
  history: Array<{ at: number; message: LText }>;
}

export const COMMANDS: Record<DeviceType, MsgKey[]> = {
  drone: ['dev.cmd.rth', 'dev.cmd.goto', 'dev.cmd.quality', 'dev.cmd.call'],
  relay: ['dev.cmd.power', 'dev.cmd.restart'],
  camera: ['dev.cmd.record', 'dev.cmd.quality', 'dev.cmd.restart'],
  gps: ['dev.cmd.rate', 'dev.cmd.calibrate', 'dev.cmd.restart', 'dev.cmd.call'],
  iot: ['dev.cmd.rate', 'dev.cmd.calibrate', 'dev.cmd.restart', 'dev.cmd.call'],
  ble: ['dev.cmd.rate', 'dev.cmd.calibrate', 'dev.cmd.restart'],
};

export type DeviceView = Device & { commands: Array<{ id: MsgKey; label: Tri }> };
const view = (d: Device): DeviceView => ({ ...d, commands: COMMANDS[d.type].map((id) => ({ id, label: L(id) })) });

export class DeviceError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export class DeviceRegistry extends EventEmitter {
  private devices = new Map<string, Device>();

  constructor(seed: Device[]) { super(); for (const d of seed) this.devices.set(d.id, d); }

  list(type?: DeviceType): DeviceView[] { return [...this.devices.values()].filter((d) => !type || d.type === type).map(view); }
  raw(): Device[] { return [...this.devices.values()]; }
  get(id: string): DeviceView | undefined { const d = this.devices.get(id); return d && view(d); }

  register(input: { id: string; name: string; type: DeviceType; protocol: string; geo?: LatLon }): DeviceView {
    if (!input.id || !input.name || !(input.type in COMMANDS)) throw new DeviceError('invalid_device', 'id, name and a valid type are required');
    if (this.devices.has(input.id)) throw new DeviceError('device_exists', `device ${input.id} already registered`);
    const now = Date.now();
    const d: Device = {
      id: input.id, name: { dr: input.name, ps: input.name, en: input.name }, type: input.type, protocol: input.protocol, detail: input.protocol,
      state: 'idle', battery_pct: null, firmware: 'v2.4.1', signal_dbm: null, last_seen: now, geo: input.geo ?? null, coverage: null,
      history: [{ at: now, message: L('dev.log.registered') }],
    };
    this.devices.set(d.id, d);
    this.emit('changed', view(d), null);
    return view(d);
  }

  command(id: string, command: string, by: string): { device: DeviceView; command_id: string } {
    const d = this.devices.get(id);
    if (!d) throw new DeviceError('device_not_found', `device not found: ${id}`);
    if (!(COMMANDS[d.type] as string[]).includes(command)) throw new DeviceError('command_unsupported', `command not supported for ${d.type}: ${command}`);
    if (d.state === 'off' && command !== 'dev.cmd.power') throw new DeviceError('device_offline', `${d.name.en} is offline and cannot receive commands`);
    const key = command as MsgKey;
    const next: Device = { ...d, history: [{ at: Date.now(), message: L('dev.log.cmd', { cmd: L(key), by }) }, ...d.history].slice(0, 20) };
    if (d.type === 'drone' && key === 'dev.cmd.rth') next.state = 'idle';
    if (key === 'dev.cmd.power') {
      next.state = d.state === 'off' ? 'on' : 'off';
      next.history = [{ at: Date.now(), message: L('dev.log.state', { state: L(next.state === 'off' ? 'dev.state.off' : 'dev.state.on') }) }, ...next.history].slice(0, 20);
    }
    return this.put(next, d, `CMD-${Date.now().toString(36)}`);
  }

  setState(id: string, state: DeviceState): DeviceView {
    const d = this.devices.get(id);
    if (!d) throw new DeviceError('device_not_found', `device not found: ${id}`);
    return this.put({ ...d, state, history: [{ at: Date.now(), message: L('dev.log.state', { state: L(state === 'off' ? 'dev.state.off' : 'dev.state.on') }) }, ...d.history].slice(0, 20) }, d).device;
  }

  /** Mark a device as heard from (called by the ingest endpoints). */
  touch(id: string, geo?: LatLon): void {
    const d = this.devices.get(id);
    if (!d) return;
    const pos = geo ? `${geo.lat.toFixed(5)}, ${geo.lon.toFixed(5)}` : '';
    this.put({ ...d, last_seen: Date.now(), geo: geo ?? d.geo, state: d.state === 'off' ? 'on' : d.state, history: geo ? [{ at: Date.now(), message: L('dev.log.position', { pos }) }, ...d.history].slice(0, 20) : d.history }, d);
  }

  moveTo(id: string, geo: LatLon): void {
    const d = this.devices.get(id);
    if (d) this.devices.set(id, { ...d, geo, last_seen: Date.now() });
  }

  drainBattery(id: string, pct: number): void {
    const d = this.devices.get(id);
    if (!d || d.battery_pct == null) return;
    this.devices.set(id, { ...d, battery_pct: Math.max(0, +(d.battery_pct - pct).toFixed(2)), last_seen: Date.now() });
  }

  private put(next: Device, prev: Device, command_id = ''): { device: DeviceView; command_id: string } {
    this.devices.set(next.id, next);
    this.emit('changed', view(next), prev);
    return { device: view(next), command_id };
  }
}
