import { useState } from 'react';
import { useOps } from '../../stores/ops';
import { useSession } from '../../stores/session';
import { useT } from '../../app/hooks';
import { bgc, fg, RISK_HUE } from '../../lib/format';
import { approvePlan, createPlan, setActiveRoute, submitPlan } from '../../app/actions';
import type { Plan } from '../../api/types';

const STATUS_HUE: Record<Plan['status'], number> = { running: 150, pending_approval: 90, approved: 150, closed: 250, draft: 250 };

export function PlanningList({ showApi }: { showApi: boolean }) {
  const { t, N } = useT();
  const s = useOps();
  const role = useSession((x) => x.role);
  const [form, setForm] = useState({ origin: 'پایگاه شمالی · 35.742, 51.301', destination: 'مجموعهٔ جنوبی · 35.612, 51.468', vip_level: 3, priority: 'security' as Plan['priority'] });
  const canWrite = role === 'planner' || role === 'commander' || role === 'admin';
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 500, fontSize: 14 }}>{t('pl.title')}</span>
        {canWrite && <button className="btn-accent-outline" onClick={() => s.set({ newPlan: !s.newPlan })}><i className="ph ph-plus" />{t('pl.new')}</button>}
      </div>
      {s.newPlan && canWrite && (
        <div style={{ borderRadius: 12, padding: 12, background: 'var(--color-bg)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {showApi && <span className="api-hint">POST /api/security/escort-plan</span>}
          <label className="field-label">{t('pl.origin')}<input className="field-input" style={{ background: 'var(--color-surface)' }} value={form.origin} onChange={(e) => setForm({ ...form, origin: e.target.value })} /></label>
          <label className="field-label">{t('pl.destination')}<input className="field-input" style={{ background: 'var(--color-surface)' }} value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} /></label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label className="field-label">{t('pl.vip')}
              <select className="field-input" style={{ background: 'var(--color-surface)' }} value={form.vip_level} onChange={(e) => setForm({ ...form, vip_level: +e.target.value })}>
                {[5, 4, 3, 2, 1].map((v) => <option key={v} value={v}>{N(v)}</option>)}
              </select>
            </label>
            <label className="field-label">{t('pl.priority')}
              <select className="field-input" style={{ background: 'var(--color-surface)' }} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Plan['priority'] })}>
                {(['security', 'time', 'balanced'] as const).map((p) => <option key={p} value={p}>{t(`pl.pri.${p}`)}</option>)}
              </select>
            </label>
          </div>
          <button className="btn-primary-fill" onClick={() => createPlan(form)}>{t('pl.compute')}</button>
        </div>
      )}
      {showApi && <span className="api-hint">GET /api/security/escort-plans</span>}
      {s.plans.map((p) => (
        <button key={p.id} className="hov-accent" onClick={() => s.set({ planSel: p.id, previewRoute: null, sheet: 'insp' })}
          style={{ textAlign: 'start', padding: 10, borderRadius: 8, background: p.id === s.planSel ? 'var(--color-accent-900)' : 'transparent', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="mono ltr" style={{ fontWeight: 500 }}>{p.id}</span>
            <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 6, background: bgc(STATUS_HUE[p.status]), color: fg(STATUS_HUE[p.status]) }}>{t(`pl.status.${p.status}`)}</span>
          </span>
          <span style={{ fontSize: 12 }}>{p.title}</span>
          <span style={{ fontSize: 11, color: 'var(--color-neutral-400)' }}>{t('pl.meta', { v: N(p.vip_level), start: p.start, n: N(p.vehicles) })}</span>
        </button>
      ))}
    </>
  );
}

