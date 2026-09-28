/** Map area: the lazily loaded 3D map plus floating alert cards. The MapLibre chunk loads after the shell paints. */
import { lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOps, type Mode } from '../stores/ops';
import { useT } from '../app/hooks';
import { AlertCard } from '../ui/AlertCard';

const MapView = lazy(() => import('./MapView'));
const ORDER = { critical: 0, error: 1, warning: 2, info: 3 } as const;

export function MapStage({ mode, narrow, compact }: { mode: Mode; narrow: boolean; compact: boolean }) {
  const { t, N } = useT();
  const navigate = useNavigate();
  const alerts = useOps((s) => s.alerts);
  const liveTab = useOps((s) => s.liveTab);
  const set = useOps((s) => s.set);
  const open = alerts.filter((a) => a.status === 'active' || a.status === 'escalated').sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  const floatN = compact || narrow ? 1 : 2;
  const showFloat = open.length > 0 && (mode === 'live' || mode === 'sim') && !(mode === 'live' && liveTab === 'alerts' && !compact);
  return (
    <>
      <Suspense fallback={<div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--text-3)', background: 'var(--map-ground)' }}><span><i className="ph ph-spinner spin" /> {t('map.loading')}</span></div>}>
        <MapView mode={mode} compact={compact} />
      </Suspense>
      {showFloat && (
        <div style={{ position: 'absolute', top: 12, insetInlineEnd: 12, zIndex: 3, width: narrow ? 'min(280px, calc(100% - 76px))' : 'min(330px, calc(100% - 80px))', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {open.slice(0, floatN).map((a) => <AlertCard key={a.id} alert={a} variant="float" />)}
          {open.length > floatN && (
            <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => { set({ liveTab: 'alerts', sheet: 'list', sheetOpen: true, listOpen: true }); navigate('/live'); }}>
              {t('alert.more', { n: N(open.length - floatN) })}
            </button>
          )}
        </div>
      )}
    </>
  );
}
