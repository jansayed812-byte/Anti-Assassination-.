import { useOps } from '../../stores/ops';
import { useT } from '../../app/hooks';
import { AlertCard } from '../../ui/AlertCard';
import { bgc, clock, fg, RISK_HUE } from '../../lib/format';
import { reportIncident, sendCommand, setActiveRoute } from '../../app/actions';
import { flyToUnit } from '../../map/MapStage';
import { useSession } from '../../stores/session';
import { can } from '../../app/roles';
import type { Unit } from '../../api/types';

const ORDER = { critical: 0, error: 1, warning: 2, info: 3 } as const;

export function LiveList({ showApi }: { showApi: boolean }) {
  const { t, N } = useT();
  const s = useOps();
  const open = s.alerts.filter((a) => a.status === 'active' || a.status === 'escalated');
  const sorted = [...s.alerts].sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  const units = s.unitOrder.map((id) => s.units[id]).filter(Boolean);
  const running = s.plans.find((p) => p.status === 'running');
  const groups: Array<[string, Unit[]]> = [
    [t('live.mission', { id: running?.id ?? '—' }), units.filter((u) => u.group === 'mission')],
    [t('live.standby'), units.filter((u) => u.group === 'standby')],
  ];
  const tabBtn = (on: boolean): React.CSSProperties => ({ flex: 1, padding: 6, borderRadius: 6, background: on ? 'var(--color-surface)' : 'transparent' });
  return (
    <>
      <div role="tablist" style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 8, background: 'var(--color-bg)' }}>
        <button role="tab" aria-selected={s.liveTab === 'units'} onClick={() => s.set({ liveTab: 'units' })} style={tabBtn(s.liveTab === 'units')}>{t('units')}</button>
        <button role="tab" aria-selected={s.liveTab === 'alerts'} onClick={() => s.set({ liveTab: 'alerts' })} style={tabBtn(s.liveTab === 'alerts')}>{t('alerts')} · {N(open.length)}</button>
      </div>
      {s.liveTab === 'units' ? (
        <>
          {showApi && <span className="api-hint">GET /api/v1/telemetry/latest · WS env/telemetry</span>}
          {groups.map(([title, list]) => (
            <div key={title} style={{ display: 'contents' }}>
              <div className="eyebrow" style={{ padding: '4px 4px 0' }}>{title}</div>
              {list.map((u) => {
                const risk = u.telemetry?.risk_level ?? 'low';
                return (
                  <button key={u.id} className="hov-accent" onClick={() => { s.set({ sel: u.id, sheet: 'insp' }); flyToUnit(u.id); }}
                    style={{ textAlign: 'start', padding: '9px 10px', borderRadius: 8, background: u.id === s.sel ? 'var(--color-accent-900)' : 'transparent', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><i className={`ph ph-${u.icon}`} style={{ color: 'var(--color-neutral-400)' }} /><span style={{ fontWeight: 500 }}>{u.name}</span></span>
                      <span style={{ fontSize: 11, color: fg(RISK_HUE[risk]) }}>{t(`risk.${risk}`)}</span>
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--color-neutral-400)' }}>{u.sub}{u.comms === 'lost' ? ` · ${t('unit.comms')}` : ''}</span>
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

const UNIT_DEVICE: Record<string, string> = { alpha: 'IOT-04', drone: 'D-01', bravo: 'GPS-02', charlie: 'IOT-12' };

export function LiveInspector({ showApi }: { showApi: boolean }) {
  const { t, N } = useT();
  const s = useOps();
  const role = useSession((x) => x.role);
  const u = s.units[s.sel] ?? s.units[s.unitOrder[0]];
  if (!u) return <span className="muted">{t('loading')}</span>;
  const tl = u.telemetry;
  const risk = tl?.risk_level ?? 'low';
  const plan = u.mission ? s.plans.find((p) => p.id === u.mission) : undefined;
  const route = plan?.pace.find((r) => r.k === plan.active_route);
  const nextCp = route && tl?.route_progress !== undefined ? route.checkpoints.find((c) => c.eta_min >= route.minutes * tl.route_progress!) ?? route.checkpoints.at(-1) : undefined;
  const fcol = ['var(--color-accent)', 'var(--color-accent-400)', 'var(--color-accent-600)', 'var(--color-neutral-600)'];
  const events = s.alerts.filter((a) => a.unit === u.id).flatMap((a) => a.history.map((h) => ({ at: h.at, m: `${a.title} · ${t(`status.${h.status}`)}` }))).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
  const drone = s.devices.find((d) => d.id === 'D-01');
  const comm = s.devices.find((d) => d.id === UNIT_DEVICE[u.id]);
  const tab = (k: typeof s.inspTab, label: string) => (
    <button role="tab" aria-selected={s.inspTab === k} onClick={() => s.set({ inspTab: k })} style={{ padding: '7px 10px', color: s.inspTab === k ? 'var(--color-accent-200)' : 'var(--color-neutral-300)', boxShadow: s.inspTab === k ? 'inset 0 -2px 0 var(--color-accent)' : 'none' }}>{label}</button>
  );
  const metrics = tl ? [
    [t('m.speed'), `${N(tl.speed_kmh)} km/h`], [t('m.heading'), `${N(tl.heading_deg)}°`], [t('m.altitude'), `${N(tl.alt_m)} m`],
    [t('m.accel'), `${N(tl.accel_mps2)} m/s²`], [t('m.cep'), `${N(tl.cep95_m)} m`, tl.cep95_m > 5 ? fg(90) : undefined], [t('m.e2e'), `${N(s.e2eMs)} ms`],
  ] as Array<[string, string, string?]> : [];

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}><span className="caption">{t('selected')}</span><span style={{ fontSize: 18, fontWeight: 500 }}>{u.name}</span></div>
        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: bgc(RISK_HUE[risk]), color: fg(RISK_HUE[risk]), whiteSpace: 'nowrap' }}>{t(`risk.${risk}`)}</span>
      </div>
      <div role="tablist" className="divider-bottom" style={{ display: 'flex', gap: 2 }}>{tab('sum', t('tab.summary'))}{tab('video', t('tab.video'))}{tab('events', t('tab.events'))}</div>

      {s.inspTab === 'sum' && (
        <>
          {!tl && <span className="muted">{t('unit.noTelemetry')}</span>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {metrics.map(([l, v, c]) => <div key={l} className="tile"><div className="caption">{l}</div><div style={{ fontSize: 16, fontWeight: 500, color: c ?? 'inherit' }}>{v}</div></div>)}
          </div>
          {tl && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="caption">{t('fusion.share', { mode: tl.mode })}</span>
              <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', gap: 2 }}>{tl.fusion.filter((f) => f.share > 0).map((f, i) => <span key={f.source} style={{ flex: f.share, background: fcol[i] }} />)}</div>
              <div className="ltr" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 10.5, color: 'var(--color-neutral-400)', justifyContent: 'flex-end' }}>{tl.fusion.map((f) => <span key={f.source}>{f.source} {N(f.share)}%</span>)}</div>
            </div>
          )}
          {plan && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="caption">{t('route.active', { id: plan.id })}</span>
              <div style={{ display: 'flex', gap: 4 }}>
                {plan.pace.map((r) => {
                  const on = r.k === plan.active_route;
                  return <button key={r.k} title={r.name} disabled={!on && !can(role, 'switch:route')} onClick={() => !on && setActiveRoute(plan.id, r.k, r.name)} style={{ flex: 1, padding: 6, borderRadius: 6, background: on ? 'transparent' : 'var(--color-neutral-900)', color: on ? 'var(--color-accent-200)' : 'var(--color-text)', boxShadow: on ? 'inset 0 0 0 1px var(--color-accent)' : 'none' }}>{r.k}</button>;
                })}
              </div>
              {showApi && <span className="api-hint">PATCH /api/security/escort-plan/{plan.id}</span>}
              {nextCp && route && <span style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>{t('route.nextCp', { cp: nextCp.id, eta: N(Math.max(1, Math.round(nextCp.eta_min - route.minutes * (tl?.route_progress ?? 0)))) })}</span>}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className="btn-outline" disabled={!comm || !can(role, 'command:devices')} onClick={() => comm && sendCommand(comm, 'درخواست تماس')} style={{ flex: '1 1 120px', padding: 8, borderRadius: 8 }}>{t('act.call')}</button>
            <button className="btn-outline" disabled={!drone || !can(role, 'command:devices')} onClick={() => drone && sendCommand(drone, 'پرواز به مختصات')} style={{ flex: '1 1 120px', padding: 8, borderRadius: 8 }}>{t('act.drone')}</button>
            <button className="btn-outline" disabled={!can(role, 'write:alerts')} onClick={() => reportIncident(u.name, u.id)} style={{ flex: '1 1 120px', padding: 8, borderRadius: 8 }}>{t('act.report')}</button>
          </div>
        </>
      )}

      {s.inspTab === 'video' && (
        <>
          <div style={{ aspectRatio: '16/9', borderRadius: 10, background: 'repeating-linear-gradient(135deg,#1c1e2c 0 8px,#20222f 8px 16px)', position: 'relative', overflow: 'hidden' }}>
            <span className="mono ltr" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 11, color: 'var(--color-neutral-500)', textAlign: 'center', padding: 12 }}>D-01 · 4K 30fps · WebRTC<br />{t('video.noStream')}</span>
            <span style={{ position: 'absolute', top: 8, insetInlineStart: 8, fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'oklch(0.34 0.08 25)', color: 'oklch(0.9 0.05 25)' }}>● {drone?.state === 'on' ? 'LIVE' : 'IDLE'}</span>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--color-neutral-400)' }}>{t('video.note')}</div>
          {showApi && <span className="api-hint">GET /api/vision/streams · WHEP /api/vision/stream/D-01</span>}
        </>
      )}

      {s.inspTab === 'events' && (events.length ? events.map((e, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '52px 1fr', gap: 8, fontSize: 12 }}><span className="mono ltr" style={{ color: 'var(--color-neutral-500)', textAlign: 'start' }}>{clock(e.at)}</span><span>{e.m}</span></div>
      )) : <span className="muted" style={{ fontSize: 12 }}>{t('sim.noEvents')}</span>)}
    </>
  );
}
