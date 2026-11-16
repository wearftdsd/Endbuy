import { useEffect, useState } from 'react';
import { Check, Lock, Minus, Plus, Trash2, X } from 'lucide-react';
import { del, errorMessage, patch, put } from '../../lib/api';
import { t } from '../../lib/i18n';
import { has, P, PERMISSION_GROUPS } from '../../lib/perms';
import { closeModal, confirmDialog, displayName, findChannel, S, toast, useStore } from '../../lib/store';
import { CH, isVoiceLike, type Channel, type Overwrite, type Server } from '../../lib/types';
import { Avatar, Field, Switch } from '../ui';
import { SaveBar, SectionTitle, SettingsLayout } from './SettingsLayout';

function Overview({ channel }: { channel: Channel }) {
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic);
  const [limit, setLimit] = useState(channel.userLimit);
  const dirty = name !== channel.name || topic !== channel.topic || limit !== channel.userLimit;
  const save = () =>
    patch(`/channels/${channel.id}`, { name, topic, userLimit: limit })
      .then(() => toast(t('Modifications enregistrées.'), 'success'))
      .catch((e) => toast(errorMessage(e), 'error'));
  return (
    <>
      <SectionTitle>{t('Vue d’ensemble')}</SectionTitle>
      <Field label={channel.type === CH.CATEGORY ? t('Nom de la catégorie') : t('Nom du salon')}>
        <input className="input" value={name} maxLength={100} onChange={(e) => setName(channel.type === CH.TEXT ? e.target.value.toLowerCase().replace(/\s/g, '-') : e.target.value)} />
      </Field>
      {(channel.type === CH.TEXT || channel.type === CH.STAGE) && (
        <Field label={channel.type === CH.STAGE ? t('Sujet de la conférence') : t('Sujet du salon')}>
          <textarea className="input resize-none" rows={3} value={topic} maxLength={1024} placeholder={t('Indique aux membres comment utiliser ce salon !')} onChange={(e) => setTopic(e.target.value)} />
        </Field>
      )}
      {channel.type === CH.VOICE && (
        <Field label={t('Limite d’utilisateurs : {n}', { n: limit === 0 ? '∞' : limit })}>
          <input type="range" min={0} max={99} value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
        </Field>
      )}
      <SaveBar visible={dirty} onReset={() => (setName(channel.name), setTopic(channel.topic), setLimit(channel.userLimit))} onSave={save} />
    </>
  );
}

type Tri = -1 | 0 | 1;

function TriToggle({ value, onChange, disabled }: { value: Tri; onChange: (v: Tri) => void; disabled?: boolean }) {
  const btn = (v: Tri, icon: React.ReactNode, cls: string, label: string) => (
    <button disabled={disabled} title={label} className={`w-8 h-7 flex items-center justify-center ${value === v ? cls : 'text-fg-3 hover:bg-bg-4'}`} onClick={() => onChange(v)}>
      {icon}
    </button>
  );
  return (
    <div className="flex rounded-md overflow-hidden border border-line">
      {btn(-1, <X size={16} />, 'bg-danger text-white', t('Refuser'))}
      {btn(0, <Minus size={16} />, 'bg-bg-4 text-fg', t('Hériter'))}
      {btn(1, <Check size={16} />, 'bg-success text-white', t('Autoriser'))}
    </div>
  );
}

