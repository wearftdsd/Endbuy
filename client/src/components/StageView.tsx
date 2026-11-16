import { CalendarPlus, Hand, LogOut, Menu, Mic, MicOff, PhoneOff, Radio, UserMinus, UserPlus, Users } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { errorMessage, patch } from '../lib/api';
import { t, tn } from '../lib/i18n';
import { has, P } from '../lib/perms';
import { voice } from '../lib/rtc';
import { displayName, openContextMenu, openModal, setState, toast, useStore, voiceMembers } from '../lib/store';
import { EV, type Channel } from '../lib/types';
import { eventDate } from './Events';
import { Avatar, Spinner } from './ui';

function setSpeaker(serverId: string, userId: string, speaker: boolean) {
  patch(`/servers/${serverId}/stage/${userId}`, { speaker }).catch((e) => toast(errorMessage(e), 'error'));
}

function Speaker({ userId, serverId, isMod }: { userId: string; serverId: string; isMod: boolean }) {
  const name = useStore((s) => displayName(s, userId, serverId));
  const speaking = useStore((s) => !!s.speaking[userId]);
  const muted = useStore((s) => !!(s.voiceStates[userId]?.selfMute || s.voiceStates[userId]?.serverMute));
  const me = useStore((s) => s.me!.id);
  return (
    <div
      className={`stage-speaker rounded-2xl p-4 flex flex-col items-center gap-2 text-center ${speaking ? 'is-speaking' : ''}`}
      data-tilt="10"
      onContextMenu={(e) =>
        (isMod || userId === me) &&
        openContextMenu(e, [{ label: t('Repasser auditeur'), icon: <UserMinus size={16} />, onClick: () => setSpeaker(serverId, userId, false) }])
      }
    >
      <div className="relative">
        <Avatar userId={userId} size={84} speaking={speaking} ring="var(--bg-1)" />
        <span className={`absolute -bottom-1 -right-1 w-7 h-7 rounded-full flex items-center justify-center ring-4 ring-[var(--bg-1)] ${muted ? 'bg-danger text-white' : 'bg-bg-4 text-fg'}`}>
          {muted ? <MicOff size={14} /> : <Mic size={14} />}
        </span>
      </div>
      <div className="font-semibold truncate max-w-full">{name}</div>
      <div className="text-[11px] uppercase tracking-wider font-bold text-accent">{t('Orateur')}</div>
    </div>
  );
}

function Listener({ userId, serverId, isMod }: { userId: string; serverId: string; isMod: boolean }) {
  const name = useStore((s) => displayName(s, userId, serverId));
  const hand = useStore((s) => !!s.voiceStates[userId]?.requestToSpeak);
  return (
    <div
      className="flex flex-col items-center gap-1.5 w-20"
      title={name}
      onContextMenu={(e) => isMod && openContextMenu(e, [{ label: t('Inviter à parler'), icon: <UserPlus size={16} />, onClick: () => setSpeaker(serverId, userId, true) }])}
    >
      <div className="relative">
        <Avatar userId={userId} size={52} ring="var(--bg-2)" />
        {hand && <span className="absolute -top-1 -right-1 text-lg anim-pop" aria-label={t('Main levée')}>✋</span>}
      </div>
      <div className="text-xs text-fg-2 truncate max-w-full">{name}</div>
    </div>
  );
}

