import { Router, type Request } from 'express';
import { requireAuth, uid } from '../auth.js';
import type { AppCtx } from '../context.js';
import { contentTypeFor, discardFiles, makeUpload, persistUpload, publicPath, removeUpload } from '../files.js';
import { extractUrls, previewsFor } from '../linkPreview.js';
import { getLimits, NITRO_LIMITS } from '../nitro.js';
import {
  ALL_PERMISSIONS,
  basePermissions,
  CH,
  channelPermissions,
  P,
  requirePerm,
  type ChannelRow,
  type ServerPermContext,
} from '../permissions.js';
import { getUsersByIds, hydrateMessages, publicUser, type MessageRow } from '../serialize.js';
import { privateChannelPayload } from '../state.js';
import { clampInt, ensure, HttpError, optStr, RateLimiter, rateLimitOrThrow, snowflake, str } from '../util.js';
import { channelName, searchMessages } from './servers.js';

const messageLimiter = new RateLimiter(10, 5_000);
const reactionLimiter = new RateLimiter(30, 10_000);

const DM_PERMS =
  P.VIEW_CHANNEL |
  P.SEND_MESSAGES |
  P.READ_HISTORY |
  P.ADD_REACTIONS |
  P.ATTACH_FILES |
  P.EMBED_LINKS |
  P.CONNECT |
  P.SPEAK |
  P.VIDEO;

interface Access {
  channel: ChannelRow;
  perms: number;
  ctx: ServerPermContext | null;
  recipients: string[];
}

