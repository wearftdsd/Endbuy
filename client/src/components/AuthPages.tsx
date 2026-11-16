import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Check, Copy, Download, Eye, EyeOff, Gem, ImagePlus, KeyRound, ShieldCheck, Sparkles, Upload } from 'lucide-react';
import { ApiError, errorMessage, post, upload } from '../lib/api';
import { getLocale, setLocale, t } from '../lib/i18n';
import { startSession } from '../lib/session';
import type { SelfUser } from '../lib/types';
import { AVATAR_PRESETS, ErrorBox, Field, LogoMark, PresetAvatar, Spinner, Wordmark } from './ui';

function AuthLayout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const [, force] = useState(0);
  return (
    <div className="h-full overflow-y-auto scroll-thin relative" style={{ background: 'radial-gradient(1200px 600px at 10% -10%, #00c2a833, transparent), radial-gradient(900px 600px at 110% 110%, #0b8bf533, transparent), var(--bg-0)' }}>
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
        <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full brand-gradient opacity-25 blur-3xl" data-parallax="60" />
        <div className="absolute top-1/3 right-1/4 w-64 h-64 rounded-full bg-[#8b5cf6] opacity-15 blur-3xl" data-parallax="-40" />
        <div className="absolute bottom-0 right-0 w-[28rem] h-[28rem] rounded-full nitro-gradient opacity-10 blur-3xl" data-parallax="45" />
      </div>
      <div className="relative min-h-full flex flex-col items-center justify-center px-4 py-10">
        <div className="flex items-center gap-3 mb-6">
          <LogoMark size={44} />
          <Wordmark className="text-3xl" />
        </div>
        <div data-tilt="3" className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} bg-bg-2/95 backdrop-blur rounded-2xl border border-line p-6 sm:p-8 anim-up`} style={{ boxShadow: 'var(--shadow)' }}>
          {children}
        </div>
        <button
          className="mt-6 text-xs text-fg-3 hover:text-fg"
          onClick={() => {
            setLocale(getLocale() === 'fr' ? 'en' : 'fr');
            force((x) => x + 1);
          }}
        >
          {getLocale() === 'fr' ? 'English' : 'Français'}
        </button>
      </div>
    </div>
  );
}

function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={show ? 'text' : 'password'} className="input pr-10" />
      <button type="button" tabIndex={-1} className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-3 hover:text-fg p-1" onClick={() => setShow(!show)} aria-label={t('Afficher le mot de passe')}>
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}

function useNext() {
  const loc = useLocation();
  const next = new URLSearchParams(loc.search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/channels/@me';
}

/* ------------------------------------------------------------------ */
/* Connexion                                                           */
/* ------------------------------------------------------------------ */
export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const next = useNext();
  const loc = useLocation();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await post<{ user: SelfUser }>('/auth/login', { username, password, code: needCode ? code : undefined });
      startSession(user);
      navigate(next, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'MFA_REQUIRED') {
        setNeedCode(true);
        setError(null);
      } else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <h1 className="text-2xl font-bold text-center">{t('Content de te revoir !')}</h1>
      <p className="text-fg-2 text-center mt-1 mb-6">{t('Connecte-toi avec ton pseudonyme.')}</p>
      <ErrorBox message={error} />
      <form onSubmit={submit}>
        {!needCode ? (
          <>
            <Field label={t('Pseudonyme')}>
              <input className="input" autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required maxLength={64} />
            </Field>
            <Field label={t('Mot de passe')}>
              <PasswordInput autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required maxLength={256} />
            </Field>
            <Link to="/recover" className="text-sm text-accent-2 hover:underline">
              {t('Mot de passe oublié ?')}
            </Link>
          </>
        ) : (
          <div className="anim-fade">
            <div className="flex items-center gap-3 rounded-xl bg-bg-3 p-3 mb-4">
              <ShieldCheck className="text-accent shrink-0" />
              <p className="text-sm text-fg-2">{t('La double authentification est activée. Saisis le code à 6 chiffres de ton application, ou un code de récupération.')}</p>
            </div>
            <Field label={t('Code de vérification')}>
              <input className="input tracking-widest text-center text-lg" autoFocus inputMode="text" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} maxLength={16} required />
            </Field>
          </div>
        )}
        <button className="btn btn-primary w-full mt-5 py-3" disabled={busy}>
          {busy ? <Spinner /> : needCode ? t('Vérifier') : t('Se connecter')}
        </button>
      </form>
      <p className="text-sm text-fg-3 mt-5 text-center">
        {t('Pas encore de compte ?')}{' '}
        <Link to={`/register${loc.search}`} className="text-accent-2 hover:underline">
          {t("S'inscrire")}
        </Link>
      </p>
    </AuthLayout>
  );
}

/* ------------------------------------------------------------------ */
/* Inscription                                                         */
/* ------------------------------------------------------------------ */
export function RecoveryCodesBlock({ codes, username }: { codes: string[]; username?: string }) {
  const [copied, setCopied] = useState(false);
  const text = codes.join('\n');
  const download = () => {
    const blob = new Blob([`endBuy — ${t('codes de récupération')}${username ? ` (${username})` : ''}\n\n${text}\n\n${t('Chaque code ne fonctionne qu’une seule fois.')}\n`], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'endbuy-codes-recuperation.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 font-mono text-sm bg-bg-0 rounded-xl p-4 border border-line select-all">
        {codes.map((c) => (
          <div key={c} className="text-center py-1 tracking-wider">
            {c}
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-3">
        <button
          type="button"
          className="btn btn-secondary flex-1"
          onClick={() => {
            navigator.clipboard?.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? t('Copié !') : t('Copier')}
        </button>
        <button type="button" className="btn btn-secondary flex-1" onClick={download}>
          <Download size={16} /> {t('Télécharger')}
        </button>
      </div>
    </div>
  );
}

export function RegisterPage() {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [preset, setPreset] = useState(() => Math.floor(Math.random() * AVATAR_PRESETS.length));
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ user: SelfUser; codes: string[] } | null>(null);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const next = useNext();
  const loc = useLocation();

  const usernameValid = /^[a-zA-Z0-9_.]{2,32}$/.test(username);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!usernameValid) return setError(t('Le pseudonyme doit faire 2 à 32 caractères (lettres, chiffres, « _ » et « . »).'));
    if (password.length < 8) return setError(t('Le mot de passe doit contenir au moins 8 caractères.'));
    if (password !== confirm) return setError(t('Les mots de passe ne correspondent pas.'));
    setBusy(true);
    try {
      const res = await post<{ user: SelfUser; recoveryCodes: string[] }>('/auth/register', {
        username,
        password,
        displayName: displayName || undefined,
        avatarPreset: preset,
      });
      let user = res.user;
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        try {
          user = (await upload<{ user: SelfUser }>('/users/@me/avatar', fd)).user;
        } catch {
          /* l'avatar pourra être changé plus tard */
        }
      }
      setDone({ user, codes: res.recoveryCodes });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthLayout wide>
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full nitro-gradient text-white px-4 py-1.5 text-sm font-bold mb-4">
            <Sparkles size={16} /> {t('endBuy Nitro Lifetime activé')}
          </div>
          <h1 className="text-2xl font-bold">{t('Bienvenue sur endBuy, {name} !', { name: done.user.displayName })}</h1>
          <p className="text-fg-2 mt-2">
            {t('Ton identifiant unique :')} <span className="font-mono text-fg">{done.user.id}</span>
          </p>
        </div>
        <div className="mt-6 rounded-xl border border-warn/40 bg-warn/10 p-4">
          <div className="flex items-center gap-2 font-semibold text-warn mb-1">
            <KeyRound size={18} /> {t('Tes codes de récupération')}
          </div>
          <p className="text-sm text-fg-2 mb-3">
            {t("Sans e-mail ni téléphone, ces codes sont le SEUL moyen de récupérer ton compte si tu oublies ton mot de passe. Garde-les en lieu sûr : ils ne seront plus affichés.")}
          </p>
          <RecoveryCodesBlock codes={done.codes} username={done.user.username} />
        </div>
        <label className="flex items-center gap-3 mt-5 cursor-pointer select-none">
          <input type="checkbox" className="w-5 h-5 accent-[var(--accent)]" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          <span className="text-sm">{t("J'ai sauvegardé mes codes de récupération")}</span>
        </label>
        <button
          className="btn btn-primary w-full mt-5 py-3"
          disabled={!saved}
          onClick={() => {
            startSession(done.user);
            navigate(next, { replace: true });
          }}
        >
          {t('Entrer dans endBuy')}
        </button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout wide>
      <h1 className="text-2xl font-bold text-center">{t('Créer un compte')}</h1>
      <p className="text-fg-2 text-center mt-1 mb-2">{t('Aucune adresse e-mail. Aucun numéro de téléphone. Juste un pseudo.')}</p>
      <div className="flex justify-center mb-6">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1 bg-bg-3 text-fg-2">
          <Gem size={14} className="text-[#ff7a5c]" /> {t('endBuy Nitro Lifetime offert à vie à chaque inscription')}
        </span>
      </div>
      <ErrorBox message={error} />
      <form onSubmit={submit} className="grid sm:grid-cols-[1fr_auto] gap-x-8">
        <div>
          <Field
            label={t('Pseudonyme')}
            hint={t('Unique. Lettres, chiffres, « _ » et « . » uniquement.')}
            error={username && !usernameValid ? t('Pseudonyme invalide.') : null}
          >
            <input className="input" autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))} maxLength={32} required />
          </Field>
          <Field label={t("Nom d'affichage (facultatif)")}>
            <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={32} placeholder={username} />
          </Field>
          <Field label={t('Mot de passe')} hint={t('8 caractères minimum. Une phrase de passe est idéale.')}>
            <PasswordInput autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} maxLength={128} required />
          </Field>
          <Field label={t('Confirmer le mot de passe')} error={confirm && confirm !== password ? t('Les mots de passe ne correspondent pas.') : null}>
            <PasswordInput autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} maxLength={128} required />
          </Field>
        </div>
        <div className="sm:w-56">
          <span className="label">{t('Avatar')}</span>
          <div className="flex flex-col items-center">
            <div className="w-24 h-24 rounded-full overflow-hidden mb-3 ring-4 ring-bg-3">
              {preview ? <img src={preview} className="w-full h-full object-cover" alt="" /> : <PresetAvatar preset={preset} letter={(displayName || username || 'e')[0]} size={96} />}
            </div>
            <div className="grid grid-cols-6 gap-1.5 mb-3">
              {AVATAR_PRESETS.map(([a, b], i) => (
                <button
                  type="button"
                  key={i}
                  className={`w-7 h-7 rounded-full transition-transform hover:scale-110 ${!file && preset === i ? 'ring-2 ring-offset-2 ring-offset-bg-2 ring-accent' : ''}`}
                  style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}
                  onClick={() => {
                    setPreset(i);
                    setFile(null);
                    setPreview(null);
                  }}
                  aria-label={t('Avatar {n}', { n: i + 1 })}
                />
              ))}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setFile(f);
                setPreview(URL.createObjectURL(f));
              }}
            />
            <button type="button" className="btn btn-secondary text-xs w-full" onClick={() => fileRef.current?.click()}>
              {file ? <ImagePlus size={14} /> : <Upload size={14} />} {t('Importer une image (GIF animé inclus)')}
            </button>
          </div>
        </div>
        <div className="sm:col-span-2">
          <button className="btn btn-primary w-full mt-4 py-3" disabled={busy}>
            {busy ? <Spinner /> : t('Créer mon compte')}
          </button>
          <p className="text-sm text-fg-3 mt-5 text-center">
            {t('Déjà un compte ?')}{' '}
            <Link to={`/login${loc.search}`} className="text-accent-2 hover:underline">
              {t('Se connecter')}
            </Link>
          </p>
        </div>
      </form>
    </AuthLayout>
  );
}

/* ------------------------------------------------------------------ */
/* Récupération                                                        */
/* ------------------------------------------------------------------ */
export function RecoverPage() {
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ user: SelfUser; remainingCodes: number } | null>(null);
  const navigate = useNavigate();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setResult(await post('/auth/recover', { username, recoveryCode: code, newPassword: password }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <AuthLayout>
        <div className="text-center">
          <ShieldCheck size={48} className="mx-auto text-success mb-3" />
          <h1 className="text-2xl font-bold">{t('Compte récupéré !')}</h1>
          <p className="text-fg-2 mt-2">{t('Ton mot de passe a été changé et toutes tes autres sessions ont été déconnectées.')}</p>
          <p className="text-sm mt-3">
            {t('Codes de récupération restants : {n}', { n: result.remainingCodes })}
            {result.remainingCodes <= 3 && <span className="block text-warn mt-1">{t('Pense à en générer de nouveaux dans Paramètres → Sécurité.')}</span>}
          </p>
          <button
            className="btn btn-primary w-full mt-6"
            onClick={() => {
              startSession(result.user);
              navigate('/channels/@me', { replace: true });
            }}
          >
            {t('Continuer')}
          </button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1 className="text-2xl font-bold text-center">{t('Récupérer mon compte')}</h1>
      <p className="text-fg-2 text-center mt-1 mb-6">{t('Utilise l’un des codes de récupération reçus lors de ton inscription.')}</p>
      <ErrorBox message={error} />
      <form onSubmit={submit}>
        <Field label={t('Pseudonyme')}>
          <input className="input" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} required maxLength={64} />
        </Field>
        <Field label={t('Code de récupération')} hint={t('Format : XXXXX-XXXXX')}>
          <input className="input font-mono tracking-wider uppercase" value={code} onChange={(e) => setCode(e.target.value)} required maxLength={16} />
        </Field>
        <Field label={t('Nouveau mot de passe')}>
          <PasswordInput autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} maxLength={128} required />
        </Field>
        <button className="btn btn-primary w-full mt-2 py-3" disabled={busy}>
          {busy ? <Spinner /> : t('Réinitialiser le mot de passe')}
        </button>
      </form>
      <p className="text-sm text-center mt-5">
        <Link to="/login" className="text-accent-2 hover:underline">
          {t('Retour à la connexion')}
        </Link>
      </p>
    </AuthLayout>
  );
}
