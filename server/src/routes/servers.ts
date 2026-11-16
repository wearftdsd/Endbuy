import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import { requireAuth, uid } from '../auth.js';
import type { AppCtx } from '../context.js';
import { acceptImage, discardFiles, makeUpload, persistUpload, publicPath, removeUpload } from '../files.js';
import {
  ALL_PERMISSIONS,
  basePermissions,
  canActOn,
  CH,
  channelPermissions,
  DEFAULT_EVERYONE,
  highestRolePosition,
  MODERATOR_PERMS,
  P,
  requirePerm,
  type ServerPermContext,
} from '../permissions.js';
import { getUserRow, getUsersByIds, hydrateMessages, publicUser, type MessageRow } from '../serialize.js';
import { loadServerData, serverSnapshot } from '../state.js';
import { clampInt, ensure, HttpError, isHexColor, optStr, RateLimiter, rateLimitOrThrow, snowflake, str } from '../util.js';

const createServerLimiter = new RateLimiter(10, 60 * 60_000);
const joinLimiter = new RateLimiter(20, 10 * 60_000);

export function channelName(name: string, type: number) {
  if (type === CH.TEXT) {
    const n = name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\p{L}\p{N}_-]/gu, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    ensure(n.length >= 1, 400, 'Nom de salon invalide.');
    return n.slice(0, 100);
  }
  return name.slice(0, 100);
}

function inviteCode() {
  const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += chars[crypto.randomInt(0, chars.length)];
  return out;
}

