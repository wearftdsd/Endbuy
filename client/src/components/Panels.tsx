import { useEffect, useState } from 'react';
import { Pin, Search, X } from 'lucide-react';
import { del, get } from '../lib/api';
import { formatDateTime, renderMarkdown } from '../lib/format';
import { t, tn } from '../lib/i18n';
import { has, P } from '../lib/perms';
import { channelTitle, displayName, findChannel, S, setState, toast, useStore } from '../lib/store';
import type { Channel, Message } from '../lib/types';
import { Avatar, Spinner } from './ui';

function PanelShell({ title, icon, children, onClose }: { title: React.ReactNode; icon: React.ReactNode; children: React.ReactNode; onClose: () => void }) {
  return (
    <aside className="w-[340px] max-w-full shrink-0 bg-bg-1 border-l border-line flex flex-col absolute right-0 inset-y-0 z-20 lg:static anim-fade">
      <div className="h-12 shrink-0 flex items-center gap-2 px-4 border-b border-line font-bold">
        {icon} <span className="flex-1 truncate">{title}</span>
        <button className="icon-btn" onClick={onClose} aria-label={t('Fermer')}>
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin p-3 space-y-2">{children}</div>
    </aside>
  );
}

function MiniMessage({ m, onJump, extra }: { m: Message; onJump?: () => void; extra?: React.ReactNode }) {
  const ch = useStore((s) => findChannel(s, m.channelId));
  const name = useStore((s) => (m.author ? displayName(s, m.author.id, ch?.serverId) : t('Utilisateur supprimé')));
  return (
    <div className="group rounded-lg bg-bg-2 border border-line p-3 relative">
      <div className="flex items-center gap-2 mb-1">
        <Avatar user={m.author} size={24} />
        <span className="font-semibold text-sm truncate">{name}</span>
        <span className="text-[11px] text-fg-3 ml-auto shrink-0">{formatDateTime(m.createdAt)}</span>
      </div>
      <div className="text-sm">{m.content ? renderMarkdown(m.content, ch?.serverId ?? null) : <span className="text-fg-3 italic">{t('(pièce jointe)')}</span>}</div>
      {m.attachments[0]?.contentType.startsWith('image/') && <img src={m.attachments[0].url} alt="" className="mt-2 rounded max-h-40" />}
      <div className="absolute top-2 right-2 hidden group-hover:flex gap-1">
        {onJump && (
          <button className="btn btn-secondary !px-2 !py-0.5 text-xs" onClick={onJump}>
            {t('Aller')}
          </button>
        )}
        {extra}
      </div>
    </div>
  );
}

function jumpTo(m: Message) {
  const el = document.getElementById(`msg-${m.id}`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('!bg-accent/15');
    setTimeout(() => el.classList.remove('!bg-accent/15'), 1600);
  } else {
    toast(t('Ce message est plus ancien : remonte dans l’historique pour le voir.'));
  }
}

export function PinsPanel({ channel }: { channel: Channel }) {
  const [pins, setPins] = useState<Message[] | null>(null);
  const version = useStore((s) => (s.messages[channel.id]?.list ?? []).filter((m) => m.pinned).map((m) => m.id).join(','));
  useEffect(() => {
    get<Message[]>(`/channels/${channel.id}/pins`).then(setPins).catch(() => setPins([]));
  }, [channel.id, version]);
  const canUnpin = channel.serverId ? has(channel.permissions, P.MANAGE_MESSAGES) : true;
  return (
    <PanelShell title={t('Messages épinglés')} icon={<Pin size={18} />} onClose={() => setState((s) => void (s.rightPanel = null))}>
      {!pins && <Spinner className="mx-auto block mt-6" />}
      {pins?.length === 0 && (
        <div className="text-center text-fg-3 text-sm py-10 px-4">
          <Pin size={40} className="mx-auto mb-3 opacity-40" />
          {t('Ce salon n’a aucun message épinglé… pour l’instant.')}
        </div>
      )}
      {pins?.map((m) => (
        <MiniMessage
          key={m.id}
          m={m}
          onJump={() => jumpTo(m)}
          extra={
            canUnpin && (
              <button className="btn btn-secondary !px-2 !py-0.5 text-xs" onClick={() => del(`/channels/${channel.id}/pins/${m.id}`).then(() => setPins((p) => p?.filter((x) => x.id !== m.id) ?? null))}>
                <X size={12} />
              </button>
            )
          }
        />
      ))}
    </PanelShell>
  );
}

export function SearchPanel({ channel }: { channel: Channel }) {
  const query = useStore((s) => s.searchQuery);
  const [q, setQ] = useState(query);
  const [scope, setScope] = useState<'server' | 'channel'>(channel.serverId ? 'server' : 'channel');
  const [res, setRes] = useState<{ total: number; messages: Message[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const title = useStore((s) => channelTitle(s, channel));
  const serverName = useStore((s) => (channel.serverId ? s.servers[channel.serverId]?.name : ''));

  useEffect(() => setQ(query), [query]);
  useEffect(() => {
    if (!query) return;
    setLoading(true);
    const path = scope === 'server' && channel.serverId ? `/servers/${channel.serverId}/search` : `/channels/${channel.id}/search`;
    get<{ total: number; messages: Message[] }>(`${path}?q=${encodeURIComponent(query)}`)
      .then(setRes)
      .catch((e) => toast(e.message, 'error'))
      .finally(() => setLoading(false));
  }, [query, scope, channel.id, channel.serverId]);

  return (
    <PanelShell title={res ? tn(res.total, '{n} résultat', '{n} résultats') : t('Rechercher')} icon={<Search size={18} />} onClose={() => setState((s) => void (s.rightPanel = null))}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setState((s) => void (s.searchQuery = q.trim()));
        }}
      >
        <input autoFocus className="input !py-2 text-sm" placeholder={t('Rechercher des messages…')} value={q} onChange={(e) => setQ(e.target.value)} />
      </form>
      {channel.serverId && (
        <div className="flex gap-1 text-xs">
          {(['server', 'channel'] as const).map((k) => (
            <button key={k} className={`px-2 py-1 rounded-md font-semibold ${scope === k ? 'bg-accent text-accent-fg' : 'bg-bg-3 text-fg-2'}`} onClick={() => setScope(k)}>
              {k === 'server' ? serverName : `#${title}`}
            </button>
          ))}
        </div>
      )}
      {loading && <Spinner className="mx-auto block mt-6" />}
      {!loading && res?.messages.length === 0 && <div className="text-center text-fg-3 text-sm py-10">{t('Aucun résultat. Essaie d’autres mots-clés.')}</div>}
      {!loading &&
        res?.messages.map((m) => (
          <div key={m.id}>
            {scope === 'server' && <div className="text-xs text-fg-3 mb-1 px-1">#{findChannel(S(), m.channelId)?.name}</div>}
            <MiniMessage
              m={m}
              onJump={() => {
                const ch = findChannel(S(), m.channelId);
                if (ch && ch.id !== channel.id) window.dispatchEvent(new CustomEvent('endbuy:navigate', { detail: `/channels/${ch.serverId}/${ch.id}` }));
                else jumpTo(m);
              }}
            />
          </div>
        ))}
    </PanelShell>
  );
}
