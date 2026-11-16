import { desktop } from './desktop';
import { t } from './i18n';
import { sounds } from './sounds';
import { findChannel, openModal, S, setState, toast } from './store';
import { CH, type Quality } from './types';

/**
 * Moteur voix / vidéo endBuy (WebRTC, topologie maillée).
 * Chaque paire de participants partage une RTCPeerConnection avec 4 transceivers fixes :
 *   0 = micro, 1 = caméra, 2 = écran, 3 = audio de l'écran.
 * Activer / couper la caméra ou le partage d'écran utilise replaceTrack (aucune renégociation).
 * La signalisation (offres, réponses, candidats ICE) transite par la passerelle WebSocket.
 */
const KINDS = ['audio', 'camera', 'screen', 'screenAudio'] as const;
type Kind = (typeof KINDS)[number];

interface Peer {
  userId: string;
  pc: RTCPeerConnection;
  initiator: boolean;
  configured: boolean;
  pending: RTCIceCandidateInit[];
  audioEl: HTMLAudioElement;
  screenAudioEl: HTMLAudioElement;
  streams: Partial<Record<Kind, MediaStream>>;
}

export interface AVSettings {
  inputId: string;
  outputId: string;
  videoId: string;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  inputSensitivity: number; // 0..100
}

const AV_KEY = 'endbuy.av';
const VOL_KEY = 'endbuy.volumes';

export function loadAV(): AVSettings {
  const def: AVSettings = {
    inputId: 'default',
    outputId: 'default',
    videoId: '',
    noiseSuppression: true,
    echoCancellation: true,
    autoGainControl: true,
    inputSensitivity: 40,
  };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem(AV_KEY) || '{}') };
  } catch {
    return def;
  }
}
export function saveAV(av: AVSettings) {
  try {
    localStorage.setItem(AV_KEY, JSON.stringify(av));
  } catch {
    /* ignoré */
  }
}

function loadVolumes(): Record<string, { volume: number; muted: boolean }> {
  try {
    return JSON.parse(localStorage.getItem(VOL_KEY) || '{}');
  } catch {
    return {};
  }
}

const DEFAULT_QUALITY = {
  audioBitrate: 64000,
  video: { width: 1280, height: 720, fps: 30, bitrate: 1_500_000 } as Quality,
  screen: { width: 1280, height: 720, fps: 30, bitrate: 2_500_000 } as Quality,
};

class VoiceManager {
  private send: (op: string, d: unknown) => void = () => {};
  private peers = new Map<string, Peer>();
  micStream: MediaStream | null = null;
  cameraStream: MediaStream | null = null;
  screenStream: MediaStream | null = null;
  private quality = DEFAULT_QUALITY;
  private iceServers: RTCIceServer[] = [];
  private audioCtx: AudioContext | null = null;
  private analysers = new Map<string, { analyser: AnalyserNode; source: MediaStreamAudioSourceNode; data: Uint8Array<ArrayBuffer>; last: number }>();
  private speakTimer: ReturnType<typeof setInterval> | null = null;
  private rejoin: { channelId: string; serverId: string | null } | null = null;
  private volumes = loadVolumes();

  setSender(fn: (op: string, d: unknown) => void) {
    this.send = fn;
  }

  hasPeer(userId: string) {
    return this.peers.has(userId);
  }

  private bump() {
    setState((s) => void (s.rtcVersion += 1));
  }

  /* -------------------------- Entrée / sortie -------------------------- */
  async join(channelId: string, serverId: string | null) {
    const cur = S().voice;
    if (cur.channelId === channelId && !cur.connecting) return;
    if (cur.channelId) this.leave(true, false);
    setState((s) => {
      s.voice = { ...s.voice, channelId, serverId, connecting: true, video: false, screen: false, micError: null };
      if (s.incomingCall?.channelId === channelId) s.incomingCall = null;
    });
    this.ensureAudioCtx();
    await this.acquireMic();
    if (S().voice.channelId !== channelId) return;
    this.send('voice_join', { channelId });
  }

