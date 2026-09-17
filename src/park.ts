import * as THREE from 'three';
import { BOUNDARY_RADIUS, CIRCLE_RADIUS } from './constants';
import { makeStreetLamp, type StreetLamp } from './dayNight';

export type ParkBuild = {
  root: THREE.Group;
  lamps: StreetLamp[];
};

/**
 * Realistic-ish park around the play patch: grass, dirt circle, trees,
 * paths, benches, fence, faroles, distant foliage, horizon mountains/buildings.
 * Mobile-friendly geometry.
 * Invisible physics wall stays outside this scenery (BOUNDARY_RADIUS).
 */
export function buildPark(scene: THREE.Scene): ParkBuild {
  const root = new THREE.Group();
  root.name = 'park';
  const lamps: StreetLamp[] = [];

  const playR = CIRCLE_RADIUS;
  const innerClear = BOUNDARY_RADIUS + 0.35;

  // Dirt pad outer radius — grass must not cover this disk
  const dirtOuter = playR * 1.65;

  // --- Grass lawn as a RING (hole under dirt = no grass/dirt z-fight) ---
  const grassMat = new THREE.MeshStandardMaterial({
    color: '#4a7a3a',
    roughness: 0.95,
    metalness: 0,
  });
  const lawn = new THREE.Mesh(
    new THREE.RingGeometry(dirtOuter * 0.98, 28, 64),
    grassMat,
  );
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.y = 0.001;
  lawn.receiveShadow = true;
  root.add(lawn);

  // Slightly darker grass patches (instanced flat discs) — keep outside dirt
  const patchGeo = new THREE.CircleGeometry(0.9, 10);
  const patchMat = new THREE.MeshStandardMaterial({
    color: '#3d6b32',
    roughness: 1,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const patches = new THREE.InstancedMesh(patchGeo, patchMat, 36);
  const dummy = new THREE.Object3D();
  let patchCount = 0;
  for (let i = 0; i < 48 && patchCount < 36; i++) {
    const a = (i / 36) * Math.PI * 2 + (i % 5) * 0.17;
    const r = 4 + (i % 7) * 2.4 + (i % 3) * 0.5;
    const s = 0.6 + (i % 4) * 0.35;
    // Skip any patch whose footprint would overlap the dirt disk
    if (r - s * 0.9 < dirtOuter + 0.15) continue;
    dummy.position.set(Math.cos(a) * r, 0.0015, Math.sin(a) * r);
    dummy.rotation.x = -Math.PI / 2;
    dummy.rotation.z = (i * 0.7) % Math.PI;
    dummy.scale.set(s, s, 1);
    dummy.updateMatrix();
    patches.setMatrixAt(patchCount++, dummy.matrix);
  }
  patches.count = patchCount;
  patches.instanceMatrix.needsUpdate = true;
  patches.receiveShadow = true;
  root.add(patches);

  // --- Dirt / sand play patch: solid disk raised above grass/ground ---
  const dirtMat = new THREE.MeshStandardMaterial({
    color: '#8b6239',
    roughness: 0.98,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  const dirtPad = new THREE.Mesh(
    new THREE.CircleGeometry(dirtOuter, 64),
    dirtMat,
  );
  dirtPad.rotation.x = -Math.PI / 2;
  dirtPad.position.y = 0.004;
  dirtPad.renderOrder = 1;
  dirtPad.receiveShadow = true;
  root.add(dirtPad);

  // Soft edge blend ring (darker soil) just outside the dirt disk
  const soilRing = new THREE.Mesh(
    new THREE.RingGeometry(dirtOuter * 0.92, dirtOuter * 1.35, 64),
    new THREE.MeshStandardMaterial({
      color: '#6e4a2a',
      roughness: 1,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  );
  soilRing.rotation.x = -Math.PI / 2;
  soilRing.position.y = 0.0045;
  soilRing.renderOrder = 2;
  root.add(soilRing);

  // --- Winding gravel paths ---
  const pathMat = new THREE.MeshStandardMaterial({
    color: '#c2b59a',
    roughness: 0.92,
  });
  addPath(root, pathMat, [
    new THREE.Vector3(playR * 2.2, 0.003, 0),
    new THREE.Vector3(3.2, 0.003, 1.1),
    new THREE.Vector3(5.5, 0.003, 0.4),
    new THREE.Vector3(8.0, 0.003, -1.2),
  ], 0.55);
  addPath(root, pathMat, [
    new THREE.Vector3(-playR * 2.0, 0.003, 0.3),
    new THREE.Vector3(-2.8, 0.003, -1.4),
    new THREE.Vector3(-5.0, 0.003, -0.6),
    new THREE.Vector3(-7.5, 0.003, 1.0),
  ], 0.48);
  addPath(root, pathMat, [
    new THREE.Vector3(0.4, 0.003, playR * 2.1),
    new THREE.Vector3(1.2, 0.003, 3.5),
    new THREE.Vector3(-0.5, 0.003, 6.0),
    new THREE.Vector3(0.8, 0.003, 9.0),
  ], 0.42);

  // --- Trees (trunk + foliage canopy) ---
  const trunkMat = new THREE.MeshStandardMaterial({
    color: '#5a3d28',
    roughness: 0.9,
  });
  const canopyMats = [
    new THREE.MeshStandardMaterial({ color: '#2f6b2f', roughness: 0.85, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: '#3d7a38', roughness: 0.88, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: '#256028', roughness: 0.9, flatShading: true }),
  ];
  const trunkGeo = new THREE.CylinderGeometry(0.08, 0.12, 1.1, 6);
  const canopyGeo = new THREE.SphereGeometry(0.55, 7, 5);

  const treeSlots: { a: number; r: number; s: number }[] = [];
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + (i % 3) * 0.11;
    const r = innerClear + 1.4 + (i % 5) * 1.35 + (i % 2) * 0.4;
    treeSlots.push({ a, r, s: 0.75 + (i % 4) * 0.22 });
  }
  // Extra distant trees
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + 0.4;
    const r = 14 + (i % 6) * 1.8;
    treeSlots.push({ a, r, s: 1.1 + (i % 3) * 0.35 });
  }

  for (let i = 0; i < treeSlots.length; i++) {
    const { a, r, s } = treeSlots[i]!;
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 0.55;
    trunk.castShadow = true;
    g.add(trunk);
    const canopy = new THREE.Mesh(canopyGeo, canopyMats[i % canopyMats.length]!);
    canopy.position.y = 1.25;
    canopy.scale.set(1.1, 0.95, 1.05);
    canopy.castShadow = true;
    g.add(canopy);
    // Second smaller canopy blob for volume
    if (i % 2 === 0) {
      const c2 = new THREE.Mesh(canopyGeo, canopyMats[(i + 1) % canopyMats.length]!);
      c2.position.set(0.25, 1.05, -0.15);
      c2.scale.setScalar(0.7);
      g.add(c2);
    }
    g.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    g.scale.setScalar(s);
    g.rotation.y = a;
    root.add(g);
  }

  // --- Distant foliage hills (soft mounds) ---
  const hillMat = new THREE.MeshStandardMaterial({
    color: '#3a5c34',
    roughness: 1,
    flatShading: true,
  });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.2;
    const dist = 20 + (i % 3) * 2.5;
    const hill = new THREE.Mesh(
      new THREE.SphereGeometry(3.2 + (i % 3) * 0.8, 8, 5),
      hillMat,
    );
    hill.scale.y = 0.35 + (i % 2) * 0.1;
    hill.position.set(Math.cos(a) * dist, 0.2, Math.sin(a) * dist);
    root.add(hill);
  }

  // --- Horizon mountains + city silhouette (mobile-friendly low poly) ---
  addHorizonScenery(root);

  // --- Benches ---
  const woodMat = new THREE.MeshStandardMaterial({ color: '#6b4e32', roughness: 0.85 });
  const metalMat = new THREE.MeshStandardMaterial({ color: '#3a3a3a', roughness: 0.6, metalness: 0.4 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.35;
    const r = innerClear + 0.55;
    const bench = makeBench(woodMat, metalMat);
    bench.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    bench.rotation.y = a + Math.PI / 2;
    root.add(bench);
  }

  // --- Low park fence (decorative, not physics) ---
  const fenceMat = new THREE.MeshStandardMaterial({ color: '#5c4030', roughness: 0.8 });
  const fenceR = innerClear + 0.15;
  const posts = 40;
  const postGeo = new THREE.CylinderGeometry(0.025, 0.03, 0.55, 5);
  const railGeo = new THREE.BoxGeometry(0.04, 0.03, ((2 * Math.PI * fenceR) / posts) * 0.95);
  for (let i = 0; i < posts; i++) {
    const a = (i / posts) * Math.PI * 2;
    const post = new THREE.Mesh(postGeo, fenceMat);
    post.position.set(Math.cos(a) * fenceR, 0.275, Math.sin(a) * fenceR);
    root.add(post);
    const a2 = ((i + 0.5) / posts) * Math.PI * 2;
    const rail = new THREE.Mesh(railGeo, fenceMat);
    rail.position.set(Math.cos(a2) * fenceR, 0.42, Math.sin(a2) * fenceR);
    rail.rotation.y = -a2;
    root.add(rail);
    const rail2 = rail.clone();
    rail2.position.y = 0.22;
    root.add(rail2);
  }

  // --- Simple playground in the distance ---
  const playG = new THREE.Group();
  // Swing frame
  const barMat = new THREE.MeshStandardMaterial({ color: '#c62828', roughness: 0.55, metalness: 0.25 });
  const poleL = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6), barMat);
  poleL.position.set(-0.7, 0.8, 0);
  const poleR = poleL.clone();
  poleR.position.x = 0.7;
  const topBar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.5, 6), barMat);
  topBar.rotation.z = Math.PI / 2;
  topBar.position.y = 1.55;
  playG.add(poleL, poleR, topBar);
  // Slide
  const slideMat = new THREE.MeshStandardMaterial({ color: '#1565c0', roughness: 0.4, metalness: 0.15 });
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.06, 1.4), slideMat);
  slide.position.set(1.6, 0.55, 0.2);
  slide.rotation.x = -0.55;
  playG.add(slide);
  const slideLadder = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 1.0, 0.08),
    new THREE.MeshStandardMaterial({ color: '#f9a825', roughness: 0.7 }),
  );
  slideLadder.position.set(1.6, 0.55, -0.55);
  playG.add(slideLadder);
  playG.position.set(-6.5, 0, 5.5);
  playG.rotation.y = 0.6;
  playG.scale.setScalar(0.85);
  root.add(playG);

  // --- Flower beds (colorful low discs) ---
  const flowerColors = [0xe91e63, 0xffeb3b, 0x9c27b0, 0xff9800, 0xffffff];
  const flowerGeo = new THREE.SphereGeometry(0.06, 5, 4);
  const flowerMesh = new THREE.InstancedMesh(
    flowerGeo,
    new THREE.MeshStandardMaterial({ roughness: 0.7 }),
    60,
  );
  const col = new THREE.Color();
  for (let i = 0; i < 60; i++) {
    const a = (i / 12) * Math.PI * 2 + i * 0.07;
    const r = innerClear + 0.9 + (i % 5) * 0.15;
    dummy.position.set(
      Math.cos(a) * r + (i % 3) * 0.08,
      0.05,
      Math.sin(a) * r + ((i * 3) % 5) * 0.05,
    );
    dummy.scale.setScalar(0.6 + (i % 4) * 0.25);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    flowerMesh.setMatrixAt(i, dummy.matrix);
    col.setHex(flowerColors[i % flowerColors.length]!);
    flowerMesh.setColorAt(i, col);
  }
  flowerMesh.instanceMatrix.needsUpdate = true;
  if (flowerMesh.instanceColor) flowerMesh.instanceColor.needsUpdate = true;
  root.add(flowerMesh);

  // Soft ground apron into fog
  const apron = new THREE.Mesh(
    new THREE.RingGeometry(22, 38, 48),
    new THREE.MeshStandardMaterial({
      color: '#5a7a48',
      roughness: 1,
    }),
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = 0.0005;
  root.add(apron);

  // --- Street lamps / faroles (lights toggled by day/night) ---
  const lampR = innerClear + 0.35;
  const lampSlots = 6;
  for (let i = 0; i < lampSlots; i++) {
    const a = (i / lampSlots) * Math.PI * 2 + 0.2;
    const lamp = makeStreetLamp(
      Math.cos(a) * lampR,
      Math.sin(a) * lampR,
      a + Math.PI / 2,
    );
    root.add(lamp.group);
    lamps.push(lamp);
  }
  // Two path lamps a bit farther out
  const extra = [
    makeStreetLamp(6.5, 0.2, Math.PI / 2),
    makeStreetLamp(-6.2, -0.5, -Math.PI / 2),
  ];
  for (const lamp of extra) {
    root.add(lamp.group);
    lamps.push(lamp);
  }

  scene.add(root);
  return { root, lamps };
}


