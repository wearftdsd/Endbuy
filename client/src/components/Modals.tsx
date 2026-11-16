import { useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, Copy, Download, Folder, Hash, ImagePlus, Lock, Radio, Search, Volume2 } from 'lucide-react';
import { errorMessage, post, put, upload } from '../lib/api';
import { t } from '../lib/i18n';
import { useShallow } from 'zustand/react/shallow';
import { closeModal, displayName, S, setState, toast, useStore, type ModalState } from '../lib/store';
import { CH, type Channel, type Server } from '../lib/types';
import { RecoveryCodesBlock } from './AuthPages';
import { Avatar, ErrorBox, Field, LogoMark, Modal, ModalFooter, ModalHeader, Spinner, Switch } from './ui';

function go(path: string) {
  window.dispatchEvent(new CustomEvent('endbuy:navigate', { detail: path }));
}

/* ------------------------------------------------------------------ */
/* Créer / rejoindre un serveur                                        */
/* ------------------------------------------------------------------ */
export function CreateServerModal() {
  const me = useStore((s) => s.me!);
  const [step, setStep] = useState<'choose' | 'create' | 'join'>('choose');
  const [name, setName] = useState(t('Le serveur de {name}', { name: me.displayName }));
  const [icon, setIcon] = useState<File | null>(null);
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const server = await post<Server>('/servers', { name });
      setState((s) => {
        s.servers[server.id] = server;
        if (!s.serverOrder.includes(server.id)) s.serverOrder.push(server.id);
      });
      if (icon) {
        const fd = new FormData();
        fd.append('file', icon);
        await upload(`/servers/${server.id}/icon`, fd).catch(() => {});
      }
      closeModal();
      go(`/channels/${server.id}`);
      toast(t('Serveur « {name} » créé !', { name }), 'success');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    const code = invite.trim().replace(/^.*\/invite\//, '').replace(/[/?#].*$/, '');
    if (!code) return;
    setBusy(true);
    setError(null);
    try {
      const { serverId } = await post<{ serverId: string }>(`/invites/${encodeURIComponent(code)}`);
      closeModal();
      setTimeout(() => go(`/channels/${serverId}`), 150);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={closeModal} width={460}>
      {step === 'choose' && (
        <>
          <ModalHeader title={t('Crée ton serveur')} subtitle={t('Ton serveur est l’endroit où tu retrouves tes amis. Crée le tien et lance la discussion.')} onClose={closeModal} />
          <div className="px-6 py-4 space-y-2">
            <button className="w-full flex items-center gap-4 p-4 rounded-xl border border-line hover:bg-bg-3 text-left" onClick={() => setStep('create')}>
              <LogoMark size={40} />
              <span className="font-bold flex-1">{t('Créer mon propre serveur')}</span>
              <ChevronLeft size={18} className="rotate-180 text-fg-3" />
            </button>
          </div>
          <div className="px-6 pb-6 pt-2 text-center">
            <div className="text-lg font-bold">{t('Tu as déjà une invitation ?')}</div>
            <button className="btn btn-secondary w-full mt-3" onClick={() => setStep('join')}>
              {t('Rejoindre un serveur')}
            </button>
          </div>
        </>
      )}
      {step === 'create' && (
        <>
          <ModalHeader title={t('Personnalise ton serveur')} subtitle={t('Donne une personnalité à ton serveur avec un nom et une icône. Tu pourras les changer plus tard.')} onClose={closeModal} />
          <div className="px-6 py-4">
            <ErrorBox message={error} />
            <div className="flex justify-center mb-5">
              <button className="w-24 h-24 rounded-full border-2 border-dashed border-fg-3 flex flex-col items-center justify-center text-fg-3 hover:text-fg hover:border-fg overflow-hidden" onClick={() => fileRef.current?.click()}>
                {icon ? <img src={URL.createObjectURL(icon)} alt="" className="w-full h-full object-cover" /> : (<><ImagePlus size={24} /><span className="text-[10px] font-bold uppercase mt-1">{t('Importer')}</span></>)}
              </button>
              <input ref={fileRef} type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => setIcon(e.target.files?.[0] ?? null)} />
            </div>
            <Field label={t('Nom du serveur')}>
              <input className="input" autoFocus value={name} maxLength={100} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim().length >= 2 && create()} />
            </Field>
          </div>
          <ModalFooter>
            <button className="btn btn-ghost mr-auto" onClick={() => setStep('choose')}>
              {t('Retour')}
            </button>
            <button className="btn btn-primary" disabled={busy || name.trim().length < 2} onClick={create}>
              {busy ? <Spinner /> : t('Créer')}
            </button>
          </ModalFooter>
        </>
      )}
      {step === 'join' && (
        <>
          <ModalHeader title={t('Rejoindre un serveur')} subtitle={t('Saisis une invitation ci-dessous pour rejoindre un serveur existant.')} onClose={closeModal} />
          <div className="px-6 py-4">
            <ErrorBox message={error} />
            <Field label={t("Lien d'invitation")} hint={t('Exemples : hTKzmak9 ou {origin}/invite/hTKzmak9', { origin: location.origin })}>
              <input className="input" autoFocus value={invite} onChange={(e) => setInvite(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && join()} />
            </Field>
          </div>
          <ModalFooter>
            <button className="btn btn-ghost mr-auto" onClick={() => setStep('choose')}>
              {t('Retour')}
            </button>
            <button className="btn btn-primary" disabled={busy || !invite.trim()} onClick={join}>
              {busy ? <Spinner /> : t('Rejoindre')}
            </button>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Créer un salon                                                      */
/* ------------------------------------------------------------------ */
export function CreateChannelModal({ serverId, parentId, channelType }: { serverId: string; parentId?: string | null; channelType?: number }) {
  const server = useStore((s) => s.servers[serverId]);
  const [type, setType] = useState(channelType ?? CH.TEXT);
  const [name, setName] = useState('');
  const [priv, setPriv] = useState(false);
  const [roles, setRoles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isCategory = type === CH.CATEGORY;
  const parent = server?.channels.find((c) => c.id === parentId);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const { id } = await post<{ id: string }>(`/servers/${serverId}/channels`, { name, type, parentId: isCategory ? null : parentId, private: priv, roleIds: roles });
      closeModal();
      if (type !== CH.CATEGORY) setTimeout(() => go(`/channels/${serverId}/${id}`), 200);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const types = [
    { k: CH.TEXT, icon: <Hash size={22} />, label: t('Texte'), desc: t('Envoie des messages, images, GIF, emojis, avis et blagues') },
    { k: CH.VOICE, icon: <Volume2 size={22} />, label: t('Vocal'), desc: t('Discutez ensemble en vocal, en vidéo ou en partage d’écran') },
    { k: CH.STAGE, icon: <Radio size={22} />, label: t('Conférence'), desc: t('Des orateurs sur scène et un public qui lève la main : annonces, interviews, AMA') },
  ];
  return (
    <Modal onClose={closeModal} width={480}>
      <ModalHeader title={isCategory ? t('Créer une catégorie') : t('Créer un salon')} subtitle={parent ? t('dans {name}', { name: parent.name }) : undefined} onClose={closeModal} />
      <div className="px-6 py-3 overflow-y-auto scroll-thin">
        <ErrorBox message={error} />
        {!isCategory && (
          <div className="mb-4">
            <span className="label">{t('Type de salon')}</span>
            <div className="space-y-2">
              {types.map((tp) => (
                <button key={tp.k} className={`w-full flex items-center gap-3 p-3 rounded-lg text-left ${type === tp.k ? 'bg-bg-4' : 'bg-bg-3 hover:bg-bg-4/70'}`} onClick={() => setType(tp.k)}>
                  <span className="text-fg-2">{tp.icon}</span>
                  <span className="flex-1">
                    <span className="block font-semibold">{tp.label}</span>
                    <span className="block text-xs text-fg-3">{tp.desc}</span>
                  </span>
                  <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${type === tp.k ? 'border-accent' : 'border-fg-3'}`}>
                    {type === tp.k && <span className="w-2.5 h-2.5 rounded-full bg-accent" />}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        <Field label={isCategory ? t('Nom de la catégorie') : t('Nom du salon')}>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-3">{isCategory ? <Folder size={16} /> : type === CH.STAGE ? <Radio size={16} /> : type === CH.VOICE ? <Volume2 size={16} /> : <Hash size={16} />}</span>
            <input className="input !pl-9" autoFocus value={name} maxLength={100} placeholder={isCategory ? t('Nouvelle catégorie') : t('nouveau-salon')} onChange={(e) => setName(type === CH.TEXT ? e.target.value.toLowerCase().replace(/\s/g, '-') : e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && submit()} />
          </div>
        </Field>
        <div className="flex items-center justify-between gap-4 py-2">
          <div>
            <div className="font-semibold flex items-center gap-1.5">
              <Lock size={16} /> {isCategory ? t('Catégorie privée') : t('Salon privé')}
            </div>
            <div className="text-xs text-fg-3">{t('Seuls les membres et rôles sélectionnés pourront le voir.')}</div>
          </div>
          <Switch checked={priv} onChange={setPriv} />
        </div>
        {priv && (
          <div className="mt-2 rounded-lg bg-bg-1 border border-line p-3 anim-fade">
            <div className="text-xs font-bold uppercase text-fg-2 mb-2">{t('Rôles autorisés')}</div>
            {server?.roles
              .filter((r) => !r.isDefault)
              .sort((a, b) => b.position - a.position)
              .map((r) => (
                <label key={r.id} className="flex items-center gap-2 py-1 cursor-pointer">
                  <input type="checkbox" className="accent-[var(--accent)]" checked={roles.includes(r.id)} onChange={(e) => setRoles(e.target.checked ? [...roles, r.id] : roles.filter((x) => x !== r.id))} />
                  <span className="w-3 h-3 rounded-full" style={{ background: r.color ?? 'var(--fg-3)' }} />
                  <span className="text-sm">{r.name}</span>
                </label>
              ))}
            <div className="text-xs text-fg-3 mt-1">{t('Tu y auras toujours accès en tant que créateur.')}</div>
          </div>
        )}
      </div>
      <ModalFooter>
        <button className="btn btn-ghost" onClick={closeModal}>
          {t('Annuler')}
        </button>
        <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={submit}>
          {busy ? <Spinner /> : isCategory ? t('Créer la catégorie') : t('Créer le salon')}
        </button>
      </ModalFooter>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Invitation                                                          */
/* ------------------------------------------------------------------ */
export function InviteModal({ serverId }: { serverId: string }) {
  const server = useStore((s) => s.servers[serverId]);
  const friends = useStore(useShallow((s) => Object.values(s.relationships).filter((r) => r.type === 1).map((r) => r.id)));
  const [code, setCode] = useState<string | null>(null);
  const [maxAge, setMaxAge] = useState(7 * 24 * 3600);
  const [maxUses, setMaxUses] = useState(0);
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  useEffect(() => {
    setCode(null);
    post<{ code: string }>(`/servers/${serverId}/invites`, { maxAgeSeconds: maxAge, maxUses })
      .then((r) => setCode(r.code))
      .catch((e) => setError(errorMessage(e)));
  }, [serverId, maxAge, maxUses]);
  const link = code ? `${location.origin}/invite/${code}` : '';
  const sendTo = async (userId: string) => {
    try {
      const ch = await post<Channel>('/users/@me/channels', { recipientId: userId });
      await post(`/channels/${ch.id}/messages`, { content: link });
      setSent((x) => [...x, userId]);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  return (
    <Modal onClose={closeModal} width={460}>
      <ModalHeader title={t('Inviter des amis sur {name}', { name: server?.name ?? '' })} onClose={closeModal} />
      <div className="px-6 py-3">
        <ErrorBox message={error} />
        {friends.length > 0 && (
          <>
            <div className="relative mb-2">
              <input className="input !py-1.5 text-sm" placeholder={t('Rechercher des amis')} value={filter} onChange={(e) => setFilter(e.target.value)} />
              <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-3" />
            </div>
            <div className="max-h-48 overflow-y-auto scroll-thin -mx-2 mb-4">
              {friends
                .filter((id) => displayName(S(), id).toLowerCase().includes(filter.toLowerCase()))
                .map((id) => (
                  <div key={id} className="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-bg-3">
                    <Avatar userId={id} size={32} />
                    <span className="flex-1 font-medium truncate">{displayName(S(), id)}</span>
                    <button className={`btn !py-1 text-xs ${sent.includes(id) ? 'btn-secondary' : 'btn-primary'}`} disabled={!code || sent.includes(id)} onClick={() => sendTo(id)}>
                      {sent.includes(id) ? t('Envoyé') : t('Inviter')}
                    </button>
                  </div>
                ))}
            </div>
          </>
        )}
        <span className="label">{t("Ou envoie un lien d'invitation à un ami")}</span>
        <div className="flex gap-2 bg-bg-0 rounded-lg border border-line p-1.5">
          <input className="flex-1 bg-transparent outline-none px-2 text-sm font-mono" readOnly value={link || t('Génération…')} />
          <button
            className={`btn !py-1.5 ${copied ? 'bg-success text-white' : 'btn-primary'}`}
            disabled={!code}
            onClick={() => {
              navigator.clipboard?.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            }}
          >
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? t('Copié') : t('Copier')}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-4 mb-2">
          <label className="block">
            <span className="label">{t('Expire après')}</span>
            <select className="input !py-1.5 text-sm" value={maxAge} onChange={(e) => setMaxAge(Number(e.target.value))}>
              <option value={1800}>{t('30 minutes')}</option>
              <option value={3600}>{t('1 heure')}</option>
              <option value={86400}>{t('1 jour')}</option>
              <option value={604800}>{t('7 jours')}</option>
              <option value={0}>{t('Jamais')}</option>
            </select>
          </label>
          <label className="block">
            <span className="label">{t("Nombre max. d'utilisations")}</span>
            <select className="input !py-1.5 text-sm" value={maxUses} onChange={(e) => setMaxUses(Number(e.target.value))}>
              <option value={0}>{t('Illimité')}</option>
              {[1, 5, 10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Confirmation générique                                              */
/* ------------------------------------------------------------------ */
export function ConfirmModal({ m }: { m: Extract<ModalState, { type: 'confirm' }> }) {
  const [busy, setBusy] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await m.onConfirm(m.input ? value : undefined);
      closeModal();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal onClose={closeModal} width={440}>
      <ModalHeader title={m.title} />
      <div className="px-6 py-3 text-fg-2">
        <ErrorBox message={error} />
        {m.body}
        {m.input && (
          <div className="mt-4">
            <Field label={m.input.label}>
              <input className="input" autoFocus placeholder={m.input.placeholder} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && confirm()} />
            </Field>
          </div>
        )}
      </div>
      <ModalFooter>
        <button className="btn btn-ghost" onClick={closeModal}>
          {t('Annuler')}
        </button>
        <button className={`btn ${m.danger ? 'btn-danger' : 'btn-primary'}`} autoFocus={!m.input} disabled={busy} onClick={confirm}>
          {busy ? <Spinner /> : m.confirmLabel ?? t('Confirmer')}
        </button>
      </ModalFooter>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* MP / groupe                                                         */
/* ------------------------------------------------------------------ */
export function CreateGroupModal({ channelId }: { channelId?: string }) {
  const friends = useStore(useShallow((s) => Object.values(s.relationships).filter((r) => r.type === 1).map((r) => r.id)));
  const existing = useStore((s) => (channelId ? s.privateChannels[channelId] : undefined));
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const available = friends.filter((id) => !existing?.recipients?.includes(id));
  const max = existing ? 9 - (existing.recipients?.length ?? 0) : 9;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (existing) {
        for (const id of selected) await put(`/channels/${existing.id}/recipients/${id}`);
        closeModal();
        return;
      }
      const ch = await post<Channel>('/users/@me/channels', selected.length === 1 ? { recipientId: selected[0] } : { recipientIds: selected, group: true });
      setState((s) => void (s.privateChannels[ch.id] = { ...ch, closed: false }));
      closeModal();
      go(`/channels/@me/${ch.id}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal onClose={closeModal} width={440}>
      <ModalHeader title={existing ? t('Ajouter des amis au groupe') : t('Sélectionne des amis')} subtitle={t('Tu peux encore ajouter {n} ami(s).', { n: Math.max(0, max - selected.length) })} onClose={closeModal} />
      <div className="px-6 py-2">
        <ErrorBox message={error} />
        <input className="input !py-2 text-sm" autoFocus placeholder={t('Saisis le pseudo d’un ami')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="max-h-72 overflow-y-auto scroll-thin mt-3 -mx-2">
          {available
            .filter((id) => displayName(S(), id).toLowerCase().includes(filter.toLowerCase()) || S().users[id]?.username.includes(filter.toLowerCase()))
            .map((id) => {
              const on = selected.includes(id);
              return (
                <label key={id} className="flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-bg-3 cursor-pointer">
                  <Avatar userId={id} size={32} showStatus ring="var(--bg-2)" />
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium truncate">{displayName(S(), id)}</span>
                    <span className="block text-xs text-fg-3">@{S().users[id]?.username}</span>
                  </span>
                  <input type="checkbox" className="w-5 h-5 accent-[var(--accent)]" checked={on} disabled={!on && selected.length >= max} onChange={() => setSelected(on ? selected.filter((x) => x !== id) : [...selected, id])} />
                </label>
              );
            })}
          {!available.length && <div className="text-center text-sm text-fg-3 py-8">{t('Aucun ami disponible. Ajoute des amis depuis l’onglet Amis.')}</div>}
        </div>
      </div>
      <ModalFooter>
        <button className="btn btn-primary w-full" disabled={!selected.length || busy} onClick={submit}>
          {busy ? <Spinner /> : existing ? t('Ajouter') : selected.length > 1 ? t('Créer le groupe') : t('Envoyer un MP')}
        </button>
      </ModalFooter>
    </Modal>
  );
}

export function ImageModal({ url, filename }: { url: string; filename: string }) {
  return (
    <Modal onClose={closeModal} width="auto" bare>
      <div className="flex flex-col items-center gap-2">
        <img src={url} alt={filename} className="max-w-[90vw] max-h-[80vh] object-contain rounded-lg" />
        <div className="flex gap-3 text-sm">
          <a href={url} download={filename} className="text-fg-2 hover:text-fg flex items-center gap-1">
            <Download size={14} /> {t('Télécharger')}
          </a>
          <a href={url} target="_blank" rel="noopener noreferrer" className="text-fg-2 hover:text-fg">
            {t("Ouvrir l'original")}
          </a>
        </div>
      </div>
    </Modal>
  );
}

export function RecoveryCodesModal({ codes }: { codes: string[] }) {
  const me = useStore((s) => s.me!);
  return (
    <Modal onClose={closeModal} width={520}>
      <ModalHeader title={t('Nouveaux codes de récupération')} subtitle={t('Les anciens codes ne fonctionnent plus. Conserve ceux-ci en lieu sûr.')} onClose={closeModal} />
      <div className="px-6 py-4">
        <RecoveryCodesBlock codes={codes} username={me.username} />
      </div>
      <ModalFooter>
        <button className="btn btn-primary" onClick={closeModal}>
          {t("C'est noté")}
        </button>
      </ModalFooter>
    </Modal>
  );
}

