import { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOps, MODES, type Frame } from '../stores/ops';
import { useSession } from '../stores/session';
import { useT } from '../app/hooks';
import { CONSOLE_ROLES, ROLE_HOME } from '../app/roles';
import { logout, panic, runAnalysis, switchRole } from '../app/actions';
import { setSimulatedOffline } from '../realtime/streams';
import { flyToUnit } from '../map/MapStage';

const FRAMES: Frame[] = ['auto', 'wall', 'desktop', 'tabletL', 'tabletP', 'mobile'];
const FRAME_LABEL: Record<Frame, string> = { auto: 'auto', wall: '4K', desktop: 'Desktop', tabletL: 'Tablet ⟷', tabletP: 'Tablet ↕', mobile: 'Mobile' };

export function AccountMenu() {
  const { t, lang } = useT();
  const navigate = useNavigate();
  const s = useOps();
  const role = useSession((x) => x.role);
  const user = useSession((x) => x.session?.user);
  const ring = (on: boolean) => (on ? 'inset 0 0 0 1px var(--color-accent)' : 'none');
  const fgc = (on: boolean) => (on ? 'var(--color-accent-200)' : 'var(--color-text)');
  if (!s.menuOpen) return null;
  return (
    <>
      <div onClick={s.closeOverlays} style={{ position: 'absolute', inset: 0, zIndex: 20 }} />
      <div style={{ position: 'absolute', top: 52, insetInlineEnd: 10, zIndex: 21, width: 270, maxWidth: 'calc(100% - 20px)', borderRadius: 12, background: 'var(--color-surface)', boxShadow: 'var(--shadow-md)', padding: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ padding: '4px 6px', display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontWeight: 500 }}>{user?.name}</span>
          <span className="caption mono ltr" style={{ textAlign: 'start' }}>{user?.username}</span>
        </div>
        <div className="eyebrow" style={{ padding: '4px 6px' }}>{t('role')}</div>
        {CONSOLE_ROLES.map((r) => (
          <button key={r} className="hov-bg" onClick={async () => { s.set({ menuOpen: false }); await switchRole(r); navigate(`/${ROLE_HOME[r]}`); }}
            style={{ textAlign: 'start', padding: '7px 8px', borderRadius: 8, background: r === role ? 'var(--color-accent-900)' : 'transparent', display: 'flex', justifyContent: 'space-between' }}>
            <span>{t(`role.${r}`)}</span><span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{t(`mode.${ROLE_HOME[r]}`)}</span>
          </button>
        ))}
        <div style={{ height: 1, background: 'var(--color-divider)', margin: '6px 0' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 6px' }}>
          <span>{t('language')}</span>
          <div style={{ display: 'flex', borderRadius: 8, boxShadow: 'inset 0 0 0 1px var(--color-divider)' }}>
            <button onClick={() => s.set({ lang: 'fa' })} style={{ padding: '4px 10px', borderRadius: 8, color: fgc(lang === 'fa'), boxShadow: ring(lang === 'fa') }}>فا</button>
            <button onClick={() => s.set({ lang: 'en' })} style={{ padding: '4px 10px', borderRadius: 8, color: fgc(lang === 'en'), boxShadow: ring(lang === 'en') }}>EN</button>
          </div>
        </div>
        <button className="hov-bg" onClick={() => setSimulatedOffline(!s.offlineSim)} style={{ textAlign: 'start', padding: '7px 6px', borderRadius: 8, display: 'flex', justifyContent: 'space-between' }}>
          <span>{t('simOffline')}</span><span style={{ fontSize: 11, color: 'var(--color-neutral-400)' }}>{s.offlineSim ? t('on') : t('off')}</span>
        </button>
        <button className="hov-bg" onClick={() => s.set({ showApi: !s.showApi })} style={{ textAlign: 'start', padding: '7px 6px', borderRadius: 8, display: 'flex', justifyContent: 'space-between' }}>
          <span>{t('showApi')}</span><span style={{ fontSize: 11, color: 'var(--color-neutral-400)' }}>{s.showApi ? t('on') : t('off')}</span>
        </button>
        <div style={{ height: 1, background: 'var(--color-divider)', margin: '6px 0' }} />
        <div className="eyebrow" style={{ padding: '4px 6px' }}>{t('device')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '0 4px 4px' }}>
          {FRAMES.map((f) => (
            <button key={f} onClick={() => s.set({ frame: f })} style={{ padding: '4px 8px', borderRadius: 6, background: s.frame === f ? 'var(--color-accent-800)' : 'var(--color-bg)', fontSize: 11.5 }}>{f === 'auto' ? t('auto') : FRAME_LABEL[f]}</button>
          ))}
        </div>
        <div style={{ height: 1, background: 'var(--color-divider)', margin: '6px 0' }} />
        <button className="hov-bg" onClick={() => { logout(); navigate('/login'); }} style={{ textAlign: 'start', padding: '7px 6px', borderRadius: 8, display: 'flex', gap: 8, alignItems: 'center', color: 'var(--color-neutral-300)' }}>
          <i className="ph ph-sign-out" />{t('signOut')}
        </button>
      </div>
    </>
  );
}

export function CommandPalette() {
  const { t, lang } = useT();
  const navigate = useNavigate();
  const s = useOps();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (s.paletteOpen) input.current?.focus(); }, [s.paletteOpen]);

  const all = useMemo(() => [
    ...MODES.map((m, i) => ({ icon: m.icon, label: `${t(`mode.${m.id}`)}  Alt+${i + 1}`, kind: t('pal.workspace'), go: () => navigate(`/${m.id}`) })),
    ...s.unitOrder.map((id) => s.units[id]).filter(Boolean).map((u) => ({ icon: u.icon, label: u.name, kind: t('pal.unit'), go: () => { s.set({ sel: u.id, liveTab: 'units', sheet: 'insp' }); navigate('/live'); flyToUnit(u.id); } })),
    ...s.devices.map((d) => ({ icon: 'cpu', label: d.name, kind: t('pal.device'), go: () => { s.set({ devSel: d.id, sheet: 'insp' }); navigate('/assets'); } })),
    { icon: 'siren', label: t('pal.panic'), kind: t('pal.command'), go: () => s.set({ panicOpen: true }) },
    { icon: 'cube', label: s.view3d ? t('pal.to2d') : t('pal.to3d'), kind: t('pal.command'), go: () => s.set({ view3d: !s.view3d }) },
    { icon: 'plus', label: t('pal.newPlan'), kind: t('pal.command'), go: () => { s.set({ newPlan: true }); navigate('/planning'); } },
    { icon: 'play', label: t('pal.analyze'), kind: t('pal.command'), go: () => { navigate('/analysis'); void runAnalysis(); } },
    { icon: 'translate', label: t('pal.lang'), kind: t('pal.command'), go: () => s.set({ lang: lang === 'fa' ? 'en' : 'fa' }) },
  ], [s, t, lang, navigate]);

  if (!s.paletteOpen) return null;
  const q = s.q.trim().toLowerCase();
  const items = (q ? all.filter((p) => (p.label + p.kind).toLowerCase().includes(q)) : all).slice(0, 12);
  const run = (it: (typeof items)[number]) => { s.set({ paletteOpen: false, q: '' }); it.go(); };
  return (
    <>
      <div onClick={s.closeOverlays} style={{ position: 'absolute', inset: 0, zIndex: 30, background: 'rgba(8,9,14,0.6)' }} />
      <div role="dialog" aria-label="command palette" style={{ position: 'absolute', top: '12%', insetInline: 0, margin: '0 auto', zIndex: 31, width: 560, maxWidth: 'calc(100% - 24px)', borderRadius: 14, background: 'var(--color-surface)', boxShadow: 'var(--shadow-md)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', boxShadow: 'inset 0 -1px 0 var(--color-divider)' }}>
          <i className="ph ph-magnifying-glass" style={{ color: 'var(--color-neutral-400)', fontSize: 17 }} />
          <input ref={input} value={s.q} onChange={(e) => s.set({ q: e.target.value })} placeholder={t('search')}
            onKeyDown={(e) => { if (e.key === 'Enter' && items[0]) run(items[0]); }}
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--color-text)', fontSize: 15 }} />
          <span className="mono" style={{ fontSize: 10, color: 'var(--color-neutral-500)' }}>Esc</span>
        </div>
        <div style={{ maxHeight: 360, overflowY: 'auto', padding: 6 }}>
          {items.map((p, i) => (
            <button key={p.kind + p.label} className="hov-accent" onClick={() => run(p)} style={{ width: '100%', textAlign: 'start', padding: '9px 10px', borderRadius: 8, background: i === 0 ? 'var(--color-bg)' : 'transparent', display: 'flex', gap: 10, alignItems: 'center' }}>
              <i className={`ph ph-${p.icon}`} style={{ color: 'var(--color-neutral-400)', fontSize: 16 }} /><span style={{ flex: 1 }}>{p.label}</span><span style={{ fontSize: 11, color: 'var(--color-neutral-500)' }}>{p.kind}</span>
            </button>
          ))}
          {items.length === 0 && <div style={{ padding: 16, color: 'var(--color-neutral-500)' }}>{t('pal.none')}</div>}
        </div>
      </div>
    </>
  );
}

