import { useMemo, useRef, useState } from 'react';
import { Clock, Gem, Search } from 'lucide-react';
import { EMOJI_CATEGORIES, pushRecentEmoji, recentEmojis, searchEmojis } from '../lib/emoji';
import { t } from '../lib/i18n';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../lib/store';
import { ServerIcon, useClickOutside } from './ui';

/**
 * Sélecteur d'emojis et de stickers.
 *  - onPick reçoit un caractère Unicode, ou « <:nom:id> » pour un emoji personnalisé.
 *  - onSticker reçoit l'identifiant d'un sticker.
 * Avec endBuy Nitro, les emojis / stickers de tous tes serveurs sont utilisables partout.
 */
export function EmojiPicker({
  onPick,
  onSticker,
  onClose,
  currentServerId = null,
  noCustom = false,
  initialTab = 'emoji',
}: {
  onPick: (value: string) => void;
  onSticker?: (id: string) => void;
  onClose: () => void;
  currentServerId?: string | null;
  noCustom?: boolean;
  initialTab?: 'emoji' | 'sticker';
}) {
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'emoji' | 'sticker'>(initialTab);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, onClose);
  const servers = useStore(useShallow((s) => s.serverOrder.map((id) => s.servers[id]).filter(Boolean)));
  const everywhere = useStore((s) => !!s.me?.limits.emojisEverywhere);
  const stickersEverywhere = useStore((s) => !!s.me?.limits.stickersEverywhere);
  const [hover, setHover] = useState<string>('');
  const recent = useMemo(() => recentEmojis(), []);

  const customGroups = useMemo(
    () =>
      noCustom
        ? []
        : servers
            .map((sv) => ({
              server: sv,
              emojis: sv.emojis.filter((e) => e.kind === tab),
              locked: tab === 'emoji' ? !everywhere && sv.id !== currentServerId : !stickersEverywhere && sv.id !== currentServerId,
            }))
            .filter((g) => g.emojis.length),
    [servers, tab, everywhere, stickersEverywhere, currentServerId, noCustom],
  );

  const pick = (v: string) => {
    if (!v.startsWith('<')) pushRecentEmoji(v);
    onPick(v);
  };

  const query = q.trim().toLowerCase();
  const results = query ? searchEmojis(query, 60) : [];
  const customResults = query ? customGroups.flatMap((g) => g.emojis.filter((e) => e.name.toLowerCase().includes(query)).map((e) => ({ e, locked: g.locked }))) : [];

  return (
    <div ref={ref} className="w-[340px] h-[400px] bg-float border border-line rounded-xl flex flex-col anim-pop overflow-hidden" style={{ boxShadow: 'var(--shadow)' }} onMouseDown={(e) => e.stopPropagation()}>
      {onSticker && !noCustom && (
        <div className="flex gap-1 p-2 pb-0">
          {(['emoji', 'sticker'] as const).map((k) => (
            <button key={k} className={`px-3 py-1 rounded-md text-sm font-semibold ${tab === k ? 'bg-bg-3 text-fg' : 'text-fg-3 hover:text-fg'}`} onClick={() => setTab(k)}>
              {k === 'emoji' ? t('Emojis') : t('Stickers')}
            </button>
          ))}
        </div>
      )}
      <div className="p-2 relative">
        <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-fg-3" />
        <input autoFocus className="input !py-1.5 !pl-8 text-sm" placeholder={tab === 'emoji' ? t('Rechercher un emoji') : t('Rechercher un sticker')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin px-2 pb-2">
        {tab === 'emoji' && query && (
          <div className="grid grid-cols-8 gap-0.5">
            {customResults.map(({ e, locked }) => (
              <button key={e.id} disabled={locked} className="w-9 h-9 rounded-md hover:bg-bg-3 flex items-center justify-center disabled:opacity-40" title={`:${e.name}:`} onMouseEnter={() => setHover(`:${e.name}:`)} onClick={() => pick(`<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`)}>
                <img src={e.url} alt={e.name} className="w-7 h-7 object-contain" />
              </button>
            ))}
            {results.map((e) => (
              <button key={e.name} className="w-9 h-9 rounded-md hover:bg-bg-3 text-2xl" title={`:${e.name}:`} onMouseEnter={() => setHover(`:${e.name}:`)} onClick={() => pick(e.char)}>
                {e.char}
              </button>
            ))}
            {!results.length && !customResults.length && <div className="col-span-8 text-center text-sm text-fg-3 py-8">{t('Aucun résultat')}</div>}
          </div>
        )}
        {tab === 'emoji' && !query && (
          <>
            {recent.length > 0 && (
              <Section title={t('Récents')} icon={<Clock size={12} />}>
                {recent.map((c) => (
                  <button key={c} className="w-9 h-9 rounded-md hover:bg-bg-3 text-2xl" onClick={() => pick(c)}>
                    {c}
                  </button>
                ))}
              </Section>
            )}
            {customGroups.map((g) => (
              <Section key={g.server.id} title={g.server.name} icon={<ServerIcon name={g.server.name} icon={g.server.icon} size={14} className="rounded" />} locked={g.locked}>
                {g.emojis.map((e) => (
                  <button key={e.id} disabled={g.locked} className="w-9 h-9 rounded-md hover:bg-bg-3 flex items-center justify-center disabled:opacity-40" title={`:${e.name}:`} onMouseEnter={() => setHover(`:${e.name}:`)} onClick={() => pick(`<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`)}>
                    <img src={e.url} alt={e.name} className="w-7 h-7 object-contain" loading="lazy" />
                  </button>
                ))}
              </Section>
            ))}
            {EMOJI_CATEGORIES.map((cat) => (
              <Section key={cat.name} title={t(cat.name)}>
                {cat.emojis.map((e) => (
                  <button key={e.name} className="w-9 h-9 rounded-md hover:bg-bg-3 text-2xl leading-none" title={`:${e.name}:`} onMouseEnter={() => setHover(`:${e.name}:`)} onClick={() => pick(e.char)}>
                    {e.char}
                  </button>
                ))}
              </Section>
            ))}
          </>
        )}
        {tab === 'sticker' && (
          <>
            {customGroups.length === 0 && (
              <div className="text-center text-sm text-fg-3 py-10 px-6">{t('Aucun sticker. Les administrateurs peuvent en ajouter dans Paramètres du serveur → Emojis et stickers.')}</div>
            )}
            {customGroups.map((g) => (
              <Section key={g.server.id} title={g.server.name} locked={g.locked} cols={3}>
                {g.emojis
                  .filter((e) => !query || e.name.toLowerCase().includes(query))
                  .map((e) => (
                    <button key={e.id} disabled={g.locked} className="w-24 h-24 rounded-lg hover:bg-bg-3 p-1.5 disabled:opacity-40" title={e.name} onClick={() => onSticker?.(e.id)}>
                      <img src={e.url} alt={e.name} className="w-full h-full object-contain" loading="lazy" />
                    </button>
                  ))}
              </Section>
            ))}
          </>
        )}
      </div>
      <div className="h-9 border-t border-line px-3 flex items-center text-xs text-fg-3 gap-2">
        {everywhere ? (
          <>
            <Gem size={12} className="text-[#ff7a5c]" /> <span>{t('Nitro : emojis et stickers utilisables partout')}</span>
          </>
        ) : (
          <span>{hover}</span>
        )}
      </div>
    </div>
  );
}

function Section({ title, icon, children, locked, cols = 8 }: { title: string; icon?: React.ReactNode; children: React.ReactNode; locked?: boolean; cols?: number }) {
  return (
    <div className="mb-2">
      <div className="sticky top-0 bg-float z-10 text-[11px] font-bold uppercase tracking-wide text-fg-3 py-1.5 flex items-center gap-1.5">
        {icon} <span className="truncate">{title}</span> {locked && <Gem size={11} className="text-[#ff7a5c]" />}
      </div>
      <div className={`grid gap-0.5 ${cols === 8 ? 'grid-cols-8' : 'grid-cols-3'}`}>{children}</div>
    </div>
  );
}
