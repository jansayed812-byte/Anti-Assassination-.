/**
 * Loads a branch's base geography: an OpenStreetMap extract from services/data/osm/<BRANCH>/ when present
 * (produced by `npm run fetch:osm`), otherwise the deterministic synthetic city.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { bboxOf, distanceM, type LatLon, type LngLat } from '../geo';
import { tri } from '../i18n/types';
import type { BranchDef } from './branches';
import { boundaryRing, operationalSites, syntheticGeo } from './synthetic';
import type { BranchGeo, Poi, PoiKind, RestrictedZone, Road, RoadClass } from './types';

const AIRPORTS: Partial<Record<string, LatLon>> = { MZR: { lat: 36.7069, lon: 67.2097 } };

type GeoJSON<P, G> = { type: 'FeatureCollection'; features: Array<{ type: 'Feature'; properties: P; geometry: G }> };
type Names = { name_dr?: string; name_ps?: string; name_en?: string };

const names = (p: Names, fallback: string) => {
  const base = p.name_dr || p.name_ps || p.name_en || fallback;
  return tri(p.name_dr || base, p.name_ps || base, p.name_en || base);
};

function loadOsm(def: BranchDef, dir: string): BranchGeo {
  const read = <T>(f: string): T => JSON.parse(readFileSync(join(dir, f), 'utf8')) as T;
  const roadsFc = read<GeoJSON<Names & { id: string; cls: RoadClass; oneway?: boolean; maxspeed?: number }, { type: 'LineString'; coordinates: LngLat[] }>>('roads.geojson');
  const roads: Road[] = roadsFc.features.map((f) => ({
    id: f.properties.id, cls: f.properties.cls, oneway: !!f.properties.oneway, maxspeed: f.properties.maxspeed,
    name: f.properties.name_dr || f.properties.name_en || f.properties.name_ps ? names(f.properties, '') : undefined,
    coords: f.geometry.coordinates,
  }));
  const pois: Poi[] = existsSync(join(dir, 'pois.geojson'))
    ? read<GeoJSON<Names & { id: string; kind: PoiKind }, { type: 'Point'; coordinates: LngLat }>>('pois.geojson').features.map((f) => ({
      id: f.properties.id, kind: f.properties.kind, name: names(f.properties, f.properties.kind), lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], synthetic: false,
    }))
    : [];
  const restricted: RestrictedZone[] = existsSync(join(dir, 'restricted.geojson'))
    ? read<GeoJSON<Names & { id: string }, { type: 'Polygon'; coordinates: LngLat[][] }>>('restricted.geojson').features.map((f) => ({ id: f.properties.id, name: names(f.properties, 'Restricted area'), ring: f.geometry.coordinates[0] }))
    : [];
  const boundary = boundaryRing(def);
  return { def, source: 'osm', boundary, bbox: bboxOf(boundary), roads, pois, restricted };
}

/** Snaps a point to the nearest road vertex (used to put seeded sites on the street network). */
export function snapper(roads: Road[]): (p: LatLon) => LatLon {
  const verts: LatLon[] = [];
  for (const r of roads) if (r.cls !== 'trunk') for (const [lon, lat] of r.coords) verts.push({ lat, lon });
  return (p) => verts.reduce((best, v) => (distanceM(p, v) < distanceM(p, best) ? v : best), verts[0]);
}

export function loadBranchGeo(def: BranchDef, dataDir: string): BranchGeo {
  const dir = join(dataDir, def.id);
  const geo = existsSync(join(dir, 'roads.geojson')) ? loadOsm(def, dir) : syntheticGeo(def, { airport: AIRPORTS[def.id] });
  const snap = snapper(geo.roads);
  geo.pois.push(...operationalSites(def, snap));
  return geo;
}
