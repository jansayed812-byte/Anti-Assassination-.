import { useEffect, useRef, useState } from 'react';
import { useOps } from '../../stores/ops';
import { useT } from '../../app/hooks';
import { RISK_CHIP, RISK_VAR } from '../../lib/palette';
import { decideDetection, loadZone, runAnalysis, uploadImage } from '../../app/actions';
import { useSession } from '../../stores/session';
import { can } from '../../app/roles';
import type { BlindSpot, BlindType, RankedSite, RiskFactors } from '../../api/types';

const BS_TYPES: BlindType[] = ['network', 'monitoring', 'access'];
const BS_ICON: Record<BlindType, string> = { network: 'wifi-slash', monitoring: 'eye-slash', access: 'prohibit' };

function ScoreBadge({ score, level }: { score: number; level: RankedSite['level'] }) {
  const { F } = useT();
  return <span className="num" style={{ minWidth: 44, textAlign: 'center', padding: '2px 8px', borderRadius: 6, fontWeight: 700, fontSize: 12, background: `color-mix(in srgb, ${RISK_VAR[level]} 22%, transparent)`, color: RISK_VAR[level] }}>{F(score, 2)}</span>;
}

export function AnalysisList({ showApi }: { showApi: boolean }) {
  const { t, x, N, D, F } = useT();
  const s = useOps();
  const allowed = can(useSession((st) => st.role), 'run:analysis');
  const zones = s.blindspots.filter((z) => s.bsFilter === 'all' || z.type === s.bsFilter);
  const sites = s.anTab === 'dangerous' ? s.extremes?.dangerous ?? [] : s.extremes?.safest ?? [];
  const area = zones.reduce((a, z) => a + z.area_km2, 0);
  return (
    <>
      <div className="row-between"><h3>{t('an.risk')}</h3>{showApi && <span className="api-hint">GET /api/v1/risk/extremes</span>}</div>
      <div role="tablist" className="seg full">
        {(['dangerous', 'safest', 'blind', 'area'] as const).map((k) => (
          <button key={k} role="tab" aria-selected={s.anTab === k} onClick={() => s.set({ anTab: k })}>{t(k === 'dangerous' ? 'an.dangerous' : k === 'safest' ? 'an.safest' : k === 'blind' ? 'an.blind' : 'an.area')}</button>
        ))}
      </div>

      {(s.anTab === 'dangerous' || s.anTab === 'safest') && (
        <>
          <span className="caption">{t('an.rankHint')}</span>
          {sites.map((site) => {
            const on = (s.anSel?.kind === 'dangerous' || s.anSel?.kind === 'safest') && s.anSel.kind === s.anTab && s.anSel.rank === site.rank;
            return (
              <button key={site.rank} className="list-item" aria-current={!!on} data-testid={`${s.anTab}-${site.rank}`}
                onClick={() => { s.set({ anSel: { kind: s.anTab as 'dangerous' | 'safest', rank: site.rank }, sheet: 'insp' }); s.flyTo(site, 15.5); }}>
                <span className="row-between">
                  <span className="row" style={{ minWidth: 0 }}><span className="num" style={{ width: 22, height: 22, flex: 'none', borderRadius: s.anTab === 'dangerous' ? 5 : 11, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, background: s.anTab === 'dangerous' ? 'var(--risk-critical)' : 'var(--success)', color: '#fff' }}>{N(site.rank)}</span>
                    <span className="col" style={{ gap: 0, minWidth: 0 }}>
                      <span className="truncate">{site.nearest ? x(site.nearest.name) : `${F(site.lat, 4)}, ${F(site.lon, 4)}`}</span>
                      <span className="caption">{site.nearest ? D(site.nearest.distance_m) : ''}{site.nearest ? ' · ' : ''}{t(`risk.${site.level}`)}</span>
                    </span></span>
                  <ScoreBadge score={site.score} level={site.level} />
                </span>
              </button>
            );
          })}
        </>
      )}

      {s.anTab === 'blind' && (
        <>
          <div className="row wrap" style={{ gap: 6 }}>
            {(['all', ...BS_TYPES] as const).map((k) => (
              <button key={k} className={`btn btn-sm ${s.bsFilter === k ? 'on' : ''}`} aria-pressed={s.bsFilter === k} onClick={() => s.set({ bsFilter: k })}>
                {k !== 'all' && <i className={`ph ph-${BS_ICON[k]}`} />}{k === 'all' ? t('bs.all') : t(`bs.type.${k}`)}
              </button>
            ))}
          </div>
          <span className="caption">{t('bs.count', { n: zones.length, a: t('unit.km2', { n: F(area, 1) }) })}</span>
          {zones.length === 0 && <span className="muted">{t('bs.none')}</span>}
          {zones.map((z) => (
            <button key={z.id} className="list-item" aria-current={s.anSel?.kind === 'zone' && s.anSel.id === z.id} data-testid={`zone-${z.id}`}
              onClick={() => { s.set({ anSel: { kind: 'zone', id: z.id }, sheet: 'insp' }); s.flyTo(z.centroid, 14.5); }}>
              <span className="row-between">
                <span className="row"><span className="chip chip-hazard"><i className={`ph ph-${BS_ICON[z.type]}`} /></span><b className="mono ltr">{z.id}</b></span>
                <ScoreBadge score={z.max_risk} level={z.max_risk >= 0.6 ? 'critical' : z.max_risk >= 0.35 ? 'high' : z.max_risk >= 0.1 ? 'medium' : 'low'} />
              </span>
              <span className="caption">{x(z.label)} · {t('unit.km2', { n: F(z.area_km2, 2) })}{z.routes.length ? ` · ${t('bs.routes')}: ${N(z.routes.length)}` : ''}</span>
            </button>
          ))}
        </>
      )}

      {s.anTab === 'area' && (
        <>
          <span className="caption">{t('an.pickMap')}</span>
          <label className="field">{t('an.center')}
            <input className="input mono ltr" value={s.aLoc} onChange={(e) => s.set({ aLoc: e.target.value })} />
          </label>
          <label className="field">
            <span className="row-between"><span>{t('an.radius')}</span><b style={{ color: 'var(--text)' }}>{D(s.radius)}</b></span>
            <input type="range" min={300} max={8000} step={100} value={s.radius} onChange={(e) => s.set({ radius: +e.target.value })} aria-label={t('an.radius')} />
          </label>
          <div className="row wrap" style={{ gap: 6 }}>
            {(['threats', 'routes', 'resources'] as const).map((k) => (
              <button key={k} className={`btn btn-sm ${s.incl[k] ? 'on' : ''}`} aria-pressed={s.incl[k]} onClick={() => s.set({ incl: { ...s.incl, [k]: !s.incl[k] } })}>{t(`an.inc.${k}`)}</button>
            ))}
          </div>
          {!allowed && <span className="caption">{t('err.forbidden')}</span>}
          <button className="btn btn-primary btn-block" disabled={!allowed || s.analysisState === 'running'} onClick={() => runAnalysis()}>
            <i className={s.analysisState === 'running' ? 'ph ph-spinner spin' : 'ph ph-play'} />{s.analysisState === 'running' ? t('an.running') : t('an.run')}
          </button>
          {showApi && <span className="api-hint">POST /api/v1/locations/analyze</span>}
        </>
      )}
    </>
  );
}

