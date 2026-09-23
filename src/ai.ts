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
 * L4: careful soft-flick specialist (protect shooter; tap field into channels).
 */
function skillForLevel(level: number): number {
  const lv = Math.max(1, Math.min(4, Math.floor(level)));
  if (lv <= 1) return 0.44;
  if (lv === 2) return 0.70;
  if (lv === 3) return 0.94;
  return 0.9; // L4 — accurate aim, but power is hard-capped separately
}

/** Hard L4 flick power ceiling (fraction of normal max flick). Soft multi-tap style. */
const L4_POWER_HARD_CAP = 0.30;
/** Preferred gentle tap band for L4 when a nearby field marble is in reach. */
const L4_POWER_SOFT_PREF = 0.22;

/**
 * Pick a target among in-play field marbles and compute shot direction/power.
 * mode 'hole_in' (L3): aim to knock toward the center hole.
 * mode 'circle_out' (L1/L2): aim to knock outside the chalk circle.
 * mode 'channel_out' (L4): soft taps that nudge field marbles toward the nearest
 *   channel lip (prefer SW hole path) while NEVER yeeting the AI shooter off the desk.
 * L1–L3 behavior is unchanged; only channel_out uses the soft profile.
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
  // Keep AI marble well inside the playmat; anything near the rim is treated as high risk
  const matSafe = L4_MAT_HALF * 0.62;

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
      // Prefer marbles nearer channels; bonus toward SW (hole) via west+south
      const toWest = Math.max(0, -x) / (L4_MAT_HALF + 1e-6);
      const toEast = Math.max(0, x) / (L4_MAT_HALF + 1e-6);
      const toNorth = Math.max(0, -z) / (L4_MAT_HALF + 1e-6);
      const toSouth = Math.max(0, z) / (L4_MAT_HALF + 1e-6);
      const channelReach = Math.max(toWest, toEast, toNorth, toSouth) * 1.45;
      const towardSwHole = toWest * 0.7 + toSouth * 0.7;
      // Prefer closer targets — gentle multi-tap over long bombs
      const sx0 = shooter.body.position.x;
      const sz0 = shooter.body.position.z;
      const prox = 1 - Math.min(1, Math.hypot(x - sx0, z - sz0) / (L4_MAT_HALF * 1.8));
      score =
        channelReach +
        towardSwHole * 1.05 +
        prox * 0.9 +
        cluster * 0.7 +
        Math.random() * (0.16 * (1 - skill));
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
      // Aim just past the marble toward the nearest channel lip (not desk rim)
      const toW = Math.abs(-L4_MAT_HALF - pick.tx);
      const toE = Math.abs(L4_MAT_HALF - pick.tx);
      const toN = Math.abs(-L4_MAT_HALF - pick.tz);
      const toS = Math.abs(L4_MAT_HALF - pick.tz);
      const nearest = Math.min(toW, toE, toN, toS);
      let ox = 0;
      let oz = 0;
      if (nearest === toS) oz = 1;
      else if (nearest === toN) oz = -1;
      else if (nearest === toW) ox = -1;
      else ox = 1;
      // Prefer SW when W/S are similarly close — path toward scoring hole
      if (Math.abs(toW - toS) < MARBLE_RADIUS * 5 && toW <= toE && toS <= toN) {
        ox = -0.75;
        oz = 0.75;
      }
      // Short tap aim point — just beyond contact toward the lip
      const outPush = 0.22 + skill * 0.18;
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
      // Default: nudge toward SW channel/hole, not off the desk
      dx = -0.55;
      dz = 0.35;
    } else {
      dx = -sx;
      dz = -sz;
    }
    len = Math.hypot(dx, dz) || 1;
  }
  dx /= len;
  dz /= len;

  // L4 safety: if follow-through risks leaving the mat / unprotected desk edge,
  // retarget inward and cut power hard.
  let safetyCut = 0;
  if (mode === 'channel_out') {
    const look = 0.28 + skill * 0.12; // short predicted travel (soft shots)
    const predX = sx + dx * look * L4_MAT_HALF;
    const predZ = sz + dz * look * L4_MAT_HALF;
    const edgeRisk =
      Math.max(0, Math.abs(predX) - matSafe) / (L4_MAT_HALF + 1e-6) +
      Math.max(0, Math.abs(predZ) - matSafe) / (L4_MAT_HALF + 1e-6);
    const aimOffMat =
      (Math.abs(sx) > matSafe * 0.75 && Math.sign(dx) === Math.sign(sx) ? 0.7 : 0) +
      (Math.abs(sz) > matSafe * 0.75 && Math.sign(dz) === Math.sign(sz) ? 0.7 : 0);
    // Crossing toward unprotected outer wood (beyond channel) from near rim
    const rimLaunch =
      (Math.abs(sx) > L4_MAT_HALF * 0.55 && Math.sign(dx) === Math.sign(sx) ? 0.35 : 0) +
      (Math.abs(sz) > L4_MAT_HALF * 0.55 && Math.sign(dz) === Math.sign(sz) ? 0.35 : 0);
    const risk = edgeRisk + aimOffMat + rimLaunch;
    if (risk > 0.05) {
      const toCx = -sx;
      const toCz = -sz;
      const cl = Math.hypot(toCx, toCz) || 1;
      const blend = Math.min(0.88, 0.38 + risk * 0.65) * Math.max(0.8, skill);
      dx = dx * (1 - blend) + (toCx / cl) * blend;
      dz = dz * (1 - blend) + (toCz / cl) * blend;
      const nl = Math.hypot(dx, dz) || 1;
      dx /= nl;
      dz /= nl;
      safetyCut = Math.min(0.55, 0.22 + risk * 0.35);
    }
    // Never aim mostly outward when already near any mat edge
    if (Math.abs(sx) > matSafe * 0.5 && Math.sign(dx) === Math.sign(sx) && Math.abs(dx) > 0.28) {
      dx *= 0.08;
      const nl = Math.hypot(dx, dz) || 1;
      dx /= nl;
      dz /= nl;
      safetyCut = Math.max(safetyCut, 0.32);
    }
    if (Math.abs(sz) > matSafe * 0.5 && Math.sign(dz) === Math.sign(sz) && Math.abs(dz) > 0.28) {
      dz *= 0.08;
      const nl = Math.hypot(dx, dz) || 1;
      dx /= nl;
      dz /= nl;
      safetyCut = Math.max(safetyCut, 0.32);
    }
  }

  const px = -dz;
  const pz = dx;
  const nLat = (Math.random() * 2 - 1) * noiseAmp * (mode === 'channel_out' ? 0.4 : 1);
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
    // Soft careful profile every L4 AI turn: gentle taps, hard ceiling.
    const softIdeal =
      L4_POWER_SOFT_PREF + Math.min(0.1, distShot / (L4_MAT_HALF * 8));
    power01 = Math.min(power01, softIdeal + 0.06);
    power01 = Math.max(0.1, power01 * 0.48 - safetyCut * 1.15);
    power01 = Math.min(power01, L4_POWER_HARD_CAP - safetyCut * 0.35);
    power01 = Math.min(power01, L4_POWER_HARD_CAP);
    power01 = Math.max(0.1, power01);
  }

  return { dirX, dirZ, power01 };
}

export function impulseFromPower(power01: number): number {
  return SHOT_MIN + (SHOT_MAX - SHOT_MIN) * power01;
}
