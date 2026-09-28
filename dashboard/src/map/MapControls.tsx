import type { MutableRefObject } from 'react';
import type { Map as MLMap } from 'maplibre-gl';
import { useOps, type Layers, type Mode } from '../stores/ops';
import { useT } from '../app/hooks';
import type { LatLon } from '../api/types';
import type { TKey } from '../i18n';

const LAYER_DEFS: Array<[keyof Layers, string, TKey]> = [
  ['risk', 'hexagon', 'layer.risk'], ['extremes', 'ranking', 'layer.extremes'], ['blind', 'eye-slash', 'layer.blind'],
  ['routes', 'path', 'layer.routes'], ['units', 'users-three', 'layer.units'], ['pois', 'first-aid', 'layer.pois'],
  ['coverage', 'broadcast', 'layer.coverage'], ['buildings', 'buildings', 'layer.buildings'], ['terrain', 'mountains', 'layer.terrain'],
];

export function LayerToggles({ only }: { only?: Array<keyof Layers> }) {
  const { t } = useT();
  const layers = useOps((s) => s.layers);
  const set = useOps((s) => s.set);
  return (
    <>
      {LAYER_DEFS.filter(([k]) => !only || only.includes(k)).map(([k, icon, label]) => (
        <button key={k} role="switch" aria-checked={layers[k]} className="menu-item" onClick={() => set({ layers: { ...layers, [k]: !layers[k] } })}>
          <span className="row"><i className={`ph ph-${icon}`} style={{ color: 'var(--text-3)' }} />{t(label)}</span>
          <span className="switch" />
        </button>
      ))}
    </>
  );
}

export function MapControls({ map, base, compact, mode, onFit, cursor, cityName }: {
  map: MutableRefObject<MLMap | null>; base: 'loading' | 'online' | 'offline' | 'failed'; compact: boolean; mode: Mode; onFit: () => void;
  cursor: LatLon | null; cityName: string;
}) {
  const { t, F } = useT();
  const s = useOps();
  const btn: React.CSSProperties = { width: 38, height: 36, display: 'grid', placeItems: 'center', color: 'var(--text)' };
  const legendRisk = mode !== 'assets';
  return (
    <>
      <div style={{ position: 'absolute', top: 12, insetInlineStart: 12, zIndex: 3, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="map-panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <button aria-pressed={s.view3d} onClick={() => s.set({ view3d: true })} style={{ ...btn, fontWeight: 600, fontSize: 12, color: s.view3d ? 'var(--accent)' : 'var(--text-2)' }}>3D</button>
          <button aria-pressed={!s.view3d} onClick={() => s.set({ view3d: false })} style={{ ...btn, fontWeight: 600, fontSize: 12, color: !s.view3d ? 'var(--accent)' : 'var(--text-2)' }}>2D</button>
        </div>
        <div className="map-panel" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <button aria-label={t('map.zoomIn')} title={t('map.zoomIn')} onClick={() => map.current?.zoomIn()} style={btn}><i className="ph ph-plus" /></button>
          <button aria-label={t('map.zoomOut')} title={t('map.zoomOut')} onClick={() => map.current?.zoomOut()} style={btn}><i className="ph ph-minus" /></button>
          <button aria-label={t('map.compass')} title={t('map.compass')} onClick={() => map.current?.easeTo({ bearing: 0, duration: 500 })} style={btn}><i className="ph ph-compass" /></button>
          <button aria-label={t('map.reset')} title={t('map.reset')} onClick={onFit} style={btn} data-testid="fit-city"><i className="ph ph-corners-out" /></button>
        </div>
        <button className="map-panel" aria-label={t('map.layers')} title={t('map.layers')} aria-expanded={s.layersOpen} onClick={() => s.set({ layersOpen: !s.layersOpen })} style={{ ...btn, width: 38, height: 38, boxShadow: s.layersOpen ? 'inset 0 0 0 1.5px var(--accent), var(--shadow-2)' : undefined }}><i className="ph ph-stack" style={{ fontSize: 18 }} /></button>
      </div>
      {s.layersOpen && (
        <div className="popover" style={{ top: 12, insetInlineStart: 60, zIndex: 4, width: 250 }}>
          <div className="eyebrow" style={{ padding: '4px 10px' }}>{t('map.layers')}</div>
          <LayerToggles />
        </div>
      )}

      {legendRisk && (
        <div className="map-panel" style={{ position: 'absolute', bottom: 12, insetInlineStart: 12, zIndex: 3, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11, color: 'var(--text-2)', maxWidth: 'calc(100% - 24px)' }} data-testid="legend">
          <div className="row" style={{ gap: 8 }}>
            <span>{mode === 'planning' || mode === 'live' || mode === 'sim' ? t('pl.legend') : t('map.legend.risk')}</span>
            <span className="risk-grad" style={{ width: compact ? 90 : 140 }} />
          </div>
          {!compact && (
            <div className="row" style={{ gap: 10 }}>
              <span className="row" style={{ gap: 4 }}><span className="dot" style={{ background: 'var(--risk-low)' }} />{t('riskShort.low')}</span>
              <span className="row" style={{ gap: 4 }}><span className="dot" style={{ background: 'var(--risk-medium)' }} />{t('riskShort.medium')}</span>
              <span className="row" style={{ gap: 4 }}><span className="dot" style={{ background: 'var(--risk-high)' }} />{t('riskShort.high')}</span>
              <span className="row" style={{ gap: 4 }}><span className="dot" style={{ background: 'var(--risk-critical)' }} />{t('riskShort.critical')}</span>
              {s.layers.blind && <span className="chip chip-hazard" style={{ padding: '0 7px' }}>{t('bs.legend')}</span>}
            </div>
          )}
        </div>
      )}

      <div className="map-panel row" style={{ position: 'absolute', bottom: 40, insetInlineEnd: 12, zIndex: 3, fontSize: 11, color: 'var(--text-2)', padding: '4px 8px', whiteSpace: 'nowrap', gap: 6, display: compact ? 'none' : undefined }}>
        <span data-testid="map-status" style={{ color: base === 'offline' ? 'var(--warning)' : undefined }}>
          {base === 'offline' ? <><i className="ph ph-wifi-slash" /> {t('map.offline')}</> : base === 'loading' ? t('map.loading') : cityName}
        </span>
        {cursor && !compact && <span className="mono ltr" data-testid="cursor">{F(cursor.lat, 6)}, {F(cursor.lon, 6)}</span>}
      </div>
      {base === 'failed' && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--text-3)' }}>{t('map.webgl')}</div>}
    </>
  );
}
