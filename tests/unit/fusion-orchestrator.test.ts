import { describe, it, expect } from 'vitest';
import { FusionOrchestrator } from '../../services/fusion/fusion-orchestrator';

const REF = { reference_latitude: 35.6892, reference_longitude: 51.389, reference_altitude_m: 1200 };
const gnss = (lat: number, lon: number, alt = 1210) => ({
  fix_type: '3d', latitude: lat, longitude: lon, altitude_m: alt, velocity_north_mps: 0, velocity_east_mps: 0, velocity_down_mps: 0,
  hdop: 0.9, vdop: 1.3, pdop: 1.6, h_accuracy_m: 3, v_accuracy_m: 4.5, gnss_constellation: 'mixed', satellites_used: 12, satellites_visible: 16, utc_time: new Date().toISOString(),
});
const wifi = (lat: number, lon: number) => ({ access_point_mac: 'ap', latitude: lat, longitude: lon, accuracy_m: 6, rssi_dbm: -58, rtt_ns: 100, source_type: 'wifi_rtt' });
const cell = (lat: number, lon: number) => ({ cell_id: 'c', latitude: lat, longitude: lon, accuracy_m: 8, rssi_dbm: -85 });
const m = (sourceType: string, data: unknown) => ({ sourceId: sourceType, sourceType, data, timestamp: Date.now() });

describe('FusionOrchestrator', () => {
  it('initializes the track at the first fix instead of the ENU origin', async () => {
    const f = new FusionOrchestrator({ enuReference: REF });
    const r = await f.processMeasurements([m('gnss', gnss(35.695, 51.38))]);
    expect(r.sources).toEqual(['gnss:gnss']);
    expect(Math.abs(r.position.lat - 35.695)).toBeLessThan(1e-4);
    expect(Math.abs(r.position.lon - 51.38)).toBeLessThan(1e-4);
  });

  it('fuses horizontal-only sources (Wi-Fi) at elevation without rejecting them on altitude', async () => {
    const f = new FusionOrchestrator({ enuReference: REF });
    let accepted = 0;
    for (let i = 0; i < 10; i++) {
      const r = await f.processMeasurements([m('gnss', gnss(35.695, 51.38)), m('wifi', wifi(35.695, 51.38))]);
      if (r.sources.includes('wifi:wifi')) accepted++;
      expect(Math.abs(r.position.alt - 1210)).toBeLessThan(3);
    }
    expect(accepted).toBeGreaterThanOrEqual(9);
  });

  it('tracks a cellular-only unit', async () => {
    const f = new FusionOrchestrator({ enuReference: REF });
    const r = await f.processMeasurements([m('cellular', cell(35.68, 51.40))]);
    expect(r.sources).toEqual(['cellular:cellular']);
    expect(Math.abs(r.position.lat - 35.68)).toBeLessThan(1e-4);
  });

  it('rejects a spoofed jump but re-acquires after sustained disagreement', async () => {
    const f = new FusionOrchestrator({ enuReference: REF });
    for (let i = 0; i < 5; i++) await f.processMeasurements([m('gnss', gnss(35.695, 51.38))]);
    const spoof = await f.processMeasurements([m('gnss', gnss(35.705, 51.38))]);
    expect(spoof.sources).toEqual([]);
    expect(Math.abs(spoof.position.lat - 35.695)).toBeLessThan(1e-3);
    let last = spoof;
    for (let i = 0; i < 6; i++) last = await f.processMeasurements([m('gnss', gnss(35.705, 51.38))]);
    expect(last.sources).toEqual(['gnss:gnss']);
    expect(Math.abs(last.position.lat - 35.705)).toBeLessThan(1e-3);
  });
});
