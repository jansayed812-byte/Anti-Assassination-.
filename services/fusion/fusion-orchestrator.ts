/**
 * Fusion Orchestrator
 */
import { GNSSData, WiFiRTTData, BLEBeaconData, CellularData, ENUReference, CoordinateConverter, generateCovariance, validateSensorData } from './sensor-data';
import { KalmanFilter, Vector3, Matrix3 } from './kalman-filter';
import { OutlierDetector, SensorQualityAssessor, ResidualAnalyzer } from './outlier-detection';

export interface FusionConfig {
  enuReference: ENUReference;
  updateRateHz?: number;
  outlierThreshold?: number;
  confidenceThreshold?: number;
  enableOutlierDetection?: boolean;
}

export interface FusionResult {
  position: { lat: number; lon: number; alt: number };
  enu: { east_m: number; north_m: number; up_m: number };
  velocity: { north_mps: number; east_mps: number; down_mps: number };
  accuracy: { h_accuracy_m: number; v_accuracy_m: number; uncertainty_m: number };
  sources: string[];
  confidence: number;
  isDegraded: boolean;
  timestamp: string;
}

export class FusionOrchestrator {
  private config: Required<FusionConfig>;
  private kalmanFilter: KalmanFilter;
  private residualAnalyzer: ResidualAnalyzer;
  private lastFusionTime = 0;
  private sourceHistory = new Map<string, any>();
  private initialized = false;
  private consecutiveRejects = 0;
  private static readonly REACQUIRE_AFTER = 5;
  private static readonly UNCONSTRAINED_VAR = 1e8;

  constructor(config: FusionConfig) {
    this.config = { updateRateHz: 10, outlierThreshold: 5.0, confidenceThreshold: 0.3, enableOutlierDetection: true, ...config };
    this.kalmanFilter = new KalmanFilter(new Vector3(), new Vector3(), 1.0 / this.config.updateRateHz);
    this.residualAnalyzer = new ResidualAnalyzer();
  }

  async processMeasurements(measurements: Array<{sourceId: string; sourceType: string; data: any; timestamp: number}>): Promise<FusionResult> {
    const valid = measurements.filter(m => validateSensorData(m.data, m.sourceType));
    if (valid.length === 0) throw new Error('No valid measurements to fuse');
    // Outlier gating needs a track to gate against: seed it from the most confident fix, and
    // re-acquire after sustained total rejection so the filter cannot stay locked on a stale state.
    if (!this.initialized || this.consecutiveRejects >= FusionOrchestrator.REACQUIRE_AFTER) this.initializeTrack(valid);
    const dt = (Date.now() - this.lastFusionTime) / 1000;
    this.kalmanFilter.predict(dt);
    this.lastFusionTime = Date.now();
    const ps = this.kalmanFilter.getState();
    const predicted = new Vector3(ps.position.x, ps.position.y, ps.position.z);
    const fusedSources: string[] = [];
    let totalConfidence = 0;
    for (const m of valid) {
      const { enuMeasurement, covariance, confidence } = this.convertToENU(m.sourceType, m.data, predicted.z);
      if (this.config.enableOutlierDetection && OutlierDetector.isOutlier(enuMeasurement, predicted, covariance, this.config.outlierThreshold)) continue;
      this.kalmanFilter.update(enuMeasurement, covariance, confidence);
      const residual = OutlierDetector.residualDistance(enuMeasurement, predicted);
      this.residualAnalyzer.addResidual(residual);
      fusedSources.push(`${m.sourceType}:${m.sourceId}`);
      totalConfidence += confidence;
      this.sourceHistory.set(m.sourceId, { timestamp: m.timestamp, data: m.data, confidence, residual });
    }
    this.consecutiveRejects = fusedSources.length === 0 ? this.consecutiveRejects + 1 : 0;
    const s = this.kalmanFilter.getState();
    const geodetic = CoordinateConverter.ENUToGeodetic({ east_m: s.position.x, north_m: s.position.y, up_m: s.position.z }, this.config.enuReference);
    const uncertainty = this.kalmanFilter.getPositionUncertainty();
    const confidence = fusedSources.length > 0 ? Math.min(1, totalConfidence / fusedSources.length) : 0;
    return {
      position: { lat: geodetic.lat, lon: geodetic.lon, alt: geodetic.alt },
      enu: { east_m: s.position.x, north_m: s.position.y, up_m: s.position.z },
      velocity: { north_mps: s.velocity.y, east_mps: s.velocity.x, down_mps: -s.velocity.z },
      accuracy: { h_accuracy_m: uncertainty, v_accuracy_m: uncertainty * 1.5, uncertainty_m: uncertainty },
      sources: fusedSources, confidence, isDegraded: this.residualAnalyzer.detectDrift() || confidence < this.config.confidenceThreshold,
      timestamp: new Date().toISOString()
    };
  }

