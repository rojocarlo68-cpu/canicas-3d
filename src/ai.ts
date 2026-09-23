import { CIRCLE_RADIUS, MARBLE_RADIUS, OUT_MARGIN, SHOT_MAX, SHOT_MIN } from './constants';
import { L4_MAT_HALF } from './officeDesk';
import type { MarbleEntity } from './marbles';

export type AIShotPlan = {
  dirX: number;
  dirZ: number;
  power01: number;
};

export type AIArenaMode = 'circle_out' | 'hole_in' | 'channel_out';

/**
 * Skill tiers by map level:
 * L1 easier → L2 better → L3 strongest aim / power / consistency.
 * L4: high skill + strong edge-safety bias (avoid yeeting own shooter off desk).
 */
function skillForLevel(level: number): number {
  const lv = Math.max(1, Math.min(4, Math.floor(level)));
  if (lv <= 1) return 0.44;
  if (lv === 2) return 0.70;
  if (lv === 3) return 0.94;
  return 0.92; // L4 — accurate but safety-weighted
}

/**
 * Pick a target among in-play field marbles and compute shot direction/power.
 * mode 'hole_in' (L3): aim to knock toward the center hole.
 * mode 'circle_out' (L1/L2): aim to knock outside the chalk circle.
 * mode 'channel_out' (L4): push field marbles toward W/N/E channels while keeping
 *   the AI shooter safely on the playmat (strongly avoid desk edges / south open side).
 */
