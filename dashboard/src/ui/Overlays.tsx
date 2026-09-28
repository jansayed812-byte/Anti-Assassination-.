import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOps, MODES, type Frame } from '../stores/ops';
import { usePrefs } from '../stores/prefs';
import { useSession } from '../stores/session';
import { useT } from '../app/hooks';
import { CONSOLE_ROLES, ROLE_HOME } from '../app/roles';
import { logout, panic, runAnalysis, setTheme, switchRole } from '../app/actions';
import { setSimulatedOffline } from '../realtime/streams';
import { LanguageSwitcher } from './Switchers';

const FRAMES: Frame[] = ['auto', 'wall', 'desktop', 'tabletL', 'tabletP', 'mobile'];
const FRAME_LABEL: Record<Frame, string> = { auto: '', wall: '4K', desktop: 'Desktop', tabletL: 'Tablet ⟷', tabletP: 'Tablet ↕', mobile: 'Mobile' };

export function AccountMenu() {
  const { t, x } = useT();
  const navigate = useNavigate();
  const s = useOps();
  const theme = usePrefs((p) => p.theme);
  const session = useSession((p) => p.session);
  const role = useSession((p) => p.role);
  const demo = s.config?.demo_mode;
  if (!s.menuOpen || !session) return null;
  return (
    <>
      <div onClick={s.closeOverlays} style={{ position: 'absolute', inset: 0, zIndex: 30 }} />
      <div className="popover" role="menu" aria-label={t('account')} style={{ top: 54, insetInlineEnd: 10, width: 300, maxWidth: 'calc(100% - 20px)', maxHeight: 'calc(100% - 70px)', overflowY: 'auto' }}>
        <div className="col" style={{ padding: '6px 10px', gap: 0 }}>
          <b>{x(session.user.name)}</b>
          <span className="caption"><span className="mono ltr">{session.user.username}</span> · {role ? t(`role.${role}`) : ''} · {session.branch}</span>
        </div>
        <hr className="divider" />
        <div className="row-between" style={{ padding: '4px 10px' }}><span>{t('language')}</span><LanguageSwitcher compact /></div>
        <div className="row-between" style={{ padding: '4px 10px' }}>
          <span>{t('theme')}</span>
          <div className="seg">
            <button aria-pressed={theme === 'dark'} onClick={() => void setTheme('dark')}><i className="ph ph-moon" /> {t('theme.dark')}</button>
            <button aria-pressed={theme === 'light'} onClick={() => void setTheme('light')}><i className="ph ph-sun" /> {t('theme.light')}</button>
          </div>
        </div>
        {demo && (
          <>
            <hr className="divider" />
            <div className="eyebrow" style={{ padding: '4px 10px' }}>{t('roleSwitch')}</div>
            {CONSOLE_ROLES.map((r) => (
              <button key={r} className="menu-item" aria-current={r === role} onClick={async () => { s.set({ menuOpen: false }); await switchRole(r); navigate(`/${ROLE_HOME[r]}`); }} style={{ background: r === role ? 'var(--accent-soft)' : undefined }}>
                <span>{t(`role.${r}`)}</span><span className="caption">{t(`mode.${ROLE_HOME[r]}`)}</span>
              </button>
            ))}
          </>
        )}
        <hr className="divider" />
        <button role="switch" aria-checked={s.offlineSim} className="menu-item" onClick={() => setSimulatedOffline(!s.offlineSim)}><span>{t('simOffline')}</span><span className="switch" /></button>
        <button role="switch" aria-checked={s.showApi} className="menu-item" onClick={() => s.set({ showApi: !s.showApi })}><span>{t('showApi')}</span><span className="switch" /></button>
        <div className="eyebrow" style={{ padding: '6px 10px 2px' }}>{t('device')}</div>
        <div className="row wrap" style={{ gap: 4, padding: '0 8px 6px' }}>
          {FRAMES.map((f) => <button key={f} className={`btn btn-sm ${s.frame === f ? 'on' : ''}`} onClick={() => s.set({ frame: f })}>{f === 'auto' ? t('auto') : FRAME_LABEL[f]}</button>)}
        </div>
        <hr className="divider" />
        <button className="menu-item" onClick={() => { logout(); navigate('/login'); }} style={{ color: 'var(--text-2)', justifyContent: 'flex-start' }}><i className="ph ph-sign-out" />{t('signOut')}</button>
      </div>
    </>
  );
}

