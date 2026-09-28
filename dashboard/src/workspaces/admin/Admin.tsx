import { useEffect, useState } from 'react';
import { useOps, type AdminTab } from '../../stores/ops';
import { useT } from '../../app/hooks';
import { adminPost, download, loadAdmin, reportText } from '../../app/actions';
import { useSession } from '../../stores/session';
import { usePrefs } from '../../stores/prefs';
import { can } from '../../app/roles';
import type { MaintenanceTask, ManagedKey, Role, ScanResult, SlaMetric, SyncEnvelope, SyncStatus, User } from '../../api/types';
import { LANGS, LANG_META, pick, type Lang, type Tri } from '../../i18n';

const TABS: Array<{ id: AdminTab; icon: string; api: string }> = [
  { id: 'branches', icon: 'buildings', api: 'GET /api/branches · GET /api/sync/status' },
  { id: 'reports', icon: 'file-text', api: 'GET /api/branches/:id/reports/summary' },
  { id: 'sla', icon: 'gauge', api: 'GET /api/operations/sla/metrics' },
  { id: 'maint', icon: 'wrench', api: 'GET /api/operations/maintenance/tasks' },
  { id: 'gov', icon: 'seal-check', api: 'GET /api/governance/compliance' },
  { id: 'sec', icon: 'key', api: 'GET /api/advanced-security/keys' },
  { id: 'train', icon: 'graduation-cap', api: 'GET /api/training/programs' },
  { id: 'users', icon: 'users', api: 'GET /api/auth/users' },
];

export function AdminList() {
  const { t } = useT();
  const s = useOps();
  return (
    <nav className="col" style={{ gap: 2 }} aria-label={t('mode.admin')}>
      {TABS.map((a) => (
        <button key={a.id} className="list-item" aria-current={a.id === s.adminTab} onClick={() => s.set({ adminTab: a.id, sheet: 'insp' })} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <i className={`ph ph-${a.icon}`} style={{ fontSize: 16 }} /><span>{t(`ad.${a.id}`)}</span>
        </button>
      ))}
    </nav>
  );
}

function useAdminData<T>(path: string, deps: unknown[] = []): [T | null, (v: T | null) => void] {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    void loadAdmin<T>(path).then((d) => { if (alive) setData(d); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  return [data, setData];
}

function Sla() {
  const { t, x, N } = useT();
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((v) => v + 1), 5000); return () => clearInterval(id); }, []);
  const [d] = useAdminData<{ metrics: SlaMetric[] }>('/operations/sla/metrics', [tick]);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 10 }}>
      {(d?.metrics ?? []).map((m) => (
        <div key={m.id} className="card" style={{ boxShadow: m.ok ? undefined : 'inset 0 0 0 1.5px var(--warning)' }}>
          <span className="row-between caption"><span>{x(m.name)}</span>{m.live && <span className="chip chip-success" style={{ padding: '0 6px' }}>● {t('ad.live')}</span>}</span>
          <span className="kpi" style={{ fontSize: 22 }}>{N(x(m.value))}</span>
          <span className="caption" style={{ color: m.ok ? 'var(--success)' : 'var(--warning)' }}>{m.ok ? t('ad.inTarget') : t('ad.outTarget')} · {t('ad.target', { t: x(m.target) })}</span>
        </div>
      ))}
    </div>
  );
}