/** Far backdrop: mountains + simple building blocks. Cheap geometry for mobile. */
function addHorizonScenery(root: THREE.Group): void {
  const mtnMats = [
    new THREE.MeshStandardMaterial({ color: '#5a6e7a', roughness: 1, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: '#4a5c68', roughness: 1, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: '#6b7d6a', roughness: 1, flatShading: true }),
  ];
  // Layered mountain cones/spheres around the horizon
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.08;
    const dist = 48 + (i % 4) * 6;
    const h = 8 + (i % 5) * 2.4;
    const w = 7 + (i % 3) * 3;
    const mtn = new THREE.Mesh(
      new THREE.ConeGeometry(w * 0.55, h, 5),
      mtnMats[i % mtnMats.length]!,
    );
    mtn.position.set(Math.cos(a) * dist, h * 0.42, Math.sin(a) * dist);
    root.add(mtn);
    // Soft foothill blob
    const foot = new THREE.Mesh(
      new THREE.SphereGeometry(w * 0.7, 6, 4),
      mtnMats[(i + 1) % mtnMats.length]!,
    );
    foot.scale.y = 0.35;
    foot.position.set(Math.cos(a) * (dist - 2), 1.2, Math.sin(a) * (dist - 2));
    root.add(foot);
  }

  // City / town building silhouettes on a few arcs (not a full ring — feels more natural)
  const bldgColors = [0x8a8f9a, 0x7a8490, 0x9a9088, 0x6e7884, 0xa09890];
  const clusters = [
    { a0: 0.35, span: 1.1, dist: 42 },
    { a0: 2.4, span: 0.9, dist: 46 },
    { a0: 4.2, span: 1.25, dist: 44 },
  ];
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  for (const c of clusters) {
    const n = 10 + Math.floor(c.span * 6);
    for (let i = 0; i < n; i++) {
      const t = i / Math.max(1, n - 1);
      const a = c.a0 + t * c.span + ((i % 3) - 1) * 0.04;
      const dist = c.dist + (i % 4) * 1.6 + (i % 2) * 0.8;
      const bw = 1.1 + (i % 4) * 0.55;
      const bd = 1.0 + (i % 3) * 0.4;
      const bh = 2.2 + (i % 6) * 1.35 + (i % 2) * 0.8;
      const mat = new THREE.MeshStandardMaterial({
        color: bldgColors[i % bldgColors.length]!,
        roughness: 0.92,
        metalness: 0.05,
        flatShading: true,
      });
      const b = new THREE.Mesh(boxGeo, mat);
      b.scale.set(bw, bh, bd);
      b.position.set(Math.cos(a) * dist, bh * 0.5, Math.sin(a) * dist);
      b.rotation.y = a + Math.PI / 2;
      root.add(b);
      // Occasional taller tower
      if (i % 5 === 0) {
        const tower = new THREE.Mesh(boxGeo, mat);
        const th = bh * 1.55;
        tower.scale.set(bw * 0.55, th, bd * 0.55);
        tower.position.set(
          Math.cos(a) * (dist + 0.3),
          th * 0.5,
          Math.sin(a) * (dist + 0.3),
        );
        tower.rotation.y = a;
        root.add(tower);
      }
    }
  }

  // Soft skyline haze band (helps mountains/buildings read against sky)
  const haze = new THREE.Mesh(
    new THREE.CylinderGeometry(70, 70, 6, 32, 1, true),
    new THREE.MeshBasicMaterial({
      color: '#c5d8ef',
      transparent: true,
      opacity: 0.22,
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
  haze.position.y = 3;
  root.add(haze);
}

function makeBench(
  wood: THREE.Material,
  metal: THREE.Material,
): THREE.Group {
  const g = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.32), wood);
  seat.position.y = 0.28;
  seat.castShadow = true;
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.28, 0.05), wood);
  back.position.set(0, 0.42, -0.14);
  const legGeo = new THREE.BoxGeometry(0.05, 0.28, 0.05);
  const l1 = new THREE.Mesh(legGeo, metal);
  l1.position.set(-0.35, 0.14, 0.1);
  const l2 = l1.clone();
  l2.position.z = -0.1;
  const l3 = l1.clone();
  l3.position.x = 0.35;
  const l4 = l2.clone();
  l4.position.x = 0.35;
  g.add(seat, back, l1, l2, l3, l4);
  return g;
}

function addPath(
  root: THREE.Group,
  mat: THREE.Material,
  points: THREE.Vector3[],
  width: number,
): void {
  const curve = new THREE.CatmullRomCurve3(points);
  const tubular = new THREE.TubeGeometry(curve, 24, width * 0.5, 6, false);
  // Flatten tube into a path-like ribbon by scaling Y heavily
  const mesh = new THREE.Mesh(tubular, mat);
  mesh.scale.y = 0.02;
  mesh.position.y = 0.002;
  mesh.receiveShadow = true;
  root.add(mesh);
}

/** @deprecated use buildPark — kept name alias during migration */
export function buildStadium(scene: THREE.Scene): ParkBuild {
  return buildPark(scene);
}
