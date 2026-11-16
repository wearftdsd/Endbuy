import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { WifiOff } from 'lucide-react';
import { t } from '../lib/i18n';
import { requestNotificationPermission } from '../lib/session';
import { findChannel, firstTextChannel, setState, useStore } from '../lib/store';
import { CH } from '../lib/types';
import { ChannelSidebar } from './ChannelSidebar';
import { ChatView } from './ChatView';
import { DMSidebar } from './DMSidebar';
import { FriendsView } from './FriendsView';
import { Overlays } from './Overlays';
import { ServerRail } from './ServerRail';
import { LogoMark, Spinner } from './ui';
import { UserPanel, VoicePanel } from './UserPanel';
import { StageView } from './StageView';
import { VoiceChannelView } from './VoiceView';

const LAST_KEY = 'endbuy.lastChannels';
function lastChannels(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY) || '{}');
  } catch {
    return {};
  }
}

export function useRoute() {
  const { pathname } = useLocation();
  const parts = pathname.split('/').filter(Boolean);
  const serverId = parts[1] && parts[1] !== '@me' ? parts[1] : null;
  const channelId = parts[2] ?? null;
  return { serverId, channelId };
}

export function AppShell() {
  const ready = useStore((s) => s.ready);
  const connection = useStore((s) => s.connection);
  const mobileNav = useStore((s) => s.mobileNav);
  const { serverId, channelId } = useRoute();
  const navigate = useNavigate();
  const server = useStore((s) => (serverId ? s.servers[serverId] : undefined));
  const channel = useStore((s) => findChannel(s, channelId));

  useEffect(() => {
    const once = () => {
      requestNotificationPermission();
      window.removeEventListener('pointerdown', once);
    };
    window.addEventListener('pointerdown', once);
    return () => window.removeEventListener('pointerdown', once);
  }, []);

  // Redirections : serveur sans salon, salon introuvable…
  useEffect(() => {
    if (!ready) return;
    if (serverId) {
      if (!server) {
        navigate('/channels/@me', { replace: true });
        return;
      }
      if (!channelId || !server.channels.some((c) => c.id === channelId && c.type !== CH.CATEGORY)) {
        const last = lastChannels()[serverId];
        const target = server.channels.find((c) => c.id === last && c.type !== CH.CATEGORY) ?? firstTextChannel(server) ?? server.channels.find((c) => c.type !== CH.CATEGORY);
        if (target) navigate(`/channels/${serverId}/${target.id}`, { replace: true });
      }
    } else if (channelId && !channel) {
      navigate('/channels/@me', { replace: true });
    }
  }, [ready, serverId, channelId, server, channel, navigate]);

  useEffect(() => {
    if (serverId && channelId) {
      try {
        localStorage.setItem(LAST_KEY, JSON.stringify({ ...lastChannels(), [serverId]: channelId }));
      } catch {
        /* ignoré */
      }
    }
    setState((s) => void (s.mobileNav = false));
  }, [serverId, channelId]);

  if (!ready) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 anim-fade">
        <div className="animate-pulse">
          <LogoMark size={64} />
        </div>
        <div className="flex items-center gap-2 text-fg-3 text-sm">
          <Spinner /> {connection === 'reconnecting' ? t('Reconnexion…') : t('Connexion à endBuy…')}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex relative overflow-hidden">
      {mobileNav && <div className="fixed inset-0 bg-black/60 z-30 md:hidden anim-fade" onClick={() => setState((s) => void (s.mobileNav = false))} />}
      <nav className={`${mobileNav ? 'flex fixed inset-y-0 left-0 z-40 anim-drawer' : 'hidden'} md:flex md:static h-full shrink-0`}>
        <ServerRail activeServerId={serverId} />
        <div className="w-60 bg-bg-1 flex flex-col min-h-0" data-spotlight>
          {serverId ? <ChannelSidebar serverId={serverId} channelId={channelId} /> : <DMSidebar channelId={channelId} />}
          <VoicePanel />
          <UserPanel />
        </div>
      </nav>
      <main className="flex-1 min-w-0 flex flex-col bg-bg-2 relative">
        {connection === 'reconnecting' && (
          <div className="bg-warn text-black text-sm font-semibold flex items-center justify-center gap-2 py-1 anim-fade">
            <WifiOff size={14} /> {t('Connexion perdue — reconnexion en cours…')}
          </div>
        )}
        {serverId ? (
          channel && channel.type === CH.STAGE ? (
            <StageView channel={channel} />
          ) : channel && channel.type === CH.VOICE ? (
            <VoiceChannelView channel={channel} />
          ) : channel ? (
            <ChatView key={channel.id} channel={channel} />
          ) : (
            <div className="flex-1" />
          )
        ) : channel ? (
          <ChatView key={channel.id} channel={channel} />
        ) : (
          <FriendsView />
        )}
      </main>
      <Overlays />
    </div>
  );
}
