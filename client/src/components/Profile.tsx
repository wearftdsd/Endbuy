import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Crown, Gem, MessageCircle, MoreHorizontal, UserCheck, UserPlus, X } from 'lucide-react';
import { get, post, put } from '../lib/api';
import { formatLongDate, renderMarkdown } from '../lib/format';
import { t } from '../lib/i18n';
import { closeModal, displayName, memberOf, presenceOf, S, setState, toast, useStore } from '../lib/store';
import type { User } from '../lib/types';
import { memberMenu, openDM } from './MemberList';
import { Avatar, Modal, NitroBadge, ServerIcon, statusLabel, useClickOutside } from './ui';

function themeStyle(u: User | undefined) {
  if (u?.profileTheme) return { background: `linear-gradient(180deg, ${u.profileTheme.primary} 0%, ${u.profileTheme.secondary} 100%)` };
  return undefined;
}

function Banner({ user, height }: { user: User | undefined; height: number }) {
  if (user?.banner) return <img src={user.banner} alt="" className="w-full object-cover" style={{ height }} />;
  const color = user?.bannerColor ?? user?.accentColor ?? 'var(--accent)';
  return <div style={{ height, background: color }} />;
}

function Badges({ user }: { user: User }) {
  if (!user.badges.length) return null;
  return (
    <div className="flex gap-1 bg-bg-0/60 rounded-lg p-1">
      {user.badges.includes('nitro') && <NitroBadge size={14} title={t('Abonné endBuy Nitro Lifetime depuis le {date}', { date: formatLongDate(user.premium?.since ?? null) })} />}
    </div>
  );
}

