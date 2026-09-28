/**
 * Realistic 3D map (MapLibre GL + OpenStreetMap vector tiles + terrain DEM). Loaded lazily as its own chunk.
 *
 * Base map: the configured style (OpenFreeMap "liberty", 3D buildings) with a raster-dem terrain and hillshade.
 * If the style or its tiles cannot be reached, it falls back to an offline style drawn from the branch's own road
 * network. Coordinates stay WGS84 end to end; overlays are GeoJSON sources updated from the store.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type LayerSpecification, type Map as MLMap, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import rtlUrl from 'rtl-text-plugin?url';
import { cellToBoundary } from 'h3-js';
import { useNavigate } from 'react-router-dom';
import { useOps, type Mode } from '../stores/ops';
import { usePrefs } from '../stores/prefs';
import { useSession } from '../stores/session';
import { useT } from '../app/hooks';
import { editRoute, runAnalysis } from '../app/actions';
import { mapPalette, type MapPalette } from '../lib/palette';
import { circle, insertionIndex, relayReachM, sector } from './geo';
import { MapControls } from './MapControls';
import type { BranchGeo, LatLon, LngLat, Plan, PoiKind, RoutePlan } from '../api/types';
import { digits, pick, type Lang } from '../i18n';

type FC = GeoJSON.FeatureCollection;
const EMPTY: FC = { type: 'FeatureCollection', features: [] };
const OV_SOURCES = ['ov-boundary', 'ov-risk', 'ov-blind', 'ov-incidents', 'ov-coverage', 'ov-analysis', 'ov-routes', 'ov-route-hit', 'ov-cep'] as const;
const POI_ICON: Record<PoiKind, string> = { hospital: 'first-aid', clinic: 'first-aid', police: 'shield', fuel: 'gas-pump', safe_house: 'house-line', hq: 'flag', airport: 'airplane', government: 'bank' };

let rtlRequested = false;
function ensureRtlPlugin(): void {
  if (rtlRequested) return;
  rtlRequested = true;
  try { void maplibregl.setRTLTextPlugin(rtlUrl, true)?.catch?.(() => undefined); } catch { /* already set */ }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const feature = (geometry: GeoJSON.Geometry, properties: Record<string, unknown> = {}): GeoJSON.Feature => ({ type: 'Feature', geometry, properties });
const poly = (ring: LngLat[], p: Record<string, unknown> = {}) => feature({ type: 'Polygon', coordinates: [ring] }, p);

/** Diagonal hazard stripes (blind spots): pattern, not only colour, so it reads without colour vision. */
function hatch(p: MapPalette): { width: number; height: number; data: Uint8Array } {
  const n = 16, data = new Uint8Array(n * n * 4);
  const hex = p.hazard.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) || 240);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const on = (x + y) % n < 6, i = (y * n + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = on ? 200 : 40;
  }
  return { width: n, height: n, data };
}

/** Offline base style: the branch street network on a plain ground (no external requests). */
function offlineStyle(geo: BranchGeo | null, p: MapPalette, theme: 'dark' | 'light'): StyleSpecification {
  const roadColor = theme === 'dark' ? '#3a4a63' : '#ffffff', casing = theme === 'dark' ? '#0a0f18' : '#c9c2b2';
  const w = (major: number, minor: number) => ['match', ['get', 'cls'], ['trunk', 'primary'], major, 'secondary', (major + minor) / 2, minor] as unknown as number;
  return {
    version: 8, name: 'offline',
    sources: {
      roads: { type: 'geojson', data: (geo?.roads ?? EMPTY) as unknown as GeoJSON.GeoJSON },
      area: { type: 'geojson', data: geo ? poly(geo.boundary) : EMPTY },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': p.ground } },
      { id: 'area', type: 'fill', source: 'area', paint: { 'fill-color': theme === 'dark' ? '#111a29' : '#f6f3ec' } },
      { id: 'roads-casing', type: 'line', source: 'roads', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': casing, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, w(2.5, 0.8), 16, w(14, 7)] } },
      { id: 'roads', type: 'line', source: 'roads', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['match', ['get', 'cls'], ['trunk', 'primary'], theme === 'dark' ? '#6d7f9c' : '#f3d9a4', roadColor], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, w(1.5, 0.4), 16, w(11, 5)] } },
    ],
  };
}

/** Layers of the current style; empty while a new style is loading (MapLibre's getStyle() is undefined then). */
const styleLayers = (map: MLMap) => map.getStyle()?.layers ?? [];

