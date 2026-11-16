import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Compass, LogOut, Pencil, Plus, Settings, UserPlus } from 'lucide-react';
import { del } from '../lib/api';
import { ackChannel } from '../lib/gateway';
import { t } from '../lib/i18n';
import { has, P } from '../lib/perms';
import { confirmDialog, isUnread, openContextMenu, openModal, S, serverUnread, setState, toast, useStore } from '../lib/store';
import { LogoMark, ServerIcon } from './ui';

function RailItem({
  active,
  unread,
  mentions,
  label,
  onClick,
  onContextMenu,
  children,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  green,
}: {
  active: boolean;
  unread?: boolean;
  mentions?: number;
  label: string;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  children: ReactNode;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  green?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      className="relative flex items-center justify-center w-full group"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <span
        className="server-pill absolute left-0 w-1 rounded-r-full bg-fg"
        style={{ height: active ? 40 : hover ? 20 : unread ? 8 : 0, opacity: active || hover || unread ? 1 : 0 }}
      />
      <button
        onClick={onClick}
        onContextMenu={onContextMenu}
        aria-label={label}
        data-tilt="16"
        data-magnetic="0.16"
        className={`server-icon ${active ? 'is-active' : ''} w-12 h-12 overflow-hidden flex items-center justify-center ${
          active ? 'rounded-2xl' : 'rounded-[24px] hover:rounded-2xl'
        } ${active ? (green ? 'bg-success text-white' : 'bg-accent text-accent-fg') : green ? 'bg-bg-3 text-success hover:bg-success hover:text-white' : 'bg-bg-3 text-fg hover:bg-accent hover:text-accent-fg'}`}
      >
        {children}
      </button>
      {!!mentions && (
        <span className="absolute bottom-0 right-2 min-w-5 h-5 px-1 rounded-full bg-danger text-white text-[11px] font-bold flex items-center justify-center ring-4 ring-bg-0">
          {mentions > 99 ? '99+' : mentions}
        </span>
      )}
      {hover && (
        <div className="absolute left-[68px] z-50 pointer-events-none anim-fade">
          <div className="bg-float text-fg text-sm font-semibold px-3 py-2 rounded-lg whitespace-nowrap border border-line" style={{ boxShadow: 'var(--shadow)' }}>
            {label}
          </div>
        </div>
      )}
    </div>
  );
}

export function ServerRail({ activeServerId }: { activeServerId: string | null }) {
  const navigate = useNavigate();
  const order = useStore((s) => s.serverOrder);
  const servers = useStore((s) => s.servers);
  const dmMentions = useStore((s) =>
    Object.values(s.privateChannels).reduce((n, c) => n + (s.readStates[c.id]?.mentionCount ?? 0), 0),
  );
  const pendingFriends = useStore((s) => Object.values(s.relationships).filter((r) => r.type === 3).length);
  const unreadState = useStore((s) => {
    const out: Record<string, { unread: boolean; mentions: number }> = {};
    for (const id of s.serverOrder) if (s.servers[id]) out[id] = serverUnread(s, s.servers[id]);
    return JSON.stringify(out);
  });
  const unread = JSON.parse(unreadState) as Record<string, { unread: boolean; mentions: number }>;
  const [dragId, setDragId] = useState<string | null>(null);

  const serverMenu = (e: React.MouseEvent, id: string) => {
    const sv = S().servers[id];
    const me = S().me!;
    if (!sv) return;
    openContextMenu(e, [
      {
        label: t('Marquer comme lu'),
        icon: <Bell size={16} />,
        onClick: () => sv.channels.filter((c) => isUnread(S(), c)).forEach((c) => ackChannel(c.id)),
      },
      { separator: true },
      { label: t('Inviter des gens'), icon: <UserPlus size={16} />, disabled: !has(sv.permissions, P.CREATE_INVITE), onClick: () => openModal({ type: 'invite', serverId: id }) },
      { label: t('Paramètres du serveur'), icon: <Settings size={16} />, disabled: !(sv.permissions & (P.MANAGE_SERVER | P.MANAGE_ROLES | P.MANAGE_CHANNELS | P.KICK_MEMBERS | P.BAN_MEMBERS | P.MANAGE_EMOJIS)), onClick: () => openModal({ type: 'serverSettings', serverId: id }) },
      { label: t('Modifier mon profil de serveur'), icon: <Pencil size={16} />, onClick: () => openModal({ type: 'serverSettings', serverId: id, tab: 'myprofile' }) },
      { separator: true },
      {
        label: t('Quitter le serveur'),
        icon: <LogOut size={16} />,
        danger: true,
        disabled: sv.ownerId === me.id,
        onClick: () =>
          confirmDialog({
            title: t('Quitter « {name} »', { name: sv.name }),
            body: t('Es-tu sûr de vouloir quitter {name} ? Tu ne pourras revenir qu’avec une nouvelle invitation.', { name: sv.name }),
            confirmLabel: t('Quitter le serveur'),
            danger: true,
            onConfirm: async () => {
              await del(`/servers/${id}/members/@me`);
              toast(t('Tu as quitté {name}.', { name: sv.name }));
            },
          }),
      },
      { separator: true },
      { label: t("Copier l'identifiant du serveur"), onClick: () => navigator.clipboard?.writeText(id) },
    ]);
  };

  const reorder = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    setState((s) => {
      const arr = s.serverOrder.filter((x) => x !== dragId);
      arr.splice(arr.indexOf(targetId), 0, dragId);
      s.serverOrder = arr;
      try {
        localStorage.setItem('endbuy.serverOrder', JSON.stringify(arr));
      } catch {
        /* ignoré */
      }
    });
    setDragId(null);
  };

  return (
    <div className="w-[72px] shrink-0 bg-bg-0 flex flex-col items-center py-3 gap-2 overflow-y-auto scroll-none">
      <RailItem active={!activeServerId} label={t('Messages privés')} mentions={dmMentions + pendingFriends} onClick={() => navigate('/channels/@me')}>
        <LogoMark size={30} mono={false} />
      </RailItem>
      <div className="w-8 h-0.5 rounded bg-bg-3 my-1" />
      {order.map((id) => {
        const sv = servers[id];
        if (!sv) return null;
        const u = unread[id] ?? { unread: false, mentions: 0 };
        return (
          <RailItem
            key={id}
            active={activeServerId === id}
            unread={u.unread}
            mentions={u.mentions}
            label={sv.name}
            onClick={() => navigate(`/channels/${id}`)}
            onContextMenu={(e) => serverMenu(e, id)}
            draggable
            onDragStart={() => setDragId(id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => reorder(id)}
          >
            <ServerIcon name={sv.name} icon={sv.icon} size={48} />
          </RailItem>
        );
      })}
      <RailItem active={false} label={t('Créer ou rejoindre un serveur')} onClick={() => openModal({ type: 'createServer' })} green>
        <Plus size={24} />
      </RailItem>
      <RailItem active={false} label={t('Rejoindre avec une invitation')} onClick={() => openModal({ type: 'createServer' })} green>
        <Compass size={22} />
      </RailItem>
    </div>
  );
}

