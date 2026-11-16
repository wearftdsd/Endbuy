import { Router, type Request } from 'express';
import {
  clearSessionCookie,
  clientIp,
  createSession,
  requireAuth,
  setSessionCookie,
  uid,
} from '../auth.js';
import type { AppCtx } from '../context.js';
import type { Queryable } from '../db.js';
import { grantLifetimeNitro, NITRO_NAME, NITRO_PERKS } from '../nitro.js';
import { getUserRow, selfUser, USER_SELECT, type UserRow } from '../serialize.js';
import {
  burnPasswordCheck,
  clampInt,
  ensure,
  generateRecoveryCodes,
  generateTotpSecret,
  hashPassword,
  HttpError,
  normalizeRecoveryCode,
  RateLimiter,
  rateLimitOrThrow,
  sha256,
  snowflake,
  str,
  USERNAME_RE,
  verifyPassword,
  verifyTotp,
} from '../util.js';

const loginIpLimiter = new RateLimiter(30, 15 * 60_000);
const loginUserLimiter = new RateLimiter(10, 15 * 60_000);
const registerLimiter = new RateLimiter(8, 60 * 60_000);
const recoverLimiter = new RateLimiter(6, 60 * 60_000);
const sensitiveLimiter = new RateLimiter(10, 15 * 60_000);

const MAX_FAILED = 8;
const LOCK_MINUTES = 15;

function validatePassword(password: unknown, username?: string): string {
  const p = str(password, 'mot de passe', { min: 8, max: 128, trim: false });
  if (username && p.toLowerCase() === username.toLowerCase()) {
    throw new HttpError(400, 'Le mot de passe ne peut pas être identique au pseudonyme.', 'VALIDATION');
  }
  if (/^(.)\1+$/.test(p) || ['password', 'motdepasse', '12345678', '123456789', 'azertyui', 'qwertyui'].includes(p.toLowerCase())) {
    throw new HttpError(400, 'Ce mot de passe est trop facile à deviner.', 'WEAK_PASSWORD');
  }
  return p;
}

async function storeRecoveryCodes(q: Queryable, userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes(10);
  await q.query('DELETE FROM recovery_codes WHERE user_id = $1', [userId]);
  for (const code of codes) {
    await q.query('INSERT INTO recovery_codes (id, user_id, code_hash) VALUES ($1, $2, $3)', [snowflake(), userId, sha256(code)]);
  }
  return codes;
}

/** Consomme un code de récupération s'il est valide. */
async function consumeRecoveryCode(q: Queryable, userId: string, code: string): Promise<boolean> {
  const hash = sha256(normalizeRecoveryCode(code));
  const row = await q.one<{ id: string }>(
    'UPDATE recovery_codes SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING id',
    [userId, hash],
  );
  return !!row;
}

/** Vérifie un second facteur : code TOTP ou code de récupération. */
async function verifySecondFactor(app: AppCtx, user: UserRow, code: string): Promise<boolean> {
  if (!user.totp_enabled || !user.totp_secret) return true;
  const clean = code.trim();
  if (/^\d{6}$/.test(clean.replace(/\s/g, ''))) {
    const step = verifyTotp(user.totp_secret, clean, Number(user.totp_last_step));
    if (step === null) return false;
    await app.db.query('UPDATE users SET totp_last_step = $2 WHERE id = $1', [user.id, step]);
    return true;
  }
  return consumeRecoveryCode(app.db, user.id, clean);
}

async function requirePassword(app: AppCtx, req: Request): Promise<UserRow> {
  const userId = uid(req);
  rateLimitOrThrow(sensitiveLimiter, `pw:${userId}`);
  const user = await getUserRow(app.db, userId);
  ensure(user, 404, 'Utilisateur introuvable.');
  const ok = await verifyPassword(String(req.body?.password ?? ''), user.password_hash);
  if (!ok) throw new HttpError(401, 'Mot de passe incorrect.', 'BAD_PASSWORD');
  return user;
}

