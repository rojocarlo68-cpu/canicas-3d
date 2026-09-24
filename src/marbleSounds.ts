/**
 * Marble SFX: curated sample banks (clack / wood-roll / floor) with procedural fallback.
 * AudioContext unlocks on first user gesture; buffers preload after unlock.
 */

/** Master switch: false = all marble SFX no-ops (samples + procedural + wood-roll). */
export const ENABLE_MARBLE_SFX = false;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let lastPlayMs = 0;
let lastFloorPlayMs = 0;
let muted = false;
let unlockWired = false;
let unlocked = false;
let preloadStarted = false;
let samplesReady = false;

const COOLDOWN_MS = 48;
const FLOOR_COOLDOWN_MS = 140;
const MIN_IMPACT = 0.12;
const MIN_FLOOR_IMPACT = 0.28;
/** Master bus — loud enough on laptop speakers / phone */
const MASTER_GAIN = 1.0;

/** Impact (m/s) thresholds → soft / med / hard sample bank */
const SOFT_MAX = 0.35;
const MED_MAX = 0.7;

type IntensityBand = 'soft' | 'med' | 'hard';

const CLACK_FILES: Record<IntensityBand, string[]> = {
  soft: ['clack/soft-01.ogg', 'clack/soft-02.ogg', 'clack/soft-03.ogg'],
  med: ['clack/med-01.ogg', 'clack/med-02.ogg', 'clack/med-03.ogg', 'clack/med-04.ogg'],
  hard: ['clack/hard-01.ogg', 'clack/hard-02.ogg', 'clack/hard-03.ogg'],
};

const FLOOR_FILES = [
  'floor/hit-01.ogg',
  'floor/hit-02.ogg',
  'floor/hit-03.ogg',
  'floor/hit-04.ogg',
  'floor/hit-05.ogg',
  'floor/hit-06.ogg',
];

const WOOD_LOOP_FILES = ['wood-roll/loop-01.ogg', 'wood-roll/loop-02.ogg'];

const bufferCache = new Map<string, AudioBuffer>();

let woodRollSrc: AudioBufferSourceNode | null = null;
let woodRollGain: GainNode | null = null;
let woodRollActive = false;
let woodRollBufferIndex = 0;
let woodRollTarget = 0;
let woodDuckUntil = 0;

function assetUrl(rel: string): string {
  const base = (import.meta.env.BASE_URL as string) || '/';
  const b = base.endsWith('/') ? base : `${base}/`;
  return `${b}sfx/${rel.replace(/^\/+/, '')}`;
}

