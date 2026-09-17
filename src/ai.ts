import { CIRCLE_RADIUS, MARBLE_RADIUS, OUT_MARGIN, SHOT_MAX, SHOT_MIN } from './constants';
import type { MarbleEntity } from './marbles';

export type AIShotPlan = {
  dirX: number;
  dirZ: number;
  power01: number;
};

/**
 * Pick a target among in-circle field marbles and compute shot direction/power.
 * Higher level → better aim, better power estimate, less randomness.
 */
export function planAIShot(
  shooter: MarbleEntity,
  field: MarbleEntity[],
  level: number,
): AIShotPlan {
  const lv = Math.max(1, level);
  // Skill: 0 at lvl1-ish → approaches 1 as level grows
  const skill = 1 - Math.exp(-0.35 * (lv - 1));
  const noiseAmp = Math.max(0.04, 0.55 - skill * 0.5);

  const candidates: { m: MarbleEntity; score: number; tx: number; tz: number }[] = [];
  for (const m of field) {
    if (!m.active || !m.mesh.visible) continue;
    const x = m.body.position.x;
    const z = m.body.position.z;
    const dist = Math.hypot(x, z);
    if (dist > CIRCLE_RADIUS + OUT_MARGIN) continue;

    // Prefer near-edge marbles and clusters (nearby neighbors)
    const edgeFactor = dist / CIRCLE_RADIUS;
    let neighbors = 0;
    for (const o of field) {
      if (o === m || !o.active) continue;
      const d = Math.hypot(o.body.position.x - x, o.body.position.z - z);
      if (d < MARBLE_RADIUS * 6) neighbors++;
    }
    const cluster = neighbors * 0.35;
    const score = edgeFactor * 1.2 + cluster + Math.random() * (0.25 * (1 - skill));
    candidates.push({ m, score, tx: x, tz: z });
  }

  let tx = 0;
  let tz = 0;
  if (candidates.length > 0) {
    candidates.sort((a, b) => b.score - a.score);
    const pick = candidates[0]!;
    // Aim slightly past marble toward outside for knock-out
    const md = Math.hypot(pick.tx, pick.tz) || 1;
    const outPush = 0.35 + skill * 0.4;
    tx = pick.tx + (pick.tx / md) * MARBLE_RADIUS * outPush;
    tz = pick.tz + (pick.tz / md) * MARBLE_RADIUS * outPush;
  }

  const sx = shooter.body.position.x;
  const sz = shooter.body.position.z;
  let dx = tx - sx;
  let dz = tz - sz;
  let len = Math.hypot(dx, dz);
  if (len < 1e-6) {
    // Fallback: toward center
    dx = -sx;
    dz = -sz;
    len = Math.hypot(dx, dz) || 1;
  }
  dx /= len;
  dz /= len;

  // Aim noise perpendicular + along
  const px = -dz;
  const pz = dx;
  const nLat = (Math.random() * 2 - 1) * noiseAmp;
  const nLon = (Math.random() * 2 - 1) * noiseAmp * 0.35;
  let dirX = dx + px * nLat + dx * nLon;
  let dirZ = dz + pz * nLat + dz * nLon;
  const dlen = Math.hypot(dirX, dirZ) || 1;
  dirX /= dlen;
  dirZ /= dlen;

  // Ideal power scales with distance; skill tightens around ideal
  const distShot = Math.hypot(tx - sx, tz - sz);
  const ideal =
    0.35 + Math.min(0.55, distShot / (CIRCLE_RADIUS * 2.2));
  const powerNoise = (Math.random() * 2 - 1) * (0.28 - skill * 0.22);
  const power01 = Math.max(0.12, Math.min(1, ideal + powerNoise));

  return { dirX, dirZ, power01 };
}

export function impulseFromPower(power01: number): number {
  return SHOT_MIN + (SHOT_MAX - SHOT_MIN) * power01;
}
