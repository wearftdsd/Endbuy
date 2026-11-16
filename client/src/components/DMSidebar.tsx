import { useNavigate } from 'react-router-dom';
import { Gem, Plus, Search, Users, X } from 'lucide-react';
import { del } from '../lib/api';
import { t, tn } from '../lib/i18n';
import { channelTitle, isUnread, mentionCount, openContextMenu, openModal, presenceOf, snowGt, useStore } from '../lib/store';
import { CH, type Channel } from '../lib/types';
import { Avatar } from './ui';

function GroupIcon({ channel, size = 32 }: { channel: Channel; size?: number }) {
  const ids = channel.recipients ?? [];
  return (
    <div className="relative shrink-0 rounded-full brand-gradient flex items-center justify-center text-white" style={{ width: size, height: size }}>
      <Users size={size * 0.5} />
      {ids.length > 0 && <span className="sr-only">{ids.length}</span>}
    </div>
  );
}

function DMItem({ channel, active }: { channel: Channel; active: boolean }) {
  const navigate = useNavigate();
  const title = useStore((s) => channelTitle(s, channel));
  const unread = useStore((s) => isUnread(s, channel));
  const mentions = useStore((s) => mentionCount(s, channel.id));
  const otherId = channel.type === CH.DM ? channel.recipients?.[0] : undefined;
  const presence = useStore((s) => (otherId ? presenceOf(s, otherId) : null));
  const inCall = useStore((s) => Object.values(s.voiceStates).some((v) => v.channelId === channel.id));
  const close = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await del(`/channels/${channel.id}`).catch(() => {});
    if (active) navigate('/channels/@me');
  };
  return (
    <div
      className={`group mx-2 px-2 py-1.5 flex items-center gap-3 rounded-md cursor-pointer transition-colors ${active ? 'channel-active text-fg' : unread ? 'text-fg hover:bg-bg-3' : 'text-fg-3 hover:bg-bg-3 hover:text-fg-2'}`}
      onClick={() => navigate(`/channels/@me/${channel.id}`)}
      onContextMenu={(e) =>
        openContextMenu(e, [
          ...(otherId ? [{ label: t('Profil'), onClick: () => openModal({ type: 'profile', userId: otherId }) }] : []),
          ...(channel.type === CH.GROUP_DM ? [{ label: t('Ajouter des amis au groupe'), onClick: () => openModal({ type: 'createGroup', channelId: channel.id }) }] : []),
          { label: channel.type === CH.GROUP_DM ? t('Quitter le groupe') : t('Fermer la conversation'), danger: channel.type === CH.GROUP_DM, onClick: () => close(e) },
          { separator: true },
          { label: t("Copier l'identifiant"), onClick: () => navigator.clipboard?.writeText(channel.id) },
        ])
      }
    >
      {otherId ? <Avatar userId={otherId} size={32} showStatus ring="var(--bg-1)" /> : <GroupIcon channel={channel} />}
      <div className="flex-1 min-w-0">
        <div className={`truncate text-[15px] ${unread && !active ? 'font-semibold' : 'font-medium'}`}>{title}</div>
        {channel.type === CH.GROUP_DM ? (
          <div className="text-xs text-fg-3 truncate">{tn((channel.recipients?.length ?? 0) + 1, '{n} membre', '{n} membres')}</div>
        ) : presence?.customStatus ? (
          <div className="text-xs text-fg-3 truncate">
            {presence.customStatusEmoji} {presence.customStatus}
          </div>
        ) : null}
      </div>
      {inCall && <span className="w-2 h-2 rounded-full bg-success animate-pulse" title={t('Appel en cours')} />}
      {mentions > 0 && !active && <span className="min-w-4 h-4 px-1 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center">{mentions}</span>}
      <button className="opacity-0 group-hover:opacity-100 text-fg-3 hover:text-fg" onClick={close} aria-label={t('Fermer')}>
        <X size={16} />
      </button>
    </div>
  );
}

export function DMSidebar({ channelId }: { channelId: string | null }) {
  const navigate = useNavigate();
  const channels = useStore((s) => s.privateChannels);
  const pending = useStore((s) => Object.values(s.relationships).filter((r) => r.type === 3).length);
  const list = Object.values(channels)
    .filter((c) => !c.closed || c.id === channelId)
    .sort((a, b) => (snowGt(a.lastMessageId ?? a.id, b.lastMessageId ?? b.id) ? -1 : 1));
  return (
    <>
      <div className="h-12 px-2.5 flex items-center border-b border-line shrink-0">
        <button className="w-full h-7 rounded-md bg-bg-0 text-fg-3 text-sm text-left px-2 flex items-center gap-2 hover:text-fg-2" onClick={() => openModal({ type: 'createGroup' })}>
          <Search size={14} className="shrink-0" /> <span className="truncate">{t('Trouver ou démarrer une conversation')}</span>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin py-2">
        <button
          className={`mx-2 w-[calc(100%-16px)] px-3 h-10 flex items-center gap-3 rounded-md font-medium transition-colors ${!channelId ? 'bg-bg-4 text-fg' : 'text-fg-2 hover:bg-bg-3 hover:text-fg'}`}
          onClick={() => navigate('/channels/@me')}
        >
          <Users size={20} /> <span className="flex-1 text-left">{t('Amis')}</span>
          {pending > 0 && <span className="min-w-5 h-5 px-1 rounded-full bg-danger text-white text-[11px] font-bold flex items-center justify-center">{pending}</span>}
        </button>
        <button
          className="mx-2 w-[calc(100%-16px)] px-3 h-10 flex items-center gap-3 rounded-md font-medium text-fg-2 hover:bg-bg-3 hover:text-fg transition-colors"
          onClick={() => openModal({ type: 'userSettings', tab: 'nitro' })}
        >
          <Gem size={20} className="text-[#ff7a5c]" /> <span className="nitro-text font-bold">endBuy Nitro</span>
          <span className="ml-auto text-[10px] font-bold rounded px-1.5 py-0.5 nitro-gradient text-white">{t('À VIE')}</span>
        </button>
        <div className="flex items-center justify-between px-4 mt-4 mb-1 group">
          <span className="text-xs font-bold uppercase tracking-wide text-fg-3 group-hover:text-fg-2">{t('Messages privés')}</span>
          <button className="text-fg-3 hover:text-fg" title={t('Créer un MP')} onClick={() => openModal({ type: 'createGroup' })}>
            <Plus size={16} />
          </button>
        </div>
        {list.map((c) => (
          <DMItem key={c.id} channel={c} active={c.id === channelId} />
        ))}
        {!list.length && (
          <div className="px-4 py-6 text-center text-sm text-fg-3">
            {t('Aucune conversation pour le moment. Ajoute des amis pour commencer à discuter !')}
          </div>
        )}
      </div>
    </>
  );
}
