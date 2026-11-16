import type { DB } from './db.js';
import type { Gateway } from './gateway.js';
import { loadPermContext, type ServerPermContext } from './permissions.js';

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface ResolvedOptions {
  port: number;
  host: string;
  dataDir: string;
  clientDir: string | null;
  databaseUrl: string | null;
  trustProxy: boolean;
  allowedOrigins: string[];
  iceServers: IceServer[];
  log: boolean;
  registrationOpen: boolean;
  uploadStorage: 'disk' | 'database';
}

export interface AppCtx {
  db: DB;
  gw: Gateway;
  opts: ResolvedOptions;
  uploadsDir: string;
  perms: PermCache;
}

/** Cache court des contextes de permissions (invalidé à chaque modification structurelle). */
export class PermCache {
  private cache = new Map<string, { ctx: ServerPermContext; at: number }>();
  constructor(private db: DB) {}

  async get(serverId: string): Promise<ServerPermContext | null> {
    const hit = this.cache.get(serverId);
    if (hit && Date.now() - hit.at < 30_000) return hit.ctx;
    const ctx = await loadPermContext(this.db, serverId);
    if (ctx) this.cache.set(serverId, { ctx, at: Date.now() });
    else this.cache.delete(serverId);
    return ctx;
  }

  invalidate(serverId: string) {
    this.cache.delete(serverId);
  }
}
