import type { Queryable } from './db.js';
import { HttpError } from './util.js';

/** Bits de permission endBuy (stockés dans une colonne INT). */
export const P = {
  CREATE_INVITE: 1 << 0,
  KICK_MEMBERS: 1 << 1,
  BAN_MEMBERS: 1 << 2,
  ADMINISTRATOR: 1 << 3,
  MANAGE_CHANNELS: 1 << 4,
  MANAGE_SERVER: 1 << 5,
  ADD_REACTIONS: 1 << 6,
  VIEW_CHANNEL: 1 << 7,
  SEND_MESSAGES: 1 << 8,
  MANAGE_MESSAGES: 1 << 9,
  ATTACH_FILES: 1 << 10,
  EMBED_LINKS: 1 << 11,
  READ_HISTORY: 1 << 12,
  MENTION_EVERYONE: 1 << 13,
  CONNECT: 1 << 14,
  SPEAK: 1 << 15,
  VIDEO: 1 << 16,
  MUTE_MEMBERS: 1 << 17,
  MANAGE_ROLES: 1 << 18,
  MANAGE_EMOJIS: 1 << 19,
  CHANGE_NICKNAME: 1 << 20,
  MANAGE_NICKNAMES: 1 << 21,
  REQUEST_TO_SPEAK: 1 << 22,
  MANAGE_EVENTS: 1 << 23,
} as const;

export const ALL_PERMISSIONS = Object.values(P).reduce((a, b) => a | b, 0);

export const DEFAULT_EVERYONE =
  P.VIEW_CHANNEL |
  P.SEND_MESSAGES |
  P.READ_HISTORY |
  P.ADD_REACTIONS |
  P.ATTACH_FILES |
  P.EMBED_LINKS |
  P.CONNECT |
  P.SPEAK |
  P.VIDEO |
  P.CREATE_INVITE |
  P.CHANGE_NICKNAME |
  P.REQUEST_TO_SPEAK;

export const MODERATOR_PERMS =
  DEFAULT_EVERYONE | P.KICK_MEMBERS | P.MANAGE_MESSAGES | P.MUTE_MEMBERS | P.MANAGE_NICKNAMES | P.MENTION_EVERYONE | P.MANAGE_EVENTS;

export interface RoleRow {
  id: string;
  server_id: string;
  name: string;
  color: string | null;
  permissions: number;
  position: number;
  hoist: boolean;
  mentionable: boolean;
  is_default: boolean;
}

export interface OverwriteRow {
  channel_id: string;
  target_id: string;
  target_type: 'role' | 'member';
  allow: number;
  deny: number;
}

export interface ChannelRow {
  id: string;
  server_id: string | null;
  type: number;
  name: string;
  topic: string;
  parent_id: string | null;
  position: number;
  owner_id: string | null;
  icon: string | null;
  user_limit: number;
  last_message_id: string | null;
  created_at: Date;
}

export const CH = { TEXT: 0, DM: 1, VOICE: 2, GROUP_DM: 3, CATEGORY: 4, STAGE: 5 } as const;
export const isVoiceLike = (type: number) => type === CH.VOICE || type === CH.STAGE;

/** Contexte complet de permissions d'un serveur (chargé en 4 requêtes). */
export interface ServerPermContext {
  serverId: string;
  ownerId: string;
  roles: RoleRow[];
  roleById: Map<string, RoleRow>;
  everyone: RoleRow;
  memberRoles: Map<string, string[]>; // userId → roleIds
  channels: ChannelRow[];
  overwrites: Map<string, OverwriteRow[]>; // channelId → overwrites
}

export async function loadPermContext(q: Queryable, serverId: string): Promise<ServerPermContext | null> {
  const server = await q.one<{ owner_id: string }>('SELECT owner_id FROM servers WHERE id = $1', [serverId]);
  if (!server) return null;
  const [roles, members, memberRoles, channels, overwrites] = await Promise.all([
    q.query<RoleRow>('SELECT * FROM roles WHERE server_id = $1 ORDER BY position ASC', [serverId]),
    q.query<{ user_id: string }>('SELECT user_id FROM members WHERE server_id = $1', [serverId]),
    q.query<{ user_id: string; role_id: string }>('SELECT user_id, role_id FROM member_roles WHERE server_id = $1', [serverId]),
    q.query<ChannelRow>('SELECT * FROM channels WHERE server_id = $1 ORDER BY position ASC, id ASC', [serverId]),
    q.query<OverwriteRow>(
      'SELECT o.* FROM permission_overwrites o JOIN channels c ON c.id = o.channel_id WHERE c.server_id = $1',
      [serverId],
    ),
  ]);
  const everyone = roles.find((r) => r.is_default);
  if (!everyone) return null;
  const mr = new Map<string, string[]>();
  for (const m of members) mr.set(m.user_id, []);
  for (const r of memberRoles) mr.get(r.user_id)?.push(r.role_id);
  const ow = new Map<string, OverwriteRow[]>();
  for (const o of overwrites) {
    const list = ow.get(o.channel_id) ?? [];
    list.push(o);
    ow.set(o.channel_id, list);
  }
  return {
    serverId,
    ownerId: server.owner_id,
    roles,
    roleById: new Map(roles.map((r) => [r.id, r])),
    everyone,
    memberRoles: mr,
    channels,
    overwrites: ow,
  };
}

