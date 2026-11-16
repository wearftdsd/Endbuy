import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AtSign, Hash, Menu, Phone, Pin, Search, UserPlus, Users, Video, X } from 'lucide-react';
import { get } from '../lib/api';
import { formatDay, sameDay } from '../lib/format';
import { ackChannel } from '../lib/gateway';
import { t, tn } from '../lib/i18n';
import { voice } from '../lib/rtc';
import { channelTitle, displayName, openModal, presenceOf, S, setState, toast, useStore } from '../lib/store';
import { CH, type Channel, type Message } from '../lib/types';
import { Composer } from './Composer';
import { MemberList } from './MemberList';
import { MessageItem } from './Message';
import { PinsPanel, SearchPanel } from './Panels';
import { Avatar } from './ui';
import { DMCallPanel } from './VoiceView';

const PAGE = 50;

export async function loadMessages(channelId: string, before?: string) {
  const bucket = S().messages[channelId];
  if (bucket?.loading) return;
  setState((s) => {
    s.messages[channelId] ??= { list: [], hasMore: true, loading: true, loaded: false };
    s.messages[channelId].loading = true;
  });
  try {
    const list = await get<Message[]>(`/channels/${channelId}/messages?limit=${PAGE}${before ? `&before=${before}` : ''}`);
    setState((s) => {
      const b = s.messages[channelId];
      if (before) {
        const ids = new Set(b.list.map((m) => m.id));
        b.list = [...list.filter((m) => !ids.has(m.id)), ...b.list];
      } else {
        const ids = new Set(list.map((m) => m.id));
        b.list = [...list, ...b.list.filter((m) => !ids.has(m.id))];
      }
      b.hasMore = list.length === PAGE;
      b.loading = false;
      b.loaded = true;
    });
  } catch (e) {
    setState((s) => {
      const b = s.messages[channelId];
      b.loading = false;
      b.loaded = true;
      b.hasMore = false;
    });
    toast((e as Error).message, 'error');
  }
}

function TypingIndicator({ channel }: { channel: Channel }) {
  const names = useStore((s) => {
    const typing = s.typing[channel.id] ?? {};
    const now = Date.now();
    return Object.entries(typing)
      .filter(([uid, exp]) => exp > now && uid !== s.me?.id)
      .map(([uid]) => displayName(s, uid, channel.serverId))
      .join('|');
  });
  const list = names ? names.split('|') : [];
  return (
    <div className="h-6 px-4 -mt-5 mb-0.5 text-xs text-fg-2 flex items-center gap-1.5 shrink-0">
      {list.length > 0 && (
        <>
          <span className="flex gap-0.5 items-center">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </span>
          <span className="truncate">
            {list.length === 1
              ? t('{a} est en train d’écrire…', { a: list[0] })
              : list.length === 2
                ? t('{a} et {b} sont en train d’écrire…', { a: list[0], b: list[1] })
                : t('Plusieurs personnes sont en train d’écrire…')}
          </span>
        </>
      )}
    </div>
  );
}

function Welcome({ channel }: { channel: Channel }) {
  const title = useStore((s) => channelTitle(s, channel));
  const other = channel.type === CH.DM ? channel.recipients?.[0] : undefined;
  const user = useStore((s) => (other ? s.users[other] : undefined));
  return (
    <div className="px-4 pt-10 pb-4">
      {other ? (
        <>
          <Avatar userId={other} size={80} />
          <h2 className="text-3xl font-bold mt-3">{title}</h2>
          <div className="text-xl text-fg-2">@{user?.username}</div>
          <p className="text-fg-2 mt-3">{t('Ceci est le début de ton historique de messages privés avec {name}.', { name: title })}</p>
        </>
      ) : channel.type === CH.GROUP_DM ? (
        <>
          <div className="w-20 h-20 rounded-full brand-gradient flex items-center justify-center text-white">
            <Users size={36} />
          </div>
          <h2 className="text-3xl font-bold mt-3">{title}</h2>
          <p className="text-fg-2 mt-2">{t('Bienvenue au début du groupe « {name} ».', { name: title })}</p>
        </>
      ) : (
        <>
          <div className="w-16 h-16 rounded-full bg-bg-4 flex items-center justify-center">
            <Hash size={36} />
          </div>
          <h2 className="text-3xl font-bold mt-3">{t('Bienvenue dans #{name} !', { name: title })}</h2>
          <p className="text-fg-2 mt-2">{t('Ceci est le début du salon #{name}.', { name: title })} {channel.topic}</p>
        </>
      )}
    </div>
  );
}

