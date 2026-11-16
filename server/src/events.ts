import { Router, type Request } from 'express';
import { requireAuth, uid } from './auth.js';
import type { AppCtx } from './context.js';
import type { Queryable } from './db.js';
import { basePermissions, channelPermissions, CH, isVoiceLike, P, requirePerm, type ServerPermContext } from './permissions.js';
import { ensure, HttpError, optStr, RateLimiter, rateLimitOrThrow, snowflake, str } from './util.js';

/**
 * Événements programmés (soirées, tournois, conférences…) et contrôle des salons de conférence.
 * Statuts : 1 = programmé, 2 = en cours, 3 = terminé, 4 = annulé.
 */
export const EV = { SCHEDULED: 1, ACTIVE: 2, COMPLETED: 3, CANCELED: 4 } as const;

interface EventRow {
  id: string;
  server_id: string;
  creator_id: string | null;
  channel_id: string | null;
  location: string;
  name: string;
  description: string;
  starts_at: Date;
  ends_at: Date | null;
  status: number;
  reminded: boolean;
  created_at: Date;
}

export function serializeEvent(e: EventRow, interestedIds: string[]) {
  return {
    id: e.id,
    serverId: e.server_id,
    creatorId: e.creator_id,
    channelId: e.channel_id,
    location: e.location,
    name: e.name,
    description: e.description,
    startsAt: new Date(e.starts_at).toISOString(),
    endsAt: e.ends_at ? new Date(e.ends_at).toISOString() : null,
    status: e.status,
    interestedIds,
    createdAt: new Date(e.created_at).toISOString(),
  };
}
export type EventDTO = ReturnType<typeof serializeEvent>;

/** Événements à venir ou en cours d'un serveur. */
export async function loadEvents(q: Queryable, serverId: string): Promise<EventDTO[]> {
  const rows = await q.query<EventRow>(
    `SELECT * FROM events WHERE server_id = $1 AND (status IN (1, 2) OR (status = 3 AND ends_at > now() - interval '1 hour'))
     ORDER BY starts_at ASC`,
    [serverId],
  );
  if (!rows.length) return [];
  const users = await q.query<{ event_id: string; user_id: string }>(
    'SELECT event_id, user_id FROM event_users WHERE event_id = ANY($1::text[]) ORDER BY created_at',
    [rows.map((r) => r.id)],
  );
  return rows.map((r) => serializeEvent(r, users.filter((u) => u.event_id === r.id).map((u) => u.user_id)));
}

async function loadEvent(q: Queryable, id: string): Promise<EventDTO | null> {
  const row = await q.one<EventRow>('SELECT * FROM events WHERE id = $1', [id]);
  if (!row) return null;
  const users = await q.query<{ user_id: string }>('SELECT user_id FROM event_users WHERE event_id = $1 ORDER BY created_at', [id]);
  return serializeEvent(row, users.map((u) => u.user_id));
}

export async function broadcastEvent(app: AppCtx, serverId: string, eventId: string) {
  const ev = await loadEvent(app.db, eventId);
  const members = await app.gw.serverMemberIds(serverId);
  if (ev) app.gw.sendToUsers(members, 'EVENT_UPDATE', { event: ev });
  else app.gw.sendToUsers(members, 'EVENT_DELETE', { id: eventId, serverId });
  return ev;
}

const createLimiter = new RateLimiter(20, 60 * 60_000);

function parseDate(v: unknown, field: string): Date {
  const d = new Date(String(v ?? ''));
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `Date invalide (${field}).`, 'VALIDATION');
  return d;
}

