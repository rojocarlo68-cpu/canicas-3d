import * as THREE from 'three';
import { CIRCLE_RADIUS, MARBLE_RADIUS, MARBLE_REST_Y } from './constants';
import type { MarbleEntity } from './marbles';

/** TV-director shot vocabulary (spectacular, not nauseating). */
export type DirectorMode =
  | 'hero'
  | 'low_chase'
  | 'high_wide'
  | 'side_track'
  | 'cluster'
  | 'impact';

export type DirectorFraming = {
  pos: THREE.Vector3;
  target: THREE.Vector3;
};

/**
 * Pick the camera "subject" for an AI turn.
 * - Prefer the active AI shooter (the one taking the shot) — scales to N AIs later.
 * - Override briefly to hottest action: fastest marble, or one near the rim flying out.
 */
export function pickDirectorSubject(
  activeShooters: MarbleEntity[],
  field: MarbleEntity[],
  preferredShooter: MarbleEntity | null,
  impactHint: MarbleEntity | null,
): MarbleEntity | null {
  if (impactHint && impactHint.active) return impactHint;

  let hottest: MarbleEntity | null = null;
  let hotScore = 0;

  const consider = (m: MarbleEntity, bias: number) => {
    if (!m.active) return;
    const v = m.body.velocity;
    const speed = Math.hypot(v.x, v.z);
    const dist = Math.hypot(m.body.position.x, m.body.position.z);
    const rim = dist > CIRCLE_RADIUS * 0.72 ? 0.35 : 0;
    const score = speed * 1.4 + rim + bias;
    if (score > hotScore) {
      hotScore = score;
      hottest = m;
    }
  };

  for (const s of activeShooters) consider(s, 0.15);
  for (const m of field) consider(m, 0);

  // Hot action wins only when something is clearly moving
  if (hottest && hotScore >= 0.45) return hottest;

  if (preferredShooter?.active) return preferredShooter;
  if (activeShooters.length > 0) {
    for (const s of activeShooters) {
      if (s.active) return s;
    }
  }
  return hottest;
}

/** Centroid of subject + nearby field marbles (cluster framing). */
export function clusterLookAt(
  subject: MarbleEntity,
  field: MarbleEntity[],
  out: THREE.Vector3,
): THREE.Vector3 {
  const sp = subject.body.position;
  let x = sp.x;
  let y = Math.max(MARBLE_REST_Y, sp.y);
  let z = sp.z;
  let n = 1;
  const R = MARBLE_RADIUS * 14;
  for (const m of field) {
    if (!m.active || m === subject) continue;
    const dx = m.body.position.x - sp.x;
    const dz = m.body.position.z - sp.z;
    if (dx * dx + dz * dz < R * R) {
      x += m.body.position.x;
      y += Math.max(MARBLE_REST_Y, m.body.position.y);
      z += m.body.position.z;
      n++;
    }
  }
  out.set(x / n, y / n, z / n);
  return out;
}

function horizDirFromVelocity(
  subject: MarbleEntity,
  fallbackAz: number,
): { fx: number; fz: number; speed: number } {
  const vx = subject.body.velocity.x;
  const vz = subject.body.velocity.z;
  const speed = Math.hypot(vx, vz);
  if (speed > 0.04) {
    return { fx: vx / speed, fz: vz / speed, speed };
  }
  const px = subject.body.position.x;
  const pz = subject.body.position.z;
  const r = Math.hypot(px, pz);
  if (r > 1e-4) return { fx: px / r, fz: pz / r, speed: 0 };
  return { fx: Math.sin(fallbackAz), fz: Math.cos(fallbackAz), speed: 0 };
}

/**
 * Compute a dramatic but stable framing for the given director mode.
 * Distances stay modest (marbles are ~cm scale) to avoid seasick swings.
 */
