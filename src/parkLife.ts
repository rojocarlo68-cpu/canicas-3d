import * as THREE from 'three';
import { BOUNDARY_RADIUS } from './constants';

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

type Walker = {
  mesh: THREE.Group;
  path: THREE.CatmullRomCurve3;
  t: number;
  speed: number;
  bobPhase: number;
};

/**
 * Subtle far-away park ambient life: birds and silhouette walkers.
 * Low detail, never competing with the play circle.
 */
export class ParkLife {
  readonly root = new THREE.Group();
  private birds: Bird[] = [];
  private walkers: Walker[] = [];
  private birdSpawnTimer = 2;

  constructor(scene: THREE.Scene) {
    this.root.name = 'parkLife';
    scene.add(this.root);
    this.seedWalkers();
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

  private makePersonMesh(): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: 0x151515,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    // Head
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.07, 5, 4), mat);
    head.position.y = 0.92;
    // Torso
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.4, 5), mat);
    torso.position.y = 0.65;
    // Legs as one thin block (silhouette)
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.38, 0.08), mat);
    legs.position.y = 0.22;
    g.add(head, torso, legs);
    g.scale.setScalar(0.85);
    return g;
  }

  private seedWalkers(): void {
    const playClear = BOUNDARY_RADIUS + 0.8;
    const paths: THREE.Vector3[][] = [
      [
        new THREE.Vector3(playClear + 0.5, 0, -2),
        new THREE.Vector3(4.5, 0, -0.5),
        new THREE.Vector3(7.0, 0, 1.2),
        new THREE.Vector3(9.5, 0, -0.8),
        new THREE.Vector3(12, 0, 0.5),
      ],
      [
        new THREE.Vector3(-(playClear + 0.4), 0, 1.5),
        new THREE.Vector3(-4.0, 0, 0.2),
        new THREE.Vector3(-6.5, 0, -1.0),
        new THREE.Vector3(-9.0, 0, 0.8),
        new THREE.Vector3(-12, 0, -0.3),
      ],
      [
        new THREE.Vector3(-1.5, 0, playClear + 0.6),
        new THREE.Vector3(0.5, 0, 5.0),
        new THREE.Vector3(-0.8, 0, 7.5),
        new THREE.Vector3(1.2, 0, 10.5),
      ],
      [
        new THREE.Vector3(2.0, 0, -(playClear + 0.5)),
        new THREE.Vector3(-0.5, 0, -5.5),
        new THREE.Vector3(1.0, 0, -8.5),
        new THREE.Vector3(-1.5, 0, -12),
      ],
    ];

    for (let i = 0; i < paths.length; i++) {
      const pts = paths[i]!;
      const curve = new THREE.CatmullRomCurve3(pts, false);
      const mesh = this.makePersonMesh();
      this.root.add(mesh);
      this.walkers.push({
        mesh,
        path: curve,
        t: Math.random(),
        speed: 0.025 + Math.random() * 0.02,
        bobPhase: Math.random() * Math.PI * 2,
      });
    }
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

    for (const w of this.walkers) {
      w.t += w.speed * dt;
      if (w.t > 1) w.t -= 1;
      const pos = w.path.getPointAt(w.t);
      const next = w.path.getPointAt(Math.min(0.999, w.t + 0.01));
      w.bobPhase += dt * 5;
      const bob = Math.abs(Math.sin(w.bobPhase)) * 0.02;
      w.mesh.position.set(pos.x, bob, pos.z);
      const dx = next.x - pos.x;
      const dz = next.z - pos.z;
      w.mesh.rotation.y = Math.atan2(dx, dz);
    }
  }
}
