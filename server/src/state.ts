import type { AppCtx } from './context.js';
import { loadEvents } from './events.js';
import {
  basePermissions,
  CH,
  channelPermissions,
  P,
  type ChannelRow,
  type ServerPermContext,
} from './permissions.js';
import {
  getUserRow,
  getUsersByIds,
  publicUser,
  selfUser,
  serializeChannelBase,
  serializeRole,
  type PublicUser,
} from './serialize.js';

interface ServerRow {
  id: string;
  name: string;
  icon: string | null;
  banner: string | null;
  description: string;
  owner_id: string;
  created_at: Date;
}

/** Données partagées d'un serveur, à partir desquelles on construit la vue de chaque membre. */
export async function loadServerData(app: AppCtx, serverId: string) {
  const ctx = await app.perms.get(serverId);
  if (!ctx) return null;
  const [server, members, emojis, events] = await Promise.all([
    app.db.one<ServerRow>('SELECT * FROM servers WHERE id = $1', [serverId]),
    app.db.query<{ user_id: string; nickname: string | null; joined_at: Date }>(
      'SELECT user_id, nickname, joined_at FROM members WHERE server_id = $1 ORDER BY joined_at',
      [serverId],
    ),
    app.db.query<{ id: string; name: string; kind: string; path: string; animated: boolean }>(
      'SELECT id, name, kind, path, animated FROM emojis WHERE server_id = $1 ORDER BY created_at',
      [serverId],
    ),
    loadEvents(app.db, serverId),
  ]);
  if (!server) return null;
  const users = (await getUsersByIds(app.db, members.map((m) => m.user_id))).map(publicUser);
  return { ctx, server, members, emojis, users, events };
}
export type ServerData = NonNullable<Awaited<ReturnType<typeof loadServerData>>>;

function visibleChannels(ctx: ServerPermContext, userId: string) {
  const out: { channel: ChannelRow; perms: number }[] = [];
  const childVisible = new Set<string>();
  const permsById = new Map<string, number>();
  for (const c of ctx.channels) {
    if (c.type === CH.CATEGORY) continue;
    const perms = channelPermissions(ctx, userId, c);
    permsById.set(c.id, perms);
    if (perms & P.VIEW_CHANNEL && c.parent_id) childVisible.add(c.parent_id);
  }
  for (const c of ctx.channels) {
    let perms: number;
    if (c.type === CH.CATEGORY) {
      perms = channelPermissions(ctx, userId, c);
      const base = basePermissions(ctx, userId);
      // Une catégorie est visible si elle l'est elle-même, ou si l'un de ses salons l'est,
      // ou si l'utilisateur peut gérer les salons.
      if (!(perms & P.VIEW_CHANNEL) && !childVisible.has(c.id) && !(base & P.MANAGE_CHANNELS)) continue;
      if (!perms) perms = P.VIEW_CHANNEL;
    } else {
      perms = permsById.get(c.id) ?? 0;
      if (!(perms & P.VIEW_CHANNEL)) continue;
    }
    out.push({ channel: c, perms });
  }
  return out;
}

export function serverSnapshot(data: ServerData, userId: string) {
  const { ctx, server, members, emojis, events } = data;
  const base = basePermissions(ctx, userId);
  const canSeeOverwrites = !!(base & (P.MANAGE_ROLES | P.MANAGE_CHANNELS));
  const visible = visibleChannels(ctx, userId);
  const visibleIds = new Set(visible.map((v) => v.channel.id));
  return {
    id: server.id,
    name: server.name,
    icon: server.icon,
    banner: server.banner,
    description: server.description,
    ownerId: server.owner_id,
    createdAt: new Date(server.created_at).toISOString(),
    permissions: base,
    roles: ctx.roles.map(serializeRole),
    channels: visible.map(({ channel, perms }) => ({
      ...serializeChannelBase(channel),
      permissions: perms,
      overwrites: canSeeOverwrites
        ? (ctx.overwrites.get(channel.id) ?? []).map((o) => ({
            id: o.target_id,
            type: o.target_type,
            allow: o.allow,
            deny: o.deny,
          }))
        : [],
    })),
    members: members.map((m) => ({
      userId: m.user_id,
      nickname: m.nickname,
      roles: ctx.memberRoles.get(m.user_id) ?? [],
      joinedAt: new Date(m.joined_at).toISOString(),
    })),
    emojis: emojis.map((e) => ({ id: e.id, name: e.name, kind: e.kind, url: e.path, animated: e.animated })),
    events: events.filter((e) => !e.channelId || visibleIds.has(e.channelId)),
  };
}

