import { useMemo, useState } from 'react';
import { BellRing, Bell, CalendarDays, CalendarPlus, ChevronLeft, Clock, Copy, MapPin, Play, Radio, Square, Trash2, Volume2 } from 'lucide-react';
import { del, errorMessage, patch, post, put } from '../lib/api';
import { dateLocale, t, tn } from '../lib/i18n';
import { has, P } from '../lib/perms';
import { voice } from '../lib/rtc';
import { closeModal, confirmDialog, displayName, openModal, S, toast, useStore } from '../lib/store';
import { CH, EV, isVoiceLike, type Server, type ServerEvent } from '../lib/types';
import { Avatar, ErrorBox, Field, Modal, ModalHeader, Spinner } from './ui';

const NO_EVENTS: ServerEvent[] = [];

function go(path: string) {
  window.dispatchEvent(new CustomEvent('endbuy:navigate', { detail: path }));
}

/** « sam. 22 nov. · 21:00 » */
export function eventDate(iso: string) {
  const d = new Date(iso);
  const day = d.toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
  return `${day} · ${time}`;
}

/** « Dans 2 h », « Dans 15 min », « Commence maintenant » */
export function eventCountdown(ev: ServerEvent) {
  if (ev.status === EV.ACTIVE) return t('En cours');
  if (ev.status === EV.COMPLETED) return t('Terminé');
  const diff = new Date(ev.startsAt).getTime() - Date.now();
  if (diff <= 60_000) return t('Commence maintenant');
  const min = Math.round(diff / 60_000);
  if (min < 60) return t('Dans {n} min', { n: min });
  const h = Math.round(min / 60);
  if (h < 48) return t('Dans {n} h', { n: h });
  return t('Dans {n} jours', { n: Math.round(h / 24) });
}

function joinEvent(server: Server, ev: ServerEvent) {
  if (!ev.channelId) return;
  voice.join(ev.channelId, server.id);
  closeModal();
  go(`/channels/${server.id}/${ev.channelId}`);
}

