import { useOps } from '../../stores/ops';
import { useT } from '../../app/hooks';
import { SEV } from '../../lib/palette';
import { makeAAR, simReset, simSpeed, simToggle } from '../../app/actions';
import { useSession } from '../../stores/session';
import { can } from '../../app/roles';
import type { ScenarioMetrics } from '../../api/types';

export function SimList({ showApi }: { showApi: boolean }) {
  const { t, x, N } = useT();
  const s = useOps();
  return (
    <>
      <div className="row-between"><h3>{t('sim.title')}</h3>{showApi && <span className="api-hint">GET /api/v1/scenarios</span>}</div>
      {s.scenarios.map((sc) => (
        <button key={sc.id} className="list-item" aria-current={sc.id === s.scenSel} onClick={() => s.set({ scenSel: sc.id, sheet: 'insp' })} data-testid={`scenario-${sc.id}`}>
          <span className="row-between"><b>{x(sc.name)}{s.sim?.scenario_id === sc.id && s.sim.running ? ' ●' : ''}</b><span className="caption">{t('sim.minutes', { m: N(sc.nominal_minutes ?? Math.round(sc.duration_ms / 60000)) })}</span></span>
          <span className="row" style={{ gap: 6 }}><span className="chip">{x(sc.category)}</span>{sc.difficulty && <span className="caption">{t(`sim.diff.${sc.difficulty}`)}</span>}</span>
        </button>
      ))}
    </>
  );
}

export function SimInspector({ showApi }: { showApi: boolean }) {
  const { t, x, N } = useT();
  const s = useOps();
  const allowed = can(useSession((st) => st.role), 'run:scenarios');
  const sc = s.scenarios.find((q) => q.id === s.scenSel) ?? s.scenarios[0];
  if (!sc) return <span className="muted">{t('loading')}</span>;
  const st = s.sim;
  const mine = st?.scenario_id === sc.id;
  const other = st?.scenario_id && !mine && st.running ? s.scenarios.find((q) => q.id === st.scenario_id) : undefined;
  const progress = mine ? st!.progress : 0;
  const running = mine && st!.running;
  const finished = mine && st!.finished;
  const label = running ? t('sim.pause') : finished ? t('sim.finished') : progress > 0 ? t('sim.resume') : t('sim.run');
  const events = mine ? [...st!.events].reverse() : [];
  const speed = st?.speed ?? 1;
  const metric = (k: keyof ScenarioMetrics, m: ScenarioMetrics) => k === 'route_decision' ? x(m.route_decision) : k === 'compliance_pct' ? t('unit.pct', { n: m[k] }) : t('unit.s', { n: m[k] });
  return (
    <>
      <div className="col" style={{ gap: 2 }}>
        <span className="caption">{x(sc.category)}</span>
        <h2 style={{ fontSize: 18 }}>{x(sc.name)}</h2>
        <span className="muted" style={{ fontSize: 12.5 }}>{x(sc.description)}</span>
        <span className="chip chip-info" style={{ alignSelf: 'flex-start', marginTop: 4 }}>{t('exercise')}</span>
      </div>
      {other && <span className="chip chip-warning">{t('sim.otherActive', { name: x(other.name) })}</span>}
      <div className="row" style={{ gap: 6 }}>
        <button className="btn btn-primary" style={{ flex: 1 }} disabled={finished || !allowed} onClick={() => simToggle(sc)} data-testid="sim-run"><i className={`ph ph-${running ? 'pause' : 'play'}`} />{label}</button>
        <button className="btn btn-icon" aria-label={t('reset')} title={t('reset')} disabled={!allowed} onClick={() => simReset()}><i className="ph ph-arrow-counter-clockwise" /></button>
        <div className="seg">{[1, 2, 4].map((v) => <button key={v} aria-pressed={speed === v} disabled={!allowed} onClick={() => simSpeed(v)}>×{N(v)}</button>)}</div>
      </div>
      {showApi && <span className="api-hint">POST /api/v1/scenarios/{sc.id}/run · WS env/sim</span>}
      <div className="col" style={{ gap: 4 }}>
        <div className="row-between caption"><span>{t('sim.progress')}</span><span>{t('unit.pct', { n: Math.round(progress) })}</span></div>
        <div className="bar" style={{ height: 5 }}><span style={{ width: `${progress}%`, transition: 'width 1s linear' }} /></div>
      </div>
      <div className="col" style={{ gap: 6 }}>
        <span className="caption">{t('sim.events')}</span>
        {events.length === 0 && <span className="muted" style={{ fontSize: 12 }}>{t('sim.noEvents')}</span>}
        {events.map((e, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '56px 1fr', gap: 8, fontSize: 12.5 }}>
            <span className="mono" style={{ color: SEV[e.level].color }}>{N(`T+${Math.round((e.t_ms / sc.duration_ms) * (sc.nominal_minutes ?? 1))}m`)}</span><span>{x(e.message)}</span>
          </div>
        ))}
      </div>
      {finished && sc.metrics && (
        <>
          <div className="grid-2">
            {(Object.keys(sc.metrics) as Array<keyof ScenarioMetrics>).map((k) => <div key={k} className="tile"><div className="caption">{t(`sim.mt.${k}`)}</div><div className="v" style={{ fontSize: 14 }}>{metric(k, sc.metrics!)}</div></div>)}
          </div>
          <button className="btn btn-outline btn-block" onClick={() => makeAAR(sc.id)}><i className="ph ph-file-text" />{t('sim.aar')}</button>
        </>
      )}
    </>
  );
}