function Permissions({ channel, server }: { channel: Channel; server: Server }) {
  const everyone = server.roles.find((r) => r.isDefault)!;
  const parent = channel.parentId ? server.channels.find((c) => c.id === channel.parentId) : undefined;
  const own = channel.overwrites ?? [];
  const synced = own.length === 0 && !!parent;
  const effective: Overwrite[] = synced ? parent?.overwrites ?? [] : own;
  const [selected, setSelected] = useState<string>(everyone.id);
  const current = effective.find((o) => o.id === selected) ?? { id: selected, type: server.roles.some((r) => r.id === selected) ? ('role' as const) : ('member' as const), allow: 0, deny: 0 };
  const [draft, setDraft] = useState<Overwrite>(current);
  const [adding, setAdding] = useState(false);
  useEffect(() => setDraft(current), [selected, JSON.stringify(current)]);
  const isPrivate = !!effective.find((o) => o.id === everyone.id && o.deny & P.VIEW_CHANNEL);
  const canEdit = has(server.permissions, P.MANAGE_ROLES);

  const save = (o: Overwrite) =>
    put(`/channels/${channel.id}/permissions/${o.id}`, { type: o.type, allow: o.allow, deny: o.deny })
      .then(() => toast(t('Permissions enregistrées.'), 'success'))
      .catch((e) => toast(errorMessage(e), 'error'));

  const togglePrivate = (v: boolean) => {
    const ow = effective.find((o) => o.id === everyone.id) ?? { id: everyone.id, type: 'role' as const, allow: 0, deny: 0 };
    save({ ...ow, deny: v ? ow.deny | P.VIEW_CHANNEL : ow.deny & ~P.VIEW_CHANNEL, allow: ow.allow & ~P.VIEW_CHANNEL });
  };

  const targets = [...new Set([everyone.id, ...effective.map((o) => o.id)])];
  const label = (id: string) => server.roles.find((r) => r.id === id)?.name ?? displayName(S(), id, server.id);
  const candidates = [
    ...server.roles.filter((r) => !targets.includes(r.id)).map((r) => ({ id: r.id, label: r.name, type: 'role' as const })),
    ...server.members.filter((m) => !targets.includes(m.userId)).map((m) => ({ id: m.userId, label: displayName(S(), m.userId, server.id), type: 'member' as const })),
  ];

  return (
    <>
      <SectionTitle sub={t('Ajuste qui peut voir et utiliser ce salon. Les réglages par salon remplacent ceux des rôles.')}>{t('Permissions')}</SectionTitle>
      {synced && (
        <div className="rounded-lg bg-bg-1 border border-line p-3 text-sm mb-4">
          {t('Ce salon est synchronisé avec la catégorie « {name} ». Toute modification ici le désynchronisera.', { name: parent?.name ?? '' })}
        </div>
      )}
      <div className="rounded-xl bg-bg-1 border border-line p-4 mb-6 flex items-center gap-4">
        <Lock size={22} className="text-fg-2" />
        <div className="flex-1">
          <div className="font-semibold">{channel.type === CH.CATEGORY ? t('Catégorie privée') : t('Salon privé')}</div>
          <div className="text-sm text-fg-3">{t('Seuls les rôles et membres choisis pourront voir ce salon.')}</div>
        </div>
        <Switch checked={isPrivate} disabled={!canEdit} onChange={togglePrivate} />
      </div>
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="lg:w-52 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase text-fg-3">{t('Rôles / membres')}</span>
            {canEdit && (
              <button className="icon-btn !w-6 !h-6" onClick={() => setAdding(!adding)} title={t('Ajouter')}>
                <Plus size={16} />
              </button>
            )}
          </div>
          {adding && (
            <select
              className="input !py-1.5 text-sm mb-2"
              defaultValue=""
              onChange={(e) => {
                const c = candidates.find((x) => x.id === e.target.value);
                if (!c) return;
                setAdding(false);
                setSelected(c.id);
                setDraft({ id: c.id, type: c.type, allow: 0, deny: 0 });
              }}
            >
              <option value="" disabled>
                {t('Choisir…')}
              </option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.type === 'member' ? '@' : ''}
                  {c.label}
                </option>
              ))}
            </select>
          )}
          {[...targets, ...(targets.includes(selected) ? [] : [selected])].map((id) => {
            const isMember = !server.roles.some((r) => r.id === id);
            return (
              <button key={id} className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left ${selected === id ? 'bg-bg-4' : 'hover:bg-bg-3'}`} onClick={() => setSelected(id)}>
                {isMember ? <Avatar userId={id} size={18} /> : <span className="w-3 h-3 rounded-full" style={{ background: server.roles.find((r) => r.id === id)?.color ?? 'var(--fg-3)' }} />}
                <span className="truncate flex-1">{label(id)}</span>
              </button>
            );
          })}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold truncate">{label(selected)}</h3>
            {selected !== everyone.id && effective.some((o) => o.id === selected) && canEdit && (
              <button className="icon-btn hover:!text-danger" onClick={() => del(`/channels/${channel.id}/permissions/${selected}`).then(() => setSelected(everyone.id))} title={t('Retirer')}>
                <Trash2 size={16} />
              </button>
            )}
          </div>
          {PERMISSION_GROUPS.map((g) => {
            const items = g.items.filter((it) => it.channel && (!isVoiceLike(channel.type) || ![P.SEND_MESSAGES, P.EMBED_LINKS, P.ATTACH_FILES, P.ADD_REACTIONS, P.MENTION_EVERYONE, P.READ_HISTORY].includes(it.bit as never)) && (channel.type !== CH.TEXT || ![P.CONNECT, P.SPEAK, P.VIDEO, P.MUTE_MEMBERS, P.REQUEST_TO_SPEAK].includes(it.bit as never)) && (channel.type === CH.STAGE || it.bit !== P.REQUEST_TO_SPEAK));
            if (!items.length) return null;
            return (
              <div key={g.title} className="mb-5">
                <div className="text-xs font-bold uppercase text-fg-3 mb-1">{t(g.title)}</div>
                {items.map((it) => {
                  const v: Tri = draft.allow & it.bit ? 1 : draft.deny & it.bit ? -1 : 0;
                  return (
                    <div key={it.bit} className="flex items-center justify-between gap-4 py-2.5 border-b border-line">
                      <div className="min-w-0">
                        <div className="font-medium text-sm">{t(it.name)}</div>
                        <div className="text-xs text-fg-3">{t(it.desc)}</div>
                      </div>
                      <TriToggle
                        value={v}
                        disabled={!canEdit}
                        onChange={(nv) =>
                          setDraft({
                            ...draft,
                            allow: nv === 1 ? draft.allow | it.bit : draft.allow & ~it.bit,
                            deny: nv === -1 ? draft.deny | it.bit : draft.deny & ~it.bit,
                          })
                        }
                      />
                    </div>
                  );
                })}
              </div>
            );
          })}
          <SaveBar visible={canEdit && (draft.allow !== current.allow || draft.deny !== current.deny)} onReset={() => setDraft(current)} onSave={() => save(draft)} />
        </div>
      </div>
    </>
  );
}

export function ChannelSettings({ channelId, tab }: { channelId: string; tab?: string }) {
  const channel = useStore((s) => findChannel(s, channelId));
  const server = useStore((s) => (channel?.serverId ? s.servers[channel.serverId] : undefined));
  const [active, setActive] = useState(tab ?? 'overview');
  useEffect(() => {
    if (!channel) closeModal();
  }, [channel]);
  if (!channel || !server) return null;
  const sections = [
    {
      title: channel.type === CH.TEXT ? `# ${channel.name}` : channel.name,
      items: [
        { key: 'overview', label: t('Vue d’ensemble') },
        { key: 'permissions', label: t('Permissions'), hidden: !has(server.permissions, P.MANAGE_ROLES) },
      ],
    },
    {
      items: [
        {
          key: 'delete',
          label: channel.type === CH.CATEGORY ? t('Supprimer la catégorie') : t('Supprimer le salon'),
          danger: true,
          onClick: () =>
            confirmDialog({
              title: t('Supprimer « {name} »', { name: channel.name }),
              body: t('Supprimer définitivement « {name} » ? Cette action est irréversible.', { name: channel.name }),
              confirmLabel: t('Supprimer'),
              danger: true,
              onConfirm: async () => {
                await del(`/channels/${channel.id}`);
              },
            }),
        },
      ],
    },
  ];
  return (
    <SettingsLayout sections={sections} active={active} onSelect={setActive} onClose={closeModal}>
      {active === 'overview' && <Overview key={channel.id} channel={channel} />}
      {active === 'permissions' && <Permissions channel={channel} server={server} />}
    </SettingsLayout>
  );
}
