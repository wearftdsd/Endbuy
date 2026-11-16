import { useEffect, useRef, type ReactNode } from 'react';
import { Gem, X } from 'lucide-react';
import { t } from '../lib/i18n';
import { presenceOf, useStore } from '../lib/store';
import type { Status, User } from '../lib/types';

/* ------------------------------------------------------------------ */
/* Identité visuelle endBuy                                            */
/* ------------------------------------------------------------------ */
export function LogoMark({ size = 40, mono = false }: { size?: number; mono?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="eb-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#00D9B5" />
          <stop offset="1" stopColor="#0B8BF5" />
        </linearGradient>
      </defs>
      <path
        d="M14 4h36c5.5 0 10 4.5 10 10v28c0 5.5-4.5 10-10 10H27l-11 9v-9h-2C8.5 52 4 47.5 4 42V14C4 8.5 8.5 4 14 4z"
        fill={mono ? 'currentColor' : 'url(#eb-g)'}
      />
      <path d="M18.5 28.5h27M45.5 28.5a13.5 13.5 0 1 0-4 9.6" fill="none" stroke={mono ? 'var(--bg-2)' : '#fff'} strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-extrabold tracking-tight ${className}`}>
      end<span className="text-accent">Buy</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Avatars                                                             */
/* ------------------------------------------------------------------ */
export const AVATAR_PRESETS: [string, string][] = [
  ['#00D9B5', '#0B8BF5'],
  ['#FF6A5C', '#FF3D8B'],
  ['#FFB224', '#FF6A5C'],
  ['#8B5CF6', '#3B82F6'],
  ['#22C55E', '#14B8A6'],
  ['#F43F5E', '#A855F7'],
  ['#0EA5E9', '#6366F1'],
  ['#EAB308', '#22C55E'],
  ['#64748B', '#1E293B'],
  ['#EC4899', '#F59E0B'],
  ['#06B6D4', '#3B82F6'],
  ['#A3E635', '#16A34A'],
];

export function PresetAvatar({ preset, letter, size }: { preset: number; letter: string; size: number }) {
  const [a, b] = AVATAR_PRESETS[preset % AVATAR_PRESETS.length] ?? AVATAR_PRESETS[0];
  return (
    <div
      className="w-full h-full rounded-full flex items-center justify-center text-white font-bold select-none"
      style={{ background: `linear-gradient(135deg, ${a}, ${b})`, fontSize: Math.max(10, size * 0.42) }}
    >
      {letter.toUpperCase()}
    </div>
  );
}

const STATUS_COLOR: Record<Status, string> = {
  online: 'var(--success)',
  idle: 'var(--warn)',
  dnd: 'var(--danger)',
  invisible: 'var(--fg-3)',
  offline: 'var(--fg-3)',
};

export function StatusDot({ status, size = 12, ring = 'var(--bg-1)' }: { status: Status; size?: number; ring?: string }) {
  const color = STATUS_COLOR[status];
  return (
    <span
      className="inline-block rounded-full shrink-0 relative"
      style={{ width: size, height: size, background: color, boxShadow: `0 0 0 ${Math.max(2, size / 4)}px ${ring}` }}
      title={statusLabel(status)}
    >
      {status === 'idle' && (
        <span className="absolute rounded-full" style={{ width: size * 0.55, height: size * 0.55, top: 0, left: 0, background: ring }} />
      )}
      {status === 'dnd' && (
        <span className="absolute rounded-full bg-white" style={{ width: size * 0.6, height: size * 0.18, top: size * 0.41, left: size * 0.2 }} />
      )}
      {(status === 'offline' || status === 'invisible') && (
        <span className="absolute rounded-full" style={{ width: size * 0.45, height: size * 0.45, top: size * 0.275, left: size * 0.275, background: ring }} />
      )}
    </span>
  );
}

export function statusLabel(s: Status) {
  return { online: t('En ligne'), idle: t('Absent'), dnd: t('Ne pas déranger'), invisible: t('Invisible'), offline: t('Hors ligne') }[s];
}

export function Avatar({
  user,
  userId,
  size = 40,
  status,
  showStatus = false,
  speaking = false,
  ring = 'var(--bg-1)',
  className = '',
}: {
  user?: User | null;
  userId?: string;
  size?: number;
  status?: Status;
  showStatus?: boolean;
  speaking?: boolean;
  ring?: string;
  className?: string;
}) {
  const u = useStore((s) => user ?? (userId ? s.users[userId] ?? (s.me?.id === userId ? s.me : undefined) : undefined));
  const presence = useStore((s) => (showStatus && u ? presenceOf(s, u.id).status : 'offline'));
  const st = status ?? presence;
  const dot = Math.max(10, Math.round(size * 0.3));
  return (
    <div className={`relative shrink-0 ${className}`} style={{ width: size, height: size }}>
      <div className={`w-full h-full rounded-full overflow-hidden transition-shadow ${speaking ? 'speaking-ring' : ''}`}>
        {u?.avatar ? (
          <img src={u.avatar} alt="" className="w-full h-full object-cover" draggable={false} />
        ) : (
          <PresetAvatar preset={u?.avatarPreset ?? 0} letter={(u?.displayName || u?.username || '?')[0]} size={size} />
        )}
      </div>
      {showStatus && (
        <span className="absolute" style={{ right: -2, bottom: -2 }}>
          <StatusDot status={st} size={dot} ring={ring} />
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Divers                                                              */
/* ------------------------------------------------------------------ */
export function NitroBadge({ size = 16, title }: { size?: number; title?: string }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-md nitro-gradient text-white shrink-0"
      style={{ width: size + 6, height: size + 6 }}
      title={title ?? t('endBuy Nitro Lifetime')}
    >
      <Gem size={size - 2} strokeWidth={2.5} />
    </span>
  );
}

export function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="switch" disabled={disabled} onClick={() => onChange(!checked)} />
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return <span className={`spinner inline-block ${className}`} />;
}

export function Modal({
  onClose,
  children,
  width = 440,
  className = '',
  bare = false,
}: {
  onClose: () => void;
  children: ReactNode;
  width?: number | string;
  className?: string;
  bare?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/60 anim-fade p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`anim-pop max-h-full overflow-hidden flex flex-col ${bare ? '' : 'bg-float rounded-2xl border border-line'} ${className}`}
        style={{ width, maxWidth: '100%', boxShadow: 'var(--shadow)' }}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>
  );
}

export function ModalHeader({ title, subtitle, onClose }: { title: ReactNode; subtitle?: ReactNode; onClose?: () => void }) {
  return (
    <div className="px-6 pt-6 pb-2 relative">
      <h2 className="text-xl font-bold pr-8">{title}</h2>
      {subtitle && <p className="text-fg-2 text-sm mt-1">{subtitle}</p>}
      {onClose && (
        <button className="icon-btn absolute right-4 top-4" onClick={onClose} aria-label={t('Fermer')}>
          <X size={20} />
        </button>
      )}
    </div>
  );
}

export function ModalFooter({ children }: { children: ReactNode }) {
  return <div className="px-6 py-4 bg-bg-3 flex justify-end gap-2 mt-auto border-t border-line">{children}</div>;
}

export function Field({ label, children, hint, error }: { label: string; children: ReactNode; hint?: ReactNode; error?: string | null }) {
  return (
    <label className="block mb-4">
      <span className="label">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-fg-3 mt-1.5">{hint}</span>}
      {error && <span className="block text-xs text-danger mt-1.5">{error}</span>}
    </label>
  );
}

export function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="rounded-lg bg-danger/12 border border-danger/40 text-danger text-sm px-3 py-2 mb-4 anim-fade">{message}</div>;
}

export function ServerIcon({ name, icon, size = 48, className = '' }: { name: string; icon: string | null; size?: number; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => [...w][0])
    .join('');
  return icon ? (
    <img src={icon} alt="" className={`object-cover ${className}`} style={{ width: size, height: size }} draggable={false} />
  ) : (
    <span className={`flex items-center justify-center font-semibold ${className}`} style={{ width: size, height: size, fontSize: size * (initials.length > 2 ? 0.28 : 0.36) }}>
      {initials}
    </span>
  );
}

export function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOutside: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    const id = setTimeout(() => document.addEventListener('mousedown', h), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', h);
    };
  }, [ref, onOutside, active]);
}