/** Basemap labels in the interface language where OSM has them. */
function localiseLabels(map: MLMap, lang: Lang): void {
  const field = lang === 'en'
    ? ['coalesce', ['get', 'name:en'], ['get', 'name_en'], ['get', 'name:latin'], ['get', 'name']]
    : lang === 'ps'
      ? ['coalesce', ['get', 'name:ps'], ['get', 'name:nonlatin'], ['get', 'name']]
      : ['coalesce', ['get', 'name:fa'], ['get', 'name:prs'], ['get', 'name:nonlatin'], ['get', 'name']];
  for (const l of styleLayers(map)) {
    if (l.type !== 'symbol' || l.id.startsWith('ov-')) continue;
    const tf = map.getLayoutProperty(l.id, 'text-field');
    if (tf && JSON.stringify(tf).includes('name')) { try { map.setLayoutProperty(l.id, 'text-field', field); } catch { /* keep style's */ } }
  }
}

function installOverlay(map: MLMap, p: MapPalette, cfg: { terrainUrl: string; encoding: 'terrarium' | 'mapbox'; offline: boolean }): void {
  if (map.getSource('ov-risk')) return;
  for (const id of OV_SOURCES) map.addSource(id, { type: 'geojson', data: EMPTY });
  if (!map.hasImage('hazard')) map.addImage('hazard', hatch(p), { pixelRatio: 2 });
  const firstSymbol = styleLayers(map).find((l) => l.type === 'symbol')?.id;
  if (!map.getSource('ov-dem')) {
    // Separate DEM sources for terrain and hillshade (MapLibre renders both better that way).
    map.addSource('ov-dem', { type: 'raster-dem', tiles: [cfg.terrainUrl], tileSize: 256, encoding: cfg.encoding, maxzoom: 14 });
    map.addSource('ov-dem-hs', { type: 'raster-dem', tiles: [cfg.terrainUrl], tileSize: 256, encoding: cfg.encoding, maxzoom: 14 });
    map.addLayer({ id: 'ov-hillshade', type: 'hillshade', source: 'ov-dem-hs', paint: { 'hillshade-exaggeration': cfg.offline ? 0.35 : 0.22, 'hillshade-shadow-color': '#0b1220' } }, firstSymbol);
  }
  const add = (l: LayerSpecification, before?: string) => { if (!map.getLayer(l.id)) map.addLayer(l, before); };
  const riskColor = ['interpolate', ['linear'], ['get', 'score'], 0, p.low, 0.1, p.medium, 0.35, p.high, 0.6, p.critical] as unknown as string;
  add({ id: 'ov-risk-fill', type: 'fill', source: 'ov-risk', paint: { 'fill-color': riskColor, 'fill-opacity': ['interpolate', ['linear'], ['get', 'score'], 0, 0.04, 0.1, 0.2, 0.35, 0.42, 0.6, 0.58], 'fill-outline-color': 'rgba(0,0,0,0)' } }, firstSymbol);
  add({ id: 'ov-risk-ext', type: 'fill-extrusion', source: 'ov-risk', filter: ['>=', ['get', 'score'], 0.1], layout: { visibility: 'none' }, paint: { 'fill-extrusion-color': riskColor, 'fill-extrusion-height': ['*', ['get', 'score'], 1400], 'fill-extrusion-opacity': 0.72 } });
  add({ id: 'ov-boundary-line', type: 'line', source: 'ov-boundary', paint: { 'line-color': p.accent, 'line-width': 1.6, 'line-dasharray': [3, 2], 'line-opacity': 0.8 } });
  add({ id: 'ov-coverage-fill', type: 'fill', source: 'ov-coverage', paint: { 'fill-color': ['match', ['get', 'kind'], 'radio', p.info, 'camera', p.accent, p.friendly], 'fill-opacity': ['case', ['get', 'off'], 0.03, 0.1] } });
  add({ id: 'ov-coverage-line', type: 'line', source: 'ov-coverage', paint: { 'line-color': ['match', ['get', 'kind'], 'radio', p.info, 'camera', p.accent, p.friendly], 'line-width': ['case', ['get', 'sel'], 2.5, 1], 'line-opacity': ['case', ['get', 'off'], 0.3, 0.8], 'line-dasharray': [2, 2] } });
  add({ id: 'ov-blind-fill', type: 'fill', source: 'ov-blind', paint: { 'fill-pattern': 'hazard', 'fill-opacity': ['case', ['get', 'sel'], 0.95, 0.7] } });
  add({ id: 'ov-blind-line', type: 'line', source: 'ov-blind', paint: { 'line-color': p.hazard, 'line-width': ['case', ['get', 'sel'], 3, 1.4] } });
  add({ id: 'ov-incident-fill', type: 'fill', source: 'ov-incidents', paint: { 'fill-color': ['match', ['get', 'severity'], 'critical', p.critical, 'high', p.high, p.medium], 'fill-opacity': 0.1 } });
  add({ id: 'ov-incident-line', type: 'line', source: 'ov-incidents', paint: { 'line-color': ['match', ['get', 'severity'], 'critical', p.critical, 'high', p.high, p.medium], 'line-width': 1.2, 'line-opacity': 0.7 } });
  add({ id: 'ov-analysis-fill', type: 'fill', source: 'ov-analysis', paint: { 'fill-color': p.accent, 'fill-opacity': 0.06 } });
  add({ id: 'ov-analysis-line', type: 'line', source: 'ov-analysis', paint: { 'line-color': p.accent, 'line-width': 2, 'line-dasharray': [2, 1.5] } });
  const levelColor = ['match', ['get', 'level'], 'critical', p.critical, 'high', p.high, 'medium', p.medium, p.low] as unknown as string;
  add({ id: 'ov-route-casing', type: 'line', source: 'ov-routes', filter: ['==', ['get', 'sel'], true], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#05080f', 'line-width': 10, 'line-opacity': 0.75 } });
  add({ id: 'ov-route-alt', type: 'line', source: 'ov-routes', filter: ['==', ['get', 'sel'], false], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': levelColor, 'line-width': 3.5, 'line-opacity': 0.55, 'line-dasharray': [1.5, 1.2] } });
  add({ id: 'ov-route-sel', type: 'line', source: 'ov-routes', filter: ['==', ['get', 'sel'], true], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': levelColor, 'line-width': 6 } });
  add({ id: 'ov-route-hit', type: 'line', source: 'ov-route-hit', paint: { 'line-color': '#ffffff', 'line-width': 22, 'line-opacity': 0.001 } });
  add({ id: 'ov-cep-fill', type: 'fill', source: 'ov-cep', paint: { 'fill-color': p.friendly, 'fill-opacity': 0.18 } });
  add({ id: 'ov-cep-line', type: 'line', source: 'ov-cep', paint: { 'line-color': p.friendly, 'line-width': 1.2 } });
}

/** Screen-space distance (px) from a point to a projected path — independent of the renderer's feature picking. */
function pixelsToPath(map: MLMap, path: LatLon[], pt: { x: number; y: number }): number {
  let best = Infinity;
  let prev = map.project([path[0].lon, path[0].lat]);
  for (let i = 1; i < path.length; i++) {
    const cur = map.project([path[i].lon, path[i].lat]);
    const dx = cur.x - prev.x, dy = cur.y - prev.y, len2 = dx * dx + dy * dy;
    const k = len2 ? Math.max(0, Math.min(1, ((pt.x - prev.x) * dx + (pt.y - prev.y) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(pt.x - (prev.x + k * dx), pt.y - (prev.y + k * dy)));
    prev = cur;
  }
  return best;
}

interface MarkerSpec { key: string; at: LatLon; html: string; draggable?: boolean; title?: string; onClick?: () => void; onDrag?: (p: LatLon) => void; onDbl?: () => void; z?: number }
type Handlers = Pick<MarkerSpec, 'onClick' | 'onDrag' | 'onDbl'>;

/** Keeps HTML markers in step with a list of specs (create, move, re-render, remove). */
function syncMarkers(map: MLMap, reg: Map<string, { m: maplibregl.Marker; html: string; h: Handlers }>, specs: MarkerSpec[]): void {
  const seen = new Set<string>();
  for (const s of specs) {
    seen.add(s.key);
    const cur = reg.get(s.key);
    if (cur) {
      cur.h.onClick = s.onClick; cur.h.onDrag = s.onDrag; cur.h.onDbl = s.onDbl;
      if (!cur.m.isDraggable?.() || !s.draggable) cur.m.setLngLat([s.at.lon, s.at.lat]);
      if (cur.html !== s.html) { cur.m.getElement().innerHTML = s.html; cur.html = s.html; }
      continue;
    }
    const el = document.createElement('div');
    el.innerHTML = s.html;
    if (s.title) el.title = s.title;
    if (s.z) el.style.zIndex = String(s.z);
    const h: Handlers = { onClick: s.onClick, onDrag: s.onDrag, onDbl: s.onDbl };
    el.addEventListener('click', (e) => { if (h.onClick) { e.stopPropagation(); h.onClick(); } });
    el.addEventListener('dblclick', (e) => { if (h.onDbl) { e.stopPropagation(); e.preventDefault(); h.onDbl(); } });
    const m = new maplibregl.Marker({ element: el, draggable: !!s.draggable }).setLngLat([s.at.lon, s.at.lat]).addTo(map);
    if (s.draggable) m.on('dragend', () => { const ll = m.getLngLat(); h.onDrag?.({ lat: ll.lat, lon: ll.lng }); });
    reg.set(s.key, { m, html: s.html, h });
  }
  for (const [k, v] of reg) if (!seen.has(k)) { v.m.remove(); reg.delete(k); }
}

export default function MapView({ mode, compact }: { mode: Mode; compact: boolean }) {
  const { t, x, lang } = useT();
  const navigate = useNavigate();
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const markers = useRef(new Map<string, { m: maplibregl.Marker; html: string; h: Handlers }>());
  const [styleGen, setStyleGen] = useState(0);
  const [base, setBase] = useState<'loading' | 'online' | 'offline' | 'failed'>('loading');
  const [cursor, setCursor] = useState<LatLon | null>(null);
  const theme = usePrefs((s) => s.theme);
  const branchId = useSession((s) => s.branch);
  const s = useOps();
  const { config, geo, view3d, layers } = s;
  const branch = config?.branches.find((b) => b.id === branchId);
  const pal = useMemo(() => mapPalette(), [theme]);
  const baseRef = useRef(base);
  baseRef.current = base;
  // False from a setStyle() call until its 'style.load': effects must not touch layers or paint in between
  // (MapLibre throws "Style is not done loading"); they re-run on the styleGen bump that follows.
  const styleReady = useRef(false);

  // --- create the map once per branch
  useEffect(() => {
    if (!box.current || !config || !branch) return;
    ensureRtlPlugin();
    let map: MLMap;
    try {
      map = new maplibregl.Map({
        container: box.current, style: config.map.style_url, bounds: branch.bbox as [number, number, number, number],
        fitBoundsOptions: { padding: 32 }, pitch: view3d ? 50 : 0, bearing: view3d ? -14 : 0, maxPitch: 78,
        attributionControl: { compact: true, customAttribution: config.map.attribution }, dragRotate: true, fadeDuration: 150,
      });
    } catch { setBase('failed'); return; }
    mapRef.current = map;
    styleReady.current = false;
    (window as unknown as { __opsMap?: MLMap }).__opsMap = map;
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 110 }), 'bottom-right');
    // On narrow maps the attribution stays collapsed to its (i) button so it does not run under the legend.
    // MapLibre re-opens it whenever attributions change (style swap, DEM arriving), so collapse after each
    // change until the user opens it.
    let attribTouched = false;
    map.getContainer().querySelector('.maplibregl-ctrl-attrib-button')?.addEventListener('click', () => { attribTouched = true; });
    const collapseAttrib = () => { if (!attribTouched && map.getContainer().clientWidth < 640) map.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'); };
    map.on('styledata', collapseAttrib);
    map.on('sourcedata', collapseAttrib);
    let loaded = false, tileOk = false, tileErrors = 0, demOk = false, demErrors = 0;
    // Style swaps are deferred: MapLibre raises errors from inside its render loop and must not re-enter it.
    let switching = false;
    const toOffline = () => {
      if (baseRef.current === 'offline' || switching) return;
      switching = true;
      baseRef.current = 'offline';
      setTimeout(() => {
        setBase('offline');
        styleReady.current = false;
        map.setStyle(offlineStyle(useOps.getState().geo, mapPalette(), usePrefs.getState().theme), { diff: false });
      }, 0);
    };
    const timer = setTimeout(() => { if (!loaded) toOffline(); }, 9000);
    map.on('style.load', () => {
      installOverlay(map, mapPalette(), { terrainUrl: config.map.terrain_url, encoding: config.map.terrain_encoding, offline: baseRef.current === 'offline' });
      if (baseRef.current !== 'offline') localiseLabels(map, usePrefs.getState().lang);
      switching = false;
      styleReady.current = true;
      setStyleGen((g) => g + 1);
    });
    map.on('load', () => { loaded = true; clearTimeout(timer); if (baseRef.current === 'loading') setBase('online'); });
    map.on('data', (e: maplibregl.MapDataEvent & { sourceId?: string; tile?: unknown }) => {
      if (e.dataType !== 'source' || !e.tile || !e.sourceId) return;
      if (e.sourceId.startsWith('ov-dem')) demOk = true; else if (!e.sourceId.startsWith('ov-')) tileOk = true;
    });
    map.on('error', (e: { error?: Error; sourceId?: string }) => {
      const src = e.sourceId;
      if (!src) console.warn('[map]', e.error?.message ?? e.error, e.error?.stack?.split('\n').slice(0, 4).join(' | '));
      if (src === 'ov-dem' || src === 'ov-dem-hs') {
        if (++demErrors === 3 && !demOk) setTimeout(() => { try { map.stop(); map.setTerrain(null); if (map.getLayer('ov-hillshade')) map.setLayoutProperty('ov-hillshade', 'visibility', 'none'); } catch { /* ignore */ } }, 0);
        return;
      }
      if (src?.startsWith('ov-')) return;
      if (!loaded || (++tileErrors >= 3 && !tileOk)) toOffline();
    });
    map.on('mousemove', (e) => setCursor({ lat: e.lngLat.lat, lon: e.lngLat.lng }));
    map.on('mouseout', () => setCursor(null));
    return () => { clearTimeout(timer); for (const v of markers.current.values()) v.m.remove(); markers.current.clear(); map.remove(); mapRef.current = null; setBase('loading'); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, branchId]);

  // --- offline base follows the theme; labels follow the language
  useEffect(() => {
    const map = mapRef.current;
    if (!map || base !== 'offline') return;
    styleReady.current = false;
    map.setStyle(offlineStyle(geo, pal, theme), { diff: false });
  }, [theme, base === 'offline' ? geo : null]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const map = mapRef.current; if (map && base === 'online' && styleGen && styleReady.current) localiseLabels(map, lang); }, [lang, styleGen, base]);

  // --- 2D / 3D, terrain, buildings
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleGen || !styleReady.current) return;
    // Terrain must be attached before a camera ease starts: MapLibre prepares elevation only at ease start and
    // an ease that gains terrain mid-flight dereferences an unset elevation centre.
    map.stop();
    try { map.setTerrain(view3d && layers.terrain && map.getSource('ov-dem') ? { source: 'ov-dem', exaggeration: 1.3 } : null); } catch { /* no dem */ }
    map.easeTo({ pitch: view3d ? 50 : 0, bearing: view3d ? map.getBearing() || -14 : 0, duration: 700 });
    if (map.getLayer('ov-hillshade')) map.setLayoutProperty('ov-hillshade', 'visibility', layers.terrain ? 'visible' : 'none');
    for (const l of styleLayers(map)) if (l.type === 'fill-extrusion' && !l.id.startsWith('ov-')) map.setLayoutProperty(l.id, 'visibility', layers.buildings && view3d ? 'visible' : 'none');
    const setSky = (map as unknown as { setSky?: (s: unknown) => void }).setSky;
    if (setSky && view3d) { try { setSky.call(map, { 'sky-color': theme === 'dark' ? '#0b1526' : '#bcd6f0', 'horizon-color': theme === 'dark' ? '#1b2a44' : '#e9eef4', 'fog-color': theme === 'dark' ? '#0a101b' : '#f1eee6', 'sky-horizon-blend': 0.5, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.9 }); } catch { /* older runtime */ } }
  }, [view3d, layers.terrain, layers.buildings, styleGen, theme]);

  // --- overlay paint follows theme
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleGen || !styleReady.current) return;
    if (map.hasImage('hazard')) map.updateImage('hazard', hatch(pal));
    map.setPaintProperty('ov-boundary-line', 'line-color', pal.accent);
    map.setPaintProperty('ov-blind-line', 'line-color', pal.hazard);
    map.setPaintProperty('ov-cep-fill', 'fill-color', pal.friendly);
    map.setPaintProperty('ov-cep-line', 'line-color', pal.friendly);
    map.setPaintProperty('ov-analysis-line', 'line-color', pal.accent);
  }, [pal, styleGen]);

  // --- which plan / route is on screen
  const plan: Plan | undefined = mode === 'planning' ? s.plans.find((p) => p.id === s.planSel) : s.plans.find((p) => p.status === 'running');
  const shownKey = mode === 'planning' ? s.routeSel ?? plan?.active_route : plan?.active_route;
  const shown: RoutePlan | undefined = plan?.pace.find((r) => r.k === shownKey);
  const routeMode = mode === 'analysis' || mode === 'assets' ? 'none' : mode === 'planning' ? 'all' : 'active';

  const data = useMemo(() => {
    const riskFc: FC = { type: 'FeatureCollection', features: s.cells.map((c) => poly(cellToBoundary(c.id, true) as LngLat[], { id: c.id, score: c.score, level: c.level })) };
    const blindFc: FC = { type: 'FeatureCollection', features: s.blindspots.map((z) => feature({ type: 'MultiPolygon', coordinates: z.polygon }, { id: z.id, type: z.type, sel: s.anSel?.kind === 'zone' && s.anSel.id === z.id })) };
    const incFc: FC = { type: 'FeatureCollection', features: s.incidents.filter((i) => i.location && i.severity !== 'low').map((i) => poly(circle(i.location!, i.radius_m, 40), { severity: i.severity })) };
    const routesFc: FC = { type: 'FeatureCollection', features: routeMode === 'none' || !plan ? [] : plan.pace.filter((r) => routeMode === 'all' || r.k === shownKey).flatMap((r) => r.segments.map((seg) => feature({ type: 'LineString', coordinates: seg.coords }, { k: r.k, level: seg.level, sel: r.k === shownKey }))) };
    const editing = mode === 'planning' && s.editing && plan ? plan.pace.find((r) => r.k === s.editing) : undefined;
    const hitFc: FC = { type: 'FeatureCollection', features: editing ? [feature({ type: 'LineString', coordinates: editing.path.map((p) => [p.lon, p.lat]) })] : [] };
    const cepFc: FC = { type: 'FeatureCollection', features: s.unitOrder.map((id) => s.units[id]?.telemetry).filter(Boolean).map((tl) => poly(circle(tl!, Math.max(1, tl!.cep95_m), 32))) };
    const covFc: FC = { type: 'FeatureCollection', features: s.devices.filter((d) => d.geo && d.coverage && (mode === 'assets' || layers.coverage)).map((d) => {
      const cov = d.coverage!, sel = mode === 'assets' && d.id === s.devSel, off = d.state === 'off';
      if (cov.kind === 'radio') return poly(circle(d.geo!, relayReachM(cov.tx_dbm, cov.gain_db), 64), { kind: 'radio', sel, off });
      if (cov.kind === 'camera') return poly(sector(d.geo!, cov.range_m, cov.heading_deg, cov.fov_deg), { kind: 'camera', sel, off });
      return poly(circle(d.geo!, cov.footprint_m, 40), { kind: 'drone', sel, off: off || d.state !== 'on' });
    }) };
    const [alat, alon] = s.aLoc.split(',').map((v) => parseFloat(v));
    const anFc: FC = mode === 'analysis' && Number.isFinite(alat) && Number.isFinite(alon) && (s.anSel?.kind === 'area' || s.anTab === 'area') ? { type: 'FeatureCollection', features: [poly(circle({ lat: alat, lon: alon }, s.radius, 72))] } : EMPTY;
    const boundaryFc: FC = geo ? { type: 'FeatureCollection', features: [feature({ type: 'LineString', coordinates: geo.boundary })] } : EMPTY;
    return { riskFc, blindFc, incFc, routesFc, hitFc, cepFc, covFc, anFc, boundaryFc };
  }, [s.cells, s.blindspots, s.anSel, s.incidents, plan, shownKey, routeMode, mode, s.editing, s.units, s.unitOrder, s.devices, s.devSel, layers.coverage, s.aLoc, s.radius, s.anTab, geo]);

  // --- push overlay data
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleGen || !styleReady.current) return;
    const put = (id: string, fc: FC) => (map.getSource(id) as GeoJSONSource | undefined)?.setData(fc);
    put('ov-risk', data.riskFc); put('ov-blind', data.blindFc); put('ov-incidents', data.incFc); put('ov-routes', data.routesFc);
    put('ov-route-hit', data.hitFc); put('ov-coverage', data.covFc); put('ov-analysis', data.anFc); put('ov-boundary', data.boundaryFc);
  }, [data.riskFc, data.blindFc, data.incFc, data.routesFc, data.hitFc, data.covFc, data.anFc, data.boundaryFc, styleGen]);
  useEffect(() => { const map = mapRef.current; if (map && styleGen && styleReady.current) (map.getSource('ov-cep') as GeoJSONSource | undefined)?.setData(layers.units ? data.cepFc : EMPTY); }, [data.cepFc, styleGen, layers.units]);

  // --- layer visibility and emphasis per workspace
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleGen || !styleReady.current) return;
    const vis = (id: string, on: boolean) => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); };
    const analysis3d = mode === 'analysis' && view3d;
    vis('ov-risk-fill', layers.risk && !analysis3d);
    vis('ov-risk-ext', layers.risk && analysis3d);
    map.setPaintProperty('ov-risk-fill', 'fill-opacity', ['*', mode === 'analysis' ? 1.25 : 0.6, ['interpolate', ['linear'], ['get', 'score'], 0, 0.04, 0.1, 0.2, 0.35, 0.42, 0.6, 0.58]]);
    for (const id of ['ov-blind-fill', 'ov-blind-line']) vis(id, layers.blind && mode !== 'assets');
    // Blind spots are the subject in Analysis; elsewhere they stay visible but recede behind routes and units.
    map.setPaintProperty('ov-blind-fill', 'fill-opacity', mode === 'analysis' ? ['case', ['get', 'sel'], 0.95, 0.7] : ['case', ['get', 'sel'], 0.7, 0.28]);
    map.setPaintProperty('ov-blind-line', 'line-opacity', mode === 'analysis' ? 1 : 0.45);
    for (const id of ['ov-coverage-fill', 'ov-coverage-line']) vis(id, mode === 'assets' || layers.coverage);
    for (const id of ['ov-route-casing', 'ov-route-alt', 'ov-route-sel', 'ov-route-hit']) vis(id, layers.routes);
    for (const id of ['ov-incident-fill', 'ov-incident-line']) vis(id, mode !== 'assets');
  }, [styleGen, layers, mode, view3d]);

  // --- markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleGen || !styleReady.current) return;
    const specs: MarkerSpec[] = [];
    const st = useOps.getState();
    if (layers.units && mode !== 'assets') {
      for (const id of s.unitOrder) {
        const u = s.units[id], tl = u?.telemetry;
        if (!u || !tl) continue;
        const warn = u.comms === 'lost' || tl.degraded;
        specs.push({ key: `u:${id}`, at: tl, z: 5, title: x(u.name), html: `<div class="mk mk-unit ${warn ? 'warn' : ''} ${mode === 'live' && s.sel === id ? 'sel' : ''}"><i class="ph ph-${u.icon}"></i><span class="mk-label">${esc(x(u.name))}</span></div>`,
          onClick: () => { st.set({ sel: id, liveTab: 'units', sheet: 'insp', sheetOpen: true }); if (mode !== 'live') navigate('/live'); } });
      }
    }
    if (mode === 'analysis' && layers.extremes && s.extremes) {
      for (const site of s.extremes.dangerous) specs.push({ key: `d:${site.rank}`, at: site, z: 4, title: `${t('an.dangerous')} #${site.rank}`, html: `<div class="mk mk-rank" style="background:${pal.critical}"><span>${esc(digits(lang, site.rank))}</span></div>`, onClick: () => { st.set({ anTab: 'dangerous', anSel: { kind: 'dangerous', rank: site.rank }, sheet: 'insp' }); st.flyTo(site, 15); } });
      for (const site of s.extremes.safest) specs.push({ key: `s:${site.rank}`, at: site, z: 3, title: `${t('an.safest')} #${site.rank}`, html: `<div class="mk mk-rank safe" style="background:${pal.success}"><span>${esc(digits(lang, site.rank))}</span></div>`, onClick: () => { st.set({ anTab: 'safest', anSel: { kind: 'safest', rank: site.rank }, sheet: 'insp' }); st.flyTo(site, 15); } });
    }
    if (layers.pois && geo && mode !== 'assets') {
      const kinds: PoiKind[] = mode === 'analysis' ? ['police', 'hospital', 'clinic', 'hq', 'safe_house'] : ['hq', 'safe_house'];
      for (const p of geo.pois.filter((q) => kinds.includes(q.kind))) specs.push({ key: `p:${p.id}`, at: p, z: 1, title: x(p.name), html: `<div class="mk mk-poi" style="color:${p.kind === 'safe_house' || p.kind === 'police' ? pal.success : p.kind === 'hq' ? pal.accent : pal.info}"><i class="ph ph-${POI_ICON[p.kind]}"></i></div>` });
    }
    if (mode !== 'analysis' && mode !== 'assets' && shown && plan) {
      specs.push({ key: 'end:o', at: plan.origin, z: 6, title: x(plan.origin.name), html: '<div class="mk mk-end">A</div>' });
      specs.push({ key: 'end:d', at: plan.destination, z: 6, title: x(plan.destination.name), html: `<div class="mk mk-end" style="background:${pal.accent};color:#04201e">B</div>` });
      for (const c of shown.checkpoints.filter((c) => c.id !== 'DEST')) specs.push({ key: `cp:${c.id}`, at: c, z: 2, title: `${c.id} · ${x(c.name)}`, html: `<div class="mk mk-poi" style="width:20px;height:20px;border-radius:50%;font-size:10px;font-weight:700">${esc(digits(lang, c.id.replace('CP-', '')))}</div>` });
      if (mode === 'planning') {
        for (const p of shown.safe_stops) specs.push({ key: `ss:${p.id}`, at: p, z: 2, title: x(p.name), html: `<div class="mk mk-poi" style="color:${pal.success}"><i class="ph ph-${POI_ICON[p.kind]}"></i></div>` });
        for (const p of shown.support_points) specs.push({ key: `sp:${p.id}`, at: p, z: 2, title: x(p.name), html: `<div class="mk mk-poi" style="color:${pal.info}"><i class="ph ph-${POI_ICON[p.kind]}"></i></div>` });
      }
    }
    if (mode === 'planning' && s.editing && plan) {
      const r = plan.pace.find((q) => q.k === s.editing);
      const wps = plan.routes[s.editing]?.waypoints ?? [];
      wps.forEach((w, i) => specs.push({
        key: `wp:${plan.id}:${s.editing}:${i}:${w.lat},${w.lon}`, at: w, z: 8, draggable: true, title: t('pl.waypoint', { n: i + 1 }), html: '<div class="mk mk-wp"></div>',
        onDrag: (p) => { const next = [...wps]; next[i] = p; void editRoute(plan, s.editing!, next); },
        onDbl: () => void editRoute(plan, s.editing!, wps.filter((_, j) => j !== i)),
      }));
      void r;
    }
    if (mode !== 'assets') {
      for (const i of s.incidents.filter((q) => q.location && q.severity === 'critical')) specs.push({ key: `th:${i.incident_id}`, at: i.location!, z: 3, title: i.type, html: '<div class="mk mk-threat"></div>' });
    }
    if (mode === 'assets') {
      for (const d of s.devices.filter((q) => q.geo)) {
        const icon = { drone: 'drone', relay: 'broadcast', gps: 'navigation-arrow', iot: 'cpu', camera: 'security-camera', ble: 'bluetooth' }[d.type];
        const color = d.state === 'off' ? pal.danger : d.state === 'warn' ? pal.warning : pal.accent;
        specs.push({ key: `dv:${d.id}`, at: d.geo!, z: d.id === s.devSel ? 6 : 3, title: `${d.id} · ${x(d.name)}`, html: `<div class="mk mk-poi" style="color:${color};${d.id === s.devSel ? `outline:3px solid ${pal.accent};outline-offset:2px;` : ''}"><i class="ph ph-${icon}"></i></div>`, onClick: () => st.set({ devSel: d.id, sheet: 'insp', sheetOpen: true }) });
      }
    }
    syncMarkers(map, markers.current, specs);
  }, [styleGen, mode, layers.units, layers.extremes, layers.pois, s.units, s.unitOrder, s.sel, s.extremes, geo, plan, shown, s.editing, s.incidents, s.devices, s.devSel, pal, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- map clicks: pick points, add waypoints, select zones
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleGen || !styleReady.current) return;
    const onClick = (e: maplibregl.MapMouseEvent) => {
      const st = useOps.getState();
      const p = { lat: +e.lngLat.lat.toFixed(6), lon: +e.lngLat.lng.toFixed(6) };
      if (mode === 'planning' && (st.picking === 'origin' || st.picking === 'destination')) {
        st.set({ draft: { ...st.draft, [st.picking]: { name: '', ...p } }, picking: null });
        return;
      }
      if (mode === 'planning' && st.editing) {
        const pl = st.plans.find((q) => q.id === st.planSel);
        const r = pl?.pace.find((q) => q.k === st.editing);
        if (pl && r && r.path.length > 1 && pixelsToPath(map, r.path, e.point) <= 14) {
          const wps = pl.routes[st.editing].waypoints;
          const i = insertionIndex(r.path, wps, p);
          void editRoute(pl, st.editing, [...wps.slice(0, i), p, ...wps.slice(i)]);
        }
        return;
      }
      if (mode === 'analysis') {
        const zone = layers.blind ? map.queryRenderedFeatures(e.point, { layers: ['ov-blind-fill'] })[0] : undefined;
        if (zone?.properties?.id && st.anTab === 'blind') { st.set({ anSel: { kind: 'zone', id: String(zone.properties.id) }, sheet: 'insp' }); return; }
        st.set({ aLoc: `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`, anTab: 'area', anSel: { kind: 'area' } });
        void runAnalysis();
      }
    };
    const setCursorStyle = () => { map.getCanvas().style.cursor = useOps.getState().picking || mode === 'analysis' ? 'crosshair' : ''; };
    const hover = (e: maplibregl.MapMouseEvent) => {
      const st = useOps.getState();
      if (mode !== 'planning' || !st.editing) return setCursorStyle();
      const r = st.plans.find((q) => q.id === st.planSel)?.pace.find((q) => q.k === st.editing);
      map.getCanvas().style.cursor = r && r.path.length > 1 && pixelsToPath(map, r.path, e.point) <= 14 ? 'copy' : '';
    };
    map.on('click', onClick);
    map.on('mousemove', hover);
    setCursorStyle();
    return () => { map.off('click', onClick); map.off('mousemove', hover); };
  }, [styleGen, mode, layers.blind]);

  // --- fly to focus requests; fit the city on branch change
  useEffect(() => { const map = mapRef.current; if (map && s.focus) map.flyTo({ center: [s.focus.lon, s.focus.lat], zoom: s.focus.zoom ?? Math.max(map.getZoom(), 14.5), duration: 900, essential: true }); }, [s.focus]);

  const fitCity = () => { const map = mapRef.current; if (map && branch) map.fitBounds(branch.bbox as [number, number, number, number], { padding: 32, pitch: view3d ? 50 : 0, bearing: view3d ? -14 : 0, duration: 900 }); };

  return (
    <>
      <div ref={box} style={{ position: 'absolute', inset: 0, background: 'var(--map-ground)' }} data-testid="map" data-base={base} />
      <MapControls
        map={mapRef} base={base} compact={compact} mode={mode} onFit={fitCity}
        cursor={cursor} cityName={branch ? pick(branch.city, lang) : ''}
      />
    </>
  );
}
