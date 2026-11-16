import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { LoginPage, RecoverPage, RegisterPage } from './components/AuthPages';
import { InvitePage } from './components/InvitePage';
import { LogoMark, Spinner } from './components/ui';
import { isDesktop } from './lib/desktop';
import { getLocale, setLocale } from './lib/i18n';
import { setMotionEnabled } from './lib/motion';
import { checkSession } from './lib/session';
import { useStore } from './lib/store';

function readableOn(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#06120f' : '#ffffff';
}

/** Applique thème, couleur d'accent, taille du texte et animations. */
function useAppearance() {
  const settings = useStore((s) => s.me?.settings);
  useEffect(() => {
    const root = document.documentElement;
    const theme = settings?.theme ?? 'dark';
    root.dataset.theme = theme;
    const accent = settings?.accent ?? '#00C2A8';
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-fg', readableOn(accent));
    root.style.setProperty('--font-scale', String((settings?.fontScale ?? 100) / 100));
    root.dataset.reducedMotion = settings?.reducedMotion ? 'true' : 'false';
    const motionWanted = (settings?.motion ?? true) && !settings?.reducedMotion;
    root.dataset.motionWanted = String(motionWanted);
    setMotionEnabled(motionWanted);
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', theme === 'light' ? '#dfe2e6' : '#0b0d10');
    if (settings?.locale && settings.locale !== getLocale()) setLocale(settings.locale);
  }, [settings]);
}

function TitleBar() {
  if (!isDesktop) return null;
  return (
    <div className="app-drag h-8 shrink-0 flex items-center gap-2 px-3 bg-bg-0 text-fg-3 text-xs font-semibold select-none">
      <LogoMark size={14} />
      <span>endBuy</span>
    </div>
  );
}

function Splash() {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-5 anim-fade">
      <div className="animate-pulse">
        <LogoMark size={72} />
      </div>
      <Spinner className="text-fg-3" />
    </div>
  );
}

export default function App() {
  const me = useStore((s) => s.me);
  const authChecked = useStore((s) => s.authChecked);
  const locale = useStore((s) => s.me?.settings.locale ?? getLocale());
  const navigate = useNavigate();
  const location = useLocation();
  useAppearance();

  useEffect(() => {
    checkSession();
  }, []);

  useEffect(() => {
    const nav = (e: Event) => navigate((e as CustomEvent<string>).detail);
    const removed = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (window.location.pathname.startsWith(`/channels/${id}`)) navigate('/channels/@me');
    };
    window.addEventListener('endbuy:navigate', nav);
    window.addEventListener('endbuy:server-removed', removed);
    return () => {
      window.removeEventListener('endbuy:navigate', nav);
      window.removeEventListener('endbuy:server-removed', removed);
    };
  }, [navigate]);

  const next = new URLSearchParams(location.search).get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/channels/@me';

  return (
    <div className="h-full flex flex-col" key={locale}>
      <TitleBar />
      <div className="flex-1 min-h-0">
        {!authChecked ? (
          <Splash />
        ) : (
          <Routes>
            <Route path="/login" element={me ? <Navigate to={safeNext} replace /> : <LoginPage />} />
            <Route path="/register" element={me ? <Navigate to={safeNext} replace /> : <RegisterPage />} />
            <Route path="/recover" element={me ? <Navigate to={safeNext} replace /> : <RecoverPage />} />
            <Route path="/invite/:code" element={<InvitePage />} />
            <Route
              path="/channels/*"
              element={me ? <AppShell /> : <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />}
            />
            <Route path="*" element={<Navigate to={me ? '/channels/@me' : '/login'} replace />} />
          </Routes>
        )}
      </div>
    </div>
  );
}