export function PanicDialog() {
  const { t } = useT();
  const navigate = useNavigate();
  const open = useOps((s) => s.panicOpen);
  const close = useOps((s) => s.closeOverlays);
  if (!open) return null;
  return (
    <>
      <div onClick={close} style={{ position: 'absolute', inset: 0, zIndex: 40, background: 'rgba(20,6,8,0.7)' }} />
      <div role="alertdialog" aria-labelledby="panic-title" style={{ position: 'absolute', top: '50%', insetInline: 0, margin: '0 auto', transform: 'translateY(-50%)', zIndex: 41, width: 400, maxWidth: 'calc(100% - 24px)', borderRadius: 14, background: 'var(--color-surface)', boxShadow: 'var(--shadow-md), inset 0 0 0 1px oklch(0.72 0.15 25)', padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span id="panic-title" style={{ fontSize: 18, fontWeight: 500, color: 'oklch(0.85 0.1 25)', display: 'flex', gap: 8, alignItems: 'center' }}><i className="ph ph-siren" />{t('panic.title')}</span>
        <span style={{ fontSize: 13, color: 'var(--color-neutral-300)' }}>{t('panic.body')}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={async () => { await panic(); navigate('/live'); }} style={{ flex: 1, padding: 11, borderRadius: 8, background: 'oklch(0.62 0.18 25)', color: '#fff', fontWeight: 600 }}>{t('panic.confirm')}</button>
          <button className="btn-outline" onClick={close} style={{ flex: 1, padding: 11, borderRadius: 8 }}>{t('panic.cancel')}</button>
        </div>
      </div>
    </>
  );
}

export function ToastView({ bottom }: { bottom: string }) {
  const toast = useOps((s) => s.toast);
  if (!toast) return null;
  return (
    <div role="status" key={toast.id} style={{ position: 'absolute', bottom, insetInline: 0, margin: '0 auto', width: 'max-content', maxWidth: 'calc(100% - 24px)', zIndex: 50, padding: '9px 14px', borderRadius: 10, background: toast.tone === 'error' ? 'oklch(0.34 0.08 25)' : 'var(--color-neutral-800)', boxShadow: 'var(--shadow-md)', display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span>{toast.msg}</span>
      {toast.api && <span className="mono ltr" style={{ fontSize: 10.5, color: 'var(--color-neutral-400)', textAlign: 'start' }}>{toast.api}</span>}
    </div>
  );
}

export function OfflineBanner() {
  const { t, N } = useT();
  const conn = useOps((s) => s.conn);
  const outbox = useOps((s) => s.outbox);
  const loaded = useOps((s) => s.loaded);
  if (!loaded || conn === 'online') return null;
  return (
    <div style={{ position: 'absolute', top: 56, insetInline: 0, zIndex: 7, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
      <div style={{ marginTop: 8, padding: '6px 14px', borderRadius: 8, background: 'oklch(0.34 0.08 90)', color: 'oklch(0.93 0.05 90)', display: 'flex', gap: 8, alignItems: 'center', boxShadow: 'var(--shadow-md)' }}>
        <i className={conn === 'connecting' ? 'ph ph-arrows-clockwise spin' : 'ph ph-wifi-slash'} />
        {conn === 'connecting' ? t('off.reconnecting') : t('off.banner', { n: N(outbox) })}
      </div>
    </div>
  );
}
