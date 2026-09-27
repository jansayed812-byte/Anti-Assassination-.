import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../app/hooks';
import { useOps } from '../stores/ops';
import { login } from '../app/actions';

export function Login() {
  const { t, lang } = useT();
  const navigate = useNavigate();
  const setLang = useOps((s) => s.set);
  const [username, setUsername] = useState('maryam');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { document.documentElement.lang = lang; document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr'; }, [lang]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try { await login(username.trim(), password); navigate('/', { replace: true }); }
    catch (err) { setError(err instanceof Error ? err.message : t('login.error')); }
    finally { setBusy(false); }
  };

  return (
    <div dir={lang === 'fa' ? 'rtl' : 'ltr'} style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: 'var(--color-bg)', color: 'var(--color-text)', fontFamily: 'Inter, Vazirmatn, system-ui, sans-serif', fontSize: 13, padding: 16 }}>
      <form onSubmit={submit} style={{ width: 360, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 14, padding: 24, borderRadius: 14, background: 'var(--color-surface)', boxShadow: 'var(--shadow-md)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 34, height: 34, borderRadius: 8, boxShadow: 'inset 0 0 0 1px var(--color-accent)', display: 'grid', placeItems: 'center', color: 'var(--color-accent)', fontSize: 18 }}><i className="ph ph-shield-chevron" /></span>
          <div style={{ display: 'flex', flexDirection: 'column' }}><span style={{ fontWeight: 500, fontSize: 16 }}>{t('brand')}</span><span className="caption">{t('login.title')}</span></div>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn-outline" onClick={() => setLang({ lang: lang === 'fa' ? 'en' : 'fa' })}>{lang === 'fa' ? 'EN' : 'فا'}</button>
        </div>
        <label className="field-label">{t('login.username')}<input className="field-input ltr" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required /></label>
        <label className="field-label">{t('login.password')}<input className="field-input ltr" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus /></label>
        {error && <span role="alert" style={{ color: 'oklch(0.82 0.12 25)', fontSize: 12 }}>{error}</span>}
        <button type="submit" className="btn-primary-fill" disabled={busy}>{busy ? <i className="ph ph-spinner spin" /> : <i className="ph ph-sign-in" />}{t('login.submit')}</button>
        <span style={{ fontSize: 11.5, color: 'var(--color-neutral-400)', lineHeight: 1.7 }}>{t('login.demo')}</span>
      </form>
    </div>
  );
}
