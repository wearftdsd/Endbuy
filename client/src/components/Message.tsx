import { memo, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Copy,
  Download,
  FileText,
  Hash,
  Pencil,
  Phone,
  Pin,
  PinOff,
  Reply,
  SmilePlus,
  Trash2,
  UserMinus,
  UserPlus,
} from 'lucide-react';
import { del, patch, put } from '../lib/api';
import { QUICK_REACTIONS, replaceShortcodes } from '../lib/emoji';
import { formatDateTime, formatSize, formatTime, plainPreview, renderMarkdown, CustomEmoji } from '../lib/format';
import { t } from '../lib/i18n';
import { has, P } from '../lib/perms';
import { confirmDialog, displayName, memberColor, openContextMenu, openModal, S, setState, toast, useStore } from '../lib/store';
import type { Channel, Message as Msg } from '../lib/types';
import { EmojiPicker } from './EmojiPicker';
import { Avatar } from './ui';

export function reactionKey(value: string) {
  const m = /^<a?:(\w+):(\d+)>$/.exec(value);
  return m ? `${m[1]}:${m[2]}` : value;
}

export async function toggleReaction(m: Msg, emoji: string) {
  const me = S().me!;
  const r = m.reactions.find((x) => x.emoji === emoji);
  const path = `/channels/${m.channelId}/messages/${m.id}/reactions/${encodeURIComponent(emoji)}`;
  try {
    if (r?.userIds.includes(me.id)) await del(path);
    else await put(path);
  } catch (e) {
    toast((e as Error).message, 'error');
  }
}

function ReactionEmoji({ emoji }: { emoji: string }) {
  const m = /^(\w+):(\d+)$/.exec(emoji);
  if (m) return <CustomEmoji id={m[2]} name={m[1]} size={18} />;
  return <span className="text-base leading-none">{emoji}</span>;
}

function Attachments({ m }: { m: Msg }) {
  return (
    <div className="flex flex-col gap-1.5 mt-1">
      {m.attachments.map((a) => {
        if (a.contentType.startsWith('image/')) {
          return (
            <button key={a.id} className="block w-fit max-w-full" onClick={() => openModal({ type: 'image', url: a.url, filename: a.filename })}>
              <img src={a.url} alt={a.filename} loading="lazy" className="rounded-lg max-h-[320px] max-w-[min(100%,420px)] object-contain bg-bg-3 border border-line" />
            </button>
          );
        }
        if (a.contentType.startsWith('video/')) {
          return <video key={a.id} src={a.url} controls preload="metadata" className="rounded-lg max-h-[340px] max-w-[min(100%,480px)] bg-black border border-line" />;
        }
        if (a.contentType.startsWith('audio/')) {
          return (
            <div key={a.id} className="rounded-lg bg-bg-3 border border-line p-3 max-w-[420px]">
              <div className="text-sm font-medium truncate mb-2">{a.filename}</div>
              <audio src={a.url} controls className="w-full" preload="metadata" />
            </div>
          );
        }
        return (
          <div key={a.id} className="flex items-center gap-3 rounded-lg bg-bg-3 border border-line p-3 max-w-[420px]">
            <FileText size={32} className="text-accent-2 shrink-0" />
            <div className="min-w-0 flex-1">
              <a href={a.url} download={a.filename} className="text-accent-2 hover:underline text-sm font-medium truncate block">
                {a.filename}
              </a>
              <div className="text-xs text-fg-3">{formatSize(a.size)}</div>
            </div>
            <a href={a.url} download={a.filename} className="icon-btn" title={t('Télécharger')}>
              <Download size={18} />
            </a>
          </div>
        );
      })}
    </div>
  );
}

