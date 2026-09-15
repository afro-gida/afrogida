import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth-context';
import { ApiError } from '../lib/api';

export default function Login() {
  const { login, verifyCode } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const challenge = await login(username.trim(), password);
      if (challenge) {
        setChallengeId(challenge.challenge_id);
        setInfoMessage(challenge.message);
      } else {
        navigate('/', { replace: true });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Giriş sırasında bir hata oluştu');
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    if (!challengeId) return;
    setError('');
    setBusy(true);
    try {
      await verifyCode(challengeId, code.trim());
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Doğrulama sırasında bir hata oluştu');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div className="card" style={{ width: '100%', maxWidth: 380 }}>
        <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>Yönetici Paneli</h1>
        <p style={{ color: 'var(--text-muted)', margin: '0 0 24px', fontSize: 14 }}>
          {challengeId ? 'SMS ile gelen doğrulama kodunu girin' : 'Kullanıcı adınız ve şifrenizle giriş yapın'}
        </p>

        {!challengeId ? (
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="field">
              <label htmlFor="username">Kullanıcı Adı</label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div className="field">
              <label htmlFor="password">Şifre</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && <div className="error-text">{error}</div>}
            <button className="btn" type="submit" disabled={busy}>
              {busy ? 'Giriş yapılıyor…' : 'Giriş Yap'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerify} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{infoMessage}</p>
            <div className="field">
              <label htmlFor="code">Doğrulama Kodu</label>
              <input
                id="code"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="6 haneli kod"
                autoFocus
                required
              />
            </div>
            {error && <div className="error-text">{error}</div>}
            <button className="btn" type="submit" disabled={busy}>
              {busy ? 'Doğrulanıyor…' : 'Doğrula ve Giriş Yap'}
            </button>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => {
                setChallengeId(null);
                setCode('');
                setError('');
              }}
            >
              Geri dön
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
