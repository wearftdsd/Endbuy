import { useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, X } from 'lucide-react';
import { t } from '../../lib/i18n';

export interface SettingsSection {
  title?: string;
  items: { key: string; label: ReactNode; danger?: boolean; onClick?: () => void; hidden?: boolean }[];
}

/** Mise en page plein écran des paramètres (utilisateur, serveur, salon). */
export function SettingsLayout({
  sections,
  active,
  onSelect,
  onClose,
  children,
}: {
  sections: SettingsSection[];
  active: string;
  onSelect: (k: string) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const [mobileMenu, setMobileMenu] = useState(true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[role=dialog]')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex anim-fade" style={{ top: 'var(--titlebar-h, 0px)', background: 'var(--app-bg)', backgroundColor: 'var(--float)' }}>
      <nav className={`${mobileMenu ? 'flex' : 'hidden'} md:flex w-full md:w-[34%] md:min-w-[230px] bg-bg-1 justify-end overflow-y-auto scroll-thin`}>
        <div className="w-full md:w-[220px] py-14 px-3 md:pr-2">
          {sections.map((sec, i) => (
            <div key={i} className="mb-2">
              {sec.title && <div className="text-xs font-bold uppercase tracking-wide text-fg-3 px-2.5 pb-1.5 pt-1 truncate">{sec.title}</div>}
              {sec.items
                .filter((it) => !it.hidden)
                .map((it) => (
                  <button
                    key={it.key}
                    className={`w-full text-left px-2.5 py-1.5 rounded-md text-[15px] font-medium mb-0.5 transition-colors flex items-center gap-2 ${
                      it.danger ? 'text-danger hover:bg-danger/10' : active === it.key ? 'bg-bg-4 text-fg' : 'text-fg-2 hover:bg-bg-3 hover:text-fg'
                    }`}
                    onClick={() => {
                      if (it.onClick) return it.onClick();
                      onSelect(it.key);
                      setMobileMenu(false);
                    }}
                  >
                    {it.label}
                  </button>
                ))}
              {i < sections.length - 1 && <div className="h-px bg-line mx-2.5 mt-2" />}
            </div>
          ))}
        </div>
      </nav>
      <main className={`${mobileMenu ? 'hidden' : 'flex'} md:flex flex-1 min-w-0 overflow-y-auto scroll-thin bg-bg-2`}>
        <div className="w-full max-w-[760px] px-5 md:px-10 py-14 relative">
          <button className="md:hidden btn btn-ghost !px-0 mb-4" onClick={() => setMobileMenu(true)}>
            <ChevronLeft size={18} /> {t('Retour')}
          </button>
          {children}
        </div>
        <div className="hidden md:block pt-14 pr-6">
          <button className="flex flex-col items-center gap-1 text-fg-3 hover:text-fg group" onClick={onClose}>
            <span className="w-9 h-9 rounded-full border-2 border-current flex items-center justify-center">
              <X size={18} />
            </span>
            <span className="text-xs font-bold">{t('ÉCHAP')}</span>
          </button>
        </div>
      </main>
      <button className="md:hidden fixed top-3 right-3 icon-btn bg-bg-3 z-10" onClick={onClose} aria-label={t('Fermer')}>
        <X size={18} />
      </button>
    </div>
  );
}

export function SectionTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="text-xl font-bold">{children}</h2>
      {sub && <p className="text-sm text-fg-2 mt-1">{sub}</p>}
    </div>
  );
}

export function Row({ title, desc, children }: { title: ReactNode; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-4 border-b border-line">
      <div className="min-w-0">
        <div className="font-medium">{title}</div>
        {desc && <div className="text-sm text-fg-3 mt-0.5">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Barre « modifications non enregistrées ». */
export function SaveBar({ visible, onReset, onSave, busy }: { visible: boolean; onReset: () => void; onSave: () => void; busy?: boolean }) {
  if (!visible) return null;
  return (
    <div className="sticky bottom-4 mt-8 z-10 anim-up">
      <div className="flex items-center gap-3 bg-float border border-line rounded-xl px-4 py-3" style={{ boxShadow: 'var(--shadow)' }}>
        <span className="flex-1 text-sm font-medium">{t('Attention, il reste des modifications non enregistrées !')}</span>
        <button className="btn btn-ghost !py-1.5" onClick={onReset}>
          {t('Réinitialiser')}
        </button>
        <button className="btn btn-success !py-1.5" onClick={onSave} disabled={busy}>
          {t('Enregistrer')}
        </button>
      </div>
    </div>
  );
}
