/**
 * Threat/Risk API - Phase 4
 */
import express from 'express';
import { RiskEngine, RiskInput, IncidentEvent } from './risk-engine';

export function createThreatRouter(): express.Router {
  const router = express.Router();
  const incidents: IncidentEvent[] = [];

  router.post('/calculate', (req, res) => {
    const body = req.body as RiskInput;
    if (typeof body.severity !== 'number' || typeof body.likelihood !== 'number' || typeof body.exposure !== 'number' || typeof body.data_confidence !== 'number') {
      return res.status(400).json({ error: 'severity, likelihood, exposure, data_confidence required (0-1)' });
    }
    res.json(RiskEngine.calculate(body));
  });

  router.get('/grid', (req, res) => {
    const lat = parseFloat(req.query.lat as string);
    const lon = parseFloat(req.query.lon as string);
    const sizeKm = parseFloat(req.query.size_km as string) || 1;
    if (isNaN(lat) || isNaN(lon)) return res.status(400).json({ error: 'lat and lon required' });
    const grid = RiskEngine.buildGrid(incidents, { lat, lon }, sizeKm);
    res.json({ grid, count: grid.length, center: { lat, lon }, size_km: sizeKm });
  });

  router.post('/incidents', (req, res) => {
    const inc = req.body as IncidentEvent;
    inc.incident_id = `inc-${Date.now()}`;
    inc.observed_at = inc.observed_at || new Date().toISOString();
    inc.human_validation_status = 'pending';
    incidents.push(inc);
    res.status(201).json(inc);
  });

  router.get('/incidents', (_req, res) => { res.json({ incidents, count: incidents.length }); });

  router.patch('/incidents/:id/validate', (req, res) => {
    const inc = incidents.find(i => i.incident_id === req.params.id);
    if (!inc) return res.status(404).json({ error: 'Not found' });
    inc.human_validation_status = req.body.status || 'confirmed';
    res.json(inc);
  });

  return router;
}