function Embeds({ m }: { m: Msg }) {
  return (
    <>
      {m.embeds.map((e, i) =>
        e.type === 'image' ? (
          <button key={i} className="block mt-1" onClick={() => openModal({ type: 'image', url: e.url, filename: e.url })}>
            <img src={e.url} alt="" loading="lazy" referrerPolicy="no-referrer" className="rounded-lg max-h-[300px] max-w-[min(100%,400px)] object-contain border border-line" />
          </button>
        ) : e.type === 'video' ? (
          <video key={i} src={e.url} controls preload="metadata" className="rounded-lg mt-1 max-h-[300px] max-w-[min(100%,480px)]" />
        ) : (
          <div key={i} className="mt-1.5 max-w-[480px] rounded-md bg-bg-1 border border-line border-l-4 p-3 flex gap-3" style={{ borderLeftColor: e.color ?? 'var(--accent)' }}>
            <div className="min-w-0 flex-1">
              {e.siteName && <div className="text-xs text-fg-3 mb-1">{e.siteName}</div>}
              {e.title && (
                <a href={e.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent-2 hover:underline block line-clamp-2">
                  {e.title}
                </a>
              )}
              {e.description && <div className="text-sm text-fg-2 mt-1 line-clamp-3">{e.description}</div>}
            </div>
            {e.image && <img src={e.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-20 h-20 rounded object-cover shrink-0" />}
          </div>
        ),
      )}
    </>
  );
}

function EditBox({ m, onDone }: { m: Msg; onDone: () => void }) {
  const [value, setValue] = useState(m.content);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);
  const save = async () => {
    const custom = Object.values(S().servers).flatMap((s) => s.emojis.filter((e) => e.kind === 'emoji'));
    const content = replaceShortcodes(value.trim(), custom);
    if (content === m.content) return onDone();
    try {
      await patch(`/channels/${m.channelId}/messages/${m.id}`, { content });
      onDone();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  return (
    <div className="mt-1">
      <textarea
        ref={ref}
        className="input resize-none text-[15px]"
        rows={Math.min(10, value.split('\n').length + 1)}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            save();
          }
          if (e.key === 'Escape') onDone();
        }}
      />
      <div className="text-xs text-fg-3 mt-1">
        {t('Échap pour')}{' '}
        <button className="text-accent-2 hover:underline" onClick={onDone}>
          {t('annuler')}
        </button>{' '}
        • {t('Entrée pour')}{' '}
        <button className="text-accent-2 hover:underline" onClick={save}>
          {t('enregistrer')}
        </button>
      </div>
    </div>
  );
}

function SystemMessage({ m, serverId }: { m: Msg; serverId: string | null }) {
  const author = useStore((s) => (m.author ? displayName(s, m.author.id, serverId) : t('Quelqu’un')));
  const target = useStore((s) => (m.type === 4 ? displayName(s, m.content) : ''));
  const config: Record<number, { icon: React.ReactNode; text: string; color: string }> = {
    1: { icon: <ArrowRight size={16} />, text: t('{name} a rejoint le serveur. Bienvenue !', { name: author }), color: 'text-success' },
    2: { icon: <Pin size={16} />, text: t('{name} a épinglé un message dans ce salon.', { name: author }), color: 'text-fg-2' },
    3: { icon: <Phone size={16} />, text: t('{name} a démarré un appel.', { name: author }), color: 'text-success' },
    4: { icon: <UserPlus size={16} />, text: t('{name} a ajouté {target} au groupe.', { name: author, target }), color: 'text-success' },
    5: { icon: <UserMinus size={16} />, text: t('{name} a quitté le groupe.', { name: author }), color: 'text-danger' },
  };
  const c = config[m.type] ?? { icon: <Hash size={16} />, text: m.content, color: 'text-fg-3' };
  return (
    <div id={`msg-${m.id}`} className="flex items-center gap-4 px-4 py-1.5 hover:bg-bg-3/40 text-fg-3 text-sm anim-msg">
      <span className={`w-10 flex justify-center ${c.color}`}>{c.icon}</span>
      <span>
        {c.text} <span className="text-xs ml-1">{formatDateTime(m.createdAt)}</span>
      </span>
    </div>
  );
}

function MessageImpl({ m, compact, channel, highlight }: { m: Msg; compact: boolean; channel: Channel; highlight?: boolean }) {
  const serverId = channel.serverId;
  const me = useStore((s) => s.me!);
  const editing = useStore((s) => s.editingId === m.id);
  const authorName = useStore((s) => (m.author ? displayName(s, m.author.id, serverId) : t('Utilisateur supprimé')));
  const color = useStore((s) => (m.author ? memberColor(s, serverId, m.author.id) : undefined));
  const replyName = useStore((s) => (m.replyTo?.author ? displayName(s, m.replyTo.author.id, serverId) : t('Message supprimé')));
  const replyColor = useStore((s) => (m.replyTo?.author ? memberColor(s, serverId, m.replyTo.author.id) : undefined));
  const [picker, setPicker] = useState(false);
  const [hover, setHover] = useState(false);

  if (m.type !== 0) return <SystemMessage m={m} serverId={serverId} />;

  const mine = m.author?.id === me.id;
  const perms = channel.permissions ?? -1;
  const canManage = serverId ? has(perms, P.MANAGE_MESSAGES) : false;
  const canPin = serverId ? canManage : true;
  const canDelete = mine || canManage;
  const canReact = serverId ? has(perms, P.ADD_REACTIONS) : true;
  const mentioned = m.mentions.includes(me.id) || m.mentionEveryone;

  const openProfile = (e: React.MouseEvent) => {
    if (!m.author) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setState((s) => void (s.popout = { userId: m.author!.id, serverId, x: r.right + 10, y: r.top }));
  };
  const reply = () => setState((s) => void (s.replyTo[m.channelId] = m));
  const edit = () => setState((s) => void (s.editingId = m.id));
  const remove = (skip = false) => {
    const go = () => del(`/channels/${m.channelId}/messages/${m.id}`).catch((e) => toast(e.message, 'error'));
    if (skip) return go();
    confirmDialog({
      title: t('Supprimer le message'),
      body: (
        <div>
          <p className="mb-3">{t('Es-tu sûr de vouloir supprimer ce message ?')}</p>
          <div className="rounded-lg bg-bg-1 border border-line p-3 text-sm max-h-40 overflow-hidden">{plainPreview(m.content) || t('(pièce jointe)')}</div>
          <p className="text-xs text-fg-3 mt-3">{t('Astuce : maintiens Maj en cliquant sur la corbeille pour supprimer sans confirmation.')}</p>
        </div>
      ),
      confirmLabel: t('Supprimer'),
      danger: true,
      onConfirm: go,
    });
  };
  const togglePin = () => {
    const path = `/channels/${m.channelId}/pins/${m.id}`;
    (m.pinned ? del(path) : put(path)).then(() => toast(m.pinned ? t('Message désépinglé.') : t('Message épinglé.'), 'success')).catch((e) => toast(e.message, 'error'));
  };

  const menu = (e: React.MouseEvent) =>
    openContextMenu(e, [
      ...(canReact ? [{ label: t('Ajouter une réaction'), icon: <SmilePlus size={16} />, submenu: QUICK_REACTIONS.map((q) => ({ label: q, onClick: () => toggleReaction(m, q) })) }] : []),
      ...(mine ? [{ label: t('Modifier le message'), icon: <Pencil size={16} />, onClick: edit }] : []),
      { label: t('Répondre'), icon: <Reply size={16} />, onClick: reply },
      ...(canPin ? [{ label: m.pinned ? t('Désépingler') : t('Épingler le message'), icon: m.pinned ? <PinOff size={16} /> : <Pin size={16} />, onClick: togglePin }] : []),
      { label: t('Copier le texte'), icon: <Copy size={16} />, onClick: () => navigator.clipboard?.writeText(m.content) },
      ...(canDelete ? [{ label: t('Supprimer le message'), icon: <Trash2 size={16} />, danger: true, onClick: () => remove() }] : []),
      { separator: true },
      { label: t("Copier l'identifiant du message"), onClick: () => navigator.clipboard?.writeText(m.id) },
    ]);

  return (
    <div
      id={`msg-${m.id}`}
      className={`msg-row group relative pr-12 transition-colors anim-msg ${compact ? 'py-0.5' : 'pt-2 pb-0.5 mt-2'} ${
        mentioned ? 'bg-[var(--mention)] border-l-2 border-warn pl-[14px]' : 'pl-4'
      } ${highlight ? 'bg-accent/10' : 'hover:bg-bg-3/40'}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
      }}
      onContextMenu={menu}
    >
      {m.replyTo !== null && m.replyToId && (
        <div className="flex items-center gap-1.5 ml-14 mb-0.5 text-[13px] text-fg-3 relative before:content-[''] before:absolute before:-left-9 before:top-2.5 before:w-8 before:h-2.5 before:border-l-2 before:border-t-2 before:border-bg-4 before:rounded-tl-md">
          {m.replyTo?.author && <Avatar user={m.replyTo.author} size={16} />}
          <span className="font-semibold shrink-0" style={{ color: replyColor }}>
            @{replyName}
          </span>
          <button
            className="truncate hover:text-fg text-left"
            onClick={() => {
              const el = document.getElementById(`msg-${m.replyToId}`);
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.classList.add('!bg-accent/15');
                setTimeout(() => el.classList.remove('!bg-accent/15'), 1500);
              }
            }}
          >
            {m.replyTo ? plainPreview(m.replyTo.content) || t('Cliquer pour voir la pièce jointe') : t('Le message original a été supprimé.')}
          </button>
        </div>
      )}
      <div className="flex gap-4">
        <div className="w-10 shrink-0">
          {compact ? (
            <span className="text-[10px] text-fg-3 opacity-0 group-hover:opacity-100 leading-[22px] block text-right pr-1">{formatTime(m.createdAt)}</span>
          ) : (
            <button onClick={openProfile} onContextMenu={(e) => e.stopPropagation()}>
              <Avatar user={m.author} size={40} className="msg-avatar" />
            </button>
          )}
        </div>
        <div className="min-w-0 flex-1">
          {!compact && (
            <div className="flex items-baseline gap-2">
              <button className="font-semibold hover:underline truncate" style={{ color }} onClick={openProfile}>
                {authorName}
              </button>
              <span className="text-xs text-fg-3 shrink-0" title={new Date(m.createdAt).toLocaleString()}>
                {formatDateTime(m.createdAt)}
              </span>
            </div>
          )}
          {editing ? (
            <EditBox m={m} onDone={() => setState((s) => void (s.editingId = null))} />
          ) : (
            m.content && (
              <div className="text-[15px] leading-[1.4] text-fg">
                {renderMarkdown(m.content, serverId)}
                {m.editedAt && (
                  <span className="text-[10px] text-fg-3 ml-1" title={formatDateTime(m.editedAt)}>
                    ({t('modifié')})
                  </span>
                )}
              </div>
            )
          )}
          {m.sticker && <img src={`/api/emojis/${m.sticker.id}`} alt={m.sticker.name} title={m.sticker.name} className="w-40 h-40 object-contain mt-1" />}
          {m.attachments.length > 0 && <Attachments m={m} />}
          {m.embeds.length > 0 && <Embeds m={m} />}
          {m.reactions.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {m.reactions.map((r) => {
                const meReacted = r.userIds.includes(me.id);
                return (
                  <button
                    key={r.emoji}
                    className={`reaction-chip h-7 px-2 rounded-lg flex items-center gap-1.5 text-sm border transition-colors ${
                      meReacted ? 'bg-accent/15 border-accent text-fg' : 'bg-bg-3 border-transparent text-fg-2 hover:border-bg-4'
                    }`}
                    onClick={() => toggleReaction(m, r.emoji)}
                    title={r.userIds.map((id) => displayName(S(), id, serverId)).join(', ')}
                  >
                    <ReactionEmoji emoji={r.emoji} /> <span className="font-semibold text-xs">{r.count}</span>
                  </button>
                );
              })}
              {canReact && (
                <button className="h-7 px-2 rounded-lg bg-bg-3 text-fg-3 hover:text-fg opacity-0 group-hover:opacity-100" onClick={() => setPicker(true)} title={t('Ajouter une réaction')}>
                  <SmilePlus size={16} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {m.pinned && <Pin size={12} className="absolute right-3 top-2 text-fg-3" />}
      {(hover || picker) && !editing && (
        <div className="absolute -top-4 right-4 z-10 flex items-center bg-float border border-line rounded-lg p-0.5 anim-fade" style={{ boxShadow: 'var(--shadow)' }}>
          {canReact &&
            QUICK_REACTIONS.slice(0, 3).map((q) => (
              <button key={q} className="icon-btn !w-8 !h-8 text-lg" onClick={() => toggleReaction(m, q)}>
                {q}
              </button>
            ))}
          {canReact && (
            <button className="icon-btn !w-8 !h-8" onClick={() => setPicker(!picker)} title={t('Ajouter une réaction')}>
              <SmilePlus size={18} />
            </button>
          )}
          <button className="icon-btn !w-8 !h-8" onClick={reply} title={t('Répondre')}>
            <Reply size={18} />
          </button>
          {mine && (
            <button className="icon-btn !w-8 !h-8" onClick={edit} title={t('Modifier')}>
              <Pencil size={16} />
            </button>
          )}
          {canPin && (
            <button className="icon-btn !w-8 !h-8" onClick={togglePin} title={m.pinned ? t('Désépingler') : t('Épingler')}>
              {m.pinned ? <PinOff size={16} /> : <Pin size={16} />}
            </button>
          )}
          {canDelete && (
            <button className="icon-btn !w-8 !h-8 hover:!text-danger" onClick={(e) => remove(e.shiftKey)} title={t('Supprimer')}>
              <Trash2 size={16} />
            </button>
          )}
        </div>
      )}
      {picker && (
        <div className="absolute right-4 top-6 z-30">
          <EmojiPicker
            currentServerId={serverId}
            onPick={(v) => {
              toggleReaction(m, reactionKey(v));
              setPicker(false);
            }}
            onClose={() => setPicker(false)}
          />
        </div>
      )}
    </div>
  );
}

export const MessageItem = memo(MessageImpl);
