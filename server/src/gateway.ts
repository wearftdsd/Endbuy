import type http from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { authenticateToken, tokenFromCookieHeader, type AuthInfo } from './auth.js';
import type { AppCtx } from './context.js';
import { getLimits } from './nitro.js';
import { CH, channelPermissions, channelViewers, isVoiceLike, P, type ChannelRow } from './permissions.js';
import { hydrateMessages, type MessageRow } from './serialize.js';
import { buildReady, loadServerData, serverSnapshot } from './state.js';
import { RateLimiter, snowflake } from './util.js';

interface Conn {
  id: string;
  ws: WebSocket;
  userId: string;
  sessionId: string;
  idle: boolean;
  alive: boolean;
  msgCount: number;
  msgWindow: number;
}

export interface VoiceState {
  userId: string;
  channelId: string;
  serverId: string | null;
  connId: string;
  selfMute: boolean;
  selfDeaf: boolean;
  serverMute: boolean;
  video: boolean;
  screen: boolean;
  suppress: boolean;
  /** Salon de conférence : orateur (true) ou auditeur (false). Toujours true dans un salon vocal. */
  speaker: boolean;
  /** Main levée (horodatage) dans un salon de conférence. */
  requestToSpeak: number | null;
  joinedAt: number;
}

interface Pref {
  status: string;
  customStatus: string;
  customStatusEmoji: string | null;
}

export type Presence = { status: 'online' | 'idle' | 'dnd' | 'offline'; customStatus: string; customStatusEmoji: string | null };

export class Gateway {
  private conns = new Map<string, Set<Conn>>();
  private voice = new Map<string, VoiceState>();
  private prefs = new Map<string, Pref>();
  private typingLimiter = new RateLimiter(1, 2500);
  private wss: WebSocketServer | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private closing = false;

  constructor(private app: AppCtx) {}

  /* ---------------------------------------------------------------- */
  /* Connexion                                                         */
  /* ---------------------------------------------------------------- */
  attach(server: http.Server) {
    const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
    this.wss = wss;
    server.on('upgrade', (req, socket, head) => {
      this.handleUpgrade(wss, req, socket, head).catch(() => socket.destroy());
    });
    this.heartbeat = setInterval(() => {
      for (const set of this.conns.values()) {
        for (const c of set) {
          if (!c.alive) {
            c.ws.terminate();
            continue;
          }
          c.alive = false;
          try {
            c.ws.ping();
          } catch {
            /* ignoré */
          }
        }
      }
    }, 30_000);
    this.heartbeat.unref();
  }

