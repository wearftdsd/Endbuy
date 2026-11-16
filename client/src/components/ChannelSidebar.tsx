import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  ChevronDown,
  ChevronRight,
  Copy,
  FolderPlus,
  Hash,
  HeadphoneOff,
  Lock,
  LogOut,
  MicOff,
  Pencil,
  Plus,
  PlusCircle,
  Radio,
  CalendarDays,
  Settings,
  Smile,
  Trash2,
  UserPlus,
  Video,
  Volume2,
  X,
} from 'lucide-react';
import { del, patch } from '../lib/api';
import { ackChannel } from '../lib/gateway';
import { t } from '../lib/i18n';
import { has, P } from '../lib/perms';
import { voice } from '../lib/rtc';
import {
  confirmDialog,
  displayName,
  isUnread,
  mentionCount,
  openContextMenu,
  openModal,
  S,
  setState,
  sortedChannels,
  toast,
  useStore,
  voiceMembers,
} from '../lib/store';
import { CH, isVoiceLike, type Channel } from '../lib/types';
import { EventsEntry } from './Events';
import { Avatar, useClickOutside } from './ui';

const COLLAPSE_KEY = 'endbuy.collapsed';
function loadCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}');
  } catch {
    return {};
  }
}

export function channelMenu(e: React.MouseEvent, ch: Channel) {
  const s = S();
  const server = ch.serverId ? s.servers[ch.serverId] : undefined;
  const canManage = has(ch.permissions, P.MANAGE_CHANNELS) || has(server?.permissions, P.MANAGE_CHANNELS);
  openContextMenu(e, [
    ...(ch.type === CH.TEXT ? [{ label: t('Marquer comme lu'), icon: <Bell size={16} />, onClick: () => ackChannel(ch.id) }, { separator: true }] : []),
    ...(server && has(server.permissions, P.CREATE_INVITE) ? [{ label: t('Inviter des gens'), icon: <UserPlus size={16} />, onClick: () => openModal({ type: 'invite', serverId: server.id }) }] : []),
    ...(canManage
      ? [
          { label: t('Modifier le salon'), icon: <Pencil size={16} />, onClick: () => openModal({ type: 'channelSettings', channelId: ch.id }) },
          ...(ch.type === CH.CATEGORY
            ? [{ label: t('Créer un salon'), icon: <PlusCircle size={16} />, onClick: () => openModal({ type: 'createChannel', serverId: ch.serverId!, parentId: ch.id }) }]
            : []),
          {
            label: ch.type === CH.CATEGORY ? t('Supprimer la catégorie') : t('Supprimer le salon'),
            icon: <Trash2 size={16} />,
            danger: true,
            onClick: () =>
              confirmDialog({
                title: ch.type === CH.CATEGORY ? t('Supprimer la catégorie') : t('Supprimer le salon'),
                body: t('Supprimer définitivement « {name} » ? Cette action est irréversible.', { name: ch.name }),
                confirmLabel: t('Supprimer'),
                danger: true,
                onConfirm: async () => {
                  await del(`/channels/${ch.id}`);
                  toast(t('« {name} » a été supprimé.', { name: ch.name }), 'success');
                },
              }),
          },
        ]
      : []),
    { separator: true },
    { label: t("Copier l'identifiant du salon"), icon: <Copy size={16} />, onClick: () => navigator.clipboard?.writeText(ch.id) },
  ]);
}

