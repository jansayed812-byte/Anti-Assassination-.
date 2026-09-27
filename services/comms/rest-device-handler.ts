/**
 * Phase 7: REST Device Handler
 */
import express from 'express';

export interface DevicePositionPayload {
  device_id: string;
  lat: number;
  lon: number;
  alt_m?: number;
  speed_mps?: number;
  accuracy_m?: number;
  hdop?: number;
  fix_type?: number;
  timestamp?: string;
}

export interface MAVLinkGPSPayload {
  sysid: number;
  compid: number;
  lat: number;
  lon: number;
  alt: number;
  vel: number;
  hdop: number;
  fix_type: number;
  satellites_visible: number;
}

function normalizeMavlink(m: MAVLinkGPSPayload): DevicePositionPayload {
  return { device_id: `mav-${m.sysid}-${m.compid}`, lat: m.lat / 1e7, lon: m.lon / 1e7, alt_m: m.alt / 1000, speed_mps: m.vel / 100, accuracy_m: m.hdop / 100, hdop: m.hdop / 100, fix_type: m.fix_type, timestamp: new Date().toISOString() };
}

export function createDeviceRouter(onPosition: (p: DevicePositionPayload) => void): express.Router {
  const router = express.Router();

  router.post('/position', (req, res) => {
    const body = req.body as DevicePositionPayload;
    if (typeof body.lat !== 'number' || typeof body.lon !== 'number' || !body.device_id) {
      return res.status(400).json({ error: 'device_id, lat, lon required' });
    }
    body.timestamp = body.timestamp ?? new Date().toISOString();
    onPosition(body);
    res.json({ ok: true });
  });

  router.post('/mavlink/gps', (req, res) => {
    const body = req.body as MAVLinkGPSPayload;
    if (typeof body.lat !== 'number' || typeof body.lon !== 'number') {
      return res.status(400).json({ error: 'MAVLink GPS fields required' });
    }
    onPosition(normalizeMavlink(body));
    res.json({ ok: true });
  });

  return router;
}
