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

type MoneyParticle = {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  phase: number;
  /** 0 = fly/arc in world, 1 = home toward HUD world target */
  stage: 0 | 1;
};

const SPARK_MAX = 96;
const DIRT_MAX = 48;
const MONEY_MAX = 64;

/**
 * Lightweight CPU particles: impact sparks, subtle dirt dust, money bills.
 */
export class ParticleFX {
  readonly sparkPoints: THREE.Points;
  readonly dirtPoints: THREE.Points;
  readonly moneyPoints: THREE.Points;

  private sparks: SparkParticle[] = [];
  private dirt: DirtParticle[] = [];
  private money: MoneyParticle[] = [];

  private sparkPos: Float32Array;
  private sparkCol: Float32Array;
  private dirtPos: Float32Array;
  private dirtCol: Float32Array;
  private moneyPos: Float32Array;
  private moneyCol: Float32Array;

  private hudTarget = new THREE.Vector3(0, 0.12, 0);
  private tmp = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.sparkPos = new Float32Array(SPARK_MAX * 3);
    this.sparkCol = new Float32Array(SPARK_MAX * 3);
    this.dirtPos = new Float32Array(DIRT_MAX * 3);
    this.dirtCol = new Float32Array(DIRT_MAX * 3);
    this.moneyPos = new Float32Array(MONEY_MAX * 3);
    this.moneyCol = new Float32Array(MONEY_MAX * 3);

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
      size: 0.0045,
      vertexColors: true,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.dirtPoints = new THREE.Points(dirtGeo, dirtMat);
    this.dirtPoints.frustumCulled = false;
    scene.add(this.dirtPoints);

