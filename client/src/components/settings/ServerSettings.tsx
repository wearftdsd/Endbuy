import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Crown, ImagePlus, Plus, Search, Shield, Trash2, Upload } from 'lucide-react';
import { del, errorMessage, get, patch, post, upload } from '../../lib/api';
import { formatLongDate } from '../../lib/format';
import { t, tn } from '../../lib/i18n';
import { has, P, PERMISSION_GROUPS } from '../../lib/perms';
import { closeModal, confirmDialog, displayName, memberOf, S, toast, useStore } from '../../lib/store';
import type { Role, Server, User } from '../../lib/types';
import { memberMenu } from '../MemberList';
import { Avatar, ErrorBox, Field, ServerIcon, Spinner, Switch } from '../ui';
import { Row, SaveBar, SectionTitle, SettingsLayout } from './SettingsLayout';

const ROLE_COLORS = ['#00C2A8', '#1ABC9C', '#2ECC71', '#3498DB', '#9B59B6', '#E91E63', '#F1C40F', '#E67E22', '#E74C3C', '#95A5A6', '#607D8B', '#FF7A5C'];

function highest(server: Server, userId: string) {
  if (server.ownerId === userId) return Infinity;
  const m = memberOf(server, userId);
  return Math.max(0, ...(m?.roles ?? []).map((rid) => server.roles.find((r) => r.id === rid)?.position ?? 0));
}

