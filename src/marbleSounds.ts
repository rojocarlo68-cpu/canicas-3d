/**
 * Procedural glass/marble clack sounds via Web Audio API.
 * Three short variants + random pitch; gated by impulse + cooldown.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let lastPlayMs = 0;
let muted = false;
const COOLDOWN_MS = 70;
const MIN_IMPACT = 0.28;

export function setMarbleAudioMuted(m: boolean): void {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.55;
}

export function isMarbleAudioMuted(): boolean {
  return muted;
}

function ensureAudio(): AudioContext | null {
  try {
    if (!ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.55;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    return ctx;
  } catch {
    return null;
  }
}

/** Soften first user gesture unlock from UI clicks. */
export function unlockMarbleAudio(): void {
  ensureAudio();
}

function playBuffer(
  audio: AudioContext,
  dest: GainNode,
  variant: number,
  impact01: number,
): void {
  const dur = 0.055 + variant * 0.012;
  const sampleRate = audio.sampleRate;
  const n = Math.max(1, Math.floor(sampleRate * dur));
  const buf = audio.createBuffer(1, n, sampleRate);
  const data = buf.getChannelData(0);

  const baseFreq = [1850, 2200, 1550][variant % 3]!;
  const pitch = 0.92 + Math.random() * 0.18;
  const f0 = baseFreq * pitch;
  const noiseAmt = [0.35, 0.28, 0.42][variant % 3]!;

  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-t * (55 + variant * 8)) * (1 - t / dur);
    const sine = Math.sin(2 * Math.PI * f0 * t) * 0.55;
    const sine2 = Math.sin(2 * Math.PI * f0 * 1.67 * t) * 0.18;
    const noise = (Math.random() * 2 - 1) * noiseAmt * Math.exp(-t * 120);
    data[i] = (sine + sine2 + noise) * env;
  }

  const src = audio.createBufferSource();
  src.buffer = buf;
  const g = audio.createGain();
  const vol = 0.22 + Math.min(0.78, impact01) * 0.55;
  g.gain.value = vol;
  src.connect(g);
  g.connect(dest);
  src.start();
}

/**
 * Play a marble–marble clack if impact is strong enough and cooldown allows.
 * @param impactAbs absolute impact velocity along contact normal (m/s)
 */
export function playMarbleClack(impactAbs: number): void {
  if (muted) return;
  if (impactAbs < MIN_IMPACT) return;
  const now = performance.now();
  if (now - lastPlayMs < COOLDOWN_MS) return;
  const audio = ensureAudio();
  if (!audio || !master) return;
  lastPlayMs = now;
  const impact01 = Math.min(1.4, impactAbs / 1.1);
  const variant = Math.floor(Math.random() * 3);
  try {
    playBuffer(audio, master, variant, impact01);
  } catch {
    /* ignore audio failures */
  }
}
