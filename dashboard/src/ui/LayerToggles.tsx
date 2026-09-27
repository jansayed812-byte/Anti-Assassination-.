import { useOps } from '../stores/ops';
import { useT } from '../app/hooks';

const DEFS = [['risk', 'grid-four'], ['routes', 'path'], ['units', 'users-three'], ['terrain', 'mountains']] as const;

export function Toggle({ on }: { on: boolean }) {
  return (
    <span style={{ width: 28, height: 16, borderRadius: 8, background: on ? 'var(--color-accent)' : 'var(--color-neutral-700)', position: 'relative', flex: 'none' }}>
      <span style={{ position: 'absolute', top: 2, insetInlineStart: on ? 14 : 2, width: 12, height: 12, borderRadius: '50%', background: '#e8e6f5', transition: 'inset-inline-start 0.15s' }} />
    </span>
  );
}

export function LayerToggles() {
  const { t } = useT();
  const layers = useOps((s) => s.layers);
  const set = useOps((s) => s.set);
  return (
    <>
      {DEFS.map(([k, icon]) => (
        <button key={k} role="switch" aria-checked={layers[k]} className="hov-bg" onClick={() => set({ layers: { ...layers, [k]: !layers[k] } })}
          style={{ color: 'var(--color-text)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 6px', borderRadius: 6 }}>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><i className={`ph ph-${icon}`} style={{ color: 'var(--color-neutral-400)' }} />{t(`layer.${k}`)}</span>
          <Toggle on={layers[k]} />
        </button>
      ))}
    </>
  );
}
