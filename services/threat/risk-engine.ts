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
    else if (score >= 0.15) { level = 'medium'; color = '#EAB308'; }
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
        const near = incidents.filter(inc => inc.location && RiskEngine.distanceM(cellLat, cellLon, inc.location.lat, inc.location.lon) <= inc.radius_m + (gridSizeKm*1000/cellsPerSide/2));
        let severity=0, likelihood=0, exposure=0, confidence=0;
        if (near.length > 0) {
          const lv = (l: RiskLevel) => ({low:0.2,medium:0.5,high:0.75,critical:1.0}[l]);
          severity = near.reduce((s,i)=>s+lv(i.severity),0)/near.length;
          likelihood = Math.min(1, near.length*0.25);
          exposure = Math.min(1, near.length*0.3);
          confidence = near.reduce((s,i)=>s+i.confidence,0)/near.length;
        }
        results.push({ lat: cellLat, lon: cellLon, risk: RiskEngine.calculate({ severity, likelihood, exposure, data_confidence: confidence||0.1, source: 'grid' }) });
      }
    }
    return results;
  }

  static distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R=6371000, dLat=(lat2-lat1)*Math.PI/180, dLon=(lon2-lon1)*Math.PI/180;
    const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
  }
}
