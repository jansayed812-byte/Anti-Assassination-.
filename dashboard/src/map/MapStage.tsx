import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOps, type Mode } from '../stores/ops';
import { useT } from '../app/hooks';
import { OpsScene, type SceneData } from './scene';
import { toXZ, type XZ } from './projection';
import { RISK_HUE, sol } from '../lib/format';
import { AlertCard } from '../ui/AlertCard';
import { LayerToggles } from '../ui/LayerToggles';
import type { PaceKey } from '../api/types';

let current: OpsScene | null = null;
export const flyToUnit = (id: string) => current?.flyTo(id);

function alongPath(pts: XZ[], t: number): XZ {
  const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  let target = Math.max(0, Math.min(1, t)) * seg.reduce((s, d) => s + d, 0);
  for (let i = 0; i < seg.length; i++) {
    if (target <= seg[i] || i === seg.length - 1) {
      const k = seg[i] ? Math.min(1, target / seg[i]) : 0;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k];
    }
    target -= seg[i];
  }
  return pts[pts.length - 1];
}

export function MapStage({ mode, narrow, compact }: { mode: Mode; narrow: boolean; compact: boolean }) {
  const { t, N } = useT();
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState<'loading' | 'ok' | 'failed'>('loading');
  const s = useOps();
  const { view3d, layers, layersOpen, sel, alerts, liveTab } = s;

  useEffect(() => {
    if (!ref.current) return;
    try {
      current = new OpsScene(ref.current, (id) => {
        useOps.getState().set({ sel: id, liveTab: 'units', sheet: 'insp', sheetOpen: true });
        navigate('/live');
        flyToUnit(id);
      });
      setReady('ok');
    } catch (e) { console.error(e); setReady('failed'); }
    return () => { current?.dispose(); current = null; };
  }, [navigate]);

  const plan = s.plans.find((p) => p.id === (mode === 'planning' ? s.planSel : undefined)) ?? s.plans.find((p) => p.status === 'running');
  const activeRoute: PaceKey | null = (mode === 'planning' ? (s.previewRoute as PaceKey | null) ?? plan?.active_route : plan?.active_route) ?? null;
  const simActive = mode === 'sim' && !!s.sim?.scenario_id;

  const data: SceneData = useMemo(() => {
    const routes = (plan?.pace ?? []).map((r) => ({ k: r.k, path: r.path.map(toXZ) }));
    const active = routes.find((r) => r.k === activeRoute);
    const simT = s.sim?.progress ?? 0;
    const units = s.unitOrder.map((id) => s.units[id]).filter((u) => u?.telemetry).map((u) => {
      let xz = toXZ(u.telemetry!);
      if (simActive && u.id === 'alpha' && active) xz = alongPath(active.path, 0.05 + (simT / 100) * 0.9);
      const warn = u.comms === 'lost' || u.telemetry!.degraded;
      return {
        id: u.id, kind: (u.icon === 'drone' ? 'drone' : u.icon === 'car-profile' ? 'car' : 'team') as 'drone' | 'car' | 'team', xz,
        cep_m: u.telemetry!.cep95_m, color: warn ? 0xd2a93f : u.icon === 'drone' ? 0x8fb8ff : 0xb5abfc,
        label: u.telemetry!.mode === 'Dead-reckoning' ? `${u.name} · DR` : u.name,
      };
    });
    const alpha = units.find((u) => u.id === 'alpha');
    const hostileOn = simActive && simT > 5 && !!s.sim?.events.some((e) => e.level === 'critical' || e.level === 'error');
    const k = simT / 100;
    return {
      units, routes, activeRoute,
      routeMode: mode === 'planning' ? 'all' : mode === 'analysis' ? 'hidden' : 'dim',
      cells: s.cells.map((c) => ({ id: c.id, xz: toXZ(c), level: c.level, score: c.score })),
      checkpoints: mode === 'analysis' ? [] : (plan?.pace.find((r) => r.k === activeRoute)?.checkpoints ?? []).filter((c) => c.id !== 'DEST').map(toXZ),
      resources: s.resources.map((r) => ({ id: r.id, xz: toXZ(r), label: r.name, color: r.icon === 'house-line' ? 0x6cbf7f : r.icon === 'first-aid' ? 0x8fb8ff : 0xb5abfc })),
      threats: s.incidents.filter((i) => i.severity === 'critical' && i.location).map((i) => ({ id: i.incident_id, xz: toXZ(i.location!), label: `${t('risk.critical')} · ${N(Math.round(i.confidence * 100))}٪` })),
      hostile: hostileOn && alpha ? [-5 + (alpha.xz[0] + 5) * k * 0.8, -5 + (alpha.xz[1] + 5) * k * 0.8] : null,
      sel: mode === 'live' ? sel : null, layers, riskOpacity: mode === 'analysis' ? 0.62 : 0.28,
    };
  }, [s.units, s.unitOrder, s.cells, s.incidents, s.resources, s.sim, plan, activeRoute, mode, sel, layers, simActive, t, N]);

  useEffect(() => { current?.update(data); }, [data, ready]);
  useEffect(() => { current?.setView3d(view3d); }, [view3d, ready]);
  useEffect(() => {
    if (mode === 'analysis') {
      const [lat, lon] = s.aLoc.split(',').map((x) => parseFloat(x));
      current?.frame(Number.isFinite(lat) && Number.isFinite(lon) ? toXZ({ lat, lon }) : [-10, 0], 150);
    } else if (mode === 'planning' || mode === 'sim') current?.frame([0, 0], 240);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, ready]);

  const open = alerts.filter((a) => a.status === 'active' || a.status === 'escalated').sort((a, b) => ['critical', 'error', 'warning', 'info'].indexOf(a.level) - ['critical', 'error', 'warning', 'info'].indexOf(b.level));
  const floatN = compact || narrow ? 1 : 2;
  const showFloat = open.length > 0 && !(mode === 'live' && liveTab === 'alerts' && !compact);
  const ring = (on: boolean) => (on ? 'inset 0 0 0 1px var(--color-accent)' : 'none');
  const fgc = (on: boolean) => (on ? 'var(--color-accent-200)' : 'var(--color-text)');
  const ctrl: React.CSSProperties = { width: 40, height: 36, background: 'transparent', color: 'var(--color-text)' };

  return (
    <>
      <div ref={ref} style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'absolute', top: 12, insetInlineStart: 12, display: 'flex', flexDirection: 'column', gap: 6, zIndex: 3 }}>
        <div style={{ display: 'flex', flexDirection: 'column', borderRadius: 8, overflow: 'hidden', background: 'var(--color-surface)', boxShadow: 'var(--shadow-sm)' }}>
          <button onClick={() => s.set({ view3d: true })} style={{ ...ctrl, color: fgc(view3d), boxShadow: ring(view3d), borderRadius: 8 }}>3D</button>
          <button onClick={() => s.set({ view3d: false })} style={{ ...ctrl, color: fgc(!view3d), boxShadow: ring(!view3d), borderRadius: 8 }}>2D</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', borderRadius: 8, overflow: 'hidden', background: 'var(--color-surface)', boxShadow: 'var(--shadow-sm)' }}>
          <button aria-label="zoom in" onClick={() => current?.zoom(0.8)} style={ctrl}><i className="ph ph-plus" /></button>
          <button aria-label="zoom out" onClick={() => current?.zoom(1.25)} style={ctrl}><i className="ph ph-minus" /></button>
          <button aria-label="reset view" onClick={() => current?.resetView()} style={ctrl}><i className="ph ph-compass" /></button>
        </div>
        <button aria-label="layers" onClick={() => s.set({ layersOpen: !layersOpen })} style={{ width: 40, height: 40, borderRadius: 8, background: 'var(--color-surface)', boxShadow: layersOpen ? 'inset 0 0 0 1px var(--color-accent)' : 'var(--shadow-sm)' }}><i className="ph ph-stack" style={{ fontSize: 18 }} /></button>
      </div>
      {layersOpen && (
        <div style={{ position: 'absolute', top: 12, insetInlineStart: 60, zIndex: 4, width: 220, padding: 10, borderRadius: 12, background: 'var(--color-surface)', boxShadow: 'var(--shadow-md)', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <LayerToggles />
        </div>
      )}
      {showFloat && (
        <div style={{ position: 'absolute', top: 12, insetInlineEnd: 12, zIndex: 3, width: narrow ? 'min(280px, calc(100% - 76px))' : 'min(320px, calc(100% - 80px))', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {open.slice(0, floatN).map((a) => <AlertCard key={a.id} alert={a} variant="float" />)}
          {open.length > floatN && (
            <button onClick={() => { s.set({ liveTab: 'alerts', sheet: 'list', sheetOpen: true, listOpen: true }); navigate('/live'); }} style={{ alignSelf: 'flex-start', background: 'var(--color-surface)', color: 'var(--color-neutral-300)', padding: '5px 10px', borderRadius: 6, fontSize: 12 }}>
              {t('alert.more', { n: N(open.length - floatN) })}
            </button>
          )}
        </div>
      )}
      <div style={{ position: 'absolute', bottom: 12, insetInlineStart: 12, zIndex: 3, display: 'flex', gap: 8, alignItems: 'center', whiteSpace: 'nowrap', padding: '6px 10px', borderRadius: 8, background: 'color-mix(in srgb, var(--color-surface) 90%, transparent)', fontSize: 11, color: 'var(--color-neutral-300)' }}>
        {(['low', 'medium', 'high', 'critical'] as const).map((l) => (
          <span key={l} style={{ display: 'flex', gap: 4, alignItems: 'center' }}><span style={{ width: 9, height: 9, borderRadius: 2, background: sol(RISK_HUE[l]) }} />{t(`riskShort.${l}`)}</span>
        ))}
      </div>
      <div className="mono" style={{ position: 'absolute', bottom: 12, insetInlineEnd: 12, zIndex: 3, fontSize: 10.5, whiteSpace: 'nowrap', color: 'var(--color-neutral-400)', padding: '5px 9px', borderRadius: 6, background: 'color-mix(in srgb, var(--color-surface) 90%, transparent)' }}>
        <span dir="ltr">{view3d ? '3D' : '2D'}{narrow ? ' · offline' : ` · ${t('map.footer', { lat: '35.6892', lon: '51.3890' })}`}</span>
      </div>
      {ready !== 'ok' && (
        <div className="mono" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--color-neutral-500)', fontSize: 11 }}>
          {ready === 'failed' ? t('map.webgl') : t('map.loading')}
        </div>
      )}
    </>
  );
}