function Maintenance() {
  const { t, x, clock } = useT();
  const [d, setD] = useAdminData<{ tasks: MaintenanceTask[] }>('/operations/maintenance/tasks');
  const allowed = can(useSession((st) => st.role), 'run:maintenance');
  const chip = { ok: 'chip-success', partial: 'chip-warning', due: 'chip-warning' } as const;
  return (
    <div className="table-wrap"><table className="table" style={{ minWidth: 620 }}>
      <thead><tr><th>{t('ad.task')}</th><th>{t('ad.schedule')}</th><th>{t('ad.lastRun')}</th><th>{t('ad.status')}</th><th /></tr></thead>
      <tbody>
        {d?.tasks.map((m) => (
          <tr key={m.id}>
            <td>{x(m.name)}</td><td className="muted">{x(m.schedule)}</td><td className="muted num">{m.last_run ? clock(m.last_run) : t('ad.never')}</td>
            <td><span className={`chip ${chip[m.status]}`}>{t(`ad.task.${m.status}`)}</span></td>
            <td style={{ textAlign: 'end' }}><button className="btn btn-sm" disabled={!allowed} onClick={() => adminPost<MaintenanceTask>(`/operations/maintenance/${m.id}/run`, 'ad.ran', { n: x(m.name) }, (r) => setD({ tasks: d.tasks.map((q) => (q.id === r.id ? r : q)) }))}>{t('ad.run')}</button></td>
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}

function Governance() {
  const { t, x, N } = useT();
  const [d] = useAdminData<{ frameworks: Array<{ framework: string; score: number; note: Tri }>; data_classes: Array<{ name: Tri; classification: Tri; retention: Tri; encryption: string }> }>('/governance/compliance');
  const chip = (c: Tri) => (c.en === 'Secret' ? 'chip-danger' : c.en === 'Confidential' ? 'chip-warning' : 'chip-info');
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 10 }}>
        {d?.frameworks.map((c) => (
          <div key={c.framework} className="card">
            <div className="row-between"><b className="ltr">{c.framework}</b><span className="kpi" style={{ fontSize: 20 }}>{t('unit.pct', { n: c.score })}</span></div>
            <div className="bar"><span style={{ width: `${c.score}%` }} /></div>
            <span className="caption">{N(x(c.note))}</span>
          </div>
        ))}
      </div>
      <div className="table-wrap"><table className="table" style={{ minWidth: 560 }}>
        <thead><tr><th>{t('ad.dataClass')}</th><th>{t('ad.classification')}</th><th>{t('ad.retention')}</th><th>{t('ad.encryption')}</th></tr></thead>
        <tbody>{d?.data_classes.map((c) => <tr key={c.name.en}><td>{x(c.name)}</td><td><span className={`chip ${chip(c.classification)}`}>{x(c.classification)}</span></td><td className="muted">{x(c.retention)}</td><td className="muted mono ltr" style={{ fontSize: 11 }}>{c.encryption}</td></tr>)}</tbody>
      </table></div>
    </>
  );
}

function Security() {
  const { t, clock } = useT();
  const [d, setD] = useAdminData<{ keys: ManagedKey[]; last_scan: ScanResult | null }>('/advanced-security/keys');
  const allowed = can(useSession((st) => st.role), 'manage:keys');
  const scan = d?.last_scan;
  return (
    <>
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn btn-primary" disabled={!allowed} onClick={() => adminPost<ScanResult>('/advanced-security/scan', 'ad.scanDone', {}, (r) => d && setD({ ...d, last_scan: r }))}><i className="ph ph-scan" />{t('ad.scan')}</button>
        <span className="muted" style={{ fontSize: 12 }}>{scan ? t('ad.scanResult', { t: clock(scan.at), c: scan.critical, m: scan.medium, a: scan.audit.valid ? t('ad.chainOk', { n: scan.audit.entries }) : t('ad.chainBroken', { i: scan.audit.broken_at ?? 0 }) }) : t('ad.scanNone')}</span>
      </div>
      <div className="table-wrap"><table className="table" style={{ minWidth: 560 }}>
        <thead><tr><th>{t('ad.key')}</th><th>{t('ad.algorithm')}</th><th>{t('ad.age')}</th><th>{t('ad.nextRotation')}</th><th /></tr></thead>
        <tbody>{d?.keys.map((k) => (
          <tr key={k.name}>
            <td className="mono ltr" style={{ fontSize: 12 }}>{k.name}</td><td className="muted ltr">{k.algorithm}</td>
            <td className="muted">{t('ad.days', { n: k.age_days })}</td><td style={{ color: k.next_rotation_days <= 7 ? 'var(--warning)' : 'var(--success)' }}>{t('ad.inDays', { n: k.next_rotation_days })}</td>
            <td style={{ textAlign: 'end' }}><button className="btn btn-sm" disabled={!allowed} onClick={() => adminPost<ManagedKey>(`/advanced-security/keys/${k.name}/rotate`, 'ad.rotated', { n: k.name }, (r) => setD({ ...d, keys: d.keys.map((q) => (q.name === r.name ? r : q)) }))}>{t('ad.rotate')}</button></td>
          </tr>
        ))}</tbody>
      </table></div>
    </>
  );
}

function Training() {
  const { t, x } = useT();
  const [d] = useAdminData<{ programs: Array<{ role: Role; name: Tri; modules: Tri; completion: number }> }>('/training/programs');
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 10 }}>
      {d?.programs.map((p) => (
        <div key={p.role} className="card">
          <b>{x(p.name)}</b><span className="caption">{x(p.modules)}</span>
          <div className="bar"><span style={{ width: `${p.completion}%` }} /></div><span className="caption">{t('ad.completed', { n: p.completion })}</span>
        </div>
      ))}
    </div>
  );
}

