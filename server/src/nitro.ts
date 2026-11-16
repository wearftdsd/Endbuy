import type { DB, Queryable } from './db.js';

/**
 * endBuy Nitro Lifetime
 * ---------------------
 * Chaque compte reçoit automatiquement, gratuitement et à vie, l'offre « nitro_lifetime ».
 * Le statut est stocké dans la table `subscriptions`, écrite UNIQUEMENT par le serveur :
 * aucune route ne permet au client de le modifier. Toutes les limites « premium »
 * (taille des fichiers, avatars animés, bannières, emojis partout, qualité audio/vidéo…)
 * sont calculées et appliquées côté serveur à partir de cette table.
 */
export const NITRO_PLAN = 'nitro_lifetime';
export const NITRO_NAME = 'endBuy Nitro Lifetime';

export interface Premium {
  plan: string;
  since: string;
  expiresAt: null;
}

export interface Limits {
  premium: boolean;
  maxUploadBytes: number;
  maxAvatarBytes: number;
  maxBannerBytes: number;
  maxMessageLength: number;
  maxFilesPerMessage: number;
  animatedAvatar: boolean;
  customBanner: boolean;
  profileThemes: boolean;
  emojisEverywhere: boolean;
  stickersEverywhere: boolean;
  exclusiveThemes: boolean;
  audioBitrate: number;
  video: { width: number; height: number; fps: number; bitrate: number };
  screen: { width: number; height: number; fps: number; bitrate: number };
}

const MB = 1024 * 1024;

/** Plafond optionnel imposé par l'hébergeur (MAX_UPLOAD_MB), appliqué par-dessus les limites Nitro. */
const CAP = Number(process.env.MAX_UPLOAD_MB) > 0 ? Number(process.env.MAX_UPLOAD_MB) * MB : Infinity;

export const FREE_LIMITS: Limits = {
  premium: false,
  maxUploadBytes: Math.min(25 * MB, CAP),
  maxAvatarBytes: Math.min(8 * MB, CAP),
  maxBannerBytes: 0,
  maxMessageLength: 2000,
  maxFilesPerMessage: 5,
  animatedAvatar: false,
  customBanner: false,
  profileThemes: false,
  emojisEverywhere: false,
  stickersEverywhere: false,
  exclusiveThemes: false,
  audioBitrate: 64_000,
  video: { width: 1280, height: 720, fps: 30, bitrate: 1_500_000 },
  screen: { width: 1280, height: 720, fps: 30, bitrate: 2_500_000 },
};

export const NITRO_LIMITS: Limits = {
  premium: true,
  maxUploadBytes: Math.min(500 * MB, CAP),
  maxAvatarBytes: Math.min(20 * MB, CAP),
  maxBannerBytes: Math.min(20 * MB, CAP),
  maxMessageLength: 4000,
  maxFilesPerMessage: 10,
  animatedAvatar: true,
  customBanner: true,
  profileThemes: true,
  emojisEverywhere: true,
  stickersEverywhere: true,
  exclusiveThemes: true,
  audioBitrate: 128_000,
  video: { width: 1920, height: 1080, fps: 30, bitrate: 4_000_000 },
  screen: { width: 1920, height: 1080, fps: 60, bitrate: 8_000_000 },
};

export function limitsFor(premium: { plan: string } | null | undefined): Limits {
  return premium ? NITRO_LIMITS : FREE_LIMITS;
}

/** Attribue Nitro Lifetime (idempotent). Appelé à l'inscription, dans la même transaction. */
export async function grantLifetimeNitro(q: Queryable, userId: string) {
  await q.query(
    `INSERT INTO subscriptions (user_id, plan, source, expires_at) VALUES ($1, $2, 'auto-lifetime', NULL)
     ON CONFLICT (user_id) DO UPDATE SET plan = EXCLUDED.plan, expires_at = NULL`,
    [userId, NITRO_PLAN],
  );
}

export async function getPremium(q: Queryable, userId: string): Promise<Premium | null> {
  const row = await q.one<{ plan: string; granted_at: Date; expires_at: Date | null }>(
    'SELECT plan, granted_at, expires_at FROM subscriptions WHERE user_id = $1',
    [userId],
  );
  if (!row) return null;
  if (row.expires_at && row.expires_at.getTime() < Date.now()) return null;
  return { plan: row.plan, since: new Date(row.granted_at).toISOString(), expiresAt: null };
}

export async function getLimits(q: Queryable, userId: string): Promise<Limits> {
  return limitsFor(await getPremium(q, userId));
}

/** Au démarrage : garantit que tous les comptes existants possèdent Nitro Lifetime. */
export async function ensureEveryoneHasNitro(db: DB) {
  await db.query(
    `INSERT INTO subscriptions (user_id, plan, source, expires_at)
     SELECT u.id, $1, 'auto-lifetime', NULL FROM users u
     LEFT JOIN subscriptions s ON s.user_id = u.id
     WHERE s.user_id IS NULL`,
    [NITRO_PLAN],
  );
}

export const NITRO_PERKS = [
  'Nitro Premium à vie',
  'Badge Nitro sur le profil',
  'Avatars animés (GIF)',
  'Bannières de profil personnalisées',
  'Emojis personnalisés utilisables partout',
  'Stickers personnalisés utilisables partout',
  'Thèmes exclusifs',
  'Profils entièrement personnalisables',
  "Fichiers jusqu'à 500 Mo",
  'Partage d’écran 1080p à 60 i/s',
  'Audio 128 kb/s et vidéo 1080p',
  'Messages jusqu’à 4 000 caractères',
];
