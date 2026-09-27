import { useState } from 'react';
import { useOps } from '../../stores/ops';
import { useSession } from '../../stores/session';
import { useNow, useT } from '../../app/hooks';
import { clock, fg } from '../../lib/format';
import { registerDevice, sendCommand } from '../../app/actions';
import type { Device, DeviceType } from '../../api/types';
import { can } from '../../app/roles';

const ICON: Record<DeviceType, string> = { drone: 'drone', gps: 'navigation-arrow', iot: 'broadcast', camera: 'security-camera', ble: 'bluetooth' };
const STATE_HUE: Record<Device['state'], number> = { on: 150, idle: 250, warn: 90, off: 25 };
const TYPES: DeviceType[] = ['drone', 'gps', 'iot', 'camera', 'ble'];

export function AssetsList({ showApi }: { showApi: boolean }) {
  const { t, N } = useT();
  const s = useOps();
  const role = useSession((x) => x.role);
  const [reg, setReg] = useState<null | { id: string; name: string; type: DeviceType; protocol: string }>(null);
  const list = s.devices.filter((d) => s.devFilter === 'all' || d.type === s.devFilter);
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 500, fontSize: 14 }}>{t('dv.title', { n: N(s.devices.length) })}</span>
        {can(role, 'write:devices') && <button className="btn-accent-outline" onClick={() => setReg(reg ? null : { id: '', name: '', type: 'iot', protocol: 'MQTT' })}><i className="ph ph-plus" />{t('dv.register')}</button>}
      </div>
      {reg && (
        <form onSubmit={(e) => { e.preventDefault(); registerDevice(reg); setReg(null); }} style={{ borderRadius: 12, padding: 12, background: 'var(--color-bg)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontWeight: 500 }}>{t('dv.registerTitle')}</span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label className="field-label">{t('dv.id')}<input required className="field-input mono ltr" style={{ background: 'var(--color-surface)' }} value={reg.id} onChange={(e) => setReg({ ...reg, id: e.target.value.toUpperCase() })} /></label>
            <label className="field-label">{t('dv.type')}<select className="field-input" style={{ background: 'var(--color-surface)' }} value={reg.type} onChange={(e) => setReg({ ...reg, type: e.target.value as DeviceType })}>{TYPES.map((x) => <option key={x} value={x}>{t(`dv.type.${x}`)}</option>)}</select></label>
          </div>
          <label className="field-label">{t('dv.name')}<input required className="field-input" style={{ background: 'var(--color-surface)' }} value={reg.name} onChange={(e) => setReg({ ...reg, name: e.target.value })} /></label>
          <label className="field-label">{t('dv.protocol')}<input required className="field-input ltr" style={{ background: 'var(--color-surface)' }} value={reg.protocol} onChange={(e) => setReg({ ...reg, protocol: e.target.value })} /></label>
          <div style={{ display: 'flex', gap: 6 }}><button type="submit" className="btn-primary-fill" style={{ flex: 1 }}>{t('dv.register')}</button><button type="button" className="btn-outline" onClick={() => setReg(null)}>{t('dv.cancel')}</button></div>
        </form>
      )}
      {showApi && <span className="api-hint">GET /api/communication/devices · WS env/devices</span>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {(['all', ...TYPES] as const).map((k) => (
          <button key={k} aria-pressed={s.devFilter === k} onClick={() => s.set({ devFilter: k })} style={{ padding: '4px 10px', borderRadius: 6, background: s.devFilter === k ? 'var(--color-accent-800)' : 'var(--color-neutral-800)', color: s.devFilter === k ? 'var(--color-accent-100)' : 'var(--color-neutral-300)' }}>{t(`dv.f.${k}`)}</button>
        ))}
      </div>
      {list.map((d) => (
        <button key={d.id} className="hov-accent" onClick={() => s.set({ devSel: d.id, sheet: 'insp' })}
          style={{ textAlign: 'start', padding: '9px 10px', borderRadius: 8, background: d.id === s.devSel ? 'var(--color-accent-900)' : 'transparent', display: 'flex', gap: 10, alignItems: 'center' }}>
          <i className={`ph ph-${ICON[d.type]}`} style={{ fontSize: 18, color: 'var(--color-neutral-400)' }} />
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}><span style={{ fontWeight: 500 }}>{d.name}</span><span style={{ fontSize: 11, color: 'var(--color-neutral-400)' }}>{d.protocol} · {d.detail}</span></span>
          <span style={{ fontSize: 11, color: fg(STATE_HUE[d.state]), whiteSpace: 'nowrap' }}>{t(`dv.state.${d.state}`)}</span>
        </button>
      ))}
    </>
  );
}

export function AssetsInspector({ showApi }: { showApi: boolean }) {
  const { t, N } = useT();
  const now = useNow(5000);
  const s = useOps();
  const role = useSession((x) => x.role);
  const d = s.devices.find((x) => x.id === s.devSel) ?? s.devices[0];
  if (!d) return <span className="muted">{t('loading')}</span>;
  const ago = Math.max(0, now - d.last_seen);
  const seen = ago < 60_000 ? t('dv.now') : ago < 3600_000 ? t('dv.agoMin', { n: N(Math.round(ago / 60_000)) }) : t('dv.agoH', { n: N(Math.round(ago / 3600_000)) });
  const metrics: Array<[string, string, string?]> = [
    [t('dv.id'), d.id], [t('dv.protocol'), d.protocol], [t('dv.battery'), d.battery_pct == null ? '—' : `${N(Math.round(d.battery_pct))}٪`, d.battery_pct != null && d.battery_pct < 15 ? fg(25) : undefined],
    [t('dv.lastSignal'), seen, d.state === 'off' ? fg(25) : undefined], [t('dv.firmware'), d.firmware], [t('dv.signal'), d.signal_dbm == null ? '—' : `${N(d.signal_dbm)} dBm`],
  ];
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}><span className="caption">{t(`dv.type.${d.type}`)}</span><span style={{ fontSize: 17, fontWeight: 500 }}>{d.name}</span></div>
        <span style={{ fontSize: 11, color: fg(STATE_HUE[d.state]) }}>{t(`dv.state.${d.state}`)}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {metrics.map(([l, v, c]) => <div key={l} className="tile"><div className="caption">{l}</div><div style={{ fontSize: 14, fontWeight: 500, color: c ?? 'inherit' }}>{v}</div></div>)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="caption">{t('dv.cmd')}</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {d.commands.map((c) => <button key={c} className="btn-outline" disabled={d.state === 'off' || !can(role, 'command:devices')} onClick={() => sendCommand(d, c)} style={{ padding: '7px 12px', borderRadius: 8 }}>{c}</button>)}
        </div>
        {showApi && <span className="api-hint" style={{ textAlign: 'start' }}>POST /api/communication/command/{d.id}</span>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="caption">{t('dv.history')}</span>
        {d.history.map((e, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '52px 1fr', gap: 8, fontSize: 12 }}><span className="mono ltr" style={{ color: 'var(--color-neutral-500)', textAlign: 'start' }}>{clock(e.at)}</span><span>{e.message}</span></div>
        ))}
      </div>
    </>
  );
}
