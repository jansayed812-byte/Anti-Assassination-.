import { useOps } from '../../stores/ops';
import { useSession } from '../../stores/session';
import { useT } from '../../app/hooks';
import { RISK_CHIP, RISK_VAR } from '../../lib/palette';
import { approvePlan, createPlan, editRoute, setActiveRoute, submitPlan, undoEdit } from '../../app/actions';
import { can } from '../../app/roles';
import type { Place, Plan, PoiKind, RoutePlan } from '../../api/types';

const STATUS_CHIP: Record<Plan['status'], string> = { running: 'chip-success', pending_approval: 'chip-warning', approved: 'chip-accent', closed: '', draft: 'chip-info' };
const PLACE_KINDS: PoiKind[] = ['hq', 'safe_house', 'airport', 'government', 'hospital', 'clinic', 'police', 'fuel'];
const POI_ICON: Record<PoiKind, string> = { hospital: 'first-aid', clinic: 'first-aid', police: 'shield', fuel: 'gas-pump', safe_house: 'house-line', hq: 'flag', airport: 'airplane', government: 'bank' };

function PlaceField({ which }: { which: 'origin' | 'destination' }) {
  const { t, x, F } = useT();
  const s = useOps();
  const value = s.draft[which] as (Place & { poi?: string }) | null;
  const pois = (s.geo?.pois ?? []).filter((p) => PLACE_KINDS.includes(p.kind)).sort((a, b) => PLACE_KINDS.indexOf(a.kind) - PLACE_KINDS.indexOf(b.kind));
  const picking = s.picking === which;
  return (
    <div className="field">
      <span>{t(which === 'origin' ? 'pl.origin' : 'pl.destination')}</span>
      <div className="row" style={{ gap: 6 }}>
        <select className="select" aria-label={t(which === 'origin' ? 'pl.origin' : 'pl.destination')} value={value?.poi ?? ''} data-testid={`select-${which}`}
          onChange={(e) => { const p = pois.find((q) => q.id === e.target.value); s.set({ draft: { ...s.draft, [which]: p ? { name: p.name, lat: p.lat, lon: p.lon, poi: p.id } : null } }); }}>
          <option value="">{value && !value.poi ? t('pl.picked', { c: `${F(value.lat, 5)}, ${F(value.lon, 5)}` }) : t('pl.pickFacility')}</option>
          {pois.map((p) => <option key={p.id} value={p.id}>{x(p.name)}</option>)}
        </select>
        <button className={`btn btn-icon ${picking ? 'on' : ''}`} aria-pressed={picking} title={t('pl.pickOnMap')} aria-label={t('pl.pickOnMap')} onClick={() => s.set({ picking: picking ? null : which })}><i className="ph ph-map-pin" /></button>
      </div>
      {picking && <span className="chip chip-accent" style={{ alignSelf: 'flex-start' }}>{t('pl.picking', { what: t(which === 'origin' ? 'pl.origin' : 'pl.destination') })}</span>}
    </div>
  );
}

export function PlanningList({ showApi }: { showApi: boolean }) {
  const { t, x, N } = useT();
  const s = useOps();
  const role = useSession((st) => st.role);
  const canWrite = can(role, 'write:plans');
  const d = s.draft;
  return (
    <>
      <div className="row-between">
        <h3>{t('pl.title')}</h3>
        {canWrite && <button className={`btn btn-outline btn-sm ${s.newPlan ? 'on' : ''}`} onClick={() => s.set({ newPlan: !s.newPlan, picking: null })}><i className="ph ph-plus" />{t('pl.new')}</button>}
      </div>
      {s.newPlan && canWrite && (
        <form className="card-2" onSubmit={(e) => { e.preventDefault(); void createPlan(); }} data-testid="new-plan">
          {showApi && <span className="api-hint">POST /api/security/escort-plan</span>}
          <PlaceField which="origin" />
          <PlaceField which="destination" />
          <div className="grid-2">
            <label className="field">{t('pl.vip')}
              <select className="select" value={d.vip_level} onChange={(e) => s.set({ draft: { ...d, vip_level: +e.target.value } })}>{[5, 4, 3, 2, 1].map((v) => <option key={v} value={v}>{N(v)}</option>)}</select>
            </label>
            <label className="field">{t('pl.priority')}
              <select className="select" value={d.priority} onChange={(e) => s.set({ draft: { ...d, priority: e.target.value as Plan['priority'] } })}>{(['security', 'time', 'balanced'] as const).map((p) => <option key={p} value={p}>{t(`pl.pri.${p}`)}</option>)}</select>
            </label>
          </div>
          <label className="field">{t('pl.start')}<input className="input" value={d.start} onChange={(e) => s.set({ draft: { ...d, start: e.target.value } })} placeholder="08:30" /></label>
          <button type="submit" className="btn btn-primary btn-block" disabled={!d.origin || !d.destination}><i className="ph ph-path" />{t('pl.compute')}</button>
        </form>
      )}
      {showApi && <span className="api-hint">GET /api/security/escort-plans</span>}
      {s.plans.map((p) => (
        <button key={p.id} className="list-item" aria-current={p.id === s.planSel} onClick={() => s.set({ planSel: p.id, routeSel: null, editing: null, undo: [], sheet: 'insp' })} data-testid={`plan-${p.id}`}>
          <span className="row-between"><b className="mono ltr">{p.id}</b><span className={`chip ${STATUS_CHIP[p.status]}`}>{t(`pl.status.${p.status}`)}</span></span>
          <span style={{ fontSize: 12.5 }}>{x(p.title)}</span>
          <span className="caption">{t('pl.meta', { v: p.vip_level, start: x(p.start), n: p.vehicles })}</span>
        </button>
      ))}
    </>
  );
}

