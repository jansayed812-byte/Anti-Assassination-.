import { useOps } from '../../stores/ops';
import { useT } from '../../app/hooks';
import { AlertCard } from '../../ui/AlertCard';
import { RISK_CHIP } from '../../lib/palette';
import { reportIncident, sendCommand, setActiveRoute } from '../../app/actions';
import { useSession } from '../../stores/session';
import { can } from '../../app/roles';
import type { Unit } from '../../api/types';

const ORDER = { critical: 0, error: 1, warning: 2, info: 3 } as const;

export function LiveList({ showApi }: { showApi: boolean }) {
  const { t, x, N } = useT();
  const s = useOps();
  const open = s.alerts.filter((a) => a.status === 'active' || a.status === 'escalated');
  const sorted = [...s.alerts].sort((a, b) => ORDER[a.level] - ORDER[b.level] || b.created_at.localeCompare(a.created_at));
  const units = s.unitOrder.map((id) => s.units[id]).filter(Boolean);
  const running = s.plans.find((p) => p.status === 'running');
  const groups: Array<[string, Unit[]]> = [
    [t('live.mission', { id: running?.id ?? '—' }), units.filter((u) => u.group === 'mission')],
    [t('live.standby'), units.filter((u) => u.group === 'standby')],
  ];
  return (
    <>
      <div role="tablist" className="seg full">
        <button role="tab" aria-selected={s.liveTab === 'units'} onClick={() => s.set({ liveTab: 'units' })}>{t('units')}</button>
        <button role="tab" aria-selected={s.liveTab === 'alerts'} onClick={() => s.set({ liveTab: 'alerts' })}>{t('alerts')} · {N(open.length)}</button>
      </div>
      {s.liveTab === 'units' ? (
        <>
          {showApi && <span className="api-hint">GET /api/v1/telemetry/latest · WS env/telemetry</span>}
          {groups.map(([title, list]) => (
            <div key={title} className="col" style={{ gap: 2 }}>
              <div className="eyebrow" style={{ padding: '4px 4px 2px' }}>{title}</div>
              {list.map((u) => {
                const risk = u.telemetry?.risk_level ?? 'low';
                return (
                  <button key={u.id} className="list-item" aria-current={u.id === s.sel} onClick={() => { s.set({ sel: u.id, sheet: 'insp' }); if (u.telemetry) s.flyTo(u.telemetry, 16); }}>
                    <span className="row-between">
                      <span className="row"><i className={`ph ph-${u.icon}`} style={{ color: 'var(--friendly)', fontSize: 16 }} /><b>{x(u.name)}</b></span>
                      <span className={`chip ${RISK_CHIP[risk]}`}>{t(`riskShort.${risk}`)}</span>
                    </span>
                    <span className="caption">{x(u.sub)}{u.comms === 'lost' ? ` · ${t('unitInfo.comms')}` : ''}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </>
      ) : (
        <>
          {showApi && <span className="api-hint">GET /api/monitoring/alerts · WS env/alerts</span>}
          {sorted.map((a) => <AlertCard key={a.id} alert={a} variant="list" />)}
        </>
      )}
    </>
  );
}

export function LiveInspector({ showApi }: { showApi: boolean }) {
  const { t, x, N, F, M, clock } = useT();
  const s = useOps();
  const role = useSession((st) => st.role);
  const u = s.units[s.sel] ?? s.units[s.unitOrder[0]];
  if (!u) return <span className="muted">{t('loading')}</span>;
  const tl = u.telemetry;
  const risk = tl?.risk_level ?? 'low';
  const plan = u.mission ? s.plans.find((p) => p.id === u.mission) : undefined;
  const route = plan?.pace.find((r) => r.k === plan.active_route);
  const doneM = route && tl?.route_progress !== undefined ? route.distance_m * tl.route_progress : undefined;
  const nextCp = route && doneM !== undefined ? route.checkpoints.find((c) => c.at_m >= doneM) ?? route.checkpoints.at(-1) : undefined;
  const fcol = ['var(--accent)', 'var(--friendly)', 'var(--warning)', 'var(--text-3)'];
  const events = s.alerts.filter((a) => a.unit === u.id).flatMap((a) => a.history.map((h) => ({ at: h.at, m: `${x(a.title)} · ${t(`status.${h.status}`)}` }))).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
  const drone = s.devices.find((d) => d.id === 'D-01');
  const comm = s.devices.find((d) => d.id === (u.device ?? (u.id === 'alpha' ? 'IOT-04' : u.id === 'bravo' ? 'GPS-02' : u.id === 'charlie' ? 'IOT-12' : 'D-01')));
  const cmdLabel = (dev: typeof comm, id: string) => dev?.commands.find((c) => c.id === id)?.label;
  const metrics: Array<[string, string, string?]> = tl ? [
    [t('m.speed'), t('unit.kmh', { n: tl.speed_kmh })], [t('m.heading'), `${N(tl.heading_deg)}°`], [t('m.altitude'), t('unit.m', { n: tl.alt_m })],
    [t('m.accel'), `${F(tl.accel_mps2, 1)} m/s²`], [t('m.cep'), t('unit.m', { n: F(tl.cep95_m, 1) }), tl.cep95_m > 5 ? 'var(--warning)' : undefined], [t('m.e2e'), `${N(s.e2eMs)} ms`],
  ] : [];
  return (
    <>
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div className="col" style={{ gap: 0 }}><span className="caption">{t('selected')}</span><h2 style={{ fontSize: 19 }}>{x(u.name)}</h2></div>
        <span className={`chip ${RISK_CHIP[risk]}`}>{t(`risk.${risk}`)}</span>
      </div>
      <div role="tablist" className="tabs">
        {(['sum', 'video', 'events'] as const).map((k) => <button key={k} role="tab" aria-selected={s.inspTab === k} onClick={() => s.set({ inspTab: k })}>{t(k === 'sum' ? 'tab.summary' : k === 'video' ? 'tab.video' : 'tab.events')}</button>)}
      </div>
      {s.inspTab === 'sum' && (
        <>
          {!tl && <span className="muted">{t('unitInfo.noTelemetry')}</span>}
          <div className="grid-2">{metrics.map(([l, v, c]) => <div key={l} className="tile"><div className="caption">{l}</div><div className="v" style={{ color: c ?? 'inherit' }}>{v}</div></div>)}</div>
          {tl && <div className="tile"><div className="caption">{t('m.position')}</div><div className="mono ltr" style={{ fontSize: 12.5 }}>{F(tl.lat, 6)}, {F(tl.lon, 6)}</div></div>}
          {tl && (
            <div className="col" style={{ gap: 6 }}>
              <span className="caption">{t('fusion.share', { mode: t(`fusion.${tl.mode}`) })}</span>
              <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', gap: 2 }}>{tl.fusion.filter((f) => f.share > 0).map((f, i) => <span key={f.source} style={{ flex: f.share, background: fcol[i] }} />)}</div>
              <div className="row wrap caption ltr" style={{ gap: 10 }}>{tl.fusion.map((f) => <span key={f.source}>{f.source} {f.share}%</span>)}</div>
            </div>
          )}
          {plan && (
            <div className="col" style={{ gap: 6 }}>
              <span className="caption">{t('route.active', { id: plan.id })}</span>
              <div className="seg full">
                {plan.pace.map((r) => {
                  const on = r.k === plan.active_route;
                  return <button key={r.k} title={x(r.label)} aria-pressed={on} disabled={!on && !can(role, 'switch:route')} onClick={() => !on && setActiveRoute(plan.id, r.k, x(r.label))}>{r.k}</button>;
                })}
              </div>
              {showApi && <span className="api-hint">PATCH /api/security/escort-plan/{plan.id}</span>}
              {nextCp && route && doneM !== undefined && <span className="muted" style={{ fontSize: 12 }}>{t('route.nextCp', { cp: nextCp.id, eta: M(Math.max(0.5, nextCp.eta_min - route.eta_min * (tl?.route_progress ?? 0))) })}</span>}
            </div>
          )}
          <div className="row wrap" style={{ gap: 6 }}>
            <button className="btn" disabled={!comm || comm.state === 'off' || !can(role, 'command:devices')} onClick={() => comm && sendCommand(comm, 'dev.cmd.call', x(cmdLabel(comm, 'dev.cmd.call') ?? t('act.call')))} style={{ flex: '1 1 120px' }}><i className="ph ph-phone" />{t('act.call')}</button>
            <button className="btn" disabled={!drone || drone.state === 'off' || !can(role, 'command:devices')} onClick={() => drone && sendCommand(drone, 'dev.cmd.goto', x(cmdLabel(drone, 'dev.cmd.goto') ?? t('act.drone')))} style={{ flex: '1 1 120px' }}><i className="ph ph-drone" />{t('act.drone')}</button>
            <button className="btn" disabled={!can(role, 'write:alerts')} onClick={() => reportIncident(x(u.name), u.id)} style={{ flex: '1 1 120px' }}><i className="ph ph-note-pencil" />{t('act.report')}</button>
          </div>
        </>
      )}
      {s.inspTab === 'video' && (
        <>
          <div style={{ aspectRatio: '16/9', borderRadius: 10, background: 'repeating-linear-gradient(135deg, var(--surface-2) 0 8px, var(--surface-3) 8px 16px)', position: 'relative', display: 'grid', placeItems: 'center' }}>
            <span className="caption" style={{ textAlign: 'center', padding: 12 }}><span className="mono ltr">D-01 · 4K 30fps · WebRTC</span><br />{t('video.noStream')}</span>
            <span className={`chip ${drone?.state === 'on' ? 'chip-danger' : ''}`} style={{ position: 'absolute', top: 8, insetInlineStart: 8 }}>● {drone?.state === 'on' ? 'LIVE' : 'IDLE'}</span>
          </div>
          <span className="muted" style={{ fontSize: 12 }}>{t('video.note')}</span>
        </>
      )}
      {s.inspTab === 'events' && (events.length ? events.map((e, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '48px 1fr', gap: 8, fontSize: 12 }}><span className="mono faint">{clock(e.at)}</span><span>{e.m}</span></div>
      )) : <span className="muted" style={{ fontSize: 12 }}>{t('sim.noEvents')}</span>)}
    </>
  );
}
