/** Sons de l'interface générés à la volée (Web Audio) : aucun fichier audio externe. */
let ctx: AudioContext | null = null;
function ac() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(freqs: number[], duration: number, opts: { type?: OscillatorType; gain?: number; gap?: number } = {}) {
  try {
    const c = ac();
    const { type = 'sine', gain = 0.08, gap = 0 } = opts;
    let t = c.currentTime;
    for (const f of freqs) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      o.connect(g).connect(c.destination);
      o.start(t);
      o.stop(t + duration + 0.02);
      t += duration * 0.6 + gap;
    }
  } catch {
    /* ignoré */
  }
}

export const sounds = {
  message: () => tone([880, 1320], 0.12, { gain: 0.06 }),
  mention: () => tone([660, 990, 1320], 0.12, { gain: 0.07 }),
  join: () => tone([523, 784], 0.14, { gain: 0.06, type: 'triangle' }),
  leave: () => tone([784, 523], 0.14, { gain: 0.06, type: 'triangle' }),
  mute: () => tone([440], 0.08, { gain: 0.05, type: 'square' }),
  unmute: () => tone([660], 0.08, { gain: 0.05, type: 'square' }),
};

let ringTimer: ReturnType<typeof setInterval> | null = null;
export function startRinging() {
  stopRinging();
  const ring = () => tone([740, 988, 740, 988], 0.16, { gain: 0.07, gap: 0.02 });
  ring();
  ringTimer = setInterval(ring, 2200);
}
export function stopRinging() {
  if (ringTimer) clearInterval(ringTimer);
  ringTimer = null;
}
