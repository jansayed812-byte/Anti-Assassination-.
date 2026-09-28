/**
 * Phase 9: Spatial Analysis
 */
import { Pool } from 'pg';
import { L } from '../server/i18n/messages';
import type { Tri } from '../server/i18n/types';

export interface ProximityQuery { lat: number; lon: number; radius_m: number; severity_min?: 'low' | 'medium' | 'high' | 'critical'; }
export interface ProximityResult { incident_id: string; type: string; severity: string; distance_m: number; lat: number; lon: number; confidence: number; observed_at: string; }
export interface AreaRisk { lat: number; lon: number; radius_m: number; incident_count: number; max_severity: string; avg_confidence: number; recommendations: Tri[]; }

const SEVERITY_ORDER = ['low', 'medium', 'high', 'critical'];

export class SpatialAnalysis {
  private pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async findNearbyIncidents(query: ProximityQuery): Promise<ProximityResult[]> {
    const { lat, lon, radius_m, severity_min = 'low' } = query;
    const allowed = SEVERITY_ORDER.slice(SEVERITY_ORDER.indexOf(severity_min));
    const sql = `SELECT i.incident_id, i.type, i.severity, i.confidence, i.observed_at, ST_Y(i.location::geometry) AS lat, ST_X(i.location::geometry) AS lon, ST_Distance(i.location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) AS distance_m FROM analysis.incidents i WHERE ST_DWithin(i.location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3) AND i.severity = ANY($4) AND i.human_validation_status != 'rejected' ORDER BY distance_m ASC LIMIT 50`;
    const result = await this.pool.query(sql, [lat, lon, radius_m, allowed]);
    return result.rows as ProximityResult[];
  }

  async analyzeArea(lat: number, lon: number, radius_m: number): Promise<AreaRisk> {
    const incidents = await this.findNearbyIncidents({ lat, lon, radius_m });
    let maxIdx = 0, totalConf = 0;
    for (const inc of incidents) { const idx = SEVERITY_ORDER.indexOf(inc.severity); if (idx > maxIdx) maxIdx = idx; totalConf += inc.confidence; }
    return { lat, lon, radius_m, incident_count: incidents.length, max_severity: SEVERITY_ORDER[maxIdx], avg_confidence: incidents.length > 0 ? totalConf/incidents.length : 0, recommendations: this._buildRecs(incidents.length, SEVERITY_ORDER[maxIdx], incidents) };
  }

  async findRescueCenters(lat: number, lon: number, radius_m: number): Promise<unknown[]> {
    const sql = `SELECT name, type, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon, ST_Distance(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) AS distance_m FROM geographic.areas WHERE type IN ('hospital','police','fire_station','safe_house') AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography, $3) ORDER BY distance_m ASC LIMIT 10`;
    return (await this.pool.query(sql, [lat, lon, radius_m])).rows;
  }

  /** Recommendations in Dari, Pashto and English. */
  private _buildRecs(count: number, maxSeverity: string, incidents: ProximityResult[]): Tri[] {
    const r: Tri[] = [];
    if (count === 0) { r.push(L('area.safe')); return r; }
    if (maxSeverity === 'critical') { r.push(L('area.evacuate')); r.push(L('area.qrf')); }
    else if (maxSeverity === 'high') { r.push(L('area.readiness')); r.push(L('area.caution')); }
    else if (maxSeverity === 'medium') r.push(L('area.watch'));
    const types = [...new Set(incidents.map(i => i.type))];
    if (types.length > 0) r.push(L('area.types', { types: types.join(', ') }));
    return r;
  }
}
