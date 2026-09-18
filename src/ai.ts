import { CIRCLE_RADIUS, MARBLE_RADIUS, OUT_MARGIN, SHOT_MAX, SHOT_MIN } from './constants';
import type { MarbleEntity } from './marbles';

export type AIShotPlan = {
  dirX: number;
  dirZ: number;
  power01: number;
};

export type AIArenaMode = 'circle_out' | 'hole_in';

/**
 * Skill tiers by map level:
 * L1 easier → L2 better → L3 strongest aim / power / consistency.
 */
function skillForLevel(level: number): number {
  const lv = Math.max(1, Math.min(3, Math.floor(level)));
  if (lv <= 1) return 0.18;
  if (lv === 2) return 0.58;
  return 0.92;
}

/**
 * Pick a target among in-play field marbles and compute shot direction/power.
 * mode 'hole_in' (L3): aim to knock toward the center hole.
 * mode 'circle_out' (L1/L2): aim to knock outside the chalk circle.
 */
export function planAIShot(
  shooter: MarbleEntity,
  field: MarbleEntity[],
  level: number,
  mode: AIArenaMode = 'circle_out',
  holeRadius = MARBLE_RADIUS,
): AIShotPlan {
  const skill = skillForLevel(level);
  const noiseAmp = Math.max(0.03, 0.62 - skill * 0.58);

  const candidates: { m: MarbleEntity; score: number; tx: number; tz: number }[] = [];
  for (const m of field) {
    if (!m.active || !m.mesh.visible) continue;
    const x = m.body.position.x;
    const z = m.body.position.z;
    const dist = Math.hypot(x, z);
    if (mode === 'circle_out') {
      if (dist > CIRCLE_RADIUS + OUT_MARGIN) continue;
    } else {
      // Still in bowl and not already in hole
      if (dist > CIRCLE_RADIUS + OUT_MARGIN) continue;
      if (dist < holeRadius * 0.85) continue;
    }

    let neighbors = 0;
    for (const o of field) {
      if (o === m || !o.active) continue;
      const d = Math.hypot(o.body.position.x - x, o.body.position.z - z);
      if (d < MARBLE_RADIUS * 6) neighbors++;
    }
    const cluster = neighbors * 0.35;
    let score: number;
    if (mode === 'hole_in') {
      // Prefer marbles that can be driven toward the hole
      const towardHole = 1 - Math.min(1, dist / (CIRCLE_RADIUS + 1e-6));
      score = towardHole * 1.35 + cluster + Math.random() * (0.28 * (1 - skill));
    } else {
      const edgeFactor = dist / CIRCLE_RADIUS;
      score = edgeFactor * 1.2 + cluster + Math.random() * (0.25 * (1 - skill));
    }
    candidates.push({ m, score, tx: x, tz: z });
  }

  let tx = 0;
  let tz = 0;
  if (candidates.length > 0) {
    candidates.sort((a, b) => b.score - a.score);
    const pick = candidates[0]!;
    if (mode === 'hole_in') {
      // Aim slightly past marble toward origin (hole)
      const md = Math.hypot(pick.tx, pick.tz) || 1;
      const inPush = 0.45 + skill * 0.55;
      tx = pick.tx - (pick.tx / md) * MARBLE_RADIUS * inPush;
      tz = pick.tz - (pick.tz / md) * MARBLE_RADIUS * inPush;
    } else {
      const md = Math.hypot(pick.tx, pick.tz) || 1;
      const outPush = 0.35 + skill * 0.4;
      tx = pick.tx + (pick.tx / md) * MARBLE_RADIUS * outPush;
      tz = pick.tz + (pick.tz / md) * MARBLE_RADIUS * outPush;
    }
  }

  const sx = shooter.body.position.x;
  const sz = shooter.body.position.z;
  let dx = tx - sx;
  let dz = tz - sz;
  let len = Math.hypot(dx, dz);
  if (len < 1e-6) {
    if (mode === 'hole_in') {
      dx = -sx;
      dz = -sz;
    } else {
      dx = -sx;
      dz = -sz;
    }
    len = Math.hypot(dx, dz) || 1;
  }
  dx /= len;
  dz /= len;

  const px = -dz;
  const pz = dx;
  const nLat = (Math.random() * 2 - 1) * noiseAmp;
  const nLon = (Math.random() * 2 - 1) * noiseAmp * 0.35;
  let dirX = dx + px * nLat + dx * nLon;
  let dirZ = dz + pz * nLat + dz * nLon;
  const dlen = Math.hypot(dirX, dirZ) || 1;
  dirX /= dlen;
  dirZ /= dlen;

  const distShot = Math.hypot(tx - sx, tz - sz);
  const ideal =
    0.32 + Math.min(0.58, distShot / (CIRCLE_RADIUS * 2.2));
  // Higher skill → less power noise, slight bias toward ideal+
  const powerNoise = (Math.random() * 2 - 1) * (0.3 - skill * 0.26);
  const powerBoost = skill * 0.08;
  const power01 = Math.max(0.12, Math.min(1, ideal + powerNoise + powerBoost));

  return { dirX, dirZ, power01 };
}

export function impulseFromPower(power01: number): number {
  return SHOT_MIN + (SHOT_MAX - SHOT_MIN) * power01;
}