function SegmentStrip({ r }: { r: RoutePlan }) {
  const { t, D } = useT();
  return (
    <div className="col" style={{ gap: 4 }}>
      <span className="caption">{t('pl.segments')}</span>
      <div className="risk-bar" role="img" aria-label={t('pl.segments')}>
        {r.segments.map((seg, i) => <span key={i} title={`${t(`risk.${seg.level}`)} · ${D(seg.length_m)}`} style={{ flex: Math.max(1, seg.length_m), background: RISK_VAR[seg.level] }} />)}
      </div>
      <div className="row wrap caption" style={{ gap: 10 }}>
        {(['low', 'medium', 'high', 'critical'] as const).map((l) => {
          const m = r.segments.filter((sg) => sg.level === l).reduce((a, sg) => a + sg.length_m, 0);
          return m > 0 ? <span key={l} className="row" style={{ gap: 4 }}><span className="dot" style={{ background: RISK_VAR[l] }} />{t(`riskShort.${l}`)} {D(m)}</span> : null;
        })}
      </div>
    </div>
  );
}

function Profile({ r }: { r: RoutePlan }) {
  const { t } = useT();
  const W = 300, H = 64, max = Math.max(0.7, ...r.profile.map((p) => p.score));
  const last = r.profile.at(-1)?.at_m || r.distance_m || 1;
  const pts = r.profile.map((p) => [(p.at_m / last) * W, H - (p.score / max) * H] as const);
  const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  const y = (v: number) => H - (v / max) * H;
  return (
    <div className="col" style={{ gap: 4 }}>
      <span className="caption">{t('pl.profile')}</span>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img" aria-label={t('pl.profile')} style={{ background: 'var(--bg-2)', borderRadius: 6, transform: document.documentElement.dir === 'rtl' ? 'scaleX(-1)' : undefined }}>
        <line x1="0" x2={W} y1={y(0.35)} y2={y(0.35)} stroke="var(--risk-high)" strokeDasharray="4 3" strokeWidth="1" />
        <line x1="0" x2={W} y1={y(0.6)} y2={y(0.6)} stroke="var(--risk-critical)" strokeDasharray="4 3" strokeWidth="1" />
        {pts.length > 1 && <path d={`${line} L${W},${H} L0,${H} Z`} fill="var(--accent-soft)" />}
        {pts.length > 1 && <path d={line} fill="none" stroke="var(--accent)" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />}
      </svg>
    </div>
  );
}

function Stops({ title, empty, stops, color }: { title: string; empty: string; stops: RoutePlan['safe_stops']; color: string }) {
  const { t, x, D, M } = useT();
  const s = useOps();
  return (
    <div className="col" style={{ gap: 4 }}>
      <span className="caption">{title}</span>
      {stops.length === 0 && <span className="muted" style={{ fontSize: 12 }}>{empty}</span>}
      {stops.map((p) => (
        <button key={p.id} className="list-item" style={{ padding: '6px 8px' }} onClick={() => s.flyTo(p, 16)}>
          <span className="row-between"><span className="row"><i className={`ph ph-${POI_ICON[p.kind]}`} style={{ color }} /><span className="truncate">{x(p.name)}</span></span><span className="caption">{t('pl.at', { d: D(p.at_m), t: M(p.eta_min) })}</span></span>
          <span className="caption">{t('pl.offset', { d: D(p.offset_m) })}</span>
        </button>
      ))}
    </div>
  );
}

