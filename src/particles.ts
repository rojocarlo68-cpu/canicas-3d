import * as THREE from 'three';

type SparkParticle = {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
};

type DirtParticle = {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
};

const SPARK_MAX = 96;
const DIRT_MAX = 120;

/**
 * Lightweight CPU particles for impact sparks + dirt dust.
 * Uses Points (two systems) — mobile-friendly counts.
 */
export class ParticleFX {
  readonly sparkPoints: THREE.Points;
  readonly dirtPoints: THREE.Points;

  private sparks: SparkParticle[] = [];
  private dirt: DirtParticle[] = [];

  private sparkPos: Float32Array;
  private sparkCol: Float32Array;
  private dirtPos: Float32Array;
  private dirtCol: Float32Array;

  private tmp = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.sparkPos = new Float32Array(SPARK_MAX * 3);
    this.sparkCol = new Float32Array(SPARK_MAX * 3);
    this.dirtPos = new Float32Array(DIRT_MAX * 3);
    this.dirtCol = new Float32Array(DIRT_MAX * 3);

    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    sparkGeo.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3));
    sparkGeo.setDrawRange(0, 0);
    const sparkMat = new THREE.PointsMaterial({
      size: 0.012,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.sparkPoints = new THREE.Points(sparkGeo, sparkMat);
    this.sparkPoints.frustumCulled = false;
    scene.add(this.sparkPoints);

    const dirtGeo = new THREE.BufferGeometry();
    dirtGeo.setAttribute('position', new THREE.BufferAttribute(this.dirtPos, 3));
    dirtGeo.setAttribute('color', new THREE.BufferAttribute(this.dirtCol, 3));
    dirtGeo.setDrawRange(0, 0);
    const dirtMat = new THREE.PointsMaterial({
      size: 0.018,
      vertexColors: true,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.dirtPoints = new THREE.Points(dirtGeo, dirtMat);
    this.dirtPoints.frustumCulled = false;
    scene.add(this.dirtPoints);
  }

  /** Exaggerated metal-style sparks at contact. */
  spawnSparks(x: number, y: number, z: number, intensity = 1): void {
    const n = Math.min(28, Math.floor(10 + intensity * 18));
    for (let i = 0; i < n; i++) {
      if (this.sparks.length >= SPARK_MAX) this.sparks.shift();
      const speed = 0.35 + Math.random() * 1.1 * intensity;
      const theta = Math.random() * Math.PI * 2;
      const elev = 0.25 + Math.random() * 1.1;
      this.sparks.push({
        pos: new THREE.Vector3(x, y, z),
        vel: new THREE.Vector3(
          Math.cos(theta) * speed * (0.4 + Math.random()),
          elev * speed,
          Math.sin(theta) * speed * (0.4 + Math.random()),
        ),
        life: 0.12 + Math.random() * 0.22,
        maxLife: 0.28,
        size: 0.008 + Math.random() * 0.01,
      });
      this.sparks[this.sparks.length - 1]!.maxLife =
        this.sparks[this.sparks.length - 1]!.life;
    }
  }

  /** Brown dirt / dust puff; intensity scales with speed. */
  spawnDirt(x: number, y: number, z: number, intensity = 1): void {
    const n = Math.min(22, Math.floor(4 + intensity * 14));
    for (let i = 0; i < n; i++) {
      if (this.dirt.length >= DIRT_MAX) this.dirt.shift();
      const speed = 0.08 + Math.random() * 0.35 * intensity;
      const theta = Math.random() * Math.PI * 2;
      this.dirt.push({
        pos: new THREE.Vector3(
          x + (Math.random() - 0.5) * 0.01,
          Math.max(0.002, y),
          z + (Math.random() - 0.5) * 0.01,
        ),
        vel: new THREE.Vector3(
          Math.cos(theta) * speed,
          0.05 + Math.random() * 0.18 * intensity,
          Math.sin(theta) * speed,
        ),
        life: 0.25 + Math.random() * 0.4,
        maxLife: 0.55,
        size: 0.01 + Math.random() * 0.02 * intensity,
      });
      const p = this.dirt[this.dirt.length - 1]!;
      p.maxLife = p.life;
    }
  }

  update(dt: number): void {
    // Sparks
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const p = this.sparks[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        this.sparks.splice(i, 1);
        continue;
      }
      p.vel.y -= 4.5 * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(0.92);
    }
    for (let i = 0; i < SPARK_MAX; i++) {
      const p = this.sparks[i];
      if (!p) {
        this.sparkPos[i * 3] = 0;
        this.sparkPos[i * 3 + 1] = -10;
        this.sparkPos[i * 3 + 2] = 0;
        this.sparkCol[i * 3] = 0;
        this.sparkCol[i * 3 + 1] = 0;
        this.sparkCol[i * 3 + 2] = 0;
        continue;
      }
      const t = p.life / p.maxLife;
      this.sparkPos[i * 3] = p.pos.x;
      this.sparkPos[i * 3 + 1] = p.pos.y;
      this.sparkPos[i * 3 + 2] = p.pos.z;
      // Hot white → orange → dim red
      this.sparkCol[i * 3] = 1.0;
      this.sparkCol[i * 3 + 1] = 0.55 + 0.45 * t;
      this.sparkCol[i * 3 + 2] = 0.15 * t;
    }
    (this.sparkPoints.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate =
      true;
    (this.sparkPoints.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate =
      true;
    this.sparkPoints.geometry.setDrawRange(0, this.sparks.length);
    (this.sparkPoints.material as THREE.PointsMaterial).size =
      this.sparks.length > 0 ? 0.014 : 0.01;

    // Dirt
    for (let i = this.dirt.length - 1; i >= 0; i--) {
      const p = this.dirt[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        this.dirt.splice(i, 1);
        continue;
      }
      p.vel.y -= 1.8 * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.vel.x *= 0.9;
      p.vel.z *= 0.9;
      if (p.pos.y < 0.001) {
        p.pos.y = 0.001;
        p.vel.y *= -0.15;
        p.vel.x *= 0.7;
        p.vel.z *= 0.7;
      }
    }
    for (let i = 0; i < DIRT_MAX; i++) {
      const p = this.dirt[i];
      if (!p) {
        this.dirtPos[i * 3] = 0;
        this.dirtPos[i * 3 + 1] = -10;
        this.dirtPos[i * 3 + 2] = 0;
        this.dirtCol[i * 3] = 0;
        this.dirtCol[i * 3 + 1] = 0;
        this.dirtCol[i * 3 + 2] = 0;
        continue;
      }
      const t = p.life / p.maxLife;
      this.dirtPos[i * 3] = p.pos.x;
      this.dirtPos[i * 3 + 1] = p.pos.y;
      this.dirtPos[i * 3 + 2] = p.pos.z;
      // Brown tones, fade with life (stable per particle via size hash)
      const shade = 0.32 + (p.size * 7) % 0.12;
      this.dirtCol[i * 3] = (0.52 + shade) * t;
      this.dirtCol[i * 3 + 1] = (0.30 + shade * 0.5) * t;
      this.dirtCol[i * 3 + 2] = (0.12 + shade * 0.2) * t;
    }
    (this.dirtPoints.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate =
      true;
    (this.dirtPoints.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate =
      true;
    this.dirtPoints.geometry.setDrawRange(0, this.dirt.length);
    (this.dirtPoints.material as THREE.PointsMaterial).opacity =
      this.dirt.length > 0 ? 0.7 : 0;
    void this.tmp;
  }

  clear(): void {
    this.sparks.length = 0;
    this.dirt.length = 0;
    this.sparkPoints.geometry.setDrawRange(0, 0);
    this.dirtPoints.geometry.setDrawRange(0, 0);
  }
}
