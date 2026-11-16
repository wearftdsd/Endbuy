import { post } from './api';
import { desktop } from './desktop';
import { t } from './i18n';
import { voice } from './rtc';
import { sounds, startRinging, stopRinging } from './sounds';
import { displayName, findChannel, S, setState, snowGt, toast } from './store';
import { CH, EV, type Channel, type Message, type Ready, type Server, type ServerEvent, type User } from './types';

/** Connexion temps réel (WebSocket) avec reconnexion automatique. */
class GatewayClient {
  private ws: WebSocket | null = null;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private stopped = true;
  private idle = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  onSessionRevoked: (() => void) | null = null;

  start() {
    this.stopped = false;
    this.open();
    this.setupIdleDetection();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.ws?.close();
    this.ws = null;
  }

  send(op: string, d: unknown = {}) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ op, d }));
  }

  private open() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    setState((s) => void (s.connection = this.retry ? 'reconnecting' : 'connecting'));
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => this.send('heartbeat'), 25_000);
    };
    ws.onmessage = (ev) => {
      try {
        const { t: type, d } = JSON.parse(ev.data);
        handle(type, d);
      } catch (e) {
        console.error('[gateway]', e);
      }
    };
    ws.onclose = (ev) => {
      if (this.heartbeat) clearInterval(this.heartbeat);
      if (this.ws !== ws) return;
      this.ws = null;
      if (ev.code === 4001 || ev.code === 4004) {
        this.stopped = true;
        this.onSessionRevoked?.();
        return;
      }
      if (this.stopped) return;
      setState((s) => void (s.connection = 'reconnecting'));
      voice.handleDisconnect();
      const delay = Math.min(15_000, 500 * 2 ** this.retry++) + Math.random() * 500;
      this.timer = setTimeout(() => this.open(), delay);
    };
  }

  /** Absent après 10 minutes d'inactivité. */
  private setupIdleDetection() {
    const reset = () => {
      if (this.idle) {
        this.idle = false;
        this.send('presence', { idle: false });
      }
      if (this.idleTimer) clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => {
        this.idle = true;
        this.send('presence', { idle: true });
      }, 10 * 60_000);
    };
    for (const ev of ['mousemove', 'keydown', 'pointerdown', 'focus']) window.addEventListener(ev, reset, { passive: true });
    reset();
  }
}

export const gateway = new GatewayClient();

/* ------------------------------------------------------------------ */
/* Accusés de lecture (regroupés)                                      */
/* ------------------------------------------------------------------ */
const ackTimers = new Map<string, ReturnType<typeof setTimeout>>();
export function ackChannel(channelId: string, messageId?: string | null) {
  const s = S();
  const ch = findChannel(s, channelId);
  const target = messageId ?? ch?.lastMessageId;
  if (!target) return;
  const rs = s.readStates[channelId];
  if (rs && !snowGt(target, rs.lastReadId) && !rs.mentionCount) return;
  setState((st) => {
    st.readStates[channelId] = { lastReadId: target, mentionCount: 0 };
  });
  if (ackTimers.has(channelId)) clearTimeout(ackTimers.get(channelId));
  ackTimers.set(
    channelId,
    setTimeout(() => {
      ackTimers.delete(channelId);
      post(`/channels/${channelId}/ack`, { messageId: target }).catch(() => {});
    }, 600),
  );
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */
function updateBadge() {
  const s = S();
  let total = 0;
  for (const rs of Object.values(s.readStates)) total += rs.mentionCount;
  desktop?.setBadge(total);
  document.title = total > 0 ? `(${total}) endBuy` : 'endBuy';
}

function notifyMessage(m: Message) {
  const s = S();
  const me = s.me;
  if (!me || !m.author || m.author.id === me.id) return;
  const ch = findChannel(s, m.channelId);
  if (!ch) return;
  const isDM = ch.type === CH.DM || ch.type === CH.GROUP_DM;
  const mentioned = m.mentions.includes(me.id) || m.mentionEveryone;
  const n = me.settings.notifications;
  const focusedHere = document.hasFocus() && s.focusedChannelId === m.channelId;
  if (focusedHere) return;
  if (me.status === 'dnd') return;
  const shouldNotify = (isDM && n.dmNotifications) || mentioned || (!n.mentionsOnly && isDM);
  if (!shouldNotify) return;
  if (n.sounds) (mentioned ? sounds.mention : sounds.message)();
  if (n.desktop && !document.hasFocus()) {
    const server = ch.serverId ? s.servers[ch.serverId] : null;
    const title = server
      ? `${displayName(s, m.author.id, ch.serverId)} (#${ch.name}, ${server.name})`
      : displayName(s, m.author.id);
    const body = m.content ? m.content.slice(0, 180) : m.attachments.length ? t('📎 Pièce jointe') : m.sticker ? t('Sticker') : '';
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const notif = new Notification(title, { body, tag: m.channelId, silent: true });
        notif.onclick = () => {
          window.focus();
          window.dispatchEvent(new CustomEvent('endbuy:navigate', { detail: ch.serverId ? `/channels/${ch.serverId}/${ch.id}` : `/channels/@me/${ch.id}` }));
        };
      } catch {
        desktop?.notify(title, body);
      }
    }
    desktop?.flashFrame();
  }
}