function MessageList({ channel }: { channel: Channel }) {
  const bucket = useStore((s) => s.messages[channel.id]);
  const scroller = useRef<HTMLDivElement>(null);
  const [firstUnread] = useState(() => S().readStates[channel.id]?.lastReadId ?? null);
  const hadUnread = useRef(!!firstUnread && firstUnread !== channel.lastMessageId);

  useEffect(() => {
    if (!bucket?.loaded) loadMessages(channel.id);
  }, [channel.id, bucket?.loaded]);

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el || !bucket || bucket.loading || !bucket.hasMore) return;
    // flex-col-reverse : scrollTop est négatif quand on remonte
    if (el.scrollHeight - el.clientHeight + el.scrollTop < 400) {
      const oldest = bucket.list[0];
      if (oldest) loadMessages(channel.id, oldest.id);
    }
  }, [bucket, channel.id]);

  useLayoutEffect(() => {
    // Si la liste ne remplit pas l'écran, on charge plus.
    const el = scroller.current;
    if (el && bucket?.loaded && bucket.hasMore && !bucket.loading && el.scrollHeight <= el.clientHeight) onScroll();
  }, [bucket, onScroll]);

  const list = bucket?.list ?? [];
  const items: React.ReactNode[] = [];
  let prev: Message | undefined;
  let unreadShown = false;
  for (const m of list) {
    if (!prev || !sameDay(prev.createdAt, m.createdAt)) {
      items.push(
        <div key={`d-${m.id}`} className="flex items-center gap-3 px-4 my-4 text-xs font-semibold text-fg-3">
          <div className="flex-1 h-px bg-line" />
          {formatDay(m.createdAt)}
          <div className="flex-1 h-px bg-line" />
        </div>,
      );
    }
    if (hadUnread.current && !unreadShown && firstUnread && m.id > firstUnread && m.id.length >= firstUnread.length && m.author?.id !== S().me?.id) {
      unreadShown = true;
      items.push(
        <div key={`u-${m.id}`} className="flex items-center gap-2 px-4 my-2 text-[11px] font-bold text-danger">
          <div className="flex-1 h-px bg-danger" />
          <span className="bg-danger text-white rounded px-1.5">{t('NOUVEAU')}</span>
        </div>,
      );
    }
    const compact =
      !!prev &&
      prev.type === 0 &&
      m.type === 0 &&
      prev.author?.id === m.author?.id &&
      !m.replyToId &&
      sameDay(prev.createdAt, m.createdAt) &&
      new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 7 * 60_000;
    items.push(<MessageItem key={m.id} m={m} compact={compact} channel={channel} />);
    prev = m;
  }

  return (
    <div ref={scroller} onScroll={onScroll} className="flex-1 overflow-y-auto scroll-thin flex flex-col-reverse min-h-0">
      <div className="pb-6">
        {bucket?.loaded && !bucket.hasMore && <Welcome channel={channel} />}
        {(!bucket?.loaded || bucket.loading) && (
          <div className="px-4 py-4 space-y-5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-4">
                <div className="w-10 h-10 rounded-full skeleton" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-40 rounded skeleton" />
                  <div className="h-3 w-3/4 rounded skeleton" />
                </div>
              </div>
            ))}
          </div>
        )}
        {items}
      </div>
    </div>
  );
}

