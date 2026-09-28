import type { LngLat } from '../geo';
import type { Tri } from '../i18n/types';
import type { BranchDef } from './branches';

export type RoadClass = 'trunk' | 'primary' | 'secondary' | 'tertiary' | 'residential';
export const ROAD_SPEED_KMH: Record<RoadClass, number> = { trunk: 80, primary: 60, secondary: 50, tertiary: 40, residential: 30 };

export interface Road { id: string; cls: RoadClass; name?: Tri; oneway: boolean; maxspeed?: number; coords: LngLat[] }

export type PoiKind = 'hospital' | 'clinic' | 'police' | 'fuel' | 'safe_house' | 'hq' | 'airport' | 'government';
export interface Poi { id: string; kind: PoiKind; name: Tri; lat: number; lon: number; synthetic: boolean }

export interface RestrictedZone { id: string; name: Tri; ring: LngLat[] }

export interface BranchGeo {
  def: BranchDef;
  source: 'osm' | 'synthetic';
  boundary: LngLat[];
  bbox: [number, number, number, number];
  roads: Road[];
  pois: Poi[];
  restricted: RestrictedZone[];
}