export async function privateChannelsFor(app: AppCtx, userId: string) {
  const channels = await app.db.query<ChannelRow & { closed: boolean }>(
    `SELECT c.*, cr.closed FROM channels c JOIN channel_recipients cr ON cr.channel_id = c.id
     WHERE cr.user_id = $1 ORDER BY COALESCE(c.last_message_id, c.id) DESC`,
    [userId],
  );
  if (!channels.length) return { channels: [], userIds: [] as string[] };
  const recips = await app.db.query<{ channel_id: string; user_id: string }>(
    'SELECT channel_id, user_id FROM channel_recipients WHERE channel_id = ANY($1::text[])',
    [channels.map((c) => c.id)],
  );
  const userIds = new Set<string>();
  const out = channels.map((c) => {
    const recipients = recips.filter((r) => r.channel_id === c.id && r.user_id !== userId).map((r) => r.user_id);
    recipients.forEach((id) => userIds.add(id));
    return { ...serializeChannelBase(c), recipients, closed: c.closed };
  });
  return { channels: out, userIds: [...userIds] };
}

export async function privateChannelPayload(app: AppCtx, channelId: string, forUserId: string) {
  const c = await app.db.one<ChannelRow>('SELECT * FROM channels WHERE id = $1', [channelId]);
  if (!c) return null;
  const recips = await app.db.query<{ user_id: string; closed: boolean }>(
    'SELECT user_id, closed FROM channel_recipients WHERE channel_id = $1',
    [channelId],
  );
  return {
    ...serializeChannelBase(c),
    recipients: recips.filter((r) => r.user_id !== forUserId).map((r) => r.user_id),
    closed: recips.find((r) => r.user_id === forUserId)?.closed ?? false,
  };
}

export async function buildReady(app: AppCtx, userId: string, sessionId: string) {
  const me = await getUserRow(app.db, userId);
  if (!me) return null;
  const serverIds = (
    await app.db.query<{ server_id: string }>('SELECT server_id FROM members WHERE user_id = $1 ORDER BY joined_at', [userId])
  ).map((r) => r.server_id);

  const users = new Map<string, PublicUser>();
  const servers = [];
  for (const sid of serverIds) {
    const data = await loadServerData(app, sid);
    if (!data) continue;
    for (const u of data.users) users.set(u.id, u);
    servers.push(serverSnapshot(data, userId));
  }

  const priv = await privateChannelsFor(app, userId);
  const relationships = await app.db.query<{ target_id: string; type: number; created_at: Date }>(
    'SELECT target_id, type, created_at FROM relationships WHERE user_id = $1',
    [userId],
  );
  const missing = [...new Set([...priv.userIds, ...relationships.map((r) => r.target_id)])].filter((id) => !users.has(id));
  for (const u of await getUsersByIds(app.db, missing)) users.set(u.id, publicUser(u));

  const readStates = await app.db.query<{ channel_id: string; last_read_id: string | null; mention_count: number }>(
    'SELECT channel_id, last_read_id, mention_count FROM read_states WHERE user_id = $1',
    [userId],
  );

  const presences: Record<string, unknown> = {};
  for (const id of users.keys()) presences[id] = app.gw.presenceOf(id);

  const channelIds = new Set<string>([
    ...servers.flatMap((s) => s.channels.map((c) => c.id)),
    ...priv.channels.map((c) => c.id),
  ]);
  const voiceStates = app.gw.voiceStatesFor(channelIds);

  return {
    user: selfUser(me),
    sessionId,
    servers,
    users: [...users.values()],
    presences,
    privateChannels: priv.channels,
    relationships: relationships.map((r) => ({
      id: r.target_id,
      type: r.type,
      since: new Date(r.created_at).toISOString(),
    })),
    readStates: Object.fromEntries(
      readStates.map((r) => [r.channel_id, { lastReadId: r.last_read_id, mentionCount: r.mention_count }]),
    ),
    voiceStates,
    rtc: { iceServers: app.opts.iceServers },
  };
}
