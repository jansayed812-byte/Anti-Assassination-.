import { useOps } from '../../stores/ops';
import { useT } from '../../app/hooks';
import { fg, SEV } from '../../lib/format';
import { makeAAR, simReset, simSpeed, simToggle } from '../../app/actions';
import { useSession } from '../../stores/session';
import { can } from '../../app/roles';

export function SimList({ showApi }: { showApi: boolean }) {
  const { t, N } = useT();
  const s = useOps();
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontWeight: 500, fontSize: 14 }}>{t('sim.title')}</span>
        {showApi && <span className="api-hint">GET /api/v1/scenarios</span>}
      </div>
      {s.scenarios.map((sc) => (
        <button key={sc.id} className="hov-accent" onClick={() => s.set({ scenSel: sc.id, sheet: 'insp' })}
          style={{ textAlign: 'start', padding: 10, borderRadius: 8, background: sc.id === s.scenSel ? 'var(--color-accent-900)' : 'transparent', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontWeight: 500 }}>{sc.name}{s.sim?.scenario_id === sc.id && s.sim.running ? ' ●' : ''}</span>
            <span style={{ fontSize: 11, color: 'var(--color-neutral-400)', whiteSpace: 'nowrap' }}>{t('sim.minutes', { m: N(sc.nominal_minutes ?? Math.round(sc.duration_ms / 60000)) })}</span>
          </span>
          <span style={{ display: 'flex', gap: 6, fontSize: 11 }}><span style={{ padding: '1px 7px', borderRadius: 5, background: 'var(--color-neutral-800)' }}>{sc.category}</span><span style={{ color: 'var(--color-neutral-400)' }}>{sc.difficulty}</span></span>
        </button>
      ))}
    </>
  );
}

export function SimInspector({ showApi }: { showApi: boolean }) {
  const { t, N } = useT();
  const s = useOps();
  const allowed = can(useSession((x) => x.role), 'run:scenarios');
  const sc = s.scenarios.find((x) => x.id === s.scenSel) ?? s.scenarios[0];
  if (!sc) return <span className="muted">{t('loading')}</span>;
  const st = s.sim;
  const mine = st?.scenario_id === sc.id;
  const other = st?.scenario_id && !mine && st.running ? s.scenarios.find((x) => x.id === st.scenario_id) : undefined;
  const progress = mine ? st!.progress : 0;
  const running = mine && st!.running;
  const finished = mine && st!.finished;
  const label = running ? t('sim.pause') : finished ? t('sim.finished') : progress > 0 ? t('sim.resume') : t('sim.run');
  const events = mine ? [...st!.events].reverse() : [];
  const speed = st?.speed ?? 1;
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span className="caption">{sc.category}</span>
        <span style={{ fontSize: 17, fontWeight: 500 }}>{sc.name}</span>
        <span style={{ fontSize: 12, color: 'var(--color-neutral-400)', marginTop: 4 }}>{sc.description}</span>
      </div>
      {other && <span style={{ fontSize: 12, color: fg(90) }}>{t('sim.otherActive', { name: other.name })}</span>}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button className="btn-primary-fill" style={{ flex: 1 }} disabled={finished || !allowed} onClick={() => simToggle(sc)}><i className={`ph ph-${running ? 'pause' : 'play'}`} />{label}</button>
        <button aria-label="reset" className="btn-outline" disabled={!allowed} onClick={() => simReset()} style={{ width: 40, height: 38, borderRadius: 8 }}><i className="ph ph-arrow-counter-clockwise" /></button>
        <div style={{ display: 'flex', borderRadius: 8, boxShadow: 'inset 0 0 0 1px var(--color-divider)' }}>
          {[1, 2, 4].map((x) => (
            <button key={x} disabled={!allowed} onClick={() => simSpeed(x)} style={{ padding: '8px 9px', borderRadius: 8, color: speed === x ? 'var(--color-accent-200)' : 'var(--color-text)', boxShadow: speed === x ? 'inset 0 0 0 1px var(--color-accent)' : 'none' }}>×{N(x)}</button>
          ))}
        </div>
      </div>
      {showApi && <span className="api-hint">POST /api/v1/scenarios/{sc.id}/run · WS env/sim</span>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-neutral-400)' }}><span>{t('sim.progress')}</span><span>{N(Math.round(progress))}%</span></div>
        <div className="bar" style={{ height: 4 }}><span style={{ width: `${progress}%`, transition: 'width 1s linear' }} /></div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="caption">{t('sim.events')}</span>
        {events.length === 0 && <span style={{ fontSize: 12, color: 'var(--color-neutral-500)' }}>{t('sim.noEvents')}</span>}
        {events.map((e, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '52px 1fr', gap: 8, fontSize: 12 }}>
            <span className="mono ltr" style={{ color: fg(SEV[e.level].h), textAlign: 'start' }}>{N(`T+${Math.round(((e.t_ms / sc.duration_ms) * (sc.nominal_minutes ?? 1)))}m`)}</span><span>{e.message}</span>
          </div>
        ))}
      </div>
      {finished && sc.metrics && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {(Object.keys(sc.metrics) as Array<keyof typeof sc.metrics>).map((k) => <div key={k} className="tile"><div className="caption">{t(`sim.mt.${k}`)}</div><div style={{ fontSize: 16, fontWeight: 500 }}>{sc.metrics![k]}</div></div>)}
          </div>
          <button className="btn-accent-outline" onClick={() => makeAAR(sc.id)} style={{ padding: 10, borderRadius: 8, justifyContent: 'center' }}><i className="ph ph-file-text" />{t('sim.aar')}</button>
        </>
      )}
    </>
  );
}
