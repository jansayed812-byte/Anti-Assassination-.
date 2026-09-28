import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOps, type Frame, type Mode } from '../stores/ops';
import { useSession } from '../stores/session';
import { layoutFor, useMode, useNow, useT, useViewport } from './hooks';
import { can, ROLE_HOME, ROLE_ICON, roleTasks, visibleModes } from './roles';
import { SEV } from '../lib/palette';
import { MapStage } from '../map/MapStage';
import { AlertCard } from '../ui/AlertCard';
import { AccountMenu, CommandPalette, OfflineBanner, PanicDialog, ToastView } from '../ui/Overlays';
import { BranchSwitcher, LanguageSwitcher } from '../ui/Switchers';
import { LiveInspector, LiveList } from '../workspaces/live/Live';
import { AnalysisInspector, AnalysisList } from '../workspaces/analysis/Analysis';
import { PlanningInspector, PlanningList } from '../workspaces/planning/Planning';
import { SimInspector, SimList } from '../workspaces/sim/Sim';
import { AssetsInspector, AssetsList } from '../workspaces/assets/Assets';
import { AdminList, AdminMain } from '../workspaces/admin/Admin';

const FRAMES: Record<Exclude<Frame, 'auto'>, [number, number]> = { wall: [2560, 1440], desktop: [1440, 900], tabletL: [1180, 820], tabletP: [820, 1180], mobile: [390, 844] };