  close() {
    this.closing = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const set of this.conns.values()) for (const c of set) c.ws.terminate();
    this.wss?.close();
  }

  private originAllowed(req: http.IncomingMessage) {
    const origin = req.headers.origin;
    if (!origin) return true;
    if (this.app.opts.allowedOrigins.includes(origin)) return true;
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  }

  private async handleUpgrade(wss: WebSocketServer, req: http.IncomingMessage, socket: Duplex, head: Buffer) {
    const url = req.url || '';
    if (!url.startsWith('/ws')) {
      socket.destroy();
      return;
    }
    if (!this.originAllowed(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    const auth = await authenticateToken(this.app, tokenFromCookieHeader(req.headers.cookie));
    if (!auth) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      this.onConnection(ws, auth).catch((e) => {
        console.error('[gateway] erreur de connexion', e);
        ws.close(1011, 'internal');
      });
    });
  }

  private async onConnection(ws: WebSocket, auth: AuthInfo) {
    const conn: Conn = {
      id: snowflake(),
      ws,
      userId: auth.userId,
      sessionId: auth.sessionId,
      idle: false,
      alive: true,
      msgCount: 0,
      msgWindow: Date.now(),
    };
    const wasOnline = this.isOnline(auth.userId);
    await this.loadPrefs(auth.userId);
    const set = this.conns.get(auth.userId) ?? new Set();
    set.add(conn);
    this.conns.set(auth.userId, set);

    ws.on('pong', () => (conn.alive = true));
    ws.on('message', (raw) => {
      this.onMessage(conn, raw.toString()).catch((e) => console.error('[gateway] message', e));
    });
    ws.on('close', () => {
      this.onClose(conn).catch((e) => console.error('[gateway] close', e));
    });

    const ready = await buildReady(this.app, auth.userId, auth.sessionId);
    if (!ready) {
      ws.close(4004, 'unknown user');
      return;
    }
    this.send(conn, 'READY', ready);
    if (!wasOnline) await this.broadcastPresence(auth.userId);
  }

  private async onClose(conn: Conn) {
    if (this.closing) return;
    const set = this.conns.get(conn.userId);
    set?.delete(conn);
    if (set && set.size === 0) this.conns.delete(conn.userId);
    const vs = this.voice.get(conn.userId);
    if (vs && vs.connId === conn.id) await this.voiceLeave(conn.userId);
    if (!this.isOnline(conn.userId)) await this.broadcastPresence(conn.userId);
  }

  private async onMessage(conn: Conn, raw: string) {
    const now = Date.now();
    if (now - conn.msgWindow > 10_000) {
      conn.msgWindow = now;
      conn.msgCount = 0;
    }
    if (++conn.msgCount > 400) return; // anti-flood
    let msg: { op?: string; d?: any };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const d = msg.d ?? {};
    switch (msg.op) {
      case 'heartbeat':
        conn.alive = true;
        this.send(conn, 'HEARTBEAT_ACK', {});
        break;
      case 'presence': {
        if (typeof d.idle === 'boolean') {
          const before = this.presenceOf(conn.userId).status;
          conn.idle = d.idle;
          if (this.presenceOf(conn.userId).status !== before) await this.broadcastPresence(conn.userId);
        }
        break;
      }
      case 'typing':
        await this.handleTyping(conn, String(d.channelId || ''));
        break;
      case 'voice_join':
        await this.voiceJoin(conn, String(d.channelId || ''));
        break;
      case 'voice_leave': {
        const vs = this.voice.get(conn.userId);
        if (vs) await this.voiceLeave(conn.userId);
        break;
      }
      case 'voice_state':
        await this.voiceUpdate(conn, d);
        break;
      case 'rtc_signal':
        this.relaySignal(conn, d);
        break;
      case 'stage_hand':
        await this.stageHand(conn, !!d.raised);
        break;
      case 'call_decline': {
        const channelId = String(d.channelId || '');
        this.sendToUser(conn.userId, 'CALL_DISMISS', { channelId });
        break;
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Envoi                                                             */
  /* ---------------------------------------------------------------- */
  private send(conn: Conn, t: string, d: unknown) {
    if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(JSON.stringify({ t, d }));
  }

  sendToUser(userId: string, t: string, d: unknown) {
    const set = this.conns.get(userId);
    if (!set) return;
    const payload = JSON.stringify({ t, d });
    for (const c of set) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(payload);
  }

  sendToUsers(userIds: Iterable<string>, t: string, d: unknown, exceptUserId?: string) {
    const payload = JSON.stringify({ t, d });
    for (const id of new Set(userIds)) {
      if (id === exceptUserId) continue;
      const set = this.conns.get(id);
      if (!set) continue;
      for (const c of set) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(payload);
    }
  }

  isOnline(userId: string) {
    return (this.conns.get(userId)?.size ?? 0) > 0;
  }

  onlineUserIds(): string[] {
    return [...this.conns.keys()];
  }

  /** Ferme les connexions temps réel d'une session (déconnexion / révocation). */
  disconnectSession(sessionId: string) {
    for (const set of this.conns.values()) for (const c of set) if (c.sessionId === sessionId) c.ws.close(4001, 'session revoked');
  }

  disconnectUser(userId: string) {
    for (const c of this.conns.get(userId) ?? []) c.ws.close(4001, 'session revoked');
  }

  /* ---------------------------------------------------------------- */
  /* Présence                                                          */
  /* ---------------------------------------------------------------- */
  private async loadPrefs(userId: string) {
    const row = await this.app.db.one<{ status: string; custom_status: string; custom_status_emoji: string | null }>(
      'SELECT status, custom_status, custom_status_emoji FROM users WHERE id = $1',
      [userId],
    );
    if (row) this.prefs.set(userId, { status: row.status, customStatus: row.custom_status, customStatusEmoji: row.custom_status_emoji });
  }

  async updatePrefs(userId: string) {
    await this.loadPrefs(userId);
    await this.broadcastPresence(userId);
  }

  presenceOf(userId: string): Presence {
    const pref = this.prefs.get(userId);
    const set = this.conns.get(userId);
    if (!set || set.size === 0 || !pref || pref.status === 'invisible') {
      return { status: 'offline', customStatus: '', customStatusEmoji: null };
    }
    let status = pref.status as Presence['status'];
    if (status === 'online' && [...set].every((c) => c.idle)) status = 'idle';
    return { status, customStatus: pref.customStatus, customStatusEmoji: pref.customStatusEmoji };
  }

  /** Statut réel (pour l'utilisateur lui-même : « invisible » reste visible pour lui). */
  async relatedUserIds(userId: string): Promise<string[]> {
    const rows = await this.app.db.query<{ id: string }>(
      `SELECT m2.user_id AS id FROM members m1 JOIN members m2 ON m1.server_id = m2.server_id WHERE m1.user_id = $1
       UNION SELECT target_id AS id FROM relationships WHERE user_id = $1 AND type <> 2
       UNION SELECT cr2.user_id AS id FROM channel_recipients cr1 JOIN channel_recipients cr2 ON cr1.channel_id = cr2.channel_id WHERE cr1.user_id = $1`,
      [userId],
    );
    return rows.map((r) => r.id);
  }

  async broadcastPresence(userId: string) {
    const related = await this.relatedUserIds(userId);
    const online = related.filter((id) => this.isOnline(id));
    this.sendToUsers(online, 'PRESENCE_UPDATE', { userId, ...this.presenceOf(userId) });
    const pref = this.prefs.get(userId);
    if (pref) this.sendToUser(userId, 'PRESENCE_UPDATE', { userId, ...this.presenceOf(userId), self: pref.status });
  }

  /* ---------------------------------------------------------------- */
  /* Diffusion par salon / serveur                                     */
  /* ---------------------------------------------------------------- */
  async channelAudience(channelId: string): Promise<{ channel: ChannelRow; userIds: string[] } | null> {
    const channel = await this.app.db.one<ChannelRow>('SELECT * FROM channels WHERE id = $1', [channelId]);
    if (!channel) return null;
    if (channel.server_id) {
      const ctx = await this.app.perms.get(channel.server_id);
      if (!ctx) return null;
      return { channel, userIds: channelViewers(ctx, channel) };
    }
    const recips = await this.app.db.query<{ user_id: string }>('SELECT user_id FROM channel_recipients WHERE channel_id = $1', [
      channelId,
    ]);
    return { channel, userIds: recips.map((r) => r.user_id) };
  }

  async emitToChannel(channelId: string, t: string, d: unknown, exceptUserId?: string) {
    const aud = await this.channelAudience(channelId);
    if (!aud) return;
    this.sendToUsers(aud.userIds, t, d, exceptUserId);
  }

  async serverMemberIds(serverId: string) {
    const rows = await this.app.db.query<{ user_id: string }>('SELECT user_id FROM members WHERE server_id = $1', [serverId]);
    return rows.map((r) => r.user_id);
  }

  /** Renvoie à chaque membre connecté sa vue à jour du serveur (rôles, salons visibles, membres…). */
  async syncServer(serverId: string) {
    this.app.perms.invalidate(serverId);
    const data = await loadServerData(this.app, serverId);
    if (!data) return;
    const presences: Record<string, unknown> = {};
    for (const u of data.users) presences[u.id] = this.presenceOf(u.id);
    for (const m of data.members) {
      if (!this.isOnline(m.user_id)) continue;
      this.sendToUser(m.user_id, 'SERVER_SYNC', {
        server: serverSnapshot(data, m.user_id),
        users: data.users,
        presences,
        voiceStates: this.voiceStatesFor(new Set(data.ctx.channels.map((c) => c.id))),
      });
    }
    // Déconnecte de la voix ceux qui n'y ont plus accès.
    for (const vs of [...this.voice.values()]) {
      if (vs.serverId !== serverId) continue;
      const channel = data.ctx.channels.find((c) => c.id === vs.channelId);
      if (!channel || !(channelPermissions(data.ctx, vs.userId, channel) & P.CONNECT)) {
        await this.voiceLeave(vs.userId, true);
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Indicateur de saisie                                              */
  /* ---------------------------------------------------------------- */
  private async handleTyping(conn: Conn, channelId: string) {
    if (!channelId) return;
    if (this.typingLimiter.hit(`${conn.userId}:${channelId}`) > 0) return;
    const aud = await this.channelAudience(channelId);
    if (!aud || !aud.userIds.includes(conn.userId)) return;
    if (aud.channel.server_id) {
      const ctx = await this.app.perms.get(aud.channel.server_id);
      if (!ctx || !(channelPermissions(ctx, conn.userId, aud.channel) & P.SEND_MESSAGES)) return;
    }
    this.sendToUsers(aud.userIds, 'TYPING_START', { channelId, userId: conn.userId, at: Date.now() }, conn.userId);
  }

  /* ---------------------------------------------------------------- */
  /* Voix / vidéo (signalisation WebRTC)                               */
  /* ---------------------------------------------------------------- */
  voiceStatesFor(channelIds: Set<string>) {
    return [...this.voice.values()].filter((v) => channelIds.has(v.channelId)).map((v) => this.serializeVoice(v));
  }

  getVoiceState(userId: string) {
    return this.voice.get(userId);
  }

  private serializeVoice(v: VoiceState) {
    return {
      userId: v.userId,
      channelId: v.channelId,
      serverId: v.serverId,
      selfMute: v.selfMute,
      selfDeaf: v.selfDeaf,
      serverMute: v.serverMute,
      video: v.video,
      screen: v.screen,
      suppress: v.suppress,
      speaker: v.speaker,
      requestToSpeak: v.requestToSpeak,
      joinedAt: v.joinedAt,
    };
  }

  private async voiceAudience(channelId: string, serverId: string | null): Promise<string[]> {
    if (serverId) return this.serverMemberIds(serverId);
    const recips = await this.app.db.query<{ user_id: string }>('SELECT user_id FROM channel_recipients WHERE channel_id = $1', [
      channelId,
    ]);
    return recips.map((r) => r.user_id);
  }

  private async voiceJoin(conn: Conn, channelId: string) {
    const fail = (message: string) => this.send(conn, 'VOICE_ERROR', { channelId, message });
    const channel = await this.app.db.one<ChannelRow>('SELECT * FROM channels WHERE id = $1', [channelId]);
    if (!channel) return fail('Salon introuvable.');
    let suppress = false;
    let speaker = true;
    if (channel.server_id) {
      if (!isVoiceLike(channel.type)) return fail("Ce salon n'est pas un salon vocal.");
      const ctx = await this.app.perms.get(channel.server_id);
      const perms = ctx ? channelPermissions(ctx, conn.userId, channel) : 0;
      if (!(perms & P.CONNECT)) return fail("Tu n'as pas la permission de rejoindre ce salon.");
      suppress = !(perms & P.SPEAK);
      if (channel.type === CH.STAGE) {
        // On entre dans une conférence en tant qu'auditeur.
        speaker = false;
        suppress = true;
      }
      const inChannel = [...this.voice.values()].filter((v) => v.channelId === channelId && v.userId !== conn.userId);
      if (channel.user_limit > 0 && inChannel.length >= channel.user_limit && !(perms & P.MANAGE_CHANNELS)) {
        return fail('Ce salon vocal est plein.');
      }
    } else {
      const r = await this.app.db.one('SELECT 1 FROM channel_recipients WHERE channel_id = $1 AND user_id = $2', [
        channelId,
        conn.userId,
      ]);
      if (!r) return fail('Appel introuvable.');
    }

    const existing = this.voice.get(conn.userId);
    if (existing) await this.voiceLeave(conn.userId);

    const othersBefore = [...this.voice.values()].filter((v) => v.channelId === channelId);
    const state: VoiceState = {
      userId: conn.userId,
      channelId,
      serverId: channel.server_id,
      connId: conn.id,
      selfMute: false,
      selfDeaf: false,
      serverMute: false,
      video: false,
      screen: false,
      suppress,
      speaker,
      requestToSpeak: null,
      joinedAt: Date.now(),
    };
    this.voice.set(conn.userId, state);

    const limits = await getLimits(this.app.db, conn.userId);
    this.send(conn, 'VOICE_READY', {
      channelId,
      serverId: channel.server_id,
      peers: othersBefore.map((v) => v.userId),
      iceServers: this.app.opts.iceServers,
      quality: { audioBitrate: limits.audioBitrate, video: limits.video, screen: limits.screen },
    });
    const audience = await this.voiceAudience(channelId, channel.server_id);
    this.sendToUsers(audience, 'VOICE_STATE_UPDATE', this.serializeVoice(state));

    // Appel privé : on fait sonner les autres participants.
    if (!channel.server_id && othersBefore.length === 0) {
      const ring = audience.filter((id) => id !== conn.userId);
      this.sendToUsers(ring, 'CALL_RING', { channelId, callerId: conn.userId });
      await this.postSystemMessage(channelId, conn.userId, 3, '');
    }
  }

  async voiceLeave(userId: string, forced = false) {
    const state = this.voice.get(userId);
    if (!state) return;
    this.voice.delete(userId);
    const audience = await this.voiceAudience(state.channelId, state.serverId);
    this.sendToUsers(audience, 'VOICE_STATE_UPDATE', {
      userId,
      channelId: null,
      previousChannelId: state.channelId,
      serverId: state.serverId,
      forced,
    });
  }

  private async voiceUpdate(conn: Conn, d: any) {
    const state = this.voice.get(conn.userId);
    if (!state || state.connId !== conn.id) return;
    if (typeof d.selfMute === 'boolean') state.selfMute = d.selfMute;
    if (typeof d.selfDeaf === 'boolean') state.selfDeaf = d.selfDeaf;
    if (typeof d.video === 'boolean' || typeof d.screen === 'boolean') {
      let allowed = true;
      if (state.serverId) {
        const ctx = await this.app.perms.get(state.serverId);
        const channel = ctx?.channels.find((c) => c.id === state.channelId);
        allowed = !!(ctx && channel && channelPermissions(ctx, conn.userId, channel) & P.VIDEO);
      }
      if (!state.speaker) allowed = false;
      if (typeof d.video === 'boolean') state.video = allowed && d.video;
      if (typeof d.screen === 'boolean') state.screen = allowed && d.screen;
    }
    const audience = await this.voiceAudience(state.channelId, state.serverId);
    this.sendToUsers(audience, 'VOICE_STATE_UPDATE', this.serializeVoice(state));
  }

  /** Conférence : lever / baisser la main. */
  private async stageHand(conn: Conn, raised: boolean) {
    const state = this.voice.get(conn.userId);
    if (!state || state.connId !== conn.id || !state.serverId || state.speaker) return;
    const ctx = await this.app.perms.get(state.serverId);
    const channel = ctx?.channels.find((c) => c.id === state.channelId);
    if (!ctx || !channel || channel.type !== CH.STAGE) return;
    if (raised && !(channelPermissions(ctx, conn.userId, channel) & P.REQUEST_TO_SPEAK)) return;
    state.requestToSpeak = raised ? Date.now() : null;
    const audience = await this.voiceAudience(state.channelId, state.serverId);
    this.sendToUsers(audience, 'VOICE_STATE_UPDATE', this.serializeVoice(state));
  }

  /** Conférence : passer un participant orateur ou auditeur. */
  async setStageSpeaker(userId: string, speaker: boolean, noSpeakPermission: boolean) {
    const state = this.voice.get(userId);
    if (!state) return;
    state.speaker = speaker;
    state.requestToSpeak = null;
    state.suppress = !speaker || noSpeakPermission;
    if (!speaker) state.video = state.screen = false;
    const audience = await this.voiceAudience(state.channelId, state.serverId);
    this.sendToUsers(audience, 'VOICE_STATE_UPDATE', this.serializeVoice(state));
  }

  async setServerMute(serverId: string, userId: string, mute: boolean) {
    const state = this.voice.get(userId);
    if (!state || state.serverId !== serverId) return false;
    state.serverMute = mute;
    const audience = await this.voiceAudience(state.channelId, state.serverId);
    this.sendToUsers(audience, 'VOICE_STATE_UPDATE', this.serializeVoice(state));
    return true;
  }

  private relaySignal(conn: Conn, d: any) {
    const to = String(d.to || '');
    const me = this.voice.get(conn.userId);
    const them = this.voice.get(to);
    if (!me || !them || me.channelId !== them.channelId || me.connId !== conn.id) return;
    const target = [...(this.conns.get(to) ?? [])].find((c) => c.id === them.connId);
    if (target) this.send(target, 'RTC_SIGNAL', { from: conn.userId, channelId: me.channelId, data: d.data });
  }

  /* ---------------------------------------------------------------- */
  /* Messages système                                                  */
  /* ---------------------------------------------------------------- */
  async postSystemMessage(channelId: string, authorId: string, type: number, content: string) {
    const id = snowflake();
    const rows = await this.app.db.query<MessageRow>(
      `INSERT INTO messages (id, channel_id, author_id, content, type) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, channelId, authorId, content, type],
    );
    await this.app.db.query('UPDATE channels SET last_message_id = $1 WHERE id = $2', [id, channelId]);
    await this.app.db.query('UPDATE channel_recipients SET closed = false WHERE channel_id = $1', [channelId]);
    const [message] = await hydrateMessages(this.app.db, rows);
    await this.emitToChannel(channelId, 'MESSAGE_CREATE', message);
    return message;
  }
}
