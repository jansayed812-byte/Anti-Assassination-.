import { useRef } from 'react';
import { useOps } from '../../stores/ops';
import { useT } from '../../app/hooks';
import { LayerToggles } from '../../ui/LayerToggles';
import { bgc, clock, fg, km, RISK_HUE } from '../../lib/format';
import { decideDetection, runAnalysis, uploadImage } from '../../app/actions';
import { useSession } from '../../stores/session';
import { can } from '../../app/roles';

export function AnalysisList({ showApi }: { showApi: boolean }) {
  const { t, N } = useT();
  const s = useOps();
  const allowed = can(useSession((x) => x.role), 'run:analysis');
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontWeight: 500, fontSize: 14 }}>{t('an.title')}</span>
        {showApi && <span className="api-hint">POST /api/v1/locations/analyze</span>}
      </div>
      <label className="field-label">{t('an.center')}
        <input className="field-input mono ltr" value={s.aLoc} onChange={(e) => s.set({ aLoc: e.target.value })} style={{ textAlign: 'start' }} />
      </label>
      <label className="field-label">
        <span style={{ display: 'flex', justifyContent: 'space-between' }}><span>{t('an.radius')}</span><span style={{ color: 'var(--color-text)' }}>{N(km(s.radius))} km</span></span>
        <input type="range" min={500} max={10000} step={500} value={s.radius} onChange={(e) => s.set({ radius: +e.target.value })} style={{ accentColor: '#9184d9' }} />
      </label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {(['threats', 'routes', 'resources'] as const).map((k) => (
          <button key={k} aria-pressed={s.incl[k]} onClick={() => s.set({ incl: { ...s.incl, [k]: !s.incl[k] } })}
            style={{ padding: '5px 10px', borderRadius: 6, background: s.incl[k] ? 'var(--color-accent-800)' : 'var(--color-neutral-800)', color: s.incl[k] ? 'var(--color-accent-100)' : 'var(--color-neutral-300)' }}>{t(`an.inc.${k}`)}</button>
        ))}
      </div>
      {!allowed && <span style={{ fontSize: 11.5, color: 'var(--color-neutral-400)' }}>{t('err.forbidden')}</span>}
      <button className="btn-primary-fill" disabled={!allowed || s.analysisState === 'running'} onClick={() => runAnalysis()}>
        <i className={s.analysisState === 'running' ? 'ph ph-spinner spin' : 'ph ph-play'} />{s.analysisState === 'running' ? t('an.running') : t('an.run')}
      </button>
      <div className="eyebrow" style={{ paddingTop: 6 }}>{t('an.layers')}</div>
      <LayerToggles />
    </>
  );
}

