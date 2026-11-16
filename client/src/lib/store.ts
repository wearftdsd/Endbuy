import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { ReactNode } from 'react';
import { CH, type Channel, type Member, type Message, type Presence, type ReadState, type Relationship, type SelfUser, type Server, type User, type VoiceState } from './types';

export type ModalState =
  | { type: 'createServer' }
  | { type: 'createChannel'; serverId: string; parentId?: string | null; channelType?: number }
  | { type: 'invite'; serverId: string }
  | { type: 'events'; serverId: string; create?: boolean; channelId?: string | null }
  | { type: 'serverSettings'; serverId: string; tab?: string }
  | { type: 'channelSettings'; channelId: string; tab?: string }
  | { type: 'userSettings'; tab?: string }
  | { type: 'profile'; userId: string; serverId?: string | null }
  | { type: 'createGroup'; channelId?: string }
  | { type: 'image'; url: string; filename: string }
  | { type: 'screenPicker' }
  | { type: 'recoveryCodes'; codes: string[] }
  | {
      type: 'confirm';
      title: string;
      body: ReactNode;
      confirmLabel?: string;
      danger?: boolean;
      input?: { label: string; placeholder?: string };
      onConfirm: (value?: string) => Promise<void> | void;
    };

export interface MenuItem {
  label?: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  hint?: string;
  onClick?: () => void;
  separator?: boolean;
  submenu?: MenuItem[];
}

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  text: string;
  title?: string;
  onClick?: () => void;
}

export interface MessageBucket {
  list: Message[];
  hasMore: boolean;
  loading: boolean;
  loaded: boolean;
}

export interface LocalVoice {
  channelId: string | null;
  serverId: string | null;
  connecting: boolean;
  mute: boolean;
  deaf: boolean;
  video: boolean;
  screen: boolean;
  micError: string | null;
}

export interface State {
  me: SelfUser | null;
  authChecked: boolean;
  ready: boolean;
  connection: 'idle' | 'connecting' | 'connected' | 'reconnecting';
  sessionId: string | null;
  iceServers: RTCIceServer[];
  servers: Record<string, Server>;
  serverOrder: string[];
  privateChannels: Record<string, Channel>;
  users: Record<string, User>;
  presences: Record<string, Presence>;
  relationships: Record<string, Relationship>;
  readStates: Record<string, ReadState>;
  messages: Record<string, MessageBucket>;
  typing: Record<string, Record<string, number>>;
  voiceStates: Record<string, VoiceState>;
  voice: LocalVoice;
  speaking: Record<string, boolean>;
  rtcVersion: number;
  incomingCall: { channelId: string; callerId: string } | null;

  modal: ModalState | null;
  modalStack: ModalState[];
  contextMenu: { x: number; y: number; items: MenuItem[] } | null;
  popout: { userId: string; serverId: string | null; x: number; y: number } | null;
  toasts: Toast[];
  replyTo: Record<string, Message | null>;
  editingId: string | null;
  rightPanel: 'members' | 'pins' | 'search' | null;
  searchQuery: string;
  mobileNav: boolean;
  focusedChannelId: string | null;
}

const initialVoice: LocalVoice = {
  channelId: null,
  serverId: null,
  connecting: false,
  mute: false,
  deaf: false,
  video: false,
  screen: false,
  micError: null,
};

export const useStore = create<State>()(
  immer(() => ({
    me: null,
    authChecked: false,
    ready: false,
    connection: 'idle',
    sessionId: null,
    iceServers: [],
    servers: {},
    serverOrder: [],
    privateChannels: {},
    users: {},
    presences: {},
    relationships: {},
    readStates: {},
    messages: {},
    typing: {},
    voiceStates: {},
    voice: { ...initialVoice },
    speaking: {},
    rtcVersion: 0,
    incomingCall: null,
    modal: null,
    modalStack: [],
    contextMenu: null,
    popout: null,
    toasts: [],
    replyTo: {},
    editingId: null,
    rightPanel: typeof window !== 'undefined' && window.innerWidth >= 1100 ? 'members' : null,
    searchQuery: '',
    mobileNav: false,
    focusedChannelId: null,
  })),
);

export const S = () => useStore.getState();
export const setState = useStore.setState;

export function resetSessionState() {
  setState((s) => {
    s.ready = false;
    s.sessionId = null;
    s.servers = {};
    s.serverOrder = [];
    s.privateChannels = {};
    s.users = {};
    s.presences = {};
    s.relationships = {};
    s.readStates = {};
    s.messages = {};
    s.typing = {};
    s.voiceStates = {};
    s.voice = { ...initialVoice };
    s.speaking = {};
    s.incomingCall = null;
    s.modal = null;
    s.modalStack = [];
    s.contextMenu = null;
    s.popout = null;
    s.replyTo = {};
  });
}

/* ------------------------------------------------------------------ */
/* Actions UI                                                          */
/* ------------------------------------------------------------------ */
let toastId = 1;
export function toast(text: string, kind: Toast['kind'] = 'info', extra: Partial<Toast> = {}) {
  const id = toastId++;
  setState((s) => {
    s.toasts.push({ id, kind, text, ...extra });
    if (s.toasts.length > 4) s.toasts.shift();
  });
  setTimeout(() => setState((s) => void (s.toasts = s.toasts.filter((t) => t.id !== id))), kind === 'error' ? 6000 : 4000);
}

export function openModal(m: ModalState) {
  setState((s) => {
    if (s.modal && m.type === 'confirm') s.modalStack.push(s.modal);
    s.modal = m as any;
    s.contextMenu = null;
    s.popout = null;
  });
}
export function closeModal() {
  setState((s) => {
    s.modal = (s.modalStack.pop() as any) ?? null;
  });
}

