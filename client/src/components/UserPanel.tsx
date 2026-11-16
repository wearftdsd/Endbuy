import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, Headphones, HeadphoneOff, LogOut, Mic, MicOff, MonitorUp, PhoneOff, Settings, Signal, Smile, Video, VideoOff } from 'lucide-react';
import { patch } from '../lib/api';
import { t } from '../lib/i18n';
import { voice } from '../lib/rtc';
import { logout } from '../lib/session';
import { channelTitle, findChannel, openModal, presenceOf, setState, toast, useStore } from '../lib/store';
import type { Status } from '../lib/types';
import { EmojiPicker } from './EmojiPicker';
import { Avatar, NitroBadge, StatusDot, statusLabel, useClickOutside } from './ui';

export async function setStatus(status: Status) {
  setState((s) => {
    if (s.me) s.me.status = status;
  });
  await patch('/users/@me', { status }).catch((e) => toast(e.message, 'error'));
}

function StatusMenu({ onClose }: { onClose: () => void }) {
  const me = useStore((s) => s.me!);
  const [custom, setCustom] = useState(me.customStatus);
  const [emoji, setEmoji] = useState(me.customStatusEmoji ?? '');
  const [picker, setPicker] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, onClose);
  const saveCustom = async () => {
    await patch('/users/@me', { customStatus: custom, customStatusEmoji: emoji || null }).catch((e) => toast(e.message, 'error'));
    toast(t('Statut personnalisé mis à jour.'), 'success');
  };
  const statuses: { s: Status; desc?: string }[] = [
    { s: 'online' },
    { s: 'idle' },
    { s: 'dnd', desc: t('Tu ne recevras aucune notification sur ton bureau.') },
    { s: 'invisible', desc: t('Tu apparaîtras hors ligne, mais tu auras toujours accès à endBuy.') },
  ];
  return (
    <div ref={ref} className="absolute bottom-[60px] left-2 w-[280px] z-40 bg-float rounded-xl border border-line p-2 anim-pop" style={{ boxShadow: 'var(--shadow)' }}>
      <div className="flex items-center gap-3 p-2">
        <Avatar user={me} size={48} showStatus ring="var(--bg-0)" />
        <div className="min-w-0">
          <div className="font-bold flex items-center gap-1.5 truncate">
            {me.displayName} {me.premium && <NitroBadge size={12} />}
          </div>
          <div className="text-xs text-fg-3 truncate">@{me.username}</div>
        </div>
      </div>
      <div className="relative flex gap-1.5 p-1">
        <button className="icon-btn shrink-0 bg-bg-3" onClick={() => setPicker(!picker)} title={t('Choisir un emoji')}>
          {emoji || <Smile size={16} />}
        </button>
        <input className="input !py-1.5 text-sm" placeholder={t('Définir un statut personnalisé')} value={custom} maxLength={128} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveCustom()} />
        <button className="btn btn-primary !px-2.5 !py-1.5 text-xs" onClick={saveCustom}>
          OK
        </button>
        {picker && (
          <div className="absolute bottom-12 left-0 z-50">
            <EmojiPicker
              onPick={(e) => {
                setEmoji(e.startsWith('<') ? '' : e);
                setPicker(false);
              }}
              onClose={() => setPicker(false)}
              noCustom
            />
          </div>
        )}
      </div>
      <div className="h-px bg-line my-1.5" />
      {statuses.map(({ s, desc }) => (
        <button
          key={s}
          className={`w-full flex items-start gap-3 px-2 py-2 rounded-md text-left hover:bg-accent hover:text-accent-fg group ${me.status === s ? 'bg-bg-3' : ''}`}
          onClick={() => {
            setStatus(s);
            onClose();
          }}
        >
          <span className="mt-1">
            <StatusDot status={s} size={10} ring="transparent" />
          </span>
          <span>
            <span className="block text-sm font-medium">{statusLabel(s)}</span>
            {desc && <span className="block text-xs text-fg-3 group-hover:text-accent-fg/80">{desc}</span>}
          </span>
        </button>
      ))}
      <div className="h-px bg-line my-1.5" />
      <button className="w-full flex items-center gap-3 px-2 py-2 rounded-md text-sm hover:bg-bg-3" onClick={() => navigator.clipboard?.writeText(me.id).then(() => toast(t('Identifiant copié.'), 'success'))}>
        <Copy size={16} /> {t("Copier l'identifiant utilisateur")}
      </button>
      <button
        className="w-full flex items-center gap-3 px-2 py-2 rounded-md text-sm text-danger hover:bg-danger hover:text-white"
        onClick={() => {
          onClose();
          logout();
        }}
      >
        <LogOut size={16} /> {t('Se déconnecter')}
      </button>
    </div>
  );
}

