/**
 * Deterministic procedural unique marble designs from a seed string.
 * Same seed → same colors / swirls / flakes / glass params.
 */
import * as THREE from 'three';
import { createCollabDesign, type MarbleDesign } from './marbles';
import { COLLAB_MARBLE_SEED } from './save';

export type MarbleStyle =
  | 'swirl'
  | 'galaxy'
  | 'cat'
  | 'solid'
  | 'bands'
  | 'nebula'
  | 'oilslick'
  | 'crackle'
  | 'mist'
  | 'lattice'
  | 'pearl'
  | 'lava'
  | 'ice';

export type ProceduralMarbleParams = {
  seed: string;
  name: string;
  baseHue: number;
  baseSat: number;
  baseLit: number;
  veinHues: number[];
  flakeCount: number;
  flakeGold: boolean;
  flakeSize: number;
  roughness: number;
  metalness: number;
  transmission: number;
  opacity: number;
  style: MarbleStyle;
  swirlCount: number;
  swirlThickness: number;
  bandAngle: number;
  bandWidth: number;
  catSlitWidth: number;
  catSlitTilt: number;
  catOuterScale: number;
};

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hsl(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  return `hsl(${Math.round(hh)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
}

function hueDist(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return Math.min(d, 360 - d);
}

const NAME_A = [
  'Ópalo', 'Cobalto', 'Ámbar', 'Ónix', 'Prisma', 'Nebula', 'Rubí', 'Jade',
  'Cromo', 'Aurora', 'Eclipse', 'Perla', 'Volcán', 'Glaciar', 'Fénix', 'Sombra',
  'Cristal', 'Mirage', 'Tormenta', 'Cometa', 'Iris', 'Obsidiana', 'Coral', 'Nube',
];
const NAME_B = [
  'del Desierto', 'de Medianoche', 'Dorado', 'de Espía', 'Cristalino', 'Silente',
  'Eléctrico', 'de TAMA', 'Relámpago', 'Profundo', 'Solar', 'Lunar',
  'de Niebla', 'Ardiente', 'Etéreo', 'de Espejo',
];

/** Style label keys for i18n (style.swirl, etc.). */
export function styleLabelKey(style: MarbleStyle): string {
  return `style.${style}`;
}

/**
 * Weighted style pick — rares appear, swirl no longer dominates.
 * Approx: swirl 14%, galaxy 10%, bands 10%, solid 8%, cat 8%,
 * nebula 9%, oilslick 8%, crackle 7%, mist 7%, lattice 6%, pearl 5%, lava 4%, ice 4%.
 */
function pickStyle(rnd: () => number): MarbleStyle {
  const r = rnd();
  if (r < 0.14) return 'swirl';
  if (r < 0.24) return 'galaxy';
  if (r < 0.34) return 'bands';
  if (r < 0.42) return 'solid';
  if (r < 0.5) return 'cat';
  if (r < 0.59) return 'nebula';
  if (r < 0.67) return 'oilslick';
  if (r < 0.74) return 'crackle';
  if (r < 0.81) return 'mist';
  if (r < 0.87) return 'lattice';
  if (r < 0.92) return 'pearl';
  if (r < 0.96) return 'lava';
  return 'ice';
}

export function randomMarbleSeed(extra = ''): string {
  const t = Date.now().toString(36);
  const r1 = Math.random().toString(36).slice(2, 12);
  const r2 = Math.random().toString(36).slice(2, 10);
  const perf =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? Math.floor(performance.now() * 1000).toString(36)
      : Math.floor(Math.random() * 1e9).toString(36);
  const entropy = (Math.random() * 0xffffffff) >>> 0;
  return `tama-${t}-${r1}-${r2}-${perf}-${entropy.toString(36)}${extra ? `-${extra}` : ''}`;
}

export function paramsFromSeed(seed: string): ProceduralMarbleParams {
  const rnd = mulberry32(hashSeed(seed));
  const style = pickStyle(rnd);

  // Wider hue / sat / lit spans
  let baseHue = rnd() * 360;
  const veinCount = 2 + Math.floor(rnd() * 5); // 2–6
  const veinHues: number[] = [];
  for (let i = 0; i < veinCount; i++) {
    // Complementary / analogous / wild offsets
    const spread = rnd() < 0.35 ? 20 + rnd() * 50 : 60 + rnd() * 160;
    veinHues.push((baseHue + spread + i * (25 + rnd() * 40)) % 360);
  }

  const name = `${NAME_A[Math.floor(rnd() * NAME_A.length)]} ${NAME_B[Math.floor(rnd() * NAME_B.length)]}`;

  // Style-tinted defaults for glass / flakes
  let baseSat = 0.28 + rnd() * 0.68;
  let baseLit = 0.18 + rnd() * 0.48;
  let flakeCount = Math.floor(rnd() * 140);
  let flakeGold = rnd() > 0.42;
  let flakeSize = 0.4 + rnd() * 2.6;
  let roughness = 0.04 + rnd() * 0.28;
  let metalness = rnd() > 0.78 ? 0.28 + rnd() * 0.55 : rnd() * 0.18;
  let transmission = rnd() > 0.5 ? 0.05 + rnd() * 0.38 : 0;
  let opacity = 0.78 + rnd() * 0.22;
  let swirlCount = 2 + Math.floor(rnd() * 5);
  let swirlThickness = 3 + rnd() * 14;
  let bandAngle = rnd() * Math.PI;
  let bandWidth = 10 + rnd() * 28;
  let catSlitWidth = 0.02 + rnd() * 0.05;
  let catSlitTilt = -0.35 + rnd() * 0.7;
  let catOuterScale = 0.12 + rnd() * 0.12;

  if (style === 'galaxy') {
    baseLit = 0.06 + rnd() * 0.16;
    baseSat = 0.25 + rnd() * 0.45;
    flakeCount = 80 + Math.floor(rnd() * 160);
    transmission = rnd() * 0.12;
  } else if (style === 'cat') {
    baseSat = 0.08 + rnd() * 0.35;
    baseLit = 0.72 + rnd() * 0.2;
    flakeCount = Math.floor(rnd() * 30);
    opacity = 0.92 + rnd() * 0.08;
  } else if (style === 'nebula') {
    baseSat = 0.5 + rnd() * 0.45;
    baseLit = 0.12 + rnd() * 0.28;
    flakeCount = 40 + Math.floor(rnd() * 100);
    transmission = 0.08 + rnd() * 0.25;
  } else if (style === 'oilslick') {
    metalness = 0.45 + rnd() * 0.45;
    roughness = 0.05 + rnd() * 0.18;
    flakeCount = 20 + Math.floor(rnd() * 60);
  } else if (style === 'crackle') {
    metalness = 0.2 + rnd() * 0.5;
    flakeGold = rnd() > 0.3;
    flakeCount = 30 + Math.floor(rnd() * 90);
  } else if (style === 'mist') {
    baseSat = 0.15 + rnd() * 0.4;
    baseLit = 0.45 + rnd() * 0.35;
    opacity = 0.7 + rnd() * 0.25;
    transmission = 0.12 + rnd() * 0.35;
    flakeCount = Math.floor(rnd() * 40);
  } else if (style === 'lattice') {
    baseSat = 0.35 + rnd() * 0.5;
    flakeCount = Math.floor(rnd() * 50);
  } else if (style === 'pearl') {
    baseSat = 0.08 + rnd() * 0.28;
    baseLit = 0.62 + rnd() * 0.28;
    metalness = 0.15 + rnd() * 0.35;
    roughness = 0.08 + rnd() * 0.2;
    transmission = 0.05 + rnd() * 0.2;
    flakeCount = 10 + Math.floor(rnd() * 40);
  } else if (style === 'lava') {
    baseHue = 5 + rnd() * 45; // warm bias kept via overwrite after hue roll — re-roll veins
    baseSat = 0.7 + rnd() * 0.28;
    baseLit = 0.22 + rnd() * 0.35;
    metalness = 0.05 + rnd() * 0.25;
    flakeGold = true;
    flakeCount = 25 + Math.floor(rnd() * 70);
  } else if (style === 'ice') {
    baseHue = 180 + rnd() * 60;
    baseSat = 0.2 + rnd() * 0.45;
    baseLit = 0.55 + rnd() * 0.35;
    transmission = 0.2 + rnd() * 0.4;
    opacity = 0.72 + rnd() * 0.22;
    roughness = 0.04 + rnd() * 0.14;
    flakeCount = 15 + Math.floor(rnd() * 55);
    flakeGold = false;
  }

  // Lava re-seeds vein hues toward warm (after style branch mutated baseHue)
  if (style === 'lava') {
    for (let i = 0; i < veinHues.length; i++) {
      veinHues[i] = (baseHue + 10 + rnd() * 50 + i * 15) % 360;
    }
  }
  if (style === 'ice') {
    for (let i = 0; i < veinHues.length; i++) {
      veinHues[i] = (180 + rnd() * 80 + i * 20) % 360;
    }
  }

  return {
    seed,
    name,
    baseHue,
    baseSat,
    baseLit,
    veinHues,
    flakeCount,
    flakeGold,
    flakeSize,
    roughness,
    metalness,
    transmission,
    opacity,
    style,
    swirlCount,
    swirlThickness,
    bandAngle,
    bandWidth,
    catSlitWidth,
    catSlitTilt,
    catOuterScale,
  };
}

/** Soft uniqueness: same style + close hue + similar flakeCount → too similar. */
export function isTooSimilar(
  a: ProceduralMarbleParams,
  b: ProceduralMarbleParams,
): boolean {
  if (a.style !== b.style) return false;
  if (hueDist(a.baseHue, b.baseHue) > 28) return false;
  if (Math.abs(a.flakeCount - b.flakeCount) > 35) return false;
  return true;
}

/**
 * Generate a seed that is soft-unique vs existing collection seeds.
 * Rerolls a few times; falls back to last candidate.
 */
export function generateUniqueMarbleSeed(
  existingSeeds: string[],
  extra = '',
  maxAttempts = 8,
): string {
  const existing = existingSeeds
    .filter((s) => s !== COLLAB_MARBLE_SEED)
    .map((s) => {
      try {
        return paramsFromSeed(s);
      } catch {
        return null;
      }
    })
    .filter((p): p is ProceduralMarbleParams => !!p);

  let last = randomMarbleSeed(extra);
  for (let i = 0; i < maxAttempts; i++) {
    const seed = randomMarbleSeed(`${extra}-r${i}`);
    last = seed;
    const p = paramsFromSeed(seed);
    const clash = existing.some((e) => isTooSimilar(p, e));
    if (!clash) return seed;
  }
  return last;
}

function addSheen(ctx: CanvasRenderingContext2D, s: number): void {
  const hl = ctx.createRadialGradient(s * 0.32, s * 0.28, s * 0.02, s * 0.35, s * 0.32, s * 0.42);
  hl.addColorStop(0, 'rgba(255,255,255,0.55)');
  hl.addColorStop(0.35, 'rgba(255,255,255,0.12)');
  hl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hl;
  ctx.fillRect(0, 0, s, s);
  const rim = ctx.createRadialGradient(s / 2, s / 2, s * 0.28, s / 2, s / 2, s * 0.52);
  rim.addColorStop(0, 'rgba(0,0,0,0)');
  rim.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, s, s);
}

function drawFlakes(
  ctx: CanvasRenderingContext2D,
  s: number,
  count: number,
  gold: boolean,
  sizeMul: number,
  rnd: () => number,
): void {
  for (let i = 0; i < count; i++) {
    const x = rnd() * s;
    const y = rnd() * s;
    const r = (0.5 + rnd() * sizeMul) * (0.7 + rnd() * 0.6);
    if (gold) {
      const g = 140 + Math.floor(rnd() * 90);
      const b = 40 + Math.floor(rnd() * 80);
      ctx.fillStyle = `rgba(255, ${g}, ${b}, ${0.3 + rnd() * 0.55})`;
    } else if (rnd() > 0.7) {
      // Tinted flecks
      ctx.fillStyle = `hsla(${Math.floor(rnd() * 360)}, 70%, 70%, ${0.25 + rnd() * 0.5})`;
    } else {
      ctx.fillStyle = `rgba(255,255,255,${0.22 + rnd() * 0.55})`;
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawParams(ctx: CanvasRenderingContext2D, s: number, p: ProceduralMarbleParams): void {
  const rnd = mulberry32(hashSeed(p.seed + ':draw'));
  const base = hsl(p.baseHue, p.baseSat, p.baseLit);

  if (p.style === 'solid') {
    const g = ctx.createRadialGradient(s * 0.35, s * 0.32, s * 0.05, s / 2, s / 2, s * 0.55);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.22, hsl(p.baseHue, p.baseSat * 0.7, Math.min(0.85, p.baseLit + 0.35)));
    g.addColorStop(0.7, base);
    g.addColorStop(1, hsl(p.baseHue, p.baseSat, Math.max(0.08, p.baseLit - 0.2)));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  } else if (p.style === 'galaxy') {
    ctx.fillStyle = hsl(p.baseHue, 0.35, 0.08);
    ctx.fillRect(0, 0, s, s);
    drawFlakes(ctx, s, 120 + p.flakeCount, p.flakeGold, p.flakeSize, rnd);
    for (let i = 0; i < 4; i++) {
      ctx.strokeStyle = hsl(p.veinHues[i % p.veinHues.length]!, 0.6, 0.55);
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 8 + i * 4;
      ctx.beginPath();
      ctx.arc(s * (0.3 + i * 0.1), s * 0.5, s * (0.15 + i * 0.08), 0, Math.PI * 1.4);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else if (p.style === 'cat') {
    ctx.fillStyle = hsl(p.baseHue, 0.15, 0.88);
    ctx.fillRect(0, 0, s, s);
    const ox = p.catOuterScale;
    const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.02, s / 2, s / 2, s * (ox + 0.14));
    g.addColorStop(0, '#fffde7');
    g.addColorStop(0.35, hsl(p.baseHue, 0.9, 0.55));
    g.addColorStop(0.7, hsl(p.veinHues[0] ?? p.baseHue, 0.85, 0.35));
    g.addColorStop(1, '#1a0500');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(s / 2, s / 2, s * ox, s * (ox * 2.4), p.catSlitTilt, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a0500';
    ctx.beginPath();
    ctx.ellipse(s / 2, s / 2, s * p.catSlitWidth, s * (ox * 2), p.catSlitTilt, 0, Math.PI * 2);
    ctx.fill();
  } else if (p.style === 'bands') {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    ctx.save();
    ctx.translate(s / 2, s / 2);
    ctx.rotate(p.bandAngle);
    ctx.translate(-s / 2, -s / 2);
    const step = p.bandWidth;
    for (let i = -s; i < s * 2; i += step + rnd() * (step * 0.4)) {
      const vh = p.veinHues[Math.floor(rnd() * p.veinHues.length)]!;
      ctx.fillStyle = hsl(vh, 0.55, 0.75);
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.bezierCurveTo(i + 30, s * 0.35, i - 10, s * 0.65, i + 20, s);
      ctx.lineTo(i + 12, s);
      ctx.bezierCurveTo(i + 2, s * 0.65, i + 40, s * 0.35, i + 12, 0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  } else if (p.style === 'nebula') {
    ctx.fillStyle = hsl(p.baseHue, 0.4, 0.07);
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 7; i++) {
      const vh = p.veinHues[i % p.veinHues.length]!;
      const cx = rnd() * s;
      const cy = rnd() * s;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * (0.18 + rnd() * 0.28));
      g.addColorStop(0, hsl(vh, 0.75, 0.55));
      g.addColorStop(0.45, hsl(vh, 0.55, 0.28));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.35 + rnd() * 0.4;
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }
    ctx.globalAlpha = 1;
    drawFlakes(ctx, s, p.flakeCount, p.flakeGold, p.flakeSize * 0.7, rnd);
  } else if (p.style === 'oilslick') {
    const g = ctx.createLinearGradient(0, 0, s, s);
    for (let i = 0; i <= 6; i++) {
      const vh = (p.baseHue + i * 50 + rnd() * 20) % 360;
      g.addColorStop(i / 6, hsl(vh, 0.75, 0.35 + (i % 2) * 0.15));
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 5; i++) {
      ctx.strokeStyle = hsl((p.baseHue + i * 70) % 360, 0.85, 0.6);
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 6 + rnd() * 14;
      ctx.beginPath();
      ctx.moveTo(rnd() * s, 0);
      ctx.bezierCurveTo(rnd() * s, s * 0.4, rnd() * s, s * 0.6, rnd() * s, s);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else if (p.style === 'crackle') {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    // Foil underlayer
    for (let i = 0; i < 12; i++) {
      const vh = p.veinHues[i % p.veinHues.length]!;
      ctx.fillStyle = hsl(vh, 0.6, 0.55);
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.arc(rnd() * s, rnd() * s, s * (0.08 + rnd() * 0.15), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = p.flakeGold ? 'rgba(255,210,100,0.75)' : 'rgba(220,240,255,0.65)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 28; i++) {
      let x = rnd() * s;
      let y = rnd() * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let j = 0; j < 4; j++) {
        x += (rnd() - 0.5) * s * 0.18;
        y += (rnd() - 0.5) * s * 0.18;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  } else if (p.style === 'mist') {
    const g = ctx.createRadialGradient(s * 0.4, s * 0.35, s * 0.05, s / 2, s / 2, s * 0.55);
    g.addColorStop(0, hsl(p.baseHue, p.baseSat * 0.5, Math.min(0.92, p.baseLit + 0.3)));
    g.addColorStop(0.5, base);
    g.addColorStop(1, hsl(p.veinHues[0] ?? p.baseHue, p.baseSat * 0.4, Math.max(0.15, p.baseLit - 0.15)));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 8; i++) {
      const cx = rnd() * s;
      const cy = rnd() * s;
      const cloud = ctx.createRadialGradient(cx, cy, 0, cx, cy, s * (0.12 + rnd() * 0.2));
      cloud.addColorStop(0, 'rgba(255,255,255,0.35)');
      cloud.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = cloud;
      ctx.fillRect(0, 0, s, s);
    }
  } else if (p.style === 'lattice') {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = hsl(p.veinHues[0] ?? p.baseHue, 0.65, 0.7);
    ctx.lineWidth = 2 + rnd() * 2;
    ctx.globalAlpha = 0.55;
    const step = 14 + rnd() * 18;
    for (let x = 0; x < s; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + s * 0.08, s);
      ctx.stroke();
    }
    for (let y = 0; y < s; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(s, y + s * 0.06);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Nodes
    for (let i = 0; i < 18; i++) {
      ctx.fillStyle = hsl(p.veinHues[i % p.veinHues.length]!, 0.7, 0.75);
      ctx.beginPath();
      ctx.arc(rnd() * s, rnd() * s, 1.5 + rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (p.style === 'pearl') {
    const g = ctx.createRadialGradient(s * 0.38, s * 0.32, s * 0.04, s / 2, s / 2, s * 0.52);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.25, hsl(p.baseHue, p.baseSat * 0.4, 0.85));
    g.addColorStop(0.55, hsl((p.baseHue + 40) % 360, p.baseSat * 0.5, 0.7));
    g.addColorStop(0.85, base);
    g.addColorStop(1, hsl(p.baseHue, p.baseSat, Math.max(0.25, p.baseLit - 0.2)));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    // Soft iridescent rings
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = hsl((p.baseHue + i * 60) % 360, 0.45, 0.75);
      ctx.globalAlpha = 0.22;
      ctx.lineWidth = 10 + i * 6;
      ctx.beginPath();
      ctx.arc(s * 0.45, s * 0.42, s * (0.15 + i * 0.1), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else if (p.style === 'lava') {
    ctx.fillStyle = hsl(p.baseHue, 0.85, 0.12);
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 9; i++) {
      const vh = p.veinHues[i % p.veinHues.length]!;
      const g = ctx.createRadialGradient(
        rnd() * s,
        rnd() * s,
        0,
        rnd() * s,
        rnd() * s,
        s * (0.1 + rnd() * 0.22),
      );
      g.addColorStop(0, hsl(vh, 0.95, 0.65));
      g.addColorStop(0.4, hsl(vh, 0.9, 0.4));
      g.addColorStop(1, 'rgba(40,0,0,0)');
      ctx.globalAlpha = 0.55 + rnd() * 0.4;
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }
    ctx.globalAlpha = 1;
    // Hot cracks
    ctx.strokeStyle = 'rgba(255,200,60,0.7)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 10; i++) {
      let x = rnd() * s;
      let y = rnd() * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let j = 0; j < 5; j++) {
        x += (rnd() - 0.5) * s * 0.2;
        y += rnd() * s * 0.12;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  } else if (p.style === 'ice') {
    const g = ctx.createLinearGradient(0, 0, s, s);
    g.addColorStop(0, hsl(p.baseHue, p.baseSat * 0.5, 0.9));
    g.addColorStop(0.5, base);
    g.addColorStop(1, hsl((p.baseHue + 30) % 360, p.baseSat, 0.35));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(200,240,255,0.55)';
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 16; i++) {
      const cx = rnd() * s;
      const cy = rnd() * s;
      const len = s * (0.08 + rnd() * 0.18);
      const ang = rnd() * Math.PI;
      ctx.beginPath();
      ctx.moveTo(cx - Math.cos(ang) * len, cy - Math.sin(ang) * len);
      ctx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
      ctx.stroke();
      // Secondary facet
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(ang + 1.2) * len * 0.5, cy + Math.sin(ang + 1.2) * len * 0.5);
      ctx.stroke();
    }
  } else {
    // swirl — keep classic look, wider count/thickness from params
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    const veins = Math.max(p.veinHues.length, p.swirlCount);
    for (let v = 0; v < veins; v++) {
      const vh = p.veinHues[v % p.veinHues.length]!;
      ctx.strokeStyle = hsl(vh, 0.7, 0.65);
      ctx.lineWidth = p.swirlThickness * (0.55 + (v % 3) * 0.25);
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.72;
      ctx.beginPath();
      const cx = s * (0.28 + (v % 4) * 0.12);
      const cy = s * (0.34 + (v % 2) * 0.14);
      for (let t = 0; t <= 1; t += 0.02) {
        const a = t * Math.PI * (2.2 + (v % 3) * 0.35) + v * 1.1 + rnd() * 0.02;
        const r = s * (0.07 + t * 0.4);
        const x = cx + Math.cos(a) * r + Math.sin(t * 9 + v) * s * 0.03;
        const y = cy + Math.sin(a * 0.9) * r * 0.85 + Math.cos(t * 7) * s * 0.02;
        if (t === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  if (p.style !== 'galaxy' && p.style !== 'nebula' && p.flakeCount > 0) {
    drawFlakes(ctx, s, p.flakeCount, p.flakeGold, p.flakeSize, rnd);
  }
  addSheen(ctx, s);
}

export function createDesignFromSeed(seed: string): MarbleDesign {
  if (seed === COLLAB_MARBLE_SEED) return createCollabDesign();
  const p = paramsFromSeed(seed);
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  drawParams(ctx, 256, p);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;

  const material = new THREE.MeshPhysicalMaterial({
    map: tex,
    roughness: p.roughness,
    metalness: p.metalness,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    reflectivity: 0.55,
    envMapIntensity: 1.05,
    transparent: p.transmission > 0 || p.opacity < 0.99,
    opacity: p.opacity,
    transmission: p.transmission,
    thickness: p.transmission > 0 ? 0.4 : 0,
    ior: 1.5,
  });

  return { id: `proc-${seed}`, name: p.name, material };
}

/** Paint a flat circular preview of a seeded marble into a canvas. */
export function paintSeedPreview(canvas: HTMLCanvasElement, seed: string): void {
  if (seed === COLLAB_MARBLE_SEED) {
    const design = createCollabDesign();
    const map = design.material.map;
    const ctx = canvas.getContext('2d')!;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (map && map instanceof THREE.CanvasTexture) {
      const src = map.image as HTMLCanvasElement;
      ctx.save();
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, w * 0.42, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(src, 0, 0, w, h);
      ctx.restore();
    }
    const hl = ctx.createRadialGradient(w * 0.35, h * 0.3, 1, w * 0.35, h * 0.3, w * 0.2);
    hl.addColorStop(0, 'rgba(255,255,255,0.8)');
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hl;
    ctx.beginPath();
    ctx.arc(w * 0.35, h * 0.3, w * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,229,255,0.65)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.42, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }
  const p = paramsFromSeed(seed);
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const off = document.createElement('canvas');
  off.width = 256;
  off.height = 256;
  drawParams(off.getContext('2d')!, 256, p);
  ctx.save();
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, w * 0.42, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(off, 0, 0, w, h);
  ctx.restore();
  const hl = ctx.createRadialGradient(w * 0.35, h * 0.3, 1, w * 0.35, h * 0.3, w * 0.2);
  hl.addColorStop(0, 'rgba(255,255,255,0.8)');
  hl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hl;
  ctx.beginPath();
  ctx.arc(w * 0.35, h * 0.3, w * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,224,138,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, w * 0.42, 0, Math.PI * 2);
  ctx.stroke();
}
