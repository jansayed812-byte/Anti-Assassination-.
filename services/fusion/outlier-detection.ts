/**
 * Outlier Detection for Sensor Fusion
 */
import { Vector3, Matrix3 } from './kalman-filter';

export class OutlierDetector {
  static mahalanobisDistance(measurement: Vector3, predicted: Vector3, covariance: Matrix3): number {
    const inn = measurement.subtract(predicted);
    const ci = covariance.invert();
    const { x, y, z } = inn;
    const t1 = ci.data[0][0]*x+ci.data[0][1]*y+ci.data[0][2]*z;
    const t2 = ci.data[1][0]*x+ci.data[1][1]*y+ci.data[1][2]*z;
    const t3 = ci.data[2][0]*x+ci.data[2][1]*y+ci.data[2][2]*z;
    return Math.sqrt(Math.max(0, x*t1+y*t2+z*t3));
  }

  static residualDistance(measurement: Vector3, predicted: Vector3): number { return measurement.subtract(predicted).magnitude(); }

  static isOutlier(measurement: Vector3, predicted: Vector3, covariance: Matrix3, threshold = 5.0): boolean {
    return this.mahalanobisDistance(measurement, predicted, covariance) > threshold;
  }

  static gateOutliers(measurements: Array<{data: Vector3; confidence: number}>, predicted: Vector3, covariance: Matrix3, threshold = 5.0): Array<{data: Vector3; confidence: number}> {
    return measurements.filter(m => this.mahalanobisDistance(m.data, predicted, covariance) <= threshold);
  }

  static isStatisticallyValid(measurement: Vector3, predicted: Vector3, covariance: Matrix3, sigmas = 3): boolean {
    const d = this.residualDistance(measurement, predicted);
    const variance = (covariance.data[0][0]+covariance.data[1][1]+covariance.data[2][2])/3;
    return d <= sigmas * Math.sqrt(Math.max(0, variance));
  }
}

export class SensorQualityAssessor {
  static assessAccuracy(h: number, v: number, target = 50): number { return (Math.max(0,1-h/target)+Math.max(0,1-v/target))/2; }

  static assessFixQuality(fixType: string, satellites: number, hdop: number): number {
    let c = 0;
    if (fixType==='rtk_fixed') c+=0.6; else if (fixType==='3d') c+=0.4; else if (fixType==='2d') c+=0.2;
    if (satellites>=12) c+=0.2; else if (satellites>=8) c+=0.15; else if (satellites>=4) c+=0.1;
    if (hdop<2) c+=0.2; else if (hdop<5) c+=0.15; else if (hdop<10) c+=0.1;
    return Math.min(1, c);
  }

  static assessSignalQuality(rssi: number): number {
    if (rssi>-50) return 1.0; if (rssi>-70) return 0.8; if (rssi>-80) return 0.6; if (rssi>-100) return 0.4; return 0.1;
  }

  static assessIMUHealth(status: 'healthy'|'degraded'|'failed', temp: number): number {
    let c = status==='healthy' ? 0.95 : status==='degraded' ? 0.6 : 0.0;
    if (Math.abs(temp-22.5)>40) c*=0.5; else if (Math.abs(temp-22.5)>20) c*=0.8;
    return Math.max(0, c);
  }

  static assessOverallQuality(acc: number, sig: number, fix: number): number { return acc*0.4+sig*0.3+fix*0.3; }
}

export class ResidualAnalyzer {
  private residuals: number[] = [];
  private maxHistory = 100;
  addResidual(r: number): void { this.residuals.push(Math.abs(r)); if (this.residuals.length>this.maxHistory) this.residuals.shift(); }
  getMeanResidual(): number { return this.residuals.length===0 ? 0 : this.residuals.reduce((a,b)=>a+b)/this.residuals.length; }
  getStdDeviation(): number {
    if (this.residuals.length<2) return 0;
    const m = this.getMeanResidual();
    return Math.sqrt(this.residuals.reduce((s,v)=>s+(v-m)**2,0)/this.residuals.length);
  }
  detectBias(threshold = 2.0): boolean { return this.getMeanResidual()>threshold; }
  detectDrift(): boolean {
    if (this.residuals.length<20) return false;
    const r = this.residuals.slice(-10), o = this.residuals.slice(-20,-10);
    return r.reduce((a,b)=>a+b)/r.length > o.reduce((a,b)=>a+b)/o.length * 1.5;
  }
  clear(): void { this.residuals = []; }
}
