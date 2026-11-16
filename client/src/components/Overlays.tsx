import { useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Check, CheckCircle2, ChevronRight, Info, Phone, PhoneOff } from 'lucide-react';
import { gateway } from '../lib/gateway';
import { t } from '../lib/i18n';
import { voice } from '../lib/rtc';
import { stopRinging } from '../lib/sounds';
import { channelTitle, findChannel, setState, useStore, type MenuItem } from '../lib/store';
import { ChannelSettings } from './settings/ChannelSettings';
import { ServerSettings } from './settings/ServerSettings';
import { UserSettings } from './settings/UserSettings';
import { ConfirmModal, CreateChannelModal, CreateGroupModal, CreateServerModal, ImageModal, InviteModal, RecoveryCodesModal } from './Modals';
import { EventsModal } from './Events';
import { ProfileModal, ProfilePopout } from './Profile';
import { Avatar, useClickOutside } from './ui';
import { ScreenPickerModal } from './VoiceView';

function ModalRoot() {
  const modal = useStore((s) => s.modal);
  if (!modal) return null;
  switch (modal.type) {
    case 'createServer':
      return <CreateServerModal />;
    case 'createChannel':
      return <CreateChannelModal serverId={modal.serverId} parentId={modal.parentId} channelType={modal.channelType} />;
    case 'invite':
      return <InviteModal serverId={modal.serverId} />;
    case 'events':
      return <EventsModal serverId={modal.serverId} create={modal.create} channelId={modal.channelId} />;
    case 'serverSettings':
      return <ServerSettings serverId={modal.serverId} tab={modal.tab} />;
    case 'channelSettings':
      return <ChannelSettings channelId={modal.channelId} tab={modal.tab} />;
    case 'userSettings':
      return <UserSettings tab={modal.tab} />;
    case 'profile':
      return <ProfileModal userId={modal.userId} serverId={modal.serverId} />;
    case 'createGroup':
      return <CreateGroupModal channelId={modal.channelId} />;
    case 'image':
      return <ImageModal url={modal.url} filename={modal.filename} />;
    case 'screenPicker':
      return <ScreenPickerModal />;
    case 'recoveryCodes':
      return <RecoveryCodesModal codes={modal.codes} />;
    case 'confirm':
      return <ConfirmModal m={modal} />;
  }
}

function MenuList({ items, onDone }: { items: MenuItem[]; onDone: () => void }) {
  const [sub, setSub] = useState<number | null>(null);
  return (
    <div className="min-w-[200px] bg-float border border-line rounded-lg p-1.5 anim-pop" style={{ boxShadow: 'var(--shadow)' }}>
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="h-px bg-line my-1 mx-1" />
        ) : (
          <div key={i} className="relative" onMouseEnter={() => setSub(it.submenu ? i : null)}>
            <button
              disabled={it.disabled}
              className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded text-sm text-left disabled:opacity-40 ${
                it.danger ? 'text-danger hover:bg-danger hover:text-white' : 'text-fg-2 hover:bg-accent hover:text-accent-fg'
              }`}
              onClick={() => {
                if (it.submenu) return setSub(sub === i ? null : i);
                onDone();
                it.onClick?.();
              }}
            >
              <span className="flex-1 truncate">{it.label}</span>
              {it.checked && <Check size={14} />}
              {it.submenu ? <ChevronRight size={14} /> : it.icon}
            </button>
            {it.submenu && sub === i && (
              <div className="absolute left-full top-0 pl-1 z-10">
                <MenuList items={it.submenu} onDone={onDone} />
              </div>
            )}
          </div>
        ),
      )}
    </div>
  );
}

function ContextMenu() {
  const menu = useStore((s) => s.contextMenu);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const close = () => setState((s) => void (s.contextMenu = null));
  useClickOutside(ref, close, !!menu);
  useLayoutEffect(() => {
    if (!menu || !ref.current) return setPos(null);
    const r = ref.current.getBoundingClientRect();
    setPos({ x: Math.min(menu.x, window.innerWidth - r.width - 8), y: Math.min(menu.y, window.innerHeight - r.height - 8) });
  }, [menu]);
  if (!menu) return null;
  return (
    <div ref={ref} className="fixed z-[60]" style={{ left: pos?.x ?? menu.x, top: pos?.y ?? menu.y, visibility: pos ? 'visible' : 'hidden' }} onContextMenu={(e) => e.preventDefault()}>
      <MenuList items={menu.items} onDone={close} />
    </div>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] flex flex-col gap-2 items-center pointer-events-none w-[min(92vw,420px)]">
      {toasts.map((tt) => (
        <div
          key={tt.id}
          className={`pointer-events-auto w-full flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm font-medium anim-up border ${
            tt.kind === 'error' ? 'bg-danger text-white border-danger' : tt.kind === 'success' ? 'bg-float text-fg border-success/50' : 'bg-float text-fg border-line'
          }`}
          style={{ boxShadow: 'var(--shadow)' }}
          onClick={tt.onClick}
        >
          {tt.kind === 'error' ? <AlertCircle size={18} className="shrink-0" /> : tt.kind === 'success' ? <CheckCircle2 size={18} className="text-success shrink-0" /> : <Info size={18} className="text-accent shrink-0" />}
          <span>{tt.text}</span>
        </div>
      ))}
    </div>
  );
}

function IncomingCall() {
  const call = useStore((s) => s.incomingCall);
  const title = useStore((s) => channelTitle(s, findChannel(s, s.incomingCall?.channelId)));
  const navigate = useNavigate();
  if (!call) return null;
  const dismiss = () => {
    stopRinging();
    gateway.send('call_decline', { channelId: call.channelId });
    setState((s) => void (s.incomingCall = null));
  };
  return (
    <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[65] anim-pop">
      <div className="w-[300px] rounded-2xl bg-float border border-line p-6 flex flex-col items-center gap-3" style={{ boxShadow: 'var(--shadow)' }}>
        <div className="rounded-full" style={{ animation: 'pulse-ring 1.4s infinite' }}>
          <Avatar userId={call.callerId} size={80} />
        </div>
        <div className="text-center">
          <div className="font-bold text-lg">{title}</div>
          <div className="text-sm text-fg-3">{t('Appel entrant…')}</div>
        </div>
        <div className="flex gap-6 mt-2">
          <button className="w-14 h-14 rounded-full bg-danger text-white flex items-center justify-center hover:brightness-110" onClick={dismiss} title={t('Refuser')}>
            <PhoneOff size={24} />
          </button>
          <button
            className="w-14 h-14 rounded-full bg-success text-white flex items-center justify-center hover:brightness-110"
            title={t('Accepter')}
            onClick={() => {
              stopRinging();
              setState((s) => void (s.incomingCall = null));
              voice.join(call.channelId, null);
              navigate(`/channels/@me/${call.channelId}`);
            }}
          >
            <Phone size={24} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function Overlays() {
  return (
    <>
      <ModalRoot />
      <ProfilePopout />
      <ContextMenu />
      <IncomingCall />
      <Toasts />
    </>
  );
}
