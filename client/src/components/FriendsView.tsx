import { useState } from 'react';
import { Check, Compass, Gem, Menu, MessageCircle, MoreVertical, Phone, Plus, Search, UserPlus, Users, X } from 'lucide-react';
import { del, errorMessage, post, put } from '../lib/api';
import { t, tn } from '../lib/i18n';
import { voice } from '../lib/rtc';
import { confirmDialog, displayName, findChannel, openContextMenu, openModal, presenceOf, S, setState, toast, useStore } from '../lib/store';
import type { Channel } from '../lib/types';
import { openDM } from './MemberList';
import { Avatar, statusLabel } from './ui';

type Tab = 'online' | 'all' | 'pending' | 'blocked' | 'add';

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return t('Bonne nuit');
  if (h < 12) return t('Bonjour');
  if (h < 18) return t('Bon après-midi');
  return t('Bonsoir');
}

/** Carte d'accueil : salutation, état Nitro et raccourcis. */
function HomeHero({ onAdd }: { onAdd: () => void }) {
  const me = useStore((s) => s.me!);
  const online = useStore((s) => Object.values(s.relationships).filter((r) => r.type === 1 && (s.presences[r.id]?.status ?? 'offline') !== 'offline').length);
  const servers = useStore((s) => s.serverOrder.length);
  return (
    <div className="home-hero mx-6 mt-5 rounded-3xl p-6 sm:p-7 relative overflow-hidden" data-tilt="3" data-spotlight>
      <div className="home-shape w-28 h-28 brand-gradient opacity-30 -right-6 -top-8 rotate-12" data-parallax="40" />
      <div className="home-shape w-16 h-16 nitro-gradient opacity-40 right-28 bottom-4 -rotate-6" data-parallax="-30" />
      <div className="home-shape w-10 h-10 bg-[#8b5cf6] opacity-40 right-12 bottom-16 rotate-45" data-parallax="22" />
      <div className="relative max-w-xl">
        <div className="text-sm text-fg-2 font-medium">{greeting()},</div>
        <h2 className="text-3xl font-extrabold tracking-tight mt-0.5">{me.displayName}</h2>
        <div className="flex flex-wrap items-center gap-2 mt-3 text-xs font-semibold">
          {me.premium && (
            <span className="inline-flex items-center gap-1.5 rounded-full nitro-gradient text-white px-2.5 py-1">
              <Gem size={12} /> Nitro Lifetime
            </span>
          )}
          <span className="rounded-full bg-bg-3 text-fg-2 px-2.5 py-1">{tn(online, '{n} ami en ligne', '{n} amis en ligne')}</span>
          <span className="rounded-full bg-bg-3 text-fg-2 px-2.5 py-1">{tn(servers, '{n} serveur', '{n} serveurs')}</span>
        </div>
        <div className="flex flex-wrap gap-2 mt-5">
          <button className="btn btn-primary" data-magnetic="0.2" onClick={onAdd}>
            <UserPlus size={16} /> {t('Ajouter un ami')}
          </button>
          <button className="btn btn-secondary" data-magnetic="0.2" onClick={() => openModal({ type: 'createServer' })}>
            <Plus size={16} /> {t('Créer un serveur')}
          </button>
          <button className="btn btn-secondary" data-magnetic="0.2" onClick={() => openModal({ type: 'createServer' })}>
            <Compass size={16} /> {t('Rejoindre un serveur')}
          </button>
        </div>
      </div>
    </div>
  );
}