export function eventRoutes(app: AppCtx) {
  const r = Router();
  r.use(requireAuth);

  async function ctxFor(req: Request, serverId: string): Promise<{ ctx: ServerPermContext; userId: string; perms: number }> {
    const userId = uid(req);
    const ctx = await app.perms.get(serverId);
    if (!ctx || !ctx.memberRoles.has(userId)) throw new HttpError(404, 'Serveur introuvable.', 'UNKNOWN_SERVER');
    return { ctx, userId, perms: basePermissions(ctx, userId) };
  }

  function validateLocation(ctx: ServerPermContext, body: any) {
    const channelId = body?.channelId ? String(body.channelId) : null;
    if (channelId) {
      const ch = ctx.channels.find((c) => c.id === channelId);
      ensure(ch && isVoiceLike(ch.type), 400, 'Choisis un salon vocal ou un salon de conférence.');
      return { channelId, location: '' };
    }
    const location = str(body?.location, 'lieu', { min: 1, max: 100 });
    return { channelId: null, location };
  }

  r.get('/servers/:id/events', async (req, res) => {
    const serverId = String(req.params.id);
    await ctxFor(req, serverId);
    res.json(await loadEvents(app.db, serverId));
  });

  r.post('/servers/:id/events', async (req, res) => {
    const serverId = String(req.params.id);
    const { ctx, userId, perms } = await ctxFor(req, serverId);
    requirePerm(perms, P.MANAGE_EVENTS, "Tu n'as pas la permission de créer des événements.");
    rateLimitOrThrow(createLimiter, userId, 'Tu crées trop d’événements. Réessaie plus tard.');
    const name = str(req.body?.name, "nom de l'événement", { min: 1, max: 100 });
    const description = optStr(req.body?.description, 'description', 1000) ?? '';
    const startsAt = parseDate(req.body?.startsAt, 'début');
    ensure(startsAt.getTime() > Date.now() - 5 * 60_000, 400, "La date de début doit être dans le futur.");
    ensure(startsAt.getTime() < Date.now() + 366 * 24 * 3600_000, 400, "L'événement doit avoir lieu dans l'année.");
    const endsAt = req.body?.endsAt ? parseDate(req.body.endsAt, 'fin') : null;
    if (endsAt) ensure(endsAt.getTime() > startsAt.getTime(), 400, 'La fin doit être après le début.');
    const { channelId, location } = validateLocation(ctx, req.body);
    if (!channelId) ensure(endsAt, 400, 'Un événement « ailleurs » doit avoir une heure de fin.');
    const count = await app.db.one<{ n: number }>('SELECT count(*)::int AS n FROM events WHERE server_id = $1 AND status IN (1, 2)', [serverId]);
    ensure((count?.n ?? 0) < 100, 400, 'Limite de 100 événements à venir atteinte.');
    const id = snowflake();
    await app.db.query(
      `INSERT INTO events (id, server_id, creator_id, channel_id, location, name, description, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, serverId, userId, channelId, location, name, description, startsAt, endsAt],
    );
    await app.db.query('INSERT INTO event_users (event_id, user_id) VALUES ($1, $2)', [id, userId]);
    const ev = await broadcastEvent(app, serverId, id);
    res.status(201).json(ev);
  });

  async function loadEditable(req: Request) {
    const serverId = String(req.params.id);
    const { ctx, userId, perms } = await ctxFor(req, serverId);
    const row = await app.db.one<EventRow>('SELECT * FROM events WHERE id = $1 AND server_id = $2', [String(req.params.eventId), serverId]);
    ensure(row, 404, 'Événement introuvable.');
    if (row.creator_id !== userId) requirePerm(perms, P.MANAGE_EVENTS, "Tu n'as pas la permission de gérer cet événement.");
    return { ctx, userId, row, serverId };
  }

  r.patch('/servers/:id/events/:eventId', async (req, res) => {
    const { ctx, row, serverId } = await loadEditable(req);
    const b = req.body ?? {};
    const sets: string[] = [];
    const vals: unknown[] = [row.id];
    const set = (col: string, v: unknown) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };
    if (b.name !== undefined) set('name', str(b.name, "nom de l'événement", { min: 1, max: 100 }));
    if (b.description !== undefined) set('description', optStr(b.description, 'description', 1000) ?? '');
    if (b.startsAt !== undefined && row.status === EV.SCHEDULED) set('starts_at', parseDate(b.startsAt, 'début'));
    if (b.endsAt !== undefined) set('ends_at', b.endsAt ? parseDate(b.endsAt, 'fin') : null);
    if (b.channelId !== undefined || b.location !== undefined) {
      const loc = validateLocation(ctx, b);
      set('channel_id', loc.channelId);
      set('location', loc.location);
    }
    if (b.status !== undefined) {
      const status = Number(b.status);
      const allowed: Record<number, number[]> = { [EV.SCHEDULED]: [EV.ACTIVE, EV.CANCELED], [EV.ACTIVE]: [EV.COMPLETED] };
      ensure(allowed[row.status]?.includes(status), 400, 'Changement de statut impossible.');
      set('status', status);
      if (status === EV.ACTIVE) {
        set('reminded', true);
        if (row.channel_id) {
          // Le sujet du salon de conférence reprend le nom de l'événement s'il est vide.
          await app.db.query(`UPDATE channels SET topic = $2 WHERE id = $1 AND type = ${CH.STAGE} AND topic = ''`, [row.channel_id, row.name]);
          await app.gw.syncServer(serverId);
        }
      }
      if (status === EV.COMPLETED && !row.ends_at) set('ends_at', new Date());
    }
    if (sets.length) await app.db.query(`UPDATE events SET ${sets.join(', ')} WHERE id = $1`, vals);
    const ev = await broadcastEvent(app, serverId, row.id);
    if (Number(b.status) === EV.ACTIVE && ev) {
      app.gw.sendToUsers(ev.interestedIds, 'EVENT_STARTED', { event: ev });
    }
    res.json(ev);
  });

  r.delete('/servers/:id/events/:eventId', async (req, res) => {
    const { row, serverId } = await loadEditable(req);
    await app.db.query('DELETE FROM events WHERE id = $1', [row.id]);
    await broadcastEvent(app, serverId, row.id);
    res.json({ ok: true });
  });

  r.put('/servers/:id/events/:eventId/users/@me', async (req, res) => {
    const serverId = String(req.params.id);
    const { userId } = await ctxFor(req, serverId);
    const row = await app.db.one<EventRow>('SELECT * FROM events WHERE id = $1 AND server_id = $2', [String(req.params.eventId), serverId]);
    ensure(row && (row.status === EV.SCHEDULED || row.status === EV.ACTIVE), 404, 'Événement introuvable.');
    await app.db.query('INSERT INTO event_users (event_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [row.id, userId]);
    res.json(await broadcastEvent(app, serverId, row.id));
  });

  r.delete('/servers/:id/events/:eventId/users/@me', async (req, res) => {
    const serverId = String(req.params.id);
    const { userId } = await ctxFor(req, serverId);
    await app.db.query('DELETE FROM event_users WHERE event_id = $1 AND user_id = $2', [String(req.params.eventId), userId]);
    res.json(await broadcastEvent(app, serverId, String(req.params.eventId)));
  });

  /* ------------------------- Salons de conférence ------------------------- */
  r.patch('/servers/:id/stage/:userId', async (req, res) => {
    const serverId = String(req.params.id);
    const { ctx, userId } = await ctxFor(req, serverId);
    const targetId = req.params.userId === '@me' ? userId : String(req.params.userId);
    const vs = app.gw.getVoiceState(targetId);
    ensure(vs && vs.serverId === serverId, 404, "Ce membre n'est pas dans un salon de conférence.");
    const channel = ctx.channels.find((c) => c.id === vs.channelId);
    ensure(channel && channel.type === CH.STAGE, 400, "Ce membre n'est pas dans un salon de conférence.");
    const myPerms = channelPermissions(ctx, userId, channel);
    const speaker = !!req.body?.speaker;
    const isModerator = (myPerms & P.MUTE_MEMBERS) === P.MUTE_MEMBERS;
    if (!(targetId === userId && !speaker)) {
      ensure(isModerator, 403, 'Seuls les modérateurs de la conférence peuvent gérer les orateurs.');
    }
    const targetPerms = channelPermissions(ctx, targetId, channel);
    await app.gw.setStageSpeaker(targetId, speaker, !(targetPerms & P.SPEAK));
    res.json({ ok: true });
  });

  return r;
}

/** Rappels au début des événements, fin automatique, annulation des événements jamais lancés. */
export function startEventScheduler(app: AppCtx) {
  const tick = async () => {
    try {
      const due = await app.db.query<EventRow>(
        `UPDATE events SET reminded = true WHERE status = ${EV.SCHEDULED} AND reminded = false AND starts_at <= now() RETURNING *`,
      );
      for (const e of due) {
        const ev = await loadEvent(app.db, e.id);
        if (ev) app.gw.sendToUsers(ev.interestedIds, 'EVENT_REMINDER', { event: ev });
      }
      const ended = await app.db.query<EventRow>(
        `UPDATE events SET status = ${EV.COMPLETED} WHERE status = ${EV.ACTIVE} AND ends_at IS NOT NULL AND ends_at < now() RETURNING *`,
      );
      const stale = await app.db.query<EventRow>(
        `UPDATE events SET status = ${EV.CANCELED} WHERE status = ${EV.SCHEDULED} AND starts_at < now() - interval '6 hours' RETURNING *`,
      );
      for (const e of [...ended, ...stale]) await broadcastEvent(app, e.server_id, e.id);
    } catch (e) {
      console.error('[endBuy] planificateur d’événements', e);
    }
  };
  const timer = setInterval(tick, 30_000);
  timer.unref();
  tick();
  return () => clearInterval(timer);
}
