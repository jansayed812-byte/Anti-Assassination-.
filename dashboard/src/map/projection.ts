/** Mirror of services/server/geo.ts: 1 scene unit = 20 m, +x east, -z north. */
export const ORIGIN = { lat: 35.6892, lon: 51.389 };
export const METERS_PER_UNIT = 20;
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = 111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

export type XZ = [number, number];

export const toXZ = (p: { lat: number; lon: number }): XZ => [
  ((p.lon - ORIGIN.lon) * M_PER_DEG_LON) / METERS_PER_UNIT,
  (-(p.lat - ORIGIN.lat) * M_PER_DEG_LAT) / METERS_PER_UNIT,
];

/** Procedural offline terrain (metres of relief are exaggerated for legibility). */
export const terrainHeight = (x: number, z: number) =>
  5 * Math.sin(x * 0.045) * Math.cos(z * 0.038) + 3.5 * Math.sin((x + z) * 0.07) +
  16 * Math.exp(-((x - 45) ** 2 + (z - 35) ** 2) / 900) + 10 * Math.exp(-((x + 55) ** 2 + (z + 45) ** 2) / 700) +
  1.4 * Math.sin(x * 0.19) * Math.sin(z * 0.16);

export const HEX_SIZE_UNITS = 4.4;
