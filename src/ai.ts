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
  return 0.92; // L4 — accurate aim; power hard-capped separately
}

/** Hard L4 flick ceiling — soft multi-tap only (never a cañonazo). */
const L4_POWER_HARD_CAP = 0.16;
/** Preferred gentle tap when a nearby field marble is in reach. */
const L4_POWER_SOFT_PREF = 0.11;
/** Tiny reposition tap toward mat center when no safe scoring shot exists. */
const L4_POWER_REPOSITION = 0.07;
/** Heuristic travel (fraction of mat) used for L4 suicide safety checks. */
const L4_LOOKAHEAD = 0.42;

/**
 * Pick a target among in-play field marbles and compute shot direction/power.
 * mode 'hole_in' (L3): aim to knock toward the center hole.
 * mode 'circle_out' (L1/L2): aim to knock outside the chalk circle.
 * mode 'channel_out' (L4): soft taps that nudge field marbles toward the nearest
 *   channel lip while NEVER yeeting the AI shooter off the desk.
 * L1–L3 behavior is unchanged; only channel_out uses the soft/safe profile.
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
  // Keep AI marble well inside the playmat; rim = high risk
  const matSafe = L4_MAT_HALF * 0.58;
  const matInner = L4_MAT_HALF * 0.72;

  const sx = shooter.body.position.x;
  const sz = shooter.body.position.z;

  const candidates: {
    m: MarbleEntity;
    score: number;
    tx: number;
    tz: number;
    approachRisk: number;
  }[] = [];

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
      if (Math.abs(x) > L4_MAT_HALF * 1.05 || Math.abs(z) > L4_MAT_HALF * 1.05) continue;
    }

    let neighbors = 0;
    for (const o of field) {
      if (o === m || !o.active) continue;
      const d = Math.hypot(o.body.position.x - x, o.body.position.z - z);
      if (d < MARBLE_RADIUS * 6) neighbors++;
    }
    const cluster = neighbors * 0.35;
    let score: number;
    let approachRisk = 0;
    if (mode === 'hole_in') {
      const towardHole = 1 - Math.min(1, dist / (CIRCLE_RADIUS + 1e-6));
      score = towardHole * 1.35 + cluster + Math.random() * (0.28 * (1 - skill));
    } else if (mode === 'channel_out') {
      const toWest = Math.max(0, -x) / (L4_MAT_HALF + 1e-6);
      const toEast = Math.max(0, x) / (L4_MAT_HALF + 1e-6);
      const toNorth = Math.max(0, -z) / (L4_MAT_HALF + 1e-6);
      const toSouth = Math.max(0, z) / (L4_MAT_HALF + 1e-6);
      const channelReach = Math.max(toWest, toEast, toNorth, toSouth) * 1.35;
      const towardSwHole = toWest * 0.55 + toSouth * 0.55;
      const prox = 1 - Math.min(1, Math.hypot(x - sx, z - sz) / (L4_MAT_HALF * 1.6));

      // Channel push direction (toward nearest lip, prefer SW when close)
      const toW = Math.abs(-L4_MAT_HALF - x);
      const toE = Math.abs(L4_MAT_HALF - x);
      const toN = Math.abs(-L4_MAT_HALF - z);
      const toS = Math.abs(L4_MAT_HALF - z);
      const nearest = Math.min(toW, toE, toN, toS);
      let ox = 0;
      let oz = 0;
      if (nearest === toS) oz = 1;
      else if (nearest === toN) oz = -1;
      else if (nearest === toW) ox = -1;
      else ox = 1;
      if (Math.abs(toW - toS) < MARBLE_RADIUS * 6 && toW <= toE && toS <= toN) {
        ox = -0.7;
        oz = 0.7;
      }

      // Aim point just past the marble toward the lip (short tap)
      const outPush = 0.18 + skill * 0.12;
      const atx = x + ox * MARBLE_RADIUS * outPush;
      const atz = z + oz * MARBLE_RADIUS * outPush;
      const adx = atx - sx;
      const adz = atz - sz;
      const alen = Math.hypot(adx, adz) || 1;
      const ndx = adx / alen;
      const ndz = adz / alen;

      // Will follow-through carry the shooter off the mat / toward outer rim?
      const predX = sx + ndx * L4_LOOKAHEAD * L4_MAT_HALF;
      const predZ = sz + ndz * L4_LOOKAHEAD * L4_MAT_HALF;
      const leaveMat =
        Math.max(0, Math.abs(predX) - matInner) / (L4_MAT_HALF + 1e-6) +
        Math.max(0, Math.abs(predZ) - matInner) / (L4_MAT_HALF + 1e-6);
      const outwardFromRim =
        (Math.abs(sx) > matSafe && Math.sign(ndx) === Math.sign(sx) ? 1.1 : 0) +
        (Math.abs(sz) > matSafe && Math.sign(ndz) === Math.sign(sz) ? 1.1 : 0);
      // Crossing through target toward desk rim (beyond channel) is suicide
      const pastTargetOffDesk =
        (Math.abs(atx) > L4_MAT_HALF * 0.92 && Math.sign(ndx) === Math.sign(atx) ? 0.55 : 0) +
        (Math.abs(atz) > L4_MAT_HALF * 0.92 && Math.sign(ndz) === Math.sign(atz) ? 0.55 : 0);
      approachRisk = leaveMat + outwardFromRim + pastTargetOffDesk;

      // Prefer closer, channel-reachable targets that don't force an outward blast
      score =
        channelReach +
        towardSwHole * 0.85 +
        prox * 1.15 +
        cluster * 0.55 -
        approachRisk * 2.4 +
        Math.random() * (0.12 * (1 - skill));

      candidates.push({ m, score, tx: atx, tz: atz, approachRisk });
      continue;
    } else {
      const edgeFactor = dist / CIRCLE_RADIUS;
      score = edgeFactor * 1.2 + cluster + Math.random() * (0.25 * (1 - skill));
    }
    candidates.push({ m, score, tx: x, tz: z, approachRisk });
  }

  let tx = 0;
  let tz = 0;
  let pickRisk = 0;
  let usedReposition = false;

  if (mode === 'channel_out') {
    // Only consider reasonably safe approaches; otherwise reposition to center
    const safe = candidates
      .filter((c) => c.approachRisk < 0.85)
      .sort((a, b) => b.score - a.score);
    if (safe.length > 0) {
      const pick = safe[0]!;
      tx = pick.tx;
      tz = pick.tz;
      pickRisk = pick.approachRisk;
    } else {
      // No safe scoring tap — tiny inward reposition (never a suicide blast)
      usedReposition = true;
      tx = sx * 0.35;
      tz = sz * 0.35;
      pickRisk = 0;
    }
  } else if (candidates.length > 0) {
    candidates.sort((a, b) => b.score - a.score);
    const pick = candidates[0]!;
    if (mode === 'hole_in') {
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

  let dx = tx - sx;
  let dz = tz - sz;
  let len = Math.hypot(dx, dz);
  if (len < 1e-6) {
    if (mode === 'hole_in') {
      dx = -sx;
      dz = -sz;
    } else if (mode === 'channel_out') {
      // Default: nudge toward mat center, not off the desk
      dx = -sx || -0.2;
      dz = -sz || 0.05;
    } else {
      dx = -sx;
      dz = -sz;
    }
    len = Math.hypot(dx, dz) || 1;
  }
  dx /= len;
  dz /= len;

  // L4 safety: retarget inward / cut power if follow-through still looks dangerous
  let safetyCut = 0;
  if (mode === 'channel_out') {
    const predX = sx + dx * L4_LOOKAHEAD * L4_MAT_HALF;
    const predZ = sz + dz * L4_LOOKAHEAD * L4_MAT_HALF;
    const edgeRisk =
      Math.max(0, Math.abs(predX) - matSafe) / (L4_MAT_HALF + 1e-6) +
      Math.max(0, Math.abs(predZ) - matSafe) / (L4_MAT_HALF + 1e-6);
    const aimOffMat =
      (Math.abs(sx) > matSafe * 0.7 && Math.sign(dx) === Math.sign(sx) ? 0.9 : 0) +
      (Math.abs(sz) > matSafe * 0.7 && Math.sign(dz) === Math.sign(sz) ? 0.9 : 0);
    const rimLaunch =
      (Math.abs(sx) > L4_MAT_HALF * 0.5 && Math.sign(dx) === Math.sign(sx) ? 0.45 : 0) +
      (Math.abs(sz) > L4_MAT_HALF * 0.5 && Math.sign(dz) === Math.sign(sz) ? 0.45 : 0);
    const risk = edgeRisk + aimOffMat + rimLaunch + pickRisk * 0.5;

    if (usedReposition || risk > 0.55) {
      // Commit to a centerward micro-tap
      const toCx = -sx;
      const toCz = -sz;
      const cl = Math.hypot(toCx, toCz) || 1;
      dx = toCx / cl;
      dz = toCz / cl;
      usedReposition = true;
      safetyCut = 0.5;
    } else if (risk > 0.08) {
      const toCx = -sx;
      const toCz = -sz;
      const cl = Math.hypot(toCx, toCz) || 1;
      const blend = Math.min(0.92, 0.42 + risk * 0.7) * Math.max(0.85, skill);
      dx = dx * (1 - blend) + (toCx / cl) * blend;
      dz = dz * (1 - blend) + (toCz / cl) * blend;
      const nl = Math.hypot(dx, dz) || 1;
      dx /= nl;
      dz /= nl;
      safetyCut = Math.min(0.6, 0.25 + risk * 0.4);
    }

    // Never aim mostly outward when already near any mat edge
    if (Math.abs(sx) > matSafe * 0.45 && Math.sign(dx) === Math.sign(sx) && Math.abs(dx) > 0.22) {
      dx *= 0.05;
      const nl = Math.hypot(dx, dz) || 1;
      dx /= nl;
      dz /= nl;
      safetyCut = Math.max(safetyCut, 0.4);
    }
    if (Math.abs(sz) > matSafe * 0.45 && Math.sign(dz) === Math.sign(sz) && Math.abs(dz) > 0.22) {
      dz *= 0.05;
      const nl = Math.hypot(dx, dz) || 1;
      dx /= nl;
      dz /= nl;
      safetyCut = Math.max(safetyCut, 0.4);
    }

    // Extra: if shooter is already near rim, force centerward aim
    const rimDist = Math.max(Math.abs(sx), Math.abs(sz));
    if (rimDist > L4_MAT_HALF * 0.78) {
      const toCx = -sx;
      const toCz = -sz;
      const cl = Math.hypot(toCx, toCz) || 1;
      dx = toCx / cl;
      dz = toCz / cl;
      usedReposition = true;
      safetyCut = Math.max(safetyCut, 0.55);
    }
  }

  const px = -dz;
  const pz = dx;
  const nLat = (Math.random() * 2 - 1) * noiseAmp * (mode === 'channel_out' ? 0.28 : 1);
  const nLon = (Math.random() * 2 - 1) * noiseAmp * (mode === 'channel_out' ? 0.2 : 0.35);
  let dirX = dx + px * nLat + dx * nLon;
  let dirZ = dz + pz * nLat + dz * nLon;
  const dlen = Math.hypot(dirX, dirZ) || 1;
  dirX /= dlen;
  dirZ /= dlen;

  const distShot = Math.hypot(tx - sx, tz - sz);
  const ideal = 0.32 + Math.min(0.58, distShot / (CIRCLE_RADIUS * 2.2));
  const powerNoise = (Math.random() * 2 - 1) * (0.2 - skill * 0.17);
  const powerBoost = skill * 0.08;
  let power01 = Math.max(0.12, Math.min(1, ideal + powerNoise + powerBoost));

  if (mode === 'channel_out') {
    if (usedReposition) {
      power01 = L4_POWER_REPOSITION + Math.random() * 0.02;
    } else {
      const softIdeal =
        L4_POWER_SOFT_PREF + Math.min(0.05, distShot / (L4_MAT_HALF * 10));
      power01 = Math.min(power01, softIdeal + 0.04);
      power01 = Math.max(0.06, power01 * 0.38 - safetyCut * 1.25);
      power01 = Math.min(power01, L4_POWER_HARD_CAP - safetyCut * 0.4);
      power01 = Math.min(power01, L4_POWER_HARD_CAP);
      // Near edges: even softer
      const rimProx = Math.max(Math.abs(sx), Math.abs(sz)) / (L4_MAT_HALF + 1e-6);
      if (rimProx > 0.55) {
        power01 = Math.min(power01, L4_POWER_HARD_CAP * (1.05 - rimProx));
      }
      power01 = Math.max(0.06, Math.min(L4_POWER_HARD_CAP, power01));
    }
  }

  return { dirX, dirZ, power01 };
}

export function impulseFromPower(power01: number): number {
  return SHOT_MIN + (SHOT_MAX - SHOT_MIN) * power01;
}