export function planAIShot(
  shooter: MarbleEntity,
  field: MarbleEntity[],
  level: number,
  mode: AIArenaMode = 'circle_out',
  holeRadius = MARBLE_RADIUS,
): AIShotPlan {
  const skill = skillForLevel(level);
  const noiseAmp = Math.max(0.022, 0.42 - skill * 0.42);
  const matSafe = L4_MAT_HALF * 0.72; // keep AI marble comfortably inside mat

  const candidates: { m: MarbleEntity; score: number; tx: number; tz: number }[] = [];
  for (const m of field) {
    if (!m.active || !m.mesh.visible) continue;
    const x = m.body.position.x;
    const z = m.body.position.z;
    const dist = Math.hypot(x, z);
    if (mode === 'circle_out') {
      if (dist > CIRCLE_RADIUS + OUT_MARGIN) continue;
    } else if (mode === 'hole_in') {
      if (dist > CIRCLE_RADIUS + OUT_MARGIN) continue;
      if (dist < holeRadius * 0.85) continue;
    } else {
      // channel_out: still on/near mat
      if (Math.abs(x) > L4_MAT_HALF * 1.15 || Math.abs(z) > L4_MAT_HALF * 1.15) continue;
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
      const towardHole = 1 - Math.min(1, dist / (CIRCLE_RADIUS + 1e-6));
      score = towardHole * 1.35 + cluster + Math.random() * (0.28 * (1 - skill));
    } else if (mode === 'channel_out') {
      // Prefer marbles nearer W/N/E edges (channels); slight south bias is OK (tilt)
      // but strongly prefer targets that don't require aiming toward south open edge.
      const toWest = Math.max(0, -x) / (L4_MAT_HALF + 1e-6);
      const toEast = Math.max(0, x) / (L4_MAT_HALF + 1e-6);
      const toNorth = Math.max(0, -z) / (L4_MAT_HALF + 1e-6);
      const channelReach = Math.max(toWest, toEast, toNorth) * 1.45;
      const southPenalty = Math.max(0, z) / (L4_MAT_HALF + 1e-6) * 0.55;
      score =
        channelReach +
        cluster -
        southPenalty +
        Math.random() * (0.22 * (1 - skill));
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
      const md = Math.hypot(pick.tx, pick.tz) || 1;
      const inPush = 0.45 + skill * 0.55;
      tx = pick.tx - (pick.tx / md) * MARBLE_RADIUS * inPush;
      tz = pick.tz - (pick.tz / md) * MARBLE_RADIUS * inPush;
    } else if (mode === 'channel_out') {
      // Push toward nearest channel (W/N/E) — never invent a south channel
      const toW = Math.abs(-L4_MAT_HALF - pick.tx);
      const toE = Math.abs(L4_MAT_HALF - pick.tx);
      const toN = Math.abs(-L4_MAT_HALF - pick.tz);
      const nearest = Math.min(toW, toE, toN);
      let ox = 0;
      let oz = 0;
      if (nearest === toN) oz = -1;
      else if (nearest === toW) ox = -1;
      else ox = 1;
      const outPush = 0.55 + skill * 0.55;
      tx = pick.tx + ox * MARBLE_RADIUS * outPush;
      tz = pick.tz + oz * MARBLE_RADIUS * outPush;
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
    } else if (mode === 'channel_out') {
      // Default: nudge north into channel, not south off desk
      dx = -sx * 0.2;
      dz = -1;
    } else {
      dx = -sx;
      dz = -sz;
    }
    len = Math.hypot(dx, dz) || 1;
  }
  dx /= len;
  dz /= len;

  // L4 safety: if the planned follow-through would carry the shooter near/off the mat
  // edge (esp. south), bias aim more laterally toward mat center and cut power.
  let safetyCut = 0;
  if (mode === 'channel_out') {
    const look = 0.55 + skill * 0.35; // estimated travel of shooter after contact
    const predX = sx + dx * look * L4_MAT_HALF;
    const predZ = sz + dz * look * L4_MAT_HALF;
    const edgeRisk =
      Math.max(0, Math.abs(predX) - matSafe) / (L4_MAT_HALF + 1e-6) +
      Math.max(0, Math.abs(predZ) - matSafe) / (L4_MAT_HALF + 1e-6) +
      Math.max(0, predZ) * 1.8; // south is deadly (open + holes)
    if (edgeRisk > 0.15) {
      // Pull aim toward mat center
      const toCx = -sx;
      const toCz = -sz;
      const cl = Math.hypot(toCx, toCz) || 1;
      const blend = Math.min(0.65, 0.25 + edgeRisk * 0.55) * skill;
      dx = dx * (1 - blend) + (toCx / cl) * blend;
      dz = dz * (1 - blend) + (toCz / cl) * blend;
      const nl = Math.hypot(dx, dz) || 1;
      dx /= nl;
      dz /= nl;
      safetyCut = Math.min(0.35, 0.12 + edgeRisk * 0.25);
    }
    // Prefer not aiming mostly south from near south edge
    if (sz > matSafe * 0.55 && dz > 0.25) {
      dz = Math.min(dz, 0.05);
      const nl = Math.hypot(dx, dz) || 1;
      dx /= nl;
      dz /= nl;
      safetyCut = Math.max(safetyCut, 0.18);
    }
  }

  const px = -dz;
  const pz = dx;
  const nLat = (Math.random() * 2 - 1) * noiseAmp * (mode === 'channel_out' ? 0.7 : 1);
  const nLon = (Math.random() * 2 - 1) * noiseAmp * 0.35;
  let dirX = dx + px * nLat + dx * nLon;
  let dirZ = dz + pz * nLat + dz * nLon;
  const dlen = Math.hypot(dirX, dirZ) || 1;
  dirX /= dlen;
  dirZ /= dlen;

  const distShot = Math.hypot(tx - sx, tz - sz);
  const ideal =
    0.32 + Math.min(0.58, distShot / (CIRCLE_RADIUS * 2.2));
  const powerNoise = (Math.random() * 2 - 1) * (0.2 - skill * 0.17);
  const powerBoost = skill * 0.08;
  let power01 = Math.max(0.12, Math.min(1, ideal + powerNoise + powerBoost));
  if (mode === 'channel_out') {
    // Slightly softer shots on L4 so AI doesn't rocket itself off
    power01 = Math.min(power01, 0.82 - safetyCut);
    power01 = Math.max(0.18, power01 - safetyCut);
  }

  return { dirX, dirZ, power01 };
}

export function impulseFromPower(power01: number): number {
  return SHOT_MIN + (SHOT_MAX - SHOT_MIN) * power01;
}