/* ------------------------------------------------------------------ */
/* Barre latérale : accès aux événements + bannière « en direct »      */
/* ------------------------------------------------------------------ */
export function EventsEntry({ serverId }: { serverId: string }) {
  const events = useStore((s) => s.servers[serverId]?.events ?? NO_EVENTS);
  const server = useStore((s) => s.servers[serverId]);
  const active = events.filter((e) => e.status === EV.ACTIVE);
  const upcoming = events.filter((e) => e.status === EV.SCHEDULED).length;
  if (!server) return null;
  return (
    <div className="px-2 pt-2 space-y-1.5">
      <button
        className="w-full h-9 px-2 flex items-center gap-2 rounded-md text-fg-2 hover:bg-bg-3 hover:text-fg transition-colors text-[15px] font-medium"
        onClick={() => openModal({ type: 'events', serverId })}
      >
        <CalendarDays size={18} />
        <span className="flex-1 text-left">{upcoming + active.length ? tn(upcoming + active.length, '{n} événement', '{n} événements') : t('Événements')}</span>
        {upcoming > 0 && <span className="min-w-5 h-5 px-1.5 rounded-full bg-accent text-accent-fg text-[11px] font-bold flex items-center justify-center">{upcoming}</span>}
      </button>
      {active.map((ev) => {
        const ch = server.channels.find((c) => c.id === ev.channelId);
        return (
          <div key={ev.id} className="event-live rounded-xl p-3 text-white anim-up" data-tilt="6">
            <div className="flex items-center gap-1.5 text-[10px] font-extrabold tracking-wider uppercase">
              <span className="live-dot" /> {t('En direct')}
            </div>
            <div className="font-bold leading-tight mt-1 line-clamp-2">{ev.name}</div>
            <div className="text-xs opacity-85 mt-0.5 flex items-center gap-1 truncate">
              {ch ? (ch.type === CH.STAGE ? <Radio size={12} /> : <Volume2 size={12} />) : <MapPin size={12} />} {ch?.name ?? ev.location}
            </div>
            {ch && (
              <button className="mt-2 w-full rounded-lg bg-white/95 text-black text-sm font-bold py-1.5 hover:bg-white" onClick={() => joinEvent(server, ev)}>
                {t('Rejoindre')}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Carte d'événement                                                   */
/* ------------------------------------------------------------------ */
function EventCard({ server, ev }: { server: Server; ev: ServerEvent }) {
  const me = useStore((s) => s.me!.id);
  const interested = ev.interestedIds.includes(me);
  const canManage = ev.creatorId === me || has(server.permissions, P.MANAGE_EVENTS);
  const ch = server.channels.find((c) => c.id === ev.channelId);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const live = ev.status === EV.ACTIVE;
  return (
    <div className={`event-card rounded-2xl border p-4 ${live ? 'border-transparent event-card-live' : 'border-line bg-bg-1'}`} data-tilt="4" data-spotlight>
      <div className="flex items-center gap-2 text-xs font-semibold">
        {live ? (
          <span className="flex items-center gap-1.5 text-success uppercase tracking-wider">
            <span className="live-dot" /> {t('En direct')}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-fg-2">
            <Clock size={13} /> {eventDate(ev.startsAt)}
          </span>
        )}
        <span className="ml-auto rounded-full bg-bg-3 px-2 py-0.5 text-[11px] text-fg-2">{eventCountdown(ev)}</span>
      </div>
      <h3 className="text-lg font-bold mt-2 leading-snug">{ev.name}</h3>
      {ev.description && <p className="text-sm text-fg-2 mt-1 whitespace-pre-wrap break-words line-clamp-4">{ev.description}</p>}
      <div className="flex items-center gap-1.5 text-sm text-fg-2 mt-3">
        {ch ? (ch.type === CH.STAGE ? <Radio size={15} /> : <Volume2 size={15} />) : <MapPin size={15} />}
        <span className="truncate">{ch ? ch.name : ev.location}</span>
        {ev.endsAt && <span className="text-fg-3 ml-1 shrink-0">· {t('jusqu’à {time}', { time: new Date(ev.endsAt).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' }) })}</span>}
      </div>
      <div className="flex items-center gap-2 mt-4 flex-wrap">
        <div className="flex -space-x-2 mr-1">
          {ev.interestedIds.slice(0, 4).map((id) => (
            <Avatar key={id} userId={id} size={24} className="ring-2 ring-bg-1 rounded-full" />
          ))}
        </div>
        <span className="text-xs text-fg-3 mr-auto">{tn(ev.interestedIds.length, '{n} intéressé', '{n} intéressés')}</span>
        {canManage && ev.status === EV.SCHEDULED && (
          <button className="btn btn-secondary !py-1.5 text-xs" disabled={busy} onClick={() => run(() => patch(`/servers/${server.id}/events/${ev.id}`, { status: EV.ACTIVE }))}>
            <Play size={14} /> {t('Lancer')}
          </button>
        )}
        {canManage && live && (
          <button className="btn btn-secondary !py-1.5 text-xs" disabled={busy} onClick={() => run(() => patch(`/servers/${server.id}/events/${ev.id}`, { status: EV.COMPLETED }))}>
            <Square size={14} /> {t('Terminer')}
          </button>
        )}
        {live && ch && (
          <button className="btn btn-primary !py-1.5 text-xs" data-magnetic="0.2" onClick={() => joinEvent(server, ev)}>
            {t('Rejoindre')}
          </button>
        )}
        {ev.status !== EV.COMPLETED && (
          <button
            className={`btn !py-1.5 text-xs ${interested ? 'btn-primary' : 'btn-secondary'}`}
            disabled={busy}
            onClick={() => run(() => (interested ? del : put)(`/servers/${server.id}/events/${ev.id}/users/@me`))}
          >
            {interested ? <BellRing size={14} /> : <Bell size={14} />} {interested ? t('Intéressé') : t('Ça m’intéresse')}
          </button>
        )}
        <button
          className="icon-btn !w-8 !h-8"
          title={t('Copier le résumé')}
          onClick={() => {
            const text = `${ev.name} — ${eventDate(ev.startsAt)} — ${ch ? '#' + ch.name : ev.location} (${server.name})`;
            navigator.clipboard?.writeText(text).then(() => toast(t('Résumé copié.'), 'success'));
          }}
        >
          <Copy size={15} />
        </button>
        {canManage && (
          <button
            className="icon-btn !w-8 !h-8 hover:!text-danger"
            title={ev.status === EV.SCHEDULED ? t("Annuler l'événement") : t('Supprimer')}
            onClick={() =>
              confirmDialog({
                title: ev.status === EV.SCHEDULED ? t("Annuler l'événement") : t("Supprimer l'événement"),
                body: t('« {name} » disparaîtra pour tout le monde.', { name: ev.name }),
                confirmLabel: ev.status === EV.SCHEDULED ? t("Annuler l'événement") : t('Supprimer'),
                danger: true,
                onConfirm: async () => {
                  if (ev.status === EV.SCHEDULED) await patch(`/servers/${server.id}/events/${ev.id}`, { status: EV.CANCELED });
                  else await del(`/servers/${server.id}/events/${ev.id}`);
                },
              })
            }
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
      {ev.creatorId && <div className="text-[11px] text-fg-3 mt-3">{t('Organisé par {name}', { name: displayName(S(), ev.creatorId, server.id) })}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Création                                                            */
/* ------------------------------------------------------------------ */
function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function CreateEvent({ server, onDone, presetChannelId }: { server: Server; onDone: () => void; presetChannelId?: string | null }) {
  const voiceChannels = server.channels.filter((c) => isVoiceLike(c.type));
  const preset = voiceChannels.find((c) => c.id === presetChannelId);
  const [kind, setKind] = useState<'stage' | 'voice' | 'external'>(preset ? (preset.type === CH.STAGE ? 'stage' : 'voice') : voiceChannels.some((c) => c.type === CH.STAGE) ? 'stage' : 'voice');
  const options = voiceChannels.filter((c) => (kind === 'stage' ? c.type === CH.STAGE : c.type === CH.VOICE));
  const [channelId, setChannelId] = useState(preset?.id ?? options[0]?.id ?? '');
  const [location, setLocation] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const defaultStart = useMemo(() => {
    const d = new Date(Date.now() + 60 * 60_000);
    d.setMinutes(0, 0, 0);
    return d;
  }, []);
  const [start, setStart] = useState(toLocalInput(defaultStart));
  const [end, setEnd] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchKind = (k: typeof kind) => {
    setKind(k);
    const first = voiceChannels.find((c) => (k === 'stage' ? c.type === CH.STAGE : c.type === CH.VOICE));
    setChannelId(first?.id ?? '');
    if (k === 'external' && !end) setEnd(toLocalInput(new Date(new Date(start).getTime() + 2 * 3600_000)));
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await post(`/servers/${server.id}/events`, {
        name,
        description,
        startsAt: new Date(start).toISOString(),
        endsAt: end ? new Date(end).toISOString() : null,
        channelId: kind === 'external' ? null : channelId,
        location: kind === 'external' ? location : undefined,
      });
      toast(t('Événement créé ! Les membres peuvent maintenant s’y inscrire.'), 'success');
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const kinds = [
    { k: 'stage' as const, icon: <Radio size={20} />, label: t('Conférence'), desc: t('Des orateurs sur scène, le public écoute et lève la main.') },
    { k: 'voice' as const, icon: <Volume2 size={20} />, label: t('Salon vocal'), desc: t('Tout le monde peut parler, partager son écran et sa caméra.') },
    { k: 'external' as const, icon: <MapPin size={20} />, label: t('Ailleurs'), desc: t('Un autre lieu : site, jeu, adresse…') },
  ];
  const valid = name.trim() && start && (kind === 'external' ? location.trim() && end : channelId);

  return (
    <div className="px-6 pb-6 overflow-y-auto scroll-thin">
      <ErrorBox message={error} />
      <span className="label">{t('Où se passe ton événement ?')}</span>
      <div className="grid sm:grid-cols-3 gap-2 mb-5">
        {kinds.map((k) => (
          <button key={k.k} className={`text-left rounded-xl p-3 border-2 transition-colors ${kind === k.k ? 'border-accent bg-accent/10' : 'border-line bg-bg-1 hover:bg-bg-3'}`} onClick={() => switchKind(k.k)}>
            <span className="text-fg-2">{k.icon}</span>
            <span className="block font-semibold mt-1">{k.label}</span>
            <span className="block text-xs text-fg-3 mt-0.5">{k.desc}</span>
          </button>
        ))}
      </div>
      {kind === 'external' ? (
        <Field label={t('Lieu')}>
          <input id="ev-location" className="input" value={location} maxLength={100} placeholder={t('Ex. : Parc des expositions, serveur Minecraft…')} onChange={(e) => setLocation(e.target.value)} />
        </Field>
      ) : options.length ? (
        <Field label={kind === 'stage' ? t('Salon de conférence') : t('Salon vocal')}>
          <select id="ev-channel" className="input" value={channelId} onChange={(e) => setChannelId(e.target.value)}>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <div className="rounded-lg bg-warn/10 border border-warn/40 text-warn text-sm p-3 mb-4">
          {kind === 'stage' ? t('Aucun salon de conférence : crée-en un depuis le menu du serveur → Créer un salon.') : t('Aucun salon vocal visible.')}
        </div>
      )}
      <Field label={t("Nom de l'événement")}>
        <input id="ev-name" className="input" autoFocus value={name} maxLength={100} placeholder={t('Ex. : Soirée jeux du vendredi')} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid sm:grid-cols-2 gap-x-3">
        <Field label={t('Début')}>
          <input id="ev-start" type="datetime-local" className="input" value={start} min={toLocalInput(new Date())} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label={kind === 'external' ? t('Fin') : t('Fin (facultatif)')}>
          <input id="ev-end" type="datetime-local" className="input" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
      <Field label={t('Description')} hint={t('{n}/1000', { n: description.length })}>
        <textarea id="ev-desc" className="input resize-none" rows={4} maxLength={1000} value={description} placeholder={t('Programme, règles, liens utiles…')} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <button className="btn btn-ghost" onClick={onDone}>
          {t('Annuler')}
        </button>
        <button className="btn btn-primary" data-magnetic="0.15" disabled={!valid || busy} onClick={submit}>
          {busy ? <Spinner /> : <CalendarPlus size={16} />} {t("Créer l'événement")}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fenêtre « Événements »                                              */
/* ------------------------------------------------------------------ */
export function EventsModal({ serverId, create, channelId }: { serverId: string; create?: boolean; channelId?: string | null }) {
  const server = useStore((s) => s.servers[serverId]);
  const events = useStore((s) => s.servers[serverId]?.events ?? NO_EVENTS);
  const [creating, setCreating] = useState(!!create);
  if (!server) return null;
  const canCreate = has(server.permissions, P.MANAGE_EVENTS);
  const list = [...events].sort((a, b) => (a.status === EV.ACTIVE ? -1 : 0) - (b.status === EV.ACTIVE ? -1 : 0) || a.startsAt.localeCompare(b.startsAt));
  return (
    <Modal onClose={closeModal} width={620}>
      <ModalHeader
        title={
          creating ? (
            <span className="flex items-center gap-2">
              <button className="icon-btn !w-7 !h-7" onClick={() => setCreating(false)} aria-label={t('Retour')}>
                <ChevronLeft size={18} />
              </button>
              {t('Nouvel événement')}
            </span>
          ) : (
            t('Événements de {name}', { name: server.name })
          )
        }
        subtitle={creating ? t('Soirées, tournois, conférences : préviens tout le serveur.') : undefined}
        onClose={closeModal}
      />
      {creating ? (
        <CreateEvent server={server} presetChannelId={channelId} onDone={() => setCreating(false)} />
      ) : (
        <div className="px-6 pb-6 pt-2 overflow-y-auto scroll-thin space-y-3">
          {canCreate && (
            <button className="btn btn-primary w-full !py-2.5" data-magnetic="0.1" onClick={() => setCreating(true)}>
              <CalendarPlus size={18} /> {t('Créer un événement')}
            </button>
          )}
          {list.map((ev) => (
            <EventCard key={ev.id} server={server} ev={ev} />
          ))}
          {!list.length && (
            <div className="text-center py-10 px-6">
              <div className="w-16 h-16 mx-auto rounded-2xl brand-gradient flex items-center justify-center text-white mb-4" data-parallax="14">
                <CalendarDays size={30} />
              </div>
              <div className="font-bold text-lg">{t('Aucun événement à venir')}</div>
              <p className="text-sm text-fg-3 mt-1">
                {canCreate ? t('Programme une soirée, un tournoi ou une conférence : les membres seront prévenus au moment du lancement.') : t('Les modérateurs du serveur peuvent programmer des événements.')}
              </p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
