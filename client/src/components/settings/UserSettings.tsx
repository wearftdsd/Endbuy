import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { useShallow } from 'zustand/react/shallow';
import { Check, Copy, Gem, KeyRound, Laptop, Lock, LogOut, Monitor, ShieldCheck, Smartphone, Sparkles, Upload } from 'lucide-react';
import { del, errorMessage, get, patch, post, upload } from '../../lib/api';
import { desktop } from '../../lib/desktop';
import { formatDateTime, formatLongDate, formatSize } from '../../lib/format';
import { t } from '../../lib/i18n';
import { loadAV, saveAV, voice, type AVSettings } from '../../lib/rtc';
import { logout, updateSettings } from '../../lib/session';
import { closeModal, confirmDialog, openModal, setState, toast, useStore } from '../../lib/store';
import type { SelfUser } from '../../lib/types';
import { Avatar, ErrorBox, Field, NitroBadge, Spinner, Switch } from '../ui';
import { Row, SaveBar, SectionTitle, SettingsLayout } from './SettingsLayout';

function setMe(user: SelfUser) {
  setState((s) => {
    s.me = user;
    s.users[user.id] = user;
  });
}

/* ------------------------------ Mon compte ------------------------------ */
function MyAccount({ go }: { go: (k: string) => void }) {
  const me = useStore((s) => s.me!);
  const [edit, setEdit] = useState<null | 'username' | 'displayName'>(null);
  const [value, setValue] = useState('');
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwError, setPwError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saveField = async () => {
    try {
      const { user } = await patch<{ user: SelfUser }>('/users/@me', { [edit!]: value });
      setMe(user);
      setEdit(null);
      toast(t('Modifications enregistrées.'), 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  const changePassword = async () => {
    setPwError(null);
    if (pw.next !== pw.confirm) return setPwError(t('Les mots de passe ne correspondent pas.'));
    setBusy(true);
    try {
      const r = await post<{ revokedSessions: number }>('/auth/password', { password: pw.current, newPassword: pw.next });
      setPw({ current: '', next: '', confirm: '' });
      toast(t('Mot de passe modifié. {n} autre(s) session(s) déconnectée(s).', { n: r.revokedSessions }), 'success');
    } catch (e) {
      setPwError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const field = (key: 'displayName' | 'username', label: string, val: string) => (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-bold uppercase text-fg-3">{label}</div>
        {edit === key ? (
          <div className="flex gap-2 mt-1">
            <input className="input !py-1.5" autoFocus value={value} maxLength={32} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveField()} />
            <button className="btn btn-primary !py-1.5" onClick={saveField}>
              {t('Enregistrer')}
            </button>
            <button className="btn btn-ghost !py-1.5" onClick={() => setEdit(null)}>
              {t('Annuler')}
            </button>
          </div>
        ) : (
          <div className="truncate">{val}</div>
        )}
      </div>
      {edit !== key && (
        <button className="btn btn-secondary !py-1.5" onClick={() => (setEdit(key), setValue(val))}>
          {t('Modifier')}
        </button>
      )}
    </div>
  );
  return (
    <>
      <SectionTitle>{t('Mon compte')}</SectionTitle>
      <div className="rounded-xl overflow-hidden bg-bg-0 border border-line mb-8">
        <div className="h-24" style={{ background: me.banner ? `url(${me.banner}) center/cover` : me.bannerColor ?? 'var(--accent)' }} />
        <div className="px-4 pb-4">
          <div className="flex items-end gap-4 -mt-10">
            <div className="rounded-full p-1.5 bg-bg-0">
              <Avatar user={me} size={80} showStatus ring="var(--bg-0)" />
            </div>
            <div className="pb-2 flex-1 min-w-0">
              <div className="text-xl font-bold flex items-center gap-2 truncate">
                {me.displayName} {me.premium && <NitroBadge size={14} />}
              </div>
            </div>
            <button className="btn btn-primary mb-2" onClick={() => go('profile')}>
              {t('Modifier le profil')}
            </button>
          </div>
          <div className="rounded-lg bg-bg-2 px-4 mt-4 divide-y divide-line">
            {field('displayName', t("Nom d'affichage"), me.displayName)}
            {field('username', t('Pseudonyme'), me.username)}
            <div className="flex items-center justify-between gap-4 py-3">
              <div>
                <div className="text-xs font-bold uppercase text-fg-3">{t('Identifiant unique')}</div>
                <div className="font-mono">{me.id}</div>
              </div>
              <button className="btn btn-secondary !py-1.5" onClick={() => navigator.clipboard?.writeText(me.id).then(() => toast(t('Identifiant copié.'), 'success'))}>
                <Copy size={14} /> {t('Copier')}
              </button>
            </div>
            <div className="py-3 text-sm text-fg-3">{t('Aucune adresse e-mail ni numéro de téléphone n’est associé à ton compte : endBuy n’en a pas besoin.')}</div>
          </div>
        </div>
      </div>

      <h3 className="text-lg font-bold mb-3">{t('Mot de passe')}</h3>
      <ErrorBox message={pwError} />
      <div className="grid sm:grid-cols-3 gap-3">
        <input className="input" type="password" autoComplete="current-password" placeholder={t('Mot de passe actuel')} value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
        <input className="input" type="password" autoComplete="new-password" placeholder={t('Nouveau mot de passe')} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
        <input className="input" type="password" autoComplete="new-password" placeholder={t('Confirmer')} value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
      </div>
      <button className="btn btn-primary mt-3" disabled={!pw.current || pw.next.length < 8 || busy} onClick={changePassword}>
        {busy ? <Spinner /> : t('Changer le mot de passe')}
      </button>

      <div className="h-px bg-line my-8" />
      <h3 className="text-lg font-bold mb-1">{t('Suppression du compte')}</h3>
      <p className="text-sm text-fg-3 mb-3">{t('Supprime définitivement ton compte. Tes messages resteront visibles sous « Utilisateur supprimé ».')}</p>
      <button
        className="btn btn-danger"
        onClick={() =>
          confirmDialog({
            title: t('Supprimer mon compte'),
            body: me.totpEnabled ? t('Saisis ton mot de passe. Un code de double authentification te sera demandé ensuite.') : t('Saisis ton mot de passe pour confirmer. Cette action est irréversible.'),
            input: { label: t('Mot de passe') },
            confirmLabel: t('Supprimer le compte'),
            danger: true,
            onConfirm: async (password) => {
              let code: string | undefined;
              if (me.totpEnabled) code = window.prompt(t('Code de double authentification (ou code de récupération)')) ?? undefined;
              await post('/auth/delete-account', { password, code });
              closeModal();
              await logout();
            },
          })
        }
      >
        {t('Supprimer le compte')}
      </button>
    </>
  );
}

/* ------------------------------ Profil ------------------------------ */
const PROFILE_THEMES: [string, string][] = [
  ['#0f3d3a', '#1b1446'],
  ['#4a1d12', '#2a1240'],
  ['#062b4a', '#0a1f3d'],
  ['#3d1a4a', '#4a1a35'],
  ['#1d3a12', '#0e2a2a'],
  ['#3a2d0a', '#4a1212'],
];

function Profile() {
  const me = useStore((s) => s.me!);
  const [draft, setDraft] = useState({
    displayName: me.displayName,
    bio: me.bio,
    pronouns: me.pronouns,
    bannerColor: me.bannerColor ?? '',
    accentColor: me.accentColor ?? '',
    profileTheme: me.profileTheme,
  });
  const [busy, setBusy] = useState(false);
  const avatarRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);
  const initial = useMemo(
    () => JSON.stringify({ displayName: me.displayName, bio: me.bio, pronouns: me.pronouns, bannerColor: me.bannerColor ?? '', accentColor: me.accentColor ?? '', profileTheme: me.profileTheme }),
    [me],
  );
  const dirty = JSON.stringify(draft) !== initial;
  const save = async () => {
    setBusy(true);
    try {
      const { user } = await patch<{ user: SelfUser }>('/users/@me', {
        ...draft,
        bannerColor: draft.bannerColor || null,
        accentColor: draft.accentColor || null,
      });
      setMe(user);
      toast(t('Profil mis à jour.'), 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const uploadImg = async (kind: 'avatar' | 'banner', f: File | undefined) => {
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    try {
      const { user } = await upload<{ user: SelfUser }>(`/users/@me/${kind}`, fd);
      setMe(user);
      toast(kind === 'avatar' ? t('Avatar mis à jour.') : t('Bannière mise à jour.'), 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  const preview: SelfUser = { ...me, ...draft, bannerColor: draft.bannerColor || null, accentColor: draft.accentColor || null };
  return (
    <>
      <SectionTitle sub={t('Personnalise la façon dont les autres te voient sur endBuy.')}>{t('Profil')}</SectionTitle>
      <div className="flex flex-col xl:flex-row gap-8">
        <div className="flex-1 min-w-0">
          <Field label={t("Nom d'affichage")}>
            <input className="input" value={draft.displayName} maxLength={32} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} />
          </Field>
          <Field label={t('Pronoms')}>
            <input className="input" value={draft.pronouns} maxLength={40} placeholder={t('Ajoute tes pronoms')} onChange={(e) => setDraft({ ...draft, pronouns: e.target.value })} />
          </Field>
          <div className="mb-5">
            <span className="label flex items-center gap-1.5">
              {t('Avatar')} <Gem size={12} className="text-[#ff7a5c]" />
            </span>
            <div className="flex gap-2">
              <button className="btn btn-primary" onClick={() => avatarRef.current?.click()}>
                <Upload size={14} /> {t("Changer l'avatar")}
              </button>
              {me.avatar && (
                <button className="btn btn-ghost" onClick={() => del<{ user: SelfUser }>('/users/@me/avatar').then((r) => setMe(r.user))}>
                  {t('Supprimer')}
                </button>
              )}
            </div>
            <div className="text-xs text-fg-3 mt-1.5">{t('Nitro : GIF animés acceptés, jusqu’à {size}.', { size: formatSize(me.limits.maxAvatarBytes) })}</div>
            <input ref={avatarRef} type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => uploadImg('avatar', e.target.files?.[0])} />
          </div>
          <div className="mb-5">
            <span className="label flex items-center gap-1.5">
              {t('Bannière de profil')} <Gem size={12} className="text-[#ff7a5c]" />
            </span>
            <div className="flex gap-2 items-center">
              <button className="btn btn-primary" disabled={!me.limits.customBanner} onClick={() => bannerRef.current?.click()}>
                <Upload size={14} /> {t('Changer la bannière')}
              </button>
              {me.banner && (
                <button className="btn btn-ghost" onClick={() => del<{ user: SelfUser }>('/users/@me/banner').then((r) => setMe(r.user))}>
                  {t('Supprimer')}
                </button>
              )}
              <input type="color" className="w-10 h-10 rounded-md bg-transparent cursor-pointer" title={t('Couleur de bannière')} value={draft.bannerColor || '#00C2A8'} onChange={(e) => setDraft({ ...draft, bannerColor: e.target.value.toUpperCase() })} />
            </div>
            <input ref={bannerRef} type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => uploadImg('banner', e.target.files?.[0])} />
          </div>
          <div className="mb-5">
            <span className="label flex items-center gap-1.5">
              {t('Thème du profil')} <Gem size={12} className="text-[#ff7a5c]" />
            </span>
            <div className="flex flex-wrap gap-2 items-center">
              <button className={`w-12 h-12 rounded-lg border-2 bg-bg-0 ${!draft.profileTheme ? 'border-accent' : 'border-line'}`} onClick={() => setDraft({ ...draft, profileTheme: null })} title={t('Aucun')} />
              {PROFILE_THEMES.map(([a, b]) => (
                <button
                  key={a}
                  className={`w-12 h-12 rounded-lg border-2 ${draft.profileTheme?.primary === a ? 'border-accent' : 'border-transparent'}`}
                  style={{ background: `linear-gradient(180deg, ${a}, ${b})` }}
                  onClick={() => setDraft({ ...draft, profileTheme: { primary: a, secondary: b } })}
                />
              ))}
              <label className="flex items-center gap-1 text-xs text-fg-3 ml-2">
                <input type="color" className="w-8 h-8 bg-transparent" value={draft.profileTheme?.primary ?? '#1b1f25'} onChange={(e) => setDraft({ ...draft, profileTheme: { primary: e.target.value.toUpperCase(), secondary: draft.profileTheme?.secondary ?? '#0B0D10' } })} />
                <input type="color" className="w-8 h-8 bg-transparent" value={draft.profileTheme?.secondary ?? '#0b0d10'} onChange={(e) => setDraft({ ...draft, profileTheme: { primary: draft.profileTheme?.primary ?? '#1B1F25', secondary: e.target.value.toUpperCase() } })} />
                {t('Personnalisé')}
              </label>
            </div>
          </div>
          <Field label={t('À propos de moi')} hint={t('Tu peux utiliser le Markdown et des emojis. {n}/300', { n: draft.bio.length })}>
            <textarea className="input resize-none" rows={4} maxLength={300} value={draft.bio} onChange={(e) => setDraft({ ...draft, bio: e.target.value })} />
          </Field>
        </div>
        <div className="xl:w-[300px] shrink-0">
          <span className="label">{t('Aperçu')}</span>
          <div className="rounded-xl overflow-hidden border border-line" style={preview.profileTheme ? { background: `linear-gradient(180deg, ${preview.profileTheme.primary}, ${preview.profileTheme.secondary})` } : { background: 'var(--bg-0)' }}>
            <div className="h-24" style={{ background: me.banner ? `url(${me.banner}) center/cover` : preview.bannerColor ?? 'var(--accent)' }} />
            <div className="px-4 pb-4">
              <div className="-mt-10 w-fit rounded-full p-1.5" style={{ background: preview.profileTheme?.primary ?? 'var(--bg-0)' }}>
                <Avatar user={preview} size={80} />
              </div>
              <div className="rounded-lg bg-bg-0/80 p-3 mt-2">
                <div className="font-bold text-lg flex items-center gap-1.5">
                  {preview.displayName || me.username} <NitroBadge size={12} />
                </div>
                <div className="text-sm text-fg-2">
                  {me.username}
                  {preview.pronouns && ` · ${preview.pronouns}`}
                </div>
                {preview.bio && <div className="text-sm mt-2 whitespace-pre-wrap break-words">{preview.bio}</div>}
              </div>
            </div>
          </div>
        </div>
      </div>
      <SaveBar visible={dirty} busy={busy} onReset={() => setDraft(JSON.parse(initial))} onSave={save} />
    </>
  );
}

/* ------------------------------ Confidentialité ------------------------------ */
function Radio<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { v: T; label: string; desc?: string }[] }) {
  return (
    <div className="space-y-2">
      {options.map((o) => (
        <button key={o.v} className={`w-full flex items-start gap-3 p-3 rounded-lg text-left ${value === o.v ? 'bg-bg-4' : 'bg-bg-1 hover:bg-bg-3'}`} onClick={() => onChange(o.v)}>
          <span className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${value === o.v ? 'border-accent' : 'border-fg-3'}`}>{value === o.v && <span className="w-2.5 h-2.5 rounded-full bg-accent" />}</span>
          <span>
            <span className="block font-medium">{o.label}</span>
            {o.desc && <span className="block text-sm text-fg-3">{o.desc}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

function Privacy() {
  const settings = useStore((s) => s.me!.settings);
  const blocked = useStore(useShallow((s) => Object.values(s.relationships).filter((r) => r.type === 2)));
  const users = useStore((s) => s.users);
  return (
    <>
      <SectionTitle>{t('Confidentialité')}</SectionTitle>
      <h3 className="font-bold mb-2">{t('Qui peut m’envoyer des messages privés ?')}</h3>
      <Radio
        value={settings.dmPrivacy}
        onChange={(v) => updateSettings({ dmPrivacy: v })}
        options={[
          { v: 'everyone', label: t('Tout le monde'), desc: t('Toute personne connaissant ton pseudonyme ou partageant un serveur avec toi.') },
          { v: 'friends', label: t('Mes amis uniquement') },
          { v: 'none', label: t('Personne'), desc: t('Les conversations existantes restent accessibles.') },
        ]}
      />
      <h3 className="font-bold mt-8 mb-2">{t('Qui peut m’envoyer une demande d’ami ?')}</h3>
      <Radio
        value={settings.friendRequests}
        onChange={(v) => updateSettings({ friendRequests: v })}
        options={[
          { v: 'everyone', label: t('Tout le monde') },
          { v: 'mutual', label: t('Membres de mes serveurs') },
          { v: 'none', label: t('Personne') },
        ]}
      />
      <h3 className="font-bold mt-8 mb-2">{t('Utilisateurs bloqués')}</h3>
      {blocked.length === 0 && <p className="text-sm text-fg-3">{t('Tu n’as bloqué personne.')}</p>}
      {blocked.map((b) => (
        <div key={b.id} className="flex items-center gap-3 py-2 border-b border-line">
          <Avatar userId={b.id} size={32} />
          <span className="flex-1">{users[b.id]?.displayName}</span>
          <button className="btn btn-secondary !py-1 text-xs" onClick={() => del(`/users/@me/relationships/${b.id}`)}>
            {t('Débloquer')}
          </button>
        </div>
      ))}
      <div className="rounded-lg bg-bg-1 border border-line p-4 mt-8 text-sm text-fg-2">
        <div className="font-semibold text-fg mb-1 flex items-center gap-2">
          <Lock size={16} /> {t('Tes données')}
        </div>
        {t('endBuy ne demande ni e-mail ni téléphone. Les mots de passe sont hachés (scrypt) et les sessions sont stockées sous forme d’empreinte : personne, pas même l’administrateur du serveur, ne peut lire ton mot de passe.')}
      </div>
    </>
  );
}

/* ------------------------------ Sécurité ------------------------------ */
function Security() {
  const me = useStore((s) => s.me!);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [setup, setSetup] = useState<{ secret: string; uri: string; qr: string } | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    get<{ remaining: number }>('/auth/recovery-codes').then((r) => setRemaining(r.remaining));
  }, []);
  const startSetup = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await post<{ secret: string; uri: string }>('/auth/2fa/setup', { password });
      const qr = await QRCode.toDataURL(r.uri, { margin: 1, width: 200 });
      setSetup({ ...r, qr });
      setPassword('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const enable = async () => {
    setError(null);
    setBusy(true);
    try {
      const { user } = await post<{ user: SelfUser }>('/auth/2fa/enable', { code });
      setMe(user);
      setSetup(null);
      setCode('');
      toast(t('Double authentification activée !'), 'success');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const disable = async () => {
    setError(null);
    setBusy(true);
    try {
      const { user } = await post<{ user: SelfUser }>('/auth/2fa/disable', { password, code });
      setMe(user);
      setPassword('');
      setCode('');
      toast(t('Double authentification désactivée.'), 'success');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SectionTitle>{t('Sécurité')}</SectionTitle>
      <ErrorBox message={error} />
      <div className="rounded-xl border border-line p-5 mb-6">
        <div className="flex items-center gap-3 mb-2">
          <ShieldCheck className={me.totpEnabled ? 'text-success' : 'text-fg-3'} />
          <div className="font-bold flex-1">{t('Authentification à deux facteurs (facultative)')}</div>
          <span className={`text-xs font-bold rounded px-2 py-0.5 ${me.totpEnabled ? 'bg-success/20 text-success' : 'bg-bg-4 text-fg-3'}`}>{me.totpEnabled ? t('ACTIVÉE') : t('DÉSACTIVÉE')}</span>
        </div>
        <p className="text-sm text-fg-3 mb-4">{t('Protège ton compte avec une application d’authentification (Aegis, Google Authenticator, 2FAS, Authy…). Aucun numéro de téléphone requis.')}</p>
        {!me.totpEnabled && !setup && (
          <div className="flex gap-2">
            <input className="input" type="password" placeholder={t('Mot de passe actuel')} value={password} onChange={(e) => setPassword(e.target.value)} />
            <button className="btn btn-primary" disabled={!password || busy} onClick={startSetup}>
              {t('Activer')}
            </button>
          </div>
        )}
        {setup && (
          <div className="flex flex-col sm:flex-row gap-5 anim-fade">
            <img src={setup.qr} alt="QR code" className="w-44 h-44 rounded-lg bg-white p-1" />
            <div className="flex-1">
              <p className="text-sm mb-2">{t('1. Scanne ce QR code avec ton application, ou saisis la clé :')}</p>
              <div className="font-mono text-sm bg-bg-0 rounded px-2 py-1.5 break-all select-all mb-4">{setup.secret}</div>
              <p className="text-sm mb-2">{t('2. Saisis le code à 6 chiffres affiché :')}</p>
              <div className="flex gap-2">
                <input className="input tracking-widest" inputMode="numeric" maxLength={6} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && enable()} />
                <button className="btn btn-primary" disabled={code.length !== 6 || busy} onClick={enable}>
                  {t('Valider')}
                </button>
              </div>
            </div>
          </div>
        )}
        {me.totpEnabled && (
          <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-2">
            <input className="input" type="password" placeholder={t('Mot de passe')} value={password} onChange={(e) => setPassword(e.target.value)} />
            <input className="input" placeholder={t('Code 2FA ou de récupération')} value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="btn btn-danger" disabled={!password || !code || busy} onClick={disable}>
              {t('Désactiver')}
            </button>
          </div>
        )}
      </div>
      <div className="rounded-xl border border-line p-5">
        <div className="flex items-center gap-3 mb-2">
          <KeyRound className="text-warn" />
          <div className="font-bold flex-1">{t('Codes de récupération')}</div>
          {remaining !== null && <span className={`text-xs font-bold rounded px-2 py-0.5 ${remaining <= 3 ? 'bg-warn/20 text-warn' : 'bg-bg-4 text-fg-2'}`}>{t('{n} restant(s)', { n: remaining })}</span>}
        </div>
        <p className="text-sm text-fg-3 mb-4">{t('Ces codes à usage unique te permettent de récupérer ton compte (nouveau mot de passe) ou de te connecter sans ton application 2FA. Générer de nouveaux codes invalide les anciens.')}</p>
        <button
          className="btn btn-secondary"
          onClick={() =>
            confirmDialog({
              title: t('Générer de nouveaux codes'),
              body: t('Saisis ton mot de passe. Les anciens codes cesseront de fonctionner.'),
              input: { label: t('Mot de passe') },
              confirmLabel: t('Générer'),
              onConfirm: async (pw) => {
                const r = await post<{ recoveryCodes: string[] }>('/auth/recovery-codes', { password: pw });
                setRemaining(r.recoveryCodes.length);
                setTimeout(() => openModal({ type: 'recoveryCodes', codes: r.recoveryCodes }), 50);
              },
            })
          }
        >
          {t('Générer de nouveaux codes')}
        </button>
      </div>
    </>
  );
}

/* ------------------------------ Appareils & sessions ------------------------------ */
interface SessionInfo {
  id: string;
  device: string;
  ip: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}
function Sessions() {
  const [list, setList] = useState<SessionInfo[] | null>(null);
  const load = () => get<SessionInfo[]>('/auth/sessions').then(setList);
  useEffect(() => {
    load();
  }, []);
  const icon = (d: string) => (/Android|iOS/.test(d) ? <Smartphone /> : /Desktop/.test(d) ? <Monitor /> : <Laptop />);
  return (
    <>
      <SectionTitle sub={t('Voici tous les appareils actuellement connectés à ton compte. Déconnecte ceux que tu ne reconnais pas.')}>{t('Appareils')}</SectionTitle>
      {!list && <Spinner />}
      {list?.map((s) => (
        <div key={s.id} className="flex items-center gap-4 py-3 border-b border-line">
          <div className="w-11 h-11 rounded-full bg-bg-3 flex items-center justify-center text-fg-2">{icon(s.device)}</div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold flex items-center gap-2">
              {s.device} {s.current && <span className="text-[10px] font-bold bg-success/20 text-success rounded px-1.5 py-0.5">{t('CET APPAREIL')}</span>}
            </div>
            <div className="text-xs text-fg-3">
              {s.ip || t('IP inconnue')} · {t('Dernière activité : {d}', { d: formatDateTime(s.lastSeenAt) })} · {t('Connecté le {d}', { d: formatLongDate(s.createdAt) })}
            </div>
          </div>
          {!s.current && (
            <button className="icon-btn hover:!text-danger" title={t('Déconnecter')} onClick={() => del(`/auth/sessions/${s.id}`).then(load)}>
              <LogOut size={18} />
            </button>
          )}
        </div>
      ))}
      {list && list.length > 1 && (
        <button
          className="btn btn-danger mt-6"
          onClick={() =>
            post<{ revoked: number }>('/auth/sessions/revoke-others').then((r) => {
              toast(t('{n} appareil(s) déconnecté(s).', { n: r.revoked }), 'success');
              load();
            })
          }
        >
          {t('Déconnecter tous les autres appareils')}
        </button>
      )}
    </>
  );
}

/* ------------------------------ Nitro ------------------------------ */
function Nitro() {
  const me = useStore((s) => s.me!);
  const perks = [
    [t('Badge Nitro'), t('Un badge exclusif sur ton profil.')],
    [t('Avatars animés'), t('Utilise un GIF comme avatar.')],
    [t('Bannières personnalisées'), t('Image ou GIF en haut de ton profil.')],
    [t('Emojis partout'), t('Utilise les emojis de tous tes serveurs, partout.')],
    [t('Stickers partout'), t('Envoie tes stickers personnalisés dans tous les salons.')],
    [t('Thèmes exclusifs'), t('Aurore, Crépuscule, Océan, Forêt, Sakura…')],
    [t('Profils personnalisables'), t('Thème de profil en dégradé, couleurs, bio.')],
    [t('Gros fichiers'), t('Jusqu’à {size} par fichier, {n} fichiers par message.', { size: formatSize(me.limits.maxUploadBytes), n: me.limits.maxFilesPerMessage })],
    [t('Partage d’écran HD'), t('{h}p à {fps} images par seconde.', { h: me.limits.screen.height, fps: me.limits.screen.fps })],
    [t('Audio & vidéo HD'), t('Audio {k} kb/s, caméra {h}p.', { k: me.limits.audioBitrate / 1000, h: me.limits.video.height })],
    [t('Messages longs'), t('Jusqu’à {n} caractères par message.', { n: me.limits.maxMessageLength })],
    [t('Tout débloqué'), t('Toutes les fonctionnalités Premium, sans exception.')],
  ];
  return (
    <>
      <div data-tilt="5" className="rounded-2xl nitro-gradient p-8 text-white relative overflow-hidden mb-8">
        <Sparkles className="absolute right-6 top-6 opacity-30" size={96} />
        <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest opacity-90">
          <Gem size={18} /> endBuy Nitro
        </div>
        <h2 className="text-4xl font-extrabold mt-2">Lifetime</h2>
        <p className="mt-2 max-w-md opacity-95">{t('Offert à vie à tous les utilisateurs d’endBuy. Aucun paiement, aucune carte bancaire, aucune expiration.')}</p>
        <div className="mt-6 flex flex-wrap gap-3 text-sm">
          <span className="bg-black/25 rounded-full px-3 py-1 font-semibold flex items-center gap-1.5">
            <Check size={14} /> {me.premium ? t('Actif depuis le {date}', { date: formatLongDate(me.premium.since) }) : t('Inactif')}
          </span>
          <span className="bg-black/25 rounded-full px-3 py-1 font-semibold">{t('Expiration : jamais')}</span>
          <span className="bg-black/25 rounded-full px-3 py-1 font-semibold">0,00 €</span>
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {perks.map(([title, desc]) => (
          <div key={title} className="rounded-xl bg-bg-1 border border-line p-4 flex gap-3">
            <span className="w-9 h-9 rounded-lg nitro-gradient flex items-center justify-center text-white shrink-0">
              <Check size={18} />
            </span>
            <div>
              <div className="font-semibold">{title}</div>
              <div className="text-sm text-fg-3">{desc}</div>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-fg-3 mt-6">{t('Le statut Nitro est attribué et vérifié par le serveur endBuy : il ne peut être ni retiré, ni falsifié depuis le navigateur.')}</p>
    </>
  );
}

/* ------------------------------ Apparence & thèmes ------------------------------ */
const ACCENTS = ['#00C2A8', '#0B8BF5', '#7C5CFF', '#FF4F9A', '#FF7A5C', '#FFB224', '#23C55E', '#EF4444', '#06B6D4', '#A3E635'];

function Appearance() {
  const s = useStore((st) => st.me!.settings);
  const base = [
    { k: 'dark', label: t('Sombre'), bg: '#181b20' },
    { k: 'midnight', label: t('Minuit'), bg: '#000000' },
    { k: 'light', label: t('Clair'), bg: '#ffffff' },
  ];
  return (
    <>
      <SectionTitle>{t('Apparence')}</SectionTitle>
      <span className="label">{t('Thème')}</span>
      <div className="flex gap-4 mb-8">
        {base.map((th) => (
          <button key={th.k} className="flex flex-col items-center gap-2" onClick={() => updateSettings({ theme: th.k })}>
            <span className={`w-16 h-16 rounded-full border-2 ${s.theme === th.k ? 'border-accent ring-4 ring-accent/30' : 'border-line'}`} style={{ background: th.bg }} />
            <span className="text-sm">{th.label}</span>
          </button>
        ))}
      </div>
      <span className="label">{t("Couleur d'accentuation")}</span>
      <div className="flex flex-wrap gap-2 items-center mb-8">
        {ACCENTS.map((c) => (
          <button key={c} className={`w-9 h-9 rounded-full ${s.accent.toUpperCase() === c ? 'ring-2 ring-fg ring-offset-2 ring-offset-bg-2' : ''}`} style={{ background: c }} onClick={() => updateSettings({ accent: c })} />
        ))}
        <input type="color" className="w-10 h-10 bg-transparent cursor-pointer" value={s.accent} onChange={(e) => updateSettings({ accent: e.target.value.toUpperCase() })} title={t('Couleur personnalisée')} />
      </div>
      <span className="label">{t('Taille du texte : {n} %', { n: s.fontScale })}</span>
      <input type="range" min={80} max={130} step={5} value={s.fontScale} className="w-full accent-[var(--accent)] mb-8" onChange={(e) => updateSettings({ fontScale: Number(e.target.value) })} />
      <Row title={t('Effets de mouvement')} desc={t('Halo lumineux, cartes en 3D et boutons aimantés qui suivent ta souris.')}>
        <Switch checked={s.motion !== false && !s.reducedMotion} disabled={s.reducedMotion} onChange={(v) => updateSettings({ motion: v })} />
      </Row>
      <Row title={t('Réduire les animations')} desc={t('Désactive la plupart des animations et transitions.')}>
        <Switch checked={s.reducedMotion} onChange={(v) => updateSettings({ reducedMotion: v })} />
      </Row>
    </>
  );
}

function Themes() {
  const s = useStore((st) => st.me!.settings);
  const unlocked = useStore((st) => st.me!.limits.exclusiveThemes);
  const themes = [
    { k: 'aurora', label: t('Aurore'), bg: 'linear-gradient(135deg,#0b3b3a,#1b1446 55%,#3a0f4a)' },
    { k: 'sunset', label: t('Crépuscule'), bg: 'linear-gradient(135deg,#4a1d12,#5b1735 50%,#2a1240)' },
    { k: 'ocean', label: t('Océan'), bg: 'linear-gradient(135deg,#062b4a,#04394a 50%,#0a1f3d)' },
    { k: 'forest', label: t('Forêt'), bg: 'linear-gradient(135deg,#0d2b17,#183a1c 50%,#102419)' },
    { k: 'sakura', label: t('Sakura'), bg: 'linear-gradient(135deg,#4a1a35,#3d1a4a 50%,#2a1530)' },
  ];
  return (
    <>
      <SectionTitle sub={t('Des thèmes en dégradé réservés aux membres endBuy Nitro… c’est-à-dire à tout le monde !')}>
        <span className="flex items-center gap-2">
          {t('Thèmes exclusifs')} <NitroBadge size={14} />
        </span>
      </SectionTitle>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {themes.map((th) => (
          <button key={th.k} disabled={!unlocked} className={`rounded-xl overflow-hidden border-2 text-left ${s.theme === th.k ? 'border-accent' : 'border-line hover:border-fg-3'}`} onClick={() => updateSettings({ theme: th.k })}>
            <div className="h-24" style={{ background: th.bg }} />
            <div className="px-3 py-2 font-semibold text-sm flex items-center justify-between">
              {th.label} {s.theme === th.k && <Check size={16} className="text-accent" />}
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

/* ------------------------------ Notifications ------------------------------ */
function Notifications() {
  const n = useStore((s) => s.me!.settings.notifications);
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied');
  return (
    <>
      <SectionTitle>{t('Notifications')}</SectionTitle>
      <Row
        title={t('Activer les notifications de bureau')}
        desc={perm === 'denied' ? t('Les notifications sont bloquées par ton navigateur / système.') : perm === 'default' ? t('Autorisation pas encore accordée.') : t('Autorisées.')}
      >
        <Switch
          checked={n.desktop && perm === 'granted'}
          onChange={async (v) => {
            if (v && perm !== 'granted' && 'Notification' in window) setPerm(await Notification.requestPermission());
            updateSettings({ notifications: { ...n, desktop: v } });
          }}
        />
      </Row>
      <Row title={t('Sons')} desc={t('Jouer un son pour les nouveaux messages, les mentions et les appels.')}>
        <Switch checked={n.sounds} onChange={(v) => updateSettings({ notifications: { ...n, sounds: v } })} />
      </Row>
      <Row title={t('Messages privés')} desc={t('Être notifié de chaque nouveau message privé.')}>
        <Switch checked={n.dmNotifications} onChange={(v) => updateSettings({ notifications: { ...n, dmNotifications: v } })} />
      </Row>
      <Row title={t('Mentions uniquement')} desc={t('Sur les serveurs, ne notifier que lorsque tu es @mentionné.')}>
        <Switch checked={n.mentionsOnly} onChange={(v) => updateSettings({ notifications: { ...n, mentionsOnly: v } })} />
      </Row>
      <button
        className="btn btn-secondary mt-6"
        onClick={() => {
          if ('Notification' in window && Notification.permission === 'granted') new Notification('endBuy', { body: t('Les notifications fonctionnent !') });
          else toast(t('Autorise d’abord les notifications.'), 'error');
        }}
      >
        {t('Envoyer une notification de test')}
      </button>
    </>
  );
}

/* ------------------------------ Voix & vidéo ------------------------------ */
function VoiceVideo() {
  const [av, setAv] = useState<AVSettings>(loadAV);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [level, setLevel] = useState(0);
  const [testing, setTesting] = useState(false);
  const [cam, setCam] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const testRef = useRef<{ stream: MediaStream; ctx: AudioContext; raf: number } | null>(null);
  const limits = useStore((s) => s.me!.limits);
  const update = (patchAv: Partial<AVSettings>) => {
    const next = { ...av, ...patchAv };
    setAv(next);
    saveAV(next);
    if ('inputId' in patchAv || 'noiseSuppression' in patchAv || 'echoCancellation' in patchAv || 'autoGainControl' in patchAv) voice.reloadMic();
    if ('outputId' in patchAv) voice.setOutputDevice(next.outputId);
  };
  useEffect(() => {
    const refresh = () => navigator.mediaDevices?.enumerateDevices().then(setDevices).catch(() => {});
    refresh();
    navigator.mediaDevices?.addEventListener('devicechange', refresh);
    return () => {
      navigator.mediaDevices?.removeEventListener('devicechange', refresh);
      stopTest();
      cam?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = cam;
  }, [cam]);
  const stopTest = () => {
    const tr = testRef.current;
    if (tr) {
      cancelAnimationFrame(tr.raf);
      tr.stream.getTracks().forEach((x) => x.stop());
      tr.ctx.close();
    }
    testRef.current = null;
    setTesting(false);
    setLevel(0);
  };
  const startTest = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: av.inputId !== 'default' ? { ideal: av.inputId } : undefined, noiseSuppression: av.noiseSuppression, echoCancellation: av.echoCancellation, autoGainControl: av.autoGainControl } });
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const data = new Uint8Array(an.fftSize);
      const loop = () => {
        an.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
        if (testRef.current) testRef.current.raf = requestAnimationFrame(loop);
      };
      testRef.current = { stream, ctx, raf: requestAnimationFrame(loop) };
      setTesting(true);
      navigator.mediaDevices.enumerateDevices().then(setDevices);
    } catch (e) {
      toast(t('Impossible d’accéder au micro : {e}', { e: (e as Error).message }), 'error');
    }
  };
  const inputs = devices.filter((d) => d.kind === 'audioinput');
  const outputs = devices.filter((d) => d.kind === 'audiooutput');
  const cams = devices.filter((d) => d.kind === 'videoinput');
  const threshold = (0.012 + (av.inputSensitivity / 100) * 0.06) * 4;
  return (
    <>
      <SectionTitle sub={t('Qualité Nitro : audio {k} kb/s · caméra {v}p · partage d’écran {s}p{fps}', { k: limits.audioBitrate / 1000, v: limits.video.height, s: limits.screen.height, fps: limits.screen.fps })}>{t('Voix et vidéo')}</SectionTitle>
      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        <label>
          <span className="label">{t("Périphérique d'entrée")}</span>
          <select className="input" value={av.inputId} onChange={(e) => update({ inputId: e.target.value })}>
            <option value="default">{t('Par défaut')}</option>
            {inputs.filter((d) => d.deviceId !== 'default').map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || t('Micro {n}', { n: inputs.indexOf(d) + 1 })}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">{t('Périphérique de sortie')}</span>
          <select className="input" value={av.outputId} onChange={(e) => update({ outputId: e.target.value })}>
            <option value="default">{t('Par défaut')}</option>
            {outputs.filter((d) => d.deviceId !== 'default').map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || t('Sortie {n}', { n: outputs.indexOf(d) + 1 })}
              </option>
            ))}
          </select>
        </label>
      </div>
      <span className="label">{t('Test du micro')}</span>
      <div className="flex items-center gap-3 mb-6">
        <button className={`btn ${testing ? 'btn-danger' : 'btn-primary'}`} onClick={testing ? stopTest : startTest}>
          {testing ? t('Arrêter') : t('Vérifions')}
        </button>
        <div className="flex-1 h-3 rounded-full bg-bg-0 overflow-hidden relative">
          <div className="h-full bg-success transition-[width] duration-75" style={{ width: `${level * 100}%` }} />
          <div className="absolute top-0 bottom-0 w-0.5 bg-warn" style={{ left: `${Math.min(100, threshold * 100)}%` }} title={t('Seuil de détection')} />
        </div>
      </div>
      <span className="label">{t('Sensibilité de détection de la voix : {n}', { n: av.inputSensitivity })}</span>
      <input type="range" min={0} max={100} value={av.inputSensitivity} className="w-full accent-[var(--accent)] mb-6" onChange={(e) => update({ inputSensitivity: Number(e.target.value) })} />
      <Row title={t('Suppression du bruit')}>
        <Switch checked={av.noiseSuppression} onChange={(v) => update({ noiseSuppression: v })} />
      </Row>
      <Row title={t("Annulation de l'écho")}>
        <Switch checked={av.echoCancellation} onChange={(v) => update({ echoCancellation: v })} />
      </Row>
      <Row title={t('Contrôle automatique du gain')}>
        <Switch checked={av.autoGainControl} onChange={(v) => update({ autoGainControl: v })} />
      </Row>
      <h3 className="font-bold mt-8 mb-3">{t('Paramètres vidéo')}</h3>
      <div className="rounded-xl bg-bg-0 aspect-video max-w-md flex items-center justify-center overflow-hidden mb-3">
        {cam ? <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover -scale-x-100" /> : <span className="text-fg-3 text-sm">{t('Aperçu de la caméra')}</span>}
      </div>
      <div className="flex gap-2 max-w-md">
        <select className="input" value={av.videoId} onChange={(e) => update({ videoId: e.target.value })}>
          <option value="">{t('Par défaut')}</option>
          {cams.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || t('Caméra {n}', { n: cams.indexOf(d) + 1 })}
            </option>
          ))}
        </select>
        <button
          className="btn btn-secondary"
          onClick={async () => {
            if (cam) {
              cam.getTracks().forEach((x) => x.stop());
              setCam(null);
              return;
            }
            try {
              setCam(await navigator.mediaDevices.getUserMedia({ video: av.videoId ? { deviceId: { ideal: av.videoId } } : true }));
              navigator.mediaDevices.enumerateDevices().then(setDevices);
            } catch {
              toast(t('Aucune caméra disponible.'), 'error');
            }
          }}
        >
          {cam ? t('Arrêter') : t('Tester la vidéo')}
        </button>
      </div>
    </>
  );
}

/* ------------------------------ Langue ------------------------------ */
function Language() {
  const locale = useStore((s) => s.me!.settings.locale);
  return (
    <>
      <SectionTitle>{t('Langue')}</SectionTitle>
      <Radio
        value={locale}
        onChange={(v) => updateSettings({ locale: v })}
        options={[
          { v: 'fr', label: 'Français', desc: 'Français (France)' },
          { v: 'en', label: 'English', desc: 'English (US)' },
        ]}
      />
    </>
  );
}

/* ------------------------------ Bureau : serveur ------------------------------ */
function DesktopServer() {
  const [cfg, setCfg] = useState<Awaited<ReturnType<NonNullable<typeof desktop>['getConfig']>> | null>(null);
  const [url, setUrl] = useState('');
  useEffect(() => {
    desktop?.getConfig().then((c) => {
      setCfg(c);
      setUrl(c.mode === 'remote' ? c.serverUrl : '');
    });
  }, []);
  if (!desktop || !cfg) return <Spinner />;
  return (
    <>
      <SectionTitle sub={t('Choisis à quel serveur endBuy cette application se connecte.')}>{t('Serveur endBuy')}</SectionTitle>
      <div className="rounded-xl border border-line p-4 mb-4">
        <div className="font-semibold mb-1">{t('Se connecter à un serveur hébergé')}</div>
        <p className="text-sm text-fg-3 mb-3">{t('Pour discuter avec tout le monde, connecte-toi au serveur endBuy de ta communauté (ex. https://endbuy.mondomaine.fr).')}</p>
        <div className="flex gap-2">
          <input className="input" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className="btn btn-primary" disabled={!/^https?:\/\/.+/.test(url)} onClick={() => desktop!.setServer({ mode: 'remote', serverUrl: url.trim().replace(/\/$/, '') })}>
            {t('Se connecter')}
          </button>
        </div>
      </div>
      <div className="rounded-xl border border-line p-4">
        <div className="font-semibold mb-1">{t('Héberger sur cet ordinateur')}</div>
        <p className="text-sm text-fg-3 mb-3">{t('Lance un serveur endBuy complet (PostgreSQL intégré) sur ce PC. Active le partage réseau pour que tes amis sur le même réseau puissent s’y connecter.')}</p>
        <Row title={t('Partager sur le réseau local')} desc={cfg.lanUrls.length ? t('Adresse(s) à donner à tes amis : {u}', { u: cfg.lanUrls.join(', ') }) : undefined}>
          <Switch checked={cfg.lanHosting} onChange={(v) => desktop!.setServer({ mode: 'local', lanHosting: v })} />
        </Row>
        <button className="btn btn-secondary mt-3" disabled={cfg.mode === 'local'} onClick={() => desktop!.setServer({ mode: 'local', lanHosting: cfg.lanHosting })}>
          {cfg.mode === 'local' ? t('Mode actuel') : t('Utiliser le serveur local')}
        </button>
      </div>
      <p className="text-xs text-fg-3 mt-4">{t('Mode actuel : {m}', { m: cfg.mode === 'local' ? `${t('serveur local')} (${cfg.localUrl ?? ''})` : cfg.serverUrl })}</p>
    </>
  );
}

export function UserSettings({ tab }: { tab?: string }) {
  const [active, setActive] = useState(tab ?? 'account');
  const sections = [
    {
      title: t('Paramètres utilisateur'),
      items: [
        { key: 'account', label: t('Mon compte') },
        { key: 'profile', label: t('Profils') },
        { key: 'privacy', label: t('Confidentialité') },
        { key: 'security', label: t('Sécurité') },
        { key: 'devices', label: t('Appareils') },
      ],
    },
    {
      title: t('Abonnement'),
      items: [
        {
          key: 'nitro',
          label: (
            <span className="flex items-center gap-2">
              <Gem size={16} className="text-[#ff7a5c]" /> <span className="nitro-text font-bold">endBuy Nitro</span>
            </span>
          ),
        },
      ],
    },
    {
      title: t("Paramètres de l'application"),
      items: [
        { key: 'appearance', label: t('Apparence') },
        { key: 'themes', label: t('Thèmes') },
        { key: 'notifications', label: t('Notifications') },
        { key: 'voice', label: t('Voix et vidéo') },
        { key: 'language', label: t('Langue') },
        { key: 'desktop', label: t('Serveur endBuy'), hidden: !desktop },
      ],
    },
    {
      items: [
        {
          key: 'logout',
          label: (
            <span className="flex items-center gap-2">
              {t('Déconnexion')} <LogOut size={16} />
            </span>
          ),
          danger: true,
          onClick: () =>
            confirmDialog({
              title: t('Déconnexion'),
              body: t('Es-tu sûr de vouloir te déconnecter ?'),
              confirmLabel: t('Déconnexion'),
              danger: true,
              onConfirm: async () => {
                closeModal();
                await logout();
              },
            }),
        },
      ],
    },
  ];
  return (
    <SettingsLayout sections={sections} active={active} onSelect={setActive} onClose={closeModal}>
      {active === 'account' && <MyAccount go={setActive} />}
      {active === 'profile' && <Profile />}
      {active === 'privacy' && <Privacy />}
      {active === 'security' && <Security />}
      {active === 'devices' && <Sessions />}
      {active === 'nitro' && <Nitro />}
      {active === 'appearance' && <Appearance />}
      {active === 'themes' && <Themes />}
      {active === 'notifications' && <Notifications />}
      {active === 'voice' && <VoiceVideo />}
      {active === 'language' && <Language />}
      {active === 'desktop' && <DesktopServer />}
    </SettingsLayout>
  );
}