export function AnalysisInspector({ showApi }: { showApi: boolean }) {
  const { t, N } = useT();
  const s = useOps();
  const file = useRef<HTMLInputElement>(null);
  const role = useSession((x) => x.role);
  const mayValidate = can(role, 'validate:incidents');
  const a = s.analysis;
  if (s.analysisState === 'running' && !a) return <div style={{ padding: '24px 4px' }}><span className="spin ph ph-spinner" /> {t('an.running')}</div>;
  if (!a) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start', padding: '24px 4px' }}>
        <i className="ph ph-crosshair" style={{ fontSize: 28, color: 'var(--color-accent)' }} />
        <span style={{ fontSize: 15, fontWeight: 500 }}>{t('an.idleTitle')}</span>
        <span style={{ fontSize: 12.5, color: 'var(--color-neutral-400)' }}>{t('an.idleBody')}</span>
      </div>
    );
  }
  const h = RISK_HUE[a.level];
  const threats = a.threats.map((d) => s.detections.find((x) => x.id === d.id) ?? d);
  return (
    <>
      <div style={{ borderRadius: 12, padding: 14, background: 'var(--color-bg)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: s.analysisState === 'running' ? 0.6 : 1 }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}><span className="caption">{t('an.score')}</span><span style={{ fontSize: 28, fontWeight: 500, color: fg(h) }}>{N(a.score.toFixed(2))}</span></div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: bgc(h), color: fg(h) }}>{t(`riskShort.${a.level}`)}</span>
          <span style={{ fontSize: 11, color: 'var(--color-neutral-400)' }}>{t('an.conf', { u: N(a.uncertainty.toFixed(2)), c: N(Math.round(a.confidence * 100)) })}</span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="caption">{t('an.factors')} · {t('an.incidents', { n: N(a.incidents.length) })}</span>
        {(['severity', 'likelihood', 'exposure', 'data_confidence'] as const).map((k) => (
          <div key={k} style={{ display: 'grid', gridTemplateColumns: '84px 1fr 36px', gap: 8, alignItems: 'center', fontSize: 12 }}>
            <span>{t(`an.f.${k}`)}</span><span className="bar"><span style={{ width: `${a.factors[k] * 100}%` }} /></span><span style={{ textAlign: 'end' }}>{N(a.factors[k].toFixed(2))}</span>
          </div>
        ))}
      </div>
      {s.incl.threats && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="caption">{t('an.detections')}</span>
          {threats.length === 0 && <span className="muted" style={{ fontSize: 12 }}>{t('an.noThreats')}</span>}
          {threats.map((d) => (
            <div key={d.id} style={{ borderRadius: 8, padding: '9px 10px', background: 'var(--color-bg)', display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span>{d.label}</span>
                <span style={{ fontSize: 11, color: 'var(--color-neutral-400)' }}>{d.source} · {N(Math.round(d.confidence * 100))}٪ · {N(clock(d.observed_at))}</span>
              </span>
              {d.status === 'pending' && mayValidate ? (
                <>
                  <button aria-label="confirm" className="btn-accent-outline" onClick={() => decideDetection(d, 'confirm')} style={{ width: 34, height: 30, justifyContent: 'center' }}><i className="ph ph-check" /></button>
                  <button aria-label="reject" className="btn-outline" onClick={() => decideDetection(d, 'reject')} style={{ width: 34, height: 30 }}><i className="ph ph-x" /></button>
                </>
              ) : d.status === 'pending' ? <span className="caption">{t('status.active')}</span> : <span style={{ fontSize: 11, color: d.status === 'confirmed' ? fg(55) : 'var(--color-neutral-400)' }}>{d.status === 'confirmed' ? t('an.confirmed') : t('an.rejected')}</span>}
            </div>
          ))}
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(f); e.target.value = ''; }} />
          <button className="btn-outline" disabled={!can(role, 'run:analysis')} onClick={() => file.current?.click()} style={{ padding: 12, borderRadius: 8, color: 'var(--color-neutral-300)', display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}><i className="ph ph-upload-simple" />{t('an.upload')}</button>
          {showApi && <span className="api-hint">POST /api/threat/analyze · POST /api/threat/detect/image</span>}
        </div>
      )}
      {s.incl.routes && a.routes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="caption">{t('an.routes')}</span>
          {a.routes.map((r) => <div key={r.k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}><span>{r.k} · {r.name}</span><span style={{ color: fg(RISK_HUE[r.risk_level]) }}>{N(r.risk.toFixed(2))}</span></div>)}
        </div>
      )}
      {s.incl.resources && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="caption">{t('an.resources')}</span>
          {a.resources.length === 0 && <span className="muted" style={{ fontSize: 12 }}>{t('an.noResources')}</span>}
          {a.resources.map((r) => (
            <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '4px 0' }}>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><i className={`ph ph-${r.icon}`} style={{ color: 'var(--color-neutral-400)' }} />{r.name}</span>
              <span style={{ color: 'var(--color-neutral-400)' }}>{N(km(r.distance_m ?? 0))} km</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--color-neutral-500)', lineHeight: 1.7 }}>{t('an.provenance', { src: a.provenance.join('، ') || '—', t: N(clock(a.analyzed_at)) })}</div>
    </>
  );
}