function TopBar({ mode, isMobile, tablet, wall }: { mode: Mode; isMobile: boolean; tablet: boolean; wall: boolean }) {
  const { t, N } = useT();
  const navigate = useNavigate();
  const s = useOps();
  const role = useSession((x) => x.role) ?? 'viewer';
  const modes = visibleModes(role);
  const open = s.alerts.filter((a) => a.status === 'active' || a.status === 'escalated');
  const crit = open.filter((a) => a.level === 'critical').length;
  const online = s.conn === 'online';
  const compact = isMobile || tablet;
  return (
    <header style={{ gridArea: 'top', display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', minWidth: 0, position: 'relative', zIndex: 6, background: 'var(--surface)', boxShadow: 'inset 0 -1px 0 var(--line)' }}>
      <span title={t('brand')} className="row" style={{ gap: 8, flex: 'none' }}>
        <span style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--accent)', color: 'var(--accent-ink)', display: 'grid', placeItems: 'center', fontSize: 17 }}><i className="ph ph-shield-chevron" /></span>
        {wall && <span className="col" style={{ gap: 0, lineHeight: 1.2 }}><b style={{ fontSize: 13 }}>{t('brand')}</b><span className="caption">{t('brand.sub')}</span></span>}
      </span>
      {isMobile ? <b style={{ fontSize: 15, whiteSpace: 'nowrap' }}>{t(`mode.${mode}`)}</b> : (
        <nav aria-label={t('nav.workspaces')} className="row" style={{ gap: 1, flex: '0 1 auto', minWidth: 0, overflowX: 'auto', scrollbarWidth: 'none' }}>
          {modes.map((m, i) => (
            <button key={m.id} className="btn btn-ghost" onClick={() => navigate(`/${m.id}`)} title={`${t(`mode.${m.id}`)} (Alt+${i + 1})`} aria-label={t(`mode.${m.id}`)} aria-current={m.id === mode ? 'page' : undefined}
              style={{ color: m.id === mode ? 'var(--accent)' : undefined, background: m.id === mode ? 'var(--accent-soft)' : undefined, paddingInline: 9, flex: 'none' }}>
              <i className={`ph ph-${m.icon}`} style={{ fontSize: 16 }} />{(!tablet || m.id === mode) && <span>{t(`mode.${m.id}`)}</span>}
            </button>
          ))}
        </nav>
      )}
      <span className="spacer" style={{ minWidth: 4 }} />
      <BranchSwitcher compact={compact} />
      <button className="btn btn-ghost" onClick={() => s.set({ paletteOpen: true, q: '' })} aria-label={t('search')} title={`${t('search')} (Ctrl K)`}
        style={{ flex: wall ? '0 1 300px' : 'none', minWidth: 34, justifyContent: 'flex-start', background: 'var(--bg-2)', boxShadow: 'inset 0 0 0 1px var(--line)' }}>
        <i className="ph ph-magnifying-glass" />
        {wall && <><span className="truncate faint" style={{ flex: 1, textAlign: 'start' }}>{t('search')}</span><span className="kbd ltr">Ctrl K</span></>}
      </button>
      {wall && (
        <span className="mono ltr row" title="Socket.IO" style={{ gap: 10, fontSize: 10.5, color: 'var(--text-3)', flex: 'none' }}>
          <span className="row" style={{ gap: 5 }}><span className="dot" style={{ background: online ? 'var(--success)' : 'var(--danger)' }} />TLM</span>
          <span className="row" style={{ gap: 5 }}><span className="dot" style={{ background: online ? 'var(--success)' : 'var(--warning)' }} />{online ? 'SYNC' : `BUF ${s.outbox}`}</span>
        </span>
      )}
      {!isMobile && <LanguageSwitcher compact={!wall} />}
      <button className="btn" onClick={() => { s.set({ liveTab: 'alerts', sheet: 'list', sheetOpen: true, listOpen: true }); navigate('/live'); }} aria-label={`${t('alerts')}: ${open.length}`} title={t('alerts')} data-testid="alerts-button"
        style={{ flex: 'none', gap: 6 }}>
        <i className="ph ph-bell-ringing" />
        <span className="num">{N(open.length)}</span>
        {crit > 0 && !isMobile && <span className="chip chip-danger" style={{ padding: '0 7px' }}>{N(crit)} {t('alert.critical')}</span>}
      </button>
      {can(role, 'ack:alerts') && (
        <button className="btn btn-danger" onClick={() => s.set({ panicOpen: true })} aria-label={t('panic.title')} title={t('panic.title')} style={{ flex: 'none', fontWeight: 700 }}>
          <i className="ph ph-siren" />{!compact && <span>PANIC</span>}
        </button>
      )}
      <button onClick={() => s.set({ menuOpen: !s.menuOpen })} aria-label={t('account')} aria-expanded={s.menuOpen} title={t(`role.${role}`)}
        style={{ flex: 'none', width: 34, height: 34, borderRadius: '50%', background: 'var(--accent-soft)', color: 'var(--accent)', boxShadow: 'inset 0 0 0 1px var(--accent-line)', display: 'grid', placeItems: 'center' }}>
        <i className={`ph ph-${ROLE_ICON[role]}`} style={{ fontSize: 16 }} />
      </button>
    </header>
  );
}

function RoleCard() {
  const { t, lang } = useT();
  const navigate = useNavigate();
  const s = useOps();
  const role = useSession((x) => x.role) ?? 'viewer';
  const tasks = roleTasks(role, s, lang);
  return (
    <section className="card-2" aria-label={t('forYou')}>
      <div className="row-between"><b>{t('forYou')}</b><span className="chip chip-accent">{t(`role.${role}`)}</span></div>
      {tasks.length === 0 && <span className="muted" style={{ fontSize: 12.5 }}>{t('task.none')}</span>}
      {tasks.map((k) => (
        <button key={k.text} className="list-item" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 6 }}
          onClick={() => { s.set({ ...(k.tab ? { liveTab: k.tab } : {}), ...(k.plan ? { planSel: k.plan, routeSel: null } : {}), ...(k.dev ? { devSel: k.dev } : {}), ...(k.zone ? { anTab: 'blind', anSel: { kind: 'zone', id: k.zone } } : {}) }); navigate(`/${k.mode}`); }}>
          <span className="dot" style={{ marginTop: 7, background: SEV[k.level].color }} /><span style={{ fontSize: 12.5 }}>{k.text}</span>
        </button>
      ))}
    </section>
  );
}

function SheetSwitch({ active }: { active: 'list' | 'insp' }) {
  const { t } = useT();
  const s = useOps();
  return (
    <div className="row" style={{ gap: 4, padding: '6px 8px', flex: 'none' }}>
      <div className="seg full" style={{ flex: 1 }}>
        <button aria-pressed={active === 'list'} onClick={() => s.set({ sheet: 'list', sheetOpen: true })}>{t('list')}</button>
        <button aria-pressed={active === 'insp'} onClick={() => s.set({ sheet: 'insp', sheetOpen: true })}>{t('details')}</button>
      </div>
      <LanguageSwitcher compact />
      <button className="btn btn-ghost btn-icon" aria-label={t('details')} onClick={() => s.set({ sheetOpen: !s.sheetOpen })}><i className={`ph ph-caret-${s.sheetOpen ? 'down' : 'up'}`} /></button>
    </div>
  );
}

