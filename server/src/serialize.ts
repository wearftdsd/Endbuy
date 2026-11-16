import type { Queryable } from './db.js';
import { limitsFor, NITRO_NAME } from './nitro.js';
import type { ChannelRow, RoleRow } from './permissions.js';

export const USER_SELECT = `SELECT u.*, s.plan AS premium_plan, s.granted_at AS premium_since
  FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id`;

export interface UserRow {
  id: string;
  username: string;
  display_name: string | null;
  password_hash: string;
  avatar: string | null;
  avatar_preset: number;
  banner: string | null;
  banner_color: string | null;
  accent_color: string | null;
  profile_theme: { primary?: string; secondary?: string } | null;
  bio: string;
  pronouns: string;
  status: string;
  custom_status: string;
  custom_status_emoji: string | null;
  totp_secret: string | null;
  totp_pending_secret: string | null;
  totp_enabled: boolean;
  totp_last_step: number;
  settings: Record<string, unknown>;
  failed_logins: number;
  locked_until: Date | null;
  created_at: Date;
  premium_plan: string | null;
  premium_since: Date | null;
}

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

export function publicUser(u: UserRow) {
  const premium = u.premium_plan ? { plan: u.premium_plan, name: NITRO_NAME, since: iso(u.premium_since) } : null;
  const badges: string[] = [];
  if (premium) badges.push('nitro');
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name || u.username,
    avatar: u.avatar,
    avatarPreset: u.avatar_preset,
    banner: u.banner,
    bannerColor: u.banner_color,
    accentColor: u.accent_color,
    profileTheme: u.profile_theme,
    bio: u.bio,
    pronouns: u.pronouns,
    premium,
    badges,
    createdAt: iso(u.created_at),
  };
}
export type PublicUser = ReturnType<typeof publicUser>;

export const DEFAULT_SETTINGS = {
  locale: 'fr',
  theme: 'dark',
  accent: '#00C2A8',
  fontScale: 100,
  compact: false,
  reducedMotion: false,
  dmPrivacy: 'everyone', // everyone | friends | none
  friendRequests: 'everyone', // everyone | mutual | none
  notifications: { desktop: true, sounds: true, mentionsOnly: false, dmNotifications: true },
  showActivity: true,
  motion: true,
};

export function selfUser(u: UserRow) {
  const premium = u.premium_plan ? { plan: u.premium_plan } : null;
  return {
    ...publicUser(u),
    status: u.status,
    customStatus: u.custom_status,
    customStatusEmoji: u.custom_status_emoji,
    totpEnabled: u.totp_enabled,
    settings: { ...DEFAULT_SETTINGS, ...(u.settings || {}) },
    limits: limitsFor(premium),
  };
}

export async function getUserRow(q: Queryable, id: string) {
  return q.one<UserRow>(`${USER_SELECT} WHERE u.id = $1`, [id]);
}

export async function getUsersByIds(q: Queryable, ids: string[]) {
  if (!ids.length) return [];
  return q.query<UserRow>(`${USER_SELECT} WHERE u.id = ANY($1::text[])`, [ids]);
}

export function serializeRole(r: RoleRow) {
  return {
    id: r.id,
    name: r.name,
    color: r.color,
    permissions: r.permissions,
    position: r.position,
    hoist: r.hoist,
    mentionable: r.mentionable,
    isDefault: r.is_default,
  };
}

export function serializeChannelBase(c: ChannelRow) {
  return {
    id: c.id,
    serverId: c.server_id,
    type: c.type,
    name: c.name,
    topic: c.topic,
    parentId: c.parent_id,
    position: c.position,
    userLimit: c.user_limit,
    lastMessageId: c.last_message_id,
    ownerId: c.owner_id,
    icon: c.icon,
  };
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */
export interface MessageRow {
  id: string;
  channel_id: string;
  author_id: string | null;
  content: string;
  type: number;
  reply_to_id: string | null;
  sticker_id: string | null;
  mentions: string[];
  mention_everyone: boolean;
  embeds: unknown[];
  pinned: boolean;
  edited_at: Date | null;
  created_at: Date;
}

export async function hydrateMessages(q: Queryable, rows: MessageRow[]) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const replyIds = [...new Set(rows.map((r) => r.reply_to_id).filter(Boolean))] as string[];
  const stickerIds = [...new Set(rows.map((r) => r.sticker_id).filter(Boolean))] as string[];
  const [attachments, reactions, replies, stickers] = await Promise.all([
    q.query<{ id: string; message_id: string; filename: string; path: string; size: number; content_type: string }>(
      'SELECT * FROM attachments WHERE message_id = ANY($1::text[]) ORDER BY id',
      [ids],
    ),
    q.query<{ message_id: string; user_id: string; emoji: string }>(
      'SELECT message_id, user_id, emoji FROM reactions WHERE message_id = ANY($1::text[]) ORDER BY created_at',
      [ids],
    ),
    replyIds.length
      ? q.query<MessageRow>('SELECT * FROM messages WHERE id = ANY($1::text[])', [replyIds])
      : Promise.resolve([] as MessageRow[]),
    stickerIds.length
      ? q.query<{ id: string; name: string; path: string; animated: boolean; server_id: string }>(
          'SELECT id, name, path, animated, server_id FROM emojis WHERE id = ANY($1::text[])',
          [stickerIds],
        )
      : Promise.resolve([]),
  ]);
  const authorIds = new Set<string>();
  for (const r of rows) if (r.author_id) authorIds.add(r.author_id);
  for (const r of replies) if (r.author_id) authorIds.add(r.author_id);
  const authors = new Map((await getUsersByIds(q, [...authorIds])).map((u) => [u.id, publicUser(u)]));
  const replyMap = new Map(replies.map((r) => [r.id, r]));
  const stickerMap = new Map(stickers.map((s) => [s.id, s]));

  return rows.map((r) => {
    const reactMap = new Map<string, string[]>();
    for (const re of reactions) {
      if (re.message_id !== r.id) continue;
      const list = reactMap.get(re.emoji) ?? [];
      list.push(re.user_id);
      reactMap.set(re.emoji, list);
    }
    const reply = r.reply_to_id ? replyMap.get(r.reply_to_id) : undefined;
    const sticker = r.sticker_id ? stickerMap.get(r.sticker_id) : undefined;
    return {
      id: r.id,
      channelId: r.channel_id,
      author: r.author_id ? authors.get(r.author_id) ?? null : null,
      content: r.content,
      type: r.type,
      replyToId: r.reply_to_id,
      replyTo: reply
        ? {
            id: reply.id,
            content: reply.content.slice(0, 200),
            author: reply.author_id ? authors.get(reply.author_id) ?? null : null,
            hasAttachments: false,
          }
        : null,
      sticker: sticker ? { id: sticker.id, name: sticker.name, url: sticker.path, animated: sticker.animated } : null,
      attachments: attachments
        .filter((a) => a.message_id === r.id)
        .map((a) => ({ id: a.id, filename: a.filename, url: a.path, size: Number(a.size), contentType: a.content_type })),
      reactions: [...reactMap.entries()].map(([emoji, userIds]) => ({ emoji, count: userIds.length, userIds })),
      embeds: r.embeds ?? [],
      pinned: r.pinned,
      mentions: r.mentions ?? [],
      mentionEveryone: r.mention_everyone,
      editedAt: iso(r.edited_at),
      createdAt: iso(r.created_at),
    };
  });
}
export type MessageDTO = Awaited<ReturnType<typeof hydrateMessages>>[number];
