import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { BOUNDARY_RADIUS, CIRCLE_RADIUS, PLAY_SURFACE_Y } from './constants';

export type DesertCampBuild = {
  root: THREE.Group;
  /** Warm PointLight from the campfire (main night illumination). */
  fireLight: THREE.PointLight;
  /** Call each frame for flame flicker / particles. */
  update: (dt: number, nightAmount: number) => void;
  /** Extra static physics bodies (bumps / rocks / stones) — caller adds to world. */
  bumpBodies: CANNON.Body[];
  /** Cannon material for stone props (friction/restitution like rock). */
  stoneMat: CANNON.Material;
  /** Star field mesh (opacity driven by night). */
  stars: THREE.Points;
};

/**
 * Night desert camp around the play patch: sand, mountains only,
 * imperfect finger-drawn circle, campfire + seating, subtle undulation.
 */
export function buildDesertCamp(
  scene: THREE.Scene,
  groundMat: CANNON.Material,
): DesertCampBuild {
  const root = new THREE.Group();
  root.name = 'desertCamp';
  const bumpBodies: CANNON.Body[] = [];
  /** Stone-like contact: grippy, modest bounce. */
  const stoneMat = new CANNON.Material('stone');
  void groundMat; // play pad uses world ground plane
  const playR = CIRCLE_RADIUS;
  const sandOuter = playR * 1.85;
  const innerClear = BOUNDARY_RADIUS + 0.2;

  // --- Vast sand floor (ring outside play pad) ---
  const sandMat = new THREE.MeshStandardMaterial({
    color: '#c4a574',
    roughness: 0.98,
    metalness: 0,
  });
  const dunes = new THREE.Mesh(
    new THREE.RingGeometry(sandOuter * 0.96, 32, 72),
    sandMat,
  );
  dunes.rotation.x = -Math.PI / 2;
  dunes.position.y = 0.001;
  dunes.receiveShadow = true;
  root.add(dunes);

  // Distant dune apron
  const apron = new THREE.Mesh(
    new THREE.RingGeometry(28, 42, 48),
    new THREE.MeshStandardMaterial({ color: '#a88858', roughness: 1 }),
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = 0.0004;
  root.add(apron);

  // --- Undulating sand play pad ---
  const padSeg = 48;
  const padGeo = new THREE.CircleGeometry(sandOuter, padSeg);
  const padPos = padGeo.attributes.position!;
  for (let i = 0; i < padPos.count; i++) {
    const x = padPos.getX(i);
    const y = padPos.getY(i); // in XY before rotate
    const r = Math.hypot(x, y);
    // Keep very center flatter for drop hopper; subtle bumps outward
    const edge = Math.min(1, r / (playR * 0.55));
    const n =
      (Math.sin(x * 28 + 0.4) * Math.cos(y * 24) * 0.0022 +
        Math.sin(x * 11.3 + y * 9.7) * 0.0035 +
        Math.sin(x * 5.1 - y * 6.2) * 0.0028) *
      edge;
    padPos.setZ(i, n);
  }
  padGeo.computeVertexNormals();
  const padMat = new THREE.MeshStandardMaterial({
    color: '#d2b48c',
    roughness: 0.99,
    metalness: 0,
    flatShading: false,
  });
  const pad = new THREE.Mesh(padGeo, padMat);
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = PLAY_SURFACE_Y;
  pad.receiveShadow = true;
  pad.renderOrder = 1;
  root.add(pad);

  // Soft darker sand blend
  const blend = new THREE.Mesh(
    new THREE.RingGeometry(sandOuter * 0.88, sandOuter * 1.4, 64),
    new THREE.MeshStandardMaterial({
      color: '#9a7a4a',
      roughness: 1,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    }),
  );
  blend.rotation.x = -Math.PI / 2;
  blend.position.y = PLAY_SURFACE_Y + 0.00025;
  blend.renderOrder = 2;
  root.add(blend);

  // --- Imperfect finger-drawn circle in sand ---
  root.add(makeImperfectSandCircle(playR));

  // --- Physics + visual bumps / rocks inside play area ---
  const rockMat = new THREE.MeshStandardMaterial({
    color: '#6e6358',
    roughness: 0.92,
    flatShading: true,
  });
  const rockMat2 = new THREE.MeshStandardMaterial({
    color: '#8a7d6e',
    roughness: 0.95,
    flatShading: true,
  });
  const bumpSlots: { x: number; z: number; r: number; h: number }[] = [
    { x: 0.11, z: -0.14, r: 0.018, h: 0.0035 },
    { x: -0.18, z: 0.09, r: 0.022, h: 0.004 },
    { x: 0.2, z: 0.16, r: 0.015, h: 0.0028 },
    { x: -0.08, z: -0.22, r: 0.02, h: 0.0032 },
    { x: 0.05, z: 0.24, r: 0.014, h: 0.0025 },
    { x: -0.24, z: -0.05, r: 0.017, h: 0.003 },
    { x: 0.26, z: -0.08, r: 0.013, h: 0.0022 },
    // Outside circle, near seating
    { x: 0.48, z: 0.35, r: 0.04, h: 0.018 },
    { x: 0.55, z: 0.22, r: 0.032, h: 0.014 },
    { x: -0.42, z: 0.48, r: 0.036, h: 0.016 },
  ];
  for (let i = 0; i < bumpSlots.length; i++) {
    const b = bumpSlots[i]!;
    const geo = new THREE.DodecahedronGeometry(b.r, 0);
    const mesh = new THREE.Mesh(geo, i % 2 === 0 ? rockMat : rockMat2);
    mesh.position.set(b.x, PLAY_SURFACE_Y + b.h * 0.35, b.z);
    mesh.scale.set(1, 0.55 + (i % 3) * 0.12, 1.1);
    mesh.rotation.set(i * 0.4, i * 0.7, i * 0.2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);

    // Solid mound: sphere matches flattened visual, sunk into pad so there is
    // no undercut wedge against the ground plane (AI was embedding in props).
    const yScale = 0.55 + (i % 3) * 0.12;
    const sr = Math.max(b.r * 0.95, b.h * 1.6 + 0.006);
    const body = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      material: stoneMat,
      shape: new CANNON.Sphere(sr),
    });
    // ~45% embed → bottom below PLAY_SURFACE_Y, contact face flush with pad
    body.position.set(b.x, PLAY_SURFACE_Y + sr * (0.55 * yScale), b.z);
    bumpBodies.push(body);
  }

  // Scattered mid-distance rocks (+ static colliders so marbles bounce)
  const dummy = new THREE.Object3D();
  const scatGeo = new THREE.DodecahedronGeometry(0.12, 0);
  const scat = new THREE.InstancedMesh(scatGeo, rockMat, 28);
  let si = 0;
  for (let i = 0; i < 40 && si < 28; i++) {
    const a = (i / 28) * Math.PI * 2 + (i % 5) * 0.13;
    const r = innerClear + 0.8 + (i % 6) * 1.1;
    if (r < sandOuter + 0.3) continue;
    const px = Math.cos(a) * r;
    const pz = Math.sin(a) * r;
    const s = 0.45 + (i % 4) * 0.28;
    dummy.position.set(px, 0.04, pz);
    dummy.rotation.set(i * 0.3, i * 0.5, i * 0.2);
    dummy.scale.set(s, s * 0.55, s * 1.1);
    dummy.updateMatrix();
    scat.setMatrixAt(si++, dummy.matrix);

    const rockR = 0.12 * s * 0.7;
    const body = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      material: stoneMat,
      shape: new CANNON.Sphere(rockR),
    });
    // Embed into sand — no shelf for marbles to tunnel under
    body.position.set(px, PLAY_SURFACE_Y + rockR * 0.45, pz);
    bumpBodies.push(body);
  }
  scat.count = si;
  scat.instanceMatrix.needsUpdate = true;
  scat.castShadow = true;
  root.add(scat);

  // --- Horizon mountains only (no city) ---
  addDesertMountains(root);

  // --- Campfire beside the circle ---
  const fire = buildCampfire(
    playR * 1.55,
    playR * 0.55,
    bumpBodies,
    stoneMat,
  );
  root.add(fire.group);

  // Seating: logs + stones around the fire (solid)
  addCampSeating(
    root,
    fire.group.position.x,
    fire.group.position.z,
    bumpBodies,
    stoneMat,
  );

  // Sparse dry scrub / bushes (not park trees)
  const scrubMat = new THREE.MeshStandardMaterial({
    color: '#5a4a32',
    roughness: 0.95,
    flatShading: true,
  });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.4;
    const r = 5.5 + (i % 5) * 1.6;
    const scrub = new THREE.Mesh(
      new THREE.SphereGeometry(0.35 + (i % 3) * 0.12, 5, 4),
      scrubMat,
    );
    scrub.scale.y = 0.45;
    scrub.position.set(Math.cos(a) * r, 0.12, Math.sin(a) * r);
    root.add(scrub);
  }

  // Stars
  const stars = makeStarField();
  root.add(stars);

  scene.add(root);

  let flickerT = 0;
  const update = (dt: number, nightAmount: number) => {
    flickerT += dt;
    fire.update(dt, flickerT);
    const mat = stars.material as THREE.PointsMaterial;
    mat.opacity = 0.15 + nightAmount * 0.75;
    stars.visible = nightAmount > 0.15;
  };

  return {
    root,
    fireLight: fire.light,
    update,
    bumpBodies,
    stoneMat,
    stars,
  };
}

