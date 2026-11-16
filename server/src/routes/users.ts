import { Router } from 'express';
import { requireAuth, uid } from '../auth.js';
import type { AppCtx } from '../context.js';
import { acceptImage, makeUpload, persistUpload, publicPath, removeUpload } from '../files.js';
import { getLimits, NITRO_LIMITS } from '../nitro.js';
import { CH } from '../permissions.js';
import { DEFAULT_SETTINGS, getUserRow, publicUser, selfUser, USER_SELECT, type UserRow } from '../serialize.js';
import { privateChannelPayload } from '../state.js';
import { ensure, HttpError, isHexColor, optStr, RateLimiter, rateLimitOrThrow, snowflake, str, USERNAME_RE } from '../util.js';

const friendLimiter = new RateLimiter(20, 10 * 60_000);
const STATUSES = ['online', 'idle', 'dnd', 'invisible'];

/** Nettoie les paramètres envoyés par le client (liste blanche + types). */
function sanitizeSettings(input: any, current: Record<string, any>) {
  const out: Record<string, any> = { ...DEFAULT_SETTINGS, ...current };
  if (!input || typeof input !== 'object') return out;
  if (['fr', 'en'].includes(input.locale)) out.locale = input.locale;
  if (['dark', 'light', 'midnight', 'aurora', 'sunset', 'ocean', 'forest', 'sakura'].includes(input.theme)) out.theme = input.theme;
  if (isHexColor(input.accent)) out.accent = input.accent;
  if (typeof input.fontScale === 'number') out.fontScale = Math.min(130, Math.max(80, Math.round(input.fontScale)));
  if (typeof input.compact === 'boolean') out.compact = input.compact;
  if (typeof input.reducedMotion === 'boolean') out.reducedMotion = input.reducedMotion;
  if (['everyone', 'friends', 'none'].includes(input.dmPrivacy)) out.dmPrivacy = input.dmPrivacy;
  if (['everyone', 'mutual', 'none'].includes(input.friendRequests)) out.friendRequests = input.friendRequests;
  if (typeof input.showActivity === 'boolean') out.showActivity = input.showActivity;
  if (typeof input.motion === 'boolean') out.motion = input.motion;
  if (input.notifications && typeof input.notifications === 'object') {
    const n = { ...DEFAULT_SETTINGS.notifications, ...(current.notifications || {}) };
    for (const k of ['desktop', 'sounds', 'mentionsOnly', 'dmNotifications'] as const) {
      if (typeof input.notifications[k] === 'boolean') n[k] = input.notifications[k];
    }
    out.notifications = n;
  }
  return out;
}