function Users() {
  const { t, x, date } = useT();
  const branch = useSession((st) => st.branch);
  const [d] = useAdminData<{ users: User[] }>('/auth/users', [branch]);
  return (
    <div className="table-wrap"><table className="table" style={{ minWidth: 720 }}>
      <thead><tr><th>{t('ad.user')}</th><th>{t('ad.roleCol')}</th><th>{t('ad.branchesCol')}</th><th>{t('ad.scope')}</th><th>{t('ad.lastLogin')}</th><th>{t('ad.status')}</th></tr></thead>
      <tbody>{d?.users.map((u) => (
        <tr key={u.id}>
          <td>{x(u.name)} <span className="caption mono ltr">{u.username}</span></td>
          <td>{t(`role.${u.role}`)}</td>
          <td><span className="row wrap" style={{ gap: 4 }}>{u.memberships.map((m) => <span key={m.branch} className="chip" title={t(`role.${m.role}`)}>{m.branch}</span>)}</span></td>
          <td>{u.scope === 'regional' ? <span className="chip chip-accent">{t('ad.scope.regional')}</span> : t('ad.scope.branch')}</td>
          <td className="muted">{u.last_login ? date(u.last_login) : '—'}</td>
          <td><span className={`chip ${u.active ? 'chip-success' : 'chip-danger'}`}>{u.active ? t('ad.active') : t('ad.inactive')}</span></td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

function Branches() {
  const { t, x, N, date, clock } = useT();
  const s = useOps();
  const allowed = can(useSession((st) => st.role), 'run:maintenance');
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((v) => v + 1), 4000); return () => clearInterval(id); }, []);
  const [feed] = useAdminData<{ items: SyncEnvelope[] }>('/sync/feed', [tick, s.sync]);
  const [st] = useAdminData<{ status: SyncStatus[] }>('/sync/status', [tick]);
  const status = st?.status ?? s.sync;
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 10 }}>
        {s.branches.map((b) => {
          const sy = status.find((q) => q.branch === b.id);
          return (
            <div key={b.id} className="card" data-testid={`branch-card-${b.id}`}>
              <div className="row-between"><b>{x(b.name)}</b><span className="row" style={{ gap: 4 }}>{b.hq && <span className="chip chip-accent">{t('branch.hq')}</span>}<span className="chip">{b.id}</span></span></div>
              <div className="grid-3">
                <div className="tile"><div className="caption">{t('ad.openAlerts')}</div><div className="v">{N(b.open_alerts)}</div></div>
                <div className="tile"><div className="caption">{t('ad.runningPlans')}</div><div className="v">{N(b.running_plans)}</div></div>
                <div className="tile"><div className="caption">{t('ad.blindSpots')}</div><div className="v">{N(b.blind_spots)}</div></div>
              </div>
              <span className="caption">{t('ad.dataSource')}: {t(b.data_source === 'osm' ? 'ad.src.osm' : 'ad.src.synthetic')}</span>
              {sy && (
                <>
                  <hr className="divider" />
                  <div className="row-between"><span className="row" style={{ gap: 6 }}>{t('ad.link')}: <span className={`chip ${sy.link === 'up' ? 'chip-success' : 'chip-danger'}`}>{t(sy.link === 'up' ? 'ad.link.up' : 'ad.link.down')}</span></span>
                    <button className={`btn btn-sm ${sy.link === 'up' ? 'btn-danger' : 'btn-outline'}`} disabled={!allowed} data-testid={`link-${b.id}`}
                      onClick={() => adminPost<SyncStatus>('/sync/link', 'ad.linkChanged', { b: b.id, s: t(sy.link === 'up' ? 'ad.link.down' : 'ad.link.up') }, () => setTick((v) => v + 1), { branch: b.id, up: sy.link !== 'up' })}>
                      {t(sy.link === 'up' ? 'ad.linkToggle' : 'ad.linkRestore')}
                    </button></div>
                  <div className="grid-2 caption">
                    <span>{t('ad.outbox')}: <b className="num">{N(sy.outbox)}</b></span><span>{t('ad.sent')}: <b className="num">{N(sy.sent)}</b></span>
                    <span>{t('ad.received')}: <b className="num">{N(sy.received)}</b></span><span>{t('ad.duplicates')}: <b className="num">{N(sy.duplicates)}</b></span>
                  </div>
                  <span className="caption">{t('ad.lastSync')}: {sy.last_sync ? date(sy.last_sync) : '—'}</span>
                </>
              )}
            </div>
          );
        })}
      </div>
      <span className="muted" style={{ fontSize: 12.5 }}>{t('ad.syncHelp')}</span>
      <h3>{t('ad.feed')}</h3>
      {(feed?.items ?? []).length === 0 && <span className="muted">{t('ad.feedEmpty')}</span>}
      <div className="col" style={{ gap: 6 }}>
        {(feed?.items ?? []).slice(0, 30).map((e) => {
          const title = (e.payload.title ?? e.payload.label ?? e.id) as Tri | string;
          return (
            <div key={`${e.origin}-${e.kind}-${e.id}`} className="card-2" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: '8px 10px' }}>
              <span className="chip">{e.origin}</span><span className="chip chip-info">{t(`ad.kind.${e.kind}`)}</span>
              <span className="truncate" style={{ flex: 1 }}>{typeof title === 'string' ? title : x(title)}{e.payload.status ? ` · ${String(e.payload.status)}` : ''}</span>
              <span className="caption mono">v{N(e.version)} · {clock(e.at)}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Reports() {
  const { t, x, N, F } = useT();
  const s = useOps();
  const uiLang = usePrefs((p) => p.lang);
  const active = useSession((st) => st.branch)!;
  const [branch, setBranch] = useState(active);
  const [days, setDays] = useState(1);
  const [lang, setLang] = useState<Lang>(uiLang);
  const [summary, setSummary] = useState<Record<string, any> | null>(null);
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  useEffect(() => { let alive = true; void reportText(branch, 'json', from, lang).then((txt) => { if (alive && txt) setSummary(JSON.parse(txt)); }); return () => { alive = false; }; }, [branch, days]); // eslint-disable-line react-hooks/exhaustive-deps
  const openHtml = async () => {
    const html = await reportText(branch, 'html', from, lang);
    if (!html) return;
    const w = window.open('', '_blank');
    if (w) { w.document.open(); w.document.write(html); w.document.close(); } else download(`report-${branch}.html`, html, 'text/html');
  };
  const kpis: Array<[string, string]> = summary ? [
    [t('ad.rep.alerts'), N(summary.alerts.total)], [t('ad.rep.ack'), summary.alerts.ack_median_s == null ? '—' : t('unit.s', { n: summary.alerts.ack_median_s })],
    [t('ad.rep.incidents'), N(summary.incidents.active)], [t('ad.rep.plans'), N(summary.plans.total)],
    [t('ad.rep.blind'), `${N(summary.blind_spots.total)} · ${t('unit.km2', { n: F(summary.blind_spots.area_km2, 1) })}`], [t('ad.rep.devices'), `${N(summary.devices.online)}/${N(summary.devices.total)}`],
  ] : [];
  return (
    <>
      <div className="card" style={{ maxWidth: 760 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
          <label className="field">{t('ad.rep.branch')}<select className="select" value={branch} onChange={(e) => setBranch(e.target.value)} data-testid="report-branch">{s.branches.map((b) => <option key={b.id} value={b.id}>{x(b.name)}</option>)}</select></label>
          <label className="field">{t('ad.rep.period')}<select className="select" value={days} onChange={(e) => setDays(+e.target.value)}><option value={1}>{t('ad.rep.24h')}</option><option value={7}>{t('ad.rep.7d')}</option><option value={30}>{t('ad.rep.30d')}</option></select></label>
          <label className="field">{t('ad.rep.lang')}<select className="select" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>{LANGS.map((l) => <option key={l} value={l}>{LANG_META[l].label}</option>)}</select></label>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn btn-primary" onClick={() => void openHtml()} data-testid="report-open"><i className="ph ph-printer" />{t('ad.rep.open')}</button>
          <button className="btn" onClick={async () => { const c = await reportText(branch, 'csv', from, lang); if (c) download(`report-${branch}.csv`, c, 'text/csv;charset=utf-8'); }}><i className="ph ph-file-csv" />{t('ad.rep.csv')}</button>
          <button className="btn" onClick={async () => { const j = await reportText(branch, 'json', from, lang); if (j) download(`report-${branch}.json`, j, 'application/json'); }}><i className="ph ph-brackets-curly" />{t('ad.rep.json')}</button>
        </div>
      </div>
      {summary && (
        <>
          <h3>{t('ad.rep.preview')} · {pick(summary.branch_name, uiLang)}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 10 }} data-testid="report-kpis">
            {kpis.map(([l, v]) => <div key={l} className="card"><span className="caption">{l}</span><span className="kpi" style={{ fontSize: 22 }}>{v}</span></div>)}
          </div>
        </>
      )}
    </>
  );
}

export function AdminMain({ showApi, compact }: { showApi: boolean; compact: boolean }) {
  const { t } = useT();
  const tab = useOps((s) => s.adminTab);
  const def = TABS.find((q) => q.id === tab)!;
  return (
    <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', padding: compact ? 16 : '26px 30px', display: 'flex', flexDirection: 'column', gap: 16, background: 'var(--bg)' }}>
      <div className="row-between wrap"><h1 style={{ fontSize: 22 }}>{t(`ad.${tab}`)}</h1>{showApi && <span className="api-hint">{def.api}</span>}</div>
      {tab === 'sla' && <Sla />}
      {tab === 'maint' && <Maintenance />}
      {tab === 'gov' && <Governance />}
      {tab === 'sec' && <Security />}
      {tab === 'train' && <Training />}
      {tab === 'users' && <Users />}
      {tab === 'branches' && <Branches />}
      {tab === 'reports' && <Reports />}
    </div>
  );
}