export function channelRoutes(app: AppCtx) {
  const r = Router();
  r.use(requireAuth);

  async function access(req: Request, channelId: string): Promise<Access & { userId: string }> {
    const userId = uid(req);
    const channel = await app.db.one<ChannelRow>('SELECT * FROM channels WHERE id = $1', [channelId]);
    const notFound = new HttpError(404, 'Salon introuvable.', 'UNKNOWN_CHANNEL');
    if (!channel) throw notFound;
    if (channel.server_id) {
      const ctx = await app.perms.get(channel.server_id);
      if (!ctx || !ctx.memberRoles.has(userId)) throw notFound;
      const perms = channelPermissions(ctx, userId, channel);
      if (!(perms & P.VIEW_CHANNEL)) throw notFound;
      return { channel, perms, ctx, recipients: [], userId };
    }
    const recips = await app.db.query<{ user_id: string }>('SELECT user_id FROM channel_recipients WHERE channel_id = $1', [channelId]);
    const ids = recips.map((x) => x.user_id);
    if (!ids.includes(userId)) throw notFound;
    return { channel, perms: DM_PERMS, ctx: null, recipients: ids, userId };
  }

  async function dmBlocked(a: Access, userId: string) {
    if (a.channel.type !== CH.DM) return false;
    const other = a.recipients.find((id) => id !== userId);
    if (!other) return false;
    const row = await app.db.one(
      'SELECT 1 FROM relationships WHERE ((user_id = $1 AND target_id = $2) OR (user_id = $2 AND target_id = $1)) AND type = 2',
      [userId, other],
    );
    return !!row;
  }

  async function emitMessage(t: 'MESSAGE_CREATE' | 'MESSAGE_UPDATE', channelId: string, rows: MessageRow[]) {
    const [message] = await hydrateMessages(app.db, rows);
    await app.gw.emitToChannel(channelId, t, message);
    return message;
  }

  /** Mentions <@id>, @everyone / @here. */
  function parseMentions(content: string, a: Access, perms: number) {
    const ids = new Set<string>();
    for (const m of content.matchAll(/<@!?(\d{5,25})>/g)) ids.add(m[1]);
    const valid = [...ids].filter((id) => (a.ctx ? a.ctx.memberRoles.has(id) : a.recipients.includes(id)));
    const everyone = /@(everyone|here)\b/.test(content) && (!a.ctx || (perms & P.MENTION_EVERYONE) !== 0);
    return { mentions: valid.slice(0, 50), everyone };
  }

  /** Sans Nitro, les emojis personnalisés d'autres serveurs sont remplacés par leur nom. */
  async function filterCustomEmojis(content: string, userId: string, serverId: string | null) {
    const limits = await getLimits(app.db, userId);
    if (limits.emojisEverywhere) return content;
    const ids = [...content.matchAll(/<a?:\w{2,32}:(\d+)>/g)].map((m) => m[1]);
    if (!ids.length) return content;
    const rows = await app.db.query<{ id: string; server_id: string }>('SELECT id, server_id FROM emojis WHERE id = ANY($1::text[])', [ids]);
    const allowed = new Set(rows.filter((e) => e.server_id === serverId).map((e) => e.id));
    return content.replace(/<a?:(\w{2,32}):(\d+)>/g, (full, name, id) => (allowed.has(id) ? full : `:${name}:`));
  }

  async function bumpMentions(a: Access, msgId: string, authorId: string, mentions: string[], everyone: boolean) {
    let targets = new Set(mentions);
    if (everyone) {
      targets = new Set(a.ctx ? [...a.ctx.memberRoles.keys()] : a.recipients);
    }
    if (!a.ctx) for (const id of a.recipients) targets.add(id); // en MP, chaque message compte comme notification
    targets.delete(authorId);
    for (const id of targets) {
      if (a.ctx && !(channelPermissions(a.ctx, id, a.channel) & P.VIEW_CHANNEL)) continue;
      await app.db.query(
        `INSERT INTO read_states (user_id, channel_id, last_read_id, mention_count) VALUES ($1, $2, NULL, 1)
         ON CONFLICT (user_id, channel_id) DO UPDATE SET mention_count = read_states.mention_count + 1`,
        [id, a.channel.id],
      );
    }
    void msgId;
  }

  async function attachPreviews(a: Access, msgId: string, content: string) {
    if (!(a.perms & P.EMBED_LINKS)) return;
    const urls = extractUrls(content);
    if (!urls.length) {
      return;
    }
    const embeds = await previewsFor(app.db, urls);
    const rows = await app.db.query<MessageRow>('UPDATE messages SET embeds = $2 WHERE id = $1 RETURNING *', [msgId, JSON.stringify(embeds)]);
    if (rows.length && embeds.length) await emitMessage('MESSAGE_UPDATE', a.channel.id, rows);
  }

  /* ---------------------------- Salons ---------------------------- */
  r.get('/channels/:id', async (req, res) => {
    const a = await access(req, String(req.params.id));
    if (a.ctx) return res.json({ id: a.channel.id, serverId: a.channel.server_id, name: a.channel.name, type: a.channel.type, permissions: a.perms });
    res.json(await privateChannelPayload(app, a.channel.id, a.userId));
  });

  r.patch('/channels/:id', async (req, res) => {
    const a = await access(req, String(req.params.id));
    const b = req.body ?? {};
    if (a.ctx) {
      requirePerm(a.perms, P.MANAGE_CHANNELS);
      const name = b.name !== undefined ? channelName(str(b.name, 'nom du salon', { min: 1, max: 100 }), a.channel.type) : a.channel.name;
      const topic = b.topic !== undefined ? optStr(b.topic, 'sujet', 1024) ?? '' : a.channel.topic;
      const userLimit = b.userLimit !== undefined ? clampInt(b.userLimit, 0, 99, 0) : a.channel.user_limit;
      let parentId = a.channel.parent_id;
      if (b.parentId !== undefined && a.channel.type !== CH.CATEGORY) {
        parentId = b.parentId ? String(b.parentId) : null;
        if (parentId) ensure(a.ctx.channels.some((c) => c.id === parentId && c.type === CH.CATEGORY), 400, 'Catégorie invalide.');
      }
      await app.db.query('UPDATE channels SET name = $2, topic = $3, user_limit = $4, parent_id = $5 WHERE id = $1', [
        a.channel.id,
        name,
        topic,
        userLimit,
        parentId,
      ]);
      await app.gw.syncServer(a.channel.server_id!);
      return res.json({ ok: true });
    }
    ensure(a.channel.type === CH.GROUP_DM, 400, 'Impossible de modifier une conversation privée.');
    const name = optStr(b.name, 'nom du groupe', 100) ?? a.channel.name;
    await app.db.query('UPDATE channels SET name = $2 WHERE id = $1', [a.channel.id, name]);
    for (const u of a.recipients) {
      app.gw.sendToUser(u, 'CHANNEL_UPDATE', { channel: await privateChannelPayload(app, a.channel.id, u) });
    }
    res.json({ ok: true });
  });

  r.delete('/channels/:id', async (req, res) => {
    const a = await access(req, String(req.params.id));
    const userId = a.userId;
    if (a.ctx) {
      requirePerm(a.perms, P.MANAGE_CHANNELS);
      for (const id of [...a.ctx.memberRoles.keys()]) {
        if (app.gw.getVoiceState(id)?.channelId === a.channel.id) await app.gw.voiceLeave(id, true);
      }
      const atts = await app.db.query<{ path: string }>(
        'SELECT a.path FROM attachments a JOIN messages m ON m.id = a.message_id WHERE m.channel_id = $1',
        [a.channel.id],
      );
      await app.db.query('DELETE FROM channels WHERE id = $1', [a.channel.id]);
      atts.forEach((x) => removeUpload(app.uploadsDir, x.path));
      await app.gw.syncServer(a.channel.server_id!);
      return res.json({ ok: true });
    }
    if (a.channel.type === CH.DM) {
      await app.db.query('UPDATE channel_recipients SET closed = true WHERE channel_id = $1 AND user_id = $2', [a.channel.id, userId]);
      app.gw.sendToUser(userId, 'CHANNEL_DELETE', { id: a.channel.id, closed: true });
      return res.json({ ok: true });
    }
    // Groupe : on quitte.
    if (app.gw.getVoiceState(userId)?.channelId === a.channel.id) await app.gw.voiceLeave(userId);
    await app.db.query('DELETE FROM channel_recipients WHERE channel_id = $1 AND user_id = $2', [a.channel.id, userId]);
    app.gw.sendToUser(userId, 'CHANNEL_DELETE', { id: a.channel.id });
    const remaining = a.recipients.filter((id) => id !== userId);
    if (!remaining.length) {
      await app.db.query('DELETE FROM channels WHERE id = $1', [a.channel.id]);
    } else {
      if (a.channel.owner_id === userId) await app.db.query('UPDATE channels SET owner_id = $2 WHERE id = $1', [a.channel.id, remaining[0]]);
      await app.gw.postSystemMessage(a.channel.id, userId, 5, 'left');
      for (const u of remaining) app.gw.sendToUser(u, 'CHANNEL_UPDATE', { channel: await privateChannelPayload(app, a.channel.id, u) });
    }
    res.json({ ok: true });
  });

  /* Groupe privé : ajouter / retirer un membre */
  r.put('/channels/:id/recipients/:userId', async (req, res) => {
    const a = await access(req, String(req.params.id));
    ensure(a.channel.type === CH.GROUP_DM, 400, 'Seuls les groupes acceptent de nouveaux membres.');
    ensure(a.recipients.length < 10, 400, 'Un groupe peut contenir au maximum 10 personnes.');
    const target = String(req.params.userId);
    const friend = await app.db.one('SELECT 1 FROM relationships WHERE user_id = $1 AND target_id = $2 AND type = 1', [a.userId, target]);
    ensure(friend, 403, 'Tu ne peux ajouter que tes amis.');
    if (!a.recipients.includes(target)) {
      await app.db.query('INSERT INTO channel_recipients (channel_id, user_id) VALUES ($1, $2)', [a.channel.id, target]);
    }
    const all = [...new Set([...a.recipients, target])];
    const users = (await getUsersByIds(app.db, all)).map(publicUser);
    app.gw.sendToUser(target, 'CHANNEL_CREATE', { channel: await privateChannelPayload(app, a.channel.id, target), users });
    for (const u of a.recipients) app.gw.sendToUser(u, 'CHANNEL_UPDATE', { channel: await privateChannelPayload(app, a.channel.id, u), users });
    await app.gw.postSystemMessage(a.channel.id, a.userId, 4, target);
    res.json({ ok: true });
  });

  r.delete('/channels/:id/recipients/:userId', async (req, res) => {
    const a = await access(req, String(req.params.id));
    ensure(a.channel.type === CH.GROUP_DM, 400, 'Action impossible.');
    ensure(a.channel.owner_id === a.userId, 403, 'Seul le propriétaire du groupe peut retirer des membres.');
    const target = String(req.params.userId);
    ensure(target !== a.userId && a.recipients.includes(target), 400, 'Membre invalide.');
    if (app.gw.getVoiceState(target)?.channelId === a.channel.id) await app.gw.voiceLeave(target, true);
    await app.db.query('DELETE FROM channel_recipients WHERE channel_id = $1 AND user_id = $2', [a.channel.id, target]);
    app.gw.sendToUser(target, 'CHANNEL_DELETE', { id: a.channel.id });
    for (const u of a.recipients.filter((x) => x !== target)) {
      app.gw.sendToUser(u, 'CHANNEL_UPDATE', { channel: await privateChannelPayload(app, a.channel.id, u) });
    }
    res.json({ ok: true });
  });

  /* Permissions par salon (rôle ou membre) */
  r.put('/channels/:id/permissions/:targetId', async (req, res) => {
    const a = await access(req, String(req.params.id));
    ensure(a.ctx, 400, 'Les conversations privées n’ont pas de permissions.');
    const base = basePermissions(a.ctx, a.userId);
    ensure(base & (P.MANAGE_ROLES | P.ADMINISTRATOR), 403, "Tu n'as pas la permission de gérer les permissions.");
    const targetId = String(req.params.targetId);
    const type = req.body?.type === 'member' ? 'member' : 'role';
    if (type === 'role') ensure(a.ctx.roleById.has(targetId), 404, 'Rôle introuvable.');
    else ensure(a.ctx.memberRoles.has(targetId), 404, 'Membre introuvable.');
    const allow = clampInt(req.body?.allow, 0, ALL_PERMISSIONS, 0) & ALL_PERMISSIONS;
    const deny = clampInt(req.body?.deny, 0, ALL_PERMISSIONS, 0) & ALL_PERMISSIONS & ~allow;
    if (!(base & P.ADMINISTRATOR)) ensure(((allow | deny) & ~base) === 0, 403, 'Tu ne peux pas gérer des permissions que tu ne possèdes pas.');
    // Si le salon héritait de sa catégorie, on matérialise d'abord l'héritage.
    const own = a.ctx.overwrites.get(a.channel.id) ?? [];
    await app.db.tx(async (q) => {
      if (!own.length && a.channel.parent_id) {
        for (const o of a.ctx!.overwrites.get(a.channel.parent_id) ?? []) {
          await q.query(
            'INSERT INTO permission_overwrites (channel_id, target_id, target_type, allow, deny) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
            [a.channel.id, o.target_id, o.target_type, o.allow, o.deny],
          );
        }
      }
      await q.query(
        `INSERT INTO permission_overwrites (channel_id, target_id, target_type, allow, deny) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (channel_id, target_id) DO UPDATE SET allow = EXCLUDED.allow, deny = EXCLUDED.deny, target_type = EXCLUDED.target_type`,
        [a.channel.id, targetId, type, allow, deny],
      );
    });
    await app.gw.syncServer(a.channel.server_id!);
    res.json({ ok: true });
  });

  r.delete('/channels/:id/permissions/:targetId', async (req, res) => {
    const a = await access(req, String(req.params.id));
    ensure(a.ctx, 400, 'Action impossible.');
    const base = basePermissions(a.ctx, a.userId);
    ensure(base & (P.MANAGE_ROLES | P.ADMINISTRATOR), 403, "Tu n'as pas la permission de gérer les permissions.");
    await app.db.query('DELETE FROM permission_overwrites WHERE channel_id = $1 AND target_id = $2', [a.channel.id, String(req.params.targetId)]);
    await app.gw.syncServer(a.channel.server_id!);
    res.json({ ok: true });
  });

  /* ---------------------------- Messages ---------------------------- */
  r.get('/channels/:id/messages', async (req, res) => {
    const a = await access(req, String(req.params.id));
    requirePerm(a.perms, P.READ_HISTORY, "Tu n'as pas accès à l'historique de ce salon.");
    const limit = clampInt(req.query.limit, 1, 100, 50);
    const before = req.query.before ? String(req.query.before) : null;
    const after = req.query.after ? String(req.query.after) : null;
    let rows: MessageRow[];
    if (after) {
      rows = await app.db.query<MessageRow>('SELECT * FROM messages WHERE channel_id = $1 AND id > $2 ORDER BY id ASC LIMIT $3', [a.channel.id, after, limit]);
    } else if (before) {
      rows = (await app.db.query<MessageRow>('SELECT * FROM messages WHERE channel_id = $1 AND id < $2 ORDER BY id DESC LIMIT $3', [a.channel.id, before, limit])).reverse();
    } else {
      rows = (await app.db.query<MessageRow>('SELECT * FROM messages WHERE channel_id = $1 ORDER BY id DESC LIMIT $2', [a.channel.id, limit])).reverse();
    }
    res.json(await hydrateMessages(app.db, rows));
  });

  const attachmentsUpload = makeUpload(app.uploadsDir, 'attachments', {
    maxBytes: NITRO_LIMITS.maxUploadBytes,
    maxFiles: NITRO_LIMITS.maxFilesPerMessage,
    field: 'files',
  });

  r.post('/channels/:id/messages', attachmentsUpload, async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    let a: Access & { userId: string };
    try {
      a = await access(req, String(req.params.id));
      ensure(a.channel.type !== CH.CATEGORY && a.channel.type !== CH.VOICE && a.channel.type !== CH.STAGE, 400, 'Impossible d’envoyer un message ici.');
      requirePerm(a.perms, P.SEND_MESSAGES, "Tu n'as pas la permission d'envoyer des messages dans ce salon.");
      rateLimitOrThrow(messageLimiter, a.userId, 'Doucement ! Tu envoies des messages trop vite.');
      if (files.length) requirePerm(a.perms, P.ATTACH_FILES, "Tu n'as pas la permission d'envoyer des fichiers ici.");
      const limits = await getLimits(app.db, a.userId);
      ensure(files.length <= limits.maxFilesPerMessage, 400, `Maximum ${limits.maxFilesPerMessage} fichiers par message.`);
      for (const f of files) {
        if (f.size > limits.maxUploadBytes) throw new HttpError(413, 'Fichier trop volumineux.', 'FILE_TOO_LARGE');
      }
      if (await dmBlocked(a, a.userId)) throw new HttpError(403, "Impossible d'envoyer ce message : l'un de vous a bloqué l'autre.", 'BLOCKED');
    } catch (e) {
      discardFiles(files);
      throw e;
    }
    const userId = a.userId;
    const limits = await getLimits(app.db, userId);
    let content = typeof req.body?.content === 'string' ? req.body.content.replace(/\r\n/g, '\n').trim() : '';
    if (content.length > limits.maxMessageLength) {
      discardFiles(files);
      throw new HttpError(400, `Message trop long (maximum ${limits.maxMessageLength} caractères).`, 'TOO_LONG');
    }
    content = await filterCustomEmojis(content, userId, a.channel.server_id);

    let stickerId: string | null = null;
    if (req.body?.stickerId) {
      const st = await app.db.one<{ id: string; server_id: string }>("SELECT id, server_id FROM emojis WHERE id = $1 AND kind = 'sticker'", [String(req.body.stickerId)]);
      if (!st) {
        discardFiles(files);
        throw new HttpError(400, 'Sticker introuvable.');
      }
      if (st.server_id !== a.channel.server_id && !limits.stickersEverywhere) {
        discardFiles(files);
        throw new HttpError(403, 'Utiliser des stickers partout nécessite endBuy Nitro.', 'NITRO_REQUIRED');
      }
      stickerId = st.id;
    }
    if (!content && !files.length && !stickerId) {
      throw new HttpError(400, 'Le message est vide.', 'EMPTY');
    }
    let replyTo: string | null = null;
    if (req.body?.replyToId) {
      const ref = await app.db.one<{ id: string }>('SELECT id FROM messages WHERE id = $1 AND channel_id = $2', [String(req.body.replyToId), a.channel.id]);
      replyTo = ref?.id ?? null;
    }
    const { mentions, everyone } = parseMentions(content, a, a.perms);
    // La réponse mentionne l'auteur du message cité.
    if (replyTo && req.body?.mentionReply !== 'false') {
      const ref = await app.db.one<{ author_id: string | null }>('SELECT author_id FROM messages WHERE id = $1', [replyTo]);
      if (ref?.author_id && ref.author_id !== userId && !mentions.includes(ref.author_id)) mentions.push(ref.author_id);
    }
    for (const f of files) await persistUpload('attachments', f.filename);
    const id = snowflake();
    const rows = await app.db.tx(async (q) => {
      const inserted = await q.query<MessageRow>(
        `INSERT INTO messages (id, channel_id, author_id, content, reply_to_id, sticker_id, mentions, mention_everyone)
         VALUES ($1, $2, $3, $4, $5, $6, $7::text[], $8) RETURNING *`,
        [id, a.channel.id, userId, content, replyTo, stickerId, mentions, everyone],
      );
      for (const f of files) {
        const name = Buffer.from(f.originalname, 'latin1').toString('utf8').slice(0, 200) || 'fichier';
        await q.query('INSERT INTO attachments (id, message_id, filename, path, size, content_type) VALUES ($1, $2, $3, $4, $5, $6)', [
          snowflake(),
          id,
          name,
          publicPath('attachments', f.filename),
          f.size,
          contentTypeFor(f.filename),
        ]);
      }
      await q.query('UPDATE channels SET last_message_id = $1 WHERE id = $2', [id, a.channel.id]);
      if (!a.ctx) await q.query('UPDATE channel_recipients SET closed = false WHERE channel_id = $1', [a.channel.id]);
      await q.query(
        `INSERT INTO read_states (user_id, channel_id, last_read_id, mention_count) VALUES ($1, $2, $3, 0)
         ON CONFLICT (user_id, channel_id) DO UPDATE SET last_read_id = EXCLUDED.last_read_id, mention_count = 0`,
        [userId, a.channel.id, id],
      );
      return inserted;
    });
    await bumpMentions(a, id, userId, mentions, everyone);
    const message = await emitMessage('MESSAGE_CREATE', a.channel.id, rows);
    res.status(201).json(message);
    attachPreviews(a, id, content).catch((e) => console.error('[endBuy] aperçu de lien', e));
  });

  r.patch('/channels/:id/messages/:mid', async (req, res) => {
    const a = await access(req, String(req.params.id));
    const msg = await app.db.one<MessageRow>('SELECT * FROM messages WHERE id = $1 AND channel_id = $2', [String(req.params.mid), a.channel.id]);
    ensure(msg, 404, 'Message introuvable.');
    ensure(msg.author_id === a.userId && msg.type === 0, 403, 'Tu ne peux modifier que tes propres messages.');
    const limits = await getLimits(app.db, a.userId);
    let content = str(req.body?.content, 'contenu', { max: limits.maxMessageLength, optional: true });
    content = await filterCustomEmojis(content, a.userId, a.channel.server_id);
    const hasAttachments = await app.db.one('SELECT 1 FROM attachments WHERE message_id = $1 LIMIT 1', [msg.id]);
    ensure(content || hasAttachments || msg.sticker_id, 400, 'Le message ne peut pas être vide.');
    const { mentions, everyone } = parseMentions(content, a, a.perms);
    const rows = await app.db.query<MessageRow>(
      'UPDATE messages SET content = $2, mentions = $3::text[], mention_everyone = $4, edited_at = now(), embeds = $5 WHERE id = $1 RETURNING *',
      [msg.id, content, mentions, everyone, extractUrls(content).length ? JSON.stringify(msg.embeds ?? []) : '[]'],
    );
    const message = await emitMessage('MESSAGE_UPDATE', a.channel.id, rows);
    res.json(message);
    attachPreviews(a, msg.id, content).catch((e) => console.error('[endBuy] aperçu de lien', e));
  });

  r.delete('/channels/:id/messages/:mid', async (req, res) => {
    const a = await access(req, String(req.params.id));
    const msg = await app.db.one<MessageRow>('SELECT * FROM messages WHERE id = $1 AND channel_id = $2', [String(req.params.mid), a.channel.id]);
    ensure(msg, 404, 'Message introuvable.');
    if (msg.author_id !== a.userId) requirePerm(a.perms, P.MANAGE_MESSAGES, 'Tu ne peux supprimer que tes propres messages.');
    const atts = await app.db.query<{ path: string }>('SELECT path FROM attachments WHERE message_id = $1', [msg.id]);
    await app.db.query('DELETE FROM messages WHERE id = $1', [msg.id]);
    atts.forEach((x) => removeUpload(app.uploadsDir, x.path));
    await app.gw.emitToChannel(a.channel.id, 'MESSAGE_DELETE', { id: msg.id, channelId: a.channel.id });
    res.json({ ok: true });
  });

  /* ---------------------------- Réactions ---------------------------- */
  async function validateEmoji(emoji: string, userId: string, serverId: string | null) {
    ensure(emoji.length >= 1 && emoji.length <= 64 && !/\s/.test(emoji), 400, 'Emoji invalide.');
    const custom = /^(\w{2,32}):(\d+)$/.exec(emoji);
    if (custom) {
      const e = await app.db.one<{ server_id: string }>("SELECT server_id FROM emojis WHERE id = $1 AND kind = 'emoji'", [custom[2]]);
      ensure(e, 400, 'Emoji introuvable.');
      if (e.server_id !== serverId) {
        const limits = await getLimits(app.db, userId);
        ensure(limits.emojisEverywhere, 403, 'Utiliser des emojis partout nécessite endBuy Nitro.');
      }
    } else {
      ensure(/\p{Extended_Pictographic}|\p{Regional_Indicator}|[#-9]️?⃣/u.test(emoji) && emoji.length <= 16, 400, 'Emoji invalide.');
    }
  }

  r.put('/channels/:id/messages/:mid/reactions/:emoji', async (req, res) => {
    const a = await access(req, String(req.params.id));
    rateLimitOrThrow(reactionLimiter, a.userId, 'Doucement avec les réactions !');
    const emoji = decodeURIComponent(String(req.params.emoji));
    const msg = await app.db.one<{ id: string }>('SELECT id FROM messages WHERE id = $1 AND channel_id = $2', [String(req.params.mid), a.channel.id]);
    ensure(msg, 404, 'Message introuvable.');
    const existing = await app.db.query<{ emoji: string }>('SELECT DISTINCT emoji FROM reactions WHERE message_id = $1', [msg.id]);
    if (!existing.some((e) => e.emoji === emoji)) {
      requirePerm(a.perms, P.ADD_REACTIONS, "Tu n'as pas la permission d'ajouter des réactions.");
      ensure(existing.length < 20, 400, 'Ce message a atteint la limite de 20 réactions différentes.');
    }
    await validateEmoji(emoji, a.userId, a.channel.server_id);
    if (await dmBlocked(a, a.userId)) throw new HttpError(403, 'Action impossible.', 'BLOCKED');
    const row = await app.db.one(
      'INSERT INTO reactions (message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING message_id',
      [msg.id, a.userId, emoji],
    );
    if (row) {
      await app.gw.emitToChannel(a.channel.id, 'MESSAGE_REACTION_ADD', { channelId: a.channel.id, messageId: msg.id, userId: a.userId, emoji });
    }
    res.json({ ok: true });
  });

  r.delete('/channels/:id/messages/:mid/reactions/:emoji', async (req, res) => {
    const a = await access(req, String(req.params.id));
    const emoji = decodeURIComponent(String(req.params.emoji));
    const row = await app.db.one(
      'DELETE FROM reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3 RETURNING message_id',
      [String(req.params.mid), a.userId, emoji],
    );
    if (row) {
      await app.gw.emitToChannel(a.channel.id, 'MESSAGE_REACTION_REMOVE', {
        channelId: a.channel.id,
        messageId: String(req.params.mid),
        userId: a.userId,
        emoji,
      });
    }
    res.json({ ok: true });
  });

  /* ---------------------------- Épingles ---------------------------- */
  r.get('/channels/:id/pins', async (req, res) => {
    const a = await access(req, String(req.params.id));
    requirePerm(a.perms, P.READ_HISTORY);
    const rows = await app.db.query<MessageRow>('SELECT * FROM messages WHERE channel_id = $1 AND pinned = true ORDER BY id DESC LIMIT 50', [a.channel.id]);
    res.json(await hydrateMessages(app.db, rows));
  });

  async function setPinned(req: Request, pinned: boolean) {
    const a = await access(req, String(req.params.id));
    if (a.ctx) requirePerm(a.perms, P.MANAGE_MESSAGES, "Tu n'as pas la permission d'épingler des messages.");
    if (pinned) {
      const n = await app.db.one<{ n: number }>('SELECT count(*)::int AS n FROM messages WHERE channel_id = $1 AND pinned = true', [a.channel.id]);
      ensure((n?.n ?? 0) < 50, 400, 'Limite de 50 messages épinglés atteinte.');
    }
    const rows = await app.db.query<MessageRow>(
      'UPDATE messages SET pinned = $3 WHERE id = $1 AND channel_id = $2 AND pinned <> $3 RETURNING *',
      [String(req.params.mid), a.channel.id, pinned],
    );
    if (rows.length) {
      await emitMessage('MESSAGE_UPDATE', a.channel.id, rows);
      if (pinned) await app.gw.postSystemMessage(a.channel.id, a.userId, 2, rows[0].id);
    }
  }

  r.put('/channels/:id/pins/:mid', async (req, res) => {
    await setPinned(req, true);
    res.json({ ok: true });
  });
  r.delete('/channels/:id/pins/:mid', async (req, res) => {
    await setPinned(req, false);
    res.json({ ok: true });
  });

  /* ---------------------------- Lecture ---------------------------- */
  r.post('/channels/:id/ack', async (req, res) => {
    const a = await access(req, String(req.params.id));
    const messageId = String(req.body?.messageId || a.channel.last_message_id || '');
    if (!messageId) return res.json({ ok: true });
    await app.db.query(
      `INSERT INTO read_states (user_id, channel_id, last_read_id, mention_count) VALUES ($1, $2, $3, 0)
       ON CONFLICT (user_id, channel_id) DO UPDATE SET
         last_read_id = CASE WHEN read_states.last_read_id IS NULL OR read_states.last_read_id < EXCLUDED.last_read_id THEN EXCLUDED.last_read_id ELSE read_states.last_read_id END,
         mention_count = 0`,
      [a.userId, a.channel.id, messageId],
    );
    app.gw.sendToUser(a.userId, 'MESSAGE_ACK', { channelId: a.channel.id, messageId });
    res.json({ ok: true });
  });

  r.get('/channels/:id/search', async (req, res) => {
    const a = await access(req, String(req.params.id));
    requirePerm(a.perms, P.READ_HISTORY);
    const q = String(req.query.q ?? '').trim().slice(0, 200);
    ensure(q.length >= 1, 400, 'Recherche vide.');
    res.json(await searchMessages(app, [a.channel.id], q, req.query.authorId ? String(req.query.authorId) : null, clampInt(req.query.offset, 0, 5000, 0)));
  });

  return r;
}