function FriendRow({ userId, type }: { userId: string; type: number }) {
  const user = useStore((s) => s.users[userId]);
  const presence = useStore((s) => presenceOf(s, userId));
  if (!user) return null;
  const action = (icon: React.ReactNode, title: string, onClick: () => void, danger = false) => (
    <button
      className={`w-9 h-9 rounded-full bg-bg-1 flex items-center justify-center text-fg-2 ${danger ? 'hover:text-danger' : 'hover:text-fg'}`}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {icon}
    </button>
  );
  const sub =
    type === 3
      ? t('Demande d’ami reçue')
      : type === 4
        ? t('Demande d’ami envoyée')
        : type === 2
          ? t('Bloqué')
          : presence.customStatus
            ? `${presence.customStatusEmoji ?? ''} ${presence.customStatus}`
            : statusLabel(presence.status);
  return (
    <div
      className="group flex items-center gap-3 px-3 py-2.5 mx-2 rounded-lg hover:bg-bg-3 border-t border-line first:border-t-0 cursor-pointer"
      onClick={() => type === 1 && openDM(userId)}
      onContextMenu={(e) =>
        openContextMenu(e, [
          { label: t('Envoyer un message'), onClick: () => openDM(userId) },
          { label: t('Retirer des amis'), danger: true, disabled: type !== 1, onClick: () => del(`/users/@me/relationships/${userId}`) },
          { label: t('Bloquer'), danger: true, onClick: () => put(`/users/@me/relationships/${userId}`, { type: 2 }) },
          { separator: true },
          { label: t("Copier l'identifiant utilisateur"), onClick: () => navigator.clipboard?.writeText(userId) },
        ])
      }
    >
      <Avatar userId={userId} size={36} showStatus={type === 1} ring="var(--bg-2)" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold truncate">
          {user.displayName} <span className="text-fg-3 font-normal text-sm hidden group-hover:inline">@{user.username}</span>
        </div>
        <div className="text-xs text-fg-3 truncate">{sub}</div>
      </div>
      <div className="flex gap-2">
        {type === 1 && (
          <>
            {action(<MessageCircle size={18} />, t('Envoyer un message'), () => openDM(userId))}
            {action(<Phone size={18} />, t('Appel vocal'), async () => {
              await openDM(userId);
              const ch = Object.values(S().privateChannels).find((c) => c.type === 1 && c.recipients?.[0] === userId);
              if (ch) voice.join(ch.id, null);
            })}
            {action(<MoreVertical size={18} />, t('Plus'), () =>
              confirmDialog({
                title: t('Retirer {name}', { name: user.displayName }),
                body: t('Es-tu sûr de vouloir retirer {name} de tes amis ?', { name: user.displayName }),
                confirmLabel: t('Retirer l’ami'),
                danger: true,
                onConfirm: () => del(`/users/@me/relationships/${userId}`),
              }),
            )}
          </>
        )}
        {type === 3 && (
          <>
            {action(<Check size={18} />, t('Accepter'), () => put(`/users/@me/relationships/${userId}`, { type: 1 }).catch((e) => toast(e.message, 'error')))}
            {action(<X size={18} />, t('Refuser'), () => del(`/users/@me/relationships/${userId}`), true)}
          </>
        )}
        {type === 4 && action(<X size={18} />, t('Annuler'), () => del(`/users/@me/relationships/${userId}`), true)}
        {type === 2 && action(<X size={18} />, t('Débloquer'), () => del(`/users/@me/relationships/${userId}`), true)}
      </div>
    </div>
  );
}