export function authRoutes(app: AppCtx) {
  const r = Router();

  r.get('/config', (_req, res) => {
    res.json({
      name: 'endBuy',
      version: '1.0.0',
      registrationOpen: app.opts.registrationOpen,
      nitro: { name: NITRO_NAME, perks: NITRO_PERKS, price: 0 },
      database: app.db.kind,
    });
  });

  /* ------------------------- Inscription ------------------------- */
  r.post('/auth/register', async (req, res) => {
    ensure(app.opts.registrationOpen, 403, 'Les inscriptions sont fermées sur ce serveur.');
    rateLimitOrThrow(registerLimiter, clientIp(req), "Trop d'inscriptions depuis cette adresse. Réessaie plus tard.");
    const username = str(req.body?.username, 'pseudonyme', { min: 2, max: 32 });
    if (!USERNAME_RE.test(username)) {
      throw new HttpError(400, 'Le pseudonyme ne peut contenir que des lettres, chiffres, « _ » et « . » (2 à 32 caractères).', 'VALIDATION');
    }
    const password = validatePassword(req.body?.password, username);
    const displayName = str(req.body?.displayName, "nom d'affichage", { max: 32, optional: true }) || null;
    const avatarPreset = clampInt(req.body?.avatarPreset, 0, 11, Math.floor(Math.random() * 12));
    const passwordHash = await hashPassword(password);
    const userId = snowflake();

    const result = await app.db.tx(async (q) => {
      const exists = await q.one('SELECT 1 FROM users WHERE username_lower = $1', [username.toLowerCase()]);
      if (exists) throw new HttpError(409, 'Ce pseudonyme est déjà pris.', 'USERNAME_TAKEN');
      await q.query(
        `INSERT INTO users (id, username, username_lower, display_name, password_hash, avatar_preset)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, username, username.toLowerCase(), displayName, passwordHash, avatarPreset],
      );
      // endBuy Nitro Lifetime : attribué automatiquement, côté serveur, dans la même transaction.
      await grantLifetimeNitro(q, userId);
      const codes = await storeRecoveryCodes(q, userId);
      const session = await createSession(q, userId, req);
      return { codes, session };
    });

    setSessionCookie(req, res, result.session.token);
    const user = await getUserRow(app.db, userId);
    res.status(201).json({ user: selfUser(user!), recoveryCodes: result.codes });
  });

  /* --------------------------- Connexion -------------------------- */
  r.post('/auth/login', async (req, res) => {
    const username = str(req.body?.username, 'pseudonyme', { max: 64 }).toLowerCase();
    const password = str(req.body?.password, 'mot de passe', { max: 256, trim: false });
    const code = typeof req.body?.code === 'string' ? req.body.code : '';
    const ip = clientIp(req);
    rateLimitOrThrow(loginIpLimiter, ip, 'Trop de tentatives de connexion. Patiente quelques minutes.');
    rateLimitOrThrow(loginUserLimiter, `${ip}:${username}`, 'Trop de tentatives de connexion. Patiente quelques minutes.');

    const user = await app.db.one<UserRow>(`${USER_SELECT} WHERE u.username_lower = $1`, [username]);
    if (!user) {
      await burnPasswordCheck(password);
      throw new HttpError(401, 'Pseudonyme ou mot de passe incorrect.', 'BAD_CREDENTIALS');
    }
    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      const minutes = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60_000);
      throw new HttpError(429, `Compte temporairement verrouillé après trop d'échecs. Réessaie dans ${minutes} min.`, 'LOCKED');
    }
    const fail = async (message: string, errCode: string) => {
      const failed = user.failed_logins + 1;
      if (failed >= MAX_FAILED) {
        await app.db.query(
          `UPDATE users SET failed_logins = 0, locked_until = now() + interval '${LOCK_MINUTES} minutes' WHERE id = $1`,
          [user.id],
        );
      } else {
        await app.db.query('UPDATE users SET failed_logins = $2 WHERE id = $1', [user.id, failed]);
      }
      throw new HttpError(401, message, errCode);
    };

    if (!(await verifyPassword(password, user.password_hash))) {
      await fail('Pseudonyme ou mot de passe incorrect.', 'BAD_CREDENTIALS');
    }
    if (user.totp_enabled) {
      if (!code) throw new HttpError(401, 'Code de double authentification requis.', 'MFA_REQUIRED');
      if (!(await verifySecondFactor(app, user, code))) await fail('Code de double authentification invalide.', 'BAD_MFA');
    }
    await app.db.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [user.id]);
    loginUserLimiter.reset(`${ip}:${username}`);
    const session = await createSession(app.db, user.id, req);
    setSessionCookie(req, res, session.token);
    res.json({ user: selfUser(user) });
  });

  r.post('/auth/logout', async (req, res) => {
    if (req.auth) {
      await app.db.query('DELETE FROM sessions WHERE id = $1', [req.auth.sessionId]);
      app.gw.disconnectSession(req.auth.sessionId);
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  /* -------------------- Récupération de compte -------------------- */
  r.post('/auth/recover', async (req, res) => {
    rateLimitOrThrow(recoverLimiter, clientIp(req), 'Trop de tentatives de récupération. Réessaie dans une heure.');
    const username = str(req.body?.username, 'pseudonyme', { max: 64 }).toLowerCase();
    const code = str(req.body?.recoveryCode, 'code de récupération', { max: 32 });
    const user = await app.db.one<UserRow>(`${USER_SELECT} WHERE u.username_lower = $1`, [username]);
    const newPassword = validatePassword(req.body?.newPassword, user?.username);
    if (!user || !(await consumeRecoveryCode(app.db, user.id, code))) {
      throw new HttpError(401, 'Pseudonyme ou code de récupération invalide.', 'BAD_RECOVERY');
    }
    const hash = await hashPassword(newPassword);
    await app.db.query('UPDATE users SET password_hash = $2, failed_logins = 0, locked_until = NULL WHERE id = $1', [user.id, hash]);
    await app.db.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
    app.gw.disconnectUser(user.id);
    const session = await createSession(app.db, user.id, req);
    setSessionCookie(req, res, session.token);
    const remaining = await app.db.one<{ n: number }>(
      'SELECT count(*)::int AS n FROM recovery_codes WHERE user_id = $1 AND used_at IS NULL',
      [user.id],
    );
    res.json({ user: selfUser(user), remainingCodes: remaining?.n ?? 0 });
  });

  /* -------------------------- Compte ----------------------------- */
  r.get('/auth/me', requireAuth, async (req, res) => {
    const user = await getUserRow(app.db, uid(req));
    ensure(user, 401, 'Session invalide.');
    res.json({ user: selfUser(user) });
  });

  r.get('/auth/sessions', requireAuth, async (req, res) => {
    const rows = await app.db.query<{ id: string; device: string; ip: string; created_at: Date; last_seen_at: Date }>(
      'SELECT id, device, ip, created_at, last_seen_at FROM sessions WHERE user_id = $1 AND expires_at > now() ORDER BY last_seen_at DESC',
      [uid(req)],
    );
    res.json(
      rows.map((s) => ({
        id: s.id,
        device: s.device,
        ip: s.ip,
        createdAt: new Date(s.created_at).toISOString(),
        lastSeenAt: new Date(s.last_seen_at).toISOString(),
        current: s.id === req.auth!.sessionId,
      })),
    );
  });

  r.delete('/auth/sessions/:id', requireAuth, async (req, res) => {
    const id = String(req.params.id);
    const row = await app.db.one('DELETE FROM sessions WHERE id = $1 AND user_id = $2 RETURNING id', [id, uid(req)]);
    ensure(row, 404, 'Session introuvable.');
    app.gw.disconnectSession(id);
    res.json({ ok: true });
  });

  r.post('/auth/sessions/revoke-others', requireAuth, async (req, res) => {
    const rows = await app.db.query<{ id: string }>('DELETE FROM sessions WHERE user_id = $1 AND id <> $2 RETURNING id', [
      uid(req),
      req.auth!.sessionId,
    ]);
    rows.forEach((s) => app.gw.disconnectSession(s.id));
    res.json({ revoked: rows.length });
  });

  r.post('/auth/password', requireAuth, async (req, res) => {
    const user = await requirePassword(app, req);
    const newPassword = validatePassword(req.body?.newPassword, user.username);
    await app.db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, await hashPassword(newPassword)]);
    const rows = await app.db.query<{ id: string }>('DELETE FROM sessions WHERE user_id = $1 AND id <> $2 RETURNING id', [
      user.id,
      req.auth!.sessionId,
    ]);
    rows.forEach((s) => app.gw.disconnectSession(s.id));
    res.json({ ok: true, revokedSessions: rows.length });
  });

  r.get('/auth/recovery-codes', requireAuth, async (req, res) => {
    const row = await app.db.one<{ n: number }>(
      'SELECT count(*)::int AS n FROM recovery_codes WHERE user_id = $1 AND used_at IS NULL',
      [uid(req)],
    );
    res.json({ remaining: row?.n ?? 0 });
  });

  r.post('/auth/recovery-codes', requireAuth, async (req, res) => {
    const user = await requirePassword(app, req);
    const codes = await storeRecoveryCodes(app.db, user.id);
    res.json({ recoveryCodes: codes });
  });

  /* ------------------- Double authentification ------------------- */
  r.post('/auth/2fa/setup', requireAuth, async (req, res) => {
    const user = await requirePassword(app, req);
    ensure(!user.totp_enabled, 400, 'La double authentification est déjà activée.');
    const secret = generateTotpSecret();
    await app.db.query('UPDATE users SET totp_pending_secret = $2 WHERE id = $1', [user.id, secret]);
    const label = encodeURIComponent(`endBuy:${user.username}`);
    res.json({ secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=endBuy&algorithm=SHA1&digits=6&period=30` });
  });

  r.post('/auth/2fa/enable', requireAuth, async (req, res) => {
    const userId = uid(req);
    rateLimitOrThrow(sensitiveLimiter, `2fa:${userId}`);
    const user = await getUserRow(app.db, userId);
    ensure(user?.totp_pending_secret, 400, 'Commence par configurer la double authentification.');
    const step = verifyTotp(user.totp_pending_secret, String(req.body?.code ?? ''));
    if (step === null) throw new HttpError(400, 'Code invalide. Vérifie l’heure de ton téléphone et réessaie.', 'BAD_MFA');
    await app.db.query(
      'UPDATE users SET totp_secret = totp_pending_secret, totp_pending_secret = NULL, totp_enabled = true, totp_last_step = $2 WHERE id = $1',
      [userId, step],
    );
    const fresh = await getUserRow(app.db, userId);
    app.gw.sendToUser(userId, 'USER_UPDATE', { user: selfUser(fresh!), self: true });
    res.json({ user: selfUser(fresh!) });
  });

  r.post('/auth/2fa/disable', requireAuth, async (req, res) => {
    const user = await requirePassword(app, req);
    ensure(user.totp_enabled, 400, "La double authentification n'est pas activée.");
    if (!(await verifySecondFactor(app, user, String(req.body?.code ?? '')))) {
      throw new HttpError(400, 'Code de double authentification invalide.', 'BAD_MFA');
    }
    await app.db.query(
      'UPDATE users SET totp_secret = NULL, totp_pending_secret = NULL, totp_enabled = false, totp_last_step = 0 WHERE id = $1',
      [user.id],
    );
    const fresh = await getUserRow(app.db, user.id);
    app.gw.sendToUser(user.id, 'USER_UPDATE', { user: selfUser(fresh!), self: true });
    res.json({ user: selfUser(fresh!) });
  });

  r.post('/auth/delete-account', requireAuth, async (req, res) => {
    const user = await requirePassword(app, req);
    if (user.totp_enabled && !(await verifySecondFactor(app, user, String(req.body?.code ?? '')))) {
      throw new HttpError(400, 'Code de double authentification invalide.', 'BAD_MFA');
    }
    const owned = await app.db.one<{ n: number }>('SELECT count(*)::int AS n FROM servers WHERE owner_id = $1', [user.id]);
    if ((owned?.n ?? 0) > 0) {
      throw new HttpError(400, 'Supprime ou transfère d’abord les serveurs dont tu es propriétaire.', 'OWNS_SERVERS');
    }
    await app.gw.voiceLeave(user.id);
    const related = await app.gw.relatedUserIds(user.id);
    await app.db.query('DELETE FROM users WHERE id = $1', [user.id]);
    app.gw.disconnectUser(user.id);
    app.gw.sendToUsers(related, 'USER_DELETE', { userId: user.id }, user.id);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  return r;
}
