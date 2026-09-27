import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOps, MODES, type Frame, type Mode } from '../stores/ops';
import { useSession } from '../stores/session';
import { layoutFor, useMode, useNow, useT, useViewport } from './hooks';
import { ROLE_HOME, ROLE_INITIALS, roleTasks } from './roles';
import { SEV, bgc, fg, sol } from '../lib/format';
import { MapStage } from '../map/MapStage';
import { AlertCard } from '../ui/AlertCard';
import { AccountMenu, CommandPalette, OfflineBanner, PanicDialog, ToastView } from '../ui/Overlays';
import { LiveInspector, LiveList } from '../workspaces/live/Live';
import { AnalysisInspector, AnalysisList } from '../workspaces/analysis/Analysis';
import { PlanningInspector, PlanningList } from '../workspaces/planning/Planning';
import { SimInspector, SimList } from '../workspaces/sim/Sim';
import { AssetsInspector, AssetsList } from '../workspaces/assets/Assets';
import { AdminList, AdminMain } from '../workspaces/admin/Admin';

const FRAMES: Record<Exclude<Frame, 'auto'>, [number, number]> = { wall: [2560, 1440], desktop: [1440, 900], tabletL: [1180, 820], tabletP: [820, 1180], mobile: [390, 844] };

function TopBar({ mode, isMobile, showStreams, tablet }: { mode: Mode; isMobile: boolean; showStreams: boolean; tablet: boolean }) {
  const { t, N } = useT();
  const navigate = useNavigate();
  const s = useOps();
  const role = useSession((x) => x.role) ?? 'viewer';
  const open = s.alerts.filter((a) => a.status === 'active' || a.status === 'escalated');
  const crit = open.filter((a) => a.level === 'critical').length;
  const online = s.conn === 'online';
  const streams = [
    { label: 'TLM 5Hz', dot: online ? sol(150) : sol(25) },
    { label: 'RISK 1Hz', dot: online ? sol(90) : sol(25) },
    { label: online ? 'ALR' : `BUF ${s.outbox}`, dot: online ? sol(150) : sol(90) },
  ];
  return (
    <header className="divider-bottom" style={{ gridArea: 'top', display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', minWidth: 0, position: 'relative', zIndex: 6 }}>
      <span title={t('brand')} style={{ width: 30, height: 30, flex: 'none', borderRadius: 8, boxShadow: 'inset 0 0 0 1px var(--color-accent)', display: 'grid', placeItems: 'center', color: 'var(--color-accent)', fontSize: 16 }}><i className="ph ph-shield-chevron" /></span>
      {isMobile ? <span style={{ fontWeight: 500, fontSize: 15, whiteSpace: 'nowrap' }}>{t(`mode.${mode}`)}</span> : (
        <nav aria-label="workspaces" style={{ display: 'flex', gap: 2, minWidth: 0, overflowX: 'auto', flex: 'none' }}>
          {MODES.map((m, i) => (
            <button key={m.id} className="hov-surface" onClick={() => navigate(`/${m.id}`)} title={`${t(`mode.${m.id}`)} (Alt+${i + 1})`} aria-current={m.id === mode ? 'page' : undefined}
              style={{ color: m.id === mode ? 'var(--color-accent-200)' : 'var(--color-text)', boxShadow: m.id === mode ? 'inset 0 0 0 1px var(--color-accent)' : 'none', padding: '7px 11px', borderRadius: 8, display: 'flex', gap: 6, alignItems: 'center', whiteSpace: 'nowrap' }}>
              <i className={`ph ph-${m.icon}`} style={{ fontSize: 16 }} />{(!tablet || m.id === mode) && <span>{t(`mode.${m.id}`)}</span>}
            </button>
          ))}
        </nav>
      )}
      <button className="hov-text" onClick={() => s.set({ paletteOpen: true, q: '' })} aria-label={t('search')}
        style={{ background: 'var(--color-surface)', color: 'var(--color-neutral-400)', flex: '1 1 auto', minWidth: 36, maxWidth: 360, display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, textAlign: 'start' }}>
        <i className="ph ph-magnifying-glass" style={{ fontSize: 15 }} />
        {!isMobile && <><span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('search')}</span><span className="mono ltr" style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, boxShadow: 'inset 0 0 0 1px var(--color-divider)' }}>Ctrl K</span></>}
      </button>
      <div style={{ flex: '1 1 0' }} />
      {showStreams && (
        <div className="mono ltr" title="Socket.IO env stream" style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 10.5, color: 'var(--color-neutral-300)', flex: 'none' }}>
          {streams.map((x) => <span key={x.label} style={{ display: 'flex', gap: 5, alignItems: 'center' }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: x.dot }} />{x.label}</span>)}
        </div>
      )}
      <button onClick={() => { s.set({ liveTab: 'alerts', sheet: 'list', sheetOpen: true, listOpen: true }); navigate('/live'); }} aria-label={t('alerts')}
        style={{ flex: 'none', display: 'flex', gap: 6, alignItems: 'center', padding: '6px 10px', borderRadius: 8, background: crit ? bgc(25) : 'var(--color-surface)', color: crit ? fg(25) : 'var(--color-text)' }}>
        <i className="ph ph-bell-ringing" style={{ fontSize: 15 }} />
        <span style={{ whiteSpace: 'nowrap' }}>{N(open.length)}{isMobile ? '' : crit ? ` · ${N(crit)} ${t('alert.critical')}` : ` ${t('alert.open')}`}</span>
      </button>
      <button className="hov-panic" onClick={() => s.set({ panicOpen: true })} aria-label="PANIC"
        style={{ flex: 'none', padding: '6px 12px', borderRadius: 8, boxShadow: 'inset 0 0 0 1px oklch(0.72 0.15 25)', color: 'oklch(0.82 0.12 25)', display: 'flex', gap: 6, alignItems: 'center', fontWeight: 500 }}>
        <i className="ph ph-siren" style={{ fontSize: 15 }} />{!isMobile && <span>PANIC</span>}
      </button>
      <button onClick={() => s.set({ menuOpen: !s.menuOpen })} aria-label={t('account')} style={{ flex: 'none', width: 32, height: 32, borderRadius: '50%', background: 'var(--color-accent-800)', color: 'var(--color-accent-100)', fontSize: 11, fontWeight: 500 }}>{ROLE_INITIALS[role]}</button>
    </header>
  );
}

