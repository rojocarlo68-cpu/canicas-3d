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
let unlocked = false;
const COOLDOWN_MS = 48;
const MIN_IMPACT = 0.12;
/** Master bus — loud enough on laptop speakers / phone */
const MASTER_GAIN = 1.0;

export function setMarbleAudioMuted(m: boolean): void {
  muted = m;
  if (master) master.gain.value = m ? 0 : MASTER_GAIN;
}

export function isMarbleAudioMuted(): boolean {
  return muted;
}

export function isMarbleAudioUnlocked(): boolean {
  return unlocked && !!ctx && ctx.state === 'running';
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
    return ctx;
  } catch {
    return null;
  }
}

/** Audible unlock chirp so Safari/Chrome mark the context as user-activated. */
function tickUnlock(audio: AudioContext, dest: GainNode): void {
  try {
    const n = Math.max(1, Math.floor(audio.sampleRate * 0.03));
    const buf = audio.createBuffer(1, n, audio.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const t = i / audio.sampleRate;
      data[i] = Math.sin(2 * Math.PI * 880 * t) * Math.exp(-t * 90) * 0.04;
    }
    const src = audio.createBufferSource();
    src.buffer = buf;
    const g = audio.createGain();
    g.gain.value = 0.35;
    src.connect(g);
    g.connect(dest);
    src.start();
    unlocked = true;
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
  const run = () => {
    if (ctx && master) tickUnlock(ctx, master);
  };
  if (audio.state === 'suspended') {
    void audio.resume().then(run).catch(() => {
      /* ignore */
    });
  } else {
    run();
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
  const dur = [0.072, 0.088, 0.065][variant % 3]!;
  const sampleRate = audio.sampleRate;
  const n = Math.max(1, Math.floor(sampleRate * dur));
  const buf = audio.createBuffer(1, n, sampleRate);
  const data = buf.getChannelData(0);

  const baseFreq = [2650, 3400, 2100][variant % 3]!;
  const pitch = 0.92 + Math.random() * 0.16;
  const f0 = baseFreq * pitch;
  const noiseAmt = [0.72, 0.55, 0.8][variant % 3]!;
  const decay = [55, 48, 62][variant % 3]!;

  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-t * decay) * (1 - t / dur);
    const click = (Math.random() * 2 - 1) * noiseAmt * Math.exp(-t * 320);
    const sine = Math.sin(2 * Math.PI * f0 * t) * 0.78;
    const sine2 = Math.sin(2 * Math.PI * f0 * 1.53 * t) * 0.32;
    const sine3 = Math.sin(2 * Math.PI * f0 * 2.35 * t) * 0.14;
    data[i] = (click + sine + sine2 + sine3) * env;
  }

  const src = audio.createBufferSource();
  src.buffer = buf;
  const g = audio.createGain();
  const vol = 0.85 + Math.min(1, impact01) * 0.95;
  g.gain.value = vol;
  const hp = audio.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 280;
  hp.Q.value = 0.65;
  const peak = audio.createBiquadFilter();
  peak.type = 'peaking';
  peak.frequency.value = 2200;
  peak.Q.value = 1.1;
  peak.gain.value = 4.5;
  src.connect(hp);
  hp.connect(peak);
  peak.connect(g);
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

  const impact01 = Math.min(1.5, impactAbs / 0.85);
  const variant = Math.floor(Math.random() * 3);
  const fire = () => {
    if (!ctx || !master || muted) return;
    lastPlayMs = performance.now();
    try {
      playBuffer(ctx, master, variant, impact01);
    } catch {
      /* ignore audio failures */
    }
  };

  if (audio.state === 'suspended') {
    // Critical: do NOT skip the hit — resume then play so first clash is audible
    void audio.resume().then(() => {
      unlocked = true;
      fire();
    });
    return;
  }
  fire();
}
