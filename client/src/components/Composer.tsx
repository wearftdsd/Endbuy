import { useEffect, useMemo, useRef, useState } from 'react';
import { AtSign, File as FileIcon, Gem, PlusCircle, SendHorizontal, Smile, Sticker, X } from 'lucide-react';
import { errorMessage, post, upload } from '../lib/api';
import { replaceShortcodes, searchEmojis } from '../lib/emoji';
import { formatSize, plainPreview } from '../lib/format';
import { gateway } from '../lib/gateway';
import { t } from '../lib/i18n';
import { has, P } from '../lib/perms';
import { channelTitle, displayName, S, setState, toast, useStore } from '../lib/store';
import { CH, type Channel } from '../lib/types';
import { EmojiPicker } from './EmojiPicker';
import { Avatar } from './ui';

interface Pending {
  id: number;
  file: File;
  preview: string | null;
}

let pendingId = 1;

interface Suggestion {
  key: string;
  label: string;
  sub?: string;
  insert: string;
  icon: React.ReactNode;
}

/** Transforme « @pseudo » en mention <@id> si la personne est présente dans le salon. */
function convertMentions(text: string, channel: Channel): string {
  const s = S();
  const candidates: string[] = channel.serverId ? s.servers[channel.serverId]?.members.map((m) => m.userId) ?? [] : [...(channel.recipients ?? []), s.me!.id];
  const byName = new Map<string, string>();
  for (const id of candidates) {
    const u = s.users[id] ?? (s.me?.id === id ? s.me : undefined);
    if (u) byName.set(u.username.toLowerCase(), id);
  }
  return text.replace(/(^|\s)@([a-zA-Z0-9_.]{2,32})/g, (full, pre, name) => {
    const id = byName.get(name.toLowerCase());
    return id ? `${pre}<@${id}>` : full;
  });
}

