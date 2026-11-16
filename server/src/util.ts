import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

/* ------------------------------------------------------------------ */
/* Erreurs HTTP                                                        */
/* ------------------------------------------------------------------ */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function ensure(cond: unknown, status: number, message: string, code?: string): asserts cond {
  if (!cond) throw new HttpError(status, message, code);
}

/* ------------------------------------------------------------------ */
/* Identifiants « snowflake » (triables, 19 chiffres)                  */
/* ------------------------------------------------------------------ */
const EPOCH = 1451606400000n; // 2016-01-01 — garantit 19 chiffres jusqu'en ~2085
let lastTs = 0n;
let seq = 0n;
const WORKER = BigInt(crypto.randomInt(0, 31));

export function snowflake(): string {
  let ts = BigInt(Date.now()) - EPOCH;
  if (ts < lastTs) ts = lastTs;
  if (ts === lastTs) {
    seq = (seq + 1n) & 4095n;
    if (seq === 0n) {
      ts = lastTs + 1n;
    }
  } else {
    seq = 0n;
  }
  lastTs = ts;
  return ((ts << 22n) | (WORKER << 17n) | seq).toString();
}

export function snowflakeTime(id: string): Date {
  return new Date(Number((BigInt(id) >> 22n) + EPOCH));
}

/* ------------------------------------------------------------------ */
/* Mots de passe (scrypt) et jetons                                    */
/* ------------------------------------------------------------------ */
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scryptAsync(password.normalize('NFKC'), salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scryptAsync(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** Hash factice utilisé pour égaliser le temps de réponse quand le compte n'existe pas. */
let dummyHash: string | null = null;
export async function burnPasswordCheck(password: string) {
  if (!dummyHash) dummyHash = await hashPassword('endbuy-dummy-password');
  await verifyPassword(password, dummyHash);
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function randomHex(bytes = 16): string {
  return crypto.randomBytes(bytes).toString('hex');
}

/* ------------------------------------------------------------------ */
/* Codes de récupération                                               */
/* ------------------------------------------------------------------ */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    let raw = '';
    for (let j = 0; j < 10; j++) raw += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

export function normalizeRecoveryCode(code: string): string {
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return clean.length === 10 ? `${clean.slice(0, 5)}-${clean.slice(5)}` : clean;
}

/* ------------------------------------------------------------------ */
/* TOTP (RFC 6238) pour l'authentification à deux facteurs              */
/* ------------------------------------------------------------------ */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str: string): Buffer {
  const clean = str.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function totpAt(secret: string, step: number): string {
  const key = base32Decode(secret);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, '0');
}

/** Retourne le pas de temps validé (pour empêcher la réutilisation) ou null. */
export function verifyTotp(secret: string, code: string, lastStep = 0): number | null {
  const clean = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const now = Math.floor(Date.now() / 1000 / 30);
  for (const delta of [0, -1, 1]) {
    const step = now + delta;
    if (step <= lastStep) continue;
    const expected = totpAt(secret, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return step;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */
export function str(
  value: unknown,
  field: string,
  opts: { min?: number; max?: number; optional?: boolean; trim?: boolean } = {},
): string {
  const { min = 0, max = 2000, optional = false, trim = true } = opts;
  if (value === undefined || value === null) {
    if (optional) return '';
    throw new HttpError(400, `Le champ « ${field} » est requis.`, 'VALIDATION');
  }
  if (typeof value !== 'string') throw new HttpError(400, `Le champ « ${field} » est invalide.`, 'VALIDATION');
  const v = trim ? value.trim() : value;
  if (v.length < min) throw new HttpError(400, `« ${field} » doit contenir au moins ${min} caractère(s).`, 'VALIDATION');
  if (v.length > max) throw new HttpError(400, `« ${field} » doit contenir au plus ${max} caractères.`, 'VALIDATION');
  return v;
}

export function optStr(value: unknown, field: string, max = 2000): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return '';
  return str(value, field, { max, optional: true });
}

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

export const USERNAME_RE = /^[a-zA-Z0-9_.]{2,32}$/;

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'string' ? parseInt(value, 10) : typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/* ------------------------------------------------------------------ */
/* Limiteur de débit en mémoire (fenêtre glissante)                    */
/* ------------------------------------------------------------------ */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private limit: number,
    private windowMs: number,
  ) {
    setInterval(() => this.sweep(), Math.max(windowMs, 60_000)).unref();
  }
  /** Retourne le nombre de ms à attendre si la limite est dépassée, sinon 0 (et comptabilise). */
  hit(key: string): number {
    const now = Date.now();
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.limit) {
      this.hits.set(key, arr);
      return this.windowMs - (now - arr[0]);
    }
    arr.push(now);
    this.hits.set(key, arr);
    return 0;
  }
  reset(key: string) {
    this.hits.delete(key);
  }
  private sweep() {
    const now = Date.now();
    for (const [k, arr] of this.hits) {
      const kept = arr.filter((t) => now - t < this.windowMs);
      if (kept.length) this.hits.set(k, kept);
      else this.hits.delete(k);
    }
  }
}

export function rateLimitOrThrow(limiter: RateLimiter, key: string, message = 'Trop de tentatives. Réessaie plus tard.') {
  const wait = limiter.hit(key);
  if (wait > 0) {
    throw new HttpError(429, message, 'RATE_LIMITED', { retryAfter: Math.ceil(wait / 1000) });
  }
}

/* ------------------------------------------------------------------ */
/* Cookies                                                             */
/* ------------------------------------------------------------------ */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function parseUserAgent(ua: string | undefined): string {
  if (!ua) return 'Appareil inconnu';
  let client = 'Navigateur';
  if (/endBuy\//.test(ua) || /Electron\//.test(ua)) client = 'endBuy Desktop';
  else if (/Edg\//.test(ua)) client = 'Edge';
  else if (/OPR\//.test(ua)) client = 'Opera';
  else if (/Chrome\//.test(ua)) client = 'Chrome';
  else if (/Firefox\//.test(ua)) client = 'Firefox';
  else if (/Safari\//.test(ua)) client = 'Safari';
  let os = '';
  if (/Windows/.test(ua)) os = 'Windows';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad/.test(ua)) os = 'iOS';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  return os ? `${client} · ${os}` : client;
}
