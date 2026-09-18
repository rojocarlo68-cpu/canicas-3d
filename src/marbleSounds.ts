/**
 * Procedural glass/marble clack sounds via Web Audio API.
 * Three short variants + random pitch; gated by impulse + cooldown.
 * AudioContext is unlocked on first user gesture (title / drop / canvas).
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let lastPlayMs = 0;
let muted = false;
let unlockWired = false;
const COOLDOWN_MS = 55;
const MIN_IMPACT = 0.18;
/** Master bus — loud enough to hear over game ambience on laptop speakers */
const MASTER_GAIN = 0.95;

export function setMarbleAudioMuted(m: boolean): void {
  muted = m;
  if (master) master.gain.value = m ? 0 : MASTER_GAIN;
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
      master.gain.value = muted ? 0 : MASTER_GAIN;
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

/** Play a near-silent blip so mobile Safari fully unlocks the context. */
function tickUnlock(audio: AudioContext, dest: GainNode): void {
  try {
    const n = Math.max(1, Math.floor(audio.sampleRate * 0.02));
    const buf = audio.createBuffer(1, n, audio.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.0004 * Math.exp(-i / (n * 0.25));
    }
    const src = audio.createBufferSource();
    src.buffer = buf;
    const g = audio.createGain();
    g.gain.value = 0.001;
    src.connect(g);
    g.connect(dest);
    src.start();
  } catch {
    /* ignore */
  }
}

/**
 * Unlock AudioContext on first user gesture.
 * Safe to call repeatedly; resumes if suspended.
 */
export function unlockMarbleAudio(): void {
  const audio = ensureAudio();
  if (!audio || !master) return;
  if (audio.state === 'suspended') {
    void audio.resume().then(() => {
      if (ctx && master) tickUnlock(ctx, master);
    });
  } else {
    tickUnlock(audio, master);
  }
}

/** Wire once: any pointer/key/touch on the page unlocks SFX. */
export function installMarbleAudioUnlock(): void {
  if (unlockWired) return;
  unlockWired = true;
  const once = () => unlockMarbleAudio();
  const opts: AddEventListenerOptions = { capture: true, passive: true };
  window.addEventListener('pointerdown', once, opts);
  window.addEventListener('touchstart', once, opts);
  window.addEventListener('keydown', once, opts);
  window.addEventListener('click', once, opts);
}

function playBuffer(
  audio: AudioContext,
  dest: GainNode,
  variant: number,
  impact01: number,
): void {
  // Short, bright glass/marble clacks (~3 variants)
  const dur = [0.048, 0.058, 0.042][variant % 3]!;
  const sampleRate = audio.sampleRate;
  const n = Math.max(1, Math.floor(sampleRate * dur));
  const buf = audio.createBuffer(1, n, sampleRate);
  const data = buf.getChannelData(0);

  const baseFreq = [2400, 3100, 1950][variant % 3]!;
  const pitch = 0.94 + Math.random() * 0.14;
  const f0 = baseFreq * pitch;
  const noiseAmt = [0.55, 0.42, 0.62][variant % 3]!;
  const decay = [70, 58, 85][variant % 3]!;

  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-t * decay) * (1 - t / dur);
    // Transient click + two partials = readable “glass clack”
    const click = (Math.random() * 2 - 1) * noiseAmt * Math.exp(-t * 280);
    const sine = Math.sin(2 * Math.PI * f0 * t) * 0.72;
    const sine2 = Math.sin(2 * Math.PI * f0 * 1.53 * t) * 0.28;
    const sine3 = Math.sin(2 * Math.PI * f0 * 2.35 * t) * 0.12;
    data[i] = (click + sine + sine2 + sine3) * env;
  }

  const src = audio.createBufferSource();
  src.buffer = buf;
  const g = audio.createGain();
  // Louder per-hit gain (was ~0.22–0.77); now clearly audible
  const vol = 0.55 + Math.min(1, impact01) * 0.7;
  g.gain.value = vol;
  // Mild highpass so clacks cut through without boom
  const hp = audio.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 420;
  hp.Q.value = 0.7;
  src.connect(hp);
  hp.connect(g);
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
  if (audio.state === 'suspended') {
    void audio.resume();
    return; // wait until unlocked; next hit will play
  }
  lastPlayMs = now;
  const impact01 = Math.min(1.5, impactAbs / 0.95);
  const variant = Math.floor(Math.random() * 3);
  try {
    playBuffer(audio, master, variant, impact01);
  } catch {
    /* ignore audio failures */
  }
}
