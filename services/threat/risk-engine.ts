/**
 * Risk Engine - Phase 4
 * risk = severity x likelihood x exposure x data_confidence
 */

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface RiskInput {
  severity: number; likelihood: number; exposure: number; data_confidence: number;
  location?: { lat: number; lon: number };
  evidence?: string[];
  source?: string;
}

export interface RiskResult {
  score: number; level: RiskLevel; color: string;
  input: RiskInput; provenance: string; calculated_at: string; human_validated: boolean;
}

export interface IncidentEvent {
  incident_id: string; type: string; severity: RiskLevel;
  location?: { lat: number; lon: number };
  radius_m: number; observed_at: string; valid_until: string;
  confidence: number; evidence: string[]; source: string;
  human_validation_status: 'pending' | 'confirmed' | 'rejected';
}

export class RiskEngine {
  static calculate(input: RiskInput): RiskResult {
    const score = input.severity * input.likelihood * input.exposure * input.data_confidence;
    let level: RiskLevel, color: string;
    if (score >= 0.6) { level = 'critical'; color = '#EF4444'; }
    else if (score >= 0.35) { level = 'high'; color = '#F97316'; }
    else if (score >= 0.05) { level = 'medium'; color = '#EAB308'; }
    else { level = 'low'; color = '#22C55E'; }
    const provenance = `severity=${input.severity.toFixed(2)}, likelihood=${input.likelihood.toFixed(2)}, exposure=${input.exposure.toFixed(2)}, confidence=${input.data_confidence.toFixed(2)}, source=${input.source || 'unknown'}`;
    return { score: Math.round(score * 1000) / 1000, level, color, input, provenance, calculated_at: new Date().toISOString(), human_validated: false };
  }

  static buildGrid(incidents: IncidentEvent[], center: { lat: number; lon: number }, gridSizeKm = 1, cellsPerSide = 10): Array<{lat: number; lon: number; risk: RiskResult}> {
    const results: Array<{lat: number; lon: number; risk: RiskResult}> = [];
    const stepLat = (gridSizeKm / 111) / cellsPerSide;
    const stepLon = (gridSizeKm / (111 * Math.cos(center.lat * Math.PI / 180))) / cellsPerSide;
    for (let i = 0; i < cellsPerSide; i++) {
      for (let j = 0; j < cellsPerSide; j++) {
        const cellLat = center.lat - (gridSizeKm/111)/2 + i*stepLat;
        const cellLon = center.lon - (gridSizeKm/(111*Math.cos(center.lat*Math.PI/180)))/2 + j*stepLon;
        results.push({ lat: cellLat, lon: cellLon, risk: RiskEngine.assessPoint(incidents, cellLat, cellLon, gridSizeKm*1000/cellsPerSide/2) });
      }
    }
    return results;
  }

  /**
   * Risk at a point from the incidents whose radius (plus `marginM`) covers it:
   * severity = most severe covering incident, likelihood grows with corroborating incidents,
   * exposure falls off linearly with distance to the nearest incident, confidence = mean confidence.
   */
  static assessPoint(incidents: IncidentEvent[], lat: number, lon: number, marginM = 0, source = 'grid'): RiskResult {
    const near = incidents
      .filter(inc => inc.location)
      .map(inc => ({ inc, d: RiskEngine.distanceM(lat, lon, inc.location!.lat, inc.location!.lon), r: inc.radius_m + marginM }))
      .filter(x => x.d <= x.r);
    if (near.length === 0) return RiskEngine.calculate({ severity: 0, likelihood: 0, exposure: 0, data_confidence: 0.1, location: { lat, lon }, source });
    const lv: Record<RiskLevel, number> = { low: 0.2, medium: 0.5, high: 0.75, critical: 1.0 };
    const severity = Math.max(...near.map(x => lv[x.inc.severity]));
    const likelihood = Math.min(1, 0.4 + 0.2 * (near.length - 1));
    const exposure = Math.max(...near.map(x => Math.max(0.2, 1 - x.d / x.r)));
    const data_confidence = near.reduce((s, x) => s + x.inc.confidence, 0) / near.length;
    return RiskEngine.calculate({ severity, likelihood, exposure, data_confidence, location: { lat, lon }, evidence: near.map(x => x.inc.incident_id), source });
  }

  static distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R=6371000, dLat=(lat2-lat1)*Math.PI/180, dLon=(lon2-lon1)*Math.PI/180;
    const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
  }
}
