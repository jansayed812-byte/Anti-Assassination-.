import React from 'react';
import { StatusBar } from './components/StatusBar';
import { AlertPanel } from './components/AlertPanel';
import { Map2D } from './components/Map2D';
import { Map3D } from './components/Map3D';
import { useAppStore } from './stores/appStore';
import { useWebSocket } from './hooks/useWebSocket';
import { OfflineBanner } from './components/OfflineBanner';

export default function App() {
  useWebSocket();
  const mapMode = useAppStore((s) => s.mapMode);

  return (
    <>
      <StatusBar />
      <div style={{ position: 'relative', flex: 1, display: 'flex', overflow: 'hidden' }}>
        {mapMode === '2d' ? <Map2D /> : <Map3D />}
        <AlertPanel />
        <OfflineBanner />
      </div>
    </>
  );
}
