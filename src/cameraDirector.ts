import * as THREE from 'three';
import {
  CIRCLE_RADIUS,
  MARBLE_REST_Y,
  PLAY_SURFACE_Y,
} from './constants';
import type { MarbleEntity } from './marbles';

/** Simple 2-phase AI-turn camera (no multi-cut TV director). */
export type AIShotCam = 'aim' | 'wide';

export type DirectorFraming = {
  pos: THREE.Vector3;
  target: THREE.Vector3;
};

/** Camera must stay this far above the dirt play surface. */
export const CAM_MIN_Y = PLAY_SURFACE_Y + 0.12;
/** Look-at must stay above the dirt (never stare into the plane). */
export const LOOK_MIN_Y = Math.max(MARBLE_REST_Y, PLAY_SURFACE_Y + 0.02);
/** Minimum camera-above-look gap so pitch never goes flat into dirt. */
const MIN_CAM_ABOVE_LOOK = 0.06;

/**
 * Keep camera + look-at safely above the play surface with readable pitch.
 * Apply after every AI / cinematic framing write.
 */
export function clampCamAboveSurface(pos: THREE.Vector3, target: THREE.Vector3): void {
  if (!Number.isFinite(pos.y)) pos.y = CAM_MIN_Y;
  if (!Number.isFinite(target.y)) target.y = LOOK_MIN_Y;
  if (pos.y < CAM_MIN_Y) pos.y = CAM_MIN_Y;
  if (target.y < LOOK_MIN_Y) target.y = LOOK_MIN_Y;
  if (pos.y < target.y + MIN_CAM_ABOVE_LOOK) {
    pos.y = Math.max(CAM_MIN_Y, target.y + MIN_CAM_ABOVE_LOOK);
  }
}

function radialBehind(px: number, pz: number, fallbackAz: number): { dirX: number; dirZ: number } {
  const r = Math.hypot(px, pz);
  if (r < 1e-4) {
    return { dirX: Math.sin(fallbackAz), dirZ: Math.cos(fallbackAz) };
  }
  return { dirX: px / r, dirZ: pz / r };
}

/**
 * Phase 1 — AI aiming / about to shoot:
 * Clean TV-style behind+slight-side view of the AI marble. Never below ground.
 */
export function framingAIAim(
  subject: MarbleEntity,
  fallbackAz: number,
  portrait: boolean,
): DirectorFraming {
  const p = subject.body.position;
  const px = Number.isFinite(p.x) ? p.x : 0;
  const pz = Number.isFinite(p.z) ? p.z : 0;
  const lookY = Math.max(
    LOOK_MIN_Y,
    Number.isFinite(p.y) ? p.y : MARBLE_REST_Y,
  );
  const { dirX, dirZ } = radialBehind(px, pz, fallbackAz);
  // Perpendicular for a mild side offset (readable TV angle)
  const sx = -dirZ;
  const sz = dirX;

  const back = portrait ? 0.34 : 0.44;
  const side = portrait ? 0.1 : 0.14;
  const up = portrait ? 0.2 : 0.24;

  const pos = new THREE.Vector3(
    px + dirX * back + sx * side,
    up,
    pz + dirZ * back + sz * side,
  );
  const target = new THREE.Vector3(px, lookY, pz);
  clampCamAboveSurface(pos, target);
  return { pos, target };
}

/**
 * Phase 2 — AI shot in flight:
 * One wider overview of the play circle + marbles nearest the circle.
 * Readable, not ultra-tight, never diving into dirt.
 */
export function framingAIWide(
  field: MarbleEntity[],
  preferred: MarbleEntity | null,
  fallbackAz: number,
  portrait: boolean,
  scratch: THREE.Vector3,
): DirectorFraming {
  // Look toward circle center, biased by nearby active field marbles
  let lx = 0;
  let ly = LOOK_MIN_Y;
  let lz = 0;
  let n = 0;
  const R = CIRCLE_RADIUS * 1.15;
  for (const m of field) {
    if (!m.active) continue;
    const bx = m.body.position.x;
    const bz = m.body.position.z;
    if (!Number.isFinite(bx) || !Number.isFinite(bz)) continue;
    const dist = Math.hypot(bx, bz);
    if (dist > R) continue;
    lx += bx;
    ly += Math.max(LOOK_MIN_Y, Number.isFinite(m.body.position.y) ? m.body.position.y : LOOK_MIN_Y);
    lz += bz;
    n++;
  }
  if (preferred?.active) {
    const pp = preferred.body.position;
    if (Number.isFinite(pp.x) && Number.isFinite(pp.z)) {
      // Mild bias toward AI shooter so action stays related
      lx += pp.x * 0.6;
      ly += Math.max(LOOK_MIN_Y, Number.isFinite(pp.y) ? pp.y : LOOK_MIN_Y) * 0.6;
      lz += pp.z * 0.6;
      n += 0.6;
    }
  }
  if (n > 0) {
    scratch.set(lx / n, ly / n, lz / n);
  } else {
    scratch.set(0, LOOK_MIN_Y, 0);
  }
  if (scratch.y < LOOK_MIN_Y) scratch.y = LOOK_MIN_Y;

  const elev = portrait ? 0.58 : 0.72;
  const pull = portrait ? 0.78 : 0.98;
  // Slight orbit so it's not dead-top-down (keeps horizon / pitch readable)
  const az = fallbackAz + 0.55;
  const pos = new THREE.Vector3(
    scratch.x + Math.sin(az) * pull,
    elev,
    scratch.z + Math.cos(az) * pull,
  );
  const target = scratch.clone();
  clampCamAboveSurface(pos, target);
  return { pos, target };
}

/** Soft blend into aim vs a slightly snappier cut into the wide overview. */
export function aiShotBlendDuration(shot: AIShotCam): number {
  return shot === 'wide' ? 0.55 : 0.7;
}