function Factors({ f }: { f: RiskFactors }) {
  const { t, F, D, N } = useT();
  const bars: Array<[string, number]> = [[t('an.f.threat'), f.threat], [t('an.f.severity'), f.severity], [t('an.f.likelihood'), f.likelihood], [t('an.f.exposure'), f.exposure], [t('an.f.confidence'), f.confidence], [t('an.f.context'), f.context]];
  return (
    <div className="col" style={{ gap: 6 }}>
      <span className="caption">{t('an.factors')}</span>
      {bars.map(([l, v]) => (
        <div key={l} style={{ display: 'grid', gridTemplateColumns: '112px 1fr 38px', gap: 8, alignItems: 'center', fontSize: 12 }}>
          <span>{l}</span><span className="bar"><span style={{ width: `${Math.min(100, v * 100)}%` }} /></span><span className="num" style={{ textAlign: 'end' }}>{F(v, 2)}</span>
        </div>
      ))}
      <div className="grid-2">
        <div className="tile"><div className="caption">{t('an.f.support')}</div><div className="v">{D(f.support_m)}</div></div>
        <div className="tile"><div className="caption">{t('an.f.gap')}</div><div className="v" style={{ color: f.coverage_gap ? 'var(--warning)' : 'var(--success)' }}>{f.coverage_gap ? t('yes') : t('no')}</div></div>
      </div>
      {f.incidents.length > 0 && <span className="caption">{t('an.f.incidents')}: <span className="mono ltr">{f.incidents.join(', ')}</span> ({N(f.incidents.length)})</span>}
    </div>
  );
}

