import React from 'react';
import { useAppStore } from '../stores/appStore';

const STATUS_LABEL: Record<string, string> = {
  connected: 'متصل',
  disconnected: 'قطع',
  degraded: 'ضعیف',
};

const STATUS_COLOR: Record<string, string> = {
  connected: '#22c55e',
  disconnected: '#ef4444',
  degraded: '#eab308',
};

export const StatusBar: React.FC = () => {
  const connectionStatus = useAppStore((s) => s.connectionStatus);
  const mapMode = useAppStore((s) => s.mapMode);
  const setMapMode = useAppStore((s) => s.setMapMode);
  const positions = useAppStore((s) => s.positions);
  const incidents = useAppStore((s) => s.incidents);
  const isOffline = useAppStore((s) => s.isOffline);
  const pendingSyncCount = useAppStore((s) => s.pendingSyncCount);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '6px 16px',
      background: '#1e293b',
      borderBottom: '1px solid #334155',
      fontSize: 13,
      gap: 16,
      flexShrink: 0,
    }}>
      <span style={{ fontWeight: 700, color: '#f1f5f9', whiteSpace: 'nowrap' }}>
        سامانه ارزیابی امنیتی
      </span>

      <div style={{ display: 'flex', gap: 20, color: '#94a3b8' }}>
        <span>موقعیت‌ها: <b style={{ color: '#f1f5f9' }}>{positions.size}</b></span>
        <span>رخدادها: <b style={{ color: '#f1f5f9' }}>{incidents.length}</b></span>
        {isOffline && (
          <span style={{ color: '#eab308' }}>آفلاین | صف: {pendingSyncCount}</span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 4 }}>
        {(['2d', '3d'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setMapMode(mode)}
            style={{
              padding: '3px 12px',
              borderRadius: 4,
              background: mapMode === mode ? '#3b82f6' : '#334155',
              color: mapMode === mode ? '#fff' : '#94a3b8',
              fontSize: 12,
              fontWeight: 600,
              transition: 'background 0.2s',
            }}
          >
            {mode.toUpperCase()}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: STATUS_COLOR[connectionStatus],
          boxShadow: `0 0 6px ${STATUS_COLOR[connectionStatus]}`,
        }} />
        <span style={{ color: STATUS_COLOR[connectionStatus], fontWeight: 600 }}>
          {STATUS_LABEL[connectionStatus]}
        </span>
      </div>
    </div>
  );
};