export function isMember(ctx: ServerPermContext, userId: string) {
  return ctx.memberRoles.has(userId);
}

export function basePermissions(ctx: ServerPermContext, userId: string): number {
  if (!ctx.memberRoles.has(userId)) return 0;
  if (ctx.ownerId === userId) return ALL_PERMISSIONS;
  let perms = ctx.everyone.permissions;
  for (const rid of ctx.memberRoles.get(userId) ?? []) {
    const role = ctx.roleById.get(rid);
    if (role) perms |= role.permissions;
  }
  if (perms & P.ADMINISTRATOR) return ALL_PERMISSIONS;
  return perms;
}

/** Les salons sans permissions propres héritent de celles de leur catégorie (synchronisation). */
export function effectiveOverwrites(ctx: ServerPermContext, channel: ChannelRow): OverwriteRow[] {
  const own = ctx.overwrites.get(channel.id);
  if (own && own.length) return own;
  if (channel.parent_id) return ctx.overwrites.get(channel.parent_id) ?? [];
  return [];
}

export function channelPermissions(ctx: ServerPermContext, userId: string, channel: ChannelRow): number {
  const base = basePermissions(ctx, userId);
  if (base === 0) return 0;
  if (base & P.ADMINISTRATOR) return ALL_PERMISSIONS;
  let perms = base;
  const overwrites = effectiveOverwrites(ctx, channel);
  const everyoneOw = overwrites.find((o) => o.target_id === ctx.everyone.id);
  if (everyoneOw) {
    perms &= ~everyoneOw.deny;
    perms |= everyoneOw.allow;
  }
  const roleIds = new Set(ctx.memberRoles.get(userId) ?? []);
  let allow = 0;
  let deny = 0;
  for (const o of overwrites) {
    if (o.target_type === 'role' && roleIds.has(o.target_id)) {
      allow |= o.allow;
      deny |= o.deny;
    }
  }
  perms &= ~deny;
  perms |= allow;
  const memberOw = overwrites.find((o) => o.target_type === 'member' && o.target_id === userId);
  if (memberOw) {
    perms &= ~memberOw.deny;
    perms |= memberOw.allow;
  }
  if (!(perms & P.VIEW_CHANNEL)) return 0;
  return perms;
}

/** Position du rôle le plus élevé d'un membre (hiérarchie). Le propriétaire est au-dessus de tout. */
export function highestRolePosition(ctx: ServerPermContext, userId: string): number {
  if (ctx.ownerId === userId) return Number.MAX_SAFE_INTEGER;
  let max = 0;
  for (const rid of ctx.memberRoles.get(userId) ?? []) {
    const role = ctx.roleById.get(rid);
    if (role && role.position > max) max = role.position;
  }
  return max;
}

export function canActOn(ctx: ServerPermContext, actorId: string, targetId: string): boolean {
  if (targetId === ctx.ownerId) return false;
  if (actorId === ctx.ownerId) return true;
  return highestRolePosition(ctx, actorId) > highestRolePosition(ctx, targetId);
}

export function requirePerm(perms: number, bit: number, message = "Tu n'as pas la permission de faire cela.") {
  if ((perms & bit) !== bit) throw new HttpError(403, message, 'MISSING_PERMISSIONS');
}

/** Utilisateurs pouvant voir un salon de serveur. */
export function channelViewers(ctx: ServerPermContext, channel: ChannelRow): string[] {
  const out: string[] = [];
  for (const userId of ctx.memberRoles.keys()) {
    if (channelPermissions(ctx, userId, channel) & P.VIEW_CHANNEL) out.push(userId);
  }
  return out;
}
