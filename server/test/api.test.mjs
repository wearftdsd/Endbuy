// Tests d'intégration endBuy : démarre un vrai serveur (PostgreSQL embarqué) et teste l'API + la passerelle temps réel.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { WebSocket } from 'ws';

process.env.ENDBUY_EMBEDDED = '1';
const { startServer } = await import('../dist/endbuy-server.mjs');

let srv;
let base;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'endbuy-test-'));

class Client {
  constructor(name) {
    this.name = name;
    this.cookie = '';
    this.events = [];
    this.waiters = [];
  }
  async req(method, url, body, { csrf = true } = {}) {
    const headers = {};
    if (csrf) headers['X-Requested-With'] = 'endBuy';
    if (this.cookie) headers.cookie = this.cookie;
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(base + url, { method, headers, body: payload });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) {
      const [kv] = c.split(';');
      if (kv.startsWith('endbuy_session=')) this.cookie = kv.endsWith('=') ? '' : kv;
    }
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, body: json, headers: res.headers };
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(base.replace('http', 'ws') + '/ws', { headers: { cookie: this.cookie, origin: base } });
      this.ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        this.events.push(msg);
        if (msg.t === 'READY') resolve(msg.d);
        for (const w of [...this.waiters]) {
          if (w.t === msg.t && w.pred(msg.d)) {
            this.waiters.splice(this.waiters.indexOf(w), 1);
            w.resolve(msg.d);
          }
        }
      });
      this.ws.on('error', reject);
      this.ws.on('unexpected-response', (_req, res) => reject(new Error('ws ' + res.statusCode)));
    });
  }
  waitFor(t, pred = () => true, timeout = 4000) {
    const existing = this.events.find((e) => e.t === t && pred(e.d) && !e.used);
    if (existing) {
      existing.used = true;
      return Promise.resolve(existing.d);
    }
    return new Promise((resolve, reject) => {
      const w = { t, pred, resolve };
      this.waiters.push(w);
      setTimeout(() => reject(new Error(`${this.name}: délai dépassé en attendant ${t}`)), timeout);
    });
  }
  send(op, d) {
    this.ws.send(JSON.stringify({ op, d }));
  }
  clearEvents() {
    this.events = [];
  }
}

function totp(secret, offset = 0) {
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0;
  const out = [];
  for (const ch of secret) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const h = crypto.createHmac('sha1', Buffer.from(out)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, '0');
}

const alice = new Client('alice');
const bob = new Client('bob');
const carol = new Client('carol');
let serverId, generalId, voiceId, aliceRecovery;