function RoleCard() {
  const { t } = useT();
  const navigate = useNavigate();
  const s = useOps();
  const role = useSession((x) => x.role) ?? 'viewer';
  const tasks = roleTasks(role, s);
  return (
    <div style={{ borderRadius: 12, padding: 12, background: 'var(--color-bg)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}><span style={{ fontWeight: 500 }}>{t('forYou')}</span><span style={{ fontSize: 11, color: 'var(--color-accent-300)' }}>{t(`role.${role}`)}</span></div>
      {tasks.length === 0 && <span className="muted" style={{ fontSize: 12.5 }}>{t('task.none')}</span>}
      {tasks.map((k) => (
        <button key={k.text} className="hov-surface" onClick={() => { s.set({ ...(k.tab ? { liveTab: k.tab } : {}), ...(k.plan ? { planSel: k.plan } : {}), ...(k.dev ? { devSel: k.dev } : {}) }); navigate(`/${k.mode}`); }}
          style={{ display: 'flex', gap: 8, alignItems: 'flex-start', textAlign: 'start', padding: 6, borderRadius: 8 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', marginTop: 7, flex: 'none', background: sol(SEV[k.level].h) }} /><span style={{ fontSize: 12.5 }}>{k.text}</span>
        </button>
      ))}
    </div>
  );
}

function SheetSwitch({ active }: { active: 'list' | 'insp' }) {
  const { t } = useT();
  const s = useOps();
  const b = (on: boolean): React.CSSProperties => ({ flex: 1, padding: 8, borderRadius: 8, background: on ? 'var(--color-accent-900)' : 'transparent', color: on ? 'var(--color-accent-200)' : 'var(--color-text)' });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', flex: 'none' }}>
      <button onClick={() => s.set({ sheet: 'list', sheetOpen: true })} style={b(active === 'list')}>{t('list')}</button>
      <button onClick={() => s.set({ sheet: 'insp', sheetOpen: true })} style={b(active === 'insp')}>{t('details')}</button>
      <button aria-label="toggle sheet" onClick={() => s.set({ sheetOpen: !s.sheetOpen })} style={{ width: 44, height: 36, borderRadius: 8, color: 'var(--color-neutral-400)' }}><i className={`ph ph-caret-${s.sheetOpen ? 'down' : 'up'}`} /></button>
    </div>
  );
}

function Timeline({ mode }: { mode: Mode }) {
  const { t, N } = useT();
  const now = useNow();
  const s = useOps();
  const a = s.units.alpha?.telemetry;
  const sc = s.scenarios.find((x) => x.id === s.sim?.scenario_id);
  const d = new Date(now);
  const liveLabel = `LIVE · ${[d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, '0')).join(':')}`;
  const window30 = 30 * 60_000;
  const marks = mode === 'sim'
    ? (s.sim?.events ?? []).map((e) => ({ pos: (e.t_ms / (s.sim?.duration_ms || 1)) * 100, c: sol(SEV[e.level].h), t: e.message }))
    : s.alerts.map((al) => ({ pos: 100 - ((now - Date.parse(al.created_at)) / window30) * 100, c: sol(SEV[al.level].h), t: al.title })).filter((m) => m.pos >= 0 && m.pos <= 100);
  const strip = mode === 'sim'
    ? [[t('m.speed'), `×${N(s.sim?.speed ?? 1)}`], [t('tl.events'), N(s.sim?.events.length ?? 0)]]
    : [[t('tl.alpha'), `${N(a?.speed_kmh ?? 0)} km/h`], [t('m.heading'), `${N(a?.heading_deg ?? 0)}°`], ['CEP95', `${N(a?.cep95_m ?? 0)} m`], ['E2E', `${N(s.e2eMs)} ms`]];
  const playhead = mode === 'sim' ? s.sim?.progress ?? 0 : 100;
  return (
    <footer className="divider-top" style={{ gridArea: 'time', display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 16px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <span className="mono ltr" style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11.5 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: mode === 'sim' ? sol(250) : sol(25) }} />{mode === 'sim' ? `SIM · ${(sc?.id ?? s.scenSel).toUpperCase()}` : liveLabel}</span>
        {strip.map(([l, v]) => <span key={l} style={{ display: 'flex', gap: 5, alignItems: 'baseline' }}><span className="caption">{l}</span><span style={{ fontWeight: 500 }}>{v}</span></span>)}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11.5, color: 'var(--color-neutral-400)' }}>{mode === 'sim' ? t('tl.simHint') : t('tl.liveHint')}</span>
      </div>
      <div style={{ position: 'relative', height: 26, borderRadius: 6, background: 'var(--color-surface)' }}>
        {marks.map((m, i) => <span key={i} title={m.t} style={{ position: 'absolute', insetInlineEnd: `${m.pos}%`, top: 5, width: 3, height: 16, borderRadius: 2, background: m.c }} />)}
        <span style={{ position: 'absolute', top: 0, bottom: 0, insetInlineEnd: `${playhead}%`, width: 2, background: 'var(--color-accent)', transition: 'inset-inline-end 1s linear' }} />
      </div>
    </footer>
  );
}

export function Shell() {
  const { t, lang } = useT();
  const navigate = useNavigate();
  const mode = useMode();
  const vp = useViewport();
  const s = useOps();
  const role = useSession((x) => x.role) ?? 'viewer';

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
  }, [lang]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useOps.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); st.set({ paletteOpen: !st.paletteOpen, q: '' }); }
      else if (e.key === 'Escape') st.closeOverlays();
      else if (e.altKey && /^[1-6]$/.test(e.key)) { e.preventDefault(); st.set({ paletteOpen: false, layersOpen: false, sheet: 'insp' }); navigate(`/${MODES[+e.key - 1].id}`); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const fr = s.frame === 'auto' ? null : FRAMES[s.frame];
  const LW = fr ? fr[0] : vp.w;
  const scale = fr ? Math.min((vp.w - 24) / fr[0], (vp.h - 24) / fr[1], 1) : 1;
  const L = layoutFor(LW);
  const isMobile = L === 'mobile', admin = mode === 'admin';
  const listOpen = s.listOpen ?? LW >= 1100;
  let areas: string, cols: string, rows: string;
  if (isMobile) {
    areas = '"top" "map" "sheet" "tabs"'; cols = 'minmax(0,1fr)'; rows = `52px minmax(0,1fr) ${s.sheetOpen ? '46%' : '48px'} 62px`;
  } else {
    const w = L === 'wall' ? [340, 440, 540] : L === 'desktop' ? [288, 368, 0] : [listOpen || admin ? 260 : 0, 320, 0];
    areas = '"top top top top" "list map insp vid" "time time time time"';
    cols = `${w[0]}px minmax(0,1fr) ${admin ? 0 : w[1]}px ${admin ? 0 : w[2]}px`;
    rows = '56px minmax(0,1fr) auto';
  }
  const listW = isMobile ? 0 : L === 'wall' ? 340 : L === 'desktop' ? 288 : listOpen ? 260 : 0;
  const mapW = isMobile ? LW : LW - listW - (admin ? 0 : L === 'wall' ? 980 : L === 'desktop' ? 368 : 320);
  const timeline = !isMobile && (mode === 'live' || mode === 'sim');
  const showRoleCard = mode === ROLE_HOME[role] && !admin;
  const showApi = s.showApi;
  const Lists: Record<Mode, JSX.Element> = { live: <LiveList showApi={showApi} />, analysis: <AnalysisList showApi={showApi} />, planning: <PlanningList showApi={showApi} />, sim: <SimList showApi={showApi} />, assets: <AssetsList showApi={showApi} />, admin: <AdminList /> };
  const Inspectors: Partial<Record<Mode, JSX.Element>> = { live: <LiveInspector showApi={showApi} />, analysis: <AnalysisInspector showApi={showApi} />, planning: <PlanningInspector showApi={showApi} />, sim: <SimInspector showApi={showApi} />, assets: <AssetsInspector showApi={showApi} /> };
  const openAlerts = s.alerts.filter((a) => a.status === 'active' || a.status === 'escalated');

  return (
    <div dir={lang === 'fa' ? 'rtl' : 'ltr'} lang={lang} style={{ position: 'fixed', inset: 0, background: '#0b0c13', display: 'grid', placeItems: 'center', overflow: 'hidden', fontFamily: 'Inter, Vazirmatn, system-ui, sans-serif', color: 'var(--color-text)', fontSize: 13, lineHeight: 1.55 }}>
      <div style={{ width: fr ? fr[0] : '100%', height: fr ? fr[1] : '100%', transform: fr ? `scale(${scale.toFixed(4)})` : 'none', borderRadius: fr ? 14 : 0, flex: 'none', position: 'relative', display: 'grid', gridTemplateAreas: areas, gridTemplateColumns: cols, gridTemplateRows: rows, background: 'var(--color-bg)', overflow: 'hidden' }}>
        <TopBar mode={mode} isMobile={isMobile} showStreams={L === 'desktop' || L === 'wall'} tablet={L === 'tablet'} />
        <OfflineBanner />

        <aside style={{ gridArea: isMobile ? 'sheet' : 'list', display: !isMobile || s.sheet === 'list' ? 'flex' : 'none', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden', background: 'var(--color-surface)' }}>
          {isMobile && <SheetSwitch active="list" />}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {showRoleCard && <RoleCard />}
            {Lists[mode]}
          </div>
        </aside>

        <main style={{ gridArea: 'map', position: 'relative', minWidth: 0, minHeight: 0, overflow: 'hidden', background: '#141622' }}>
          <div style={{ position: 'absolute', inset: 0, display: admin ? 'none' : 'block' }}>
            <MapStage mode={mode} narrow={mapW < 600} compact={isMobile} />
            {L === 'tablet' && !admin && (
              <button aria-label="toggle list" onClick={() => s.set({ listOpen: !listOpen })} style={{ position: 'absolute', bottom: 56, insetInlineStart: 12, zIndex: 3, width: 40, height: 40, borderRadius: 8, background: 'var(--color-surface)', boxShadow: 'var(--shadow-sm)' }}><i className="ph ph-sidebar" style={{ fontSize: 18 }} /></button>
            )}
          </div>
          {admin && <AdminMain showApi={showApi} compact={isMobile} />}
        </main>

        {!admin && (
          <section style={{ gridArea: isMobile ? 'sheet' : 'insp', display: !isMobile || s.sheet === 'insp' ? 'flex' : 'none', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden', background: 'var(--color-surface)' }}>
            {isMobile && <SheetSwitch active="insp" />}
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>{Inspectors[mode]}</div>
          </section>
        )}

        {L === 'wall' && !admin && (
          <section style={{ gridArea: 'vid', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, minHeight: 0, overflow: 'hidden', padding: 14, background: 'var(--color-bg)', boxShadow: 'inset 1px 0 0 var(--color-neutral-900)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontWeight: 500 }}>{t('tab.video')} · 4K</span><span className="ltr" style={{ fontSize: 11, color: 'var(--color-neutral-400)' }}>D-01 · 4K</span></div>
            <div style={{ aspectRatio: '16/9', borderRadius: 10, background: 'repeating-linear-gradient(135deg,#1c1e2c 0 8px,#20222f 8px 16px)', position: 'relative' }}><span className="mono" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 11, color: 'var(--color-neutral-500)' }}>{t('video.noStream')}</span></div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontWeight: 500 }}>{t('alerts')}</span><span style={{ fontSize: 11, color: 'var(--color-neutral-400)' }}>{openAlerts.length} {t('status.active')}</span></div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>{s.alerts.map((a) => <AlertCard key={a.id} alert={a} variant="log" />)}</div>
          </section>
        )}

        {timeline && <Timeline mode={mode} />}

        {isMobile && (
          <nav aria-label="workspaces" style={{ gridArea: 'tabs', display: 'flex', alignItems: 'stretch', background: 'var(--color-surface)', boxShadow: 'inset 0 1px 0 var(--color-neutral-900)' }}>
            {MODES.map((m) => (
              <button key={m.id} onClick={() => { s.set({ sheet: 'insp' }); navigate(`/${m.id}`); }} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, color: m.id === mode ? 'var(--color-accent-200)' : 'var(--color-neutral-400)', minHeight: 44, fontSize: 10 }}>
                <i className={`ph ph-${m.icon}`} style={{ fontSize: 20 }} />{t(`mode.${m.id}`)}
              </button>
            ))}
          </nav>
        )}

        <AccountMenu />
        <CommandPalette />
        <PanicDialog />
        <ToastView bottom={isMobile ? '76px' : timeline ? '96px' : '20px'} />
      </div>
    </div>
  );
}