function Timeline({ mode }: { mode: Mode }) {
  const { t, x, N, F, clock } = useT();
  const now = useNow();
  const s = useOps();
  const a = s.units.alpha?.telemetry;
  const sc = s.scenarios.find((q) => q.id === s.sim?.scenario_id);
  const window30 = 30 * 60_000;
  const marks = mode === 'sim'
    ? (s.sim?.events ?? []).map((e) => ({ pos: (e.t_ms / (s.sim?.duration_ms || 1)) * 100, c: SEV[e.level].color, t: x(e.message) }))
    : s.alerts.map((al) => ({ pos: 100 - ((now - Date.parse(al.created_at)) / window30) * 100, c: SEV[al.level].color, t: x(al.title) })).filter((m) => m.pos >= 0 && m.pos <= 100);
  const strip: Array<[string, string]> = mode === 'sim'
    ? [[t('m.speed'), `×${N(s.sim?.speed ?? 1)}`], [t('tl.events'), N(s.sim?.events.length ?? 0)]]
    : [[t('tl.alpha'), t('unit.kmh', { n: a?.speed_kmh ?? 0 })], [t('m.heading'), `${N(a?.heading_deg ?? 0)}°`], ['CEP95', t('unit.m', { n: F(a?.cep95_m ?? 0, 1) })], ['E2E', `${N(s.e2eMs)} ms`]];
  const playhead = mode === 'sim' ? s.sim?.progress ?? 0 : 100;
  return (
    <footer style={{ gridArea: 'time', display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 16px 10px', background: 'var(--surface)', boxShadow: 'inset 0 1px 0 var(--line)' }}>
      <div className="row wrap" style={{ gap: 14 }}>
        <span className="row mono" style={{ gap: 6, fontSize: 11.5 }}><span className="dot" style={{ background: mode === 'sim' ? 'var(--info)' : 'var(--danger)' }} />{mode === 'sim' ? `SIM · ${(sc?.id ?? s.scenSel).toUpperCase()}` : `LIVE · ${clock(now)}`}</span>
        {strip.map(([l, v]) => <span key={l} className="row" style={{ gap: 5, alignItems: 'baseline' }}><span className="caption">{l}</span><b className="num">{v}</b></span>)}
        <span className="spacer" />
        <span className="caption">{mode === 'sim' ? t('tl.simHint') : t('tl.liveHint')}</span>
      </div>
      <div style={{ position: 'relative', height: 22, borderRadius: 6, background: 'var(--bg-2)' }}>
        {marks.map((m, i) => <span key={i} title={m.t} style={{ position: 'absolute', insetInlineEnd: `${m.pos}%`, top: 4, width: 3, height: 14, borderRadius: 2, background: m.c }} />)}
        <span style={{ position: 'absolute', top: 0, bottom: 0, insetInlineEnd: `${playhead}%`, width: 2, background: 'var(--accent)', transition: 'inset-inline-end 1s linear' }} />
      </div>
    </footer>
  );
}

export function Shell() {
  const { t } = useT();
  const navigate = useNavigate();
  const mode = useMode();
  const vp = useViewport();
  const s = useOps();
  const role = useSession((x) => x.role) ?? 'viewer';
  const modes = visibleModes(role);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useOps.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); st.set({ paletteOpen: !st.paletteOpen, q: '' }); }
      else if (e.key === 'Escape') { st.closeOverlays(); if (st.picking) st.set({ picking: null }); }
      else if (e.altKey && /^[1-6]$/.test(e.key)) {
        const target = visibleModes(useSession.getState().role ?? 'viewer')[+e.key - 1];
        if (!target) return;
        e.preventDefault(); st.set({ paletteOpen: false, layersOpen: false, sheet: 'insp' }); navigate(`/${target.id}`);
      }
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
    areas = '"top" "map" "sheet" "tabs"'; cols = 'minmax(0,1fr)'; rows = `54px minmax(0,1fr) ${s.sheetOpen ? '46%' : '48px'} 62px`;
  } else {
    const w = L === 'wall' ? [360, 460, 520] : L === 'desktop' ? [300, 380, 0] : [listOpen || admin ? 270 : 0, 330, 0];
    areas = '"top top top top" "list map insp vid" "time time time time"';
    cols = `${w[0]}px minmax(0,1fr) ${admin ? 0 : w[1]}px ${admin ? 0 : w[2]}px`;
    rows = '56px minmax(0,1fr) auto';
  }
  const listW = isMobile ? 0 : L === 'wall' ? 360 : L === 'desktop' ? 300 : listOpen ? 270 : 0;
  const mapW = isMobile ? LW : LW - listW - (admin ? 0 : L === 'wall' ? 980 : L === 'desktop' ? 380 : 330);
  const timeline = !isMobile && (mode === 'live' || mode === 'sim');
  const showRoleCard = mode === ROLE_HOME[role] && !admin;
  const showApi = s.showApi;
  const Lists: Record<Mode, JSX.Element> = { live: <LiveList showApi={showApi} />, analysis: <AnalysisList showApi={showApi} />, planning: <PlanningList showApi={showApi} />, sim: <SimList showApi={showApi} />, assets: <AssetsList showApi={showApi} />, admin: <AdminList /> };
  const Inspectors: Partial<Record<Mode, JSX.Element>> = { live: <LiveInspector showApi={showApi} />, analysis: <AnalysisInspector showApi={showApi} />, planning: <PlanningInspector showApi={showApi} />, sim: <SimInspector showApi={showApi} />, assets: <AssetsInspector showApi={showApi} /> };
  const openAlerts = s.alerts.filter((a) => a.status === 'active' || a.status === 'escalated');

  return (
    <div style={{ position: 'fixed', inset: 0, background: fr ? 'var(--bg-2)' : 'var(--bg)', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
      <div style={{ width: fr ? fr[0] : '100%', height: fr ? fr[1] : '100%', transform: fr ? `scale(${scale.toFixed(4)})` : 'none', borderRadius: fr ? 14 : 0, flex: 'none', position: 'relative', display: 'grid', gridTemplateAreas: areas, gridTemplateColumns: cols, gridTemplateRows: rows, background: 'var(--bg)', overflow: 'hidden', boxShadow: fr ? 'var(--shadow-3)' : 'none' }}>
        <TopBar mode={mode} isMobile={isMobile} tablet={L === 'tablet'} wall={L === 'wall'} />
        <OfflineBanner />

        <aside aria-label={t('list')} style={{ gridArea: isMobile ? 'sheet' : 'list', display: !isMobile || s.sheet === 'list' ? 'flex' : 'none', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden', background: 'var(--surface)', boxShadow: 'inset -1px 0 0 var(--line)' }}>
          {isMobile && <SheetSwitch active="list" />}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {showRoleCard && <RoleCard />}
            {Lists[mode]}
          </div>
        </aside>

        <main style={{ gridArea: 'map', position: 'relative', minWidth: 0, minHeight: 0, overflow: 'hidden', background: 'var(--map-ground)' }}>
          {!admin && (
            <div style={{ position: 'absolute', inset: 0 }}>
              <MapStage mode={mode} narrow={mapW < 600} compact={isMobile} />
              {L === 'tablet' && (
                <button className="map-panel" aria-label={t('list')} onClick={() => s.set({ listOpen: !listOpen })} style={{ position: 'absolute', bottom: 64, insetInlineEnd: 12, zIndex: 3, width: 40, height: 40, display: 'grid', placeItems: 'center' }}><i className="ph ph-sidebar" style={{ fontSize: 18 }} /></button>
              )}
            </div>
          )}
          {admin && <AdminMain showApi={showApi} compact={isMobile} />}
        </main>

        {!admin && (
          <section aria-label={t('details')} style={{ gridArea: isMobile ? 'sheet' : 'insp', display: !isMobile || s.sheet === 'insp' ? 'flex' : 'none', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden', background: 'var(--surface)', boxShadow: 'inset 1px 0 0 var(--line)' }}>
            {isMobile && <SheetSwitch active="insp" />}
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>{Inspectors[mode]}</div>
          </section>
        )}

        {L === 'wall' && !admin && (
          <section style={{ gridArea: 'vid', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, minHeight: 0, overflow: 'hidden', padding: 14, background: 'var(--bg-2)' }}>
            <div className="row-between"><b>{t('tab.video')}</b><span className="caption ltr">D-01 · 4K</span></div>
            <div style={{ aspectRatio: '16/9', borderRadius: 10, background: 'repeating-linear-gradient(135deg, var(--surface) 0 8px, var(--surface-2) 8px 16px)', display: 'grid', placeItems: 'center' }}><span className="caption">{t('video.noStream')}</span></div>
            <div className="row-between"><b>{t('alerts')}</b><span className="caption">{openAlerts.length}</span></div>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>{s.alerts.map((a) => <AlertCard key={a.id} alert={a} variant="log" />)}</div>
          </section>
        )}

        {timeline && <Timeline mode={mode} />}

        {isMobile && (
          <nav aria-label={t('nav.workspaces')} style={{ gridArea: 'tabs', display: 'flex', alignItems: 'stretch', background: 'var(--surface)', boxShadow: 'inset 0 1px 0 var(--line)' }}>
            {modes.map((m) => (
              <button key={m.id} aria-current={m.id === mode ? 'page' : undefined} onClick={() => { s.set({ sheet: 'insp' }); navigate(`/${m.id}`); }} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, color: m.id === mode ? 'var(--accent)' : 'var(--text-3)', minHeight: 44, fontSize: 10 }}>
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
