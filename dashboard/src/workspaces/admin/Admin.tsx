import { useEffect, useState } from 'react';
import { useOps, type AdminTab } from '../../stores/ops';
import { useT } from '../../app/hooks';
import { bgc, clock, fg } from '../../lib/format';
import { adminPost, loadAdmin } from '../../app/actions';
import { useSession } from '../../stores/session';
import { can } from '../../app/roles';
import type { MaintenanceTask, ManagedKey, Role, ScanResult, SlaMetric, User } from '../../api/types';

const TABS: Array<{ id: AdminTab; icon: string; api: string }> = [
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
    <>
      {TABS.map((a) => (
        <button key={a.id} className="hov-bg" onClick={() => s.set({ adminTab: a.id, sheet: 'insp' })}
          style={{ color: a.id === s.adminTab ? 'var(--color-accent-200)' : 'var(--color-text)', textAlign: 'start', padding: '9px 10px', borderRadius: 8, background: a.id === s.adminTab ? 'var(--color-accent-900)' : 'transparent', display: 'flex', gap: 10, alignItems: 'center' }}>
          <i className={`ph ph-${a.icon}`} style={{ fontSize: 16 }} /><span style={{ flex: 1 }}>{t(`ad.${a.id}`)}</span>
        </button>
      ))}
    </>
  );
}

function useAdminData<T>(path: string, deps: unknown[] = []): [T | null, (v: T | null) => void, boolean] {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadAdmin<T>(path).then((d) => { if (alive) { setData(d); setLoading(false); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  return [data, setData, loading];
}

const Card = ({ children, ring }: { children: React.ReactNode; ring?: string }) => (
  <div style={{ borderRadius: 12, padding: 14, background: 'var(--color-surface)', display: 'flex', flexDirection: 'column', gap: 6, boxShadow: ring ?? 'none' }}>{children}</div>
);
const Table = ({ children, min = 560 }: { children: React.ReactNode; min?: number }) => (
  <div style={{ borderRadius: 12, background: 'var(--color-surface)', overflowX: 'auto' }}><table className="admin-table" style={{ minWidth: min }}>{children}</table></div>
);

function Sla() {
  const { t, N } = useT();
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((x) => x + 1), 5000); return () => clearInterval(id); }, []);
  const [d] = useAdminData<{ metrics: SlaMetric[] }>('/operations/sla/metrics', [tick]);
  const metrics = d?.metrics ?? [];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))', gap: 10 }}>
      {metrics.map((m) => (
        <Card key={m.id} ring={m.ok ? undefined : `inset 0 0 0 1px oklch(0.72 0.15 90)`}>
          <span style={{ fontSize: 12, color: 'var(--color-neutral-400)', display: 'flex', justifyContent: 'space-between' }}>{m.name}{m.live && <span style={{ color: fg(150), fontSize: 10.5 }}>● {t('ad.live')}</span>}</span>
          <span style={{ fontSize: 22, fontWeight: 500 }}>{N(m.value)}</span>
          <span style={{ fontSize: 11, color: fg(m.ok ? 150 : 90) }}>{m.ok ? t('ad.inTarget') : t('ad.outTarget')} · {t('ad.target', { t: m.target })}</span>
        </Card>
      ))}
    </div>
  );
}