export function PlanningInspector({ showApi }: { showApi: boolean }) {
  const { t, N } = useT();
  const s = useOps();
  const role = useSession((x) => x.role);
  const plan = s.plans.find((p) => p.id === s.planSel) ?? s.plans[0];
  if (!plan) return <span className="muted">{t('loading')}</span>;
  const shown = (s.previewRoute ?? plan.active_route) as Plan['active_route'];
  const route = plan.pace.find((r) => r.k === shown);
  const isCmd = role === 'commander' || role === 'admin';
  const editable = plan.status !== 'closed' && plan.status !== 'running';
  const pick = (k: Plan['active_route'], name: string) => {
    if (editable && (role === 'planner' || isCmd)) setActiveRoute(plan.id, k, name);
    else s.set({ previewRoute: k });
  };
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}><span className="caption mono ltr" style={{ textAlign: 'start' }}>{plan.id}</span><span style={{ fontSize: 17, fontWeight: 500 }}>{plan.title}</span></div>
        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: bgc(STATUS_HUE[plan.status]), color: fg(STATUS_HUE[plan.status]) }}>{t(`pl.status.${plan.status}`)}</span>
      </div>
      <span className="caption">{t('pl.paceHint')}</span>
      {plan.pace.map((r) => {
        const on = r.k === shown;
        return (
          <button key={r.k} onClick={() => pick(r.k, r.name)} style={{ textAlign: 'start', padding: 10, borderRadius: 10, background: 'var(--color-bg)', boxShadow: on ? 'inset 0 0 0 1px var(--color-accent)' : 'none', display: 'grid', gridTemplateColumns: '30px 1fr auto', gap: 10, alignItems: 'center' }}>
            <span style={{ width: 28, height: 28, borderRadius: 7, display: 'grid', placeItems: 'center', fontWeight: 600, background: on ? 'var(--color-accent)' : 'var(--color-neutral-800)', color: on ? '#11131e' : 'var(--color-text)' }}>{r.k}</span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}><span style={{ fontWeight: 500 }}>{r.name}</span><span style={{ fontSize: 11, color: 'var(--color-neutral-400)' }}>{N(r.km.toFixed(1))} km · {t('pl.minutes', { m: N(r.minutes) })}</span></span>
            <span style={{ fontSize: 11, color: fg(RISK_HUE[r.risk_level]), whiteSpace: 'nowrap' }}>{t(`risk.${r.risk_level}`)} {N(r.risk.toFixed(2))}</span>
          </button>
        );
      })}
      {showApi && <span className="api-hint">PATCH /api/security/escort-plan/{plan.id}</span>}
      {route && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="caption">{t('pl.checkpoints', { k: route.k })}</span>
          {route.checkpoints.map((c) => (
            <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '48px 1fr auto', gap: 8, fontSize: 12.5, alignItems: 'center' }}>
              <span className="mono ltr" style={{ fontSize: 11, textAlign: 'start', color: 'var(--color-accent-300)' }}>{c.id}</span><span>{c.name}</span><span style={{ color: 'var(--color-neutral-400)' }}>+{t('pl.minutes', { m: N(c.eta_min) })}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="caption">{t('pl.resources')}</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{plan.resources.map((r) => <span key={r} style={{ padding: '4px 10px', borderRadius: 6, background: 'var(--color-bg)', fontSize: 12 }}>{r}</span>)}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="caption">{t('pl.validation')}</span>
        {plan.validation.map((v, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12.5, alignItems: 'flex-start' }}><i className={`ph ph-${v.ok ? 'check-circle' : 'warning-circle'}`} style={{ color: fg(v.ok ? 150 : 90), marginTop: 3 }} /><span>{N(v.text)}</span></div>
        ))}
      </div>
      {editable && (isCmd ? (
        <button className="btn-primary-fill" disabled={plan.status === 'approved'} onClick={() => approvePlan(plan.id)} style={{ padding: 10 }}>{plan.status === 'approved' ? t('pl.approved') : t('pl.approve')}</button>
      ) : role === 'planner' ? (
        <button className="btn-primary-fill" disabled={plan.status === 'pending_approval'} onClick={() => submitPlan(plan.id)} style={{ padding: 10 }}>{plan.status === 'pending_approval' ? t('pl.awaiting') : t('pl.submit')}</button>
      ) : null)}
      {showApi && editable && <span className="api-hint">POST /api/security/escort-plan/{plan.id}/{isCmd ? 'approve' : 'submit'}</span>}
    </>
  );
}