    const moneyGeo = new THREE.BufferGeometry();
    moneyGeo.setAttribute('position', new THREE.BufferAttribute(this.moneyPos, 3));
    moneyGeo.setAttribute('color', new THREE.BufferAttribute(this.moneyCol, 3));
    moneyGeo.setDrawRange(0, 0);
    const moneyMat = new THREE.PointsMaterial({
      size: 0.016,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.moneyPoints = new THREE.Points(moneyGeo, moneyMat);
    this.moneyPoints.frustumCulled = false;
    scene.add(this.moneyPoints);
  }

  /** World-space point corresponding to the player score/saldo HUD. */
  setHudTarget(x: number, y: number, z: number): void {
    this.hudTarget.set(x, y, z);
  }

  /** Exaggerated metal-style sparks at contact. */
  spawnSparks(x: number, y: number, z: number, intensity = 1): void {
    const n = Math.min(22, Math.floor(8 + intensity * 14));
    for (let i = 0; i < n; i++) {
      if (this.sparks.length >= SPARK_MAX) this.sparks.shift();
      const speed = 0.3 + Math.random() * 0.95 * intensity;
      const theta = Math.random() * Math.PI * 2;
      const elev = 0.25 + Math.random() * 1.0;
      this.sparks.push({
        pos: new THREE.Vector3(x, y, z),
        vel: new THREE.Vector3(
          Math.cos(theta) * speed * (0.4 + Math.random()),
          elev * speed,
          Math.sin(theta) * speed * (0.4 + Math.random()),
        ),
        life: 0.1 + Math.random() * 0.2,
        maxLife: 0.25,
        size: 0.006 + Math.random() * 0.008,
      });
      const p = this.sparks[this.sparks.length - 1]!;
      p.maxLife = p.life;
    }
  }

  /**
   * Tiny, sparse, barely-perceptible dust.
   * Scales lightly with speed but stays subtle so marble paths stay visible.
   */
  spawnDirt(x: number, y: number, z: number, intensity = 1): void {
    const n = Math.min(5, Math.floor(1 + intensity * 2.2));
    for (let i = 0; i < n; i++) {
      if (this.dirt.length >= DIRT_MAX) this.dirt.shift();
      const speed = 0.02 + Math.random() * 0.08 * Math.min(1, intensity);
      const theta = Math.random() * Math.PI * 2;
      this.dirt.push({
        pos: new THREE.Vector3(
          x + (Math.random() - 0.5) * 0.004,
          Math.max(0.0015, y),
          z + (Math.random() - 0.5) * 0.004,
        ),
        vel: new THREE.Vector3(
          Math.cos(theta) * speed,
          0.015 + Math.random() * 0.045 * Math.min(1, intensity),
          Math.sin(theta) * speed,
        ),
        life: 0.1 + Math.random() * 0.16,
        maxLife: 0.22,
        size: 0.002 + Math.random() * 0.0035,
      });
      const p = this.dirt[this.dirt.length - 1]!;
      p.maxLife = p.life;
    }
  }

  /**
   * Burst of small bill/money particles that arc then fly toward the HUD target.
   * @param mild weaker burst for opponent knockouts
   */
  spawnMoney(x: number, y: number, z: number, mild = false): void {
    const n = mild ? 4 : 10;
    for (let i = 0; i < n; i++) {
      if (this.money.length >= MONEY_MAX) this.money.shift();
      const theta = Math.random() * Math.PI * 2;
      const burst = mild ? 0.08 : 0.16;
      this.money.push({
        pos: new THREE.Vector3(
          x + (Math.random() - 0.5) * 0.01,
          y + 0.02 + Math.random() * 0.03,
          z + (Math.random() - 0.5) * 0.01,
        ),
        vel: new THREE.Vector3(
          Math.cos(theta) * burst * (0.4 + Math.random()),
          (mild ? 0.18 : 0.32) + Math.random() * 0.22,
          Math.sin(theta) * burst * (0.4 + Math.random()),
        ),
        life: mild ? 0.7 + Math.random() * 0.3 : 1.05 + Math.random() * 0.35,
        maxLife: 1.2,
        phase: Math.random() * Math.PI * 2,
        stage: 0,
      });
      const p = this.money[this.money.length - 1]!;
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
      this.sparks.length > 0 ? 0.012 : 0.01;

    // Dirt — tiny & faint
    for (let i = this.dirt.length - 1; i >= 0; i--) {
      const p = this.dirt[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        this.dirt.splice(i, 1);
        continue;
      }
      p.vel.y -= 1.2 * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.vel.x *= 0.88;
      p.vel.z *= 0.88;
      if (p.pos.y < 0.001) {
        p.pos.y = 0.001;
        p.vel.y *= -0.1;
        p.vel.x *= 0.6;
        p.vel.z *= 0.6;
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
      const shade = 0.28 + (p.size * 40) % 0.1;
      // Very low brightness so dust is barely perceptible
      const fade = t * 0.45;
      this.dirtCol[i * 3] = (0.48 + shade) * fade;
      this.dirtCol[i * 3 + 1] = (0.28 + shade * 0.5) * fade;
      this.dirtCol[i * 3 + 2] = (0.12 + shade * 0.2) * fade;
    }
    (this.dirtPoints.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate =
      true;
    (this.dirtPoints.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate =
      true;
    this.dirtPoints.geometry.setDrawRange(0, this.dirt.length);
    (this.dirtPoints.material as THREE.PointsMaterial).opacity =
      this.dirt.length > 0 ? 0.22 : 0;
    (this.dirtPoints.material as THREE.PointsMaterial).size = 0.004;

    // Money bills — burst up, then home toward HUD
    for (let i = this.money.length - 1; i >= 0; i--) {
      const p = this.money[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        this.money.splice(i, 1);
        continue;
      }
      const age = 1 - p.life / p.maxLife;
      if (p.stage === 0 && age > 0.28) {
        p.stage = 1;
      }
      if (p.stage === 0) {
        p.vel.y -= 2.8 * dt;
        p.pos.addScaledVector(p.vel, dt);
        p.vel.x *= 0.96;
        p.vel.z *= 0.96;
        p.pos.x += Math.sin(p.phase + age * 10) * 0.002;
      } else {
        this.tmp.copy(this.hudTarget).sub(p.pos);
        const dist = this.tmp.length();
        if (dist < 0.02) {
          this.money.splice(i, 1);
          continue;
        }
        this.tmp.normalize();
        const speed = 0.55 + age * 1.1;
        p.pos.addScaledVector(this.tmp, speed * dt);
        p.pos.y += Math.sin(p.phase + age * 14) * 0.0015;
      }
    }
    for (let i = 0; i < MONEY_MAX; i++) {
      const p = this.money[i];
      if (!p) {
        this.moneyPos[i * 3] = 0;
        this.moneyPos[i * 3 + 1] = -10;
        this.moneyPos[i * 3 + 2] = 0;
        this.moneyCol[i * 3] = 0;
        this.moneyCol[i * 3 + 1] = 0;
        this.moneyCol[i * 3 + 2] = 0;
        continue;
      }
      const t = p.life / p.maxLife;
      this.moneyPos[i * 3] = p.pos.x;
      this.moneyPos[i * 3 + 1] = p.pos.y;
      this.moneyPos[i * 3 + 2] = p.pos.z;
      // Green bill tones with slight gold highlight
      this.moneyCol[i * 3] = (0.25 + 0.35 * t) * (0.7 + 0.3 * t);
      this.moneyCol[i * 3 + 1] = (0.72 + 0.2 * t) * (0.75 + 0.25 * t);
      this.moneyCol[i * 3 + 2] = (0.22 + 0.15 * t) * t;
    }
    (this.moneyPoints.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate =
      true;
    (this.moneyPoints.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate =
      true;
    this.moneyPoints.geometry.setDrawRange(0, this.money.length);
    (this.moneyPoints.material as THREE.PointsMaterial).size =
      this.money.length > 0 ? 0.018 : 0.01;
    void this.tmp;
  }

  clear(): void {
    this.sparks.length = 0;
    this.dirt.length = 0;
    this.money.length = 0;
    this.sparkPoints.geometry.setDrawRange(0, 0);
    this.dirtPoints.geometry.setDrawRange(0, 0);
    this.moneyPoints.geometry.setDrawRange(0, 0);
  }
}
