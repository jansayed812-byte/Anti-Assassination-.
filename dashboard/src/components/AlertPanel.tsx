import React, { useState } from 'react';
import { useAppStore, Alert } from '../stores/appStore';

const SEVERITY_COLOR: Record<string, string> = {
  low: '#22c55e',
  medium: '#eab308',
  high: '#f97316',
  critical: '#ef4444',
};

const SEVERITY_LABEL: Record<string, string> = {
  low: 'کم',
  medium: 'متوسط',
  high: 'بالا',
  critical: 'بحرانی',
};

const AlertItem: React.FC<{ alert: Alert }> = ({ alert }) => {
  const acknowledgeAlert = useAppStore((s) => s.acknowledgeAlert);
  const color = SEVERITY_COLOR[alert.severity];

  return (
    <div style={{
      padding: '8px 10px',
      borderRadius: 6,
      background: '#1e293b',
      borderRight: `3px solid ${color}`,
      marginBottom: 6,
      opacity: alert.acknowledged ? 0.5 : 1,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, color, fontWeight: 600 }}>
          {SEVERITY_LABEL[alert.severity]}
        </span>
        <span style={{ fontSize: 10, color: '#64748b' }}>
          {new Date(alert.at).toLocaleTimeString('fa-IR')}
        </span>
      </div>
      <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 3 }}>{alert.message}</div>
      {!alert.acknowledged && (
        <button
          onClick={() => acknowledgeAlert(alert.id)}
          style={{
            marginTop: 6, fontSize: 11, padding: '2px 8px', borderRadius: 4,
            background: '#334155', color: '#94a3b8',
          }}
        >
          تأیید
        </button>
      )}
    </div>
  );
};

export const AlertPanel: React.FC = () => {
  const alerts = useAppStore((s) => s.alerts);
  const [collapsed, setCollapsed] = useState(false);
  const unack = alerts.filter((a) => !a.acknowledged).length;

  return (
    <div style={{
      position: 'absolute',
      top: 50,
      left: 12,
      width: 260,
      zIndex: 1000,
      background: '#0f172a',
      border: '1px solid #334155',
      borderRadius: 8,
      overflow: 'hidden',
    }}>
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '8px 12px', background: '#1e293b', cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700 }}>
          هشدارها {unack > 0 && <span style={{ color: '#ef4444' }}>({unack})</span>}
        </span>
        <span style={{ color: '#64748b', fontSize: 12 }}>{collapsed ? '▼' : '▲'}</span>
      </div>
      {!collapsed && (
        <div style={{ maxHeight: 320, overflowY: 'auto', padding: '8px 10px' }}>
          {alerts.length === 0 ? (
            <div style={{ color: '#475569', fontSize: 12, textAlign: 'center', padding: '16px 0' }}>
              هشداری وجود ندارد
            </div>
          ) : (
            alerts.map((a) => <AlertItem key={a.id} alert={a} />)
          )}
        </div>
      )}
    </div>
  );
};
