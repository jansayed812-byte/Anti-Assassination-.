import React, { useEffect, useState } from 'react';
import { useAppStore } from '../stores/appStore';

export const OfflineBanner: React.FC = () => {
  const isOffline = useAppStore((s) => s.isOffline);
  const pendingSyncCount = useAppStore((s) => s.pendingSyncCount);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(isOffline);
  }, [isOffline]);

  const handleOnlineOffline = () => {
    useAppStore.getState().setOfflineState(!navigator.onLine, 0);
  };

  useEffect(() => {
    window.addEventListener('online', handleOnlineOffline);
    window.addEventListener('offline', handleOnlineOffline);
    return () => {
      window.removeEventListener('online', handleOnlineOffline);
      window.removeEventListener('offline', handleOnlineOffline);
    };
  }, []);

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 16,
      left: '50%',
      transform: 'translateX(-50%)',
      background: '#92400e',
      color: '#fef3c7',
      padding: '8px 20px',
      borderRadius: 8,
      fontSize: 13,
      fontWeight: 600,
      zIndex: 9999,
      display: 'flex',
      gap: 12,
      alignItems: 'center',
      boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
    }}>
      <span>⚡ حالت آفلاین</span>
      {pendingSyncCount > 0 && (
        <span style={{ background: '#b45309', borderRadius: 4, padding: '2px 8px' }}>
          {pendingSyncCount} رویداد در صف
        </span>
      )}
    </div>
  );
};