/* ------------------------------------------------------------------ */
/* Gestion des événements                                              */
/* ------------------------------------------------------------------ */
function addUsers(users: User[] | undefined) {
  if (!users?.length) return;
  setState((s) => {
    for (const u of users) s.users[u.id] = u;
  });
}

function upsertServer(server: Server) {
  setState((s) => {
    s.servers[server.id] = server;
    if (!s.serverOrder.includes(server.id)) s.serverOrder.push(server.id);
  });
}

function upsertPrivateChannel(c: Channel) {
  setState((s) => {
    s.privateChannels[c.id] = c;
  });
}

function patchMessage(channelId: string, id: string, fn: (m: Message) => void) {
  setState((s) => {
    const b = s.messages[channelId];
    const m = b?.list.find((x) => x.id === id);
    if (m) fn(m);
  });
}

function handle(type: string, d: any) {
  switch (type) {
    case 'READY': {
      const r = d as Ready;
      setState((s) => {
        s.me = r.user;
        s.sessionId = r.sessionId;
        s.iceServers = r.rtc.iceServers;
        s.servers = {};
        s.serverOrder = [];
        for (const sv of r.servers) {
          s.servers[sv.id] = sv;
          s.serverOrder.push(sv.id);
        }
        try {
          const saved = JSON.parse(localStorage.getItem('endbuy.serverOrder') || '[]') as string[];
          s.serverOrder.sort((a, b) => {
            const ia = saved.indexOf(a);
            const ib = saved.indexOf(b);
            return (ia === -1 ? 9999 : ia) - (ib === -1 ? 9999 : ib);
          });
        } catch {
          /* ignoré */
        }
        s.users = {};
        for (const u of r.users) s.users[u.id] = u;
        s.users[r.user.id] = r.user;
        s.presences = r.presences;
        s.privateChannels = {};
        for (const c of r.privateChannels) s.privateChannels[c.id] = c;
        s.relationships = {};
        for (const rel of r.relationships) s.relationships[rel.id] = rel;
        s.readStates = r.readStates;
        s.voiceStates = {};
        for (const v of r.voiceStates) s.voiceStates[v.userId] = v;
        // Les messages chargés restent valides mais peuvent avoir manqué des événements : on les recharge.
        s.messages = {};
        s.ready = true;
        s.connection = 'connected';
      });
      updateBadge();
      voice.handleReady();
      break;
    }
    case 'HEARTBEAT_ACK':
      break;

    case 'SERVER_SYNC': {
      addUsers(d.users);
      upsertServer(d.server);
      setState((s) => {
        Object.assign(s.presences, d.presences ?? {});
        const chIds = new Set((d.server as Server).channels.map((c) => c.id));
        for (const [uid, v] of Object.entries(s.voiceStates)) if (v.serverId === d.server.id && !chIds.has(v.channelId)) delete s.voiceStates[uid];
        for (const v of d.voiceStates ?? []) s.voiceStates[v.userId] = v;
      });
      break;
    }
    case 'SERVER_DELETE': {
      const name = S().servers[d.id]?.name;
      setState((s) => {
        delete s.servers[d.id];
        s.serverOrder = s.serverOrder.filter((x) => x !== d.id);
      });
      if (S().voice.serverId === d.id) voice.leave();
      if (name && d.reason === 'kicked') toast(t('Tu as été expulsé de « {name} ».', { name }), 'error');
      if (name && d.reason === 'banned') toast(t('Tu as été banni de « {name} ».', { name }), 'error');
      if (name && d.reason === 'deleted') toast(t('Le serveur « {name} » a été supprimé.', { name }));
      window.dispatchEvent(new CustomEvent('endbuy:server-removed', { detail: d.id }));
      break;
    }

    case 'EVENT_UPDATE': {
      const ev = d.event as ServerEvent;
      setState((s) => {
        const sv = s.servers[ev.serverId];
        if (!sv) return;
        sv.events ??= [];
        const i = sv.events.findIndex((e) => e.id === ev.id);
        if (ev.status === EV.CANCELED) {
          if (i >= 0) sv.events.splice(i, 1);
        } else if (i >= 0) sv.events[i] = ev;
        else sv.events.push(ev);
        sv.events.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      });
      break;
    }
    case 'EVENT_DELETE':
      setState((s) => {
        const sv = s.servers[d.serverId];
        if (sv?.events) sv.events = sv.events.filter((e) => e.id !== d.id);
      });
      break;
    case 'EVENT_STARTED':
    case 'EVENT_REMINDER': {
      const ev = d.event as ServerEvent;
      const s = S();
      const server = s.servers[ev.serverId];
      const text =
        type === 'EVENT_STARTED'
          ? t('« {name} » a commencé sur {server} !', { name: ev.name, server: server?.name ?? '' })
          : t('« {name} » devait commencer maintenant sur {server}.', { name: ev.name, server: server?.name ?? '' });
      const go = () => {
        if (ev.channelId) {
          const ch = server?.channels.find((c) => c.id === ev.channelId);
          if (ch && type === 'EVENT_STARTED') voice.join(ch.id, ev.serverId);
          window.dispatchEvent(new CustomEvent('endbuy:navigate', { detail: `/channels/${ev.serverId}/${ev.channelId}` }));
        } else window.dispatchEvent(new CustomEvent('endbuy:navigate', { detail: `/channels/${ev.serverId}` }));
      };
      toast(text, 'info', { onClick: go });
      if (s.me?.settings.notifications.sounds && s.me.status !== 'dnd') sounds.mention();
      if (s.me?.settings.notifications.desktop && !document.hasFocus() && 'Notification' in window && Notification.permission === 'granted') {
        try {
          const n = new Notification(t('Événement'), { body: text, tag: ev.id });
          n.onclick = () => {
            window.focus();
            go();
          };
        } catch {
          /* ignoré */
        }
      }
      desktop?.flashFrame();
      break;
    }

    case 'CHANNEL_CREATE':
      addUsers(d.users);
      upsertPrivateChannel(d.channel);
      break;
    case 'CHANNEL_UPDATE':
      addUsers(d.users);
      upsertPrivateChannel(d.channel);
      break;
    case 'CHANNEL_DELETE':
      setState((s) => {
        if (d.closed && s.privateChannels[d.id]) s.privateChannels[d.id].closed = true;
        else delete s.privateChannels[d.id];
      });
      break;

    case 'MESSAGE_CREATE': {
      const m = d as Message;
      setState((s) => {
        const b = s.messages[m.channelId];
        if (b?.loaded && !b.list.some((x) => x.id === m.id)) b.list.push(m);
        const ch = findChannel(s, m.channelId);
        if (ch) ch.lastMessageId = m.id;
        if (s.privateChannels[m.channelId]) s.privateChannels[m.channelId].closed = false;
        if (m.author) {
          s.users[m.author.id] = m.author;
          if (s.typing[m.channelId]) delete s.typing[m.channelId][m.author.id];
        }
        const me = s.me;
        if (me && m.author?.id !== me.id) {
          const isDM = !!s.privateChannels[m.channelId];
          if (m.mentions.includes(me.id) || m.mentionEveryone || isDM) {
            const rs = s.readStates[m.channelId] ?? { lastReadId: null, mentionCount: 0 };
            rs.mentionCount += 1;
            s.readStates[m.channelId] = rs;
          }
        } else if (me && m.author?.id === me.id) {
          s.readStates[m.channelId] = { lastReadId: m.id, mentionCount: 0 };
        }
      });
      const s = S();
      if (s.focusedChannelId === m.channelId && document.hasFocus() && m.author?.id !== s.me?.id) ackChannel(m.channelId, m.id);
      notifyMessage(m);
      updateBadge();
      break;
    }
    case 'MESSAGE_UPDATE': {
      const m = d as Message;
      patchMessage(m.channelId, m.id, (x) => Object.assign(x, m));
      break;
    }
    case 'MESSAGE_DELETE':
      setState((s) => {
        const b = s.messages[d.channelId];
        if (b) b.list = b.list.filter((x) => x.id !== d.id);
      });
      break;
    case 'MESSAGE_REACTION_ADD':
      patchMessage(d.channelId, d.messageId, (m) => {
        const r = m.reactions.find((x) => x.emoji === d.emoji);
        if (r) {
          if (!r.userIds.includes(d.userId)) {
            r.userIds.push(d.userId);
            r.count = r.userIds.length;
          }
        } else m.reactions.push({ emoji: d.emoji, count: 1, userIds: [d.userId] });
      });
      break;
    case 'MESSAGE_REACTION_REMOVE':
      patchMessage(d.channelId, d.messageId, (m) => {
        const r = m.reactions.find((x) => x.emoji === d.emoji);
        if (!r) return;
        r.userIds = r.userIds.filter((u) => u !== d.userId);
        r.count = r.userIds.length;
        if (!r.count) m.reactions = m.reactions.filter((x) => x.emoji !== d.emoji);
      });
      break;
    case 'MESSAGE_ACK':
      setState((s) => {
        s.readStates[d.channelId] = { lastReadId: d.messageId, mentionCount: 0 };
      });
      updateBadge();
      break;
    case 'TYPING_START':
      setState((s) => {
        s.typing[d.channelId] ??= {};
        s.typing[d.channelId][d.userId] = Date.now() + 9000;
      });
      break;

    case 'PRESENCE_UPDATE':
      setState((s) => {
        s.presences[d.userId] = { status: d.status, customStatus: d.customStatus, customStatusEmoji: d.customStatusEmoji };
      });
      break;
    case 'USER_UPDATE':
      setState((s) => {
        if (d.self) {
          s.me = d.user;
          s.users[d.user.id] = d.user;
        } else s.users[d.user.id] = d.user;
      });
      break;
    case 'USER_DELETE':
      setState((s) => {
        if (s.users[d.userId]) s.users[d.userId].deleted = true;
        delete s.relationships[d.userId];
      });
      break;

    case 'RELATIONSHIP_ADD': {
      const prev = S().relationships[d.relationship.id];
      setState((s) => {
        s.users[d.user.id] = d.user;
        s.relationships[d.relationship.id] = d.relationship;
        if (d.presence) s.presences[d.user.id] = d.presence;
      });
      if (d.relationship.type === 3 && prev?.type !== 3) {
        toast(t('{name} t’a envoyé une demande d’ami.', { name: d.user.displayName }), 'info');
        if (S().me?.settings.notifications.sounds) sounds.message();
      }
      if (d.relationship.type === 1 && prev?.type === 4) toast(t('{name} a accepté ta demande d’ami.', { name: d.user.displayName }), 'success');
      break;
    }
    case 'RELATIONSHIP_REMOVE':
      setState((s) => {
        delete s.relationships[d.id];
      });
      break;

    case 'VOICE_STATE_UPDATE': {
      const myId = S().me?.id;
      const myChannel = S().voice.channelId;
      setState((s) => {
        if (d.channelId === null) delete s.voiceStates[d.userId];
        else s.voiceStates[d.userId] = d;
      });
      if (d.userId !== myId && myChannel) {
        if (d.channelId === myChannel && !voice.hasPeer(d.userId)) sounds.join();
        if (d.channelId !== myChannel && d.previousChannelId === myChannel) {
          sounds.leave();
          voice.removePeer(d.userId);
        }
      }
      if (d.userId === myId) voice.onOwnVoiceState(d);
      if (myChannel && (d.channelId === myChannel || d.previousChannelId === myChannel)) voice.reconcile(d.userId);
      // Fin de l'appel entrant si l'appelant raccroche
      const ic = S().incomingCall;
      if (ic && d.userId === ic.callerId && d.channelId !== ic.channelId) {
        setState((s) => void (s.incomingCall = null));
        stopRinging();
      }
      break;
    }
    case 'VOICE_READY':
      voice.onVoiceReady(d);
      break;
    case 'VOICE_ERROR':
      voice.onVoiceError(d);
      break;
    case 'RTC_SIGNAL':
      voice.onSignal(d.from, d.data);
      break;
    case 'CALL_RING': {
      const s = S();
      if (s.voice.channelId === d.channelId || s.me?.status === 'dnd') break;
      setState((st) => void (st.incomingCall = { channelId: d.channelId, callerId: d.callerId }));
      startRinging();
      setTimeout(() => {
        if (S().incomingCall?.channelId === d.channelId) {
          setState((st) => void (st.incomingCall = null));
          stopRinging();
        }
      }, 30_000);
      if (s.me?.settings.notifications.desktop && !document.hasFocus() && 'Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification(t('Appel entrant'), { body: t('{name} t’appelle', { name: displayName(s, d.callerId) }), tag: 'call' });
        } catch {
          /* ignoré */
        }
      }
      desktop?.flashFrame();
      break;
    }
    case 'CALL_DISMISS':
      if (S().incomingCall?.channelId === d.channelId) {
        setState((s) => void (s.incomingCall = null));
        stopRinging();
      }
      break;
  }
}

// Nettoyage périodique des indicateurs de saisie expirés
setInterval(() => {
  const now = Date.now();
  const typing = S().typing;
  let dirty = false;
  for (const ch of Object.values(typing)) for (const exp of Object.values(ch)) if (exp < now) dirty = true;
  if (dirty)
    setState((s) => {
      for (const [cid, ch] of Object.entries(s.typing)) {
        for (const [uid, exp] of Object.entries(ch)) if (exp < now) delete ch[uid];
        if (!Object.keys(ch).length) delete s.typing[cid];
      }
    });
}, 2000);
