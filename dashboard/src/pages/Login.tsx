import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../app/hooks';
import { errorText, loadConfig, login } from '../app/actions';
import { ApiError } from '../api/client';
import { LanguageSwitcher } from '../ui/Switchers';
import { usePrefs } from '../stores/prefs';
import { setTheme } from '../app/actions';

export function Login() {
  const { t } = useT();
  const navigate = useNavigate();
  const theme = usePrefs((s) => s.theme);
  const [username, setUsername] = useState('ahmadi');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { void loadConfig(); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try { await login(username.trim(), password); navigate('/', { replace: true }); }
    catch (err) { setError(err instanceof ApiError && err.status === 401 ? t('login.error') : errorText(err)); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', padding: 16, overflowY: 'auto',
      background: 'radial-gradient(1200px 600px at 20% -10%, color-mix(in srgb, var(--accent) 16%, transparent), transparent), radial-gradient(900px 500px at 110% 110%, color-mix(in srgb, var(--friendly) 12%, transparent), transparent), var(--bg)' }}>
      <div className="row" style={{ position: 'absolute', top: 14, insetInlineEnd: 14, gap: 8 }}>
        <LanguageSwitcher />
        <button className="btn btn-icon" aria-label={t('theme')} title={t('theme')} onClick={() => void setTheme(theme === 'dark' ? 'light' : 'dark')}><i className={`ph ph-${theme === 'dark' ? 'sun' : 'moon'}`} /></button>
      </div>
      <form onSubmit={submit} className="card" aria-labelledby="login-title" style={{ width: 400, maxWidth: '100%', gap: 14, padding: 26, boxShadow: 'var(--shadow-3)' }}>
        <div className="row" style={{ gap: 12 }}>
          <span style={{ width: 42, height: 42, borderRadius: 10, background: 'var(--accent)', color: 'var(--accent-ink)', display: 'grid', placeItems: 'center', fontSize: 22 }}><i className="ph ph-shield-chevron" /></span>
          <div className="col" style={{ gap: 0 }}><h1 id="login-title" style={{ fontSize: 19 }}>{t('brand')}</h1><span className="caption">{t('login.title')}</span></div>
        </div>
        <label className="field">{t('login.username')}<input className="input ltr" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required name="username" /></label>
        <label className="field">{t('login.password')}<input className="input ltr" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus name="password" /></label>
        {error && <span role="alert" style={{ color: 'var(--danger)', fontSize: 12.5 }}>{error}</span>}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? <i className="ph ph-spinner spin" /> : <i className="ph ph-sign-in" />}{t('login.submit')}</button>
        <span className="caption" style={{ lineHeight: 1.8 }}>{t('login.demo')}</span>
        <span className="chip chip-info" style={{ alignSelf: 'flex-start', whiteSpace: 'normal' }}><i className="ph ph-info" />{t('exercise.note')}</span>
      </form>
    </div>
  );
}