export function UserPanel() {
  const me = useStore((s) => s.me!);
  const presence = useStore((s) => presenceOf(s, s.me!.id));
  const v = useStore((s) => s.voice);
  const speaking = useStore((s) => !!s.speaking[s.me!.id]);
  const [menu, setMenu] = useState(false);
  return (
    <div className="relative h-[60px] shrink-0 bg-bg-0/70 flex items-center px-2 gap-1">
      {menu && <StatusMenu onClose={() => setMenu(false)} />}
      <button className="flex items-center gap-2 min-w-0 flex-1 rounded-md hover:bg-bg-3 p-1 text-left" onClick={() => setMenu(!menu)}>
        <Avatar user={me} size={34} showStatus speaking={speaking} ring="var(--bg-0)" />
        <div className="min-w-0 leading-tight">
          <div className="text-sm font-semibold truncate">{me.displayName}</div>
          <div className="text-xs text-fg-3 truncate">{presence.customStatus ? `${presence.customStatusEmoji ?? ''} ${presence.customStatus}` : statusLabel(me.status === 'invisible' ? 'invisible' : presence.status)}</div>
        </div>
      </button>
      <button
        className={`icon-btn ${v.mute || v.deaf ? '!text-danger' : ''}`}
        onClick={() => (v.channelId ? voice.toggleMute() : setState((s) => void (s.voice.mute = !s.voice.mute)))}
        title={v.mute ? t('Réactiver le micro') : t('Couper le micro')}
      >
        {v.mute || v.deaf ? <MicOff size={18} /> : <Mic size={18} />}
      </button>
      <button
        className={`icon-btn ${v.deaf ? '!text-danger' : ''}`}
        onClick={() => (v.channelId ? voice.toggleDeaf() : setState((s) => void (s.voice.deaf = !s.voice.deaf)))}
        title={v.deaf ? t('Réactiver le son') : t('Mettre en sourdine')}
      >
        {v.deaf ? <HeadphoneOff size={18} /> : <Headphones size={18} />}
      </button>
      <button className="icon-btn" onClick={() => openModal({ type: 'userSettings' })} title={t('Paramètres utilisateur')}>
        <Settings size={18} />
      </button>
    </div>
  );
}

export function VoicePanel() {
  const v = useStore((s) => s.voice);
  const channel = useStore((s) => findChannel(s, s.voice.channelId));
  const title = useStore((s) => channelTitle(s, findChannel(s, s.voice.channelId)));
  const serverName = useStore((s) => (s.voice.serverId ? s.servers[s.voice.serverId]?.name : t('Appel privé')));
  const navigate = useNavigate();
  const audience = useStore((s) => !!(s.me && s.voiceStates[s.me.id] && !s.voiceStates[s.me.id].speaker));
  if (!v.channelId) return null;
  return (
    <div className="shrink-0 border-t border-line bg-bg-0/50 px-3 py-2 anim-up">
      <div className="flex items-center gap-2">
        <Signal size={16} className={v.connecting ? 'text-warn animate-pulse' : 'text-success'} />
        <button
          className="min-w-0 flex-1 text-left"
          onClick={() => channel && navigate(channel.serverId ? `/channels/${channel.serverId}/${channel.id}` : `/channels/@me/${channel.id}`)}
        >
          <div className={`text-sm font-bold ${v.connecting ? 'text-warn' : 'text-success'}`}>{v.connecting ? t('Connexion…') : t('Vocal connecté')}</div>
          <div className="text-xs text-fg-3 truncate hover:underline">
            {title} / {serverName}
          </div>
        </button>
        <button className="icon-btn hover:!text-danger" onClick={() => voice.leave()} title={t('Se déconnecter')}>
          <PhoneOff size={18} />
        </button>
      </div>
      {!audience && <div className="grid grid-cols-2 gap-2 mt-2">
        <button className={`btn !py-1.5 ${v.video ? 'btn-primary' : 'btn-secondary'}`} onClick={() => voice.toggleCamera()} title={t('Caméra')}>
          {v.video ? <Video size={16} /> : <VideoOff size={16} />}
        </button>
        <button className={`btn !py-1.5 ${v.screen ? 'btn-primary' : 'btn-secondary'}`} onClick={() => voice.toggleScreen()} title={t("Partager l'écran")}>
          <MonitorUp size={16} />
        </button>
      </div>}
      {v.micError && <div className="text-[11px] text-warn mt-1.5">{v.micError}</div>}
    </div>
  );
}