  private initializeTrack(valid: Array<{ sourceType: string; data: any }>): void {
    const seed = valid.map(m => this.convertToENU(m.sourceType, m.data)).sort((a, b) => b.confidence - a.confidence)[0];
    this.kalmanFilter = new KalmanFilter(seed.enuMeasurement, new Vector3(), 1.0 / this.config.updateRateHz);
    this.residualAnalyzer = new ResidualAnalyzer();
    this.initialized = true;
    this.consecutiveRejects = 0;
  }

  /**
   * Wi-Fi/BLE/cellular fixes are horizontal-only: they are placed at the track's current height
   * (`currentUp`, metres above the ENU reference) with an effectively unbounded vertical variance,
   * so they constrain east/north without dragging the altitude — or failing the outlier gate on it.
   */
  private convertToENU(sourceType: string, data: any, currentUp = 0): { enuMeasurement: Vector3; covariance: Matrix3; confidence: number } {
    const horizontal = (lat: number, lon: number, hAcc: number, q: number) => {
      const enu = CoordinateConverter.geodeticToENU(lat, lon, this.config.enuReference.reference_altitude_m + currentUp, this.config.enuReference);
      const cov = generateCovariance(hAcc, hAcc, q).position;
      cov[2][2] = FusionOrchestrator.UNCONSTRAINED_VAR;
      return { enuMeasurement: new Vector3(enu.east_m, enu.north_m, currentUp), covariance: new Matrix3(cov), confidence: q };
    };
    switch (sourceType) {
      case 'gnss': { const g = data as GNSSData; const q = SensorQualityAssessor.assessFixQuality(g.fix_type, g.satellites_used, g.hdop); const enu = CoordinateConverter.geodeticToENU(g.latitude, g.longitude, g.altitude_m, this.config.enuReference); return { enuMeasurement: new Vector3(enu.east_m, enu.north_m, enu.up_m), covariance: new Matrix3(generateCovariance(g.h_accuracy_m, g.v_accuracy_m, q).position), confidence: q }; }
      case 'wifi': { const w = data as WiFiRTTData; return horizontal(w.latitude, w.longitude, w.accuracy_m, SensorQualityAssessor.assessSignalQuality(w.rssi_dbm)); }
      case 'ble': { const b = data as BLEBeaconData; return horizontal(b.latitude, b.longitude, b.accuracy_m, SensorQualityAssessor.assessSignalQuality(b.rssi_dbm) * 0.7); }
      case 'cellular': { const c = data as CellularData; return horizontal(c.latitude, c.longitude, c.accuracy_m, 0.5); }
      default: throw new Error(`Unknown source type: ${sourceType}`);
    }
  }

  predictDeadReckoning(dt: number): FusionResult {
    this.kalmanFilter.predict(dt);
    const s = this.kalmanFilter.getState();
    const enu = { east_m: s.position.x, north_m: s.position.y, up_m: s.position.z };
    const g = CoordinateConverter.ENUToGeodetic(enu, this.config.enuReference);
    const u = this.kalmanFilter.getPositionUncertainty();
    return { position: { lat: g.lat, lon: g.lon, alt: g.alt }, enu, velocity: { north_mps: s.velocity.y, east_mps: s.velocity.x, down_mps: -s.velocity.z }, accuracy: { h_accuracy_m: u, v_accuracy_m: u*1.5, uncertainty_m: u }, sources: ['dead_reckoning'], confidence: 0.5, isDegraded: true, timestamp: new Date().toISOString() };
  }

  getDiagnostics(): Record<string, any> {
    return { meanResidual: this.residualAnalyzer.getMeanResidual(), stdDeviation: this.residualAnalyzer.getStdDeviation(), biasDetected: this.residualAnalyzer.detectBias(), driftDetected: this.residualAnalyzer.detectDrift(), uncertainty: this.kalmanFilter.getPositionUncertainty(), sourceCount: this.sourceHistory.size };
  }
}
