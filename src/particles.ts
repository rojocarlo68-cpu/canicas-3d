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


type ShatterParticle = {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  color: THREE.Color;
  spin: THREE.Vector3;
};

type MoneyParticle = {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  phase: number;
  /** 0 = fly/arc in world, 1 = home toward HUD world target */
  stage: 0 | 1;
  /** Angular velocity for paper tumble (rad/s) */
  spin: THREE.Vector3;
  /** Current euler tumble */
  rot: THREE.Euler;
  scale: number;
};

const SPARK_MAX = 96;
const DIRT_MAX = 48;
const MONEY_MAX = 48;
const SHATTER_MAX = 64;

/** Procedural 2D dollar-bill texture (green paper, border, $). */
function makeBillTexture(): THREE.CanvasTexture {
  const w = 128;
  const h = 64;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // Paper base
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#3d8f55');
  grad.addColorStop(0.45, '#4caf6a');
  grad.addColorStop(1, '#2e7a45');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Soft paper noise stripes
  ctx.globalAlpha = 0.12;
  for (let i = 0; i < 18; i++) {
    ctx.strokeStyle = i % 2 === 0 ? '#1b5e30' : '#a5d6a7';
    ctx.beginPath();
    ctx.moveTo(0, 4 + i * 3.4);
    ctx.lineTo(w, 2 + i * 3.4);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Outer border
  ctx.strokeStyle = '#1b4332';
  ctx.lineWidth = 4;
  ctx.strokeRect(3, 3, w - 6, h - 6);
  // Inner ornate border
  ctx.strokeStyle = '#81c784';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(8, 8, w - 16, h - 16);

  // Corner flourishes
  ctx.fillStyle = '#c8e6c9';
  const corners: [number, number][] = [
    [14, 14],
    [w - 14, 14],
    [14, h - 14],
    [w - 14, h - 14],
  ];
  for (const [cx, cy] of corners) {
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Center oval
  ctx.strokeStyle = '#2e7d32';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(w / 2, h / 2, 22, 16, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Big $
  ctx.fillStyle = '#e8f5e9';
  ctx.strokeStyle = '#1b5e20';
  ctx.lineWidth = 2;
  ctx.font = 'bold 36px Georgia, "Times New Roman", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeText('$', w / 2, h / 2 + 1);
  ctx.fillText('$', w / 2, h / 2 + 1);

  // Small denomination marks
  ctx.fillStyle = '#a5d6a7';
  ctx.font = 'bold 11px sans-serif';
  ctx.fillText('2', 22, h / 2 + 4);
  ctx.fillText('2', w - 22, h / 2 + 4);

  // Seal-ish circle left
  ctx.strokeStyle = '#66bb6a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(36, h / 2, 9, 0, Math.PI * 2);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Lightweight CPU particles: impact sparks, subtle dirt dust,
 * and textured 2D paper-bill quads that flutter toward the saldo HUD.
 */
export class ParticleFX {
  readonly sparkPoints: THREE.Points;
  readonly dirtPoints: THREE.Points;
  readonly moneyMesh: THREE.InstancedMesh;

  private sparks: SparkParticle[] = [];
  private dirt: DirtParticle[] = [];
  private money: MoneyParticle[] = [];
  private shatter: ShatterParticle[] = [];

  private sparkPos: Float32Array;
  private sparkCol: Float32Array;
  private dirtPos: Float32Array;
  private dirtCol: Float32Array;
  private shatterPos: Float32Array;
  private shatterCol: Float32Array;
  readonly shatterPoints: THREE.Points;

  private hudTarget = new THREE.Vector3(0, 0.12, 0);
  private tmp = new THREE.Vector3();
  private dummy = new THREE.Object3D();
  private billTex: THREE.CanvasTexture;

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
      size: 0.006,
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

    this.shatterPos = new Float32Array(SHATTER_MAX * 3);
    this.shatterCol = new Float32Array(SHATTER_MAX * 3);
    const shatterGeo = new THREE.BufferGeometry();
    shatterGeo.setAttribute('position', new THREE.BufferAttribute(this.shatterPos, 3));
    shatterGeo.setAttribute('color', new THREE.BufferAttribute(this.shatterCol, 3));
    shatterGeo.setDrawRange(0, 0);
    const shatterMat = new THREE.PointsMaterial({
      size: 0.008,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.shatterPoints = new THREE.Points(shatterGeo, shatterMat);
    this.shatterPoints.frustumCulled = false;
    scene.add(this.shatterPoints);


    // Paper bill quads (aspect ~2:1 like a banknote)
    this.billTex = makeBillTexture();
    const billGeo = new THREE.PlaneGeometry(0.028, 0.013);
    const billMat = new THREE.MeshBasicMaterial({
      map: this.billTex,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      opacity: 1,
    });
    this.moneyMesh = new THREE.InstancedMesh(billGeo, billMat, MONEY_MAX);
    this.moneyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.moneyMesh.frustumCulled = false;
    this.moneyMesh.count = 0;
    if (this.shatterPoints) this.shatterPoints.geometry.setDrawRange(0, 0);
    // Hide unused instances below ground
    this.dummy.position.set(0, -10, 0);
    this.dummy.scale.setScalar(0.001);
    this.dummy.updateMatrix();
    for (let i = 0; i < MONEY_MAX; i++) {
      this.moneyMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.moneyMesh.instanceMatrix.needsUpdate = true;
    scene.add(this.moneyMesh);
  }

  /** World-space point corresponding to the player score/saldo HUD. */
  setHudTarget(x: number, y: number, z: number): void {
    this.hudTarget.set(x, y, z);
  }

  /** Exaggerated metal-style sparks at contact. */
  spawnSparks(x: number, y: number, z: number, intensity = 1): void {
    const n = Math.min(14, Math.floor(5 + intensity * 9));
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
        size: 0.003 + Math.random() * 0.004,
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
   * Burst of paper-bill quads that arc then flutter toward the HUD target.
   * @param mild weaker burst for opponent knockouts
   */
  spawnMoney(x: number, y: number, z: number, mild = false): void {
    const n = mild ? 4 : 9;
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
        life: mild ? 0.75 + Math.random() * 0.3 : 1.1 + Math.random() * 0.35,
        maxLife: 1.2,
        phase: Math.random() * Math.PI * 2,
        stage: 0,
        spin: new THREE.Vector3(
          (Math.random() - 0.5) * 8,
          (Math.random() - 0.5) * 10,
          (Math.random() - 0.5) * 6,
        ),
        rot: new THREE.Euler(
          Math.random() * Math.PI,
          Math.random() * Math.PI,
          Math.random() * Math.PI,
        ),
        scale: mild ? 0.75 + Math.random() * 0.2 : 0.9 + Math.random() * 0.35,
      });
      const p = this.money[this.money.length - 1]!;
      p.maxLife = p.life;
    }
  }


  /**
   * Crystal/glass shatter burst — used when a zombie destroys a healthy marble.
   * Reuses spark/dirt style points with sharper colors and outward shards.
   */
  spawnShatter(x: number, y: number, z: number, colorHex = 0xb3e5fc, intensity = 1): void {
    const n = Math.min(28, Math.floor(14 + intensity * 12));
    const base = new THREE.Color(colorHex);
    for (let i = 0; i < n; i++) {
      if (this.shatter.length >= SHATTER_MAX) this.shatter.shift();
      const speed = 0.35 + Math.random() * 1.1 * intensity;
      const theta = Math.random() * Math.PI * 2;
      const elev = 0.35 + Math.random() * 1.15;
      const tint = base.clone().offsetHSL((Math.random() - 0.5) * 0.08, 0, (Math.random() - 0.5) * 0.25);
      this.shatter.push({
        pos: new THREE.Vector3(
          x + (Math.random() - 0.5) * 0.006,
          y + (Math.random() - 0.5) * 0.006,
          z + (Math.random() - 0.5) * 0.006,
        ),
        vel: new THREE.Vector3(
          Math.cos(theta) * speed * (0.5 + Math.random()),
          elev * speed * 0.7,
          Math.sin(theta) * speed * (0.5 + Math.random()),
        ),
        life: 0.22 + Math.random() * 0.35,
        maxLife: 0.45,
        size: 0.003 + Math.random() * 0.007,
        color: tint,
        spin: new THREE.Vector3(
          (Math.random() - 0.5) * 12,
          (Math.random() - 0.5) * 12,
          (Math.random() - 0.5) * 12,
        ),
      });
      const p = this.shatter[this.shatter.length - 1]!;
      p.maxLife = p.life;
    }
    // Also kick a few sparks for punch
    this.spawnSparks(x, y, z, intensity * 1.2);
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
      this.sparks.length > 0 ? 0.006 : 0.005;

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

    // Money bills — burst, tumble/flutter, then home toward HUD
    
    // Shatter crystal shards
    for (let i = this.shatter.length - 1; i >= 0; i--) {
      const p = this.shatter[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        this.shatter.splice(i, 1);
        continue;
      }
      p.vel.y -= 4.5 * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(0.98);
    }
    {
      const n = this.shatter.length;
      this.shatterPoints.geometry.setDrawRange(0, n);
      for (let i = 0; i < n; i++) {
        const p = this.shatter[i]!;
        const o = i * 3;
        this.shatterPos[o] = p.pos.x;
        this.shatterPos[o + 1] = p.pos.y;
        this.shatterPos[o + 2] = p.pos.z;
        const fade = Math.max(0, p.life / p.maxLife);
        this.shatterCol[o] = p.color.r * fade;
        this.shatterCol[o + 1] = p.color.g * fade;
        this.shatterCol[o + 2] = p.color.b * fade;
      }
      (this.shatterPoints.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (this.shatterPoints.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
      const sm = this.shatterPoints.material as THREE.PointsMaterial;
      sm.opacity = n > 0 ? 0.95 : 0;
      sm.size = 0.007;
    }

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
      // Paper tumble
      p.rot.x += p.spin.x * dt;
      p.rot.y += p.spin.y * dt;
      p.rot.z += p.spin.z * dt;
      // Flutter damping over time
      p.spin.multiplyScalar(0.985);

      if (p.stage === 0) {
        p.vel.y -= 2.8 * dt;
        p.pos.addScaledVector(p.vel, dt);
        p.vel.x *= 0.96;
        p.vel.z *= 0.96;
        p.pos.x += Math.sin(p.phase + age * 10) * 0.0025;
        p.pos.z += Math.cos(p.phase + age * 8) * 0.002;
      } else {
        this.tmp.copy(this.hudTarget).sub(p.pos);
        const dist = this.tmp.length();
        if (dist < 0.025) {
          this.money.splice(i, 1);
          continue;
        }
        this.tmp.normalize();
        const speed = 0.55 + age * 1.15;
        p.pos.addScaledVector(this.tmp, speed * dt);
        // Soft flutter while homing
        p.pos.y += Math.sin(p.phase + age * 14) * 0.002;
        p.pos.x += Math.cos(p.phase + age * 11) * 0.0012;
      }
    }

    // Sync instanced bill matrices
    const n = this.money.length;
    this.moneyMesh.count = n;
    for (let i = 0; i < MONEY_MAX; i++) {
      const p = this.money[i];
      if (!p) {
        this.dummy.position.set(0, -10, 0);
        this.dummy.scale.setScalar(0.001);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.updateMatrix();
        this.moneyMesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }
      const t = p.life / p.maxLife;
      const fadeScale = p.scale * (0.85 + 0.15 * t);
      this.dummy.position.copy(p.pos);
      this.dummy.rotation.copy(p.rot);
      this.dummy.scale.set(fadeScale, fadeScale, fadeScale);
      this.dummy.updateMatrix();
      this.moneyMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.moneyMesh.instanceMatrix.needsUpdate = true;
    const mat = this.moneyMesh.material as THREE.MeshBasicMaterial;
    mat.opacity = n > 0 ? 0.95 : 0;
  }

  clear(): void {
    this.sparks.length = 0;
    this.dirt.length = 0;
    this.money.length = 0;
    this.shatter.length = 0;
    this.sparkPoints.geometry.setDrawRange(0, 0);
    this.dirtPoints.geometry.setDrawRange(0, 0);
    this.moneyMesh.count = 0;
  }
}
