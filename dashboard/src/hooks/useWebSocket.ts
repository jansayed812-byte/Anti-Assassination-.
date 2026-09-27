/**
 * WebSocket hook — connects to the backend and feeds Zustand store
 */
import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAppStore } from '../stores/appStore';
import type { Position, Incident, Alert } from '../stores/appStore';

export function useWebSocket(url: string = '/') {
  const socketRef = useRef<Socket | null>(null);
  const {
    setConnectionStatus,
    updatePosition,
    addIncident,
    addAlert,
    setIncidents,
  } = useAppStore.getState();

  useEffect(() => {
    const socket = io(url, {
      transports: ['websocket', 'polling'],
      reconnectionDelay: 2000,
      reconnectionDelayMax: 15000,
    });
    socketRef.current = socket;

    socket.on('connect', () => setConnectionStatus('connected'));
    socket.on('disconnect', () => setConnectionStatus('disconnected'));
    socket.on('error', () => setConnectionStatus('degraded'));

    socket.on('position', (data: Position) => updatePosition(data));

    socket.on('incident', (data: Incident) => addIncident(data));

    socket.on('incidents_snapshot', (data: { incidents: Incident[] }) =>
      setIncidents(data.incidents)
    );

    socket.on('alert', (data: Alert) => addAlert(data));

    return () => { socket.disconnect(); };
  }, [url]);
}
