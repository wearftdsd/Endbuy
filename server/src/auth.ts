import type { NextFunction, Request, Response } from 'express';
import type { AppCtx } from './context.js';
import type { Queryable } from './db.js';
import { HttpError, parseCookies, parseUserAgent, randomToken, sha256, snowflake } from './util.js';

export const SESSION_COOKIE = 'endbuy_session';
const SESSION_DAYS = 30;

export interface AuthInfo {
  userId: string;
  sessionId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthInfo;
    }
  }
}

export function clientIp(req: Request): string {
  return (req.ip || req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}

export async function createSession(q: Queryable, userId: string, req: Request): Promise<{ token: string; sessionId: string }> {
  const token = randomToken(32);
  const sessionId = snowflake();
  const ua = String(req.headers['user-agent'] || '').slice(0, 400);
  await q.query(
    `INSERT INTO sessions (id, user_id, token_hash, device, user_agent, ip, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() + interval '${SESSION_DAYS} days')`,
    [sessionId, userId, sha256(token), parseUserAgent(ua), ua, clientIp(req)],
  );
  return { token, sessionId };
}

export function setSessionCookie(req: Request, res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    path: '/',
    maxAge: SESSION_DAYS * 24 * 3600 * 1000,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

const lastTouch = new Map<string, number>();

/** Valide un jeton de session (cookie). Met à jour la date d'activité au plus toutes les 5 min. */
export async function authenticateToken(app: AppCtx, token: string | undefined, ip?: string): Promise<AuthInfo | null> {
  if (!token || token.length > 200) return null;
  const row = await app.db.one<{ id: string; user_id: string; expires_at: Date }>(
    'SELECT id, user_id, expires_at FROM sessions WHERE token_hash = $1',
    [sha256(token)],
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await app.db.query('DELETE FROM sessions WHERE id = $1', [row.id]);
    return null;
  }
  const last = lastTouch.get(row.id) ?? 0;
  if (Date.now() - last > 5 * 60_000) {
    lastTouch.set(row.id, Date.now());
    await app.db.query(
      `UPDATE sessions SET last_seen_at = now(), ip = COALESCE($2, ip), expires_at = now() + interval '${SESSION_DAYS} days' WHERE id = $1`,
      [row.id, ip ?? null],
    );
  }
  return { userId: row.user_id, sessionId: row.id };
}

export function tokenFromCookieHeader(header: string | undefined) {
  return parseCookies(header)[SESSION_COOKIE];
}

export function sessionMiddleware(app: AppCtx) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const auth = await authenticateToken(app, tokenFromCookieHeader(req.headers.cookie), clientIp(req));
      if (auth) req.auth = auth;
      next();
    } catch (e) {
      next(e);
    }
  };
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(new HttpError(401, 'Tu dois être connecté.', 'UNAUTHORIZED'));
  next();
}

/**
 * Protection CSRF : toute requête modifiante doit porter l'en-tête `X-Requested-With: endBuy`.
 * Un site tiers ne peut pas l'ajouter sans pré-vol CORS (refusé par ce serveur).
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (req.headers['x-requested-with'] !== 'endBuy') {
    return next(new HttpError(403, 'Requête refusée (protection CSRF).', 'CSRF'));
  }
  next();
}

export function uid(req: Request): string {
  if (!req.auth) throw new HttpError(401, 'Tu dois être connecté.', 'UNAUTHORIZED');
  return req.auth.userId;
}