export function StageView({ channel }: { channel: Channel }) {
  const serverId = channel.serverId!;
  const me = useStore((s) => s.me!.id);
  const memberIds = useStore(useShallow((s) => voiceMembers(s, channel.id)));
  const states = useStore((s) => s.voiceStates);
  const inThis = useStore((s) => s.voice.channelId === channel.id);
  const connecting = useStore((s) => s.voice.connecting);
  const local = useStore((s) => s.voice);
  const server = useStore((s) => s.servers[serverId]);
  const isMod = has(channel.permissions, P.MUTE_MEMBERS);
  const canRequest = has(channel.permissions, P.REQUEST_TO_SPEAK);
  const speakers = memberIds.filter((id) => states[id]?.speaker);
  const audience = memberIds.filter((id) => !states[id]?.speaker);
  const hands = audience.filter((id) => states[id]?.requestToSpeak).sort((a, b) => (states[a]?.requestToSpeak ?? 0) - (states[b]?.requestToSpeak ?? 0));
  const myState = states[me];
  const amSpeaker = inThis && !!myState?.speaker;
  const handRaised = !!myState?.requestToSpeak;
  const liveEvent = server?.events?.find((e) => e.channelId === channel.id && e.status === EV.ACTIVE);
  const nextEvent = server?.events?.find((e) => e.channelId === channel.id && e.status === EV.SCHEDULED);
  const title = channel.topic || liveEvent?.name || t('Conférence');

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg-0">
      <div className="h-12 shrink-0 px-3 flex items-center gap-2 border-b border-line">
        <button className="icon-btn md:hidden" onClick={() => setState((s) => void (s.mobileNav = true))} aria-label={t('Menu')}>
          <Menu size={20} />
        </button>
        <Radio size={20} className="text-fg-3" />
        <h1 className="font-bold truncate">{channel.name}</h1>
        <span className="text-sm text-fg-3 flex items-center gap-1">
          · <Users size={14} /> {memberIds.length}
        </span>
        <div className="flex-1" />
        {has(server?.permissions, P.MANAGE_EVENTS) && (
          <button className="btn btn-secondary !py-1 text-xs" onClick={() => openModal({ type: 'events', serverId, create: true, channelId: channel.id })}>
            <CalendarPlus size={14} /> {t('Programmer')}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin">
        <div className="stage-hero mx-4 mt-4 rounded-3xl px-6 py-8 sm:px-10 relative overflow-hidden" data-spotlight>
          <div className="stage-orb stage-orb-a" data-parallax="30" />
          <div className="stage-orb stage-orb-b" data-parallax="-24" />
          <div className="relative">
            <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-widest">
              {speakers.length ? (
                <span className="flex items-center gap-1.5 text-white bg-danger rounded-full px-2.5 py-1">
                  <span className="live-dot !bg-white" /> {t('En direct')}
                </span>
              ) : (
                <span className="text-fg-2 bg-bg-3 rounded-full px-2.5 py-1">{t('Hors antenne')}</span>
              )}
              {nextEvent && !liveEvent && <span className="text-fg-2 normal-case tracking-normal font-semibold">{t('Prochain : {name} · {date}', { name: nextEvent.name, date: eventDate(nextEvent.startsAt) })}</span>}
            </div>
            <h2 className="stage-title mt-4">{title}</h2>
            {liveEvent?.description && <p className="text-fg-2 mt-2 max-w-2xl line-clamp-3">{liveEvent.description}</p>}
            <p className="text-sm text-fg-3 mt-3">
              {tn(speakers.length, '{n} orateur', '{n} orateurs')} · {tn(audience.length, '{n} auditeur', '{n} auditeurs')}
            </p>
          </div>
        </div>

        {!inThis && (
          <div className="flex flex-col items-center text-center gap-3 py-8 px-4">
            <p className="text-fg-2 max-w-md">{t('Tu entreras en tant qu’auditeur. Lève la main pour demander la parole.')}</p>
            <button className="btn btn-primary !px-8 !py-3 text-base" data-magnetic="0.2" disabled={connecting || !has(channel.permissions, P.CONNECT)} onClick={() => voice.join(channel.id, serverId)}>
              {connecting ? <Spinner /> : <Radio size={18} />} {t('Rejoindre la conférence')}
            </button>
          </div>
        )}

        <section className="px-4 sm:px-6 py-6">
          <h3 className="text-xs font-bold uppercase tracking-wider text-fg-3 mb-3">{tn(speakers.length, 'Sur scène — {n}', 'Sur scène — {n}')}</h3>
          {speakers.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
              {speakers.map((id) => (
                <Speaker key={id} userId={id} serverId={serverId} isMod={isMod} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-fg-3">{isMod ? t('Personne sur scène. Monte sur scène ou invite quelqu’un à parler.') : t('Personne sur scène pour le moment.')}</p>
          )}
        </section>

        {isMod && hands.length > 0 && (
          <section className="px-4 sm:px-6 pb-6">
            <h3 className="text-xs font-bold uppercase tracking-wider text-fg-3 mb-3 flex items-center gap-1.5">
              <Hand size={14} /> {tn(hands.length, 'Demande de parole — {n}', 'Demandes de parole — {n}')}
            </h3>
            <div className="space-y-2">
              {hands.map((id) => (
                <div key={id} className="flex items-center gap-3 rounded-xl bg-bg-1 border border-line p-2.5 anim-up">
                  <Avatar userId={id} size={32} />
                  <span className="flex-1 font-medium truncate">{displayName(useStore.getState(), id, serverId)}</span>
                  <button className="btn btn-primary !py-1 text-xs" onClick={() => setSpeaker(serverId, id, true)}>
                    <UserPlus size={14} /> {t('Inviter à parler')}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="px-4 sm:px-6 pb-8">
          <h3 className="text-xs font-bold uppercase tracking-wider text-fg-3 mb-3">{tn(audience.length, 'Public — {n}', 'Public — {n}')}</h3>
          <div className="flex flex-wrap gap-3">
            {audience.map((id) => (
              <Listener key={id} userId={id} serverId={serverId} isMod={isMod} />
            ))}
            {!audience.length && <p className="text-sm text-fg-3">{t('Le public apparaîtra ici.')}</p>}
          </div>
        </section>
      </div>

      {inThis && (
        <div className="shrink-0 border-t border-line px-4 py-3 flex items-center justify-center gap-3 flex-wrap bg-bg-1/80 backdrop-blur">
          {amSpeaker ? (
            <>
              <button className={`btn ${local.mute ? 'btn-danger' : 'btn-secondary'}`} onClick={() => voice.toggleMute()}>
                {local.mute ? <MicOff size={18} /> : <Mic size={18} />} {local.mute ? t('Micro coupé') : t('Micro ouvert')}
              </button>
              <button className="btn btn-secondary" onClick={() => setSpeaker(serverId, '@me', false)}>
                <UserMinus size={18} /> {t('Redevenir auditeur')}
              </button>
            </>
          ) : (
            <>
              {canRequest && (
                <button className={`btn ${handRaised ? 'btn-primary' : 'btn-secondary'}`} onClick={() => voice.raiseHand(!handRaised)}>
                  <Hand size={18} /> {handRaised ? t('Baisser la main') : t('Lever la main')}
                </button>
              )}
              {isMod && (
                <button className="btn btn-secondary" onClick={() => setSpeaker(serverId, '@me', true)}>
                  <Mic size={18} /> {t('Monter sur scène')}
                </button>
              )}
            </>
          )}
          <button className="btn btn-danger" onClick={() => voice.leave()}>
            {amSpeaker ? <PhoneOff size={18} /> : <LogOut size={18} />} {t('Quitter')}
          </button>
        </div>
      )}
    </div>
  );
}
