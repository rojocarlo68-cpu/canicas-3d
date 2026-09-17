import * as THREE from 'three';

type Bird = {
  mesh: THREE.Group;
  /** Horizontal circle / transit path */
  mode: 'circle' | 'cross';
  radius: number;
  angle: number;
  speed: number;
  height: number;
  wingPhase: number;
  wingSpeed: number;
  /** For cross-mode: start/end along an axis */
  axis: 'x' | 'z';
  sign: number;
  progress: number;
  wait: number;
};


/**
 * Subtle far-away park ambient life: birds.
 * Low detail, never competing with the play circle.
 */
export class ParkLife {
  readonly root = new THREE.Group();
  private birds: Bird[] = [];
  private birdSpawnTimer = 2;

  constructor(scene: THREE.Scene) {
    this.root.name = 'parkLife';
    scene.add(this.root);
    // A couple of circling birds always present
    for (let i = 0; i < 3; i++) {
      this.spawnCirclingBird(6 + i * 3.5, 4.5 + i * 0.8);
    }
  }

  private makeBirdMesh(): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: 0x1a1a1a,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    // Simple V / winged silhouette
    const wingGeo = new THREE.ConeGeometry(0.12, 0.55, 3);
    const left = new THREE.Mesh(wingGeo, mat);
    left.rotation.z = Math.PI / 2.4;
    left.rotation.y = 0.15;
    left.position.set(-0.18, 0, 0);
    left.name = 'wingL';
    const right = new THREE.Mesh(wingGeo, mat.clone());
    right.rotation.z = -Math.PI / 2.4;
    right.rotation.y = -0.15;
    right.position.set(0.18, 0, 0);
    right.name = 'wingR';
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 4, 3),
      mat.clone(),
    );
    g.add(left, right, body);
    g.scale.setScalar(0.55);
    return g;
  }

  private spawnCirclingBird(radius: number, height: number): void {
    const mesh = this.makeBirdMesh();
    this.root.add(mesh);
    this.birds.push({
      mesh,
      mode: 'circle',
      radius,
      angle: Math.random() * Math.PI * 2,
      speed: 0.18 + Math.random() * 0.22,
      height,
      wingPhase: Math.random() * Math.PI * 2,
      wingSpeed: 6 + Math.random() * 4,
      axis: 'x',
      sign: 1,
      progress: 0,
      wait: 0,
    });
  }

  private spawnCrossingBird(): void {
    if (this.birds.filter((b) => b.mode === 'cross').length >= 2) return;
    const mesh = this.makeBirdMesh();
    this.root.add(mesh);
    const axis: 'x' | 'z' = Math.random() < 0.5 ? 'x' : 'z';
    const sign = Math.random() < 0.5 ? 1 : -1;
    this.birds.push({
      mesh,
      mode: 'cross',
      radius: 18,
      angle: 0,
      speed: 3.5 + Math.random() * 2,
      height: 5 + Math.random() * 4,
      wingPhase: Math.random() * Math.PI * 2,
      wingSpeed: 8 + Math.random() * 3,
      axis,
      sign,
      progress: -22,
      wait: 0,
    });
  }



  update(dt: number): void {
    this.birdSpawnTimer -= dt;
    if (this.birdSpawnTimer <= 0) {
      this.spawnCrossingBird();
      this.birdSpawnTimer = 8 + Math.random() * 14;
    }

    for (let i = this.birds.length - 1; i >= 0; i--) {
      const b = this.birds[i]!;
      b.wingPhase += b.wingSpeed * dt;
      const flap = Math.sin(b.wingPhase) * 0.35;
      const wingL = b.mesh.getObjectByName('wingL');
      const wingR = b.mesh.getObjectByName('wingR');
      if (wingL) wingL.rotation.x = flap;
      if (wingR) wingR.rotation.x = -flap;

      if (b.mode === 'circle') {
        b.angle += b.speed * dt;
        const x = Math.cos(b.angle) * b.radius;
        const z = Math.sin(b.angle) * b.radius;
        b.mesh.position.set(x, b.height + Math.sin(b.angle * 2) * 0.25, z);
        // Face tangent
        b.mesh.rotation.y = -b.angle + Math.PI / 2;
      } else {
        b.progress += b.speed * b.sign * dt;
        if (b.axis === 'x') {
          b.mesh.position.set(
            b.progress,
            b.height,
            Math.sin(b.progress * 0.15) * 4,
          );
          b.mesh.rotation.y = b.sign > 0 ? Math.PI / 2 : -Math.PI / 2;
        } else {
          b.mesh.position.set(
            Math.sin(b.progress * 0.15) * 4,
            b.height,
            b.progress,
          );
          b.mesh.rotation.y = b.sign > 0 ? 0 : Math.PI;
        }
        if (Math.abs(b.progress) > 24) {
          this.root.remove(b.mesh);
          this.birds.splice(i, 1);
        }
      }
    }

  }
}
