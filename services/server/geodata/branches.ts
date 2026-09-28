/**
 * Operating branches. Mazar-i-Sharif is headquarters and the default view.
 * `extent` is the urban area (semi-axes in metres around the centre) used for the risk/coverage grid
 * and the map's initial fit; `rotationDeg` orients the synthetic street lattice.
 */
import { tri, type Tri } from '../i18n/types';
import type { LatLon } from '../geo';

export type BranchId = 'MZR' | 'KBL' | 'HRT';

export interface BranchDef {
  id: BranchId;
  name: Tri;
  city: Tri;
  province: Tri;
  hq: boolean;
  center: LatLon;
  extent: { eastM: number; northM: number };
  rotationDeg: number;
  seed: number;
  timezone: string;
  /** Ground elevation of the city centre (m above sea level). */
  elevationM: number;
}

export const BRANCHES: BranchDef[] = [
  {
    id: 'MZR', hq: true, seed: 17, rotationDeg: 11, timezone: 'Asia/Kabul', elevationM: 378,
    name: tri('شعبهٔ مزار شریف (مرکز)', 'د مزار شریف څانګه (مرکز)', 'Mazar-i-Sharif branch (HQ)'),
    city: tri('مزار شریف', 'مزار شریف', 'Mazar-i-Sharif'),
    province: tri('بلخ', 'بلخ', 'Balkh'),
    center: { lat: 36.709, lon: 67.1109 },
    extent: { eastM: 6500, northM: 5000 },
  },
  {
    id: 'KBL', hq: false, seed: 29, rotationDeg: -7, timezone: 'Asia/Kabul', elevationM: 1791,
    name: tri('شعبهٔ کابل', 'د کابل څانګه', 'Kabul branch'),
    city: tri('کابل', 'کابل', 'Kabul'),
    province: tri('کابل', 'کابل', 'Kabul'),
    center: { lat: 34.5281, lon: 69.1723 },
    extent: { eastM: 9000, northM: 7000 },
  },
  {
    id: 'HRT', hq: false, seed: 43, rotationDeg: 4, timezone: 'Asia/Kabul', elevationM: 927,
    name: tri('شعبهٔ هرات', 'د هرات څانګه', 'Herat branch'),
    city: tri('هرات', 'هرات', 'Herat'),
    province: tri('هرات', 'هرات', 'Herat'),
    center: { lat: 34.3482, lon: 62.1997 },
    extent: { eastM: 5500, northM: 4500 },
  },
];

export const HQ_BRANCH: BranchId = 'MZR';
export const branchDef = (id: string): BranchDef | undefined => BRANCHES.find((b) => b.id === id);
