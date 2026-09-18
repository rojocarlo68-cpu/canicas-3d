/**
 * Deterministic procedural unique marble designs from a seed string.
 * Same seed → same colors / swirls / flakes / glass params.
 */
import * as THREE from 'three';
import type { MarbleDesign } from './marbles';

export type ProceduralMarbleParams = {
  seed: string;
  name: string;
  baseHue: number;
  baseSat: number;
  baseLit: number;
  veinHues: number[];
  flakeCount: number;
  flakeGold: boolean;
  roughness: number;
  metalness: number;
  transmission: number;
  opacity: number;
  style: 'swirl' | 'galaxy' | 'cat' | 'solid' | 'bands';
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
  return `hsl(${Math.round(h) % 360} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
}

const NAME_A = [
  'Ópalo', 'Cobalto', 'Ámbar', 'Ónix', 'Prisma', 'Nebula', 'Rubí', 'Jade',
  'Cromo', 'Aurora', 'Eclipse', 'Perla', 'Volcán', 'Glaciar', 'Fénix', 'Sombra',
];
const NAME_B = [
  'del Desierto', 'de Medianoche', 'Dorado', 'de Espía', 'Cristalino', 'Silente',
  'Eléctrico', 'de TAMA', 'Relámpago', 'Profundo', 'Solar', 'Lunar',
];

export function randomMarbleSeed(extra = ''): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 10);
  return `tama-${t}-${r}${extra ? `-${extra}` : ''}`;
}

export function paramsFromSeed(seed: string): ProceduralMarbleParams {
  const rnd = mulberry32(hashSeed(seed));
  const styleRoll = rnd();
  const style: ProceduralMarbleParams['style'] =
    styleRoll < 0.35 ? 'swirl' :
    styleRoll < 0.55 ? 'galaxy' :
    styleRoll < 0.7 ? 'bands' :
    styleRoll < 0.85 ? 'solid' : 'cat';

  const baseHue = rnd() * 360;
  const veinCount = 3 + Math.floor(rnd() * 3);
  const veinHues: number[] = [];
  for (let i = 0; i < veinCount; i++) {
    veinHues.push((baseHue + 40 + rnd() * 140 + i * 30) % 360);
  }

  const name = `${NAME_A[Math.floor(rnd() * NAME_A.length)]} ${NAME_B[Math.floor(rnd() * NAME_B.length)]}`;

  return {
    seed,
    name,
    baseHue,
    baseSat: 0.45 + rnd() * 0.5,
    baseLit: 0.28 + rnd() * 0.35,
    veinHues,
    flakeCount: Math.floor(rnd() * 80),
    flakeGold: rnd() > 0.45,
    roughness: 0.06 + rnd() * 0.16,
    metalness: rnd() > 0.85 ? 0.35 + rnd() * 0.4 : rnd() * 0.12,
    transmission: rnd() > 0.55 ? 0.08 + rnd() * 0.22 : 0,
    opacity: 0.88 + rnd() * 0.12,
    style,
  };
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
  rnd: () => number,
): void {
  for (let i = 0; i < count; i++) {
    const x = rnd() * s;
    const y = rnd() * s;
    const r = 0.6 + rnd() * 1.8;
    ctx.fillStyle = gold
      ? `rgba(255, ${180 + Math.floor(rnd() * 60)}, 80, ${0.35 + rnd() * 0.5})`
      : `rgba(255,255,255,${0.25 + rnd() * 0.55})`;
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
    drawFlakes(ctx, s, 120 + p.flakeCount, p.flakeGold, rnd);
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
    const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.02, s / 2, s / 2, s * 0.28);
    g.addColorStop(0, '#fffde7');
    g.addColorStop(0.35, hsl(p.baseHue, 0.9, 0.55));
    g.addColorStop(0.7, hsl(p.veinHues[0] ?? p.baseHue, 0.85, 0.35));
    g.addColorStop(1, '#1a0500');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(s / 2, s / 2, s * 0.16, s * 0.4, 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a0500';
    ctx.beginPath();
    ctx.ellipse(s / 2, s / 2, s * 0.035, s * 0.32, 0.15, 0, Math.PI * 2);
    ctx.fill();
  } else if (p.style === 'bands') {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    for (let i = -s; i < s * 2; i += 18 + rnd() * 10) {
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
  } else {
    // swirl
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    for (let v = 0; v < p.veinHues.length; v++) {
      ctx.strokeStyle = hsl(p.veinHues[v]!, 0.7, 0.65);
      ctx.lineWidth = 5 + v * 3;
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.72;
      ctx.beginPath();
      const cx = s * (0.32 + v * 0.1);
      const cy = s * (0.38 + (v % 2) * 0.12);
      for (let t = 0; t <= 1; t += 0.02) {
        const a = t * Math.PI * 2.6 + v * 1.1 + rnd() * 0.02;
        const r = s * (0.08 + t * 0.38);
        const x = cx + Math.cos(a) * r + Math.sin(t * 9 + v) * s * 0.03;
        const y = cy + Math.sin(a * 0.9) * r * 0.85 + Math.cos(t * 7) * s * 0.02;
        if (t === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  if (p.style !== 'galaxy' && p.flakeCount > 0) {
    drawFlakes(ctx, s, p.flakeCount, p.flakeGold, rnd);
  }
  addSheen(ctx, s);
}

export function createDesignFromSeed(seed: string): MarbleDesign {
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
