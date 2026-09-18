/**
 * Level 3 — dim dentist office; play vessel is the white spit bowl / cuspidor
 * beside the chair armrest. Key light mostly on the bowl; room otherwise dimmer.
 * Light flickers with occasional energy instability.
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {
  CIRCLE_RADIUS,
  MARBLE_RADIUS,
  PLAY_SURFACE_Y,
} from './constants';

/** Center hole / mark diameter = 1 marble diameter → radius = MARBLE_RADIUS */
export const L3_HOLE_RADIUS = MARBLE_RADIUS;
/** Bowl wall height ≈ 2 marble diameters */
export const L3_BOWL_WALL_HEIGHT = MARBLE_RADIUS * 4;
/** Inner play radius (= previous chalk circle) */
export const L3_BOWL_INNER_R = CIRCLE_RADIUS;

export type DentistOfficeBuild = {
  root: THREE.Group;
  /** Spotlight / key on the cuspidor (flickers). */
  bowlKeyLight: THREE.PointLight;
  /** Soft secondary fill on bowl. */
  bowlFill: THREE.PointLight;
  /** Physics bodies to add to world (walls + floor pieces). */
  bodies: CANNON.Body[];
  ceramicMat: CANNON.Material;
  /** Visual center mark (hidden when hole opens). */
  centerMark: THREE.Mesh;
  /** Visual hole (revealed when open). */
  holeMesh: THREE.Mesh;
  /** Full center floor disc body — removed when hole opens. */
  centerFloorBody: CANNON.Body;
  holeOpen: boolean;
  update: (dt: number) => void;
  openCenterHole: (world: CANNON.World) => void;
};

function mat(
  color: number,
  opts: Partial<THREE.MeshStandardMaterialParameters> = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.75,
    metalness: 0.05,
    ...opts,
  });
}