function AddFriend() {
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const me = useStore((s) => s.me!);
  return (
    <div className="px-6 py-5 border-b border-line">
      <h2 className="font-bold uppercase text-sm">{t('Ajouter un ami')}</h2>
      <p className="text-sm text-fg-2 mt-1">{t('Tu peux ajouter des amis grâce à leur pseudonyme endBuy. Le tien : ')}<span className="font-mono text-fg">{me.username}</span></p>
      <form
        className={`mt-4 flex items-center gap-2 bg-bg-0 rounded-xl border px-3 py-2 ${status ? (status.ok ? 'border-success' : 'border-danger') : 'border-line focus-within:border-accent'}`}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!username.trim()) return;
          setBusy(true);
          try {
            await post('/users/@me/relationships', { username: username.trim() });
            setStatus({ ok: true, text: t('Ta demande d’ami a été envoyée à {name} !', { name: username.trim() }) });
            setUsername('');
          } catch (err) {
            setStatus({ ok: false, text: errorMessage(err) });
          } finally {
            setBusy(false);
          }
        }}
      >
        <input className="flex-1 bg-transparent outline-none py-1.5" placeholder={t('Saisis un pseudonyme')} value={username} onChange={(e) => (setUsername(e.target.value), setStatus(null))} maxLength={32} autoFocus />
        <button className="btn btn-primary !py-1.5" disabled={!username.trim() || busy}>
          {t("Envoyer une demande d'ami")}
        </button>
      </form>
      {status && <p className={`text-sm mt-2 ${status.ok ? 'text-success' : 'text-danger'}`}>{status.text}</p>}
    </div>
  );
}

function ActiveNow() {
  const active = useStore((s) => {
    const friends = Object.values(s.relationships).filter((r) => r.type === 1).map((r) => r.id);
    return friends
      .filter((id) => s.voiceStates[id])
      .map((id) => ({ id, channelId: s.voiceStates[id].channelId, serverId: s.voiceStates[id].serverId }))
      .map((x) => JSON.stringify(x))
      .join('\n');
  });
  const list = active ? active.split('\n').map((x) => JSON.parse(x) as { id: string; channelId: string; serverId: string | null }) : [];
  return (
    <aside className="w-[340px] shrink-0 border-l border-line p-4 hidden xl:block overflow-y-auto scroll-thin">
      <h3 className="text-xl font-bold mb-4">{t('Actifs maintenant')}</h3>
      {list.length === 0 ? (
        <div className="text-center px-4 py-6">
          <div className="font-semibold">{t("C'est calme pour l'instant…")}</div>
          <p className="text-sm text-fg-3 mt-1">{t('Quand un ami sera dans un salon vocal ou un appel, tu le verras ici.')}</p>
        </div>
      ) : (
        list.map((a) => {
          const s = S();
          const ch = findChannel(s, a.channelId) as Channel | undefined;
          const server = a.serverId ? s.servers[a.serverId] : null;
          return (
            <div key={a.id} className="rounded-xl bg-bg-1 border border-line p-3 mb-2">
              <div className="flex items-center gap-3">
                <Avatar userId={a.id} size={36} showStatus ring="var(--bg-1)" />
                <div className="min-w-0">
                  <div className="font-semibold truncate">{displayName(s, a.id)}</div>
                  <div className="text-xs text-fg-3 truncate">{server ? `${server.name} · ${ch?.name ?? ''}` : t('En appel privé')}</div>
                </div>
              </div>
              {ch && server && (
                <button className="btn btn-secondary w-full mt-3 !py-1.5 text-sm" onClick={() => voice.join(ch.id, server.id)}>
                  {t('Rejoindre le vocal')}
                </button>
              )}
            </div>
          );
        })
      )}
    </aside>
  );
}