export function Composer({ channel, onFilesDropped }: { channel: Channel; onFilesDropped?: (fn: (files: File[]) => void) => void }) {
  const me = useStore((s) => s.me!);
  const replyTo = useStore((s) => s.replyTo[channel.id] ?? null);
  const replyName = useStore((s) => (replyTo?.author ? displayName(s, replyTo.author.id, channel.serverId) : ''));
  const title = useStore((s) => channelTitle(s, channel));
  const [text, setText] = useState(() => sessionStorage.getItem(`draft:${channel.id}`) ?? '');
  const [files, setFiles] = useState<Pending[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [picker, setPicker] = useState<null | 'emoji' | 'sticker'>(null);
  const [mentionReply, setMentionReply] = useState(true);
  const [sugIndex, setSugIndex] = useState(0);
  const [caret, setCaret] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);

  const canSend = channel.serverId ? has(channel.permissions, P.SEND_MESSAGES) : true;
  const canAttach = channel.serverId ? has(channel.permissions, P.ATTACH_FILES) : true;
  const limits = me.limits;

  useEffect(() => {
    try {
      if (text) sessionStorage.setItem(`draft:${channel.id}`, text);
      else sessionStorage.removeItem(`draft:${channel.id}`);
    } catch {
      /* ignoré */
    }
  }, [text, channel.id]);

  useEffect(() => {
    if (replyTo) ref.current?.focus();
  }, [replyTo]);

  useEffect(() => {
    ref.current?.focus();
  }, [channel.id]);

  // Hauteur automatique
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, window.innerHeight * 0.4) + 'px';
  }, [text]);

  const addFiles = (list: File[]) => {
    if (!canAttach) return toast(t("Tu n'as pas la permission d'envoyer des fichiers ici."), 'error');
    const accepted: Pending[] = [];
    for (const f of list) {
      if (f.size > limits.maxUploadBytes) {
        toast(t('« {name} » dépasse la limite de {size}.', { name: f.name, size: formatSize(limits.maxUploadBytes) }), 'error');
        continue;
      }
      accepted.push({ id: pendingId++, file: f, preview: f.type.startsWith('image/') ? URL.createObjectURL(f) : null });
    }
    setFiles((cur) => [...cur, ...accepted].slice(0, limits.maxFilesPerMessage));
  };

  useEffect(() => {
    onFilesDropped?.(addFiles);
  });

  /* ------------------------- Autocomplétion ------------------------- */
  const token = useMemo(() => {
    const before = text.slice(0, caret);
    const m = /(^|\s)([@:])([\p{L}\p{N}_.+-]{0,32})$/u.exec(before);
    if (!m) return null;
    if (m[2] === ':' && m[3].length < 2) return null;
    return { kind: m[2], query: m[3].toLowerCase(), start: before.length - m[3].length - 1 };
  }, [text, caret]);

  const suggestions: Suggestion[] = useMemo(() => {
    if (!token) return [];
    const s = S();
    if (token.kind === '@') {
      const ids = channel.serverId ? s.servers[channel.serverId]?.members.map((m) => m.userId) ?? [] : [...(channel.recipients ?? []), me.id];
      const list: Suggestion[] = ids
        .map((id) => ({ id, u: s.users[id] ?? (id === me.id ? me : undefined) }))
        .filter(({ u }) => u && (u.username.toLowerCase().includes(token.query) || displayName(s, u.id, channel.serverId).toLowerCase().includes(token.query)))
        .slice(0, 8)
        .map(({ id, u }) => ({ key: id, label: displayName(s, id, channel.serverId), sub: '@' + u!.username, insert: '@' + u!.username + ' ', icon: <Avatar userId={id} size={24} /> }));
      if (channel.serverId && has(channel.permissions, P.MENTION_EVERYONE)) {
        for (const w of ['everyone', 'here']) if (w.startsWith(token.query)) list.push({ key: w, label: '@' + w, sub: w === 'everyone' ? t('Notifie tout le monde') : t('Notifie les membres en ligne'), insert: '@' + w + ' ', icon: <AtSign size={20} /> });
      }
      return list;
    }
    const custom = Object.values(s.servers)
      .filter((sv) => limits.emojisEverywhere || sv.id === channel.serverId)
      .flatMap((sv) => sv.emojis.filter((e) => e.kind === 'emoji' && e.name.toLowerCase().includes(token.query)))
      .slice(0, 4)
      .map((e) => ({ key: e.id, label: `:${e.name}:`, insert: `:${e.name}: `, icon: <img src={e.url} alt="" className="w-6 h-6 object-contain" /> }));
    const uni = searchEmojis(token.query, 8 - custom.length).map((e) => ({ key: e.name, label: `:${e.name}:`, insert: e.char + ' ', icon: <span className="text-xl">{e.char}</span> }));
    return [...custom, ...uni];
  }, [token, channel, me, limits.emojisEverywhere]);

  useEffect(() => setSugIndex(0), [token?.query, token?.kind]);

  const applySuggestion = (sg: Suggestion) => {
    if (!token) return;
    const next = text.slice(0, token.start) + sg.insert + text.slice(caret);
    setText(next);
    const pos = token.start + sg.insert.length;
    requestAnimationFrame(() => {
      ref.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  const insertAtCursor = (value: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + value + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + value.length, start + value.length);
    });
  };

  /* ------------------------- Envoi ------------------------- */
  const send = async (stickerId?: string) => {
    if (sending) return;
    const custom = Object.values(S().servers)
      .filter((sv) => limits.emojisEverywhere || sv.id === channel.serverId)
      .flatMap((sv) => sv.emojis.filter((e) => e.kind === 'emoji'));
    const content = convertMentions(replaceShortcodes(text.trim(), custom), channel);
    if (!content && !files.length && !stickerId) return;
    if (content.length > limits.maxMessageLength) return toast(t('Message trop long ({n}/{max}).', { n: content.length, max: limits.maxMessageLength }), 'error');
    setSending(true);
    try {
      if (files.length) {
        const fd = new FormData();
        fd.append('content', content);
        if (replyTo) fd.append('replyToId', replyTo.id);
        if (!mentionReply) fd.append('mentionReply', 'false');
        for (const f of files) fd.append('files', f.file, f.file.name);
        setProgress(0);
        await upload(`/channels/${channel.id}/messages`, fd, (r) => setProgress(r));
      } else {
        await post(`/channels/${channel.id}/messages`, { content, replyToId: replyTo?.id, stickerId, mentionReply: mentionReply ? undefined : 'false' });
      }
      setText('');
      files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
      setFiles([]);
      setState((s) => void (s.replyTo[channel.id] = null));
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setSending(false);
      setProgress(null);
      ref.current?.focus();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setSugIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        applySuggestion(suggestions[sugIndex]);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
      return;
    }
    if (e.key === 'Escape' && replyTo) setState((s) => void (s.replyTo[channel.id] = null));
    if (e.key === 'ArrowUp' && !text) {
      const list = S().messages[channel.id]?.list ?? [];
      const last = [...list].reverse().find((m) => m.author?.id === me.id && m.type === 0);
      if (last) {
        e.preventDefault();
        setState((s) => void (s.editingId = last.id));
      }
    }
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    setCaret(e.target.selectionStart);
    const now = Date.now();
    if (e.target.value && now - lastTyping.current > 3000) {
      lastTyping.current = now;
      gateway.send('typing', { channelId: channel.id });
    }
  };

  if (!canSend) {
    return (
      <div className="px-4 pb-6">
        <div className="rounded-lg bg-bg-3 px-4 py-3 text-fg-3 text-sm">{t("Tu n'as pas la permission d'envoyer des messages dans ce salon.")}</div>
      </div>
    );
  }

  const placeholder = channel.type === CH.TEXT ? t('Envoyer un message dans #{name}', { name: title }) : t('Envoyer un message à {name}', { name: title });
  const remaining = limits.maxMessageLength - text.length;

  return (
    <div className="px-4 pb-5 shrink-0 relative">
      {suggestions.length > 0 && (
        <div className="absolute bottom-full left-4 right-4 mb-1 bg-float border border-line rounded-xl p-1.5 z-20 anim-up" style={{ boxShadow: 'var(--shadow)' }}>
          <div className="text-[11px] font-bold uppercase text-fg-3 px-2 py-1">{token?.kind === '@' ? t('Membres') : t('Emojis correspondant à :{q}', { q: token?.query ?? '' })}</div>
          {suggestions.map((sg, i) => (
            <button
              key={sg.key}
              className={`w-full flex items-center gap-3 px-2 py-1.5 rounded-md text-left ${i === sugIndex ? 'bg-bg-4' : 'hover:bg-bg-3'}`}
              onMouseEnter={() => setSugIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                applySuggestion(sg);
              }}
            >
              {sg.icon}
              <span className="font-medium text-sm">{sg.label}</span>
              {sg.sub && <span className="text-xs text-fg-3 ml-auto">{sg.sub}</span>}
            </button>
          ))}
        </div>
      )}
      {replyTo && (
        <div className="flex items-center gap-2 bg-bg-1 rounded-t-xl px-4 py-2 text-sm text-fg-2 border border-b-0 border-line anim-up">
          <span className="flex-1 truncate">
            {t('Réponse à')} <span className="font-semibold text-fg">{replyName}</span>
            <span className="text-fg-3 ml-2 truncate">{plainPreview(replyTo.content).slice(0, 80)}</span>
          </span>
          <button className={`text-xs font-bold flex items-center gap-1 ${mentionReply ? 'text-accent-2' : 'text-fg-3'}`} onClick={() => setMentionReply(!mentionReply)} title={t('Mentionner l’auteur')}>
            <AtSign size={14} /> {mentionReply ? t('ACTIVÉ') : t('DÉSACTIVÉ')}
          </button>
          <button className="text-fg-3 hover:text-fg" onClick={() => setState((s) => void (s.replyTo[channel.id] = null))} aria-label={t('Annuler la réponse')}>
            <X size={16} />
          </button>
        </div>
      )}
      <div className={`composer-box bg-bg-3 ${replyTo ? 'rounded-b-xl' : 'rounded-xl'} border border-line`}>
        {files.length > 0 && (
          <div className="flex gap-3 p-3 overflow-x-auto scroll-thin border-b border-line">
            {files.map((f) => (
              <div key={f.id} className="relative w-44 shrink-0 bg-bg-1 rounded-lg p-2 anim-pop">
                <div className="h-28 rounded-md bg-bg-0 flex items-center justify-center overflow-hidden">
                  {f.preview ? <img src={f.preview} alt="" className="max-h-full max-w-full object-contain" /> : <FileIcon size={40} className="text-accent-2" />}
                </div>
                <div className="text-xs truncate mt-1.5">{f.file.name}</div>
                <div className="text-[11px] text-fg-3">{formatSize(f.file.size)}</div>
                <button className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-danger text-white flex items-center justify-center" onClick={() => setFiles((cur) => cur.filter((x) => x.id !== f.id))} aria-label={t('Retirer')}>
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        {progress !== null && (
          <div className="h-1 bg-bg-0">
            <div className="h-full bg-accent transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
        <div className="flex items-end gap-1 px-2">
          {canAttach && (
            <button className="icon-btn my-2 shrink-0" onClick={() => fileRef.current?.click()} title={t('Joindre des fichiers (jusqu’à {size})', { size: formatSize(limits.maxUploadBytes) })}>
              <PlusCircle size={22} />
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              addFiles([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
          <textarea
            ref={ref}
            rows={1}
            value={text}
            placeholder={placeholder}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
            onPaste={(e) => {
              const pasted = [...e.clipboardData.files];
              if (pasted.length) {
                e.preventDefault();
                addFiles(pasted);
              }
            }}
            className="flex-1 bg-transparent resize-none outline-none py-3 px-1 text-[15px] leading-[1.375] max-h-[40vh] scroll-thin placeholder:text-fg-3"
            maxLength={limits.maxMessageLength + 500}
          />
          <div className="flex items-center gap-0.5 my-2 shrink-0 relative">
            <button className="icon-btn" onClick={() => setPicker(picker === 'sticker' ? null : 'sticker')} title={t('Stickers')}>
              <Sticker size={20} />
            </button>
            <button className="icon-btn" onClick={() => setPicker(picker === 'emoji' ? null : 'emoji')} title={t('Emojis')}>
              <Smile size={20} />
            </button>
            {(text.trim() || files.length > 0) && (
              <button className="icon-btn !text-accent anim-pop" onClick={() => send()} disabled={sending} title={t('Envoyer')} data-magnetic="0.3">
                <SendHorizontal size={20} />
              </button>
            )}
            {picker && (
              <div className="absolute bottom-12 right-0 z-30">
                <EmojiPicker
                  currentServerId={channel.serverId}
                  initialTab={picker}
                  onPick={(v) => {
                    insertAtCursor(v);
                  }}
                  onSticker={(id) => {
                    setPicker(null);
                    send(id);
                  }}
                  onClose={() => setPicker(null)}
                />
              </div>
            )}
          </div>
        </div>
      </div>
      {remaining < 300 && (
        <div className={`absolute right-6 bottom-0.5 text-xs flex items-center gap-1 ${remaining < 0 ? 'text-danger' : 'text-fg-3'}`}>
          {limits.premium && <Gem size={10} />} {remaining}
        </div>
      )}
    </div>
  );
}