function Maintenance() {
  const { t, N } = useT();
  const [d, setD] = useAdminData<{ tasks: MaintenanceTask[] }>('/operations/maintenance/tasks');
  const allowed = can(useSession((x) => x.role), 'run:maintenance');
  const hue = { ok: 150, partial: 90, due: 90 } as const;
  return (
    <Table min={620}>
      <thead><tr><th>{t('ad.task')}</th><th>{t('ad.schedule')}</th><th>{t('ad.lastRun')}</th><th>{t('ad.status')}</th><th /></tr></thead>
      <tbody>
        {d?.tasks.map((m) => (
          <tr key={m.id}>
            <td>{m.name}</td><td className="muted">{m.schedule}</td><td className="muted">{m.last_run ? N(clock(m.last_run)) : t('ad.never')}</td>
            <td style={{ color: fg(hue[m.status]) }}>{t(`ad.task.${m.status}`)}</td>
            <td style={{ textAlign: 'end' }}><button className="btn-outline" disabled={!allowed} onClick={() => adminPost<MaintenanceTask>(`/operations/maintenance/${m.id}/run`, 'ad.ran', { n: m.name }, (r) => setD({ tasks: d.tasks.map((x) => (x.id === r.id ? r : x)) }))}>{t('ad.run')}</button></td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function Governance() {
  const { t, N } = useT();
  const [d] = useAdminData<{ frameworks: Array<{ framework: string; score: number; note: string }>; data_classes: Array<{ name: string; classification: string; retention: string; encryption: string }> }>('/governance/compliance');
  const classHue: Record<string, number> = { 'سری': 25, 'محرمانه': 55, 'داخلی': 250 };
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 10 }}>
        {d?.frameworks.map((c) => (
          <Card key={c.framework}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ fontWeight: 500 }}>{c.framework}</span><span style={{ fontSize: 18, fontWeight: 500 }}>{N(c.score)}٪</span></div>
            <div className="bar"><span style={{ width: `${c.score}%` }} /></div>
            <span style={{ fontSize: 11.5, color: 'var(--color-neutral-400)' }}>{c.note}</span>
          </Card>
        ))}
      </div>
      <Table>
        <thead><tr><th>{t('ad.dataClass')}</th><th>{t('ad.classification')}</th><th>{t('ad.retention')}</th><th>{t('ad.encryption')}</th></tr></thead>
        <tbody>
          {d?.data_classes.map((c) => (
            <tr key={c.name}>
              <td>{c.name}</td>
              <td><span style={{ padding: '1px 8px', borderRadius: 5, background: bgc(classHue[c.classification] ?? 250), color: fg(classHue[c.classification] ?? 250), fontSize: 11.5 }}>{c.classification}</span></td>
              <td className="muted">{c.retention}</td><td className="muted mono ltr" style={{ fontSize: 11, textAlign: 'start' }}>{c.encryption}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}

function Security() {
  const { t, N } = useT();
  const [d, setD] = useAdminData<{ keys: ManagedKey[]; last_scan: ScanResult | null }>('/advanced-security/keys');
  const allowed = can(useSession((x) => x.role), 'manage:keys');
  const scan = d?.last_scan;
  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn-primary-fill" disabled={!allowed} style={{ padding: '8px 14px' }} onClick={() => adminPost<ScanResult>('/advanced-security/scan', 'ad.scanDone', {}, (r) => d && setD({ ...d, last_scan: r }))}><i className="ph ph-scan" />{t('ad.scan')}</button>
        <span style={{ fontSize: 12, color: 'var(--color-neutral-400)' }}>
          {scan ? t('ad.scanResult', { t: N(clock(scan.at)), c: N(scan.critical), m: N(scan.medium), a: scan.audit.valid ? t('ad.chainOk', { n: N(scan.audit.entries) }) : t('ad.chainBroken', { i: N(scan.audit.broken_at ?? 0) }) }) : t('ad.scanNone')}
        </span>
      </div>
      <Table>
        <thead><tr><th>{t('ad.key')}</th><th>{t('ad.algorithm')}</th><th>{t('ad.age')}</th><th>{t('ad.nextRotation')}</th><th /></tr></thead>
        <tbody>
          {d?.keys.map((k) => (
            <tr key={k.name}>
              <td className="mono ltr" style={{ fontSize: 12, textAlign: 'start' }}>{k.name}</td><td className="muted ltr" style={{ textAlign: 'start' }}>{k.algorithm}</td>
              <td className="muted">{t('ad.days', { n: N(k.age_days) })}</td><td style={{ color: fg(k.next_rotation_days <= 7 ? 90 : 150) }}>{t('ad.inDays', { n: N(k.next_rotation_days) })}</td>
              <td style={{ textAlign: 'end' }}><button className="btn-outline" disabled={!allowed} onClick={() => adminPost<ManagedKey>(`/advanced-security/keys/${k.name}/rotate`, 'ad.rotated', { n: k.name }, (r) => setD({ ...d, keys: d.keys.map((x) => (x.name === r.name ? r : x)) }))}>{t('ad.rotate')}</button></td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}

function Training() {
  const { t, N } = useT();
  const [d] = useAdminData<{ programs: Array<{ role: Role; name: string; modules: string; completion: number }> }>('/training/programs');
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 10 }}>
      {d?.programs.map((p) => (
        <Card key={p.role}>
          <span style={{ fontWeight: 500 }}>{t(`role.${p.role}`)}</span><span style={{ fontSize: 11.5, color: 'var(--color-neutral-400)' }}>{p.modules}</span>
          <div className="bar"><span style={{ width: `${p.completion}%` }} /></div><span style={{ fontSize: 11.5 }}>{t('ad.completed', { n: N(p.completion) })}</span>
        </Card>
      ))}
    </div>
  );
}

function Users() {
  const { t, N } = useT();
  const [d] = useAdminData<{ users: User[] }>('/auth/users');
  return (
    <Table>
      <thead><tr><th>{t('ad.user')}</th><th>{t('ad.roleCol')}</th><th>{t('ad.lastLogin')}</th><th>{t('ad.status')}</th></tr></thead>
      <tbody>
        {d?.users.map((u) => (
          <tr key={u.id}>
            <td>{u.name} <span className="caption mono">{u.username}</span></td><td>{t(`role.${u.role}`)}</td>
            <td className="muted">{u.last_login ? N(new Date(u.last_login).toLocaleDateString() + ' ' + clock(u.last_login)) : '—'}</td>
            <td style={{ color: fg(u.active ? 150 : 25) }}>{u.active ? t('ad.active') : t('ad.inactive')}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function AdminMain({ showApi, compact }: { showApi: boolean; compact: boolean }) {
  const { t } = useT();
  const tab = useOps((s) => s.adminTab);
  const def = TABS.find((x) => x.id === tab)!;
  return (
    <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', padding: compact ? 16 : '28px 32px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 22, fontWeight: 500, margin: 0 }}>{t(`ad.${tab}`)}</h1>
        {showApi && <span className="api-hint" style={{ fontSize: 10.5 }}>{def.api}</span>}
      </div>
      {tab === 'sla' && <Sla />}
      {tab === 'maint' && <Maintenance />}
      {tab === 'gov' && <Governance />}
      {tab === 'sec' && <Security />}
      {tab === 'train' && <Training />}
      {tab === 'users' && <Users />}
    </div>
  );
}