export function FriendsView() {
  const [tab, setTab] = useState<Tab>('online');
  const [filter, setFilter] = useState('');
  const rels = useStore((s) => s.relationships);
  const presences = useStore((s) => s.presences);
  const users = useStore((s) => s.users);
  const pending = Object.values(rels).filter((r) => r.type === 3).length;
  let list = Object.values(rels);
  if (tab === 'online') list = list.filter((r) => r.type === 1 && (presences[r.id]?.status ?? 'offline') !== 'offline');
  if (tab === 'all') list = list.filter((r) => r.type === 1);
  if (tab === 'pending') list = list.filter((r) => r.type === 3 || r.type === 4);
  if (tab === 'blocked') list = list.filter((r) => r.type === 2);
  const f = filter.toLowerCase();
  if (f) list = list.filter((r) => users[r.id]?.username.toLowerCase().includes(f) || users[r.id]?.displayName.toLowerCase().includes(f));
  list.sort((a, b) => (users[a.id]?.displayName ?? '').localeCompare(users[b.id]?.displayName ?? ''));

  const tabBtn = (k: Tab, label: string, badge?: number) => (
    <button
      className={`px-2.5 py-1 rounded-md text-[15px] font-medium flex items-center gap-1.5 ${
        k === 'add' ? (tab === k ? 'text-success bg-transparent' : 'bg-success text-white') : tab === k ? 'bg-bg-4 text-fg' : 'text-fg-2 hover:bg-bg-3 hover:text-fg'
      }`}
      onClick={() => setTab(k)}
    >
      {label}
      {!!badge && <span className="min-w-4 h-4 px-1 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center">{badge}</span>}
    </button>
  );

  const titles: Record<Exclude<Tab, 'add'>, (n: number) => string> = {
    online: (n) => tn(n, 'En ligne — {n}', 'En ligne — {n}'),
    all: (n) => tn(n, 'Tous les amis — {n}', 'Tous les amis — {n}'),
    pending: (n) => tn(n, 'En attente — {n}', 'En attente — {n}'),
    blocked: (n) => tn(n, 'Bloqués — {n}', 'Bloqués — {n}'),
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="h-12 shrink-0 px-3 flex items-center gap-3 border-b border-line overflow-x-auto scroll-none">
        <button className="icon-btn md:hidden shrink-0" onClick={() => setState((s) => void (s.mobileNav = true))} aria-label={t('Menu')}>
          <Menu size={20} />
        </button>
        <div className="flex items-center gap-2 font-bold shrink-0">
          <Users size={20} className="text-fg-3" /> {t('Amis')}
        </div>
        <div className="w-px h-6 bg-line shrink-0" />
        <div className="flex gap-1 shrink-0">
          {tabBtn('online', t('En ligne'))}
          {tabBtn('all', t('Tous'))}
          {tabBtn('pending', t('En attente'), pending)}
          {tabBtn('blocked', t('Bloqués'))}
          {tabBtn('add', t('Ajouter un ami'))}
        </div>
      </div>
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 overflow-y-auto scroll-thin min-w-0">
          {tab === 'add' ? (
            <>
              <AddFriend />
              <div className="flex flex-col items-center justify-center text-center p-10 text-fg-3">
                <UserPlus size={72} className="opacity-30 mb-4" />
                <p>{t('Les amis peuvent t’écrire en privé, t’appeler et créer des groupes avec toi.')}</p>
              </div>
            </>
          ) : (
            <>
              {(tab === 'online' || tab === 'all') && <HomeHero onAdd={() => setTab('add')} />}
              <div className="px-6 pt-4">
                <div className="relative">
                  <input className="input !py-1.5 text-sm" placeholder={t('Rechercher')} value={filter} onChange={(e) => setFilter(e.target.value)} />
                  <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-3" />
                </div>
                <div className="text-xs font-bold uppercase tracking-wide text-fg-3 mt-5 mb-2">{titles[tab](list.length)}</div>
              </div>
              {list.map((r) => (
                <FriendRow key={r.id} userId={r.id} type={r.type} />
              ))}
              {!list.length && (
                <div className="flex flex-col items-center justify-center text-center p-10 text-fg-3">
                  <Users size={64} className="opacity-30 mb-4" />
                  <p>
                    {tab === 'pending'
                      ? t('Aucune demande d’ami en attente.')
                      : tab === 'blocked'
                        ? t('Tu n’as bloqué personne.')
                        : t('Personne par ici… Ajoute des amis avec leur pseudonyme !')}
                  </p>
                  {tab !== 'blocked' && (
                    <button className="btn btn-primary mt-4" onClick={() => setTab('add')}>
                      {t('Ajouter un ami')}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        <ActiveNow />
      </div>
    </div>
  );
}
