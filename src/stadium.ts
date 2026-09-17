import * as THREE from 'three';
import { BOUNDARY_RADIUS } from './constants';

/**
 * Low-poly stadium: bleachers + crowd (instanced), mountains & buildings.
 * Sized for mobile — simple geometry, no heavy materials.
 */
export function buildStadium(scene: THREE.Scene): THREE.Group {
  const root = new THREE.Group();
  root.name = 'stadium';

  const innerR = BOUNDARY_RADIUS + 0.6; // just outside invisible wall
  const standDepth = 3.2;
  const tiers = 5;
  const segments = 36;

  // --- Bleacher rings ---
  const woodMat = new THREE.MeshStandardMaterial({
    color: '#6b4a2e',
    roughness: 0.9,
    metalness: 0.02,
  });
  const concreteMat = new THREE.MeshStandardMaterial({
    color: '#8a8680',
    roughness: 0.95,
    metalness: 0.05,
  });

  for (let t = 0; t < tiers; t++) {
    const r0 = innerR + t * (standDepth / tiers);
    const r1 = r0 + standDepth / tiers * 0.92;
    const y = 0.12 + t * 0.38;
    const ringGeo = new THREE.RingGeometry(r0, r1, segments);
    const seat = new THREE.Mesh(ringGeo, t % 2 === 0 ? woodMat : concreteMat);
    seat.rotation.x = -Math.PI / 2;
    seat.position.y = y;
    seat.receiveShadow = true;
    root.add(seat);

    // Riser face (thin cylinder strip via torus-like boxes — use thin torus)
    const riserGeo = new THREE.CylinderGeometry(r0, r0, 0.36, segments, 1, true);
    const riser = new THREE.Mesh(
      riserGeo,
      new THREE.MeshStandardMaterial({
        color: t % 2 === 0 ? '#5a3f28' : '#75716c',
        roughness: 0.92,
        side: THREE.DoubleSide,
      }),
    );
    riser.position.y = y - 0.18;
    root.add(riser);
  }

  // Outer back wall of stands
  const wallR = innerR + standDepth;
  const wallH = 0.12 + tiers * 0.38 + 0.5;
  const wallGeo = new THREE.CylinderGeometry(wallR, wallR, wallH, segments, 1, true);
  const wall = new THREE.Mesh(
    wallGeo,
    new THREE.MeshStandardMaterial({
      color: '#4a5560',
      roughness: 0.88,
      side: THREE.DoubleSide,
    }),
  );
  wall.position.y = wallH / 2;
  root.add(wall);

  // --- Crowd: instanced colored blobs on seats ---
  const crowdCount = 280;
  const blobGeo = new THREE.SphereGeometry(0.09, 5, 4);
  const blobMat = new THREE.MeshStandardMaterial({
    roughness: 0.85,
    metalness: 0.0,
    vertexColors: false,
  });
  // Use InstancedMesh with per-instance color via InstancedBufferAttribute on a custom approach:
  // Three.js InstancedMesh supports setColorAt
  const crowd = new THREE.InstancedMesh(blobGeo, blobMat, crowdCount);
  crowd.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const palette = [
    0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6, 0xe67e22, 0x1abc9c, 0xecf0f1,
    0xff6b6b, 0x4ecdc4, 0xffe66d, 0x95e1d3, 0xf38181, 0xaa96da, 0xfcbad3,
  ];

  for (let i = 0; i < crowdCount; i++) {
    const tier = Math.floor(Math.random() * tiers);
    const angle = Math.random() * Math.PI * 2;
    const r =
      innerR +
      (tier + 0.35 + Math.random() * 0.45) * (standDepth / tiers);
    const y = 0.12 + tier * 0.38 + 0.14;
    dummy.position.set(Math.cos(angle) * r, y, Math.sin(angle) * r);
    const s = 0.7 + Math.random() * 0.55;
    dummy.scale.setScalar(s);
    dummy.rotation.set(0, Math.random() * Math.PI, 0);
    dummy.updateMatrix();
    crowd.setMatrixAt(i, dummy.matrix);
    color.setHex(palette[i % palette.length]!);
    // slight random brightness
    color.offsetHSL(0, 0, (Math.random() - 0.5) * 0.15);
    crowd.setColorAt(i, color);
  }
  crowd.instanceMatrix.needsUpdate = true;
  if (crowd.instanceColor) crowd.instanceColor.needsUpdate = true;
  crowd.castShadow = false;
  crowd.receiveShadow = false;
  root.add(crowd);

  // --- Simple humanoid silhouettes (sparse, larger) ---
  const figureCount = 40;
  const bodyGeo = new THREE.CapsuleGeometry(0.07, 0.16, 2, 6);
  const headGeo = new THREE.SphereGeometry(0.06, 6, 5);
  const figMat = new THREE.MeshStandardMaterial({ color: '#3d3d3d', roughness: 0.9 });
  for (let i = 0; i < figureCount; i++) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(bodyGeo, figMat);
    body.position.y = 0.18;
    const head = new THREE.Mesh(headGeo, figMat);
    head.position.y = 0.34;
    g.add(body, head);
    const tier = 1 + (i % (tiers - 1));
    const angle = (i / figureCount) * Math.PI * 2 + 0.1;
    const r = innerR + (tier + 0.4) * (standDepth / tiers);
    g.position.set(Math.cos(angle) * r, 0.12 + tier * 0.38, Math.sin(angle) * r);
    g.scale.setScalar(0.85 + (i % 3) * 0.1);
    root.add(g);
  }

  // --- Mountains (low-poly cones / pyramids) behind stands ---
  const mountainMat = new THREE.MeshStandardMaterial({
    color: '#5a6b58',
    roughness: 1,
    flatShading: true,
  });
  const snowMat = new THREE.MeshStandardMaterial({
    color: '#e8eef5',
    roughness: 0.85,
    flatShading: true,
  });
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2 + 0.3;
    const dist = wallR + 6 + (i % 3) * 2.5;
    const h = 4 + (i % 4) * 1.8;
    const rBase = 2.2 + (i % 3) * 0.8;
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(rBase, h, 5),
      mountainMat,
    );
    cone.position.set(Math.cos(angle) * dist, h / 2 - 0.2, Math.sin(angle) * dist);
    root.add(cone);
    const cap = new THREE.Mesh(
      new THREE.ConeGeometry(rBase * 0.35, h * 0.22, 5),
      snowMat,
    );
    cap.position.set(
      Math.cos(angle) * dist,
      h - h * 0.11 - 0.2,
      Math.sin(angle) * dist,
    );
    root.add(cap);
  }

  // --- Buildings (boxes) mixed around horizon ---
  const bldgColors = ['#6d7580', '#8b7355', '#5c6b7a', '#7a6a5a', '#4f5d4a'];
  for (let i = 0; i < 18; i++) {
    const angle = (i / 18) * Math.PI * 2 + 0.05;
    const dist = wallR + 3.5 + (i % 4) * 1.2;
    const bw = 0.8 + (i % 3) * 0.4;
    const bd = 0.6 + (i % 2) * 0.35;
    const bh = 1.2 + (i % 5) * 0.7;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(bw, bh, bd),
      new THREE.MeshStandardMaterial({
        color: bldgColors[i % bldgColors.length],
        roughness: 0.9,
      }),
    );
    mesh.position.set(Math.cos(angle) * dist, bh / 2, Math.sin(angle) * dist);
    mesh.rotation.y = angle + Math.PI / 2;
    root.add(mesh);
  }

  // Soft distant ground tint ring so void isn't empty under fog
  const apronGeo = new THREE.RingGeometry(wallR * 0.98, wallR + 14, 48);
  const apron = new THREE.Mesh(
    apronGeo,
    new THREE.MeshStandardMaterial({
      color: '#6a7a4e',
      roughness: 1,
      metalness: 0,
    }),
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = 0.002;
  apron.receiveShadow = true;
  root.add(apron);

  scene.add(root);
  return root;
}