function ServerHeader({ serverId }: { serverId: string }) {
  const server = useStore((s) => s.servers[serverId]);
  const me = useStore((s) => s.me!);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  if (!server) return null;
  const perms = server.permissions;
  const canSettings = !!(perms & (P.MANAGE_SERVER | P.MANAGE_ROLES | P.MANAGE_CHANNELS | P.KICK_MEMBERS | P.BAN_MEMBERS | P.MANAGE_EMOJIS));
  const item = (icon: React.ReactNode, label: string, onClick: () => void, danger = false) => (
    <button
      className={`w-full flex items-center justify-between gap-2 px-2 py-2 rounded-md text-sm font-medium ${danger ? 'text-danger hover:bg-danger hover:text-white' : 'text-fg-2 hover:bg-accent hover:text-accent-fg'}`}
      onClick={() => {
        setOpen(false);
        onClick();
      }}
    >
      {label} {icon}
    </button>
  );
  return (
    <div className="relative" ref={ref}>
      <button
        className="w-full h-12 px-4 flex items-center justify-between font-bold border-b border-line hover:bg-bg-3/60 transition-colors"
        onClick={() => setOpen(!open)}
        style={server.banner ? { backgroundImage: `url(${server.banner})`, backgroundSize: 'cover' } : undefined}
      >
        <span className="truncate">{server.name}</span>
        {open ? <X size={18} /> : <ChevronDown size={18} />}
      </button>
      {open && (
        <div className="absolute left-2 right-2 top-14 z-30 bg-float rounded-lg p-1.5 border border-line anim-pop" style={{ boxShadow: 'var(--shadow)' }}>
          {has(perms, P.CREATE_INVITE) && item(<UserPlus size={16} />, t('Inviter des gens'), () => openModal({ type: 'invite', serverId }))}
          {canSettings && item(<Settings size={16} />, t('Paramètres du serveur'), () => openModal({ type: 'serverSettings', serverId }))}
          {has(perms, P.MANAGE_CHANNELS) && item(<PlusCircle size={16} />, t('Créer un salon'), () => openModal({ type: 'createChannel', serverId }))}
          {has(perms, P.MANAGE_CHANNELS) && item(<FolderPlus size={16} />, t('Créer une catégorie'), () => openModal({ type: 'createChannel', serverId, channelType: CH.CATEGORY }))}
          {item(<CalendarDays size={16} />, t('Événements'), () => openModal({ type: 'events', serverId }))}
          {has(perms, P.MANAGE_EMOJIS) && item(<Smile size={16} />, t('Emojis et stickers'), () => openModal({ type: 'serverSettings', serverId, tab: 'emojis' }))}
          {item(<Pencil size={16} />, t('Modifier mon profil de serveur'), () => openModal({ type: 'serverSettings', serverId, tab: 'myprofile' }))}
          <div className="h-px bg-line my-1" />
          {server.ownerId !== me.id &&
            item(
              <LogOut size={16} />,
              t('Quitter le serveur'),
              () =>
                confirmDialog({
                  title: t('Quitter « {name} »', { name: server.name }),
                  body: t('Es-tu sûr de vouloir quitter {name} ? Tu ne pourras revenir qu’avec une nouvelle invitation.', { name: server.name }),
                  confirmLabel: t('Quitter le serveur'),
                  danger: true,
                  onConfirm: async () => {
                    await del(`/servers/${serverId}/members/@me`);
                  },
                }),
              true,
            )}
        </div>
      )}
    </div>
  );
}

function VoiceUser({ userId, serverId }: { userId: string; serverId: string }) {
  const vs = useStore((s) => s.voiceStates[userId]);
  const speaking = useStore((s) => !!s.speaking[userId]);
  const name = useStore((s) => displayName(s, userId, serverId));
  if (!vs) return null;
  return (
    <div
      className="flex items-center gap-2 pl-8 pr-2 py-1 rounded-md hover:bg-bg-3/70 cursor-pointer group"
      onClick={(e) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setState((s) => void (s.popout = { userId, serverId, x: r.right + 8, y: r.top }));
      }}
      onContextMenu={(e) => voiceUserMenu(e, userId, serverId)}
    >
      <Avatar userId={userId} size={22} speaking={speaking} />
      <span className={`text-sm truncate flex-1 ${speaking ? 'text-fg' : 'text-fg-2'}`}>{name}</span>
      {vs.screen && <span className="text-[10px] font-bold bg-danger text-white rounded px-1">{t('EN DIRECT')}</span>}
      {vs.video && <Video size={14} className="text-fg-3" />}
      {(vs.selfMute || vs.serverMute) && <MicOff size={14} className={vs.serverMute ? 'text-danger' : 'text-fg-3'} />}
      {vs.selfDeaf && <HeadphoneOff size={14} className="text-fg-3" />}
    </div>
  );
}

