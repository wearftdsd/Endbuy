import fs from 'node:fs';
import path from 'node:path';

/**
 * Couche d'accès PostgreSQL.
 *  - Production : un vrai serveur PostgreSQL via DATABASE_URL (driver `pg`).
 *  - Local / application de bureau : PGlite (PostgreSQL compilé en WASM, persistant sur disque).
 * Les deux exposent exactement la même API SQL (paramètres $1, $2…).
 */
export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = any>(sql: string, params?: unknown[]): Promise<T | undefined>;
}

export interface DB extends Queryable {
  kind: 'postgres' | 'pglite';
  exec(sql: string): Promise<void>;
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function openDatabase(opts: { databaseUrl?: string | null; dataDir: string }): Promise<DB> {
  if (opts.databaseUrl) {
    const pg = (await import('pg')).default;
    // int8 / count(*) → number (comme PGlite)
    pg.types.setTypeParser(20, (v: string) => parseInt(v, 10));
    const pool = new pg.Pool({
      connectionString: opts.databaseUrl,
      max: Number(process.env.PG_POOL_MAX) || 10,
      ssl: /sslmode=require/.test(opts.databaseUrl) ? { rejectUnauthorized: false } : undefined,
    });
    const wrap = (c: { query: (s: string, p?: unknown[]) => Promise<{ rows: any[] }> }): Queryable => ({
      async query(sql, params) {
        return (await c.query(sql, params as any[])).rows;
      },
      async one(sql, params) {
        return (await c.query(sql, params as any[])).rows[0];
      },
    });
    const base = wrap(pool);
    return {
      kind: 'postgres',
      ...base,
      async exec(sql) {
        await pool.query(sql);
      },
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const res = await fn(wrap(client));
          await client.query('COMMIT');
          return res;
        } catch (e) {
          await client.query('ROLLBACK').catch(() => {});
          throw e;
        } finally {
          client.release();
        }
      },
      async close() {
        await pool.end();
      },
    };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const dir = path.join(opts.dataDir, 'pgdata');
  fs.mkdirSync(dir, { recursive: true });
  const db = new PGlite(dir);
  await db.waitReady;
  const wrap = (c: { query: (s: string, p?: unknown[]) => Promise<{ rows: any[] }> }): Queryable => ({
    async query(sql, params) {
      return (await c.query(sql, params as any[])).rows;
    },
    async one(sql, params) {
      return (await c.query(sql, params as any[])).rows[0];
    },
  });
  return {
    kind: 'pglite',
    ...wrap(db),
    async exec(sql) {
      await db.exec(sql);
    },
    async tx(fn) {
      return db.transaction(async (t) => fn(wrap(t)));
    },
    async close() {
      await db.close();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Schéma et migrations                                                */
/* ------------------------------------------------------------------ */
const MIGRATIONS: string[] = [
  /* 1 — schéma initial */ `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    username_lower TEXT NOT NULL UNIQUE,
    display_name TEXT,
    password_hash TEXT NOT NULL,
    avatar TEXT,
    avatar_preset INT NOT NULL DEFAULT 0,
    banner TEXT,
    banner_color TEXT,
    accent_color TEXT,
    profile_theme JSONB,
    bio TEXT NOT NULL DEFAULT '',
    pronouns TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'online',
    custom_status TEXT NOT NULL DEFAULT '',
    custom_status_emoji TEXT,
    totp_secret TEXT,
    totp_pending_secret TEXT,
    totp_enabled BOOLEAN NOT NULL DEFAULT false,
    totp_last_step BIGINT NOT NULL DEFAULT 0,
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    failed_logins INT NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE recovery_codes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at TIMESTAMPTZ
  );
  CREATE INDEX recovery_codes_user ON recovery_codes(user_id);

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    device TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  -- Abonnement endBuy Nitro : attribué EXCLUSIVEMENT côté serveur.
  CREATE TABLE subscriptions (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    plan TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'auto-lifetime',
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ
  );

  CREATE TABLE servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT,
    banner TEXT,
    description TEXT NOT NULL DEFAULT '',
    owner_id TEXT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE roles (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT,
    permissions INT NOT NULL DEFAULT 0,
    position INT NOT NULL DEFAULT 0,
    hoist BOOLEAN NOT NULL DEFAULT false,
    mentionable BOOLEAN NOT NULL DEFAULT false,
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX roles_server ON roles(server_id);

  CREATE TABLE members (
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nickname TEXT,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (server_id, user_id)
  );
  CREATE INDEX members_user ON members(user_id);

  CREATE TABLE member_roles (
    server_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (server_id, user_id, role_id),
    FOREIGN KEY (server_id, user_id) REFERENCES members(server_id, user_id) ON DELETE CASCADE
  );

  -- type : 0 = texte, 1 = message privé, 2 = vocal, 3 = groupe privé, 4 = catégorie
  CREATE TABLE channels (
    id TEXT PRIMARY KEY,
    server_id TEXT REFERENCES servers(id) ON DELETE CASCADE,
    type INT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    topic TEXT NOT NULL DEFAULT '',
    parent_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
    position INT NOT NULL DEFAULT 0,
    owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    icon TEXT,
    user_limit INT NOT NULL DEFAULT 0,
    last_message_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX channels_server ON channels(server_id);

  CREATE TABLE channel_recipients (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    closed BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (channel_id, user_id)
  );
  CREATE INDEX channel_recipients_user ON channel_recipients(user_id);

  CREATE TABLE permission_overwrites (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    target_id TEXT NOT NULL,
    target_type TEXT NOT NULL CHECK (target_type IN ('role', 'member')),
    allow INT NOT NULL DEFAULT 0,
    deny INT NOT NULL DEFAULT 0,
    PRIMARY KEY (channel_id, target_id)
  );

  CREATE TABLE emojis (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'emoji' CHECK (kind IN ('emoji', 'sticker')),
    path TEXT NOT NULL,
    animated BOOLEAN NOT NULL DEFAULT false,
    creator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX emojis_server ON emojis(server_id);

  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    content TEXT NOT NULL DEFAULT '',
    type INT NOT NULL DEFAULT 0,
    reply_to_id TEXT,
    sticker_id TEXT,
    mentions TEXT[] NOT NULL DEFAULT '{}',
    mention_everyone BOOLEAN NOT NULL DEFAULT false,
    embeds JSONB NOT NULL DEFAULT '[]'::jsonb,
    pinned BOOLEAN NOT NULL DEFAULT false,
    edited_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX messages_channel ON messages(channel_id, id DESC);

  CREATE TABLE attachments (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    path TEXT NOT NULL,
    size BIGINT NOT NULL,
    content_type TEXT NOT NULL
  );
  CREATE INDEX attachments_message ON attachments(message_id);

  CREATE TABLE reactions (
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, user_id, emoji)
  );

  CREATE TABLE invites (
    code TEXT PRIMARY KEY,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
    inviter_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    max_uses INT NOT NULL DEFAULT 0,
    uses INT NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE bans (
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL DEFAULT '',
    banned_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (server_id, user_id)
  );

  -- type : 1 = ami, 2 = bloqué, 3 = demande reçue, 4 = demande envoyée
  CREATE TABLE relationships (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, target_id)
  );

  CREATE TABLE read_states (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    last_read_id TEXT,
    mention_count INT NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, channel_id)
  );

  CREATE TABLE link_previews (
    url TEXT PRIMARY KEY,
    data JSONB,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  `,
  /* 2 — événements programmés, salons de conférence, stockage des fichiers en base */ `
  CREATE TABLE events (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    creator_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    channel_id TEXT REFERENCES channels(id) ON DELETE SET NULL,
    location TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ,
    status INT NOT NULL DEFAULT 1,
    reminded BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX events_server ON events(server_id, starts_at);

  CREATE TABLE event_users (
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, user_id)
  );

  -- Nouvelles permissions : « Demander la parole » pour tous, « Gérer les événements » pour les modérateurs.
  UPDATE roles SET permissions = permissions | 4194304 WHERE is_default = true;
  UPDATE roles SET permissions = permissions | 8388608 WHERE is_default = false AND name = 'Modérateur';

  -- Fichiers téléversés stockés en base (hébergeurs sans disque persistant).
  CREATE TABLE file_blobs (
    name TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size BIGINT NOT NULL,
    data BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  `,
];

export async function migrate(db: DB) {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const rows = await db.query<{ version: number }>('SELECT version FROM schema_migrations');
  const applied = new Set(rows.map((r) => Number(r.version)));
  for (let i = 0; i < MIGRATIONS.length; i++) {
    const version = i + 1;
    if (applied.has(version)) continue;
    await db.tx(async (q) => {
      for (const stmt of splitSql(MIGRATIONS[i])) await q.query(stmt);
      await q.query('INSERT INTO schema_migrations(version) VALUES ($1)', [version]);
    });
  }
}

function splitSql(sql: string): string[] {
  return sql
    .split(/;\s*\n/)
    .map((s) =>
      s
        .split('\n')
        .filter((l) => !l.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter(Boolean);
}