function ServerRoles({ userId, serverId }: { userId: string; serverId: string }) {
  const server = useStore((s) => s.servers[serverId]);
  const member = memberOf(server, userId);
  if (!server || !member) return null;
  const roles = server.roles.filter((r) => member.roles.includes(r.id)).sort((a, b) => b.position - a.position);
  return (
    <div className="mt-3">
      <div className="text-xs font-bold uppercase text-fg-2 mb-1.5">{roles.length ? t('Rôles') : t('Aucun rôle')}</div>
      <div className="flex flex-wrap gap-1">
        {server.ownerId === userId && (
          <span className="text-xs rounded-md bg-bg-3 px-2 py-0.5 flex items-center gap-1">
            <Crown size={12} className="text-warn" /> {t('Propriétaire')}
          </span>
        )}
        {roles.map((r) => (
          <span key={r.id} className="text-xs rounded-md bg-bg-3 px-2 py-0.5 flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: r.color ?? 'var(--fg-3)' }} /> {r.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function RelationshipButton({ userId }: { userId: string }) {
  const rel = useStore((s) => s.relationships[userId]);
  const username = useStore((s) => s.users[userId]?.username);
  if (rel?.type === 1)
    return (
      <button className="btn btn-secondary !py-1.5" title={t('Ami')} onClick={() => openDM(userId)}>
        <UserCheck size={16} />
      </button>
    );
  if (rel?.type === 4) return <button className="btn btn-secondary !py-1.5 text-xs" disabled>{t('Demande envoyée')}</button>;
  return (
    <button
      className="btn btn-primary !py-1.5 text-xs"
      onClick={() =>
        (rel?.type === 3 ? put(`/users/@me/relationships/${userId}`, { type: 1 }) : post('/users/@me/relationships', { username }))
          .then(() => toast(rel?.type === 3 ? t('Vous êtes maintenant amis !') : t('Demande d’ami envoyée.'), 'success'))
          .catch((e) => toast(e.message, 'error'))
      }
    >
      <UserPlus size={14} /> {rel?.type === 3 ? t('Accepter') : t('Ajouter')}
    </button>
  );
}

/** Carte de profil flottante (clic sur un nom / avatar). */
export function ProfilePopout() {
  const popout = useStore((s) => s.popout);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const close = () => setState((s) => void (s.popout = null));
  useClickOutside(ref, close, !!popout);
  useLayoutEffect(() => {
    if (!popout || !ref.current) return setPos(null);
    const r = ref.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(popout.x, window.innerWidth - r.width - 8));
    const top = Math.max(8, Math.min(popout.y, window.innerHeight - r.height - 8));
    setPos({ left, top });
  }, [popout]);
  useEffect(() => {
    if (!popout) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [popout]);
  if (!popout) return null;
  return (
    <div ref={ref} className="fixed z-50 anim-pop" style={{ left: pos?.left ?? popout.x, top: pos?.top ?? popout.y, visibility: pos ? 'visible' : 'hidden' }}>
      <ProfileCard userId={popout.userId} serverId={popout.serverId} onClose={close} />
    </div>
  );
}

function ProfileCard({ userId, serverId, onClose }: { userId: string; serverId: string | null; onClose: () => void }) {
  const user = useStore((s) => s.users[userId] ?? (s.me?.id === userId ? s.me : undefined));
  const presence = useStore((s) => presenceOf(s, userId));
  const name = useStore((s) => displayName(s, userId, serverId));
  const meId = useStore((s) => s.me!.id);
  const [note, setNote] = useState('');
  if (!user) return null;
  return (
    <div data-tilt="5" className="w-[300px] rounded-xl overflow-hidden border border-line" style={{ boxShadow: 'var(--shadow)', ...(themeStyle(user) ?? { background: 'var(--float)' }) }}>
      <Banner user={user} height={user.banner ? 110 : 60} />
      <div className="px-4 pb-4 relative">
        <div className="flex justify-between items-start">
          <div className="-mt-10 rounded-full p-1.5" style={{ background: user.profileTheme ? user.profileTheme.primary : 'var(--bg-0)' }}>
            <Avatar user={user} size={80} showStatus ring={user.profileTheme ? user.profileTheme.primary : 'var(--bg-0)'} />
          </div>
          <div className="mt-2">
            <Badges user={user} />
          </div>
        </div>
        <div className="rounded-lg bg-bg-0/80 backdrop-blur mt-2 p-3">
          <div className="text-xl font-bold leading-tight break-words">{name}</div>
          <div className="text-sm text-fg-2">
            {user.username}
            {user.pronouns && <span className="text-fg-3"> · {user.pronouns}</span>}
          </div>
          {presence.customStatus && (
            <div className="text-sm mt-2">
              {presence.customStatusEmoji} {presence.customStatus}
            </div>
          )}
          <div className="h-px bg-line my-3" />
          {user.bio && (
            <>
              <div className="text-xs font-bold uppercase text-fg-2 mb-1">{t('À propos de moi')}</div>
              <div className="text-sm mb-3">{renderMarkdown(user.bio, null)}</div>
            </>
          )}
          <div className="text-xs font-bold uppercase text-fg-2 mb-1">{t('Membre endBuy depuis')}</div>
          <div className="text-sm">{formatLongDate(user.createdAt)}</div>
          {user.premium && (
            <div className="mt-3 rounded-lg nitro-gradient text-white text-xs font-bold px-2.5 py-1.5 flex items-center gap-1.5">
              <Gem size={14} /> {t('endBuy Nitro Lifetime')}
            </div>
          )}
          {serverId && <ServerRoles userId={userId} serverId={serverId} />}
          <div className="text-xs text-fg-3 mt-3">
            {statusLabel(presence.status)} · ID {user.id}
          </div>
          {userId !== meId && (
            <>
              <input
                className="input !py-1.5 text-sm mt-3"
                placeholder={t('Envoyer un message à @{name}', { name: user.username })}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && note.trim()) {
                    try {
                      const ch = await post<{ id: string }>('/users/@me/channels', { recipientId: userId });
                      await post(`/channels/${ch.id}/messages`, { content: note.trim() });
                      setNote('');
                      onClose();
                      window.dispatchEvent(new CustomEvent('endbuy:navigate', { detail: `/channels/@me/${ch.id}` }));
                    } catch (err) {
                      toast((err as Error).message, 'error');
                    }
                  }
                }}
              />
              <div className="flex gap-2 mt-2">
                <button className="btn btn-secondary flex-1 !py-1.5" onClick={() => (onClose(), openDM(userId))}>
                  <MessageCircle size={16} /> {t('Message')}
                </button>
                <RelationshipButton userId={userId} />
                <button className="btn btn-secondary !py-1.5" onClick={(e) => memberMenu(e, userId, serverId)}>
                  <MoreHorizontal size={16} />
                </button>
              </div>
            </>
          )}
          <button className="w-full text-xs text-fg-3 hover:text-fg mt-3" onClick={() => setState((s) => void ((s.popout = null), (s.modal = { type: 'profile', userId, serverId }) as any))}>
            {t('Voir le profil complet')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Profil complet (fenêtre). */
export function ProfileModal({ userId, serverId }: { userId: string; serverId?: string | null }) {
  const user = useStore((s) => s.users[userId] ?? (s.me?.id === userId ? s.me : undefined));
  const presence = useStore((s) => presenceOf(s, userId));
  const meId = useStore((s) => s.me!.id);
  const [info, setInfo] = useState<{ mutualServers: string[]; mutualFriends: string[] } | null>(null);
  const [tab, setTab] = useState<'about' | 'servers' | 'friends'>('about');
  useEffect(() => {
    get(`/users/${userId}`)
      .then((r) => {
        setInfo(r);
        setState((s) => void (s.users[r.user.id] = r.user));
      })
      .catch(() => setInfo({ mutualServers: [], mutualFriends: [] }));
  }, [userId]);
  if (!user) return null;
  return (
    <Modal onClose={closeModal} width={600} bare>
      <div className="rounded-2xl overflow-hidden border border-line" style={themeStyle(user) ?? { background: 'var(--bg-1)' }}>
        <div className="relative">
          <Banner user={user} height={user.banner ? 210 : 120} />
          <button className="absolute right-3 top-3 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center" onClick={closeModal}>
            <X size={18} />
          </button>
        </div>
        <div className="px-5 pb-5">
          <div className="flex justify-between items-end">
            <div className="-mt-16 rounded-full p-2" style={{ background: user.profileTheme?.primary ?? 'var(--bg-1)' }}>
              <Avatar user={user} size={120} showStatus ring={user.profileTheme?.primary ?? 'var(--bg-1)'} />
            </div>
            <div className="flex items-center gap-2 mb-2">
              <Badges user={user} />
              {userId !== meId && (
                <>
                  <button className="btn btn-primary" onClick={() => (closeModal(), openDM(userId))}>
                    <MessageCircle size={16} /> {t('Envoyer un message')}
                  </button>
                  <RelationshipButton userId={userId} />
                </>
              )}
            </div>
          </div>
          <div className="rounded-xl bg-bg-0/85 backdrop-blur mt-3 p-4">
            <div className="text-2xl font-bold">{displayName(S(), userId, serverId)}</div>
            <div className="text-fg-2">
              {user.username}
              {user.pronouns && <span className="text-fg-3"> · {user.pronouns}</span>}
            </div>
            {presence.customStatus && <div className="mt-1 text-sm">{presence.customStatusEmoji} {presence.customStatus}</div>}
            <div className="flex gap-4 border-b border-line mt-4 text-sm">
              {(
                [
                  ['about', t('Infos utilisateur')],
                  ['servers', t('Serveurs en commun ({n})', { n: info?.mutualServers.length ?? 0 })],
                  ...(userId !== meId ? [['friends', t('Amis en commun ({n})', { n: info?.mutualFriends.length ?? 0 })]] : []),
                ] as [typeof tab, string][]
              ).map(([k, label]) => (
                <button key={k} className={`pb-2 -mb-px border-b-2 font-medium ${tab === k ? 'border-fg text-fg' : 'border-transparent text-fg-3 hover:text-fg-2'}`} onClick={() => setTab(k)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="pt-4 min-h-[140px] max-h-[300px] overflow-y-auto scroll-thin">
              {tab === 'about' && (
                <>
                  {user.bio && (
                    <>
                      <div className="text-xs font-bold uppercase text-fg-2 mb-1">{t('À propos de moi')}</div>
                      <div className="text-sm mb-4">{renderMarkdown(user.bio, null)}</div>
                    </>
                  )}
                  <div className="text-xs font-bold uppercase text-fg-2 mb-1">{t('Membre endBuy depuis')}</div>
                  <div className="text-sm mb-4">{formatLongDate(user.createdAt)}</div>
                  {user.premium && (
                    <>
                      <div className="text-xs font-bold uppercase text-fg-2 mb-1">{t('Abonnement')}</div>
                      <div className="text-sm flex items-center gap-2">
                        <NitroBadge size={14} /> <span className="nitro-text font-bold">endBuy Nitro Lifetime</span> · {t('depuis le {date}', { date: formatLongDate(user.premium.since) })}
                      </div>
                    </>
                  )}
                  {serverId && <ServerRoles userId={userId} serverId={serverId} />}
                  <div className="text-xs text-fg-3 mt-4">{t('Identifiant unique')} : <span className="font-mono">{user.id}</span></div>
                </>
              )}
              {tab === 'servers' &&
                (info?.mutualServers ?? []).map((sid) => {
                  const sv = S().servers[sid];
                  if (!sv) return null;
                  return (
                    <button key={sid} className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-bg-3" onClick={() => (closeModal(), window.dispatchEvent(new CustomEvent('endbuy:navigate', { detail: `/channels/${sid}` })))}>
                      <ServerIcon name={sv.name} icon={sv.icon} size={40} className="rounded-xl bg-bg-3" />
                      <span className="font-medium">{sv.name}</span>
                    </button>
                  );
                })}
              {tab === 'friends' &&
                (info?.mutualFriends ?? []).map((fid) => (
                  <div key={fid} className="flex items-center gap-3 p-2 rounded-lg hover:bg-bg-3">
                    <Avatar userId={fid} size={36} showStatus ring="var(--bg-0)" />
                    <span className="font-medium">{displayName(S(), fid)}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