  private async acquireMic() {
    const av = loadAV();
    try {
      this.micStream?.getTracks().forEach((t) => t.stop());
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: av.inputId && av.inputId !== 'default' ? { ideal: av.inputId } : undefined,
          noiseSuppression: av.noiseSuppression,
          echoCancellation: av.echoCancellation,
          autoGainControl: av.autoGainControl,
          channelCount: 1,
        },
      });
      this.applyMicEnabled();
      const me = S().me?.id;
      if (me) this.addAnalyser(me, this.micStream);
      setState((s) => void (s.voice.micError = null));
    } catch (e) {
      this.micStream = null;
      const msg =
        (e as DOMException)?.name === 'NotAllowedError'
          ? t('Accès au micro refusé. Autorise-le pour parler.')
          : t('Aucun micro disponible. Tu peux écouter sans parler.');
      setState((s) => void (s.voice.micError = msg));
      toast(msg, 'error');
    }
  }

  onVoiceReady(d: { channelId: string; peers: string[]; iceServers: RTCIceServer[]; quality: typeof DEFAULT_QUALITY }) {
    if (S().voice.channelId !== d.channelId) return;
    this.quality = d.quality ?? DEFAULT_QUALITY;
    this.iceServers = d.iceServers?.length ? d.iceServers : S().iceServers;
    setState((s) => void (s.voice.connecting = false));
    sounds.join();
    this.reconcile();
    const v = S().voice;
    this.send('voice_state', { selfMute: v.mute || !this.micStream, selfDeaf: v.deaf, video: false, screen: false });
    this.startSpeakingLoop();
  }

  onVoiceError(d: { channelId: string; message: string }) {
    toast(d.message, 'error');
    if (S().voice.channelId === d.channelId) this.cleanup();
  }

  /** Dans une conférence, seul l'orateur émet : on coupe le micro des auditeurs. */
  private isSuppressed() {
    const s = S();
    const me = s.me?.id;
    return !!(me && s.voiceStates[me]?.suppress);
  }

  /**
   * Calcule les connexions nécessaires : tout le monde dans un salon vocal ; dans une conférence,
   * seulement les paires où au moins un participant est orateur. Le plus petit identifiant initie.
   */
  reconcile(changedUserId?: string) {
    const s = S();
    const me = s.me?.id;
    const v = s.voice;
    if (!me || !v.channelId || v.connecting) return;
    const stage = findChannel(s, v.channelId)?.type === CH.STAGE;
    const mine = s.voiceStates[me];
    const others = Object.values(s.voiceStates).filter((x) => x.channelId === v.channelId && x.userId !== me);
    const wanted = new Set(others.filter((o) => !stage || mine?.speaker || o.speaker).map((o) => o.userId));
    for (const id of wanted) if (!this.peers.has(id) && me < id) this.createPeer(id, true);
    for (const id of [...this.peers.keys()]) if (!wanted.has(id)) this.removePeer(id);
    if (changedUserId) {
      const p = this.peers.get(changedUserId);
      if (p) this.applyVolume(p);
    }
    this.applyMicEnabled();
  }

  raiseHand(raised: boolean) {
    this.send('stage_hand', { raised });
  }

  onOwnVoiceState(d: { channelId: string | null; previousChannelId?: string; forced?: boolean }) {
    const v = S().voice;
    if (d.channelId === null && !v.connecting && v.channelId && d.previousChannelId === v.channelId) {
      if (d.forced) toast(t('Tu as été déconnecté du salon vocal.'), 'info');
      this.cleanup();
    }
  }

  leave(sendLeave = true, playSound = true) {
    if (!S().voice.channelId) return;
    if (sendLeave) this.send('voice_leave', {});
    this.cleanup();
    if (playSound) sounds.leave();
  }

  /** Connexion temps réel perdue : le serveur nous a retiré du vocal, on rejoindra au retour. */
  handleDisconnect() {
    const v = S().voice;
    if (v.channelId) {
      this.rejoin = { channelId: v.channelId, serverId: v.serverId };
      this.cleanup();
    }
  }

  handleReady() {
    if (this.rejoin) {
      const r = this.rejoin;
      this.rejoin = null;
      this.join(r.channelId, r.serverId);
    }
  }

  private cleanup() {
    for (const p of this.peers.values()) this.closePeer(p);
    this.peers.clear();
    for (const st of [this.micStream, this.cameraStream, this.screenStream]) st?.getTracks().forEach((t) => t.stop());
    this.micStream = this.cameraStream = this.screenStream = null;
    for (const a of this.analysers.values()) a.source.disconnect();
    this.analysers.clear();
    if (this.speakTimer) clearInterval(this.speakTimer);
    this.speakTimer = null;
    setState((s) => {
      s.voice = { ...s.voice, channelId: null, serverId: null, connecting: false, video: false, screen: false };
      s.speaking = {};
    });
    this.bump();
  }

  /* -------------------------- Pairs -------------------------- */
  private signal(to: string, data: unknown) {
    this.send('rtc_signal', { to, data });
  }

  private localTrack(kind: Kind): MediaStreamTrack | null {
    if (kind === 'audio') return this.micStream?.getAudioTracks()[0] ?? null;
    if (kind === 'camera') return this.cameraStream?.getVideoTracks()[0] ?? null;
    if (kind === 'screen') return this.screenStream?.getVideoTracks()[0] ?? null;
    return this.screenStream?.getAudioTracks()[0] ?? null;
  }

  private createPeer(userId: string, initiator: boolean): Peer {
    const existing = this.peers.get(userId);
    if (existing) this.closePeer(existing);
    const pc = new RTCPeerConnection({ iceServers: this.iceServers.length ? this.iceServers : S().iceServers });
    const av = loadAV();
    const mkAudio = () => {
      const el = new Audio();
      el.autoplay = true;
      if (av.outputId && av.outputId !== 'default' && 'setSinkId' in el) (el as any).setSinkId(av.outputId).catch(() => {});
      return el;
    };
    const peer: Peer = { userId, pc, initiator, configured: initiator, pending: [], audioEl: mkAudio(), screenAudioEl: mkAudio(), streams: {} };
    this.applyVolume(peer);
    this.peers.set(userId, peer);

    pc.onicecandidate = (e) => {
      if (e.candidate) this.signal(userId, { candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => this.onTrack(peer, e);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' && peer.initiator) {
        pc.createOffer({ iceRestart: true })
          .then((o) => pc.setLocalDescription(o))
          .then(() => this.signal(userId, { description: pc.localDescription }))
          .catch(() => {});
      }
      this.bump();
    };

    if (initiator) {
      for (const kind of KINDS) {
        const tr = pc.addTransceiver(kind === 'audio' || kind === 'screenAudio' ? 'audio' : 'video', { direction: 'sendrecv' });
        tr.sender.replaceTrack(this.localTrack(kind)).catch(() => {});
      }
      pc.createOffer()
        .then((o) => pc.setLocalDescription(o))
        .then(() => {
          this.signal(userId, { description: pc.localDescription });
        })
        .catch((e) => console.error('[rtc] offre', e));
    }
    this.bump();
    return peer;
  }

  private closePeer(p: Peer) {
    try {
      p.pc.close();
    } catch {
      /* ignoré */
    }
    p.audioEl.srcObject = null;
    p.screenAudioEl.srcObject = null;
    const a = this.analysers.get(p.userId);
    if (a) {
      a.source.disconnect();
      this.analysers.delete(p.userId);
    }
  }

  removePeer(userId: string) {
    const p = this.peers.get(userId);
    if (p) {
      this.closePeer(p);
      this.peers.delete(userId);
      setState((s) => void delete s.speaking[userId]);
      this.bump();
    }
  }

  async onSignal(from: string, data: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) {
    if (!S().voice.channelId) return;
    let peer = this.peers.get(from);
    try {
      if (data.description) {
        if (!peer) {
          if (data.description.type !== 'offer') return;
          peer = this.createPeer(from, false);
        }
        const pc = peer.pc;
        await pc.setRemoteDescription(data.description);
        if (data.description.type === 'offer') {
          if (!peer.configured) {
            const trs = pc.getTransceivers();
            trs.forEach((tr, i) => {
              tr.direction = 'sendrecv';
              const kind = KINDS[i];
              if (kind) tr.sender.replaceTrack(this.localTrack(kind)).catch(() => {});
            });
            peer.configured = true;
          }
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.signal(from, { description: pc.localDescription });
        }
        for (const c of peer.pending.splice(0)) await pc.addIceCandidate(c).catch(() => {});
        this.applyBitrates(peer);
      } else if (data.candidate) {
        if (!peer || !peer.pc.remoteDescription) {
          if (peer) peer.pending.push(data.candidate);
          return;
        }
        await peer.pc.addIceCandidate(data.candidate).catch(() => {});
      }
    } catch (e) {
      console.error('[rtc] signalisation', e);
    }
  }

  private onTrack(peer: Peer, e: RTCTrackEvent) {
    const idx = peer.pc.getTransceivers().indexOf(e.transceiver);
    const kind = KINDS[idx];
    if (!kind) return;
    const stream = new MediaStream([e.track]);
    peer.streams[kind] = stream;
    if (kind === 'audio') {
      peer.audioEl.srcObject = stream;
      peer.audioEl.play().catch(() => {});
      this.addAnalyser(peer.userId, stream);
    } else if (kind === 'screenAudio') {
      peer.screenAudioEl.srcObject = stream;
      peer.screenAudioEl.play().catch(() => {});
    }
    e.track.onunmute = () => this.bump();
    e.track.onmute = () => this.bump();
    this.bump();
  }

  private async applyBitrates(peer: Peer) {
    const trs = peer.pc.getTransceivers();
    const targets: Record<Kind, number> = {
      audio: this.quality.audioBitrate,
      camera: this.quality.video.bitrate,
      screen: this.quality.screen.bitrate,
      screenAudio: this.quality.audioBitrate,
    };
    for (let i = 0; i < KINDS.length; i++) {
      const sender = trs[i]?.sender;
      if (!sender) continue;
      try {
        const params = sender.getParameters();
        if (!params.encodings || !params.encodings.length) params.encodings = [{}];
        params.encodings[0].maxBitrate = targets[KINDS[i]];
        if (KINDS[i] === 'screen') (params.encodings[0] as any).maxFramerate = this.quality.screen.fps;
        await sender.setParameters(params);
      } catch {
        /* certains navigateurs refusent avant la négociation complète */
      }
    }
  }

  private async updateSenders(kind: Kind) {
    const idx = KINDS.indexOf(kind);
    const track = this.localTrack(kind);
    for (const p of this.peers.values()) {
      if (!p.configured) continue;
      const tr = p.pc.getTransceivers()[idx];
      if (tr) await tr.sender.replaceTrack(track).catch(() => {});
      this.applyBitrates(p);
    }
  }

  /* -------------------------- Contrôles -------------------------- */
  private applyMicEnabled() {
    const v = S().voice;
    const suppressed = this.isSuppressed();
    this.micStream?.getAudioTracks().forEach((t) => (t.enabled = !v.mute && !v.deaf && !suppressed));
  }

  private pushState() {
    const v = S().voice;
    if (v.channelId) this.send('voice_state', { selfMute: v.mute || !this.micStream, selfDeaf: v.deaf, video: v.video, screen: v.screen });
  }

  toggleMute() {
    const v = S().voice;
    if (v.deaf) {
      setState((s) => {
        s.voice.deaf = false;
        s.voice.mute = false;
      });
    } else setState((s) => void (s.voice.mute = !s.voice.mute));
    this.applyMicEnabled();
    this.applyDeaf();
    (S().voice.mute ? sounds.mute : sounds.unmute)();
    this.pushState();
  }

  toggleDeaf() {
    setState((s) => void (s.voice.deaf = !s.voice.deaf));
    this.applyMicEnabled();
    this.applyDeaf();
    (S().voice.deaf ? sounds.mute : sounds.unmute)();
    this.pushState();
  }

  private applyDeaf() {
    for (const p of this.peers.values()) this.applyVolume(p);
  }

  getUserVolume(userId: string) {
    return this.volumes[userId] ?? { volume: 100, muted: false };
  }

  setUserVolume(userId: string, patch: Partial<{ volume: number; muted: boolean }>) {
    this.volumes[userId] = { ...this.getUserVolume(userId), ...patch };
    try {
      localStorage.setItem(VOL_KEY, JSON.stringify(this.volumes));
    } catch {
      /* ignoré */
    }
    const p = this.peers.get(userId);
    if (p) this.applyVolume(p);
    this.bump();
  }

  private applyVolume(p: Peer) {
    const v = this.getUserVolume(p.userId);
    const s = S();
    const deaf = s.voice.deaf;
    // Un auditeur de conférence n'est jamais diffusé, même si son client tente d'émettre.
    const suppressed = !!s.voiceStates[p.userId]?.suppress && findChannel(s, s.voice.channelId)?.type === CH.STAGE;
    for (const el of [p.audioEl, p.screenAudioEl]) {
      el.muted = deaf || v.muted || suppressed;
      el.volume = Math.max(0, Math.min(1, v.volume / 100));
    }
  }

  async toggleCamera() {
    const v = S().voice;
    if (!v.channelId) return;
    if (v.video) {
      this.cameraStream?.getTracks().forEach((t) => t.stop());
      this.cameraStream = null;
      await this.updateSenders('camera');
      setState((s) => void (s.voice.video = false));
    } else {
      const av = loadAV();
      const q = this.quality.video;
      try {
        this.cameraStream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: av.videoId ? { ideal: av.videoId } : undefined,
            width: { ideal: q.width },
            height: { ideal: q.height },
            frameRate: { ideal: q.fps },
          },
        });
      } catch (e) {
        toast(
          (e as DOMException)?.name === 'NotAllowedError' ? t('Accès à la caméra refusé.') : t('Aucune caméra disponible.'),
          'error',
        );
        return;
      }
      await this.updateSenders('camera');
      setState((s) => void (s.voice.video = true));
    }
    this.pushState();
    this.bump();
  }

  /** Dans l'application de bureau, on affiche d'abord notre propre sélecteur de fenêtre / écran. */
  async toggleScreen() {
    const v = S().voice;
    if (!v.channelId) return;
    if (v.screen) return this.stopScreen();
    if (desktop) openModal({ type: 'screenPicker' });
    else await this.startScreen();
  }

  async startScreen(sourceId?: string, withAudio = true) {
    const q = this.quality.screen;
    try {
      if (desktop && sourceId) await desktop.selectScreenSource(sourceId, withAudio);
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: q.width }, height: { ideal: q.height }, frameRate: { ideal: q.fps } },
        audio: withAudio,
      });
    } catch (e) {
      if ((e as DOMException)?.name !== 'NotAllowedError') toast(t('Impossible de partager l’écran.'), 'error');
      return;
    }
    const track = this.screenStream.getVideoTracks()[0];
    if (track) {
      track.contentHint = 'detail';
      track.onended = () => this.stopScreen();
    }
    await this.updateSenders('screen');
    await this.updateSenders('screenAudio');
    setState((s) => void (s.voice.screen = true));
    this.pushState();
    this.bump();
  }

  async stopScreen() {
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    await this.updateSenders('screen');
    await this.updateSenders('screenAudio');
    setState((s) => void (s.voice.screen = false));
    this.pushState();
    this.bump();
  }

  /** Change de micro en cours d'appel. */
  async reloadMic() {
    if (!S().voice.channelId) return;
    await this.acquireMic();
    await this.updateSenders('audio');
    this.pushState();
  }

  setOutputDevice(id: string) {
    for (const p of this.peers.values()) {
      for (const el of [p.audioEl, p.screenAudioEl]) if ('setSinkId' in el) (el as any).setSinkId(id).catch(() => {});
    }
  }

  getStream(userId: string, kind: 'camera' | 'screen'): MediaStream | null {
    if (userId === S().me?.id) return kind === 'camera' ? this.cameraStream : this.screenStream;
    return this.peers.get(userId)?.streams[kind] ?? null;
  }

  connectionState(userId: string): RTCPeerConnectionState | 'self' | 'none' {
    if (userId === S().me?.id) return 'self';
    return this.peers.get(userId)?.pc.connectionState ?? 'none';
  }

  /* -------------------------- Détection de parole -------------------------- */
  private ensureAudioCtx() {
    if (!this.audioCtx) {
      try {
        this.audioCtx = new AudioContext();
      } catch {
        this.audioCtx = null;
      }
    }
    if (this.audioCtx?.state === 'suspended') this.audioCtx.resume().catch(() => {});
  }

  private addAnalyser(userId: string, stream: MediaStream) {
    if (!this.audioCtx || !stream.getAudioTracks().length) return;
    const prev = this.analysers.get(userId);
    if (prev) prev.source.disconnect();
    try {
      const source = this.audioCtx.createMediaStreamSource(stream);
      const analyser = this.audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      this.analysers.set(userId, { analyser, source, data: new Uint8Array(analyser.fftSize), last: 0 });
    } catch {
      /* ignoré */
    }
  }

  private startSpeakingLoop() {
    if (this.speakTimer) return;
    this.speakTimer = setInterval(() => {
      const s = S();
      const me = s.me?.id;
      const threshold = 0.012 + (loadAV().inputSensitivity / 100) * 0.06;
      const now = Date.now();
      const next: Record<string, boolean> = {};
      for (const [uid, a] of this.analysers) {
        a.analyser.getByteTimeDomainData(a.data);
        let sum = 0;
        for (let i = 0; i < a.data.length; i++) {
          const x = (a.data[i] - 128) / 128;
          sum += x * x;
        }
        const rms = Math.sqrt(sum / a.data.length);
        const muted = uid === me ? s.voice.mute || s.voice.deaf : s.voiceStates[uid]?.selfMute || s.voiceStates[uid]?.serverMute;
        if (rms > (uid === me ? threshold : 0.015) && !muted) a.last = now;
        next[uid] = now - a.last < 350;
      }
      const changed = Object.keys(next).some((k) => !!s.speaking[k] !== next[k]) || Object.keys(s.speaking).some((k) => !(k in next));
      if (changed) setState((st) => void (st.speaking = next));
    }, 100);
  }
}

export const voice = new VoiceManager();