/* ------------------------------ Vue d'ensemble ------------------------------ */
function Overview({ server }: { server: Server }) {
  const [name, setName] = useState(server.name);
  const [description, setDescription] = useState(server.description);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const can = has(server.permissions, P.MANAGE_SERVER);
  const dirty = name !== server.name || description !== server.description;
  const save = async () => {
    setBusy(true);
    try {
      await patch(`/servers/${server.id}`, { name, description });
      toast(t('Modifications enregistrées.'), 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SectionTitle>{t('Vue d’ensemble du serveur')}</SectionTitle>
      <div className="flex flex-col sm:flex-row gap-8">
        <div className="flex flex-col items-center gap-2">
          <button disabled={!can} className="relative w-24 h-24 rounded-full overflow-hidden bg-bg-3 group" onClick={() => fileRef.current?.click()}>
            <ServerIcon name={server.name} icon={server.icon} size={96} />
            {can && (
              <span className="absolute inset-0 bg-black/60 text-white text-[10px] font-bold uppercase flex items-center justify-center opacity-0 group-hover:opacity-100">
                {t("Changer l'icône")}
              </span>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const fd = new FormData();
              fd.append('file', f);
              await upload(`/servers/${server.id}/icon`, fd).catch((err) => toast(errorMessage(err), 'error'));
            }}
          />
          {server.icon && can && (
            <button className="text-xs text-fg-3 hover:underline" onClick={() => del(`/servers/${server.id}/icon`)}>
              {t('Supprimer')}
            </button>
          )}
          <span className="text-xs text-fg-3 text-center max-w-[120px]">{t('128×128 minimum recommandé. GIF animés acceptés.')}</span>
        </div>
        <div className="flex-1">
          <Field label={t('Nom du serveur')}>
            <input className="input" disabled={!can} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('Description')} hint={t('Visible en haut de la liste des salons et sur les invitations.')}>
            <textarea className="input resize-none" rows={3} disabled={!can} value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
      </div>
      <div className="text-sm text-fg-3 mt-4">
        {t('Créé le {date}', { date: formatLongDate(server.createdAt) })} · ID <span className="font-mono">{server.id}</span>
      </div>
      <SaveBar visible={dirty} busy={busy} onReset={() => (setName(server.name), setDescription(server.description))} onSave={save} />
    </>
  );
}

/* ------------------------------ Rôles ------------------------------ */
function RoleEditor({ server, role, myTop, isOwner }: { server: Server; role: Role; myTop: number; isOwner: boolean }) {
  const [draft, setDraft] = useState(role);
  const [tab, setTab] = useState<'display' | 'perms' | 'members'>('display');
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(role), [role]);
  const editable = role.isDefault || role.position < myTop;
  const myPerms = server.permissions;
  const dirty = JSON.stringify(draft) !== JSON.stringify(role);
  const save = async () => {
    setBusy(true);
    try {
      await patch(`/servers/${server.id}/roles/${role.id}`, { name: draft.name, color: draft.color, permissions: draft.permissions, hoist: draft.hoist, mentionable: draft.mentionable });
      toast(t('Rôle enregistré.'), 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const members = server.members.filter((m) => m.roles.includes(role.id));
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-lg truncate">{t('Modifier le rôle — {name}', { name: role.name })}</h3>
        {!role.isDefault && editable && (
          <button
            className="icon-btn hover:!text-danger"
            title={t('Supprimer le rôle')}
            onClick={() =>
              confirmDialog({
                title: t('Supprimer le rôle « {name} »', { name: role.name }),
                body: t('Cette action est irréversible. Les membres perdront ce rôle.'),
                confirmLabel: t('Supprimer'),
                danger: true,
                onConfirm: () => del(`/servers/${server.id}/roles/${role.id}`),
              })
            }
          >
            <Trash2 size={18} />
          </button>
        )}
      </div>
      <div className="flex gap-4 border-b border-line mb-5 text-sm">
        {(
          [
            ['display', t('Affichage')],
            ['perms', t('Permissions')],
            ...(!role.isDefault ? [['members', t('Membres ({n})', { n: members.length })]] : []),
          ] as [typeof tab, string][]
        ).map(([k, label]) => (
          <button key={k} className={`pb-2 -mb-px border-b-2 font-medium ${tab === k ? 'border-accent text-fg' : 'border-transparent text-fg-3 hover:text-fg-2'}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {!editable && <div className="rounded-lg bg-warn/10 border border-warn/40 text-warn text-sm p-3 mb-4">{t('Ce rôle est au-dessus (ou au niveau) de ton rôle le plus élevé : tu ne peux pas le modifier.')}</div>}
      {tab === 'display' && (
        <fieldset disabled={!editable}>
          {!role.isDefault && (
            <Field label={t('Nom du rôle')}>
              <input className="input" value={draft.name} maxLength={100} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
          )}
          {!role.isDefault && (
            <>
              <span className="label">{t('Couleur du rôle')}</span>
              <div className="flex flex-wrap gap-2 items-center mb-5">
                <button className={`w-10 h-10 rounded-md border-2 ${!draft.color ? 'border-fg' : 'border-line'} bg-fg-3`} onClick={() => setDraft({ ...draft, color: null })} title={t('Par défaut')} />
                {ROLE_COLORS.map((c) => (
                  <button key={c} className={`w-7 h-7 rounded-md ${draft.color?.toLowerCase() === c.toLowerCase() ? 'ring-2 ring-fg ring-offset-2 ring-offset-bg-2' : ''}`} style={{ background: c }} onClick={() => setDraft({ ...draft, color: c })} />
                ))}
                <input type="color" className="w-10 h-10 rounded-md bg-transparent cursor-pointer" value={draft.color ?? '#99AAB5'} onChange={(e) => setDraft({ ...draft, color: e.target.value.toUpperCase() })} />
              </div>
              <Row title={t('Afficher séparément les membres de ce rôle')} desc={t('Ils apparaîtront dans leur propre groupe dans la liste des membres.')}>
                <Switch checked={draft.hoist} onChange={(v) => setDraft({ ...draft, hoist: v })} />
              </Row>
              <Row title={t('Autoriser tout le monde à @mentionner ce rôle')}>
                <Switch checked={draft.mentionable} onChange={(v) => setDraft({ ...draft, mentionable: v })} />
              </Row>
            </>
          )}
          {role.isDefault && <p className="text-sm text-fg-2">{t('@everyone représente tous les membres du serveur. Seules ses permissions peuvent être modifiées.')}</p>}
        </fieldset>
      )}
      {tab === 'perms' && (
        <div>
          {PERMISSION_GROUPS.map((g) => (
            <div key={g.title} className="mb-6">
              <div className="text-xs font-bold uppercase tracking-wide text-fg-3 mb-1">{t(g.title)}</div>
              {g.items.map((it) => {
                const on = (draft.permissions & it.bit) === it.bit;
                const grantable = isOwner || has(myPerms, P.ADMINISTRATOR) || (myPerms & it.bit) === it.bit;
                return (
                  <Row key={it.bit} title={t(it.name)} desc={t(it.desc)}>
                    <Switch checked={on} disabled={!editable || (!on && !grantable)} onChange={(v) => setDraft({ ...draft, permissions: v ? draft.permissions | it.bit : draft.permissions & ~it.bit })} />
                  </Row>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {tab === 'members' && (
        <div>
          {members.length === 0 && <p className="text-sm text-fg-3">{t('Aucun membre n’a ce rôle. Attribue-le depuis l’onglet Membres ou via un clic droit sur un membre.')}</p>}
          {members.map((m) => (
            <div key={m.userId} className="flex items-center gap-3 py-2 border-b border-line">
              <Avatar userId={m.userId} size={32} />
              <span className="flex-1 font-medium">{displayName(S(), m.userId, server.id)}</span>
              {editable && (
                <button className="btn btn-secondary !py-1 text-xs" onClick={() => patch(`/servers/${server.id}/members/${m.userId}`, { roles: m.roles.filter((x) => x !== role.id) }).catch((e) => toast(errorMessage(e), 'error'))}>
                  {t('Retirer')}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <SaveBar visible={dirty && editable} busy={busy} onReset={() => setDraft(role)} onSave={save} />
    </div>
  );
}

function Roles({ server }: { server: Server }) {
  const me = useStore((s) => s.me!.id);
  const roles = [...server.roles].sort((a, b) => b.position - a.position);
  const [selected, setSelected] = useState<string>(roles.find((r) => !r.isDefault)?.id ?? roles[0]?.id);
  const role = server.roles.find((r) => r.id === selected) ?? roles[0];
  const myTop = highest(server, me);
  const create = async () => {
    try {
      const { id } = await post<{ id: string }>(`/servers/${server.id}/roles`, { name: t('nouveau rôle'), color: ROLE_COLORS[Math.floor(Math.random() * ROLE_COLORS.length)] });
      setSelected(id);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  const move = (id: string, direction: 'up' | 'down') => post(`/servers/${server.id}/roles/${id}/move`, { direction }).catch((e) => toast(errorMessage(e), 'error'));
  return (
    <>
      <SectionTitle sub={t('Utilise les rôles pour regrouper les membres et leur attribuer des permissions (administrateurs, modérateurs…). Les rôles les plus hauts dans la liste sont prioritaires.')}>{t('Rôles')}</SectionTitle>
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="lg:w-56 shrink-0">
          <button className="btn btn-primary w-full mb-3" onClick={create}>
            <Plus size={16} /> {t('Créer un rôle')}
          </button>
          {roles.map((r, i) => (
            <div key={r.id} className={`group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer ${selected === r.id ? 'bg-bg-4' : 'hover:bg-bg-3'}`} onClick={() => setSelected(r.id)}>
              <span className="w-3 h-3 rounded-full shrink-0" style={{ background: r.color ?? 'var(--fg-3)' }} />
              <span className="flex-1 truncate text-sm font-medium">{r.name}</span>
              {r.permissions & P.ADMINISTRATOR ? <Shield size={13} className="text-fg-3" /> : null}
              {!r.isDefault && r.position < myTop && (
                <span className="hidden group-hover:flex">
                  <button className="text-fg-3 hover:text-fg disabled:opacity-30" disabled={i === 0 || roles[i - 1].position >= myTop} onClick={(e) => (e.stopPropagation(), move(r.id, 'up'))}>
                    <ArrowUp size={14} />
                  </button>
                  <button className="text-fg-3 hover:text-fg disabled:opacity-30" disabled={roles[i + 1]?.isDefault ?? true} onClick={(e) => (e.stopPropagation(), move(r.id, 'down'))}>
                    <ArrowDown size={14} />
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
        {role && <RoleEditor key={role.id} server={server} role={role} myTop={myTop} isOwner={server.ownerId === me} />}
      </div>
    </>
  );
}

/* ------------------------------ Emojis & stickers ------------------------------ */
function Emojis({ server, kind }: { server: Server; kind: 'emoji' | 'sticker' }) {
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const list = server.emojis.filter((e) => e.kind === kind);
  const can = has(server.permissions, P.MANAGE_EMOJIS);
  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('name', name);
      fd.append('kind', kind);
      fd.append('file', file);
      await upload(`/servers/${server.id}/emojis`, fd);
      setName('');
      setFile(null);
      toast(kind === 'emoji' ? t('Emoji ajouté !') : t('Sticker ajouté !'), 'success');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <SectionTitle sub={kind === 'emoji' ? t('Ajoute jusqu’à 200 emojis personnalisés. Avec endBuy Nitro, tout le monde peut les utiliser sur tous les serveurs.') : t('Ajoute jusqu’à 60 stickers. PNG, GIF animés ou WebP, 2 Mo maximum.')}>
        {kind === 'emoji' ? t('Emojis') : t('Stickers')}
      </SectionTitle>
      {can && (
        <div className="rounded-xl bg-bg-1 border border-line p-4 mb-6">
          <ErrorBox message={error} />
          <div className="flex flex-wrap items-end gap-3">
            <button className="w-16 h-16 rounded-lg border-2 border-dashed border-fg-3 flex items-center justify-center overflow-hidden text-fg-3 hover:text-fg" onClick={() => fileRef.current?.click()}>
              {file ? <img src={URL.createObjectURL(file)} alt="" className="w-full h-full object-contain" /> : <ImagePlus size={22} />}
            </button>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept="image/png,image/jpeg,image/gif,image/webp"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f && !name) setName(f.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 32));
              }}
            />
            <label className="flex-1 min-w-[180px]">
              <span className="label">{t('Nom')}</span>
              <input className="input" value={name} maxLength={32} onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9_]/g, '_'))} placeholder="mon_emoji" />
            </label>
            <button className="btn btn-primary" disabled={!file || name.length < 2 || busy} onClick={submit}>
              {busy ? <Spinner /> : <Upload size={16} />} {t('Téléverser')}
            </button>
          </div>
        </div>
      )}
      <div className="text-xs font-bold uppercase text-fg-3 mb-2">{tn(list.length, '{n} élément', '{n} éléments')}</div>
      <div className={`grid gap-2 ${kind === 'emoji' ? 'grid-cols-[repeat(auto-fill,minmax(150px,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(140px,1fr))]'}`}>
        {list.map((e) => (
          <div key={e.id} className="group flex items-center gap-2 rounded-lg bg-bg-1 border border-line p-2">
            <img src={e.url} alt={e.name} className={kind === 'emoji' ? 'w-8 h-8 object-contain' : 'w-16 h-16 object-contain'} />
            <span className="flex-1 text-sm truncate">{kind === 'emoji' ? `:${e.name}:` : e.name}</span>
            {can && (
              <button className="opacity-0 group-hover:opacity-100 text-fg-3 hover:text-danger" onClick={() => del(`/servers/${server.id}/emojis/${e.id}`)}>
                <Trash2 size={16} />
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

/* ------------------------------ Membres ------------------------------ */
function Members({ server }: { server: Server }) {
  const [q, setQ] = useState('');
  const users = useStore((s) => s.users);
  const list = server.members.filter((m) => {
    const u = users[m.userId];
    return !q || u?.username.includes(q.toLowerCase()) || (m.nickname ?? u?.displayName ?? '').toLowerCase().includes(q.toLowerCase());
  });
  return (
    <>
      <SectionTitle sub={t('Clic droit (ou bouton …) sur un membre pour gérer ses rôles, son pseudo, l’expulser ou le bannir.')}>{tn(server.members.length, '{n} membre', '{n} membres')}</SectionTitle>
      <div className="relative mb-4">
        <input className="input !pl-9" placeholder={t('Rechercher des membres')} value={q} onChange={(e) => setQ(e.target.value)} />
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
      </div>
      {list.map((m) => (
        <div key={m.userId} className="flex items-center gap-3 py-2.5 border-b border-line" onContextMenu={(e) => memberMenu(e, m.userId, server.id)}>
          <Avatar userId={m.userId} size={36} />
          <div className="min-w-0 w-48">
            <div className="font-medium truncate flex items-center gap-1">
              {displayName(S(), m.userId, server.id)} {server.ownerId === m.userId && <Crown size={13} className="text-warn" />}
            </div>
            <div className="text-xs text-fg-3 truncate">@{users[m.userId]?.username}</div>
          </div>
          <div className="flex-1 flex flex-wrap gap-1 min-w-0">
            {m.roles
              .map((rid) => server.roles.find((r) => r.id === rid))
              .filter(Boolean)
              .sort((a, b) => b!.position - a!.position)
              .map((r) => (
                <span key={r!.id} className="text-xs rounded-md bg-bg-3 px-2 py-0.5 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full" style={{ background: r!.color ?? 'var(--fg-3)' }} /> {r!.name}
                </span>
              ))}
          </div>
          <span className="text-xs text-fg-3 hidden sm:block">{formatLongDate(m.joinedAt)}</span>
          <button className="btn btn-secondary !px-2 !py-1" onClick={(e) => memberMenu(e, m.userId, server.id)}>
            …
          </button>
        </div>
      ))}
    </>
  );
}

function Bans({ server }: { server: Server }) {
  const [bans, setBans] = useState<{ user: User; reason: string; createdAt: string }[] | null>(null);
  const load = () => get(`/servers/${server.id}/bans`).then(setBans).catch((e) => toast(errorMessage(e), 'error'));
  useEffect(() => {
    load();
  }, [server.id]);
  return (
    <>
      <SectionTitle sub={t('Les membres bannis ne peuvent plus rejoindre le serveur.')}>{t('Bannissements')}</SectionTitle>
      {!bans && <Spinner />}
      {bans?.length === 0 && <p className="text-fg-3 text-sm">{t('Aucun bannissement.')}</p>}
      {bans?.map((b) => (
        <div key={b.user.id} className="flex items-center gap-3 py-2.5 border-b border-line">
          <Avatar user={b.user} size={36} />
          <div className="flex-1 min-w-0">
            <div className="font-medium">{b.user.displayName}</div>
            <div className="text-xs text-fg-3 truncate">{b.reason || t('Aucune raison indiquée')} · {formatLongDate(b.createdAt)}</div>
          </div>
          <button className="btn btn-secondary !py-1 text-xs" onClick={() => del(`/servers/${server.id}/bans/${b.user.id}`).then(load)}>
            {t('Révoquer le bannissement')}
          </button>
        </div>
      ))}
    </>
  );
}

function Invites({ server }: { server: Server }) {
  const [invites, setInvites] = useState<{ code: string; inviter: User | null; uses: number; maxUses: number; expiresAt: string | null }[] | null>(null);
  const load = () => get(`/servers/${server.id}/invites`).then(setInvites).catch((e) => toast(errorMessage(e), 'error'));
  useEffect(() => {
    load();
  }, [server.id]);
  return (
    <>
      <SectionTitle sub={t('Liste des invitations actives. Tu peux les révoquer à tout moment.')}>{t('Invitations')}</SectionTitle>
      {!invites && <Spinner />}
      {invites?.length === 0 && <p className="text-fg-3 text-sm">{t('Aucune invitation active.')}</p>}
      {invites?.map((i) => (
        <div key={i.code} className="flex items-center gap-3 py-2.5 border-b border-line text-sm">
          {i.inviter && <Avatar user={i.inviter} size={28} />}
          <span className="w-32 truncate">{i.inviter?.displayName}</span>
          <span className="font-mono flex-1">{i.code}</span>
          <span className="text-fg-3 w-20">{i.uses}{i.maxUses ? `/${i.maxUses}` : ''}</span>
          <span className="text-fg-3 w-28 hidden sm:block">{i.expiresAt ? formatLongDate(i.expiresAt) : t('Jamais')}</span>
          <button className="icon-btn hover:!text-danger" onClick={() => del(`/invites/${i.code}`).then(load)} title={t('Révoquer')}>
            <Trash2 size={16} />
          </button>
        </div>
      ))}
    </>
  );
}

function MyServerProfile({ server }: { server: Server }) {
  const me = useStore((s) => s.me!);
  const member = memberOf(server, me.id);
  const [nick, setNick] = useState(member?.nickname ?? '');
  const can = has(server.permissions, P.CHANGE_NICKNAME);
  return (
    <>
      <SectionTitle sub={t('Ton pseudo et ton apparence sur ce serveur uniquement.')}>{t('Mon profil de serveur')}</SectionTitle>
      <Field label={t('Pseudo sur le serveur')} hint={can ? undefined : t("Tu n'as pas la permission de changer de pseudo ici.")}>
        <input className="input" disabled={!can} value={nick} maxLength={32} placeholder={me.displayName} onChange={(e) => setNick(e.target.value)} />
      </Field>
      <SaveBar
        visible={nick !== (member?.nickname ?? '')}
        onReset={() => setNick(member?.nickname ?? '')}
        onSave={() => patch(`/servers/${server.id}/members/@me`, { nickname: nick }).then(() => toast(t('Pseudo mis à jour.'), 'success')).catch((e) => toast(errorMessage(e), 'error'))}
      />
    </>
  );
}

function DangerZone({ server }: { server: Server }) {
  const me = useStore((s) => s.me!.id);
  const [target, setTarget] = useState('');
  const others = server.members.filter((m) => m.userId !== me);
  return (
    <>
      <SectionTitle>{t('Propriété du serveur')}</SectionTitle>
      <div className="rounded-xl border border-line p-4 mb-6">
        <div className="font-semibold mb-1">{t('Transférer la propriété')}</div>
        <p className="text-sm text-fg-3 mb-3">{t('Le nouveau propriétaire aura tous les droits. Tu resteras membre du serveur.')}</p>
        <div className="flex gap-2">
          <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">{t('Choisir un membre…')}</option>
            {others.map((m) => (
              <option key={m.userId} value={m.userId}>
                {displayName(S(), m.userId, server.id)}
              </option>
            ))}
          </select>
          <button
            className="btn btn-danger"
            disabled={!target}
            onClick={() =>
              confirmDialog({
                title: t('Transférer la propriété'),
                body: t('Transférer « {server} » à {name} ? Tu ne pourras pas annuler cette action toi-même.', { server: server.name, name: displayName(S(), target, server.id) }),
                confirmLabel: t('Transférer'),
                danger: true,
                onConfirm: () => post(`/servers/${server.id}/transfer`, { userId: target }),
              })
            }
          >
            {t('Transférer')}
          </button>
        </div>
      </div>
      <div className="rounded-xl border border-danger/50 p-4">
        <div className="font-semibold mb-1 text-danger">{t('Supprimer le serveur')}</div>
        <p className="text-sm text-fg-3 mb-3">{t('Tous les salons, messages, rôles et fichiers seront définitivement supprimés.')}</p>
        <button
          className="btn btn-danger"
          onClick={() =>
            confirmDialog({
              title: t('Supprimer « {name} »', { name: server.name }),
              body: t('Saisis le nom du serveur pour confirmer. Cette action est irréversible.'),
              input: { label: t('Nom du serveur'), placeholder: server.name },
              confirmLabel: t('Supprimer le serveur'),
              danger: true,
              onConfirm: async (v) => {
                if (v !== server.name) throw new Error(t('Le nom saisi ne correspond pas.'));
                await del(`/servers/${server.id}`);
                closeModal();
              },
            })
          }
        >
          {t('Supprimer le serveur')}
        </button>
      </div>
    </>
  );
}

export function ServerSettings({ serverId, tab }: { serverId: string; tab?: string }) {
  const server = useStore((s) => s.servers[serverId]);
  const me = useStore((s) => s.me!.id);
  const perms = server?.permissions ?? 0;
  const [active, setActive] = useState(tab ?? (has(perms, P.MANAGE_SERVER) ? 'overview' : has(perms, P.MANAGE_ROLES) ? 'roles' : 'myprofile'));
  useEffect(() => {
    if (!server) closeModal();
  }, [server]);
  const sections = useMemo(
    () => [
      {
        title: server?.name,
        items: [
          { key: 'overview', label: t('Vue d’ensemble'), hidden: !has(perms, P.MANAGE_SERVER) },
          { key: 'roles', label: t('Rôles'), hidden: !has(perms, P.MANAGE_ROLES) },
          { key: 'emojis', label: t('Emojis'), hidden: !has(perms, P.MANAGE_EMOJIS) },
          { key: 'stickers', label: t('Stickers'), hidden: !has(perms, P.MANAGE_EMOJIS) },
          { key: 'myprofile', label: t('Mon profil de serveur') },
        ],
      },
      {
        title: t('Gestion des membres'),
        items: [
          { key: 'members', label: t('Membres') },
          { key: 'invites', label: t('Invitations'), hidden: !has(perms, P.MANAGE_SERVER) },
          { key: 'bans', label: t('Bannissements'), hidden: !has(perms, P.BAN_MEMBERS) },
        ],
      },
      ...(server?.ownerId === me ? [{ items: [{ key: 'danger', label: t('Supprimer / transférer'), danger: true }] }] : []),
    ],
    [server, perms, me],
  );
  if (!server) return null;
  return (
    <SettingsLayout sections={sections} active={active} onSelect={setActive} onClose={closeModal}>
      {active === 'overview' && <Overview server={server} />}
      {active === 'roles' && <Roles server={server} />}
      {active === 'emojis' && <Emojis server={server} kind="emoji" />}
      {active === 'stickers' && <Emojis server={server} kind="sticker" />}
      {active === 'myprofile' && <MyServerProfile server={server} />}
      {active === 'members' && <Members server={server} />}
      {active === 'invites' && <Invites server={server} />}
      {active === 'bans' && <Bans server={server} />}
      {active === 'danger' && <DangerZone server={server} />}
    </SettingsLayout>
  );
}