export function userRoutes(app: AppCtx) {
  const r = Router();
  r.use(requireAuth);

  async function broadcastUser(userId: string) {
    const row = await getUserRow(app.db, userId);
    if (!row) return;
    app.gw.sendToUser(userId, 'USER_UPDATE', { user: selfUser(row), self: true });
    const related = await app.gw.relatedUserIds(userId);
    app.gw.sendToUsers(related, 'USER_UPDATE', { user: publicUser(row) }, userId);
    return row;
  }

  /* ----------------------------- Profil ---------------------------- */
  r.patch('/users/@me', async (req, res) => {
    const userId = uid(req);
    const me = await getUserRow(app.db, userId);
    ensure(me, 404, 'Utilisateur introuvable.');
    const limits = await getLimits(app.db, userId);
    const b = req.body ?? {};
    const sets: string[] = [];
    const vals: unknown[] = [userId];
    const set = (col: string, v: unknown) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };

    if (b.username !== undefined) {
      const username = str(b.username, 'pseudonyme', { min: 2, max: 32 });
      ensure(USERNAME_RE.test(username), 400, 'Pseudonyme invalide (lettres, chiffres, « _ » et « . »).');
      if (username.toLowerCase() !== me.username.toLowerCase()) {
        const taken = await app.db.one('SELECT 1 FROM users WHERE username_lower = $1', [username.toLowerCase()]);
        ensure(!taken, 409, 'Ce pseudonyme est déjà pris.');
      }
      set('username', username);
      set('username_lower', username.toLowerCase());
    }
    if (b.displayName !== undefined) set('display_name', optStr(b.displayName, "nom d'affichage", 32) || null);
    if (b.bio !== undefined) set('bio', optStr(b.bio, 'biographie', 300) ?? '');
    if (b.pronouns !== undefined) set('pronouns', optStr(b.pronouns, 'pronoms', 40) ?? '');
    if (b.bannerColor !== undefined) set('banner_color', isHexColor(b.bannerColor) ? b.bannerColor : null);
    if (b.accentColor !== undefined) set('accent_color', isHexColor(b.accentColor) ? b.accentColor : null);
    if (b.profileTheme !== undefined) {
      if (b.profileTheme === null) set('profile_theme', null);
      else {
        if (!limits.profileThemes) throw new HttpError(403, 'Les thèmes de profil nécessitent endBuy Nitro.', 'NITRO_REQUIRED');
        const t = b.profileTheme;
        ensure(isHexColor(t?.primary) && isHexColor(t?.secondary), 400, 'Thème de profil invalide.');
        set('profile_theme', JSON.stringify({ primary: t.primary, secondary: t.secondary }));
      }
    }
    let presenceChanged = false;
    if (b.status !== undefined) {
      ensure(STATUSES.includes(b.status), 400, 'Statut invalide.');
      set('status', b.status);
      presenceChanged = true;
    }
    if (b.customStatus !== undefined) {
      set('custom_status', optStr(b.customStatus, 'statut personnalisé', 128) ?? '');
      presenceChanged = true;
    }
    if (b.customStatusEmoji !== undefined) {
      set('custom_status_emoji', optStr(b.customStatusEmoji, 'emoji de statut', 64) || null);
      presenceChanged = true;
    }
    if (b.settings !== undefined) set('settings', JSON.stringify(sanitizeSettings(b.settings, me.settings)));

    if (sets.length) await app.db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1`, vals);
    const row = await broadcastUser(userId);
    if (presenceChanged) await app.gw.updatePrefs(userId);
    res.json({ user: selfUser(row!) });
  });

  const avatarUpload = makeUpload(app.uploadsDir, 'avatars', { maxBytes: NITRO_LIMITS.maxAvatarBytes, maxFiles: 1, field: 'file' });
  r.post('/users/@me/avatar', avatarUpload, async (req, res) => {
    const userId = uid(req);
    const limits = await getLimits(app.db, userId);
    ensure(req.file, 400, 'Aucune image reçue.');
    if (req.file.size > limits.maxAvatarBytes) throw new HttpError(413, 'Image trop volumineuse.', 'FILE_TOO_LARGE');
    const img = acceptImage(req.file, { allowAnimated: limits.animatedAvatar });
    await persistUpload('avatars', img.filename);
    const old = await app.db.one<{ avatar: string | null }>('SELECT avatar FROM users WHERE id = $1', [userId]);
    await app.db.query('UPDATE users SET avatar = $2 WHERE id = $1', [userId, publicPath('avatars', img.filename)]);
    removeUpload(app.uploadsDir, old?.avatar);
    const row = await broadcastUser(userId);
    res.json({ user: selfUser(row!) });
  });

  r.delete('/users/@me/avatar', async (req, res) => {
    const userId = uid(req);
    const old = await app.db.one<{ avatar: string | null }>('SELECT avatar FROM users WHERE id = $1', [userId]);
    await app.db.query('UPDATE users SET avatar = NULL WHERE id = $1', [userId]);
    removeUpload(app.uploadsDir, old?.avatar);
    const row = await broadcastUser(userId);
    res.json({ user: selfUser(row!) });
  });

  const bannerUpload = makeUpload(app.uploadsDir, 'banners', { maxBytes: NITRO_LIMITS.maxBannerBytes, maxFiles: 1, field: 'file' });
  r.post('/users/@me/banner', bannerUpload, async (req, res) => {
    const userId = uid(req);
    const limits = await getLimits(app.db, userId);
    if (!limits.customBanner) throw new HttpError(403, 'Les bannières personnalisées nécessitent endBuy Nitro.', 'NITRO_REQUIRED');
    ensure(req.file, 400, 'Aucune image reçue.');
    const img = acceptImage(req.file, { allowAnimated: true });
    await persistUpload('banners', img.filename);
    const old = await app.db.one<{ banner: string | null }>('SELECT banner FROM users WHERE id = $1', [userId]);
    await app.db.query('UPDATE users SET banner = $2 WHERE id = $1', [userId, publicPath('banners', img.filename)]);
    removeUpload(app.uploadsDir, old?.banner);
    const row = await broadcastUser(userId);
    res.json({ user: selfUser(row!) });
  });

  r.delete('/users/@me/banner', async (req, res) => {
    const userId = uid(req);
    const old = await app.db.one<{ banner: string | null }>('SELECT banner FROM users WHERE id = $1', [userId]);
    await app.db.query('UPDATE users SET banner = NULL WHERE id = $1', [userId]);
    removeUpload(app.uploadsDir, old?.banner);
    const row = await broadcastUser(userId);
    res.json({ user: selfUser(row!) });
  });

  /** Profil complet d'un utilisateur (avec serveurs et amis en commun). */
  r.get('/users/:id', async (req, res) => {
    const me = uid(req);
    const id = String(req.params.id);
    const row = await getUserRow(app.db, id);
    ensure(row, 404, 'Utilisateur introuvable.');
    const [mutualServers, mutualFriends, rel] = await Promise.all([
      app.db.query<{ server_id: string }>(
        'SELECT m1.server_id FROM members m1 JOIN members m2 ON m1.server_id = m2.server_id WHERE m1.user_id = $1 AND m2.user_id = $2',
        [me, id],
      ),
      app.db.query<{ target_id: string }>(
        `SELECT r1.target_id FROM relationships r1 JOIN relationships r2 ON r1.target_id = r2.target_id
         WHERE r1.user_id = $1 AND r2.user_id = $2 AND r1.type = 1 AND r2.type = 1`,
        [me, id],
      ),
      app.db.one<{ type: number }>('SELECT type FROM relationships WHERE user_id = $1 AND target_id = $2', [me, id]),
    ]);
    res.json({
      user: publicUser(row),
      presence: app.gw.presenceOf(id),
      mutualServers: mutualServers.map((s) => s.server_id),
      mutualFriends: me === id ? [] : mutualFriends.map((f) => f.target_id),
      relationship: rel?.type ?? 0,
    });
  });

  /* ---------------------------- Amis ------------------------------- */
  async function relEvent(userId: string, targetId: string) {
    const rel = await app.db.one<{ type: number; created_at: Date }>(
      'SELECT type, created_at FROM relationships WHERE user_id = $1 AND target_id = $2',
      [userId, targetId],
    );
    const target = await getUserRow(app.db, targetId);
    if (!target) return;
    if (rel) {
      app.gw.sendToUser(userId, 'RELATIONSHIP_ADD', {
        relationship: { id: targetId, type: rel.type, since: new Date(rel.created_at).toISOString() },
        user: publicUser(target),
        presence: app.gw.presenceOf(targetId),
      });
    } else {
      app.gw.sendToUser(userId, 'RELATIONSHIP_REMOVE', { id: targetId });
    }
  }

  async function makeFriends(a: string, b: string) {
    await app.db.query(
      `INSERT INTO relationships (user_id, target_id, type) VALUES ($1, $2, 1), ($2, $1, 1)
       ON CONFLICT (user_id, target_id) DO UPDATE SET type = 1, created_at = now()`,
      [a, b],
    );
  }

  r.post('/users/@me/relationships', async (req, res) => {
    const me = uid(req);
    rateLimitOrThrow(friendLimiter, me, "Trop de demandes d'ami. Réessaie plus tard.");
    const username = str(req.body?.username, 'pseudonyme', { max: 64 }).toLowerCase();
    const target = await app.db.one<UserRow>(`${USER_SELECT} WHERE u.username_lower = $1`, [username]);
    const notFound = new HttpError(404, "Aucun utilisateur ne porte ce pseudonyme. Vérifie l'orthographe.", 'USER_NOT_FOUND');
    if (!target) throw notFound;
    ensure(target.id !== me, 400, "Tu ne peux pas t'ajouter toi-même en ami.");
    const [mine, theirs] = await Promise.all([
      app.db.one<{ type: number }>('SELECT type FROM relationships WHERE user_id = $1 AND target_id = $2', [me, target.id]),
      app.db.one<{ type: number }>('SELECT type FROM relationships WHERE user_id = $1 AND target_id = $2', [target.id, me]),
    ]);
    if (theirs?.type === 2) throw notFound; // bloqué par la cible : on ne le révèle pas
    if (mine?.type === 1) throw new HttpError(400, 'Vous êtes déjà amis.', 'ALREADY_FRIENDS');
    if (mine?.type === 4) throw new HttpError(400, "Demande d'ami déjà envoyée.", 'ALREADY_SENT');
    if (mine?.type === 3) {
      await makeFriends(me, target.id);
    } else {
      const pref = { ...DEFAULT_SETTINGS, ...(target.settings || {}) }.friendRequests;
      if (pref === 'none') throw new HttpError(403, "Cet utilisateur n'accepte pas les demandes d'ami.", 'FRIEND_REQUESTS_CLOSED');
      if (pref === 'mutual') {
        const mutual = await app.db.one(
          'SELECT 1 FROM members m1 JOIN members m2 ON m1.server_id = m2.server_id WHERE m1.user_id = $1 AND m2.user_id = $2 LIMIT 1',
          [me, target.id],
        );
        if (!mutual) throw new HttpError(403, "Cet utilisateur n'accepte que les demandes de membres de ses serveurs.", 'FRIEND_REQUESTS_CLOSED');
      }
      await app.db.query(
        `INSERT INTO relationships (user_id, target_id, type) VALUES ($1, $2, 4), ($2, $1, 3)
         ON CONFLICT (user_id, target_id) DO UPDATE SET type = EXCLUDED.type, created_at = now()`,
        [me, target.id],
      );
    }
    await relEvent(me, target.id);
    await relEvent(target.id, me);
    res.json({ ok: true });
  });

  r.put('/users/@me/relationships/:id', async (req, res) => {
    const me = uid(req);
    const targetId = String(req.params.id);
    ensure(targetId !== me, 400, 'Action impossible.');
    const target = await getUserRow(app.db, targetId);
    ensure(target, 404, 'Utilisateur introuvable.');
    const type = Number(req.body?.type ?? 1);
    if (type === 1) {
      const mine = await app.db.one<{ type: number }>('SELECT type FROM relationships WHERE user_id = $1 AND target_id = $2', [me, targetId]);
      ensure(mine?.type === 3, 400, "Aucune demande d'ami à accepter.");
      await makeFriends(me, targetId);
    } else if (type === 2) {
      await app.db.query(
        `INSERT INTO relationships (user_id, target_id, type) VALUES ($1, $2, 2)
         ON CONFLICT (user_id, target_id) DO UPDATE SET type = 2, created_at = now()`,
        [me, targetId],
      );
      await app.db.query('DELETE FROM relationships WHERE user_id = $1 AND target_id = $2 AND type <> 2', [targetId, me]);
    } else {
      throw new HttpError(400, 'Type de relation invalide.');
    }
    await relEvent(me, targetId);
    await relEvent(targetId, me);
    res.json({ ok: true });
  });

  r.delete('/users/@me/relationships/:id', async (req, res) => {
    const me = uid(req);
    const targetId = String(req.params.id);
    await app.db.query('DELETE FROM relationships WHERE user_id = $1 AND target_id = $2', [me, targetId]);
    await app.db.query('DELETE FROM relationships WHERE user_id = $1 AND target_id = $2 AND type <> 2', [targetId, me]);
    await relEvent(me, targetId);
    await relEvent(targetId, me);
    res.json({ ok: true });
  });

  /* ---------------------- Messages privés -------------------------- */
  r.post('/users/@me/channels', async (req, res) => {
    const me = uid(req);
    const ids: string[] = Array.isArray(req.body?.recipientIds)
      ? req.body.recipientIds.map(String)
      : req.body?.recipientId
        ? [String(req.body.recipientId)]
        : [];
    const recipients = [...new Set(ids)].filter((id) => id !== me);
    ensure(recipients.length >= 1, 400, 'Choisis au moins un destinataire.');
    ensure(recipients.length <= 9, 400, 'Un groupe peut contenir au maximum 10 personnes.');

    if (recipients.length === 1 && !req.body?.group) {
      const targetId = recipients[0];
      const target = await getUserRow(app.db, targetId);
      ensure(target, 404, 'Utilisateur introuvable.');
      const existing = await app.db.one<{ id: string }>(
        `SELECT c.id FROM channels c
         JOIN channel_recipients a ON a.channel_id = c.id AND a.user_id = $1
         JOIN channel_recipients b ON b.channel_id = c.id AND b.user_id = $2
         WHERE c.type = ${CH.DM} LIMIT 1`,
        [me, targetId],
      );
      if (existing) {
        await app.db.query('UPDATE channel_recipients SET closed = false WHERE channel_id = $1 AND user_id = $2', [existing.id, me]);
        const payload = await privateChannelPayload(app, existing.id, me);
        app.gw.sendToUser(me, 'CHANNEL_CREATE', { channel: payload, users: [publicUser(target)] });
        return res.json(payload);
      }
      const blocked = await app.db.one(
        'SELECT 1 FROM relationships WHERE ((user_id = $1 AND target_id = $2) OR (user_id = $2 AND target_id = $1)) AND type = 2',
        [me, targetId],
      );
      ensure(!blocked, 403, "Impossible d'envoyer un message privé à cet utilisateur.");
      const privacy = { ...DEFAULT_SETTINGS, ...(target.settings || {}) }.dmPrivacy;
      if (privacy !== 'everyone') {
        const friend = await app.db.one('SELECT 1 FROM relationships WHERE user_id = $1 AND target_id = $2 AND type = 1', [me, targetId]);
        if (privacy === 'none' || !friend) {
          throw new HttpError(403, "Cet utilisateur n'accepte pas les messages privés de ta part.", 'DM_CLOSED');
        }
      }
      const channelId = snowflake();
      await app.db.tx(async (q) => {
        await q.query(`INSERT INTO channels (id, type) VALUES ($1, ${CH.DM})`, [channelId]);
        await q.query('INSERT INTO channel_recipients (channel_id, user_id, closed) VALUES ($1, $2, false), ($1, $3, true)', [
          channelId,
          me,
          targetId,
        ]);
      });
      const meRow = await getUserRow(app.db, me);
      const payload = await privateChannelPayload(app, channelId, me);
      app.gw.sendToUser(me, 'CHANNEL_CREATE', { channel: payload, users: [publicUser(target)] });
      app.gw.sendToUser(targetId, 'CHANNEL_CREATE', {
        channel: await privateChannelPayload(app, channelId, targetId),
        users: [publicUser(meRow!)],
      });
      return res.json(payload);
    }

    // Groupe privé : uniquement avec des amis.
    const friends = await app.db.query<{ target_id: string }>(
      'SELECT target_id FROM relationships WHERE user_id = $1 AND type = 1 AND target_id = ANY($2::text[])',
      [me, recipients],
    );
    ensure(friends.length === recipients.length, 403, 'Tu ne peux créer un groupe qu’avec tes amis.');
    const name = optStr(req.body?.name, 'nom du groupe', 100) ?? '';
    const channelId = snowflake();
    await app.db.tx(async (q) => {
      await q.query(`INSERT INTO channels (id, type, name, owner_id) VALUES ($1, ${CH.GROUP_DM}, $2, $3)`, [channelId, name, me]);
      for (const u of [me, ...recipients]) {
        await q.query('INSERT INTO channel_recipients (channel_id, user_id) VALUES ($1, $2)', [channelId, u]);
      }
    });
    const users = (await app.db.query<UserRow>(`${USER_SELECT} WHERE u.id = ANY($1::text[])`, [[me, ...recipients]])).map(publicUser);
    for (const u of [me, ...recipients]) {
      app.gw.sendToUser(u, 'CHANNEL_CREATE', { channel: await privateChannelPayload(app, channelId, u), users });
    }
    res.json(await privateChannelPayload(app, channelId, me));
  });

  return r;
}
