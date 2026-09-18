/**
 * Elegant metal spy briefcase used as the marble dropper on all levels.
 * Starts upside-down (handle down). Opens on Drop → holds → rises away.
 */
import * as THREE from 'three';
import { DROP_HEIGHT } from './constants';

export type BriefcasePhase = 'idle' | 'opening' | 'holding' | 'rising' | 'gone';

export type SpyBriefcase = {
  root: THREE.Group;
  lid: THREE.Group;
  phase: BriefcasePhase;
  /** Seconds in current phase */
  t: number;
  restY: number;
  /** Called once when lid is open enough to release marbles */
  onRelease: (() => void) | null;
  released: boolean;
};

const OPEN_DUR = 0.55;
const HOLD_DUR = 3.0;
const RISE_DUR = 0.55;
const RISE_DIST = 1.8;
const LID_OPEN_ANGLE = -1.35; // radians (~77°)

function metalMat(color: number, roughness = 0.28, metalness = 0.92): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    envMapIntensity: 1.1,
  });
}

export function createSpyBriefcase(): SpyBriefcase {
  const root = new THREE.Group();
  root.name = 'spyBriefcase';

  const bodyMat = metalMat(0x8a93a0);
  const darkMat = metalMat(0x3a4048, 0.4, 0.85);
  const goldMat = metalMat(0xc9a84c, 0.35, 0.95);
  const padMat = new THREE.MeshStandardMaterial({
    color: 0x1a1010,
    roughness: 0.9,
    metalness: 0.05,
  });

  // Case body (bottom half when upright; we start inverted)
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.022, 0.048), bodyMat);
  body.castShadow = true;
  body.receiveShadow = true;
  body.position.y = -0.011;
  root.add(body);

  // Interior pad (visible when open)
  const pad = new THREE.Mesh(new THREE.BoxGeometry(0.064, 0.004, 0.04), padMat);
  pad.position.y = -0.002;
  root.add(pad);

  // Lid group (hinged at +Z edge of body top)
  const lid = new THREE.Group();
  lid.position.set(0, 0, 0.024);
  root.add(lid);

  const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.018, 0.048), bodyMat);
  lidMesh.castShadow = true;
  lidMesh.position.set(0, 0.009, -0.024);
  lid.add(lidMesh);

  // Corner reinforcements
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.024, 0.01), darkMat);
      cap.position.set(sx * 0.032, -0.011, sz * 0.02);
      root.add(cap);
    }
  }

  // Latches
  for (const sx of [-0.016, 0.016]) {
    const latch = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.006, 0.008), goldMat);
    latch.position.set(sx, 0.002, 0.026);
    root.add(latch);
  }

  // Handle (on what will be the "bottom" when inverted = facing down)
  const handle = new THREE.Group();
  handle.position.set(0, -0.028, 0);
  root.add(handle);
  const grip = new THREE.Mesh(
    new THREE.TorusGeometry(0.012, 0.0022, 8, 16, Math.PI),
    darkMat,
  );
  grip.rotation.x = Math.PI / 2;
  grip.rotation.z = Math.PI;
  handle.add(grip);
  const postL = new THREE.Mesh(new THREE.CylinderGeometry(0.0018, 0.0018, 0.008, 6), darkMat);
  postL.position.set(-0.012, 0.004, 0);
  handle.add(postL);
  const postR = postL.clone();
  postR.position.x = 0.012;
  handle.add(postR);

  // Combination dial hint
  const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.004, 12), goldMat);
  dial.rotation.x = Math.PI / 2;
  dial.position.set(0, 0.002, 0.026);
  root.add(dial);

  const restY = DROP_HEIGHT + 0.028;
  // Upside down: handle facing down
  root.rotation.x = Math.PI;
  root.position.set(0, restY, 0);
  root.visible = true;

  return {
    root,
    lid,
    phase: 'idle',
    t: 0,
    restY,
    onRelease: null,
    released: false,
  };
}

/** Reset to hovering closed/inverted above the circle. */
export function resetBriefcase(bc: SpyBriefcase): void {
  bc.phase = 'idle';
  bc.t = 0;
  bc.released = false;
  bc.onRelease = null;
  bc.root.visible = true;
  bc.root.position.set(0, bc.restY, 0);
  bc.root.rotation.set(Math.PI, 0, 0);
  bc.lid.rotation.set(0, 0, 0);
  bc.root.scale.setScalar(1);
}

/**
 * Begin open → hold → rise sequence. Marbles should be released via onRelease
 * once the lid is sufficiently open (same drop height as before).
 */
export function triggerBriefcaseDrop(bc: SpyBriefcase, onRelease: () => void): void {
  resetBriefcase(bc);
  bc.onRelease = onRelease;
  bc.phase = 'opening';
  bc.t = 0;
}

/** Advance briefcase animation. Call every frame with real dt (seconds). */
export function updateBriefcase(bc: SpyBriefcase, dt: number): void {
  if (bc.phase === 'idle' || bc.phase === 'gone') return;
  bc.t += dt;

  if (bc.phase === 'opening') {
    const u = Math.min(1, bc.t / OPEN_DUR);
    const e = 1 - Math.pow(1 - u, 3);
    bc.lid.rotation.x = LID_OPEN_ANGLE * e;
    // Slight un-invert so opening reads clearly
    bc.root.rotation.x = Math.PI - e * 0.15;
    if (u >= 0.45 && !bc.released) {
      bc.released = true;
      bc.onRelease?.();
      bc.onRelease = null;
    }
    if (u >= 1) {
      bc.phase = 'holding';
      bc.t = 0;
      bc.lid.rotation.x = LID_OPEN_ANGLE;
    }
    return;
  }

  if (bc.phase === 'holding') {
    // Subtle idle wobble
    bc.root.rotation.z = Math.sin(bc.t * 3) * 0.02;
    if (bc.t >= HOLD_DUR) {
      bc.phase = 'rising';
      bc.t = 0;
    }
    return;
  }

  if (bc.phase === 'rising') {
    const u = Math.min(1, bc.t / RISE_DUR);
    const e = u * u;
    bc.root.position.y = bc.restY + e * RISE_DIST;
    bc.root.rotation.z = e * 0.4;
    bc.root.scale.setScalar(1 - e * 0.15);
    if (u >= 1) {
      bc.phase = 'gone';
      bc.root.visible = false;
    }
  }
}