function SiteDetail({ site, kind }: { site: RankedSite; kind: 'dangerous' | 'safest' }) {
  const { t, x, D, F, N } = useT();
  const s = useOps();
  return (
    <>
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div className="col" style={{ gap: 0 }}><span className="caption">{t(kind === 'dangerous' ? 'an.dangerous' : 'an.safest')} · #{N(site.rank)}</span>
          <h2 style={{ fontSize: 18 }}>{site.nearest ? t('an.near', { name: x(site.nearest.name), d: D(site.nearest.distance_m) }) : t('an.score')}</h2></div>
        <span className={`chip ${RISK_CHIP[site.level]}`}>{t(`risk.${site.level}`)}</span>
      </div>
      <div className="card-2 row-between"><span className="col" style={{ gap: 0 }}><span className="caption">{t('an.score')}</span><span className="kpi" style={{ color: RISK_VAR[site.level] }}>{F(site.score, 2)}</span></span>
        <span className="mono ltr caption">{F(site.lat, 6)}, {F(site.lon, 6)}<br />H3 {site.cell}</span></div>
      <Factors f={site.factors} />
      <button className="btn" onClick={() => s.flyTo(site, 16)}><i className="ph ph-crosshair-simple" />{t('locate')}</button>
    </>
  );
}

function ZoneDetail({ zone }: { zone: BlindSpot }) {
  const { t, x, D, F, N, date } = useT();
  const s = useOps();
  const [full, setFull] = useState<BlindSpot | null>(null);
  useEffect(() => { let alive = true; void loadZone(zone.id).then((z) => { if (alive) setFull(z); }); return () => { alive = false; }; }, [zone.id, zone.cell_count]);
  const level = zone.max_risk >= 0.6 ? 'critical' : zone.max_risk >= 0.35 ? 'high' : zone.max_risk >= 0.1 ? 'medium' : 'low';
  return (
    <>
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div className="col" style={{ gap: 0 }}><span className="caption">{x(zone.label)}</span><h2 style={{ fontSize: 18 }}>{t('bs.title', { id: zone.id })}</h2></div>
        <span className="chip chip-hazard"><i className={`ph ph-${BS_ICON[zone.type]}`} />{t(`bs.type.${zone.type}`)}</span>
      </div>
      <div className="grid-2">
        <div className="tile"><div className="caption">{t('bs.area')}</div><div className="v">{t('unit.km2', { n: F(zone.area_km2, 2) })}</div></div>
        <div className="tile"><div className="caption">{t('bs.cells')}</div><div className="v">{N(full?.cells?.length ?? zone.cell_count)}</div></div>
        <div className="tile"><div className="caption">{t('bs.maxRisk')}</div><div className="v" style={{ color: RISK_VAR[level] }}>{F(zone.max_risk, 2)}</div></div>
        <div className="tile"><div className="caption">{t('bs.avgRisk')}</div><div className="v">{F(zone.avg_risk, 2)}</div></div>
      </div>
      <div className="tile"><div className="caption">{t('bs.centroid')}</div><div className="mono ltr" style={{ fontSize: 12.5 }}>{F(zone.centroid.lat, 6)}, {F(zone.centroid.lon, 6)}</div></div>
      <div className="card-2"><span className="caption">{t('bs.detail')}</span><span>{x(zone.detail)}</span></div>
      <div className="card-2 edge" style={{ '--edge': 'var(--accent)' } as React.CSSProperties}><span className="caption">{t('bs.mitigation')}</span><b>{x(zone.mitigation)}</b></div>
      <div className="col" style={{ gap: 4 }}>
        <span className="caption">{t('bs.routes')}</span>
        {zone.routes.length === 0 ? <span className="muted" style={{ fontSize: 12 }}>{t('bs.noRoutes')}</span> : zone.routes.map((r) => (
          <button key={`${r.plan}-${r.route}`} className="list-item" onClick={() => s.set({ planSel: r.plan, routeSel: r.route as never })}><span>{t('bs.crossing', { plan: r.plan, k: r.route, len: D(r.length_m) })}</span></button>
        ))}
      </div>
      {zone.nearest_support && <div className="tile"><div className="caption">{t('bs.support')}</div><div>{x(zone.nearest_support.name)} · {D(zone.nearest_support.distance_m)}</div></div>}
      <span className="caption">{t('bs.firstSeen')}: {date(zone.first_seen)}</span>
      <button className="btn" onClick={() => s.flyTo(zone.centroid, 15)}><i className="ph ph-crosshair-simple" />{t('locate')}</button>
    </>
  );
}

