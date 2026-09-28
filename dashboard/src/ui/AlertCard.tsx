import { useNavigate } from 'react-router-dom';
import type { Alert } from '../api/types';
import { SEV } from '../lib/palette';
import { useNow, useT } from '../app/hooks';
import { acknowledge, escalate, resolve } from '../app/actions';
import { useOps } from '../stores/ops';
import { useSession } from '../stores/session';
import { can } from '../app/roles';
import { mmss } from '../i18n';

export function AlertCard({ alert: a, variant }: { alert: Alert; variant: 'float' | 'list' | 'log' }) {
  const { t, x, N, lang, clock } = useT();
  const now = useNow();
  const navigate = useNavigate();
  const role = useSession((s) => s.role);
  const mayAck = can(role, 'ack:alerts');
  const sev = SEV[a.level];
  const active = a.status === 'active', esc = a.status === 'escalated';
  const rem = Math.max(0, (a.deadline - now) / 1000);
  const tm = mmss(lang, rem);
  const timer = active ? tm : esc ? t('status.escalated') : t(`status.${a.status}`);
  const urgent = (active && rem < 30) || esc;
  const pct = active ? Math.min(100, (rem / sev.ack) * 100) : 100;
  const title = x(a.title);
  const locate = () => {
    if (!a.unit) return;
    const st = useOps.getState();
    st.set({ sel: a.unit, liveTab: 'units', sheet: 'insp', sheetOpen: true });
    const tl = st.units[a.unit]?.telemetry;
    if (tl) st.flyTo(tl, 16);
    navigate('/live');
  };

  if (variant === 'log') {
    return (
      <div className="card-2 edge" style={{ '--edge': sev.color, padding: '8px 10px', flexDirection: 'row', justifyContent: 'space-between' } as React.CSSProperties}>
        <span className="truncate">{title}</span><span className="mono" style={{ fontSize: 11, color: urgent ? 'var(--danger)' : 'var(--text-3)' }}>{timer}</span>
      </div>
    );
  }

  const float = variant === 'float';
  return (
    <article role={float ? 'alert' : undefined} data-testid={`alert-${a.id}`} className={float ? 'map-panel edge' : 'card-2 edge'}
      style={{ '--edge': sev.color, padding: float ? '11px 12px' : 10, display: 'flex', flexDirection: 'column', gap: 5, opacity: a.status === 'resolved' ? 0.55 : 1 } as React.CSSProperties}>
      <div className="row-between" style={{ fontSize: 11 }}>
        <span className="row" style={{ gap: 6 }}>
          <span className={`chip ${sev.chip}`}>{t(`level.${a.level}`)}</span>
          {!float && <span className="faint">{t(`status.${a.status}`)}</span>}
          {a.origin_branch && <span className="chip chip-info">{t('alert.synced', { branch: a.origin_branch })}</span>}
        </span>
        <span className={float && !active ? undefined : 'num'} style={{ color: urgent ? 'var(--danger)' : 'var(--text-3)' }}>{float ? (active ? t('alert.deadline', { t: tm }) : t('alert.escalatedTo')) : active ? tm : clock(a.created_at)}</span>
      </div>
      {float && <div className="bar" style={{ height: 3 }}><span style={{ width: `${pct}%`, background: sev.color, transition: 'width 1s linear' }} /></div>}
      <div style={{ fontWeight: 600 }}>{title}</div>
      {x(a.src) && <div className="muted" style={{ fontSize: 12 }}>{N(x(a.src))}</div>}
      <div className="row wrap" style={{ gap: 6, marginTop: 2 }}>
        {mayAck && (active || esc) && <button className="btn btn-outline btn-sm" onClick={() => acknowledge(a)}>{t('ack')}</button>}
        {mayAck && !float && a.status === 'acknowledged' && <button className="btn btn-sm" onClick={() => resolve(a)}>{t('resolve')}</button>}
        {mayAck && float && (active || a.status === 'acknowledged') && <button className="btn btn-sm" onClick={() => escalate(a)}>{t('escalate')}</button>}
        {a.unit && <button className="btn btn-ghost btn-sm" onClick={locate}><i className="ph ph-crosshair-simple" />{t('locate')}</button>}
      </div>
    </article>
  );
}
