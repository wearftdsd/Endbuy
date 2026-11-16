import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { csrfGuard, sessionMiddleware } from './auth.js';
import { PermCache, type AppCtx, type IceServer, type ResolvedOptions } from './context.js';
import { migrate, openDatabase } from './db.js';
import { configureStorage, ensureUploadDirs, serveUploads } from './files.js';
import { Gateway } from './gateway.js';
import { eventRoutes, startEventScheduler } from './events.js';
import { ensureEveryoneHasNitro } from './nitro.js';
import { authRoutes } from './routes/auth.js';
import { channelRoutes } from './routes/channels.js';
import { serverRoutes } from './routes/servers.js';
import { userRoutes } from './routes/users.js';
import { HttpError } from './util.js';

export type { ResolvedOptions } from './context.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_ICE: IceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

export function optionsFromEnv(env: NodeJS.ProcessEnv = process.env): Partial<ResolvedOptions> {
  let iceServers: IceServer[] | undefined;
  if (env.ICE_SERVERS) {
    try {
      iceServers = JSON.parse(env.ICE_SERVERS);
    } catch {
      console.warn('[endBuy] ICE_SERVERS invalide (JSON attendu), valeur ignorée.');
    }
  } else if (env.TURN_URL) {
    iceServers = [...DEFAULT_ICE, { urls: env.TURN_URL.split(','), username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL }];
  }
  return {
    port: env.PORT ? Number(env.PORT) : undefined,
    host: env.HOST,
    dataDir: env.DATA_DIR,
    clientDir: env.CLIENT_DIR,
    databaseUrl: env.DATABASE_URL || null,
    trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
    allowedOrigins: env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()) : undefined,
    iceServers,
    registrationOpen: env.REGISTRATION_OPEN !== 'false',
    uploadStorage: env.UPLOAD_STORAGE === 'database' ? 'database' : undefined,
  };
}

function resolveOptions(o: Partial<ResolvedOptions>): ResolvedOptions {
  const defaultClient = path.resolve(here, '../../client/dist');
  return {
    port: o.port ?? 3001,
    host: o.host ?? '0.0.0.0',
    dataDir: path.resolve(o.dataDir ?? path.resolve(here, '../data')),
    clientDir: o.clientDir === null ? null : o.clientDir ?? (fs.existsSync(defaultClient) ? defaultClient : null),
    databaseUrl: o.databaseUrl ?? null,
    trustProxy: o.trustProxy ?? false,
    allowedOrigins: o.allowedOrigins ?? ['http://localhost:5173', 'http://127.0.0.1:5173'],
    iceServers: o.iceServers ?? DEFAULT_ICE,
    log: o.log ?? true,
    registrationOpen: o.registrationOpen ?? true,
    uploadStorage: o.uploadStorage ?? 'disk',
  };
}

export interface RunningServer {
  url: string;
  port: number;
  app: AppCtx;
  close(): Promise<void>;
}

export async function startServer(options: Partial<ResolvedOptions> = {}): Promise<RunningServer> {
  const opts = resolveOptions(options);
  fs.mkdirSync(opts.dataDir, { recursive: true });
  const uploadsDir = path.join(opts.dataDir, 'uploads');
  ensureUploadDirs(uploadsDir);

  const db = await openDatabase({ databaseUrl: opts.databaseUrl, dataDir: opts.dataDir });
  await migrate(db);
  await ensureEveryoneHasNitro(db);

  configureStorage({ mode: opts.uploadStorage, db, uploadsDir });
  const app = { db, opts, uploadsDir, perms: new PermCache(db) } as AppCtx;
  app.gw = new Gateway(app);

  const ex = express();
  ex.disable('x-powered-by');
  ex.set('trust proxy', opts.trustProxy ? 1 : false);
  ex.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
          'img-src': ["'self'", 'data:', 'blob:', 'https:'],
          'media-src': ["'self'", 'blob:', 'https:'],
          'connect-src': ["'self'", 'ws:', 'wss:'],
          'frame-src': ["'none'"],
          'object-src': ["'none'"],
          'upgrade-insecure-requests': null,
        },
      },
      crossOriginEmbedderPolicy: false,
      strictTransportSecurity: false,
    }),
  );
  ex.use(express.json({ limit: '1mb' }));

  ex.get('/uploads/:kind/:file', serveUploads(uploadsDir));

  ex.use('/api', csrfGuard, sessionMiddleware(app));
  ex.get('/api/health', (_req, res) => {
    res.json({ ok: true, name: 'endBuy', database: db.kind, online: app.gw.onlineUserIds().length });
  });
  ex.use('/api', authRoutes(app));
  ex.use('/api', serverRoutes(app));
  ex.use('/api', userRoutes(app));
  ex.use('/api', channelRoutes(app));
  ex.use('/api', eventRoutes(app));
  ex.use('/api', (_req, _res, next) => next(new HttpError(404, 'Route inconnue.', 'NOT_FOUND')));

  if (opts.clientDir) {
    const clientDir = opts.clientDir;
    ex.use(
      express.static(clientDir, {
        index: false,
        setHeaders(res, file) {
          if (/[\\/]assets[\\/]/.test(file)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );
    ex.get(/^(?!\/(api|uploads|ws)(\/|$)).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  }

  // Gestionnaire d'erreurs JSON
  ex.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      if (err.status === 429 && err.extra?.retryAfter) res.setHeader('Retry-After', String(err.extra.retryAfter));
      return res.status(err.status).json({ message: err.message, code: err.code, ...(err.extra ?? {}) });
    }
    if (err?.type === 'entity.too.large') return res.status(413).json({ message: 'Requête trop volumineuse.', code: 'TOO_LARGE' });
    if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ message: 'JSON invalide.', code: 'BAD_JSON' });
    console.error('[endBuy] erreur', err);
    res.status(500).json({ message: 'Erreur interne du serveur.', code: 'INTERNAL' });
  });

  const server = http.createServer(ex);
  server.requestTimeout = 0; // gros téléversements autorisés
  app.gw.attach(server);
  const stopScheduler = startEventScheduler(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.host, () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : opts.port;
  const url = `http://${opts.host === '0.0.0.0' ? 'localhost' : opts.host}:${port}`;
  if (opts.log) {
    console.log(`[endBuy] serveur prêt sur ${url} (base : ${db.kind === 'pglite' ? 'PostgreSQL embarqué (PGlite)' : 'PostgreSQL'})`);
    if (opts.host === '0.0.0.0') {
      for (const ifaces of Object.values(os.networkInterfaces())) {
        for (const i of ifaces ?? []) if (i.family === 'IPv4' && !i.internal) console.log(`[endBuy] réseau local : http://${i.address}:${port}`);
      }
    }
  }
  return {
    url,
    port,
    app,
    async close() {
      stopScheduler();
      app.gw.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await db.close();
    },
  };
}

/* Lancement direct : `node dist/endbuy-server.mjs` ou `tsx src/main.ts` */
const isMain = !process.env.ENDBUY_EMBEDDED && !!process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  startServer(optionsFromEnv())
    .then((srv) => {
      const stop = () => {
        srv.close().finally(() => process.exit(0));
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    })
    .catch((e) => {
      console.error('[endBuy] impossible de démarrer :', e);
      process.exit(1);
    });
}