export function voiceUserMenu(e: React.MouseEvent, userId: string, serverId: string | null) {
  const s = S();
  const me = s.me!;
  const server = serverId ? s.servers[serverId] : undefined;
  const vol = voice.getUserVolume(userId);
  const vs = s.voiceStates[userId];
  openContextMenu(e, [
    { label: t('Profil'), onClick: () => openModal({ type: 'profile', userId, serverId }) },
    ...(userId !== me.id && s.voice.channelId && vs?.channelId === s.voice.channelId
      ? [
          { label: vol.muted ? t('Réactiver le son') : t('Rendre muet (pour moi)'), checked: vol.muted, onClick: () => voice.setUserVolume(userId, { muted: !vol.muted }) },
          { label: t('Volume : {v} %', { v: vol.volume }), submenu: [100, 75, 50, 25, 10].map((v) => ({ label: `${v} %`, checked: vol.volume === v, onClick: () => voice.setUserVolume(userId, { volume: v }) })) },
        ]
      : []),
    ...(server && has(server.permissions, P.MUTE_MEMBERS) && vs?.serverId === serverId
      ? [
          { separator: true },
          {
            label: vs.serverMute ? t('Réactiver le micro (serveur)') : t('Rendre muet (serveur)'),
            onClick: () => patch(`/servers/${serverId}/voice/${userId}`, { mute: !vs.serverMute }).catch((err) => toast(err.message, 'error')),
          },
          {
            label: t('Déconnecter du vocal'),
            danger: true,
            onClick: () => patch(`/servers/${serverId}/voice/${userId}`, { disconnect: true }).catch((err) => toast(err.message, 'error')),
          },
        ]
      : []),
  ]);
}

