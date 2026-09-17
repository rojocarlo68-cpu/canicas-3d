import * as THREE from 'three';
import { MARBLE_RADIUS } from './constants';

export type HandPose = 'idle' | 'hold' | 'charge' | 'throw' | 'hidden';

/**
 * Stylized low-poly hand built from boxes/spheres.
 * Palm faces roughly toward -Z when resting; marble sits in palm.
 */
export class StylizedHand {
  readonly group = new THREE.Group();
  private wrist: THREE.Group;
  private fingers: THREE.Mesh[] = [];
  private thumb: THREE.Mesh;
  private skinMat: THREE.MeshStandardMaterial;
  private pose: HandPose = 'hidden';
  private animT = 0;
  private throwProgress = 0;
  private chargeAmount = 0;
  readonly isPlayer: boolean;

  constructor(isPlayer: boolean, skinTone = 0xd4a574) {
    this.isPlayer = isPlayer;
    this.skinMat = new THREE.MeshStandardMaterial({
      color: skinTone,
      roughness: 0.65,
      metalness: 0.05,
    });

    this.wrist = new THREE.Group();
    this.group.add(this.wrist);

    const palm = new THREE.Mesh(
      new THREE.BoxGeometry(0.028, 0.01, 0.034),
      this.skinMat,
    );
    palm.position.set(0, 0, 0);
    palm.castShadow = true;
    this.wrist.add(palm);

    const forearm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.007, 0.009, 0.04, 8),
      this.skinMat,
    );
    forearm.rotation.x = Math.PI / 2;
    forearm.position.set(0, -0.002, 0.028);
    forearm.castShadow = true;
    this.wrist.add(forearm);

    const fingerOffsets = [-0.01, -0.0035, 0.0035, 0.01];
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(
        new THREE.BoxGeometry(0.0055, 0.0055, 0.018),
        this.skinMat,
      );
      f.position.set(fingerOffsets[i]!, 0.004, -0.024);
      f.castShadow = true;
      this.wrist.add(f);
      this.fingers.push(f);
    }

    this.thumb = new THREE.Mesh(
      new THREE.BoxGeometry(0.006, 0.006, 0.014),
      this.skinMat,
    );
    this.thumb.position.set(isPlayer ? -0.016 : 0.016, 0.006, -0.006);
    this.thumb.rotation.y = isPlayer ? 0.6 : -0.6;
    this.thumb.rotation.z = isPlayer ? -0.4 : 0.4;
    this.thumb.castShadow = true;
    this.wrist.add(this.thumb);

    this.group.visible = false;
    this.group.scale.setScalar(1);
  }

  setPose(pose: HandPose): void {
    if (pose === 'throw' && this.pose !== 'throw') {
      this.throwProgress = 0;
    }
    this.pose = pose;
    this.group.visible = pose !== 'hidden';
  }

  getPose(): HandPose {
    return this.pose;
  }

  setCharge(amount01: number): void {
    this.chargeAmount = Math.max(0, Math.min(1, amount01));
  }

  /**
   * Place hand near marble world position, oriented to face aim direction (xz).
   */
  placeAt(
    marblePos: THREE.Vector3,
    aimDirX: number,
    aimDirZ: number,
  ): void {
    const len = Math.hypot(aimDirX, aimDirZ) || 1;
    const fx = aimDirX / len;
    const fz = aimDirZ / len;
    // Hand sits slightly behind marble along aim
    const back = 0.022;
    const lift = MARBLE_RADIUS + 0.012;
    this.group.position.set(
      marblePos.x - fx * back,
      marblePos.y + lift,
      marblePos.z - fz * back,
    );
    const yaw = Math.atan2(fx, fz);
    this.group.rotation.set(0, yaw, 0);
  }

  /** Returns true while throw animation is still playing. */
  update(dt: number): boolean {
    this.animT += dt;
    if (this.pose === 'hidden') {
      this.group.visible = false;
      return false;
    }
    this.group.visible = true;

    const curlBase =
      this.pose === 'charge'
        ? 0.35 + this.chargeAmount * 0.55
        : this.pose === 'hold'
          ? 0.4
          : this.pose === 'throw'
            ? 0.15
            : 0.25;

    for (let i = 0; i < this.fingers.length; i++) {
      const f = this.fingers[i]!;
      const wobble = Math.sin(this.animT * 6 + i) * 0.03;
      f.rotation.x = curlBase + wobble;
    }

    if (this.pose === 'charge') {
      const pull = this.chargeAmount * 0.018;
      this.wrist.position.z = pull;
      this.wrist.rotation.x = -0.15 - this.chargeAmount * 0.35;
      this.group.position.y += Math.sin(this.animT * 10) * 0.0004 * this.chargeAmount;
    } else if (this.pose === 'hold') {
      this.wrist.position.z = 0.004;
      this.wrist.rotation.x = -0.1;
    } else if (this.pose === 'throw') {
      this.throwProgress += dt * 4.5;
      const t = Math.min(1, this.throwProgress);
      // Flick forward
      this.wrist.position.z = 0.004 - t * 0.035;
      this.wrist.rotation.x = -0.1 + t * 0.9;
      for (const f of this.fingers) {
        f.rotation.x = 0.15 + (1 - t) * 0.4;
      }
      if (t >= 1) {
        this.setPose('hidden');
        return false;
      }
      return true;
    } else {
      this.wrist.position.z = 0;
      this.wrist.rotation.x = 0;
    }
    return false;
  }

  dispose(): void {
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
      }
    });
    this.skinMat.dispose();
  }
}
