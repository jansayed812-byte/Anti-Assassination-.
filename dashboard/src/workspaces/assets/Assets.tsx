import { useState } from 'react';
import { useOps } from '../../stores/ops';
import { useSession } from '../../stores/session';
import { useNow, useT } from '../../app/hooks';
import { registerDevice, sendCommand } from '../../app/actions';
import type { Device, DeviceType } from '../../api/types';
import { can } from '../../app/roles';
import { relayReachM } from '../../map/geo';

const ICON: Record<DeviceType, string> = { drone: 'drone', relay: 'broadcast', gps: 'navigation-arrow', iot: 'cpu', camera: 'security-camera', ble: 'bluetooth' };
const STATE_CHIP: Record<Device['state'], string> = { on: 'chip-success', idle: 'chip-info', warn: 'chip-warning', off: 'chip-danger' };
const TYPES: DeviceType[] = ['drone', 'relay', 'camera', 'gps', 'iot', 'ble'];

export function AssetsList({ showApi }: { showApi: boolean }) {
  const { t, x, N } = useT();
  const s = useOps();
  const role = useSession((st) => st.role);
  const [reg, setReg] = useState<null | { id: string; name: string; type: DeviceType; protocol: string }>(null);
  const list = s.devices.filter((d) => s.devFilter === 'all' || d.type === s.devFilter);
  return (
    <>
      <div className="row-between">
        <h3>{t('dv.title', { n: s.devices.length })}</h3>
        {can(role, 'write:devices') && <button className="btn btn-outline btn-sm" onClick={() => setReg(reg ? null : { id: '', name: '', type: 'iot', protocol: 'MQTT' })}><i className="ph ph-plus" />{t('dv.register')}</button>}
      </div>
      {reg && (
        <form className="card-2" onSubmit={(e) => { e.preventDefault(); registerDevice(reg); setReg(null); }}>
          <b>{t('dv.registerTitle')}</b>
          <div className="grid-2">
            <label className="field">{t('dv.id')}<input required className="input mono ltr" value={reg.id} onChange={(e) => setReg({ ...reg, id: e.target.value.toUpperCase() })} /></label>
            <label className="field">{t('dv.type')}<select className="select" value={reg.type} onChange={(e) => setReg({ ...reg, type: e.target.value as DeviceType })}>{TYPES.map((k) => <option key={k} value={k}>{t(`dv.type.${k}`)}</option>)}</select></label>
          </div>
          <label className="field">{t('dv.name')}<input required className="input" value={reg.name} onChange={(e) => setReg({ ...reg, name: e.target.value })} /></label>
          <label className="field">{t('dv.protocol')}<input required className="input ltr" value={reg.protocol} onChange={(e) => setReg({ ...reg, protocol: e.target.value })} /></label>
          <div className="row" style={{ gap: 6 }}><button type="submit" className="btn btn-primary" style={{ flex: 1 }}>{t('dv.register')}</button><button type="button" className="btn" onClick={() => setReg(null)}>{t('cancel')}</button></div>
        </form>
      )}
      {showApi && <span className="api-hint">GET /api/communication/devices · WS env/devices</span>}
      <div className="row wrap" style={{ gap: 6 }}>
        {(['all', ...TYPES] as const).map((k) => (
          <button key={k} className={`btn btn-sm ${s.devFilter === k ? 'on' : ''}`} aria-pressed={s.devFilter === k} onClick={() => s.set({ devFilter: k })}>{k === 'all' ? t('dv.f.all') : t(`dv.type.${k}`)}</button>
        ))}
      </div>
      {list.map((d) => (
        <button key={d.id} className="list-item" aria-current={d.id === s.devSel} onClick={() => { s.set({ devSel: d.id, sheet: 'insp' }); if (d.geo) s.flyTo(d.geo, d.type === 'relay' ? 12.5 : d.type === 'drone' ? 14 : 15.5); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} data-testid={`device-${d.id}`}>
          <i className={`ph ph-${ICON[d.type]}`} style={{ fontSize: 18, color: 'var(--text-3)' }} />
          <span className="col" style={{ gap: 1, flex: 1, minWidth: 0 }}><b className="truncate">{x(d.name)}</b><span className="caption truncate">{x(d.detail).includes(d.protocol) ? N(x(d.detail)) : `${d.protocol} · ${N(x(d.detail))}`}</span></span>
          <span className={`chip ${STATE_CHIP[d.state]}`}>{t(`dv.state.${d.state}`)}</span>
        </button>
      ))}
    </>
  );
}

export function AssetsInspector({ showApi }: { showApi: boolean }) {
  const { t, x, N, D, F, clock } = useT();
  const now = useNow(5000);
  const s = useOps();
  const role = useSession((st) => st.role);
  const d = s.devices.find((q) => q.id === s.devSel) ?? s.devices[0];
  if (!d) return <span className="muted">{t('loading')}</span>;
  const ago = Math.max(0, now - d.last_seen);
  const seen = ago < 60_000 ? t('dv.now') : ago < 3600_000 ? t('dv.agoMin', { n: Math.round(ago / 60_000) }) : t('dv.agoH', { n: Math.round(ago / 3600_000) });
  const metrics: Array<[string, string, string?]> = [
    [t('dv.id'), d.id], [t('dv.protocol'), d.protocol], [t('dv.battery'), d.battery_pct == null ? '—' : t('unit.pct', { n: Math.round(d.battery_pct) }), d.battery_pct != null && d.battery_pct < 20 ? 'var(--danger)' : undefined],
    [t('dv.lastSignal'), seen, d.state === 'off' ? 'var(--danger)' : undefined], [t('dv.firmware'), d.firmware], [t('dv.signal'), d.signal_dbm == null ? '—' : t('unit.dbm', { n: d.signal_dbm })],
  ];
  const cov = d.coverage;
  const covText = !cov ? null : cov.kind === 'camera' ? t('dv.cov.camera', { h: cov.heading_deg, f: cov.fov_deg, r: D(cov.range_m) })
    : cov.kind === 'radio' ? t('dv.cov.radio', { tx: cov.tx_dbm, g: cov.gain_db, r: D(relayReachM(cov.tx_dbm, cov.gain_db)) }) : t('dv.cov.drone', { r: D(cov.footprint_m) });
  return (
    <>
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div className="col" style={{ gap: 0 }}><span className="caption">{t(`dv.type.${d.type}`)}</span><h2 style={{ fontSize: 18 }}>{x(d.name)}</h2></div>
        <span className={`chip ${STATE_CHIP[d.state]}`}>{t(`dv.state.${d.state}`)}</span>
      </div>
      <div className="grid-2">{metrics.map(([l, v, c]) => <div key={l} className="tile"><div className="caption">{l}</div><div style={{ fontWeight: 600, color: c ?? 'inherit' }} className="num">{v}</div></div>)}</div>
      <div className="tile"><div className="caption">{t('m.position')}</div><div className="mono ltr" style={{ fontSize: 12.5 }}>{d.geo ? `${F(d.geo.lat, 6)}, ${F(d.geo.lon, 6)}` : t('dv.noGeo')}</div></div>
      {covText && <div className="card-2"><span className="caption">{t('dv.coverage')}</span><span>{covText}</span></div>}
      <div className="col" style={{ gap: 6 }}>
        <span className="caption">{t('dv.cmd')}</span>
        <div className="row wrap" style={{ gap: 6 }}>
          {d.commands.map((c) => <button key={c.id} className={`btn btn-sm ${c.id === 'dev.cmd.power' ? (d.state === 'off' ? 'btn-outline' : 'btn-danger') : ''}`} disabled={(d.state === 'off' && c.id !== 'dev.cmd.power') || !can(role, 'command:devices')} onClick={() => sendCommand(d, c.id, x(c.label))} data-testid={`cmd-${c.id}`}>{x(c.label)}</button>)}
        </div>
        {showApi && <span className="api-hint">POST /api/communication/command/{d.id}</span>}
      </div>
      <div className="col" style={{ gap: 6 }}>
        <span className="caption">{t('dv.history')}</span>
        {d.history.map((e, i) => <div key={i} style={{ display: 'grid', gridTemplateColumns: '48px 1fr', gap: 8, fontSize: 12 }}><span className="mono faint">{clock(e.at)}</span><span>{N(x(e.message))}</span></div>)}
      </div>
    </>
  );
}
