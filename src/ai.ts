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
  return 0.88; // L4 — accurate but deliberately safety-weighted (no suicide flicks)
}

/**
 * Pick a target among in-play field marbles and compute shot direction/power.
 * mode 'hole_in' (L3): aim to knock toward the center hole.
 * mode 'circle_out' (L1/L2): aim to knock outside the chalk circle.
 * mode 'channel_out' (L4): push field marbles toward channels (prefer SW hole path)
 *   while keeping the AI shooter safely on the playmat (never launch self off desk).
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
  const matSafe = L4_MAT_HALF * 0.68; // keep AI marble comfortably inside mat

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
      const channelReach = Math.max(toWest, toEast, toNorth, toSouth) * 1.25;
      const towardSwHole = toWest * 0.55 + toSouth * 0.55;
      score =
        channelReach +
        towardSwHole * 0.85 +
        cluster +
        Math.random() * (0.2 * (1 - skill));
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
      // Push toward nearest channel (incl. south — SW hole path); mild out-push
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
      // Prefer SW when ties between W and S are close
      if (Math.abs(toW - toS) < MARBLE_RADIUS * 4 && toW <= toE && toS <= toN) {
        ox = -0.7;
        oz = 0.7;
      }
      const outPush = 0.4 + skill * 0.35; // milder than L1/L2 so shooter stays put
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

  // L4 safety: if the planned follow-through would carry the shooter near/off the mat
  // edge, bias aim toward mat center and cut power hard.
  let safetyCut = 0;
  if (mode === 'channel_out') {
    const look = 0.42 + skill * 0.22; // shorter predicted travel (softer shots)
    const predX = sx + dx * look * L4_MAT_HALF;
    const predZ = sz + dz * look * L4_MAT_HALF;
    const edgeRisk =
      Math.max(0, Math.abs(predX) - matSafe) / (L4_MAT_HALF + 1e-6) +
      Math.max(0, Math.abs(predZ) - matSafe) / (L4_MAT_HALF + 1e-6);
    // Extra penalty aiming straight at desk rim from near that rim
    const aimOffMat =
      (Math.abs(sx) > matSafe * 0.85 && Math.sign(dx) === Math.sign(sx) ? 0.45 : 0) +
      (Math.abs(sz) > matSafe * 0.85 && Math.sign(dz) === Math.sign(sz) ? 0.45 : 0);
    const risk = edgeRisk + aimOffMat;
    if (risk > 0.08) {
      const toCx = -sx * 0.35; // slight pull to center, keep some aim intent
      const toCz = -sz * 0.35;
      const cl = Math.hypot(toCx, toCz) || 1;
      const blend = Math.min(0.72, 0.3 + risk * 0.55) * Math.max(0.75, skill);
      dx = dx * (1 - blend) + (toCx / cl) * blend;
      dz = dz * (1 - blend) + (toCz / cl) * blend;
      const nl = Math.hypot(dx, dz) || 1;
      dx /= nl;
      dz /= nl;
      safetyCut = Math.min(0.42, 0.16 + risk * 0.28);
    }
    // Never aim mostly outward when already near any mat edge
    if (Math.abs(sx) > matSafe * 0.6 && Math.sign(dx) === Math.sign(sx) && Math.abs(dx) > 0.35) {
      dx *= 0.15;
      const nl = Math.hypot(dx, dz) || 1;
      dx /= nl;
      dz /= nl;
      safetyCut = Math.max(safetyCut, 0.22);
    }
    if (Math.abs(sz) > matSafe * 0.6 && Math.sign(dz) === Math.sign(sz) && Math.abs(dz) > 0.35) {
      dz *= 0.15;
      const nl = Math.hypot(dx, dz) || 1;
      dx /= nl;
      dz /= nl;
      safetyCut = Math.max(safetyCut, 0.22);
    }
  }

  const px = -dz;
  const pz = dx;
  const nLat = (Math.random() * 2 - 1) * noiseAmp * (mode === 'channel_out' ? 0.55 : 1);
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
    // Hard cap — L4 AI must not routinely yeet itself off the desk on first shot
    power01 = Math.min(power01, 0.52 - safetyCut * 0.35);
    power01 = Math.max(0.14, power01 * 0.78 - safetyCut);
    power01 = Math.min(power01, 0.48);
  }

  return { dirX, dirZ, power01 };
}

export function impulseFromPower(power01: number): number {
  return SHOT_MIN + (SHOT_MAX - SHOT_MIN) * power01;
}
