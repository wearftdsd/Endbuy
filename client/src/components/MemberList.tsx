import { Crown } from 'lucide-react';
import { del, patch, post, put } from '../lib/api';
import { t } from '../lib/i18n';
import { has, P } from '../lib/perms';
import {
  confirmDialog,
  displayName,
  memberColor,
  memberOf,
  openContextMenu,
  openModal,
  presenceOf,
  S,
  setState,
  toast,
  useStore,
  type MenuItem,
  type State,
} from '../lib/store';
import type { Channel, Server } from '../lib/types';
import { Avatar } from './ui';

export async function openDM(userId: string) {
  try {
    const ch = await post<Channel>('/users/@me/channels', { recipientId: userId });
    setState((s) => void (s.privateChannels[ch.id] = { ...ch, closed: false }));
    window.dispatchEvent(new CustomEvent('endbuy:navigate', { detail: `/channels/@me/${ch.id}` }));
  } catch (e) {
    toast((e as Error).message, 'error');
  }
}

function highestPosition(server: Server, userId: string) {
  if (server.ownerId === userId) return Infinity;
  const m = memberOf(server, userId);
  return Math.max(0, ...(m?.roles ?? []).map((rid) => server.roles.find((r) => r.id === rid)?.position ?? 0));
}

export function memberMenu(e: React.MouseEvent, userId: string, serverId: string | null) {
  const s = S();
  const me = s.me!;
  const server = serverId ? s.servers[serverId] : undefined;
  const member = memberOf(server, userId);
  const rel = s.relationships[userId];
  const items: MenuItem[] = [
    { label: t('Profil'), onClick: () => openModal({ type: 'profile', userId, serverId }) },
  ];
  if (userId !== me.id) {
    items.push({ label: t('Envoyer un message'), onClick: () => openDM(userId) });
    if (!rel || rel.type === 3) items.push({ label: rel?.type === 3 ? t('Accepter la demande d’ami') : t('Ajouter en ami'), onClick: () => (rel?.type === 3 ? put(`/users/@me/relationships/${userId}`, { type: 1 }) : post('/users/@me/relationships', { username: s.users[userId]?.username })).then(() => toast(t('Demande envoyée.'), 'success')).catch((err) => toast(err.message, 'error')) });
    if (rel?.type === 1) items.push({ label: t('Retirer des amis'), onClick: () => del(`/users/@me/relationships/${userId}`) });
  }
  if (server && member) {
    const myTop = highestPosition(server, me.id);
    const above = server.ownerId === me.id || myTop > highestPosition(server, userId);
    const roles = server.roles.filter((r) => !r.isDefault).sort((a, b) => b.position - a.position);
    items.push({ separator: true });
    if ((userId === me.id && has(server.permissions, P.CHANGE_NICKNAME)) || (has(server.permissions, P.MANAGE_NICKNAMES) && above)) {
      items.push({
        label: userId === me.id ? t('Changer de pseudo') : t('Changer le pseudo'),
        onClick: () =>
          confirmDialog({
            title: t('Changer le pseudo'),
            body: t('Le pseudo n’est visible que sur ce serveur. Laisse vide pour le retirer.'),
            input: { label: t('Pseudo'), placeholder: displayName(S(), userId) },
            confirmLabel: t('Enregistrer'),
            onConfirm: async (v) => {
              await patch(`/servers/${serverId}/members/${userId}`, { nickname: v ?? '' });
            },
          }),
      });
    }
    if (has(server.permissions, P.MANAGE_ROLES) && (above || userId === me.id) && roles.length) {
      items.push({
        label: t('Rôles'),
        submenu: roles.map((r) => ({
          label: r.name,
          checked: member.roles.includes(r.id),
          disabled: !(server.ownerId === me.id || r.position < myTop),
          onClick: () => {
            const next = member.roles.includes(r.id) ? member.roles.filter((x) => x !== r.id) : [...member.roles, r.id];
            patch(`/servers/${serverId}/members/${userId}`, { roles: next }).catch((err) => toast(err.message, 'error'));
          },
        })),
      });
    }
    if (userId !== me.id && above) {
      if (has(server.permissions, P.KICK_MEMBERS))
        items.push({
          label: t('Expulser {name}', { name: displayName(s, userId, serverId) }),
          danger: true,
          onClick: () =>
            confirmDialog({
              title: t('Expulser {name}', { name: displayName(S(), userId, serverId) }),
              body: t('Ce membre pourra revenir avec une nouvelle invitation.'),
              confirmLabel: t('Expulser'),
              danger: true,
              onConfirm: async () => {
                await del(`/servers/${serverId}/members/${userId}`);
                toast(t('Membre expulsé.'), 'success');
              },
            }),
        });
      if (has(server.permissions, P.BAN_MEMBERS))
        items.push({
          label: t('Bannir {name}', { name: displayName(s, userId, serverId) }),
          danger: true,
          onClick: () =>
            confirmDialog({
              title: t('Bannir {name}', { name: displayName(S(), userId, serverId) }),
              body: t('Ce membre sera retiré et ne pourra plus revenir. Ses messages des dernières 24 h seront supprimés.'),
              input: { label: t('Raison (facultatif)') },
              confirmLabel: t('Bannir'),
              danger: true,
              onConfirm: async (reason) => {
                await put(`/servers/${serverId}/bans/${userId}`, { reason, deleteMessages: true });
                toast(t('Membre banni.'), 'success');
              },
            }),
        });
    }
  }
  items.push({ separator: true }, { label: t("Copier l'identifiant utilisateur"), onClick: () => navigator.clipboard?.writeText(userId) });
  openContextMenu(e, items);
}

