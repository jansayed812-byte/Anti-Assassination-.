import { useOps } from '../stores/ops';
import { usePrefs } from '../stores/prefs';
import { useSession } from '../stores/session';
import { useT } from '../app/hooks';
import { setLanguage, switchBranch } from '../app/actions';
import { LANGS, LANG_META, pick } from '../i18n';

/** Dari · Pashto · English — available on every page; switches in place and is saved for the user. */
export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { t } = useT();
  const lang = usePrefs((s) => s.lang);
  return (
    <div className="seg" role="group" aria-label={t('language')} data-testid="lang-switcher">
      {LANGS.map((l) => (
        <button key={l} lang={LANG_META[l].html} aria-pressed={lang === l} onClick={() => void setLanguage(l)} title={LANG_META[l].label}
          style={{ fontFamily: l === 'en' ? 'Inter, sans-serif' : 'var(--font-rtl)', paddingInline: compact ? 7 : 10 }}>
          {compact ? LANG_META[l].short : LANG_META[l].label}
        </button>
      ))}
    </div>
  );
}

/** Active branch with a menu of readable branches (switching issues a token for that branch). */
export function BranchSwitcher({ compact = false }: { compact?: boolean }) {
  const { t, x, N } = useT();
  const s = useOps();
  const active = useSession((st) => st.branch);
  const role = useSession((st) => st.role);
  const cur = s.config?.branches.find((b) => b.id === active);
  const summary = s.branches;
  if (!cur) return null;
  return (
    <div style={{ position: 'relative', flex: 'none' }}>
      <button className="btn" aria-haspopup="menu" aria-expanded={s.branchOpen} onClick={() => s.set({ branchOpen: !s.branchOpen })} data-testid="branch-switcher" title={t('branch.switch')}>
        <i className="ph ph-buildings" />
        {!compact && <span className="truncate" style={{ maxWidth: 150 }}>{x(cur.city)}</span>}
        {compact && <span className="chip" style={{ padding: '0 6px' }}>{cur.id}</span>}
        {role === 'viewer' && <span className="chip chip-warning" style={{ padding: '0 6px' }}>{t('branch.readonly')}</span>}
        <i className="ph ph-caret-down" style={{ fontSize: 12 }} />
      </button>
      {s.branchOpen && (
        <>
          <div onClick={s.closeOverlays} style={{ position: 'fixed', inset: 0, zIndex: 30 }} />
          <div role="menu" className="popover" style={{ top: 42, insetInlineStart: 0, width: 300, zIndex: 31 }}>
            <div className="eyebrow" style={{ padding: '4px 10px' }}>{t('branch.switch')}</div>
            {summary.map((b) => (
              <button key={b.id} role="menuitem" className="menu-item" aria-current={b.id === active} disabled={b.id === active}
                onClick={() => { s.set({ branchOpen: false }); void switchBranch(b.id); }} style={{ opacity: 1, background: b.id === active ? 'var(--accent-soft)' : undefined }}>
                <span className="col" style={{ gap: 0 }}>
                  <span className="row" style={{ gap: 6 }}><b>{x(b.name)}</b>{b.hq && <span className="chip chip-accent" style={{ padding: '0 6px' }}>{t('branch.hq')}</span>}</span>
                  <span className="caption">{b.role ? t(`role.${b.role}`) : t('branch.readonly')} · {x(b.province)}</span>
                </span>
                <span className="row" style={{ gap: 6 }}>
                  {b.open_alerts > 0 && <span className="chip chip-danger">{N(b.open_alerts)}</span>}
                  <span className="chip">{b.id}</span>
                </span>
              </button>
            ))}
            <div className="caption" style={{ padding: '6px 10px' }}>{pick(cur.name, usePrefs.getState().lang)}</div>
          </div>
        </>
      )}
    </div>
  );
}