export function serverRoutes(app: AppCtx) {
  const r = Router();

  async function ctxFor(req: Request, serverId: string): Promise<{ ctx: ServerPermContext; userId: string; perms: number }> {
    const userId = uid(req);
    const ctx = await app.perms.get(serverId);
    if (!ctx || !ctx.memberRoles.has(userId)) throw new HttpError(404, 'Serveur introuvable.', 'UNKNOWN_SERVER');
    return { ctx, userId, perms: basePermissions(ctx, userId) };
  }

  /* -------------------------- Invitations (publiques) -------------------------- */
  r.get('/invites/:code', async (req, res) => {
    const code = String(req.params.code);
    const inv = await app.db.one<{
      code: string;
      server_id: string;
      inviter_id: string | null;
      max_uses: number;
      uses: number;
      expires_at: Date | null;
    }>('SELECT * FROM invites WHERE code = $1', [code]);
    if (!inv || (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) || (inv.max_uses > 0 && inv.uses >= inv.max_uses)) {
      throw new HttpError(404, 'Cette invitation est invalide ou a expiré.', 'UNKNOWN_INVITE');
    }
    const server = await app.db.one<{ id: string; name: string; icon: string | null; description: string }>(
      'SELECT id, name, icon, description FROM servers WHERE id = $1',
      [inv.server_id],
    );
    ensure(server, 404, 'Cette invitation est invalide ou a expiré.');
    const members = await app.db.query<{ user_id: string }>('SELECT user_id FROM members WHERE server_id = $1', [server.id]);
    const inviter = inv.inviter_id ? await getUserRow(app.db, inv.inviter_id) : undefined;
    res.json({
      code: inv.code,
      server,
      memberCount: members.length,
      onlineCount: members.filter((m) => app.gw.presenceOf(m.user_id).status !== 'offline').length,
      inviter: inviter ? publicUser(inviter) : null,
      expiresAt: inv.expires_at ? new Date(inv.expires_at).toISOString() : null,
      joined: req.auth ? members.some((m) => m.user_id === req.auth!.userId) : false,
    });
  });

  /** Image d'un emoji / sticker personnalisé par identifiant (utilisable partout grâce à Nitro). */
  r.get('/emojis/:id', async (req, res) => {
    const row = await app.db.one<{ path: string }>('SELECT path FROM emojis WHERE id = $1', [String(req.params.id)]);
    if (!row) throw new HttpError(404, 'Emoji introuvable.', 'UNKNOWN_EMOJI');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.redirect(302, row.path);
  });

  r.use(requireAuth);

  r.post('/invites/:code', async (req, res) => {
    const userId = uid(req);
    rateLimitOrThrow(joinLimiter, userId);
    const code = String(req.params.code);
    const result = await app.db.tx(async (q) => {
      const inv = await q.one<{ server_id: string; max_uses: number; uses: number; expires_at: Date | null }>(
        'SELECT * FROM invites WHERE code = $1 FOR UPDATE',
        [code],
      );
      if (!inv || (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) || (inv.max_uses > 0 && inv.uses >= inv.max_uses)) {
        throw new HttpError(404, 'Cette invitation est invalide ou a expiré.', 'UNKNOWN_INVITE');
      }
      const banned = await q.one('SELECT 1 FROM bans WHERE server_id = $1 AND user_id = $2', [inv.server_id, userId]);
      if (banned) throw new HttpError(403, 'Tu es banni de ce serveur.', 'BANNED');
      const already = await q.one('SELECT 1 FROM members WHERE server_id = $1 AND user_id = $2', [inv.server_id, userId]);
      if (already) return { serverId: inv.server_id, joined: false };
      const count = await q.one<{ n: number }>('SELECT count(*)::int AS n FROM members WHERE user_id = $1', [userId]);
      if ((count?.n ?? 0) >= 200) throw new HttpError(400, 'Tu as atteint la limite de 200 serveurs.', 'TOO_MANY_SERVERS');
      await q.query('INSERT INTO members (server_id, user_id) VALUES ($1, $2)', [inv.server_id, userId]);
      await q.query('UPDATE invites SET uses = uses + 1 WHERE code = $1', [code]);
      return { serverId: inv.server_id, joined: true };
    });
    await app.gw.syncServer(result.serverId);
    if (result.joined) {
      const sys = await app.db.one<{ id: string }>(
        `SELECT id FROM channels WHERE server_id = $1 AND type = ${CH.TEXT} ORDER BY position, id LIMIT 1`,
        [result.serverId],
      );
      if (sys) await app.gw.postSystemMessage(sys.id, userId, 1, '');
    }
    res.json({ serverId: result.serverId });
  });

  r.delete('/invites/:code', async (req, res) => {
    const userId = uid(req);
    const inv = await app.db.one<{ server_id: string; inviter_id: string | null }>('SELECT * FROM invites WHERE code = $1', [
      String(req.params.code),
    ]);
    ensure(inv, 404, 'Invitation introuvable.');
    const { perms } = await ctxFor(req, inv.server_id);
    if (inv.inviter_id !== userId) requirePerm(perms, P.MANAGE_SERVER);
    await app.db.query('DELETE FROM invites WHERE code = $1', [String(req.params.code)]);
    res.json({ ok: true });
  });

  /* ------------------------------ Serveurs ------------------------------ */
  r.post('/servers', async (req, res) => {
    const userId = uid(req);
    rateLimitOrThrow(createServerLimiter, userId, 'Tu crées trop de serveurs. Réessaie plus tard.');
    const name = str(req.body?.name, 'nom du serveur', { min: 2, max: 100 });
    const count = await app.db.one<{ n: number }>('SELECT count(*)::int AS n FROM members WHERE user_id = $1', [userId]);
    ensure((count?.n ?? 0) < 200, 400, 'Tu as atteint la limite de 200 serveurs.');
    const serverId = snowflake();
    await app.db.tx(async (q) => {
      await q.query('INSERT INTO servers (id, name, owner_id) VALUES ($1, $2, $3)', [serverId, name, userId]);
      // @everyone utilise l'identifiant du serveur, comme convention.
      await q.query(
        `INSERT INTO roles (id, server_id, name, permissions, position, is_default) VALUES ($1, $1, '@everyone', $2, 0, true)`,
        [serverId, DEFAULT_EVERYONE],
      );
      await q.query(
        `INSERT INTO roles (id, server_id, name, color, permissions, position, hoist) VALUES ($1, $2, 'Administrateur', '#F04F5A', $3, 2, true)`,
        [snowflake(), serverId, P.ADMINISTRATOR | DEFAULT_EVERYONE],
      );
      await q.query(
        `INSERT INTO roles (id, server_id, name, color, permissions, position, hoist) VALUES ($1, $2, 'Modérateur', '#3BA4F6', $3, 1, true)`,
        [snowflake(), serverId, MODERATOR_PERMS],
      );
      await q.query('INSERT INTO members (server_id, user_id) VALUES ($1, $2)', [serverId, userId]);
      const textCat = snowflake();
      const voiceCat = snowflake();
      await q.query(`INSERT INTO channels (id, server_id, type, name, position) VALUES ($1, $2, ${CH.CATEGORY}, 'Salons textuels', 0)`, [
        textCat,
        serverId,
      ]);
      await q.query(`INSERT INTO channels (id, server_id, type, name, position) VALUES ($1, $2, ${CH.CATEGORY}, 'Salons vocaux', 1)`, [
        voiceCat,
        serverId,
      ]);
      await q.query(
        `INSERT INTO channels (id, server_id, type, name, topic, parent_id, position) VALUES ($1, $2, ${CH.TEXT}, 'général', $4, $3, 0)`,
        [snowflake(), serverId, textCat, `Bienvenue sur ${name} !`],
      );
      await q.query(`INSERT INTO channels (id, server_id, type, name, parent_id, position) VALUES ($1, $2, ${CH.VOICE}, 'Général', $3, 0)`, [
        snowflake(),
        serverId,
        voiceCat,
      ]);
    });
    await app.gw.syncServer(serverId);
    const data = await loadServerData(app, serverId);
    res.status(201).json(serverSnapshot(data!, userId));
  });

  r.patch('/servers/:id', async (req, res) => {
    const serverId = String(req.params.id);
    const { perms } = await ctxFor(req, serverId);
    requirePerm(perms, P.MANAGE_SERVER);
    const name = req.body?.name !== undefined ? str(req.body.name, 'nom du serveur', { min: 2, max: 100 }) : undefined;
    const description = optStr(req.body?.description, 'description', 300);
    await app.db.query('UPDATE servers SET name = COALESCE($2, name), description = COALESCE($3, description) WHERE id = $1', [
      serverId,
      name ?? null,
      description ?? null,
    ]);
    await app.gw.syncServer(serverId);
    res.json({ ok: true });
  });

  const iconUpload = makeUpload(app.uploadsDir, 'icons', { maxBytes: 10 * 1024 * 1024, maxFiles: 1, field: 'file' });
  r.post('/servers/:id/icon', iconUpload, async (req, res) => {
    const serverId = String(req.params.id);
    try {
      const { perms } = await ctxFor(req, serverId);
      requirePerm(perms, P.MANAGE_SERVER);
    } catch (e) {
      discardFiles(req.file ? [req.file] : []);
      throw e;
    }
    const img = acceptImage(req.file, { allowAnimated: true });
    await persistUpload('icons', img.filename);
    const old = await app.db.one<{ icon: string | null }>('SELECT icon FROM servers WHERE id = $1', [serverId]);
    await app.db.query('UPDATE servers SET icon = $2 WHERE id = $1', [serverId, publicPath('icons', img.filename)]);
    removeUpload(app.uploadsDir, old?.icon);
    await app.gw.syncServer(serverId);
    res.json({ ok: true });
  });

  r.delete('/servers/:id/icon', async (req, res) => {
    const serverId = String(req.params.id);
    const { perms } = await ctxFor(req, serverId);
    requirePerm(perms, P.MANAGE_SERVER);
    const old = await app.db.one<{ icon: string | null }>('SELECT icon FROM servers WHERE id = $1', [serverId]);
    await app.db.query('UPDATE servers SET icon = NULL WHERE id = $1', [serverId]);
    removeUpload(app.uploadsDir, old?.icon);
    await app.gw.syncServer(serverId);
    res.json({ ok: true });
  });

  r.delete('/servers/:id', async (req, res) => {
    const serverId = String(req.params.id);
    const { ctx, userId } = await ctxFor(req, serverId);
    ensure(ctx.ownerId === userId, 403, 'Seul le propriétaire peut supprimer le serveur.');
    const members = [...ctx.memberRoles.keys()];
    for (const m of members) {
      const vs = app.gw.getVoiceState(m);
      if (vs?.serverId === serverId) await app.gw.voiceLeave(m, true);
    }
    await app.db.query('DELETE FROM servers WHERE id = $1', [serverId]);
    app.perms.invalidate(serverId);
    app.gw.sendToUsers(members, 'SERVER_DELETE', { id: serverId, reason: 'deleted' });
    res.json({ ok: true });
  });

  r.post('/servers/:id/transfer', async (req, res) => {
    const serverId = String(req.params.id);
    const { ctx, userId } = await ctxFor(req, serverId);
    ensure(ctx.ownerId === userId, 403, 'Seul le propriétaire peut transférer le serveur.');
    const target = String(req.body?.userId || '');
    ensure(ctx.memberRoles.has(target) && target !== userId, 400, 'Membre invalide.');
    await app.db.query('UPDATE servers SET owner_id = $2 WHERE id = $1', [serverId, target]);
    await app.gw.syncServer(serverId);
    res.json({ ok: true });
  });

  /* ------------------------------ Membres ------------------------------ */
  r.patch('/servers/:id/members/:userId', async (req, res) => {
    const serverId = String(req.params.id);
    const { ctx, userId, perms } = await ctxFor(req, serverId);
    const targetId = req.params.userId === '@me' ? userId : String(req.params.userId);
    ensure(ctx.memberRoles.has(targetId), 404, 'Membre introuvable.');
    const b = req.body ?? {};
    if (b.nickname !== undefined) {
      if (targetId === userId) requirePerm(perms, P.CHANGE_NICKNAME);
      else {
        requirePerm(perms, P.MANAGE_NICKNAMES);
        ensure(canActOn(ctx, userId, targetId), 403, 'Ce membre a un rôle supérieur ou égal au tien.');
      }
      const nick = optStr(b.nickname, 'surnom', 32) || null;
      await app.db.query('UPDATE members SET nickname = $3 WHERE server_id = $1 AND user_id = $2', [serverId, targetId, nick]);
    }
    if (Array.isArray(b.roles)) {
      requirePerm(perms, P.MANAGE_ROLES);
      if (targetId !== userId) ensure(canActOn(ctx, userId, targetId), 403, 'Ce membre a un rôle supérieur ou égal au tien.');
      const myTop = highestRolePosition(ctx, userId);
      const wanted = new Set<string>(b.roles.map(String));
      const current = new Set(ctx.memberRoles.get(targetId) ?? []);
      for (const rid of new Set([...wanted, ...current])) {
        if (wanted.has(rid) === current.has(rid)) continue;
        const role = ctx.roleById.get(rid);
        ensure(role && !role.is_default, 400, 'Rôle invalide.');
        ensure(role.position < myTop, 403, `Tu ne peux pas gérer le rôle « ${role.name} » (il est au-dessus du tien).`);
      }
      await app.db.tx(async (q) => {
        await q.query('DELETE FROM member_roles WHERE server_id = $1 AND user_id = $2', [serverId, targetId]);
        for (const rid of wanted) {
          await q.query('INSERT INTO member_roles (server_id, user_id, role_id) VALUES ($1, $2, $3)', [serverId, targetId, rid]);
        }
      });
    }
    await app.gw.syncServer(serverId);
    res.json({ ok: true });
  });

  async function removeMember(serverId: string, targetId: string, reason: 'left' | 'kicked' | 'banned') {
    const vs = app.gw.getVoiceState(targetId);
    if (vs?.serverId === serverId) await app.gw.voiceLeave(targetId, true);
    await app.db.query('DELETE FROM members WHERE server_id = $1 AND user_id = $2', [serverId, targetId]);
    await app.db.query('DELETE FROM read_states WHERE user_id = $1 AND channel_id IN (SELECT id FROM channels WHERE server_id = $2)', [
      targetId,
      serverId,
    ]);
    app.gw.sendToUser(targetId, 'SERVER_DELETE', { id: serverId, reason });
    await app.gw.syncServer(serverId);
  }

  r.delete('/servers/:id/members/:userId', async (req, res) => {
    const serverId = String(req.params.id);
    const { ctx, userId, perms } = await ctxFor(req, serverId);
    if (req.params.userId === '@me' || req.params.userId === userId) {
      ensure(ctx.ownerId !== userId, 400, 'Le propriétaire ne peut pas quitter son serveur : transfère-le ou supprime-le.');
      await removeMember(serverId, userId, 'left');
      return res.json({ ok: true });
    }
    const targetId = String(req.params.userId);
    requirePerm(perms, P.KICK_MEMBERS);
    ensure(ctx.memberRoles.has(targetId), 404, 'Membre introuvable.');
    ensure(canActOn(ctx, userId, targetId), 403, 'Ce membre a un rôle supérieur ou égal au tien.');
    await removeMember(serverId, targetId, 'kicked');
    res.json({ ok: true });
  });

  /* ------------------------------ Bannissements ------------------------------ */
  r.get('/servers/:id/bans', async (req, res) => {
    const serverId = String(req.params.id);
    const { perms } = await ctxFor(req, serverId);
    requirePerm(perms, P.BAN_MEMBERS);
    const bans = await app.db.query<{ user_id: string; reason: string; created_at: Date }>(
      'SELECT user_id, reason, created_at FROM bans WHERE server_id = $1 ORDER BY created_at DESC',
      [serverId],
    );
    const users = new Map((await getUsersByIds(app.db, bans.map((b) => b.user_id))).map((u) => [u.id, publicUser(u)]));
    res.json(bans.map((b) => ({ user: users.get(b.user_id), reason: b.reason, createdAt: new Date(b.created_at).toISOString() })));
  });

  r.put('/servers/:id/bans/:userId', async (req, res) => {
    const serverId = String(req.params.id);
    const { ctx, userId, perms } = await ctxFor(req, serverId);
    requirePerm(perms, P.BAN_MEMBERS);
    const targetId = String(req.params.userId);
    ensure(targetId !== userId, 400, 'Tu ne peux pas te bannir toi-même.');
    const target = await getUserRow(app.db, targetId);
    ensure(target, 404, 'Utilisateur introuvable.');
    if (ctx.memberRoles.has(targetId) || targetId === ctx.ownerId) {
      ensure(canActOn(ctx, userId, targetId), 403, 'Ce membre a un rôle supérieur ou égal au tien.');
    }
    const reason = optStr(req.body?.reason, 'raison', 300) ?? '';
    await app.db.query(
      `INSERT INTO bans (server_id, user_id, reason, banned_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (server_id, user_id) DO UPDATE SET reason = EXCLUDED.reason`,
      [serverId, targetId, reason, userId],
    );
    if (req.body?.deleteMessages) {
      const deleted = await app.db.query<{ id: string; channel_id: string }>(
        `DELETE FROM messages WHERE author_id = $1 AND created_at > now() - interval '1 day'
         AND channel_id IN (SELECT id FROM channels WHERE server_id = $2) RETURNING id, channel_id`,
        [targetId, serverId],
      );
      const members = [...ctx.memberRoles.keys()];
      for (const m of deleted) app.gw.sendToUsers(members, 'MESSAGE_DELETE', { id: m.id, channelId: m.channel_id });
    }
    if (ctx.memberRoles.has(targetId)) await removeMember(serverId, targetId, 'banned');
    res.json({ ok: true });
  });

  r.delete('/servers/:id/bans/:userId', async (req, res) => {
    const serverId = String(req.params.id);
    const { perms } = await ctxFor(req, serverId);
    requirePerm(perms, P.BAN_MEMBERS);
    await app.db.query('DELETE FROM bans WHERE server_id = $1 AND user_id = $2', [serverId, String(req.params.userId)]);
    res.json({ ok: true });
  });

  /* ------------------------------ Rôles ------------------------------ */
  function checkGrantable(ctx: ServerPermContext, userId: string, perms: number, wanted: number) {
    if (ctx.ownerId === userId || perms & P.ADMINISTRATOR) return;
    ensure((wanted & ~perms) === 0, 403, 'Tu ne peux pas accorder des permissions que tu ne possèdes pas.');
  }

  r.post('/servers/:id/roles', async (req, res) => {
    const serverId = String(req.params.id);
    const { ctx, userId, perms } = await ctxFor(req, serverId);
    requirePerm(perms, P.MANAGE_ROLES);
    ensure(ctx.roles.length < 250, 400, 'Limite de 250 rôles atteinte.');
    const name = str(req.body?.name ?? 'nouveau rôle', 'nom du rôle', { min: 1, max: 100 });
    const permissions = clampInt(req.body?.permissions, 0, ALL_PERMISSIONS, DEFAULT_EVERYONE & ctx.everyone.permissions) & ALL_PERMISSIONS;
    checkGrantable(ctx, userId, perms, permissions);
    const color = isHexColor(req.body?.color) ? req.body.color : null;
    const id = snowflake();
    await app.db.tx(async (q) => {
      await q.query('UPDATE roles SET position = position + 1 WHERE server_id = $1 AND is_default = false', [serverId]);
      await q.query(
        'INSERT INTO roles (id, server_id, name, color, permissions, position, hoist, mentionable) VALUES ($1, $2, $3, $4, $5, 1, $6, $7)',
        [id, serverId, name, color, permissions, !!req.body?.hoist, !!req.body?.mentionable],
      );
    });
    await app.gw.syncServer(serverId);
    res.status(201).json({ id });
  });

  r.patch('/servers/:id/roles/:roleId', async (req, res) => {
    const serverId = String(req.params.id);
    const { ctx, userId, perms } = await ctxFor(req, serverId);
    requirePerm(perms, P.MANAGE_ROLES);
    const role = ctx.roleById.get(String(req.params.roleId));
    ensure(role, 404, 'Rôle introuvable.');
    if (!role.is_default) {
      ensure(role.position < highestRolePosition(ctx, userId), 403, 'Ce rôle est au-dessus du tien.');
    }
    const b = req.body ?? {};
    const name = !role.is_default && b.name !== undefined ? str(b.name, 'nom du rôle', { min: 1, max: 100 }) : role.name;
    let permissions = role.permissions;
    if (b.permissions !== undefined) {
      permissions = clampInt(b.permissions, 0, ALL_PERMISSIONS, role.permissions) & ALL_PERMISSIONS;
      checkGrantable(ctx, userId, perms, permissions & ~role.permissions);
    }
    const color = b.color === undefined ? role.color : isHexColor(b.color) ? b.color : null;
    const hoist = typeof b.hoist === 'boolean' ? b.hoist : role.hoist;
    const mentionable = typeof b.mentionable === 'boolean' ? b.mentionable : role.mentionable;
    await app.db.query('UPDATE roles SET name = $2, permissions = $3, color = $4, hoist = $5, mentionable = $6 WHERE id = $1', [
      role.id,
      name,
      permissions,
      color,
      hoist,
      mentionable,
    ]);
    await app.gw.syncServer(serverId);
    res.json({ ok: true });
  });

  r.post('/servers/:id/roles/:roleId/move', async (req, res) => {
    const serverId = String(req.params.id);
    const { ctx, userId, perms } = await ctxFor(req, serverId);
    requirePerm(perms, P.MANAGE_ROLES);
    const role = ctx.roleById.get(String(req.params.roleId));
    ensure(role && !role.is_default, 404, 'Rôle introuvable.');
    const dir = req.body?.direction === 'up' ? 1 : -1;
    const sorted = ctx.roles.filter((x) => !x.is_default).sort((a, b) => a.position - b.position);
    const idx = sorted.findIndex((x) => x.id === role.id);
    const other = sorted[idx + dir];
    ensure(other, 400, 'Impossible de déplacer ce rôle plus loin.');
    const myTop = highestRolePosition(ctx, userId);
    ensure(role.position < myTop && other.position < myTop, 403, 'Tu ne peux déplacer que des rôles inférieurs au tien.');
    await app.db.tx(async (q) => {
      await q.query('UPDATE roles SET position = $2 WHERE id = $1', [role.id, other.position]);
      await q.query('UPDATE roles SET position = $2 WHERE id = $1', [other.id, role.position]);
    });
    await app.gw.syncServer(serverId);
    res.json({ ok: true });
  });

  r.delete('/servers/:id/roles/:roleId', async (req, res) => {
    const serverId = String(req.params.id);
    const { ctx, userId, perms } = await ctxFor(req, serverId);
    requirePerm(perms, P.MANAGE_ROLES);
    const role = ctx.roleById.get(String(req.params.roleId));
    ensure(role && !role.is_default, 404, 'Rôle introuvable.');
    ensure(role.position < highestRolePosition(ctx, userId), 403, 'Ce rôle est au-dessus du tien.');
    await app.db.tx(async (q) => {
      await q.query('DELETE FROM roles WHERE id = $1', [role.id]);
      await q.query('DELETE FROM permission_overwrites WHERE target_id = $1', [role.id]);
      await q.query('UPDATE roles SET position = position - 1 WHERE server_id = $1 AND position > $2', [serverId, role.position]);
    });
    await app.gw.syncServer(serverId);
    res.json({ ok: true });
  });

  /* ------------------------------ Salons ------------------------------ */
  r.post('/servers/:id/channels', async (req, res) => {
    const serverId = String(req.params.id);
    const { ctx, userId, perms } = await ctxFor(req, serverId);
    requirePerm(perms, P.MANAGE_CHANNELS);
    ensure(ctx.channels.length < 500, 400, 'Limite de 500 salons atteinte.');
    const type = Number(req.body?.type ?? CH.TEXT);
    ensure([CH.TEXT, CH.VOICE, CH.CATEGORY, CH.STAGE].includes(type as 0), 400, 'Type de salon invalide.');
    const name = channelName(str(req.body?.name, 'nom du salon', { min: 1, max: 100 }), type);
    let parentId: string | null = req.body?.parentId ? String(req.body.parentId) : null;
    if (type === CH.CATEGORY) parentId = null;
    if (parentId) ensure(ctx.channels.some((c) => c.id === parentId && c.type === CH.CATEGORY), 400, 'Catégorie invalide.');
    const siblings = ctx.channels.filter((c) => (type === CH.CATEGORY ? c.type === CH.CATEGORY : c.parent_id === parentId));
    const position = siblings.reduce((m, c) => Math.max(m, c.position + 1), 0);
    const topic = optStr(req.body?.topic, 'sujet', 1024) ?? '';
    const userLimit = type === CH.VOICE ? clampInt(req.body?.userLimit, 0, 99, 0) : 0;
    const id = snowflake();
    await app.db.tx(async (q) => {
      await q.query(
        'INSERT INTO channels (id, server_id, type, name, topic, parent_id, position, user_limit) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [id, serverId, type, name, topic, parentId, position, userLimit],
      );
      if (req.body?.private) {
        // Salon privé : @everyone ne voit pas ; les rôles choisis et le créateur, si.
        await q.query(
          "INSERT INTO permission_overwrites (channel_id, target_id, target_type, allow, deny) VALUES ($1, $2, 'role', 0, $3)",
          [id, ctx.everyone.id, P.VIEW_CHANNEL],
        );
        const roleIds: string[] = Array.isArray(req.body?.roleIds) ? req.body.roleIds.map(String) : [];
        for (const rid of roleIds) {
          if (!ctx.roleById.has(rid) || rid === ctx.everyone.id) continue;
          await q.query(
            "INSERT INTO permission_overwrites (channel_id, target_id, target_type, allow, deny) VALUES ($1, $2, 'role', $3, 0)",
            [id, rid, P.VIEW_CHANNEL | P.CONNECT],
          );
        }
        await q.query(
          "INSERT INTO permission_overwrites (channel_id, target_id, target_type, allow, deny) VALUES ($1, $2, 'member', $3, 0)",
          [id, userId, P.VIEW_CHANNEL | P.CONNECT],
        );
      } else if (parentId) {
        // Hérite (copie) des permissions de la catégorie, comme une synchronisation.
        const parentOw = ctx.overwrites.get(parentId) ?? [];
        for (const o of parentOw) {
          await q.query(
            'INSERT INTO permission_overwrites (channel_id, target_id, target_type, allow, deny) VALUES ($1, $2, $3, $4, $5)',
            [id, o.target_id, o.target_type, o.allow, o.deny],
          );
        }
      }
    });
    await app.gw.syncServer(serverId);
    res.status(201).json({ id });
  });

  r.post('/servers/:id/channels/reorder', async (req, res) => {
    const serverId = String(req.params.id);
    const { ctx, perms } = await ctxFor(req, serverId);
    requirePerm(perms, P.MANAGE_CHANNELS);
    const items: { id: string; position: number; parentId?: string | null }[] = Array.isArray(req.body) ? req.body : [];
    await app.db.tx(async (q) => {
      for (const it of items.slice(0, 500)) {
        const ch = ctx.channels.find((c) => c.id === String(it.id));
        if (!ch) continue;
        let parent = it.parentId === undefined ? ch.parent_id : it.parentId ? String(it.parentId) : null;
        if (ch.type === CH.CATEGORY) parent = null;
        if (parent && !ctx.channels.some((c) => c.id === parent && c.type === CH.CATEGORY)) parent = ch.parent_id;
        await q.query('UPDATE channels SET position = $2, parent_id = $3 WHERE id = $1', [ch.id, clampInt(it.position, 0, 10000, 0), parent]);
      }
    });
    await app.gw.syncServer(serverId);
    res.json({ ok: true });
  });

  /* ------------------------------ Invitations ------------------------------ */
  r.post('/servers/:id/invites', async (req, res) => {
    const serverId = String(req.params.id);
    const { userId, perms } = await ctxFor(req, serverId);
    requirePerm(perms, P.CREATE_INVITE);
    const maxUses = clampInt(req.body?.maxUses, 0, 1000, 0);
    const maxAge = clampInt(req.body?.maxAgeSeconds, 0, 30 * 24 * 3600, 7 * 24 * 3600);
    let code = inviteCode();
    while (await app.db.one('SELECT 1 FROM invites WHERE code = $1', [code])) code = inviteCode();
    await app.db.query(
      `INSERT INTO invites (code, server_id, inviter_id, max_uses, expires_at)
       VALUES ($1, $2, $3, $4, CASE WHEN $5::int > 0 THEN now() + make_interval(secs => $5::int) ELSE NULL END)`,
      [code, serverId, userId, maxUses, maxAge],
    );
    const inv = await app.db.one<{ expires_at: Date | null }>('SELECT expires_at FROM invites WHERE code = $1', [code]);
    res.status(201).json({ code, maxUses, expiresAt: inv?.expires_at ? new Date(inv.expires_at).toISOString() : null });
  });

  r.get('/servers/:id/invites', async (req, res) => {
    const serverId = String(req.params.id);
    const { perms } = await ctxFor(req, serverId);
    requirePerm(perms, P.MANAGE_SERVER);
    const rows = await app.db.query<{ code: string; inviter_id: string | null; uses: number; max_uses: number; expires_at: Date | null; created_at: Date }>(
      'SELECT * FROM invites WHERE server_id = $1 AND (expires_at IS NULL OR expires_at > now()) ORDER BY created_at DESC',
      [serverId],
    );
    const users = new Map((await getUsersByIds(app.db, rows.map((r) => r.inviter_id).filter(Boolean) as string[])).map((u) => [u.id, publicUser(u)]));
    res.json(
      rows.map((i) => ({
        code: i.code,
        inviter: i.inviter_id ? users.get(i.inviter_id) ?? null : null,
        uses: i.uses,
        maxUses: i.max_uses,
        expiresAt: i.expires_at ? new Date(i.expires_at).toISOString() : null,
        createdAt: new Date(i.created_at).toISOString(),
      })),
    );
  });

  /* ------------------------------ Emojis & stickers ------------------------------ */
  const emojiUpload = makeUpload(app.uploadsDir, 'emojis', { maxBytes: 2 * 1024 * 1024, maxFiles: 1, field: 'file' });
  r.post('/servers/:id/emojis', emojiUpload, async (req, res) => {
    const serverId = String(req.params.id);
    try {
      const { perms } = await ctxFor(req, serverId);
      requirePerm(perms, P.MANAGE_EMOJIS);
    } catch (e) {
      discardFiles(req.file ? [req.file] : []);
      throw e;
    }
    const kind = req.body?.kind === 'sticker' ? 'sticker' : 'emoji';
    const rawName = String(req.body?.name ?? '').trim();
    if (!/^[a-zA-Z0-9_]{2,32}$/.test(rawName)) {
      discardFiles(req.file ? [req.file] : []);
      throw new HttpError(400, 'Nom invalide (2 à 32 caractères : lettres, chiffres, « _ »).', 'VALIDATION');
    }
    const count = await app.db.one<{ n: number }>('SELECT count(*)::int AS n FROM emojis WHERE server_id = $1 AND kind = $2', [serverId, kind]);
    if ((count?.n ?? 0) >= (kind === 'emoji' ? 200 : 60)) {
      discardFiles(req.file ? [req.file] : []);
      throw new HttpError(400, 'Limite atteinte pour ce serveur.', 'LIMIT');
    }
    const img = acceptImage(req.file, { allowAnimated: true });
    await persistUpload('emojis', img.filename);
    const id = snowflake();
    await app.db.query('INSERT INTO emojis (id, server_id, name, kind, path, animated, creator_id) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
      id,
      serverId,
      rawName,
      kind,
      publicPath('emojis', img.filename),
      img.animated,
      uid(req),
    ]);
    await app.gw.syncServer(serverId);
    res.status(201).json({ id });
  });

  r.delete('/servers/:id/emojis/:emojiId', async (req, res) => {
    const serverId = String(req.params.id);
    const { perms } = await ctxFor(req, serverId);
    requirePerm(perms, P.MANAGE_EMOJIS);
    const row = await app.db.one<{ path: string }>('DELETE FROM emojis WHERE id = $1 AND server_id = $2 RETURNING path', [
      String(req.params.emojiId),
      serverId,
    ]);
    ensure(row, 404, 'Emoji introuvable.');
    removeUpload(app.uploadsDir, row.path);
    await app.gw.syncServer(serverId);
    res.json({ ok: true });
  });

  /* ------------------------------ Modération vocale ------------------------------ */
  r.patch('/servers/:id/voice/:userId', async (req, res) => {
    const serverId = String(req.params.id);
    const { ctx, userId, perms } = await ctxFor(req, serverId);
    const targetId = String(req.params.userId);
    requirePerm(perms, P.MUTE_MEMBERS);
    if (targetId !== userId) ensure(canActOn(ctx, userId, targetId), 403, 'Ce membre a un rôle supérieur ou égal au tien.');
    if (typeof req.body?.mute === 'boolean') await app.gw.setServerMute(serverId, targetId, req.body.mute);
    if (req.body?.disconnect) {
      const vs = app.gw.getVoiceState(targetId);
      if (vs?.serverId === serverId) await app.gw.voiceLeave(targetId, true);
    }
    res.json({ ok: true });
  });

  /* ------------------------------ Recherche ------------------------------ */
  r.get('/servers/:id/search', async (req, res) => {
    const serverId = String(req.params.id);
    const { ctx, userId } = await ctxFor(req, serverId);
    const q = String(req.query.q ?? '').trim().slice(0, 200);
    ensure(q.length >= 1, 400, 'Recherche vide.');
    const readable = ctx.channels
      .filter((c) => c.type === CH.TEXT && (channelPermissions(ctx, userId, c) & (P.VIEW_CHANNEL | P.READ_HISTORY)) === (P.VIEW_CHANNEL | P.READ_HISTORY))
      .map((c) => c.id);
    const result = await searchMessages(app, readable, q, req.query.authorId ? String(req.query.authorId) : null, clampInt(req.query.offset, 0, 5000, 0));
    res.json(result);
  });

  return r;
}

export async function searchMessages(app: AppCtx, channelIds: string[], q: string, authorId: string | null, offset: number) {
  if (!channelIds.length) return { total: 0, messages: [] };
  const pattern = '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
  const params: unknown[] = [channelIds, pattern];
  let where = 'channel_id = ANY($1::text[]) AND content ILIKE $2 AND type = 0';
  if (authorId) {
    params.push(authorId);
    where += ` AND author_id = $${params.length}`;
  }
  const total = await app.db.one<{ n: number }>(`SELECT count(*)::int AS n FROM messages WHERE ${where}`, params);
  const rows = await app.db.query<MessageRow>(`SELECT * FROM messages WHERE ${where} ORDER BY id DESC LIMIT 25 OFFSET ${offset}`, params);
  return { total: total?.n ?? 0, messages: await hydrateMessages(app.db, rows) };
}