export function openContextMenu(e: { clientX: number; clientY: number; preventDefault: () => void; stopPropagation?: () => void }, items: MenuItem[]) {
  e.preventDefault();
  e.stopPropagation?.();
  setState((s) => {
    s.contextMenu = { x: e.clientX, y: e.clientY, items: items as any };
    s.popout = null;
  });
}

export function confirmDialog(opts: Omit<Extract<ModalState, { type: 'confirm' }>, 'type'>) {
  openModal({ type: 'confirm', ...opts });
}

/* ------------------------------------------------------------------ */
/* Sélecteurs                                                          */
/* ------------------------------------------------------------------ */
export function snowGt(a: string | null | undefined, b: string | null | undefined) {
  if (!a) return false;
  if (!b) return true;
  if (a.length !== b.length) return a.length > b.length;
  return a > b;
}

export function findChannel(s: State, id: string | null | undefined): Channel | undefined {
  if (!id) return undefined;
  if (s.privateChannels[id]) return s.privateChannels[id];
  for (const sid of s.serverOrder) {
    const c = s.servers[sid]?.channels.find((x) => x.id === id);
    if (c) return c;
  }
  return undefined;
}

export function isUnread(s: State, c: Channel) {
  if (c.type === CH.VOICE || c.type === CH.STAGE || c.type === CH.CATEGORY) return false;
  const rs = s.readStates[c.id];
  return snowGt(c.lastMessageId, rs?.lastReadId ?? null);
}

export function mentionCount(s: State, channelId: string) {
  return s.readStates[channelId]?.mentionCount ?? 0;
}

export function serverUnread(s: State, server: Server) {
  let unread = false;
  let mentions = 0;
  for (const c of server.channels) {
    if (isUnread(s, c)) unread = true;
    mentions += mentionCount(s, c.id);
  }
  return { unread, mentions };
}

export function memberOf(server: Server | undefined, userId: string): Member | undefined {
  return server?.members.find((m) => m.userId === userId);
}

export function displayName(s: State, userId: string, serverId?: string | null): string {
  const u = s.users[userId] ?? (s.me?.id === userId ? s.me : undefined);
  if (serverId) {
    const m = memberOf(s.servers[serverId], userId);
    if (m?.nickname) return m.nickname;
  }
  if (!u) return 'Utilisateur inconnu';
  if (u.deleted) return 'Utilisateur supprimé';
  return u.displayName || u.username;
}

export function memberColor(s: State, serverId: string | null | undefined, userId: string): string | undefined {
  if (!serverId) return undefined;
  const server = s.servers[serverId];
  const m = memberOf(server, userId);
  if (!server || !m) return undefined;
  let best: { pos: number; color: string } | undefined;
  for (const rid of m.roles) {
    const r = server.roles.find((x) => x.id === rid);
    if (r?.color && (!best || r.position > best.pos)) best = { pos: r.position, color: r.color };
  }
  return best?.color;
}

const OFFLINE: Presence = Object.freeze({ status: 'offline', customStatus: '', customStatusEmoji: null }) as Presence;
let selfPresence: { key: string; value: Presence } | null = null;

/** Présence d'un utilisateur. Renvoie toujours la même référence pour une même valeur (sélecteurs stables). */
export function presenceOf(s: State, userId: string): Presence {
  if (s.me?.id === userId) {
    const st = s.me.status === 'invisible' ? 'offline' : s.me.status;
    const status = s.presences[userId]?.status === 'idle' && st === 'online' ? 'idle' : st;
    const key = `${status}|${s.me.customStatus}|${s.me.customStatusEmoji ?? ''}`;
    if (selfPresence?.key !== key) selfPresence = { key, value: { status, customStatus: s.me.customStatus, customStatusEmoji: s.me.customStatusEmoji } };
    return selfPresence.value;
  }
  return s.presences[userId] ?? OFFLINE;
}

export function channelTitle(s: State, c: Channel | undefined): string {
  if (!c) return '';
  if (c.type === CH.DM) return displayName(s, c.recipients?.[0] ?? '');
  if (c.type === CH.GROUP_DM) {
    if (c.name) return c.name;
    const names = (c.recipients ?? []).map((id) => displayName(s, id));
    return names.length ? names.join(', ') : 'Groupe vide';
  }
  return c.name;
}

export function sortedChannels(server: Server) {
  const cats = server.channels.filter((c) => c.type === CH.CATEGORY).sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1));
  const byParent = (pid: string | null) =>
    server.channels
      .filter((c) => c.type !== CH.CATEGORY && (c.parentId ?? null) === pid)
      .sort((a, b) => (a.type === CH.VOICE || a.type === CH.STAGE ? 1 : 0) - (b.type === CH.VOICE || b.type === CH.STAGE ? 1 : 0) || a.position - b.position || (a.id < b.id ? -1 : 1));
  // Les salons dont la catégorie est invisible sont affichés sans catégorie.
  const catIds = new Set(cats.map((c) => c.id));
  const orphans = server.channels.filter((c) => c.type !== CH.CATEGORY && c.parentId && !catIds.has(c.parentId));
  return {
    uncategorized: [...byParent(null), ...orphans],
    categories: cats.map((cat) => ({ category: cat, channels: byParent(cat.id) })),
  };
}

export function firstTextChannel(server: Server | undefined): Channel | undefined {
  if (!server) return undefined;
  const { uncategorized, categories } = sortedChannels(server);
  return [...uncategorized, ...categories.flatMap((c) => c.channels)].find((c) => c.type === CH.TEXT);
}

export function voiceMembers(s: State, channelId: string): string[] {
  return Object.values(s.voiceStates)
    .filter((v) => v.channelId === channelId)
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .map((v) => v.userId);
}