export function framingForDirectorMode(
  mode: DirectorMode,
  subject: MarbleEntity,
  field: MarbleEntity[],
  fallbackAz: number,
  portrait: boolean,
  scratchLook: THREE.Vector3,
): DirectorFraming {
  const p = subject.body.position;
  const lookY = Math.max(MARBLE_REST_Y, Number.isFinite(p.y) ? p.y : MARBLE_REST_Y);
  const CAM_FLOOR_Y = 0.06;
  const { fx, fz } = horizDirFromVelocity(subject, fallbackAz);
  // Perpendicular for side track
  const sx = -fz;
  const sz = fx;

  // Pulled farther than before so director shots read wider / less tight
  const back = portrait ? 0.34 : 0.44;
  const side = portrait ? 0.28 : 0.38;

  switch (mode) {
    case 'hero': {
      // Behind subject looking inward (same spirit as player aim cam)
      let dirX = p.x;
      let dirZ = p.z;
      const radial = Math.hypot(dirX, dirZ);
      if (radial < 1e-4) {
        dirX = Math.sin(fallbackAz);
        dirZ = Math.cos(fallbackAz);
      } else {
        dirX /= radial;
        dirZ /= radial;
      }
      const up = portrait ? 0.16 : 0.2;
      return {
        pos: new THREE.Vector3(p.x + dirX * back, up, p.z + dirZ * back),
        target: new THREE.Vector3(p.x, lookY, p.z),
      };
    }
    case 'low_chase': {
      // Low chase behind motion
      const dist = portrait ? 0.32 : 0.4;
      return {
        pos: new THREE.Vector3(
          p.x - fx * dist,
          Math.max(CAM_FLOOR_Y, portrait ? 0.08 : 0.1),
          p.z - fz * dist,
        ),
        target: new THREE.Vector3(p.x + fx * 0.04, lookY, p.z + fz * 0.04),
      };
    }
    case 'high_wide': {
      clusterLookAt(subject, field, scratchLook);
      const elev = portrait ? 0.52 : 0.62;
      const pull = portrait ? 0.55 : 0.7;
      return {
        pos: new THREE.Vector3(
          scratchLook.x + fx * pull * 0.35 + Math.sin(fallbackAz) * pull * 0.65,
          elev,
          scratchLook.z + fz * pull * 0.35 + Math.cos(fallbackAz) * pull * 0.65,
        ),
        target: scratchLook.clone(),
      };
    }
    case 'side_track': {
      return {
        pos: new THREE.Vector3(
          p.x + sx * side - fx * 0.08,
          portrait ? 0.14 : 0.17,
          p.z + sz * side - fz * 0.08,
        ),
        target: new THREE.Vector3(p.x, lookY, p.z),
      };
    }
    case 'cluster': {
      clusterLookAt(subject, field, scratchLook);
      const pull = portrait ? 0.44 : 0.54;
      return {
        pos: new THREE.Vector3(
          scratchLook.x - fx * pull,
          portrait ? 0.3 : 0.38,
          scratchLook.z - fz * pull,
        ),
        target: scratchLook.clone(),
      };
    }
    case 'impact':
    default: {
      // Brief punch-in — close but readable
      const dist = portrait ? 0.17 : 0.2;
      return {
        pos: new THREE.Vector3(
          p.x - fx * dist * 0.4 + sx * dist * 0.75,
          Math.max(CAM_FLOOR_Y, portrait ? 0.1 : 0.12),
          p.z - fz * dist * 0.4 + sz * dist * 0.75,
        ),
        target: new THREE.Vector3(p.x, lookY, p.z),
      };
    }
  }
}

/**
 * Next mode after current. Returns null when no further cut should happen
 * (caller caps to ~2 shots: establish + one follow/impact).
 */
export function nextDirectorMode(
  current: DirectorMode,
  phase: 'thinking' | 'action',
  wantImpact: boolean,
): DirectorMode | null {
  // Prefer a single impact cut when something dramatic happens
  if (wantImpact && current !== 'impact') return 'impact';
  // Hold establish through thinking — no restless cuts
  if (phase === 'thinking') return null;
  // Action: one follow shot only (establish → low_chase or side_track)
  if (current === 'hero' || current === 'high_wide') return 'low_chase';
  if (current === 'low_chase') return null;
  if (current === 'impact') return null;
  return null;
}

/** Long holds so the marble stays readable — rare cuts. */
export function directorModeDuration(mode: DirectorMode, phase: 'thinking' | 'action'): number {
  switch (mode) {
    case 'impact':
      return 0.85;
    case 'hero':
      return phase === 'thinking' ? 4.0 : 3.2;
    case 'high_wide':
      return 3.5;
    case 'cluster':
      return 3.0;
    case 'side_track':
      return 3.0;
    case 'low_chase':
    default:
      return 3.4;
  }
}

/** Soft blend duration between shots (cuts are shorter). */
export function directorBlendDuration(mode: DirectorMode, hardCut: boolean): number {
  if (hardCut || mode === 'impact') return 0.22;
  return 0.7;
}
