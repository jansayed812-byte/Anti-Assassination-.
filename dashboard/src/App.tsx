import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from './stores/session';
import { useOps } from './stores/ops';
import { ROLE_HOME, visibleModes } from './app/roles';
import { bootstrap } from './app/actions';
import { disconnectStream } from './realtime/streams';
import { Shell } from './app/Shell';
import { Login } from './pages/Login';
import { useMode, useT } from './app/hooks';

function Authed() {
  const { t } = useT();
  const token = useSession((s) => s.session?.access_token);
  const loaded = useOps((s) => s.loaded);
  useEffect(() => {
    if (!token) return;
    if (!useOps.getState().loaded) void bootstrap(token);
    return () => { if (!useSession.getState().session) disconnectStream(); };
  }, [token]);
  if (!token) return <Navigate to="/login" replace />;
  if (!loaded) return <div role="status" style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--text-3)' }}><span><i className="ph ph-spinner spin" /> {t('loading')}</span></div>;
  return <Shell />;
}

function Home() {
  const role = useSession((s) => s.role);
  return <Navigate to={`/${role ? ROLE_HOME[role] : 'live'}`} replace />;
}

function ModeGuard() {
  const mode = useMode();
  const role = useSession((s) => s.role);
  return visibleModes(role).some((m) => m.id === mode) ? <Authed /> : <Navigate to="/" replace />;
}

export default function App() {
  const token = useSession((s) => s.session?.access_token);
  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/" element={token ? <Home /> : <Navigate to="/login" replace />} />
      <Route path="/:mode" element={<ModeGuard />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