function makeImperfectSandCircle(radius: number): THREE.Group {
  const g = new THREE.Group();
  const segs = 80;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const a = t * Math.PI * 2;
    // Finger-drawn wobble — imperfect chalk-in-sand look
    const wobble =
      1 +
      Math.sin(a * 2.3) * 0.022 +
      Math.sin(a * 5.7 + 0.8) * 0.014 +
      Math.sin(a * 11.1 + 1.7) * 0.008 +
      Math.sin(a * 17.3) * 0.005;
    const r = radius * wobble;
    pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
  }
  const curve = new THREE.CatmullRomCurve3(pts, true);
  // Soft dark groove
  const groove = new THREE.Mesh(
    new THREE.TubeGeometry(curve, segs, 0.011, 5, true),
    new THREE.MeshStandardMaterial({
      color: '#3a2a18',
      roughness: 1,
      flatShading: true,
    }),
  );
  groove.position.y = PLAY_SURFACE_Y + 0.0004;
  groove.scale.y = 0.35;
  g.add(groove);

  // Lighter sand "ridge" beside the groove
  const ridge = new THREE.Mesh(
    new THREE.TubeGeometry(curve, segs, 0.006, 4, true),
    new THREE.MeshStandardMaterial({
      color: '#e8d4a8',
      roughness: 0.95,
      emissive: '#3a3020',
      emissiveIntensity: 0.08,
    }),
  );
  ridge.position.y = PLAY_SURFACE_Y + 0.001;
  ridge.scale.y = 0.4;
  g.add(ridge);

  // Sparse fill tint inside circle
  const fill = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 0.96, 48),
    new THREE.MeshBasicMaterial({
      color: '#5c4020',
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  fill.rotation.x = -Math.PI / 2;
  fill.position.y = PLAY_SURFACE_Y + 0.0002;
  fill.renderOrder = 2;
  g.add(fill);

  return g;
}

function addDesertMountains(root: THREE.Group): void {
  const mats = [
    new THREE.MeshStandardMaterial({ color: '#4a3d35', roughness: 1, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: '#5c4a40', roughness: 1, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: '#3d342c', roughness: 1, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: '#6a5548', roughness: 1, flatShading: true }),
  ];
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + 0.05;
    const dist = 44 + (i % 5) * 5;
    const h = 7 + (i % 6) * 2.2;
    const w = 6 + (i % 4) * 2.5;
    const mtn = new THREE.Mesh(
      new THREE.ConeGeometry(w * 0.55, h, 5),
      mats[i % mats.length]!,
    );
    mtn.position.set(Math.cos(a) * dist, h * 0.38, Math.sin(a) * dist);
    root.add(mtn);
    const foot = new THREE.Mesh(
      new THREE.SphereGeometry(w * 0.75, 6, 4),
      mats[(i + 1) % mats.length]!,
    );
    foot.scale.y = 0.32;
    foot.position.set(Math.cos(a) * (dist - 3), 1.0, Math.sin(a) * (dist - 3));
    root.add(foot);
  }
  // Soft night haze cylinder
  const haze = new THREE.Mesh(
    new THREE.CylinderGeometry(68, 68, 5, 28, 1, true),
    new THREE.MeshBasicMaterial({
      color: '#1a1520',
      transparent: true,
      opacity: 0.28,
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
  haze.position.y = 2.5;
  root.add(haze);
}

type CampfireRuntime = {
  group: THREE.Group;
  light: THREE.PointLight;
  update: (dt: number, t: number) => void;
};

function buildCampfire(
  x: number,
  z: number,
  bumpBodies: CANNON.Body[],
  stonePhysMat: CANNON.Material,
): CampfireRuntime {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  // Stone ring
  const stoneMat = new THREE.MeshStandardMaterial({
    color: '#5a534c',
    roughness: 0.9,
    flatShading: true,
  });
  const stoneMat2 = new THREE.MeshStandardMaterial({
    color: '#7a7268',
    roughness: 0.88,
    flatShading: true,
  });
  const ringR = 0.28;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const stone = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.055 + (i % 3) * 0.012, 0),
      i % 2 === 0 ? stoneMat : stoneMat2,
    );
    stone.position.set(Math.cos(a) * ringR, 0.035, Math.sin(a) * ringR);
    stone.scale.set(1.1, 0.65, 0.9);
    stone.rotation.set(i * 0.3, i * 0.5, 0);
    stone.castShadow = true;
    group.add(stone);

    // Solid stone-ring collider (flames stay non-solid); embed to kill undercuts
    const stoneR = 0.055 + (i % 3) * 0.012;
    const body = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      material: stonePhysMat,
      shape: new CANNON.Sphere(stoneR * 0.9),
    });
    body.position.set(
      x + Math.cos(a) * ringR,
      PLAY_SURFACE_Y + stoneR * 0.45,
      z + Math.sin(a) * ringR,
    );
    bumpBodies.push(body);
  }

  // Charred logs under flames
  const logMat = new THREE.MeshStandardMaterial({
    color: '#2a1a10',
    roughness: 0.95,
  });
  for (let i = 0; i < 3; i++) {
    const log = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.032, 0.32, 6),
      logMat,
    );
    log.rotation.z = Math.PI / 2;
    log.rotation.y = (i / 3) * Math.PI + 0.2;
    log.position.set(
      Math.cos((i / 3) * Math.PI * 2) * 0.04,
      0.03,
      Math.sin((i / 3) * Math.PI * 2) * 0.04,
    );
    group.add(log);

    // Log collider matches mesh (len 0.32, r≈0.03); embed so no ground wedge
    const logBody = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      material: stonePhysMat,
      shape: new CANNON.Box(new CANNON.Vec3(0.16, 0.032, 0.032)),
    });
    const ang = (i / 3) * Math.PI + 0.2;
    logBody.position.set(
      x + Math.cos((i / 3) * Math.PI * 2) * 0.04,
      PLAY_SURFACE_Y + 0.028,
      z + Math.sin((i / 3) * Math.PI * 2) * 0.04,
    );
    logBody.quaternion.setFromEuler(0, ang, 0);
    bumpBodies.push(logBody);
  }

  // Flame meshes (emissive stacked cones / planes)
  const flameGroup = new THREE.Group();
  flameGroup.position.y = 0.06;
  group.add(flameGroup);

  const flameMats: THREE.MeshStandardMaterial[] = [];
  const flameMeshes: THREE.Mesh[] = [];
  const flameDefs = [
    { color: 0xfff5c8, emissive: 0xffee88, h: 0.22, r: 0.045, y: 0.08 },
    { color: 0xffaa33, emissive: 0xff8800, h: 0.28, r: 0.06, y: 0.1 },
    { color: 0xff5722, emissive: 0xff3300, h: 0.2, r: 0.07, y: 0.06 },
    { color: 0xffcc44, emissive: 0xffaa22, h: 0.16, r: 0.035, y: 0.14 },
  ];
  for (const f of flameDefs) {
    const mat = new THREE.MeshStandardMaterial({
      color: f.color,
      emissive: f.emissive,
      emissiveIntensity: 2.2,
      roughness: 0.4,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    flameMats.push(mat);
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(f.r, f.h, 6, 1, true), mat);
    mesh.position.y = f.y;
    flameGroup.add(mesh);
    flameMeshes.push(mesh);
  }

  // Inner glow sprite-like sphere
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xffc866,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), glowMat);
  glow.position.y = 0.1;
  flameGroup.add(glow);

  // Ember particles
  const emberCount = 24;
  const emberPositions = new Float32Array(emberCount * 3);
  const emberVel: { x: number; y: number; z: number; life: number }[] = [];
  for (let i = 0; i < emberCount; i++) {
    emberVel.push({
      x: (Math.random() - 0.5) * 0.08,
      y: 0.15 + Math.random() * 0.25,
      z: (Math.random() - 0.5) * 0.08,
      life: Math.random(),
    });
    emberPositions[i * 3] = 0;
    emberPositions[i * 3 + 1] = 0.1;
    emberPositions[i * 3 + 2] = 0;
  }
  const emberGeo = new THREE.BufferGeometry();
  emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPositions, 3));
  const emberMat = new THREE.PointsMaterial({
    color: 0xff6622,
    size: 0.025,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const embers = new THREE.Points(emberGeo, emberMat);
  flameGroup.add(embers);

  const light = new THREE.PointLight(0xff9a3a, 2.4, 6.5, 1.6);
  light.position.set(0, 0.35, 0);
  light.castShadow = false;
  group.add(light);

  // Soft ground bounce light
  const bounce = new THREE.PointLight(0xff7a28, 0.55, 2.2, 2);
  bounce.position.set(0, 0.12, 0);
  group.add(bounce);

  const update = (_dt: number, t: number) => {
    const flicker =
      0.85 +
      0.18 * Math.sin(t * 11.3) +
      0.12 * Math.sin(t * 17.7 + 1.2) +
      0.08 * Math.sin(t * 29.1);
    light.intensity = 2.1 * flicker;
    bounce.intensity = 0.45 * flicker;
    light.position.x = Math.sin(t * 7.2) * 0.02;
    light.position.z = Math.cos(t * 5.8) * 0.02;

    for (let i = 0; i < flameMeshes.length; i++) {
      const m = flameMeshes[i]!;
      const phase = t * (3.5 + i * 0.7) + i;
      m.scale.x = 0.85 + 0.2 * Math.sin(phase);
      m.scale.z = 0.85 + 0.2 * Math.cos(phase * 1.1);
      m.scale.y = 0.9 + 0.25 * Math.sin(phase * 1.3);
      m.rotation.y = Math.sin(phase * 0.4) * 0.15;
      const mat = flameMats[i]!;
      mat.emissiveIntensity = 1.8 + 0.6 * Math.sin(phase * 1.5);
      mat.opacity = 0.75 + 0.2 * Math.sin(phase);
    }
    glow.scale.setScalar(0.9 + 0.25 * flicker);
    (glow.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.2 * flicker;

    const pos = emberGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < emberCount; i++) {
      const v = emberVel[i]!;
      v.life += _dt * (0.35 + (i % 5) * 0.08);
      if (v.life >= 1) {
        v.life = 0;
        v.x = (Math.random() - 0.5) * 0.1;
        v.y = 0.12 + Math.random() * 0.28;
        v.z = (Math.random() - 0.5) * 0.1;
        pos.setXYZ(i, (Math.random() - 0.5) * 0.04, 0.05, (Math.random() - 0.5) * 0.04);
      } else {
        const px = pos.getX(i) + v.x * _dt;
        const py = pos.getY(i) + v.y * _dt;
        const pz = pos.getZ(i) + v.z * _dt;
        pos.setXYZ(i, px, py, pz);
        v.y *= 0.98;
      }
    }
    pos.needsUpdate = true;
    emberMat.opacity = 0.5 + 0.4 * flicker;
  };

  return { group, light, update };
}

function addCampSeating(
  root: THREE.Group,
  fx: number,
  fz: number,
  bumpBodies: CANNON.Body[],
  stonePhysMat: CANNON.Material,
): void {
  const logMat = new THREE.MeshStandardMaterial({
    color: '#5c3d28',
    roughness: 0.9,
  });
  const barkMat = new THREE.MeshStandardMaterial({
    color: '#3e2a1c',
    roughness: 0.95,
  });
  const seats: { ang: number; dist: number }[] = [
    { ang: 0.4, dist: 0.72 },
    { ang: 1.5, dist: 0.78 },
    { ang: 2.6, dist: 0.7 },
    { ang: 3.9, dist: 0.8 },
    { ang: 5.2, dist: 0.74 },
  ];
  for (let i = 0; i < seats.length; i++) {
    const s = seats[i]!;
    const lx = fx + Math.cos(s.ang) * s.dist;
    const lz = fz + Math.sin(s.ang) * s.dist;
    const log = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.08, 0.55, 8),
      i % 2 === 0 ? logMat : barkMat,
    );
    log.rotation.z = Math.PI / 2;
    log.rotation.y = s.ang + Math.PI / 2;
    log.position.set(lx, 0.07, lz);
    log.castShadow = true;
    log.receiveShadow = true;
    root.add(log);

    // Log collider matches mesh (len 0.55, r≈0.075). Embed bottom below the
    // sand so marbles cannot tunnel/wedge under the seating logs (AI stuck).
    const halfLen = 0.28;
    const halfR = 0.082;
    const logBody = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      material: stonePhysMat,
      shape: new CANNON.Box(new CANNON.Vec3(halfLen, halfR, halfR)),
    });
    logBody.position.set(lx, PLAY_SURFACE_Y + halfR * 0.7, lz);
    logBody.quaternion.setFromEuler(0, s.ang + Math.PI / 2, 0);
    bumpBodies.push(logBody);

    // Stones as alternate seating
    if (i % 2 === 1) {
      const sx = fx + Math.cos(s.ang + 0.35) * (s.dist + 0.15);
      const sz = fz + Math.sin(s.ang + 0.35) * (s.dist + 0.15);
      const stone = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.1, 0),
        new THREE.MeshStandardMaterial({
          color: '#6a6258',
          roughness: 0.92,
          flatShading: true,
        }),
      );
      stone.position.set(sx, 0.06, sz);
      stone.scale.set(1.2, 0.7, 1);
      stone.castShadow = true;
      root.add(stone);

      // Match flattened visual (scale.y 0.7) and embed into sand
      const stoneR = 0.09;
      const stoneBody = new CANNON.Body({
        mass: 0,
        type: CANNON.Body.STATIC,
        material: stonePhysMat,
        shape: new CANNON.Sphere(stoneR),
      });
      stoneBody.position.set(sx, PLAY_SURFACE_Y + stoneR * 0.45, sz);
      bumpBodies.push(stoneBody);
    }
  }
}

function makeStarField(): THREE.Points {
  const n = 280;
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const elev = 0.15 + Math.random() * 1.1;
    const r = 55 + Math.random() * 30;
    positions[i * 3] = Math.cos(a) * Math.cos(elev) * r;
    positions[i * 3 + 1] = Math.sin(elev) * r + 8;
    positions[i * 3 + 2] = Math.sin(a) * Math.cos(elev) * r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xfff8e7,
    size: 0.35,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.name = 'stars';
  return pts;
}