function Header({ channel }: { channel: Channel }) {
  const title = useStore((s) => channelTitle(s, channel));
  const rightPanel = useStore((s) => s.rightPanel);
  const other = channel.type === CH.DM ? channel.recipients?.[0] : undefined;
  const presence = useStore((s) => (other ? presenceOf(s, other) : null));
  const [q, setQ] = useState('');
  const isDM = channel.type === CH.DM || channel.type === CH.GROUP_DM;
  const inCall = useStore((s) => s.voice.channelId === channel.id);
  const setPanel = (p: typeof rightPanel) => setState((s) => void (s.rightPanel = s.rightPanel === p ? null : p));
  return (
    <div className="h-12 shrink-0 px-3 flex items-center gap-2 border-b border-line bg-bg-2/80 backdrop-blur z-10">
      <button className="icon-btn md:hidden" onClick={() => setState((s) => void (s.mobileNav = true))} aria-label={t('Menu')}>
        <Menu size={20} />
      </button>
      {other ? <Avatar userId={other} size={24} showStatus ring="var(--bg-2)" /> : channel.type === CH.GROUP_DM ? <Users size={22} className="text-fg-3" /> : <Hash size={22} className="text-fg-3" />}
      <h1 className="font-bold truncate shrink-0 max-w-[40%]">{title}</h1>
      {presence?.customStatus && <span className="text-sm text-fg-3 truncate hidden sm:block">{presence.customStatusEmoji} {presence.customStatus}</span>}
      {channel.topic && (
        <>
          <div className="w-px h-6 bg-line mx-1 hidden sm:block" />
          <button className="text-sm text-fg-3 truncate hidden sm:block text-left hover:text-fg-2" onClick={() => toast(channel.topic)}>
            {channel.topic}
          </button>
        </>
      )}
      <div className="flex-1" />
      {isDM && !inCall && (
        <>
          <button className="icon-btn" title={t('Démarrer un appel vocal')} onClick={() => voice.join(channel.id, null)}>
            <Phone size={20} />
          </button>
          <button
            className="icon-btn"
            title={t('Démarrer un appel vidéo')}
            onClick={async () => {
              await voice.join(channel.id, null);
              setTimeout(() => voice.toggleCamera(), 600);
            }}
          >
            <Video size={20} />
          </button>
        </>
      )}
      {channel.type === CH.GROUP_DM && (
        <button className="icon-btn" title={t('Ajouter des amis au groupe')} onClick={() => openModal({ type: 'createGroup', channelId: channel.id })}>
          <UserPlus size={20} />
        </button>
      )}
      <button className={`icon-btn ${rightPanel === 'pins' ? 'active' : ''}`} title={t('Messages épinglés')} onClick={() => setPanel('pins')}>
        <Pin size={20} />
      </button>
      {channel.type !== CH.DM && (
        <button className={`icon-btn ${rightPanel === 'members' ? 'active' : ''}`} title={t('Liste des membres')} onClick={() => setPanel('members')}>
          <Users size={20} />
        </button>
      )}
      <form
        className="relative hidden sm:block"
        onSubmit={(e) => {
          e.preventDefault();
          if (!q.trim()) return;
          setState((s) => {
            s.searchQuery = q.trim();
            s.rightPanel = 'search';
          });
        }}
      >
        <input className="w-36 focus:w-56 transition-all bg-bg-0 rounded-md text-sm px-2 py-1 pr-7 outline-none placeholder:text-fg-3" placeholder={t('Rechercher')} value={q} onChange={(e) => setQ(e.target.value)} />
        {q ? (
          <button type="button" className="absolute right-1.5 top-1/2 -translate-y-1/2 text-fg-3" onClick={() => setQ('')}>
            <X size={14} />
          </button>
        ) : (
          <Search size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-3" />
        )}
      </form>
      <button className="icon-btn sm:hidden" onClick={() => setPanel('search')} title={t('Rechercher')}>
        <Search size={20} />
      </button>
    </div>
  );
}

export function ChatView({ channel }: { channel: Channel }) {
  const rightPanel = useStore((s) => s.rightPanel);
  const [dragging, setDragging] = useState(false);
  const dropHandler = useRef<((files: File[]) => void) | null>(null);
  const callActive = useStore((s) => Object.values(s.voiceStates).some((v) => v.channelId === channel.id));
  const isDM = channel.type === CH.DM || channel.type === CH.GROUP_DM;
  const mentionCount = useStore((s) => s.readStates[channel.id]?.mentionCount ?? 0);

  useEffect(() => {
    setState((s) => void (s.focusedChannelId = channel.id));
    ackChannel(channel.id);
    const onFocus = () => ackChannel(channel.id);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      setState((s) => {
        if (s.focusedChannelId === channel.id) s.focusedChannelId = null;
      });
    };
  }, [channel.id]);

  useEffect(() => {
    if (mentionCount > 0 && document.hasFocus()) ackChannel(channel.id);
  }, [mentionCount, channel.id]);

  return (
    <div
      className="flex-1 flex flex-col min-h-0 relative"
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes('Files')) setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const files = [...e.dataTransfer.files];
        if (files.length) dropHandler.current?.(files);
      }}
    >
      <Header channel={channel} />
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 flex flex-col min-w-0">
          {isDM && (callActive || S().voice.channelId === channel.id) && <DMCallPanel channel={channel} />}
          <MessageList channel={channel} />
          <TypingIndicator channel={channel} />
          <Composer channel={channel} onFilesDropped={(fn) => (dropHandler.current = fn)} />
        </div>
        {rightPanel === 'members' && channel.type !== CH.DM && <MemberList channel={channel} />}
        {rightPanel === 'pins' && <PinsPanel channel={channel} />}
        {rightPanel === 'search' && <SearchPanel channel={channel} />}
      </div>
      {dragging && (
        <div className="absolute inset-0 z-30 bg-accent/20 backdrop-blur-sm flex items-center justify-center pointer-events-none anim-fade">
          <div className="bg-accent text-accent-fg rounded-2xl px-10 py-8 text-center font-bold text-lg anim-pop">
            <AtSign className="mx-auto mb-2" />
            {t('Dépose tes fichiers pour les envoyer')}
            <div className="text-sm font-medium opacity-80 mt-1">{tn(1, 'Jusqu’à 500 Mo par fichier avec Nitro', 'Jusqu’à 500 Mo par fichier avec Nitro')}</div>
          </div>
        </div>
      )}
    </div>
  );
}