function MemberRow({ userId, serverId, offline }: { userId: string; serverId: string | null; offline?: boolean }) {
  const name = useStore((s) => displayName(s, userId, serverId));
  const color = useStore((s) => memberColor(s, serverId, userId));
  const presence = useStore((s) => presenceOf(s, userId));
  const isOwner = useStore((s) => (serverId ? s.servers[serverId]?.ownerId === userId : false));
  const speaking = useStore((s) => !!s.speaking[userId]);
  return (
    <button
      className={`w-full flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-bg-3 text-left ${offline ? 'opacity-40 hover:opacity-100' : ''}`}
      onClick={(e) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setState((s) => void (s.popout = { userId, serverId, x: r.left - 312, y: r.top }));
      }}
      onContextMenu={(e) => memberMenu(e, userId, serverId)}
    >
      <Avatar userId={userId} size={32} showStatus speaking={speaking} ring="var(--bg-1)" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-[15px] font-medium truncate" style={{ color }}>
          <span className="truncate">{name}</span>
          {isOwner && <Crown size={13} className="text-warn shrink-0" />}
        </div>
        {presence.customStatus && !offline && (
          <div className="text-xs text-fg-3 truncate">
            {presence.customStatusEmoji} {presence.customStatus}
          </div>
        )}
      </div>
    </button>
  );
}

function groupMembers(s: State, channel: Channel) {
  if (!channel.serverId) {
    const ids = [...(channel.recipients ?? []), s.me!.id];
    const online = ids.filter((id) => presenceOf(s, id).status !== 'offline');
    const offline = ids.filter((id) => presenceOf(s, id).status === 'offline');
    return [
      { title: t('En ligne'), ids: online, offline: false },
      { title: t('Hors ligne'), ids: offline, offline: true },
    ];
  }
  const server = s.servers[channel.serverId];
  if (!server) return [];
  const hoisted = server.roles.filter((r) => r.hoist && !r.isDefault).sort((a, b) => b.position - a.position);
  const groups = new Map<string, string[]>();
  const online: string[] = [];
  const offline: string[] = [];
  for (const m of server.members) {
    const st = presenceOf(s, m.userId).status;
    if (st === 'offline') {
      offline.push(m.userId);
      continue;
    }
    const role = hoisted.find((r) => m.roles.includes(r.id));
    if (role) groups.set(role.id, [...(groups.get(role.id) ?? []), m.userId]);
    else online.push(m.userId);
  }
  const byName = (a: string, b: string) => displayName(s, a, server.id).localeCompare(displayName(s, b, server.id));
  return [
    ...hoisted.filter((r) => groups.get(r.id)?.length).map((r) => ({ title: r.name, ids: groups.get(r.id)!.sort(byName), offline: false })),
    { title: t('En ligne'), ids: online.sort(byName), offline: false },
    { title: t('Hors ligne'), ids: offline.sort(byName), offline: true },
  ];
}

export function MemberList({ channel }: { channel: Channel }) {
  const groupsKey = useStore((s) => JSON.stringify(groupMembers(s, channel)));
  const groups = JSON.parse(groupsKey) as { title: string; ids: string[]; offline: boolean }[];
  return (
    <aside className="w-60 shrink-0 bg-bg-1 overflow-y-auto scroll-thin px-2 pb-4 hidden lg:block anim-fade">
      {groups
        .filter((g) => g.ids.length)
        .map((g) => (
          <div key={g.title}>
            <div className="text-xs font-bold uppercase tracking-wide text-fg-3 px-2 pt-6 pb-1">
              {g.title} — {g.ids.length}
            </div>
            {g.ids.map((id) => (
              <MemberRow key={id} userId={id} serverId={channel.serverId} offline={g.offline} />
            ))}
          </div>
        ))}
    </aside>
  );
}