export function CommandPalette() {
  const { t, x } = useT();
  const navigate = useNavigate();
  const s = useOps();
  const theme = usePrefs((p) => p.theme);
  const input = useRef<HTMLInputElement>(null);
  const [cursor, setCursor] = useState(0);
  useEffect(() => { if (s.paletteOpen) { input.current?.focus(); setCursor(0); } }, [s.paletteOpen]);

  const all = useMemo(() => [
    ...MODES.map((m, i) => ({ icon: m.icon, label: `${t(`mode.${m.id}`)}`, hint: `Alt+${i + 1}`, kind: t('pal.workspace'), go: () => navigate(`/${m.id}`) })),
    ...s.unitOrder.map((id) => s.units[id]).filter(Boolean).map((u) => ({ icon: u.icon, label: x(u.name), hint: '', kind: t('pal.unit'), go: () => { s.set({ sel: u.id, liveTab: 'units', sheet: 'insp' }); navigate('/live'); if (u.telemetry) s.flyTo(u.telemetry, 16); } })),
    ...s.devices.map((d) => ({ icon: 'cpu', label: `${x(d.name)}`, hint: d.id, kind: t('pal.device'), go: () => { s.set({ devSel: d.id, sheet: 'insp' }); navigate('/assets'); if (d.geo) s.flyTo(d.geo, 16); } })),
    ...(s.geo?.pois ?? []).map((p) => ({ icon: 'map-pin', label: x(p.name), hint: '', kind: t('pal.place'), go: () => s.flyTo(p, 16) })),
    { icon: 'siren', label: t('pal.panic'), hint: '', kind: t('pal.command'), go: () => s.set({ panicOpen: true }) },
    { icon: 'cube', label: s.view3d ? t('pal.to2d') : t('pal.to3d'), hint: '', kind: t('pal.command'), go: () => s.set({ view3d: !s.view3d }) },
    { icon: 'plus', label: t('pal.newPlan'), hint: '', kind: t('pal.command'), go: () => { s.set({ newPlan: true }); navigate('/planning'); } },
    { icon: 'play', label: t('pal.analyze'), hint: '', kind: t('pal.command'), go: () => { navigate('/analysis'); void runAnalysis(); } },
    { icon: theme === 'dark' ? 'sun' : 'moon', label: t('pal.theme'), hint: '', kind: t('pal.command'), go: () => void setTheme(theme === 'dark' ? 'light' : 'dark') },
  ], [s, t, x, navigate, theme]);

  if (!s.paletteOpen) return null;
  const q = s.q.trim().toLowerCase();
  const items = (q ? all.filter((p) => `${p.label} ${p.kind} ${p.hint}`.toLowerCase().includes(q)) : all).slice(0, 12);
  const run = (it: (typeof items)[number]) => { s.set({ paletteOpen: false, q: '' }); it.go(); };
  return (
    <>
      <div className="scrim" onClick={s.closeOverlays} />
      <div role="dialog" aria-modal="true" aria-label={t('search')} className="dialog" style={{ top: '12%', padding: 0, gap: 0, width: 'min(580px, calc(100% - 24px))', overflow: 'hidden' }}>
        <div className="row" style={{ gap: 10, padding: '12px 14px', boxShadow: 'inset 0 -1px 0 var(--line)' }}>
          <i className="ph ph-magnifying-glass" style={{ color: 'var(--text-3)', fontSize: 17 }} />
          <input ref={input} value={s.q} onChange={(e) => { s.set({ q: e.target.value }); setCursor(0); }} placeholder={t('search')} aria-label={t('search')}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(items.length - 1, c + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
              else if (e.key === 'Enter' && items[cursor]) run(items[cursor]);
            }}
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 15 }} />
          <span className="kbd">Esc</span>
        </div>
        <div role="listbox" style={{ maxHeight: 380, overflowY: 'auto', padding: 6 }}>
          {items.map((p, i) => (
            <button key={p.kind + p.label + p.hint} role="option" aria-selected={i === cursor} className="menu-item" onMouseEnter={() => setCursor(i)} onClick={() => run(p)} style={{ background: i === cursor ? 'var(--surface-2)' : undefined }}>
              <span className="row"><i className={`ph ph-${p.icon}`} style={{ color: 'var(--text-3)', fontSize: 16 }} /><span className="truncate">{p.label}</span>{p.hint && <span className="kbd ltr">{p.hint}</span>}</span>
              <span className="caption">{p.kind}</span>
            </button>
          ))}
          {items.length === 0 && <div className="muted" style={{ padding: 16 }}>{t('pal.none')}</div>}
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
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) confirm.current?.focus(); }, [open]);
  if (!open) return null;
  return (
    <>
      <div className="scrim" onClick={close} style={{ zIndex: 40, background: 'rgba(40,6,10,0.55)' }} />
      <div role="alertdialog" aria-modal="true" aria-labelledby="panic-title" aria-describedby="panic-body" className="dialog" style={{ top: '50%', transform: 'translateY(-50%)', boxShadow: 'var(--shadow-3), inset 0 0 0 1.5px var(--danger)' }}>
        <h2 id="panic-title" className="row" style={{ color: 'var(--danger)', fontSize: 19 }}><i className="ph ph-siren" />{t('panic.title')}</h2>
        <p id="panic-body" className="muted" style={{ margin: 0 }}>{t('panic.body')}</p>
        <div className="row" style={{ gap: 8 }}>
          <button ref={confirm} className="btn btn-danger-fill btn-block" onClick={async () => { await panic(); navigate('/live'); }}>{t('panic.confirm')}</button>
          <button className="btn btn-block" onClick={close}>{t('panic.cancel')}</button>
        </div>
      </div>
    </>
  );
}

export function ToastView({ bottom }: { bottom: string }) {
  const toast = useOps((s) => s.toast);
  if (!toast) return null;
  return (
    <div role={toast.tone === 'error' ? 'alert' : 'status'} aria-live="polite" key={toast.id} className={`toast ${toast.tone === 'error' ? 'error' : ''}`} style={{ bottom }} data-testid="toast">
      <span>{toast.msg}</span>
      {toast.api && <span className="api-hint" style={{ color: 'inherit', opacity: 0.7 }}>{toast.api}</span>}
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
    <div style={{ position: 'absolute', top: 58, insetInline: 0, zIndex: 7, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
      <div role="status" className="chip chip-warning" style={{ padding: '6px 14px', fontSize: 12.5, boxShadow: 'var(--shadow-2)', background: 'var(--surface)', color: 'var(--warning)' }}>
        <i className={conn === 'connecting' ? 'ph ph-arrows-clockwise spin' : 'ph ph-wifi-slash'} />
        {conn === 'connecting' ? t('off.reconnecting') : t('off.banner', { n: N(outbox) })}
      </div>
    </div>
  );
}