export function buildDentistOffice(
  scene: THREE.Scene,
  _groundMat: CANNON.Material,
): DentistOfficeBuild {
  void _groundMat;
  const root = new THREE.Group();
  root.name = 'dentistOffice';
  const bodies: CANNON.Body[] = [];
  const ceramicMat = new CANNON.Material('ceramic');

  const innerR = L3_BOWL_INNER_R;
  const holeR = L3_HOLE_RADIUS;
  const wallH = L3_BOWL_WALL_HEIGHT;
  const floorY = PLAY_SURFACE_Y;

  // --- Dim clinic room ---
  const roomSize = 6.5;
  const wallHgt = 2.8;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(roomSize, roomSize),
    mat(0x2a2e32, { roughness: 0.92 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  floor.receiveShadow = true;
  root.add(floor);

  // Checker linoleum suggestion
  const tile = new THREE.Mesh(
    new THREE.PlaneGeometry(roomSize * 0.55, roomSize * 0.55),
    mat(0x3a4046, { roughness: 0.88 }),
  );
  tile.rotation.x = -Math.PI / 2;
  tile.position.y = -0.018;
  root.add(tile);

  const wallMat = mat(0x1c2228, { roughness: 0.9 });
  const mkWall = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    m.position.set(x, y, z);
    m.receiveShadow = true;
    m.castShadow = true;
    root.add(m);
  };
  mkWall(roomSize, wallHgt, 0.12, 0, wallHgt / 2, -roomSize / 2);
  mkWall(roomSize, wallHgt, 0.12, 0, wallHgt / 2, roomSize / 2);
  mkWall(0.12, wallHgt, roomSize, -roomSize / 2, wallHgt / 2, 0);
  mkWall(0.12, wallHgt, roomSize, roomSize / 2, wallHgt / 2, 0);

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(roomSize, roomSize),
    mat(0x12161a, { roughness: 1 }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = wallHgt;
  root.add(ceiling);

  // Dim overhead (clinic, not key)
  const overhead = new THREE.PointLight(0x8899aa, 0.18, 8, 2);
  overhead.position.set(-0.8, 2.2, 0.6);
  root.add(overhead);

  // --- Dental chair (beside bowl) ---
  const chair = new THREE.Group();
  chair.position.set(innerR + 0.42, 0, 0.05);
  const chrome = mat(0xb0b8c0, { metalness: 0.85, roughness: 0.28 });
  const vinyl = mat(0x3d4550, { roughness: 0.65 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.08, 20), chrome);
  base.position.y = 0.04;
  chair.add(base);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.45, 12), chrome);
  column.position.y = 0.28;
  chair.add(column);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, 0.55), vinyl);
  seat.position.set(0, 0.52, 0.02);
  seat.castShadow = true;
  chair.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.55, 0.08), vinyl);
  back.position.set(0, 0.82, -0.24);
  back.rotation.x = -0.25;
  chair.add(back);
  const headrest = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.1), vinyl);
  headrest.position.set(0, 1.12, -0.32);
  chair.add(headrest);
  // Armrest toward bowl
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.35), chrome);
  arm.position.set(-0.22, 0.62, 0.05);
  chair.add(arm);
  root.add(chair);

  // Instrument tray / lamp (props)
  const trayStand = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.9, 10), chrome);
  trayStand.position.set(innerR + 0.55, 0.45, -0.55);
  root.add(trayStand);
  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.02, 0.2), chrome);
  tray.position.set(innerR + 0.55, 0.92, -0.55);
  root.add(tray);

  const lampArm = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.7, 8), chrome);
  lampArm.position.set(-0.15, 1.5, -innerR - 0.35);
  lampArm.rotation.z = 0.6;
  root.add(lampArm);
  const lampHead = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), mat(0xe8eef2, { roughness: 0.4 }));
  lampHead.position.set(0.12, 1.75, -innerR - 0.2);
  root.add(lampHead);
  const lampGlow = new THREE.PointLight(0xfff4e0, 0.12, 2.2, 2);
  lampGlow.position.copy(lampHead.position);
  root.add(lampGlow);

  // Cabinets silhouette
  const cabinet = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 0.4), mat(0x252b32));
  cabinet.position.set(-1.8, 0.45, -2.2);
  root.add(cabinet);

  // --- White cuspidor / spit bowl (play vessel) ---
  const bowlGroup = new THREE.Group();
  bowlGroup.name = 'cuspidor';
  root.add(bowlGroup);

  const ceramicWhite = mat(0xf4f6f8, { roughness: 0.22, metalness: 0.08 });
  const ceramicInner = mat(0xe8eef2, { roughness: 0.18, metalness: 0.05 });

  // Outer wall shell (slightly taller visual lip)
  const wallOuter = new THREE.Mesh(
    new THREE.CylinderGeometry(innerR + 0.014, innerR + 0.018, wallH + 0.006, 64, 1, true),
    ceramicWhite,
  );
  wallOuter.position.y = floorY + wallH / 2;
  wallOuter.castShadow = true;
  wallOuter.receiveShadow = true;
  bowlGroup.add(wallOuter);

  const wallInnerVis = new THREE.Mesh(
    new THREE.CylinderGeometry(innerR, innerR, wallH, 64, 1, true),
    ceramicInner,
  );
  wallInnerVis.position.y = floorY + wallH / 2;
  // Flip normals inward
  wallInnerVis.scale.x = -1;
  bowlGroup.add(wallInnerVis);

  // Rim torus
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(innerR + 0.006, 0.008, 10, 64),
    ceramicWhite,
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = floorY + wallH + 0.002;
  rim.castShadow = true;
  bowlGroup.add(rim);

  // Pedestal under bowl
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.12, 0.35, 20),
    chrome,
  );
  pedestal.position.y = floorY - 0.18;
  bowlGroup.add(pedestal);
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.04, 0.25, 12),
    chrome,
  );
  stem.position.y = floorY - 0.42;
  bowlGroup.add(stem);

  // Annular floor visual (always; hole cut shown separately)
  const floorRingGeo = new THREE.RingGeometry(holeR + 0.0005, innerR - 0.001, 64);
  const floorRing = new THREE.Mesh(floorRingGeo, ceramicInner);
  floorRing.rotation.x = -Math.PI / 2;
  floorRing.position.y = floorY + 0.0004;
  floorRing.receiveShadow = true;
  floorRing.renderOrder = 2;
  bowlGroup.add(floorRing);

  // Center mark (1 marble diameter circle) — before hole opens
  const centerMark = new THREE.Mesh(
    new THREE.RingGeometry(holeR * 0.82, holeR, 48),
    new THREE.MeshBasicMaterial({
      color: 0xb0bec5,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    }),
  );
  centerMark.rotation.x = -Math.PI / 2;
  centerMark.position.y = floorY + 0.0007;
  centerMark.renderOrder = 4;
  bowlGroup.add(centerMark);

  // Center floor disc visual (removed look when hole opens)
  const centerDisc = new THREE.Mesh(
    new THREE.CircleGeometry(holeR, 48),
    ceramicInner.clone(),
  );
  centerDisc.rotation.x = -Math.PI / 2;
  centerDisc.position.y = floorY + 0.00035;
  centerDisc.renderOrder = 3;
  bowlGroup.add(centerDisc);

  // Dark hole (hidden until open)
  const holeMesh = new THREE.Mesh(
    new THREE.CircleGeometry(holeR, 48),
    new THREE.MeshBasicMaterial({
      color: 0x050608,
      side: THREE.DoubleSide,
      depthWrite: true,
    }),
  );
  holeMesh.rotation.x = -Math.PI / 2;
  holeMesh.position.y = floorY - 0.001;
  holeMesh.visible = false;
  holeMesh.renderOrder = 5;
  bowlGroup.add(holeMesh);

  // Drain pipe suggestion under hole
  const drain = new THREE.Mesh(
    new THREE.CylinderGeometry(holeR * 0.95, holeR * 0.7, 0.25, 16),
    mat(0x1a1e22, { metalness: 0.4, roughness: 0.5 }),
  );
  drain.position.y = floorY - 0.14;
  drain.visible = false;
  bowlGroup.add(drain);

  // --- Physics: annular floor + temporary center disc + walls ---
  const floorHalfH = 0.02;
  // Approximate annulus with wedge boxes
  const ringSegs = 36;
  const midR = (holeR + innerR) * 0.5;
  const radialLen = (innerR - holeR) * 0.5;
  for (let i = 0; i < ringSegs; i++) {
    const a0 = (i / ringSegs) * Math.PI * 2;
    const a1 = ((i + 1) / ringSegs) * Math.PI * 2;
    const a = (a0 + a1) * 0.5;
    const chord = 2 * midR * Math.sin((a1 - a0) * 0.5) * 1.08;
    const body = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      material: ceramicMat,
    });
    body.addShape(new CANNON.Box(new CANNON.Vec3(radialLen, floorHalfH, chord * 0.5)));
    body.position.set(Math.cos(a) * midR, floorY - floorHalfH, Math.sin(a) * midR);
    body.quaternion.setFromEuler(0, -a, 0);
    bodies.push(body);
  }

  // Center floor disc (removed when hole opens)
  const centerFloorBody = new CANNON.Body({
    mass: 0,
    type: CANNON.Body.STATIC,
    material: ceramicMat,
    shape: new CANNON.Cylinder(holeR * 1.05, holeR * 1.05, floorHalfH * 2, 16),
  });
  // Cannon Cylinder is Y-aligned by default
  centerFloorBody.position.set(0, floorY - floorHalfH, 0);
  bodies.push(centerFloorBody);

  // Bowl walls (segmented boxes)
  const wallSegs = 40;
  const wallHalfT = 0.008;
  const wallCenterR = innerR + wallHalfT;
  const wallChord =
    2 * wallCenterR * Math.tan(Math.PI / wallSegs) * 1.1;
  for (let i = 0; i < wallSegs; i++) {
    const angle = (i / wallSegs) * Math.PI * 2;
    const body = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      material: ceramicMat,
    });
    body.addShape(
      new CANNON.Box(new CANNON.Vec3(wallHalfT, wallH / 2, wallChord / 2)),
    );
    body.position.set(
      Math.cos(angle) * wallCenterR,
      floorY + wallH / 2,
      Math.sin(angle) * wallCenterR,
    );
    body.quaternion.setFromEuler(0, -angle, 0);
    bodies.push(body);
  }

  // Key light mostly on the white spit bowl
  const bowlKeyLight = new THREE.PointLight(0xfff8f0, 2.4, 1.6, 1.6);
  bowlKeyLight.position.set(0.05, floorY + wallH + 0.28, 0.08);
  bowlKeyLight.castShadow = true;
  bowlKeyLight.shadow.mapSize.set(512, 512);
  bowlKeyLight.shadow.bias = -0.0003;
  root.add(bowlKeyLight);

  const bowlFill = new THREE.PointLight(0xddeeff, 0.55, 1.2, 2);
  bowlFill.position.set(-0.12, floorY + wallH + 0.15, -0.1);
  root.add(bowlFill);

  // Subtle under-glow on white ceramic
  const bowlGlow = new THREE.PointLight(0xffffff, 0.35, 0.9, 2);
  bowlGlow.position.set(0, floorY + 0.04, 0);
  root.add(bowlGlow);

  let flickerT = 0;
  let nextFlicker = 2 + Math.random() * 4;
  let flickerBurst = 0;
  const baseKey = 2.4;
  const baseFill = 0.55;

  const build: DentistOfficeBuild = {
    root,
    bowlKeyLight,
    bowlFill,
    bodies,
    ceramicMat,
    centerMark,
    holeMesh,
    centerFloorBody,
    holeOpen: false,
    update(dt: number) {
      flickerT += dt;
      if (flickerBurst > 0) {
        flickerBurst -= dt;
        const n = 0.55 + Math.random() * 0.7;
        bowlKeyLight.intensity = baseKey * n;
        bowlFill.intensity = baseFill * (0.6 + Math.random() * 0.5);
        bowlGlow.intensity = 0.2 + Math.random() * 0.35;
        if (flickerBurst <= 0) {
          bowlKeyLight.intensity = baseKey;
          bowlFill.intensity = baseFill;
          bowlGlow.intensity = 0.35;
          nextFlicker = 1.8 + Math.random() * 5.5;
          flickerT = 0;
        }
      } else if (flickerT >= nextFlicker) {
        // Energy instability burst
        flickerBurst = 0.12 + Math.random() * 0.35;
      } else {
        // Gentle idle shimmer
        const shimmer = 1 + Math.sin(performance.now() * 0.004) * 0.04;
        bowlKeyLight.intensity = baseKey * shimmer;
      }
    },
    openCenterHole(world: CANNON.World) {
      if (this.holeOpen) return;
      this.holeOpen = true;
      world.removeBody(centerFloorBody);
      const idx = bodies.indexOf(centerFloorBody);
      if (idx >= 0) bodies.splice(idx, 1);
      centerMark.visible = false;
      centerDisc.visible = false;
      holeMesh.visible = true;
      drain.visible = true;
    },
  };

  scene.add(root);
  return build;
}
