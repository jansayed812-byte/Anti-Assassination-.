import React, { useEffect } from 'react';
import { MapContainer, TileLayer, CircleMarker, Circle, Popup, useMap } from 'react-leaflet';
import { useAppStore } from '../stores/appStore';
import type { Position, Incident } from '../stores/appStore';

const RISK_COLOR: Record<string, string> = {
  low: '#22c55e',
  medium: '#eab308',
  high: '#f97316',
  critical: '#ef4444',
};

const CenterUpdater: React.FC = () => {
  const map = useMap();
  const mapCenter = useAppStore((s) => s.mapCenter);
  useEffect(() => {
    map.setView([mapCenter.lat, mapCenter.lon]);
  }, [mapCenter.lat, mapCenter.lon]);
  return null;
};

const PositionMarker: React.FC<{ pos: Position }> = ({ pos }) => (
  <CircleMarker
    center={[pos.lat, pos.lon]}
    radius={8}
    pathOptions={{
      color: pos.is_degraded ? '#eab308' : '#3b82f6',
      fillColor: pos.is_degraded ? '#eab308' : '#3b82f6',
      fillOpacity: 0.9,
      weight: 2,
    }}
  >
    <Popup>
      <div style={{ direction: 'rtl', minWidth: 160 }}>
        <b>{pos.source_id}</b><br />
        دقت: {pos.accuracy_m.toFixed(1)} متر<br />
        سرعت: {(pos.speed_mps * 3.6).toFixed(1)} km/h<br />
        اطمینان: {(pos.confidence * 100).toFixed(0)}%<br />
        {pos.is_degraded && <span style={{ color: '#eab308' }}>⚠ کیفیت پایین</span>}
      </div>
    </Popup>
  </CircleMarker>
);

const IncidentOverlay: React.FC<{ inc: Incident }> = ({ inc }) => {
  if (!inc.lat || !inc.lon) return null;
  const color = RISK_COLOR[inc.severity];
  return (
    <Circle
      center={[inc.lat, inc.lon]}
      radius={inc.radius_m}
      pathOptions={{ color, fillColor: color, fillOpacity: 0.15, weight: 2 }}
    >
      <Popup>
        <div style={{ direction: 'rtl', minWidth: 160 }}>
          <b style={{ color }}>{inc.type}</b><br />
          شدت: {inc.severity}<br />
          اطمینان: {(inc.confidence * 100).toFixed(0)}%<br />
          وضعیت: {inc.human_validation_status}
        </div>
      </Popup>
    </Circle>
  );
};

export const Map2D: React.FC = () => {
  const mapCenter = useAppStore((s) => s.mapCenter);
  const positions = useAppStore((s) => s.positions);
  const incidents = useAppStore((s) => s.incidents);

  return (
    <MapContainer
      center={[mapCenter.lat, mapCenter.lon]}
      zoom={14}
      style={{ flex: 1, width: '100%' }}
      preferCanvas
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="© OpenStreetMap"
      />
      <CenterUpdater />
      {Array.from(positions.values()).map((pos) => (
        <PositionMarker key={pos.source_id} pos={pos} />
      ))}
      {incidents.map((inc) => (
        <IncidentOverlay key={inc.incident_id} inc={inc} />
      ))}
    </MapContainer>
  );
};
