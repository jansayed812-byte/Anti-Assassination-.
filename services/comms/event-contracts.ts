/**
 * Base Event Contract
 * قرارداد پایهٔ رویدادهای سیستم (Event Contract)
 */

export interface EventQuality {
  fix?: string;
  hdop?: number;
  vdop?: number;
  confidence?: number;
  [key: string]: any;
}

export interface EventIntegrity {
  hash?: string;
  signature?: string;
  algorithm?: string;
}

export interface EventPayload {
  [key: string]: any;
}

export interface BaseEvent {
  event_id: string;
  source_id: string;
  source_type: string;
  captured_at: string;
  received_at: string;
  sequence: number;
  idempotency_key?: string;
  quality: EventQuality;
  payload: EventPayload;
  integrity: EventIntegrity;
  [key: string]: any;
}

export interface PositionEvent extends BaseEvent {
  source_type: 'gnss' | 'wifi' | 'ble' | 'cellular' | 'ins';
  payload: {
    lat: number;
    lon: number;
    alt_m: number;
    speed_mps: number;
    bearing_deg?: number;
    accuracy_m?: number;
    hdop?: number;
    vdop?: number;
  };
}

export interface EnvironmentalEvent extends BaseEvent {
  source_type: 'environmental';
  payload: {
    temperature_c?: number;
    humidity_percent?: number;
    wind_speed_mps?: number;
    visibility_m?: number;
    precipitation_mm?: number;
    atmospheric_pressure_hpa?: number;
  };
}

export interface RiskAssessmentEvent extends BaseEvent {
  source_type: 'risk_engine';
  payload: {
    severity: number;
    likelihood: number;
    exposure: number;
    data_confidence: number;
    risk_score: number;
    risk_level: 'low' | 'medium' | 'high' | 'critical';
    location?: { lat: number; lon: number; };
  };
}

export interface VideoDetectionEvent extends BaseEvent {
  source_type: 'camera';
  payload: {
    frame_id: string;
    timestamp_ms: number;
    detections: Array<{
      class: string;
      confidence: number;
      bbox: [number, number, number, number];
      motion_detected?: boolean;
      boundary_crossing?: boolean;
    }>;
  };
}

export interface AlertEvent extends BaseEvent {
  source_type: 'alert_system';
  payload: {
    alert_type: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    message: string;
    affected_system?: string;
    recommended_action?: string;
  };
}

export function isValidBaseEvent(event: any): event is BaseEvent {
  return (
    typeof event.event_id === 'string' &&
    typeof event.source_id === 'string' &&
    typeof event.source_type === 'string' &&
    typeof event.captured_at === 'string' &&
    typeof event.received_at === 'string' &&
    typeof event.sequence === 'number' &&
    event.quality !== undefined &&
    event.payload !== undefined &&
    event.integrity !== undefined
  );
}

export class EventFactory {
  static createPositionEvent(
    sourceId: string,
    sourceType: 'gnss' | 'wifi' | 'ble' | 'cellular' | 'ins',
    lat: number,
    lon: number,
    alt_m: number,
    speed_mps: number,
    quality: EventQuality,
    sequence: number
  ): PositionEvent {
    const now = new Date().toISOString();
    return {
      event_id: this.generateUUID(),
      source_id: sourceId,
      source_type: sourceType,
      captured_at: now,
      received_at: now,
      sequence,
      quality,
      payload: { lat, lon, alt_m, speed_mps },
      integrity: { hash: this.calculateHash({ lat, lon, alt_m, speed_mps }), algorithm: 'sha256' }
    };
  }

  static createEnvironmentalEvent(
    sourceId: string,
    data: Record<string, any>,
    sequence: number
  ): EnvironmentalEvent {
    const now = new Date().toISOString();
    return {
      event_id: this.generateUUID(),
      source_id: sourceId,
      source_type: 'environmental',
      captured_at: now,
      received_at: now,
      sequence,
      quality: { confidence: 0.95 },
      payload: data,
      integrity: { hash: this.calculateHash(data), algorithm: 'sha256' }
    };
  }

  static createRiskEvent(
    severity: number,
    likelihood: number,
    exposure: number,
    dataConfidence: number,
    lat?: number,
    lon?: number,
    sequence: number = 0
  ): RiskAssessmentEvent {
    const now = new Date().toISOString();
    const riskScore = severity * likelihood * exposure * dataConfidence;
    let riskLevel: 'low' | 'medium' | 'high' | 'critical';
    // Keep in sync with RiskEngine.calculate thresholds (services/threat/risk-engine.ts)
    if (riskScore >= 0.6) riskLevel = 'critical';
    else if (riskScore >= 0.35) riskLevel = 'high';
    else if (riskScore >= 0.05) riskLevel = 'medium';
    else riskLevel = 'low';
    return {
      event_id: this.generateUUID(),
      source_id: 'risk-engine',
      source_type: 'risk_engine',
      captured_at: now,
      received_at: now,
      sequence,
      quality: { confidence: dataConfidence },
      payload: { severity, likelihood, exposure, data_confidence: dataConfidence, risk_score: riskScore, risk_level: riskLevel, location: lat !== undefined && lon !== undefined ? { lat, lon } : undefined },
      integrity: { hash: this.calculateHash({ severity, likelihood, exposure, dataConfidence }), algorithm: 'sha256' }
    };
  }

  private static generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  private static calculateHash(data: any): string {
    const str = JSON.stringify(data);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return 'sha256:' + Math.abs(hash).toString(16);
  }
}

export const EVENT_SCHEMAS = {
  POSITION: {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    required: ['event_id', 'source_id', 'source_type', 'captured_at', 'sequence', 'payload'],
    properties: {
      event_id: { type: 'string', format: 'uuid' },
      source_id: { type: 'string' },
      source_type: { enum: ['gnss', 'wifi', 'ble', 'cellular', 'ins'] },
      captured_at: { type: 'string', format: 'date-time' },
      received_at: { type: 'string', format: 'date-time' },
      sequence: { type: 'integer', minimum: 0 },
      quality: { type: 'object' },
      payload: {
        type: 'object',
        required: ['lat', 'lon', 'alt_m', 'speed_mps'],
        properties: {
          lat: { type: 'number', minimum: -90, maximum: 90 },
          lon: { type: 'number', minimum: -180, maximum: 180 },
          alt_m: { type: 'number' },
          speed_mps: { type: 'number', minimum: 0 }
        }
      },
      integrity: { type: 'object' }
    }
  }
};