before(async () => {
  srv = await startServer({ port: 0, host: '127.0.0.1', dataDir, clientDir: null, log: false, databaseUrl: process.env.TEST_DATABASE_URL || null, uploadStorage: process.env.TEST_UPLOAD_STORAGE === 'database' ? 'database' : 'disk' });
  base = srv.url;
});
after(async () => {
  for (const c of [alice, bob, carol]) c.ws?.close();
  await srv.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('Authentification', () => {
  test('inscription sans e-mail ni téléphone + Nitro Lifetime automatique', async () => {
    const r = await alice.req('POST', '/api/auth/register', { username: 'alice', password: 'motdepasse-solide-1', avatarPreset: 3 });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.match(r.body.user.id, /^\d{19}$/);
    assert.equal(r.body.user.premium.plan, 'nitro_lifetime');
    assert.ok(r.body.user.badges.includes('nitro'));
    assert.equal(r.body.user.limits.maxUploadBytes, 500 * 1024 * 1024);
    assert.equal(r.body.recoveryCodes.length, 10);
    aliceRecovery = r.body.recoveryCodes;
    assert.ok(alice.cookie);
    assert.equal((await bob.req('POST', '/api/auth/register', { username: 'bob', password: 'bob-password-42' })).status, 201);
    assert.equal((await carol.req('POST', '/api/auth/register', { username: 'carol', password: 'carol-password-42' })).status, 201);
  });

  test('pseudonyme unique, mot de passe faible refusé', async () => {
    const dup = await new Client('x').req('POST', '/api/auth/register', { username: 'ALICE', password: 'autre-mot-de-passe' });
    assert.equal(dup.status, 409);
    const weak = await new Client('x').req('POST', '/api/auth/register', { username: 'dave', password: '123' });
    assert.equal(weak.status, 400);
  });

  test('protection CSRF', async () => {
    const r = await alice.req('PATCH', '/api/users/@me', { bio: 'x' }, { csrf: false });
    assert.equal(r.status, 403);
  });

  test('connexion / mauvais mot de passe', async () => {
    const c = new Client('tmp');
    assert.equal((await c.req('POST', '/api/auth/login', { username: 'bob', password: 'faux-mot-de-passe' })).status, 401);
    const ok = await c.req('POST', '/api/auth/login', { username: 'Bob', password: 'bob-password-42' });
    assert.equal(ok.status, 200);
    assert.equal((await c.req('GET', '/api/auth/me')).body.user.username, 'bob');
    const sessions = await c.req('GET', '/api/auth/sessions');
    assert.equal(sessions.body.length, 2);
    assert.equal((await c.req('POST', '/api/auth/logout', {})).status, 200);
    assert.equal((await c.req('GET', '/api/auth/me')).status, 401);
  });

  test('le statut Nitro ne peut pas être falsifié par le client', async () => {
    const r = await alice.req('PATCH', '/api/users/@me', { premium: null, limits: { maxUploadBytes: 1 }, bio: 'Salut !' });
    assert.equal(r.status, 200);
    assert.equal(r.body.user.premium.plan, 'nitro_lifetime');
    assert.equal(r.body.user.bio, 'Salut !');
    assert.equal(r.body.user.limits.maxUploadBytes, 500 * 1024 * 1024);
  });
});

describe('Serveurs, rôles et permissions', () => {
  test('création de serveur avec salons et rôles par défaut', async () => {
    const r = await alice.req('POST', '/api/servers', { name: 'Le QG' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    serverId = r.body.id;
    assert.equal(r.body.roles.length, 3);
    generalId = r.body.channels.find((c) => c.type === 0).id;
    voiceId = r.body.channels.find((c) => c.type === 2).id;
    assert.ok(generalId && voiceId);
  });

  test('connexion temps réel (READY)', async () => {
    const ready = await alice.connect();
    assert.equal(ready.user.username, 'alice');
    assert.equal(ready.servers.length, 1);
    await bob.connect();
    await carol.connect();
  });

  test('invitation et arrivée de membres', async () => {
    const inv = await alice.req('POST', `/api/servers/${serverId}/invites`, { maxUses: 0 });
    assert.equal(inv.status, 201);
    const preview = await new Client('anon').req('GET', `/api/invites/${inv.body.code}`);
    assert.equal(preview.body.server.name, 'Le QG');
    assert.equal((await bob.req('POST', `/api/invites/${inv.body.code}`, {})).status, 200);
    const sync = await bob.waitFor('SERVER_SYNC', (d) => d.server.id === serverId);
    assert.ok(sync.server.channels.some((c) => c.id === generalId));
    assert.equal((await carol.req('POST', `/api/invites/${inv.body.code}`, {})).status, 200);
    await alice.waitFor('MESSAGE_CREATE', (m) => m.type === 1 && m.author.username === 'carol');
  });

  test('salon privé réservé à un rôle', async () => {
    const role = await alice.req('POST', `/api/servers/${serverId}/roles`, { name: 'VIP', color: '#FFB224' });
    assert.equal(role.status, 201);
    const ch = await alice.req('POST', `/api/servers/${serverId}/channels`, { name: 'Coin VIP', type: 0, private: true, roleIds: [role.body.id] });
    assert.equal(ch.status, 201);
    assert.equal((await bob.req('GET', `/api/channels/${ch.body.id}/messages`)).status, 404);
    const bobId = (await bob.req('GET', '/api/auth/me')).body.user.id;
    assert.equal((await alice.req('PATCH', `/api/servers/${serverId}/members/${bobId}`, { roles: [role.body.id] })).status, 200);
    assert.equal((await bob.req('GET', `/api/channels/${ch.body.id}/messages`)).status, 200);
    const sync = await bob.waitFor('SERVER_SYNC', (d) => d.server.channels.some((c) => c.name === 'coin-vip'));
    assert.ok(sync);
  });

  test('hiérarchie : un membre ne peut pas expulser le propriétaire', async () => {
    const aliceId = (await alice.req('GET', '/api/auth/me')).body.user.id;
    const r = await bob.req('DELETE', `/api/servers/${serverId}/members/${aliceId}`);
    assert.equal(r.status, 403);
  });

  test('expulsion puis bannissement', async () => {
    const carolId = (await carol.req('GET', '/api/auth/me')).body.user.id;
    assert.equal((await alice.req('DELETE', `/api/servers/${serverId}/members/${carolId}`)).status, 200);
    await carol.waitFor('SERVER_DELETE', (d) => d.id === serverId && d.reason === 'kicked');
    assert.equal((await alice.req('PUT', `/api/servers/${serverId}/bans/${carolId}`, { reason: 'test' })).status, 200);
    const inv = await alice.req('POST', `/api/servers/${serverId}/invites`, {});
    assert.equal((await carol.req('POST', `/api/invites/${inv.body.code}`, {})).status, 403);
    const bans = await alice.req('GET', `/api/servers/${serverId}/bans`);
    assert.equal(bans.body[0].user.username, 'carol');
  });
});

describe('Messagerie', () => {
  let msgId;
  test('message instantané reçu en temps réel', async () => {
    const r = await bob.req('POST', `/api/channels/${generalId}/messages`, { content: 'Salut tout le monde 👋' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    msgId = r.body.id;
    const ev = await alice.waitFor('MESSAGE_CREATE', (m) => m.id === msgId);
    assert.equal(ev.content, 'Salut tout le monde 👋');
  });

  test('indicateur de saisie', async () => {
    bob.send('typing', { channelId: generalId });
    const ev = await alice.waitFor('TYPING_START', (d) => d.channelId === generalId);
    assert.ok(ev.userId);
  });

  test('réponse, réaction, modification, épingle, suppression', async () => {
    const reply = await alice.req('POST', `/api/channels/${generalId}/messages`, { content: 'Bienvenue !', replyToId: msgId });
    assert.equal(reply.body.replyTo.id, msgId);
    assert.equal((await alice.req('PUT', `/api/channels/${generalId}/messages/${msgId}/reactions/${encodeURIComponent('🔥')}`)).status, 200);
    await bob.waitFor('MESSAGE_REACTION_ADD', (d) => d.messageId === msgId && d.emoji === '🔥');
    const edit = await bob.req('PATCH', `/api/channels/${generalId}/messages/${msgId}`, { content: 'Salut (modifié)' });
    assert.ok(edit.body.editedAt);
    assert.equal((await alice.req('PATCH', `/api/channels/${generalId}/messages/${msgId}`, { content: 'pirate' })).status, 403);
    assert.equal((await alice.req('PUT', `/api/channels/${generalId}/pins/${msgId}`)).status, 200);
    const pins = await bob.req('GET', `/api/channels/${generalId}/pins`);
    assert.equal(pins.body[0].id, msgId);
    const hist = await bob.req('GET', `/api/channels/${generalId}/messages?limit=50`);
    assert.ok(hist.body.length >= 3);
    assert.equal((await bob.req('DELETE', `/api/channels/${generalId}/messages/${reply.body.id}`)).status, 403);
    assert.equal((await alice.req('DELETE', `/api/channels/${generalId}/messages/${reply.body.id}`)).status, 200);
    await bob.waitFor('MESSAGE_DELETE', (d) => d.id === reply.body.id);
  });

  test('recherche de messages', async () => {
    const r = await alice.req('GET', `/api/servers/${serverId}/search?q=modifi`);
    assert.equal(r.body.total, 1);
  });

  test('envoi de fichiers (image + fichier non affichable)', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    const fd = new FormData();
    fd.append('content', 'Regarde ça');
    fd.append('files', new Blob([png], { type: 'image/png' }), 'image.png');
    fd.append('files', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'page.html');
    const r = await bob.req('POST', `/api/channels/${generalId}/messages`, fd);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.attachments.length, 2);
    const img = await fetch(base + r.body.attachments[0].url);
    assert.equal(img.headers.get('content-type'), 'image/png');
    const html = await fetch(base + r.body.attachments[1].url);
    assert.equal(html.headers.get('content-type'), 'application/octet-stream');
    assert.equal(html.headers.get('content-disposition'), 'attachment');
  });
});

describe('Amis et messages privés', () => {
  test('demande d’ami, acceptation, MP et groupe', async () => {
    assert.equal((await bob.req('POST', '/api/users/@me/relationships', { username: 'carol' })).status, 200);
    const req = await carol.waitFor('RELATIONSHIP_ADD', (d) => d.relationship.type === 3);
    assert.equal((await carol.req('PUT', `/api/users/@me/relationships/${req.relationship.id}`, { type: 1 })).status, 200);
    await bob.waitFor('RELATIONSHIP_ADD', (d) => d.relationship.type === 1);
    const carolId = (await carol.req('GET', '/api/auth/me')).body.user.id;
    const dm = await bob.req('POST', '/api/users/@me/channels', { recipientId: carolId });
    assert.equal(dm.status, 200);
    const m = await bob.req('POST', `/api/channels/${dm.body.id}/messages`, { content: 'Coucou en privé' });
    assert.equal(m.status, 201);
    await carol.waitFor('MESSAGE_CREATE', (x) => x.id === m.body.id);
    // Alice ne voit pas ce MP
    assert.equal((await alice.req('GET', `/api/channels/${dm.body.id}/messages`)).status, 404);
    // Groupe (amis uniquement)
    const aliceId = (await alice.req('GET', '/api/auth/me')).body.user.id;
    assert.equal((await bob.req('POST', '/api/users/@me/channels', { recipientIds: [carolId, aliceId], group: true })).status, 403);
    const g = await bob.req('POST', '/api/users/@me/channels', { recipientIds: [carolId], group: true, name: 'Les potes' });
    assert.equal(g.body.type, 3);
  });

  test('blocage', async () => {
    const carolId = (await carol.req('GET', '/api/auth/me')).body.user.id;
    const bobId = (await bob.req('GET', '/api/auth/me')).body.user.id;
    assert.equal((await carol.req('PUT', `/api/users/@me/relationships/${bobId}`, { type: 2 })).status, 200);
    const dm = await bob.req('POST', '/api/users/@me/channels', { recipientId: carolId });
    const m = await bob.req('POST', `/api/channels/${dm.body.id}/messages`, { content: 'tu es là ?' });
    assert.equal(m.status, 403);
  });
});

describe('Voix / vidéo (signalisation WebRTC)', () => {
  test('rejoindre un salon vocal et relayer la signalisation', async () => {
    alice.send('voice_join', { channelId: voiceId });
    const ready = await alice.waitFor('VOICE_READY', (d) => d.channelId === voiceId);
    assert.deepEqual(ready.peers, []);
    assert.equal(ready.quality.audioBitrate, 128000);
    bob.send('voice_join', { channelId: voiceId });
    const ready2 = await bob.waitFor('VOICE_READY', (d) => d.channelId === voiceId);
    assert.equal(ready2.peers.length, 1);
    const aliceId = ready2.peers[0];
    bob.send('rtc_signal', { to: aliceId, data: { description: { type: 'offer', sdp: 'v=0' } } });
    const sig = await alice.waitFor('RTC_SIGNAL');
    assert.equal(sig.data.description.type, 'offer');
    bob.send('voice_state', { selfMute: true, video: true });
    const st = await alice.waitFor('VOICE_STATE_UPDATE', (d) => d.selfMute === true && d.video === true);
    assert.ok(st);
    bob.send('voice_leave', {});
    await alice.waitFor('VOICE_STATE_UPDATE', (d) => d.channelId === null);
  });

  test('appel privé : sonnerie', async () => {
    const carolId = (await carol.req('GET', '/api/auth/me')).body.user.id;
    const aliceId = (await alice.req('GET', '/api/auth/me')).body.user.id;
    await alice.req('POST', '/api/users/@me/relationships', { username: 'carol' });
    await carol.req('PUT', `/api/users/@me/relationships/${aliceId}`, { type: 1 });
    const dm = await alice.req('POST', '/api/users/@me/channels', { recipientId: carolId });
    alice.send('voice_join', { channelId: dm.body.id });
    const ring = await carol.waitFor('CALL_RING', (d) => d.channelId === dm.body.id);
    assert.equal(ring.callerId, aliceId);
  });
});

describe('Événements et conférences', () => {
  let stageId, eventId, bobId;
  test('création d’un salon de conférence et d’un événement', async () => {
    bobId = (await bob.req('GET', '/api/auth/me')).body.user.id;
    const st = await alice.req('POST', `/api/servers/${serverId}/channels`, { name: 'Conférence', type: 5 });
    assert.equal(st.status, 201, JSON.stringify(st.body));
    stageId = st.body.id;
    const external = await alice.req('POST', `/api/servers/${serverId}/events`, {
      name: 'Sortie ciné',
      startsAt: new Date(Date.now() + 3600_000).toISOString(),
      location: 'Cinéma du centre',
    });
    assert.equal(external.status, 400, 'un événement « ailleurs » exige une fin');
    const ev = await alice.req('POST', `/api/servers/${serverId}/events`, {
      name: 'Live du vendredi',
      description: 'On parle des nouveautés',
      startsAt: new Date(Date.now() + 3600_000).toISOString(),
      channelId: stageId,
    });
    assert.equal(ev.status, 201, JSON.stringify(ev.body));
    eventId = ev.body.id;
    await bob.waitFor('EVENT_UPDATE', (d) => d.event.id === eventId);
    const denied = await bob.req('POST', `/api/servers/${serverId}/events`, { name: 'x', startsAt: new Date(Date.now() + 3600_000).toISOString(), channelId: stageId });
    assert.equal(denied.status, 403, 'un simple membre ne peut pas créer d’événement');
  });

  test('intéressé, démarrage et notification', async () => {
    const r = await bob.req('PUT', `/api/servers/${serverId}/events/${eventId}/users/@me`);
    assert.ok(r.body.interestedIds.includes(bobId));
    const start = await alice.req('PATCH', `/api/servers/${serverId}/events/${eventId}`, { status: 2 });
    assert.equal(start.body.status, 2);
    const started = await bob.waitFor('EVENT_STARTED', (d) => d.event.id === eventId);
    assert.equal(started.event.name, 'Live du vendredi');
    const sync = await bob.waitFor('SERVER_SYNC', (d) => d.server.channels.some((c) => c.id === stageId && c.topic === 'Live du vendredi'));
    assert.ok(sync.server.events.some((e) => e.id === eventId));
  });

  test('conférence : auditeur, main levée, orateur', async () => {
    alice.send('voice_join', { channelId: stageId });
    const aliceState = await bob.waitFor('VOICE_STATE_UPDATE', (d) => d.channelId === stageId && d.userId !== bobId);
    assert.equal(aliceState.speaker, false, 'on entre en auditeur');
    assert.equal(aliceState.suppress, true);
    bob.send('voice_join', { channelId: stageId });
    await bob.waitFor('VOICE_READY', (d) => d.channelId === stageId);
    bob.send('stage_hand', { raised: true });
    const hand = await alice.waitFor('VOICE_STATE_UPDATE', (d) => d.userId === bobId && d.requestToSpeak);
    assert.ok(hand.requestToSpeak > 0);
    assert.equal((await bob.req('PATCH', `/api/servers/${serverId}/stage/${aliceState.userId}`, { speaker: true })).status, 403);
    assert.equal((await alice.req('PATCH', `/api/servers/${serverId}/stage/${bobId}`, { speaker: true })).status, 200);
    const promoted = await alice.waitFor('VOICE_STATE_UPDATE', (d) => d.userId === bobId && d.speaker === true);
    assert.equal(promoted.suppress, false);
    assert.equal(promoted.requestToSpeak, null);
    assert.equal((await bob.req('PATCH', `/api/servers/${serverId}/stage/@me`, { speaker: false })).status, 200);
    await alice.waitFor('VOICE_STATE_UPDATE', (d) => d.userId === bobId && d.speaker === false);
    bob.send('voice_leave', {});
    alice.send('voice_leave', {});
  });

  test('fin de l’événement', async () => {
    const end = await alice.req('PATCH', `/api/servers/${serverId}/events/${eventId}`, { status: 3 });
    assert.equal(end.body.status, 3);
    assert.ok(end.body.endsAt);
    const again = await alice.req('PATCH', `/api/servers/${serverId}/events/${eventId}`, { status: 2 });
    assert.equal(again.status, 400, 'un événement terminé ne peut pas redémarrer');
  });
});

describe('Sécurité du compte', () => {
  test('double authentification (TOTP)', async () => {
    const setup = await alice.req('POST', '/api/auth/2fa/setup', { password: 'motdepasse-solide-1' });
    assert.equal(setup.status, 200);
    const en = await alice.req('POST', '/api/auth/2fa/enable', { code: totp(setup.body.secret) });
    assert.equal(en.status, 200, JSON.stringify(en.body));
    const c = new Client('tmp');
    const need = await c.req('POST', '/api/auth/login', { username: 'alice', password: 'motdepasse-solide-1' });
    assert.equal(need.body.code, 'MFA_REQUIRED');
    const bad = await c.req('POST', '/api/auth/login', { username: 'alice', password: 'motdepasse-solide-1', code: '000000' });
    assert.equal(bad.status, 401);
    const ok = await c.req('POST', '/api/auth/login', { username: 'alice', password: 'motdepasse-solide-1', code: aliceRecovery[0] });
    assert.equal(ok.status, 200);
  });

  test('récupération de compte par code', async () => {
    const c = new Client('tmp');
    const reused = await c.req('POST', '/api/auth/recover', { username: 'alice', recoveryCode: aliceRecovery[0], newPassword: 'nouveau-mdp-123' });
    assert.equal(reused.status, 401, 'un code utilisé ne doit pas être réutilisable');
    const r = await c.req('POST', '/api/auth/recover', { username: 'alice', recoveryCode: aliceRecovery[1].toLowerCase(), newPassword: 'nouveau-mdp-123' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.remainingCodes, 8);
    assert.equal((await alice.req('GET', '/api/auth/me')).status, 401, 'les anciennes sessions sont révoquées');
  });

  test('limitation des tentatives de connexion', async () => {
    const c = new Client('brute');
    let last;
    for (let i = 0; i < 12; i++) last = await c.req('POST', '/api/auth/login', { username: 'carol', password: 'mauvais-' + i });
    assert.equal(last.status, 429);
  });
});
