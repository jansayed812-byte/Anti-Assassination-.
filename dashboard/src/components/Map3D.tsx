import React, { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/appStore';

declare const Cesium: any;

export const Map3D: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const positions = useAppStore((s) => s.positions);
  const incidents = useAppStore((s) => s.incidents);
  const mapCenter = useAppStore((s) => s.mapCenter);

  useEffect(() => {
    if (!containerRef.current || typeof Cesium === 'undefined') return;

    Cesium.Ion.defaultAccessToken = window.__CESIUM_TOKEN__ || '';
    const viewer = new Cesium.Viewer(containerRef.current, {
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      animation: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
      navigationHelpButton: false,
    });
    viewerRef.current = viewer;

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(mapCenter.lon, mapCenter.lat, 2000),
    });

    return () => {
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.destroy();
      }
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    viewer.entities.removeAll();

    Array.from(positions.values()).forEach((pos) => {
      const color = pos.is_degraded ? Cesium.Color.YELLOW : Cesium.Color.BLUE;
      viewer.entities.add({
        id: `pos-${pos.source_id}`,
        position: Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.alt_m || 0),
        point: { pixelSize: 12, color, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
        label: {
          text: pos.source_id,
          font: '12px sans-serif',
          fillColor: Cesium.Color.WHITE,
          pixelOffset: new Cesium.Cartesian2(0, -20),
        },
      });
    });

    incidents.forEach((inc) => {
      if (!inc.lat || !inc.lon) return;
      const colorMap: Record<string, any> = {
        low: Cesium.Color.GREEN.withAlpha(0.3),
        medium: Cesium.Color.YELLOW.withAlpha(0.3),
        high: Cesium.Color.ORANGE.withAlpha(0.3),
        critical: Cesium.Color.RED.withAlpha(0.3),
      };
      viewer.entities.add({
        id: `inc-${inc.incident_id}`,
        position: Cesium.Cartesian3.fromDegrees(inc.lon, inc.lat, 10),
        cylinder: {
          length: 100,
          topRadius: inc.radius_m,
          bottomRadius: inc.radius_m,
          material: colorMap[inc.severity] || Cesium.Color.RED.withAlpha(0.3),
          outline: true,
          outlineColor: colorMap[inc.severity]?.withAlpha(0.8) || Cesium.Color.RED,
        },
      });
    });
  }, [positions, incidents]);

  return (
    <div ref={containerRef} style={{ flex: 1, width: '100%', position: 'relative' }}>
      {typeof Cesium === 'undefined' && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: '#0f172a', color: '#94a3b8', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ fontSize: 48 }}>🌐</div>
          <div>نقشه ۳D در حال بارگذاری...</div>
          <div style={{ fontSize: 12, color: '#475569' }}>نیاز به CesiumJS</div>
        </div>
      )}
    </div>
  );
};

declare global {
  interface Window { __CESIUM_TOKEN__: string; }
}