function Editor({ plan, r }: { plan: Plan; r: RoutePlan }) {
  const { t, F } = useT();
  const s = useOps();
  const wps = plan.routes[r.k]?.waypoints ?? [];
  return (
    <div className="card-2 edge" style={{ '--edge': 'var(--accent)' } as React.CSSProperties} data-testid="route-editor">
      <div className="row-between"><b>{t('pl.editing', { k: r.k })}</b><button className="btn btn-sm btn-primary" onClick={() => s.set({ editing: null, undo: [] })}>{t('pl.doneEditing')}</button></div>
      <span className="caption">{t('pl.editHelp')}</span>
      {plan.status === 'approved' && <span className="chip chip-warning" style={{ alignSelf: 'flex-start' }}>{t('pl.reapproval')}</span>}
      <span className="caption">{t('pl.waypoints')}</span>
      {wps.length === 0 && <span className="muted" style={{ fontSize: 12 }}>{t('pl.noWaypoints')}</span>}
      {wps.map((w, i) => (
        <div key={`${i}-${w.lat}-${w.lon}`} className="row-between" style={{ fontSize: 12 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => s.flyTo(w, 16)}>{t('pl.waypoint', { n: i + 1 })} · <span className="mono ltr">{F(w.lat, 5)}, {F(w.lon, 5)}</span></button>
          <button className="btn btn-ghost btn-sm" aria-label={t('remove')} onClick={() => void editRoute(plan, r.k, wps.filter((_, j) => j !== i))}><i className="ph ph-trash" /></button>
        </div>
      ))}
      <div className="row" style={{ gap: 6 }}>
        <button className="btn btn-sm" disabled={!s.undo.length} onClick={() => void undoEdit(plan, r.k)}><i className="ph ph-arrow-counter-clockwise" />{t('undo')}</button>
        <button className="btn btn-sm" disabled={!wps.length} onClick={() => void editRoute(plan, r.k, [])}><i className="ph ph-magic-wand" />{t('pl.clearWaypoints')}</button>
      </div>
    </div>
  );
}

export function PlanningInspector({ showApi }: { showApi: boolean }) {
  const { t, x, D, M, F, who } = useT();
  const s = useOps();
  const role = useSession((st) => st.role);
  const plan = s.plans.find((p) => p.id === s.planSel) ?? s.plans[0];
  if (!plan) return <span className="muted">{t('loading')}</span>;
  const shownKey = s.routeSel ?? plan.active_route;
  const r = plan.pace.find((q) => q.k === shownKey) ?? plan.pace[0];
  const isCmd = can(role, 'approve:plans');
  const mayWrite = can(role, 'write:plans');
  const maySwitch = can(role, 'switch:route');
  const open = plan.status !== 'closed';
  return (
    <>
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div className="col" style={{ gap: 0 }}><span className="caption mono ltr">{plan.id} · v{plan.version}</span><h2 style={{ fontSize: 17 }}>{x(plan.title)}</h2></div>
        <span className={`chip ${STATUS_CHIP[plan.status]}`}>{t(`pl.status.${plan.status}`)}</span>
      </div>
      <span className="caption">{t('pl.meta', { v: plan.vip_level, start: x(plan.start), n: plan.vehicles })}{plan.approved_by ? ` · ✓ ${who(plan.approved_by)}` : ''}</span>

      <span className="caption">{t('pl.paceHint')}</span>
      <div className="col" style={{ gap: 6 }} role="radiogroup" aria-label={t('pl.paceHint')}>
        {plan.pace.map((q) => {
          const on = q.k === r?.k, active = q.k === plan.active_route;
          return (
            <button key={q.k} role="radio" aria-checked={on} className="card-2" data-testid={`route-${q.k}`} onClick={() => s.set({ routeSel: q.k, editing: s.editing && s.editing !== q.k ? null : s.editing })}
              style={{ textAlign: 'start', padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10, boxShadow: on ? 'inset 0 0 0 1.5px var(--accent)' : 'inset 0 0 0 1px var(--line)' }}>
              <span style={{ width: 30, height: 30, flex: 'none', borderRadius: 8, display: 'grid', placeItems: 'center', fontWeight: 700, background: on ? 'var(--accent)' : 'var(--surface-3)', color: on ? 'var(--accent-ink)' : 'var(--text)' }}>{q.k}</span>
              <span className="col" style={{ gap: 1, flex: 1, minWidth: 0 }}>
                <span className="row" style={{ gap: 6 }}><b className="truncate">{x(q.label)}</b>{active && <span className="chip chip-accent" style={{ padding: '0 6px' }}>{t('pl.activeRoute')}</span>}{plan.routes[q.k]?.edited && <span className="chip chip-info" style={{ padding: '0 6px' }}>{t('pl.editedBadge')}</span>}</span>
                <span className="caption">{D(q.distance_m)} · {M(q.eta_min)} · {t('pl.coverage')} {t('unit.pct', { n: q.coverage_pct })}</span>
              </span>
              <span className={`chip ${RISK_CHIP[q.risk_level]}`}>{F(q.max_risk, 2)}</span>
            </button>
          );
        })}
      </div>

      {r && (
        <>
          <div className="grid-3">
            <div className="tile"><div className="caption">{t('pl.eta')}</div><div className="v">{M(r.eta_min)}</div></div>
            <div className="tile"><div className="caption">{t('pl.distance')}</div><div className="v">{D(r.distance_m)}</div></div>
            <div className="tile"><div className="caption">{t('pl.highRisk')}</div><div className="v" style={{ color: r.high_risk_min > 0 ? 'var(--risk-high)' : 'var(--success)' }}>{M(r.high_risk_min)}</div></div>
          </div>
          <SegmentStrip r={r} />
          <Profile r={r} />
          <div className="row wrap" style={{ gap: 6 }}>
            {open && maySwitch && r.k !== plan.active_route && <button className="btn btn-outline btn-sm" onClick={() => setActiveRoute(plan.id, r.k, x(r.label))}><i className="ph ph-check" />{t('pl.activate')}</button>}
            {open && mayWrite && s.editing !== r.k && <button className="btn btn-sm" onClick={() => s.set({ editing: r.k, routeSel: r.k, undo: [], newPlan: false, picking: null })} data-testid="edit-route"><i className="ph ph-pencil-simple" />{t('pl.edit')}</button>}
          </div>
          {s.editing === r.k && <Editor plan={plan} r={r} />}
          {showApi && <span className="api-hint">PUT /api/security/escort-plan/{plan.id}/routes/{r.k}</span>}

          <div className="col" style={{ gap: 4 }}>
            <span className="caption">{t('pl.alerts')}</span>
            {r.alerts.length === 0 && <span className="muted" style={{ fontSize: 12 }}>{t('pl.noAlerts')}</span>}
            {r.alerts.map((a, i) => (
              <div key={i} className="card-2 edge" style={{ '--edge': a.level === 'blind' ? 'var(--hazard)' : RISK_VAR[a.level], padding: '7px 10px', flexDirection: 'row', justifyContent: 'space-between', fontSize: 12.5 } as React.CSSProperties}>
                <span>{a.level === 'blind' ? <i className="ph ph-eye-slash" /> : <i className="ph ph-warning" />} {x(a.text)}</span>
                <span className="caption" style={{ whiteSpace: 'nowrap' }}>{D(a.at_m)}</span>
              </div>
            ))}
          </div>
          <Stops title={t('pl.stops')} empty={t('pl.noStops')} stops={r.safe_stops} color="var(--success)" />
          <Stops title={t('pl.support')} empty={t('pl.noSupport')} stops={r.support_points} color="var(--info)" />
          <div className="col" style={{ gap: 4 }}>
            <span className="caption">{t('pl.checkpoints')}</span>
            {r.checkpoints.map((c) => (
              <button key={c.id} className="list-item" style={{ padding: '5px 8px', display: 'grid', gridTemplateColumns: '46px 1fr auto', gap: 8, alignItems: 'center', fontSize: 12.5 }} onClick={() => s.flyTo(c, 16)}>
                <span className="mono ltr" style={{ color: 'var(--accent)' }}>{c.id}</span><span className="truncate">{x(c.name)}</span><span className="caption">+{M(c.eta_min)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="col" style={{ gap: 6 }}>
        <span className="caption">{t('pl.resources')}</span>
        <div className="row wrap" style={{ gap: 6 }}>{plan.resources.map((q, i) => <span key={i} className="chip">{x(q)}</span>)}</div>
      </div>
      <div className="col" style={{ gap: 6 }}>
        <span className="caption">{t('pl.validation')}</span>
        {plan.validation.map((v, i) => (
          <div key={i} className="row" style={{ alignItems: 'flex-start', fontSize: 12.5 }}><i className={`ph ph-${v.ok ? 'check-circle' : 'warning-circle'}`} style={{ color: v.ok ? 'var(--success)' : 'var(--warning)', marginTop: 3 }} /><span>{x(v.text)}</span></div>
        ))}
      </div>
      {open && plan.status !== 'running' && (isCmd ? (
        <button className="btn btn-primary btn-block" disabled={plan.status === 'approved'} onClick={() => approvePlan(plan.id)} data-testid="approve">{plan.status === 'approved' ? t('pl.approved') : t('pl.approve')}</button>
      ) : mayWrite ? (
        <button className="btn btn-primary btn-block" disabled={plan.status === 'pending_approval'} onClick={() => submitPlan(plan.id)} data-testid="submit">{plan.status === 'pending_approval' ? t('pl.awaiting') : t('pl.submit')}</button>
      ) : null)}
    </>
  );
}