function ChannelItem({ ch, active, serverId }: { ch: Channel; active: boolean; serverId: string }) {
  const navigate = useNavigate();
  const unread = useStore((s) => isUnread(s, ch));
  const mentions = useStore((s) => mentionCount(s, ch.id));
  const members = useStore((s) => (isVoiceLike(ch.type) ? voiceMembers(s, ch.id).join(',') : ''));
  const live = useStore((s) => !!s.servers[serverId]?.events?.some((e) => e.channelId === ch.id && e.status === 2));
  const inThis = useStore((s) => s.voice.channelId === ch.id);
  const server = useStore((s) => s.servers[serverId]);
  const isPrivate = !!ch.overwrites?.some((o) => o.id === server?.roles.find((r) => r.isDefault)?.id && o.deny & P.VIEW_CHANNEL);
  const Icon = ch.type === CH.STAGE ? Radio : ch.type === CH.VOICE ? Volume2 : Hash;
  const canManage = has(ch.permissions, P.MANAGE_CHANNELS);
  const memberIds = members ? members.split(',') : [];
  return (
    <div>
      <div
        className={`group relative mx-2 px-2 h-8 flex items-center gap-1.5 rounded-md cursor-pointer select-none transition-colors ${
          active ? 'channel-active text-fg' : unread ? 'text-fg hover:bg-bg-3' : 'text-fg-3 hover:bg-bg-3 hover:text-fg-2'
        }`}
        onClick={() => {
          if (ch.type === CH.VOICE) {
            if (!inThis) voice.join(ch.id, serverId);
            navigate(`/channels/${serverId}/${ch.id}`);
          } else if (ch.type === CH.STAGE) {
            navigate(`/channels/${serverId}/${ch.id}`);
          } else navigate(`/channels/${serverId}/${ch.id}`);
        }}
        onContextMenu={(e) => channelMenu(e, ch)}
      >
        {unread && !active && <span className="absolute left-0 w-1 h-2 rounded-r-full bg-fg" />}
        <span className="relative shrink-0">
          <Icon size={18} className={inThis ? 'text-success' : ''} />
          {isPrivate && <Lock size={9} strokeWidth={3} className="absolute -right-1 -bottom-0.5 bg-bg-1 rounded-full" />}
        </span>
        <span className={`truncate flex-1 text-[15px] ${unread && !active ? 'font-semibold' : 'font-medium'}`}>{ch.name}</span>
        {live && <span className="text-[9px] font-extrabold bg-danger text-white rounded px-1 py-px tracking-wider">{t('LIVE')}</span>}
        {ch.type === CH.VOICE && ch.userLimit > 0 && (
          <span className="text-[11px] text-fg-3 bg-bg-0 rounded px-1">
            {memberIds.length}/{ch.userLimit}
          </span>
        )}
        {mentions > 0 && !active && <span className="min-w-4 h-4 px-1 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center">{mentions}</span>}
        {has(server?.permissions, P.CREATE_INVITE) && (
          <button
            className="opacity-0 group-hover:opacity-100 text-fg-3 hover:text-fg"
            title={t('Créer une invitation')}
            onClick={(e) => {
              e.stopPropagation();
              openModal({ type: 'invite', serverId });
            }}
          >
            <UserPlus size={15} />
          </button>
        )}
        {canManage && (
          <button
            className="opacity-0 group-hover:opacity-100 text-fg-3 hover:text-fg"
            title={t('Modifier le salon')}
            onClick={(e) => {
              e.stopPropagation();
              openModal({ type: 'channelSettings', channelId: ch.id });
            }}
          >
            <Settings size={15} />
          </button>
        )}
      </div>
      {isVoiceLike(ch.type) && memberIds.length > 0 && (
        <div className="py-0.5">
          {memberIds.map((id) => (
            <VoiceUser key={id} userId={id} serverId={serverId} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ChannelSidebar({ serverId, channelId }: { serverId: string; channelId: string | null }) {
  const server = useStore((s) => s.servers[serverId]);
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  if (!server) return <div className="flex-1" />;
  const { uncategorized, categories } = sortedChannels(server);
  const toggle = (id: string) => {
    const next = { ...collapsed, [id]: !collapsed[id] };
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
    } catch {
      /* ignoré */
    }
  };
  const canCreate = has(server.permissions, P.MANAGE_CHANNELS);
  return (
    <>
      <ServerHeader serverId={serverId} />
      <EventsEntry serverId={serverId} />
      <div className="flex-1 overflow-y-auto scroll-thin py-3 relative">
        {server.description && <p className="px-4 pb-2 text-xs text-fg-3 line-clamp-3">{server.description}</p>}
        {uncategorized.map((ch) => (
          <ChannelItem key={ch.id} ch={ch} active={ch.id === channelId} serverId={serverId} />
        ))}
        {categories.map(({ category, channels }) => {
          const isCollapsed = collapsed[category.id];
          return (
            <div key={category.id} className="mt-4">
              <div className="group flex items-center pr-2 pl-1 mb-1" onContextMenu={(e) => channelMenu(e, category)}>
                <button className="flex items-center gap-0.5 flex-1 text-xs font-bold uppercase tracking-wide text-fg-3 hover:text-fg-2 truncate" onClick={() => toggle(category.id)}>
                  {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  <span className="truncate">{category.name}</span>
                </button>
                {canCreate && (
                  <button className="text-fg-3 hover:text-fg" title={t('Créer un salon')} onClick={() => openModal({ type: 'createChannel', serverId, parentId: category.id })}>
                    <Plus size={16} />
                  </button>
                )}
              </div>
              {channels
                .filter((ch) => !isCollapsed || ch.id === channelId || (isVoiceLike(ch.type) && S().voice.channelId === ch.id))
                .map((ch) => (
                  <ChannelItem key={ch.id} ch={ch} active={ch.id === channelId} serverId={serverId} />
                ))}
            </div>
          );
        })}
        {!uncategorized.length && !categories.length && (
          <div className="px-4 text-sm text-fg-3">{t("Aucun salon visible pour l'instant.")}</div>
        )}
      </div>
    </>
  );
}