export function AnalysisInspector({ showApi }: { showApi: boolean }) {
  const { t, x, F, D, clock, lang } = useT();
  const s = useOps();
  const file = useRef<HTMLInputElement>(null);
  const role = useSession((st) => st.role);
  const mayValidate = can(role, 'validate:incidents');
  const sel = s.anSel;
  if (sel?.kind === 'dangerous' || sel?.kind === 'safest') {
    const site = (sel.kind === 'dangerous' ? s.extremes?.dangerous : s.extremes?.safest)?.find((q) => q.rank === sel.rank);
    if (site) return <SiteDetail site={site} kind={sel.kind} />;
  }
  if (sel?.kind === 'zone') {
    const zone = s.blindspots.find((z) => z.id === sel.id);
    if (zone) return <ZoneDetail zone={zone} />;
  }
  const a = s.analysis;
  if (s.analysisState === 'running' && !a) return <div className="empty"><span className="spin ph ph-spinner" /> {t('an.running')}</div>;
  if (!a || sel?.kind !== 'area') {
    return (
      <div className="empty">
        <i className="ph ph-crosshair" style={{ fontSize: 30, color: 'var(--accent)' }} />
        <b style={{ fontSize: 15, color: 'var(--text)' }}>{t('an.idleTitle')}</b>
        <span style={{ fontSize: 12.5 }}>{t('an.idleBody')}</span>
      </div>
    );
  }
  const threats = a.threats.map((d) => s.detections.find((q) => q.id === d.id) ?? d);
  return (
    <>
      <div className="card-2 row-between" style={{ opacity: s.analysisState === 'running' ? 0.6 : 1 }}>
        <div className="col" style={{ gap: 0 }}><span className="caption">{t('an.areaScore')}</span><span className="kpi" style={{ color: RISK_VAR[a.level] }}>{F(a.score, 2)}</span></div>
        <div className="col" style={{ alignItems: 'flex-end', gap: 4 }}>
          <span className={`chip ${RISK_CHIP[a.level]}`}>{t(`risk.${a.level}`)}</span>
          <span className="caption">{t('an.conf', { u: F(a.uncertainty, 2), c: Math.round(a.confidence * 100) })}</span>
          <span className="caption">{t('an.cells', { n: a.cells.count, max: F(a.cells.max, 2) })}</span>
        </div>
      </div>
      {a.point && <Factors f={a.point.factors} />}
      <span className="caption">{t('an.incidents', { n: a.incidents.length })}</span>
      {s.incl.threats && (
        <div className="col" style={{ gap: 6 }}>
          <span className="caption">{t('an.detections')}</span>
          {threats.length === 0 && <span className="muted" style={{ fontSize: 12 }}>{t('an.noThreats')}</span>}
          {threats.map((d) => (
            <div key={d.id} className="card-2" style={{ flexDirection: 'row', alignItems: 'center', padding: '8px 10px' }}>
              <span className="col" style={{ gap: 2, flex: 1 }}><span>{x(d.label)}</span><span className="caption">{d.source} · {t('unit.pct', { n: Math.round(d.confidence * 100) })} · {clock(d.observed_at)}</span></span>
              {d.status === 'pending' && mayValidate ? (
                <>
                  <button aria-label={t('an.confirmed')} className="btn btn-outline btn-icon btn-sm" onClick={() => decideDetection(d, 'confirm')}><i className="ph ph-check" /></button>
                  <button aria-label={t('an.rejected')} className="btn btn-icon btn-sm" onClick={() => decideDetection(d, 'reject')}><i className="ph ph-x" /></button>
                </>
              ) : d.status === 'pending' ? <span className="caption">{t('status.active')}</span> : <span className={`chip ${d.status === 'confirmed' ? 'chip-danger' : ''}`}>{d.status === 'confirmed' ? t('an.confirmed') : t('an.rejected')}</span>}
            </div>
          ))}
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(f); e.target.value = ''; }} />
          <button className="btn" disabled={!can(role, 'run:analysis')} onClick={() => file.current?.click()}><i className="ph ph-upload-simple" />{t('an.upload')}</button>
          {showApi && <span className="api-hint">POST /api/threat/analyze · POST /api/threat/detect/image</span>}
        </div>
      )}
      {a.blind_spots.length > 0 && (
        <div className="col" style={{ gap: 4 }}>
          <span className="caption">{t('an.blindNear')}</span>
          {a.blind_spots.slice(0, 5).map((z) => <button key={z.id} className="list-item" onClick={() => s.set({ anTab: 'blind', anSel: { kind: 'zone', id: z.id } })}><span className="row-between"><span><span className="mono ltr">{z.id}</span> · {x(z.label)}</span><span className="caption">{D(z.distance_m)}</span></span></button>)}
        </div>
      )}
      {s.incl.routes && a.routes.length > 0 && (
        <div className="col" style={{ gap: 4 }}>
          <span className="caption">{t('an.routes')}</span>
          {a.routes.map((r) => <div key={r.k} className="row-between" style={{ fontSize: 12.5 }}><span>{r.k} · {x(r.label)}</span><span style={{ color: RISK_VAR[r.risk_level] }} className="num">{F(r.max_risk, 2)}</span></div>)}
        </div>
      )}
      {s.incl.resources && (
        <div className="col" style={{ gap: 4 }}>
          <span className="caption">{t('an.resources')}</span>
          {a.resources.length === 0 && <span className="muted" style={{ fontSize: 12 }}>{t('an.noResources')}</span>}
          {a.resources.slice(0, 8).map((r) => (
            <button key={r.id} className="list-item" onClick={() => s.flyTo(r, 16)} style={{ padding: '5px 8px' }}>
              <span className="row-between"><span className="row"><i className={`ph ph-${r.icon}`} style={{ color: 'var(--text-3)' }} />{x(r.name)}</span><span className="caption">{D(r.distance_m ?? 0)}</span></span>
            </button>
          ))}
        </div>
      )}
      <span className="caption">{t('an.provenance', { src: a.provenance.join(lang === 'en' ? ', ' : '، ') || '—', t: clock(a.analyzed_at) })}</span>
    </>
  );
}
