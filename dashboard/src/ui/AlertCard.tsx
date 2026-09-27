import { useNavigate } from 'react-router-dom';
import type { Alert } from '../api/types';
import { SEV, fg, mmss, sol } from '../lib/format';
import { useNow, useT } from '../app/hooks';
import { acknowledge, escalate, resolve } from '../app/actions';
import { useOps } from '../stores/ops';
import { flyToUnit } from '../map/MapStage';
import { useSession } from '../stores/session';
import { can } from '../app/roles';

export function AlertCard({ alert: a, variant }: { alert: Alert; variant: 'float' | 'list' | 'log' }) {
  const { t, N } = useT();
  const now = useNow();
  const navigate = useNavigate();
  const role = useSession((x) => x.role);
  const mayAck = can(role, 'ack:alerts');
  const sev = SEV[a.level];
  const active = a.status === 'active', esc = a.status === 'escalated';
  const rem = Math.max(0, (a.deadline - now) / 1000);
  const tm = N(mmss(rem));
  const timer = active ? tm : esc ? 'ESC' : a.status === 'acknowledged' ? 'ACK ✓' : '✓';
  const timerFg = (active && rem < 30) || esc ? fg(25) : 'var(--color-neutral-400)';
  const pct = active ? Math.min(100, (rem / sev.ack) * 100) : 100;
  const locate = () => {
    if (!a.unit) return;
    useOps.getState().set({ sel: a.unit, liveTab: 'units', sheet: 'insp', sheetOpen: true });
    navigate('/live');
    flyToUnit(a.unit);
  };

  if (variant === 'log') {
    return (
      <div style={{ padding: '9px 10px', borderRadius: 8, background: 'var(--color-surface)', boxShadow: `inset 3px 0 0 ${sol(sev.h)}`, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span>{a.title}</span><span className="mono" style={{ fontSize: 11, color: timerFg, whiteSpace: 'nowrap' }}>{timer}</span>
      </div>
    );
  }

  const float = variant === 'float';
  return (
    <div role={float ? 'alert' : undefined} style={{
      borderRadius: float ? 10 : 8, padding: float ? '11px 12px' : 10, background: float ? 'var(--color-surface)' : 'var(--color-bg)',
      boxShadow: float ? `var(--shadow-md), inset 3px 0 0 ${sol(sev.h)}` : `inset 3px 0 0 ${sol(sev.h)}`,
      display: 'flex', flexDirection: 'column', gap: 5, opacity: a.status === 'resolved' ? 0.5 : 1,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, gap: 8 }}>
        <span style={{ color: fg(sev.h) }}>{t(`level.${a.level}`)} · {float ? t('alert.level', { n: N(sev.lvl) }) : t(`status.${a.status}`)}</span>
        <span className={float && !active ? undefined : 'mono'} style={{ color: timerFg }}>{float ? (active ? t('alert.deadline', { t: tm }) : t('alert.escalated')) : timer}</span>
      </div>
      {float && <div style={{ height: 3, borderRadius: 2, background: 'var(--color-neutral-800)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${pct}%`, background: sol(sev.h), transition: 'width 1s linear' }} /></div>}
      <div style={{ fontWeight: 500 }}>{a.title}</div>
      <div style={{ fontSize: 11.5, color: 'var(--color-neutral-400)' }}>{a.src}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: float ? 2 : 0 }}>
        {mayAck && (active || esc) && <button className="btn-accent-outline" onClick={() => acknowledge(a)}>ACK</button>}
        {mayAck && !float && a.status === 'acknowledged' && <button className="btn-outline" onClick={() => resolve(a)}>{t('resolve')}</button>}
        {mayAck && float && (active || a.status === 'acknowledged') && <button className="btn-outline" onClick={() => escalate(a)}>{t('escalate')}</button>}
        {a.unit && <button onClick={locate} style={{ padding: '4px 8px', borderRadius: 6, color: 'var(--color-neutral-300)' }}><i className="ph ph-crosshair-simple" /> {t('locate')}</button>}
      </div>
    </div>
  );
}
