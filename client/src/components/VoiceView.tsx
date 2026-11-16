import { useEffect, useRef, useState } from 'react';
import { Headphones, HeadphoneOff, Maximize2, Menu, Mic, MicOff, Minimize2, MonitorUp, MonitorX, PhoneCall, PhoneOff, Video, VideoOff, Volume2 } from 'lucide-react';
import { desktop, type ScreenSource } from '../lib/desktop';
import { t, tn } from '../lib/i18n';
import { has, P } from '../lib/perms';
import { voice } from '../lib/rtc';
import { closeModal, displayName, setState, useStore, voiceMembers } from '../lib/store';
import type { Channel } from '../lib/types';
import { voiceUserMenu } from './ChannelSidebar';
import { Avatar, Modal, ModalFooter, ModalHeader, Spinner, Switch } from './ui';

function VideoStream({ stream, mirror, contain }: { stream: MediaStream | null; mirror?: boolean; contain?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) {
      ref.current.srcObject = stream;
      ref.current.play().catch(() => {});
    }
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted className={`w-full h-full ${contain ? 'object-contain' : 'object-cover'} ${mirror ? '-scale-x-100' : ''}`} />;
}

type TileKind = 'camera' | 'screen';

function Tile({ userId, kind, serverId, focused, onFocus }: { userId: string; kind: TileKind; serverId: string | null; focused: boolean; onFocus: () => void }) {
  useStore((s) => s.rtcVersion);
  const vs = useStore((s) => s.voiceStates[userId]);
  const me = useStore((s) => s.me!.id);
  const speaking = useStore((s) => !!s.speaking[userId]);
  const name = useStore((s) => displayName(s, userId, serverId));
  const user = useStore((s) => s.users[userId]);
  const stream = voice.getStream(userId, kind);
  const showVideo = kind === 'screen' ? !!vs?.screen : !!vs?.video;
  const state = voice.connectionState(userId);
  const accent = user?.accentColor ?? user?.bannerColor ?? null;
  return (
    <div
      data-tilt={focused ? undefined : '5'}
      className={`relative rounded-xl overflow-hidden bg-bg-0 cursor-pointer group transition-shadow ${speaking && kind === 'camera' ? 'ring-[3px] ring-success' : 'ring-1 ring-line'} ${focused ? 'w-full h-full' : 'aspect-video'}`}
      style={!showVideo && accent ? { background: `linear-gradient(135deg, ${accent}55, var(--bg-0))` } : undefined}
      onClick={onFocus}
      onContextMenu={(e) => voiceUserMenu(e, userId, serverId)}
    >
      {showVideo && stream ? (
        <VideoStream stream={stream} mirror={kind === 'camera' && userId === me} contain={kind === 'screen' || focused} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <Avatar userId={userId} size={focused ? 112 : 72} speaking={speaking} ring="var(--bg-0)" />
        </div>
      )}
      <div className="absolute left-2 bottom-2 flex items-center gap-1.5 bg-black/60 text-white text-sm font-semibold rounded-md px-2 py-1 max-w-[85%]">
        {(vs?.selfMute || vs?.serverMute) && <MicOff size={14} className={vs?.serverMute ? 'text-danger' : ''} />}
        {vs?.selfDeaf && <HeadphoneOff size={14} />}
        <span className="truncate">{kind === 'screen' ? t('Écran de {name}', { name }) : name}</span>
      </div>
      {kind === 'screen' && <span className="absolute top-2 left-2 text-[10px] font-bold bg-danger text-white rounded px-1.5 py-0.5">{t('EN DIRECT')}</span>}
      {state !== 'self' && state !== 'connected' && state !== 'none' && (
        <span className="absolute top-2 right-2 flex items-center gap-1 text-[11px] bg-black/60 text-white rounded px-1.5 py-0.5">
          <Spinner className="!w-3 !h-3" /> {state === 'failed' ? t('Échec de connexion') : t('Connexion…')}
        </span>
      )}
      <button className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 bg-black/60 text-white rounded-md p-1" onClick={(e) => (e.stopPropagation(), onFocus())}>
        {focused ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
      </button>
    </div>
  );
}

function Controls({ compact = false }: { compact?: boolean }) {
  const v = useStore((s) => s.voice);
  const canVideo = useStore((s) => {
    if (!s.voice.serverId) return true;
    const ch = s.servers[s.voice.serverId]?.channels.find((c) => c.id === s.voice.channelId);
    return has(ch?.permissions, P.VIDEO);
  });
  const btn = (on: boolean, danger: boolean, icon: React.ReactNode, label: string, onClick: () => void, disabled = false) => (
    <button
      className={`${compact ? 'w-11 h-11' : 'w-14 h-14'} rounded-full flex items-center justify-center transition-colors disabled:opacity-40 ${
        danger ? 'bg-danger text-white hover:brightness-110' : on ? 'bg-fg text-bg-0' : 'bg-bg-4 text-fg hover:bg-bg-3'
      }`}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
    </button>
  );
  return (
    <div className="flex items-center justify-center gap-3">
      {btn(v.video, false, v.video ? <Video size={22} /> : <VideoOff size={22} />, v.video ? t('Couper la caméra') : t('Activer la caméra'), () => voice.toggleCamera(), !canVideo)}
      {btn(v.screen, false, v.screen ? <MonitorX size={22} /> : <MonitorUp size={22} />, v.screen ? t('Arrêter le partage') : t("Partager l'écran"), () => voice.toggleScreen(), !canVideo)}
      {btn(v.mute || v.deaf, false, v.mute || v.deaf ? <MicOff size={22} /> : <Mic size={22} />, v.mute ? t('Réactiver le micro') : t('Couper le micro'), () => voice.toggleMute())}
      {btn(v.deaf, false, v.deaf ? <HeadphoneOff size={22} /> : <Headphones size={22} />, v.deaf ? t('Réactiver le son') : t('Mettre en sourdine'), () => voice.toggleDeaf())}
      {btn(false, true, <PhoneOff size={22} />, t('Se déconnecter'), () => voice.leave())}
    </div>
  );
}

function Grid({ channelId, serverId, max }: { channelId: string; serverId: string | null; max?: boolean }) {
  const ids = useStore((s) => voiceMembers(s, channelId).join(','));
  const screens = useStore((s) => voiceMembers(s, channelId).filter((id) => s.voiceStates[id]?.screen).join(','));
  const [focus, setFocus] = useState<string | null>(null);
  const members = ids ? ids.split(',') : [];
  const tiles: { key: string; userId: string; kind: TileKind }[] = [
    ...(screens ? screens.split(',') : []).map((id) => ({ key: `${id}:screen`, userId: id, kind: 'screen' as const })),
    ...members.map((id) => ({ key: `${id}:camera`, userId: id, kind: 'camera' as const })),
  ];
  const focused = tiles.find((x) => x.key === focus);
  if (focused) {
    return (
      <div className={`flex flex-col gap-3 ${max ? 'flex-1 min-h-0' : 'h-[360px]'}`}>
        <div className="flex-1 min-h-0">
          <Tile userId={focused.userId} kind={focused.kind} serverId={serverId} focused onFocus={() => setFocus(null)} />
        </div>
        <div className="flex gap-2 overflow-x-auto scroll-thin shrink-0 h-24">
          {tiles
            .filter((x) => x.key !== focus)
            .map((x) => (
              <div key={x.key} className="w-40 shrink-0">
                <Tile userId={x.userId} kind={x.kind} serverId={serverId} focused={false} onFocus={() => setFocus(x.key)} />
              </div>
            ))}
        </div>
      </div>
    );
  }
  const cols = tiles.length <= 1 ? 'grid-cols-1 max-w-3xl' : tiles.length <= 4 ? 'grid-cols-1 sm:grid-cols-2 max-w-5xl' : 'grid-cols-2 lg:grid-cols-3';
  return (
    <div className={`grid gap-3 w-full mx-auto content-center ${cols} ${max ? 'flex-1' : ''}`}>
      {tiles.map((x) => (
        <Tile key={x.key} userId={x.userId} kind={x.kind} serverId={serverId} focused={false} onFocus={() => setFocus(x.key)} />
      ))}
    </div>
  );
}

export function VoiceChannelView({ channel }: { channel: Channel }) {
  const inThis = useStore((s) => s.voice.channelId === channel.id);
  const connecting = useStore((s) => s.voice.connecting);
  const count = useStore((s) => voiceMembers(s, channel.id).length);
  const canConnect = has(channel.permissions, P.CONNECT);
  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg-0">
      <div className="h-12 shrink-0 px-3 flex items-center gap-2 border-b border-line">
        <button className="icon-btn md:hidden" onClick={() => setState((s) => void (s.mobileNav = true))} aria-label={t('Menu')}>
          <Menu size={20} />
        </button>
        <Volume2 size={22} className="text-fg-3" />
        <h1 className="font-bold truncate">{channel.name}</h1>
        <span className="text-sm text-fg-3">· {tn(count, '{n} participant', '{n} participants')}</span>
      </div>
      <div className="flex-1 min-h-0 flex flex-col p-4 gap-4">
        {inThis ? (
          <>
            <Grid channelId={channel.id} serverId={channel.serverId} max />
            <div className="shrink-0 pb-2">
              <Controls />
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-5">
            {count > 0 ? (
              <div className="flex -space-x-3">
                {voiceMembers(useStore.getState(), channel.id)
                  .slice(0, 6)
                  .map((id) => (
                    <Avatar key={id} userId={id} size={56} className="ring-4 ring-bg-0 rounded-full" />
                  ))}
              </div>
            ) : (
              <div className="w-20 h-20 rounded-full bg-bg-3 flex items-center justify-center">
                <Volume2 size={36} className="text-fg-3" />
              </div>
            )}
            <div>
              <h2 className="text-2xl font-bold">{channel.name}</h2>
              <p className="text-fg-2 mt-1">{count ? t('{n} personne(s) discutent en ce moment.', { n: count }) : t('Personne n’est encore là. Lance la conversation !')}</p>
            </div>
            <button className="btn btn-primary !px-8 !py-3 text-base" disabled={!canConnect || connecting} onClick={() => voice.join(channel.id, channel.serverId)}>
              {connecting ? <Spinner /> : <PhoneCall size={18} />} {canConnect ? t('Rejoindre le vocal') : t('Accès refusé')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function DMCallPanel({ channel }: { channel: Channel }) {
  const inThis = useStore((s) => s.voice.channelId === channel.id);
  const count = useStore((s) => voiceMembers(s, channel.id).length);
  return (
    <div className="shrink-0 bg-bg-0 border-b border-line p-4 flex flex-col gap-4 anim-fade">
      {count > 0 && <Grid channelId={channel.id} serverId={null} />}
      {inThis ? (
        <Controls compact />
      ) : (
        <div className="flex items-center justify-center gap-3">
          <span className="text-fg-2 text-sm">{t('Un appel est en cours.')}</span>
          <button className="btn btn-success" onClick={() => voice.join(channel.id, null)}>
            <PhoneCall size={16} /> {t("Rejoindre l'appel")}
          </button>
        </div>
      )}
    </div>
  );
}

/** Sélecteur d'écran / fenêtre de l'application de bureau. */
export function ScreenPickerModal() {
  const [sources, setSources] = useState<ScreenSource[] | null>(null);
  const [tab, setTab] = useState<'screen' | 'window'>('screen');
  const [selected, setSelected] = useState<string | null>(null);
  const [audio, setAudio] = useState(true);
  const quality = useStore((s) => s.me?.limits.screen);
  useEffect(() => {
    desktop?.getScreenSources().then((list) => {
      setSources(list);
      setSelected(list.find((x) => x.isScreen)?.id ?? list[0]?.id ?? null);
    });
  }, []);
  const shown = (sources ?? []).filter((s) => (tab === 'screen' ? s.isScreen : !s.isScreen));
  return (
    <Modal onClose={closeModal} width={720}>
      <ModalHeader title={t("Partager l'écran")} subtitle={quality ? t('Qualité Nitro : {h}p à {fps} i/s', { h: quality.height, fps: quality.fps }) : undefined} onClose={closeModal} />
      <div className="px-6 flex gap-2 mb-3">
        {(['screen', 'window'] as const).map((k) => (
          <button key={k} className={`px-3 py-1.5 rounded-md text-sm font-semibold ${tab === k ? 'bg-bg-4' : 'text-fg-3 hover:text-fg'}`} onClick={() => setTab(k)}>
            {k === 'screen' ? t('Écrans') : t('Applications')}
          </button>
        ))}
      </div>
      <div className="px-6 pb-4 grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[50vh] overflow-y-auto scroll-thin">
        {!sources && <Spinner className="col-span-3 mx-auto my-10" />}
        {shown.map((s) => (
          <button key={s.id} className={`rounded-xl p-2 text-left border-2 ${selected === s.id ? 'border-accent bg-bg-3' : 'border-transparent hover:bg-bg-3'}`} onClick={() => setSelected(s.id)} onDoubleClick={() => (closeModal(), voice.startScreen(s.id, audio))}>
            <img src={s.thumbnail} alt="" className="w-full aspect-video object-contain bg-black rounded-md" />
            <div className="flex items-center gap-1.5 mt-1.5 text-sm truncate">
              {s.appIcon && <img src={s.appIcon} alt="" className="w-4 h-4" />}
              <span className="truncate">{s.name}</span>
            </div>
          </button>
        ))}
      </div>
      <ModalFooter>
        <label className="flex items-center gap-2 mr-auto text-sm">
          <Switch checked={audio} onChange={setAudio} /> {t('Partager le son')}
        </label>
        <button className="btn btn-ghost" onClick={closeModal}>
          {t('Annuler')}
        </button>
        <button
          className="btn btn-primary"
          disabled={!selected}
          onClick={() => {
            closeModal();
            if (selected) voice.startScreen(selected, audio);
          }}
        >
          {t('Diffuser')}
        </button>
      </ModalFooter>
    </Modal>
  );
}
