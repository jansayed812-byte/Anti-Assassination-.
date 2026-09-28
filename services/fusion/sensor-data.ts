/**
 * Sensor Data Models
 */

export interface GNSSData {
  fix_type: 'none' | '2d' | '3d' | 'rtk_fixed' | 'rtk_float';
  latitude: number; longitude: number; altitude_m: number;
  velocity_north_mps: number; velocity_east_mps: number; velocity_down_mps: number;
  hdop: number; vdop: number; pdop: number;
  h_accuracy_m: number; v_accuracy_m: number;
  gnss_constellation: 'gps' | 'glonass' | 'beidou' | 'galileo' | 'mixed';
  satellites_used: number; satellites_visible: number;
  utc_time: string;
}

export interface INSData {
  acceleration_x: number; acceleration_y: number; acceleration_z: number;
  angular_rate_x: number; angular_rate_y: number; angular_rate_z: number;
  roll_deg: number; pitch_deg: number; yaw_deg: number;
  imu_status: 'healthy' | 'degraded' | 'failed';
  temperature_c: number;
}

export interface WiFiRTTData {
  access_point_mac: string; access_point_ssid?: string;
  latitude: number; longitude: number;
  accuracy_m: number; rssi_dbm: number; rtt_ns: number;
  source_type: 'wifi_rtt';
}

export interface BLEBeaconData {
  beacon_uuid: string; beacon_major: number; beacon_minor: number; beacon_name?: string;
  latitude: number; longitude: number;
  rssi_dbm: number; distance_m: number; tx_power_dbm: number;
  accuracy_m: number; source_type: 'ble';
}

export interface CellularData {
  cell_id: string; lac: string; mcc: string; mnc: string;
  latitude: number; longitude: number;
  signal_strength_dbm: number; accuracy_m: number;
  source_type: 'cellular';
}

export interface SensorDataUnion {
  timestamp: string; source_id: string;
  data: GNSSData | INSData | WiFiRTTData | BLEBeaconData | CellularData;
}

export interface ENUCoordinate { east_m: number; north_m: number; up_m: number; }
export interface ENUReference { reference_latitude: number; reference_longitude: number; reference_altitude_m: number; }

export class CoordinateConverter {
  private static readonly EARTH_RADIUS_M = 6371000;
  private static readonly WGS84_E2 = 0.00669438;

  static geodeticToENU(lat: number, lon: number, alt: number, reference: ENUReference): ENUCoordinate {
    const lat_rad = lat * Math.PI / 180, lon_rad = lon * Math.PI / 180;
    const ref_lat_rad = reference.reference_latitude * Math.PI / 180, ref_lon_rad = reference.reference_longitude * Math.PI / 180;
    const N = this.EARTH_RADIUS_M / Math.sqrt(1 - this.WGS84_E2 * Math.sin(lat_rad) ** 2);
    const x = (N + alt) * Math.cos(lat_rad) * Math.cos(lon_rad);
    const y = (N + alt) * Math.cos(lat_rad) * Math.sin(lon_rad);
    const z = (N * (1 - this.WGS84_E2) + alt) * Math.sin(lat_rad);
    const N_ref = this.EARTH_RADIUS_M / Math.sqrt(1 - this.WGS84_E2 * Math.sin(ref_lat_rad) ** 2);
    const x_ref = (N_ref + reference.reference_altitude_m) * Math.cos(ref_lat_rad) * Math.cos(ref_lon_rad);
    const y_ref = (N_ref + reference.reference_altitude_m) * Math.cos(ref_lat_rad) * Math.sin(ref_lon_rad);
    const z_ref = (N_ref * (1 - this.WGS84_E2) + reference.reference_altitude_m) * Math.sin(ref_lat_rad);
    const dx = x - x_ref, dy = y - y_ref, dz = z - z_ref;
    const sl = Math.sin(ref_lat_rad), cl = Math.cos(ref_lat_rad), sn = Math.sin(ref_lon_rad), cn = Math.cos(ref_lon_rad);
    return { east_m: -sn * dx + cn * dy, north_m: -sl * cn * dx - sl * sn * dy + cl * dz, up_m: cl * cn * dx + cl * sn * dy + sl * dz };
  }

  static ENUToGeodetic(enu: ENUCoordinate, reference: ENUReference): { lat: number; lon: number; alt: number } {
    const dlat = enu.north_m / this.EARTH_RADIUS_M * 180 / Math.PI;
    const dlon = enu.east_m / (this.EARTH_RADIUS_M * Math.cos(reference.reference_latitude * Math.PI / 180)) * 180 / Math.PI;
    return { lat: reference.reference_latitude + dlat, lon: reference.reference_longitude + dlon, alt: reference.reference_altitude_m + enu.up_m };
  }
}

export interface MeasurementCovariance { position: number[][]; velocity?: number[][]; confidence?: number; }

export function generateCovariance(h_accuracy_m: number, v_accuracy_m: number, confidence = 1.0): MeasurementCovariance {
  const h_var = (h_accuracy_m ** 2) / (confidence ** 2);
  const v_var = (v_accuracy_m ** 2) / (confidence ** 2);
  return { position: [[h_var, 0, 0], [0, h_var, 0], [0, 0, v_var]], confidence };
}

export function validateSensorData(data: any, sensorType: string): boolean {
  switch (sensorType) {
    case 'gnss': { const g = data as GNSSData; return g.fix_type !== 'none' && g.hdop < 10 && g.latitude >= -90 && g.latitude <= 90 && g.longitude >= -180 && g.longitude <= 180; }
    case 'ins': return (data as INSData).imu_status !== 'failed';
    case 'wifi': { const w = data as WiFiRTTData; return w.accuracy_m > 0 && w.rssi_dbm < 0; }
    case 'ble': { const b = data as BLEBeaconData; return b.accuracy_m > 0 && b.distance_m > 0; }
    case 'cellular': return (data as CellularData).accuracy_m > 0;
    default: return false;
  }
}