export function setMarbleAudioMuted(m: boolean): void {
  muted = m;
  if (master) master.gain.value = m ? 0 : MASTER_GAIN;
  if (m) stopMarbleWoodRoll(true);
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

async function decodeUrl(audio: AudioContext, rel: string): Promise<AudioBuffer | null> {
  if (bufferCache.has(rel)) return bufferCache.get(rel)!;
  try {
    const res = await fetch(assetUrl(rel));
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    const buf = await audio.decodeAudioData(ab.slice(0));
    bufferCache.set(rel, buf);
    return buf;
  } catch {
    return null;
  }
}

/** Prefetch + decode all curated banks (idempotent). */
export function preloadMarbleSfx(): void {
  if (!ENABLE_MARBLE_SFX) return;
  if (preloadStarted) return;
  const audio = ensureAudio();
  if (!audio) return;
  preloadStarted = true;
  const all = [
    ...CLACK_FILES.soft,
    ...CLACK_FILES.med,
    ...CLACK_FILES.hard,
    ...FLOOR_FILES,
    ...WOOD_LOOP_FILES,
  ];
  void Promise.all(all.map((f) => decodeUrl(audio, f))).then((bufs) => {
    const ok = bufs.filter(Boolean).length;
    samplesReady = ok > 0;
  });
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
    preloadMarbleSfx();
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

function bandForImpact(impactAbs: number): IntensityBand {
  if (impactAbs < SOFT_MAX) return 'soft';
  if (impactAbs < MED_MAX) return 'med';
  return 'hard';
}

function pickBuffer(relPaths: string[]): AudioBuffer | null {
  const loaded = relPaths
    .map((p) => bufferCache.get(p))
    .filter((b): b is AudioBuffer => !!b);
  if (!loaded.length) return null;
  return loaded[Math.floor(Math.random() * loaded.length)]!;
}

function playSample(
  audio: AudioContext,
  dest: GainNode,
  buffer: AudioBuffer,
  impact01: number,
  gainScale = 1,
): void {
  const src = audio.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = 0.92 + Math.random() * 0.16;
  const g = audio.createGain();
  const vol = (0.55 + Math.min(1, impact01) * 0.85) * gainScale;
  g.gain.value = vol;
  src.connect(g);
  g.connect(dest);
  src.start();
}

/** Procedural glass/marble clack (fallback when samples missing). */
function playProceduralClack(
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
 * Picks soft/med/hard sample by impact; falls back to procedural if unloaded.
 * @param impactAbs absolute impact velocity along contact normal (m/s)
 */
export function playMarbleClack(impactAbs: number): void {
  if (!ENABLE_MARBLE_SFX) return;
  if (muted) return;
  if (impactAbs < MIN_IMPACT) return;
  const now = performance.now();
  if (now - lastPlayMs < COOLDOWN_MS) return;
  const audio = ensureAudio();
  if (!audio || !master) return;

  const impact01 = Math.min(1.5, impactAbs / 0.85);
  const band = bandForImpact(impactAbs);
  const sample = pickBuffer(CLACK_FILES[band]);
  // Duck wood-roll bed under clacks
  woodDuckUntil = now + 90;

  const fire = () => {
    if (!ctx || !master || muted) return;
    lastPlayMs = performance.now();
    try {
      if (sample) {
        playSample(ctx, master, sample, impact01, 1);
      } else {
        playProceduralClack(ctx, master, Math.floor(Math.random() * 3), impact01);
      }
    } catch {
      /* ignore audio failures */
    }
  };

  if (audio.state === 'suspended') {
    void audio.resume().then(() => {
      unlocked = true;
      preloadMarbleSfx();
      fire();
    });
    return;
  }
  fire();
}

/**
 * L4: marble landing on room floor / tile after falling off the desk.
 */
export function playMarbleFloorHit(impactAbs: number): void {
  if (!ENABLE_MARBLE_SFX) return;
  if (muted) return;
  if (impactAbs < MIN_FLOOR_IMPACT) return;
  const now = performance.now();
  if (now - lastFloorPlayMs < FLOOR_COOLDOWN_MS) return;
  const audio = ensureAudio();
  if (!audio || !master) return;

  const impact01 = Math.min(1.4, impactAbs / 1.1);
  // Prefer louder floor samples for harder landings
  const files =
    impactAbs < 0.55
      ? FLOOR_FILES.slice(0, 3)
      : impactAbs < 0.9
        ? FLOOR_FILES.slice(2, 5)
        : FLOOR_FILES.slice(3);
  const sample = pickBuffer(files) ?? pickBuffer(FLOOR_FILES);

  const fire = () => {
    if (!ctx || !master || muted) return;
    lastFloorPlayMs = performance.now();
    try {
      if (sample) {
        playSample(ctx, master, sample, impact01, 0.95);
      } else {
        // Soft procedural thud fallback
        playProceduralClack(ctx, master, 2, impact01 * 0.7);
      }
    } catch {
      /* ignore */
    }
  };

  if (audio.state === 'suspended') {
    void audio.resume().then(() => {
      unlocked = true;
      preloadMarbleSfx();
      fire();
    });
    return;
  }
  fire();
}

function ensureWoodRollNodes(audio: AudioContext, dest: GainNode): boolean {
  if (woodRollGain && woodRollSrc) return true;
  const buf = pickBuffer(WOOD_LOOP_FILES);
  if (!buf) return false;
  try {
    const g = audio.createGain();
    g.gain.value = 0;
    g.connect(dest);
    const src = audio.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = 1;
    src.connect(g);
    src.start();
    woodRollGain = g;
    woodRollSrc = src;
    woodRollActive = true;
    woodRollBufferIndex = (woodRollBufferIndex + 1) % WOOD_LOOP_FILES.length;
    return true;
  } catch {
    return false;
  }
}

/**
 * Drive quiet looping wood-channel roll bed (L4 half-pipe).
 * @param speed01 0 = fade out / stop; ~0.15–1 = roll intensity from marble speed
 */
export function updateMarbleWoodRoll(speed01: number): void {
  if (!ENABLE_MARBLE_SFX) {
    stopMarbleWoodRoll(true);
    return;
  }
  if (muted) {
    stopMarbleWoodRoll(true);
    return;
  }
  const audio = ensureAudio();
  if (!audio || !master) return;
  if (audio.state === 'suspended') {
    woodRollTarget = 0;
    return;
  }

  const sp = Math.max(0, Math.min(1, speed01));
  woodRollTarget = sp < 0.08 ? 0 : sp;

  if (woodRollTarget <= 0) {
    if (woodRollGain) {
      const now = audio.currentTime;
      woodRollGain.gain.cancelScheduledValues(now);
      woodRollGain.gain.setTargetAtTime(0, now, 0.08);
    }
    return;
  }

  if (!ensureWoodRollNodes(audio, master)) {
    preloadMarbleSfx();
    return;
  }
  if (!woodRollGain || !woodRollSrc) return;

  const now = audio.currentTime;
  const ducked = performance.now() < woodDuckUntil ? 0.35 : 1;
  // Quiet bed under clacks — max ~0.22
  const gain = (0.04 + woodRollTarget * 0.18) * ducked;
  const rate = 0.88 + woodRollTarget * 0.28;
  woodRollGain.gain.cancelScheduledValues(now);
  woodRollGain.gain.setTargetAtTime(gain, now, 0.06);
  try {
    woodRollSrc.playbackRate.setTargetAtTime(rate, now, 0.08);
  } catch {
    woodRollSrc.playbackRate.value = rate;
  }
}

/** Stop / tear down wood-roll loop (level exit, mute, etc.). */
export function stopMarbleWoodRoll(immediate = false): void {
  woodRollTarget = 0;
  if (!woodRollGain || !woodRollSrc) {
    woodRollActive = false;
    return;
  }
  const audio = ctx;
  if (!audio || immediate) {
    try {
      woodRollSrc.stop();
    } catch {
      /* ignore */
    }
    try {
      woodRollSrc.disconnect();
      woodRollGain.disconnect();
    } catch {
      /* ignore */
    }
    woodRollSrc = null;
    woodRollGain = null;
    woodRollActive = false;
    return;
  }
  const t = audio.currentTime;
  woodRollGain.gain.cancelScheduledValues(t);
  woodRollGain.gain.setTargetAtTime(0, t, 0.05);
  const src = woodRollSrc;
  const g = woodRollGain;
  woodRollSrc = null;
  woodRollGain = null;
  woodRollActive = false;
  window.setTimeout(() => {
    try {
      src.stop();
    } catch {
      /* ignore */
    }
    try {
      src.disconnect();
      g.disconnect();
    } catch {
      /* ignore */
    }
  }, 200);
}

export function isMarbleWoodRollActive(): boolean {
  return woodRollActive && woodRollTarget > 0;
}

/** True once at least one sample buffer decoded (for diagnostics). */
export function areMarbleSamplesReady(): boolean {
  return samplesReady;
}
