import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { errorMessage, get, post } from '../lib/api';
import { t } from '../lib/i18n';
import { useStore } from '../lib/store';
import type { User } from '../lib/types';
import { Avatar, ErrorBox, LogoMark, ServerIcon, Spinner, Wordmark } from './ui';

interface InvitePreview {
  code: string;
  server: { id: string; name: string; icon: string | null; description: string };
  memberCount: number;
  onlineCount: number;
  inviter: User | null;
  expiresAt: string | null;
  joined: boolean;
}

export function InvitePage() {
  const { code = '' } = useParams();
  const me = useStore((s) => s.me);
  const navigate = useNavigate();
  const [inv, setInv] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    get<InvitePreview>(`/invites/${encodeURIComponent(code)}`)
      .then(setInv)
      .catch((e) => setError(errorMessage(e)));
  }, [code]);

  const accept = async () => {
    if (!me) return navigate(`/login?next=${encodeURIComponent(`/invite/${code}`)}`);
    setBusy(true);
    try {
      const { serverId } = await post<{ serverId: string }>(`/invites/${encodeURIComponent(code)}`);
      setTimeout(() => navigate(`/channels/${serverId}`), 150);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <div className="h-full flex items-center justify-center p-4" style={{ background: 'radial-gradient(900px 500px at 50% -10%, #00c2a833, transparent), var(--bg-0)' }}>
      <div className="w-full max-w-md bg-bg-2 border border-line rounded-2xl p-8 text-center anim-up" style={{ boxShadow: 'var(--shadow)' }}>
        <div className="flex items-center justify-center gap-2 mb-6">
          <LogoMark size={28} /> <Wordmark className="text-xl" />
        </div>
        {!inv && !error && <Spinner className="mx-auto" />}
        {error && !inv && (
          <>
            <ErrorBox message={error} />
            <Link to="/channels/@me" className="btn btn-primary w-full">
              {t('Continuer vers endBuy')}
            </Link>
          </>
        )}
        {inv && (
          <>
            <div className="w-20 h-20 mx-auto rounded-2xl overflow-hidden bg-bg-3 mb-4">
              <ServerIcon name={inv.server.name} icon={inv.server.icon} size={80} />
            </div>
            {inv.inviter && (
              <div className="flex items-center justify-center gap-2 text-sm text-fg-2 mb-1">
                <Avatar user={inv.inviter} size={20} /> {t('{name} t’a invité à rejoindre', { name: inv.inviter.displayName })}
              </div>
            )}
            <h1 className="text-2xl font-bold">{inv.server.name}</h1>
            {inv.server.description && <p className="text-fg-2 text-sm mt-2">{inv.server.description}</p>}
            <div className="flex items-center justify-center gap-4 text-sm text-fg-3 mt-3">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-success" /> {t('{n} en ligne', { n: inv.onlineCount })}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-fg-3" /> {t('{n} membres', { n: inv.memberCount })}
              </span>
            </div>
            <ErrorBox message={error} />
            <button className="btn btn-primary w-full mt-6 py-3" disabled={busy} onClick={inv.joined ? () => navigate(`/channels/${inv.server.id}`) : accept}>
              {busy ? <Spinner /> : inv.joined ? t('Aller sur le serveur') : me ? t("Accepter l'invitation") : t('Se connecter pour rejoindre')}
            </button>
            {!me && (
              <p className="text-sm text-fg-3 mt-4">
                {t('Pas encore de compte ?')}{' '}
                <Link className="text-accent-2 hover:underline" to={`/register?next=${encodeURIComponent(`/invite/${code}`)}`}>
                  {t("S'inscrire (sans e-mail)")}
                </Link>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
