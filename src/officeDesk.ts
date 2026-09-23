/**
 * Level 4 — lived-in L-shaped mahogany office desk.
 *
 * CRITICAL layout:
 * - ONE tilted desk assembly (mat + wood + channels + props + legs share L4_TILT).
 * - Mat is coplanar with desk top (full rectangle visible; never independently tilted).
 * - Concave U channels W/N/E only; NO south gutter; NO raised lip between mat and channel.
 * - Real through-holes at BOTH SW and SE channel termini.
 * - Desk is fully flat (L4_TILT = 0°); no south incline.
 * - Open mat→channel mouths (no corner muritos); continuous south wood except scoring holes.
 * - Solid Cannon bodies on clutter props.
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {
  CIRCLE_RADIUS,
  MARBLE_RADIUS,
  PLAY_SURFACE_Y,
} from './constants';

/** Half-size of the square playmat (matches chalk diameter). */
export const L4_MAT_HALF = CIRCLE_RADIUS;
/** Channel width carved around the mat. */
export const L4_CHANNEL_W = MARBLE_RADIUS * 7.2;
/** Hole radius — large enough for one marble. */
export const L4_HOLE_RADIUS = MARBLE_RADIUS * 1.65;
/** Desk assembly tilt (rad). 0 = fully flat / straight. */
export const L4_TILT = (0.001 * Math.PI) / 180;

/** Recessed U-channel trough depth (local Y below desk top). */
export const L4_GUTTER_DEPTH = Math.max(MARBLE_RADIUS * 3.2, 0.026);

/** Room floor Y relative to desk top assembly (legs). */
export const L4_ROOM_FLOOR_Y = -0.74;

/**
 * Tight desk footprint in untilted XZ (left slab + right wing).
 * Used for coarse off-desk checks; prefer l4SupportLocalY for physics.
 */
export const L4_DESK_BOUNDS = {
  minX: -0.83,
  maxX: 1.26,
  minZ: -0.43,
  maxZ: 0.71,
};

/**
 * Local desk-top Y of the collider under (x, z), or null if open air / hole.
 * Desk top = 0; channel trough = −L4_GUTTER_DEPTH. World Y ≈ PLAY_SURFACE_Y + local − sin(tilt)·z.
 */
export function l4SupportLocalY(x: number, z: number): number | null {
  const mh = L4_MAT_HALF;
  const cw = L4_CHANNEL_W;
  const hr = L4_HOLE_RADIUS;
  const outer = mh + cw;
  const trough = -L4_GUTTER_DEPTH;

  // Scoring holes — open (fall through)
  const holes = [
    { x: -(mh + cw / 2), z: mh + cw / 2 },
    { x: mh + cw / 2, z: mh + cw / 2 },
  ];
  for (const h of holes) {
    if (Math.hypot(x - h.x, z - h.z) < hr) return null;
  }

  // Playmat top
  if (Math.abs(x) <= mh && Math.abs(z) <= mh) return 0;

  // Concave channels W / N / E (trough floor)
  if (z >= -outer && z <= -mh && Math.abs(x) <= outer) return trough; // north
  if (x >= -outer && x <= -mh && z >= -outer && z <= outer) return trough; // west
  if (x >= mh && x <= outer && z >= -outer && z <= outer) return trough; // east

  // South-of-mat: center wood bridge (desk top); SW/SE mouths open into side troughs
  if (z > mh && z <= outer && Math.abs(x) <= outer) {
    const cornerOpen = cw * 0.95;
    const bridgeHalf = Math.max(0.04, mh - cornerOpen);
    if (Math.abs(x) <= bridgeHalf) return 0;
    return trough;
  }

  // Left desk slab wood margins (outside the play well)
  const leftMinX = -0.825;
  const leftMaxX = 0.525;
  const leftMinZ = -0.425;
  const leftMaxZ = 0.525;
  if (x >= leftMinX && x <= leftMaxX && z >= leftMinZ && z <= leftMaxZ) {
    return 0;
  }

  // Right wing
  const rightCX = 0.895;
  const rightWidth = 0.72;
  const rightLen = 0.85;
  const rightCZ = 0.28;
  if (
    x >= rightCX - rightWidth / 2 &&
    x <= rightCX + rightWidth / 2 &&
    z >= rightCZ - rightLen / 2 &&
    z <= rightCZ + rightLen / 2
  ) {
    return 0;
  }

  return null;
}

/** World-space resting center Y for a marble on L4 support (or null if unsupported). */
export function l4MarbleRestY(x: number, z: number): number | null {
  const local = l4SupportLocalY(x, z);
  if (local === null) return null;
  // Match existing tilt convention used elsewhere in Game.ts
  return PLAY_SURFACE_Y + local - Math.sin(L4_TILT) * z + MARBLE_RADIUS;
}

const MAT_PRESETS: { id: string; label: string; url: string | null }[] = [
  { id: 'avocado', label: 'Aguacate kawaii', url: 'ui/mat-avocado.png' },
  { id: 'neon', label: 'Remolino neón', url: 'ui/mat-neon-swirl.png' },
  { id: 'candy', label: 'Caramelo pastel', url: 'ui/mat-candy.png' },
  { id: 'checker', label: 'Tablero caoba', url: 'ui/mat-checker.png' },
];

export type OfficeDeskBuild = {
  root: THREE.Group;
  bodies: CANNON.Body[];
  woodMat: CANNON.Material;
  matMat: CANNON.Material;
  holeCenters: { x: number; z: number }[];
  holeRadius: number;
  /** Desk footprint for fall-off checks. */
  deskBounds: typeof L4_DESK_BOUNDS;
  lampLight: THREE.SpotLight;
  matMesh: THREE.Mesh;
  update: (dt: number) => void;
  setMatPreset: (id: string) => void;
  setMatFromDataUrl: (dataUrl: string) => void;
  getMatPresets: () => { id: string; label: string }[];
  currentMatId: string;
};

function woodStandard(
  color: number,
  opts: Partial<THREE.MeshStandardMaterialParameters> = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.62,
    metalness: 0.08,
    ...opts,
  });
}

function makeWoodGrainTexture(): THREE.CanvasTexture {
  const s = 512;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#5c2e1a';
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 90; i++) {
    const y = (i / 90) * s + Math.sin(i * 1.7) * 3;
    ctx.strokeStyle = i % 3 === 0 ? 'rgba(90,40,20,0.45)' : 'rgba(140,80,40,0.28)';
    ctx.lineWidth = 1 + (i % 4 === 0 ? 1.5 : 0);
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= s; x += 8) {
      ctx.lineTo(x, y + Math.sin(x * 0.04 + i) * 2.2);
    }
    ctx.stroke();
  }
  for (let k = 0; k < 5; k++) {
    const cx = 60 + k * 90;
    const cy = 80 + ((k * 137) % 350);
    const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, 18);
    g.addColorStop(0, 'rgba(40,18,8,0.55)');
    g.addColorStop(1, 'rgba(40,18,8,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - 20, cy - 20, 40, 40);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2.2, 1.4);
  return tex;
}

function loadMatTexture(url: string, onReady: (t: THREE.Texture) => void): void {
  const loader = new THREE.TextureLoader();
  loader.load(
    url,
    (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(2, 2);
      t.anisotropy = 4;
      onReady(t);
    },
    undefined,
    () => {
      /* keep fallback */
    },
  );
}

export function buildOfficeDesk(
  scene: THREE.Scene,
  _groundMat: CANNON.Material,
): OfficeDeskBuild {
  void _groundMat;
  const root = new THREE.Group();
  root.name = 'officeDesk';
  const bodies: CANNON.Body[] = [];
  const woodMat = new CANNON.Material('deskWood');
  const matMat = new CANNON.Material('playMat');

  const grain = makeWoodGrainTexture();
  const mahog = woodStandard(0x6b3418, { map: grain, roughness: 0.55 });
  const metal = new THREE.MeshStandardMaterial({
    color: 0x1a1a1a,
    metalness: 0.85,
    roughness: 0.35,
  });
  const plastic = new THREE.MeshStandardMaterial({
    color: 0x222226,
    roughness: 0.55,
    metalness: 0.2,
  });

  // ——— Room (untilted) ———
  const legH = 0.74;
  const floorY = -legH;

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 8),
    woodStandard(0xc4b49a, { roughness: 0.92 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = floorY;
  floor.receiveShadow = true;
  root.add(floor);

  // Physics room floor — marbles that leave the desk fall here (no mid-air shelf).
  {
    const floorBody = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      material: woodMat,
    });
    const halfH = 0.04;
    floorBody.addShape(new CANNON.Box(new CANNON.Vec3(4, halfH, 4)));
    floorBody.position.set(0, floorY - halfH, 0);
    bodies.push(floorBody);
  }

  const lino = new THREE.Mesh(
    new THREE.PlaneGeometry(5.5, 5.5),
    woodStandard(0xb8a888, { roughness: 0.9 }),
  );
  lino.rotation.x = -Math.PI / 2;
  lino.position.set(0.4, floorY + 0.002, 0.2);
  root.add(lino);

  const wallMat = woodStandard(0xe8e0d4, { roughness: 0.95 });
  const wallH = 2.6 + legH;
  const wallCy = wallH / 2 + floorY;
  const mkWall = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    m.position.set(x, y, z);
    m.receiveShadow = true;
    root.add(m);
  };
  mkWall(7, wallH, 0.1, 0, wallCy, -2.8);
  mkWall(0.1, wallH, 6, -2.8, wallCy, 0);
  const peel = new THREE.Mesh(
    new THREE.PlaneGeometry(0.55, 0.4),
    woodStandard(0xd8d0c0, { roughness: 1 }),
  );
  peel.position.set(-2.74, 0.35, -2.4);
  peel.rotation.y = Math.PI / 2;
  root.add(peel);

  // ——— ONE desk assembly (visual + physics share L4_TILT; currently flat) ———
  const desk = new THREE.Group();
  desk.name = 'deskAssembly';
  desk.rotation.x = L4_TILT;
  desk.position.set(0, PLAY_SURFACE_Y, 0);
  root.add(desk);

  const qTilt = new CANNON.Quaternion();
  qTilt.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), L4_TILT);

  const mkStatic = (material: CANNON.Material) => {
    const b = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, material });
    b.position.set(0, PLAY_SURFACE_Y, 0);
    b.quaternion.copy(qTilt);
    bodies.push(b);
    return b;
  };

  // Local Y=0 is desk top plane
  const leftLen = 1.35;
  const leftDepth = 0.95;
  const rightLen = 0.85;
  const rightWidth = 0.72;
  const deskThick = 0.05;

  const matHalf = L4_MAT_HALF;
  const chW = L4_CHANNEL_W;
  const holeR = L4_HOLE_RADIUS;
  const gutterDepth = L4_GUTTER_DEPTH;
  const outerHalf = matHalf + chW;

  // Holes at SW / SE ends of side channels (channel centerline X, south channel Z)
  const holeCentersLocal = [
    { x: -(matHalf + chW / 2), z: matHalf + chW / 2 },
    { x: matHalf + chW / 2, z: matHalf + chW / 2 },
  ];

  const mkBoard = (
    w: number,
    h: number,
    d: number,
    x: number,
    yCenter: number,
    z: number,
    mat: THREE.Material = mahog,
  ) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, yCenter, z);
    m.castShadow = true;
    m.receiveShadow = true;
    desk.add(m);
    return m;
  };

  const leftCX = -0.15;
  const leftCZ = 0.05;
  const leftMinX = leftCX - leftLen / 2;
  const leftMaxX = leftCX + leftLen / 2;
  const leftMinZ = leftCZ - leftDepth / 2;
  const leftMaxZ = leftCZ + leftDepth / 2;
  const wMinX = -outerHalf;
  const wMaxX = outerHalf;
  const wMinZ = -outerHalf;
  const wMaxZ = outerHalf;
  const topYc = -deskThick / 2;

  const frameBody = mkStatic(woodMat);
  const addFrameBox = (hx: number, hy: number, hz: number, ox: number, oy: number, oz: number) => {
    if (hx < 0.004 || hz < 0.004) return;
    frameBody.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)), new CANNON.Vec3(ox, oy, oz));
  };

  // North margin (-Z)
  if (wMinZ > leftMinZ + 0.01) {
    const d = wMinZ - leftMinZ;
    const cz = (leftMinZ + wMinZ) / 2;
    mkBoard(leftLen, deskThick, d, leftCX, topYc, cz);
    addFrameBox(leftLen / 2, deskThick / 2, d / 2, leftCX, topYc, cz);
  }

  // South margin (+Z) — continuous wood (holes live inside the play well, not here)
  if (leftMaxZ > wMaxZ + 0.01) {
    const d = leftMaxZ - wMaxZ;
    const cz = (wMaxZ + leftMaxZ) / 2;
    mkBoard(leftLen, deskThick, d, leftCX, topYc, cz);
    addFrameBox(leftLen / 2, deskThick / 2, d / 2, leftCX, topYc, cz);
  }

  // West / East margins
  if (wMinX > leftMinX + 0.01) {
    const w = wMinX - leftMinX;
    const cx = (leftMinX + wMinX) / 2;
    mkBoard(w, deskThick, outerHalf * 2, cx, topYc, 0);
    addFrameBox(w / 2, deskThick / 2, outerHalf, cx, topYc, 0);
  }
  if (leftMaxX > wMaxX + 0.01) {
    const w = leftMaxX - wMaxX;
    const cx = (wMaxX + leftMaxX) / 2;
    mkBoard(w, deskThick, outerHalf * 2, cx, topYc, 0);
    addFrameBox(w / 2, deskThick / 2, outerHalf, cx, topYc, 0);
  }

  // Solid underplate under the left desk with tight openings only at scoring holes.
  // Stops light floor showing through channel cracks / L-voids.
  {
    const plateH = 0.045;
    const plateCy = -gutterDepth - plateH / 2 - 0.003;
    const plateBody = mkStatic(woodMat);
    const addPlate = (w: number, d: number, cx: number, cz: number) => {
      if (w < 0.015 || d < 0.015) return;
      mkBoard(w, plateH, d, cx, plateCy, cz);
      plateBody.addShape(
        new CANNON.Box(new CANNON.Vec3(w / 2, plateH / 2, d / 2)),
        new CANNON.Vec3(cx, plateCy, cz),
      );
    };
    const gap = holeR * 2.05;
    const sw = holeCentersLocal[0]!.x;
    const se = holeCentersLocal[1]!.x;
    const hz = holeCentersLocal[0]!.z;
    // North of holes — full width
    {
      const z1 = hz - gap / 2;
      const d = z1 - leftMinZ;
      if (d > 0.02) addPlate(leftLen, d, leftCX, (leftMinZ + z1) / 2);
    }
    // South of holes — full width
    {
      const z0 = hz + gap / 2;
      const d = leftMaxZ - z0;
      if (d > 0.02) addPlate(leftLen, d, leftCX, (z0 + leftMaxZ) / 2);
    }
    // Mid band (hole row) — three segments around SW/SE holes
    {
      const d = gap;
      const cz = hz;
      addPlate(Math.max(0.02, sw - gap / 2 - leftMinX), d, (leftMinX + (sw - gap / 2)) / 2, cz);
      addPlate(Math.max(0.02, (se - gap / 2) - (sw + gap / 2)), d, ((sw + gap / 2) + (se - gap / 2)) / 2, cz);
      addPlate(Math.max(0.02, leftMaxX - (se + gap / 2)), d, ((se + gap / 2) + leftMaxX) / 2, cz);
    }
  }

  // Mat pedestal — top flush with desk (Y=0).
  // Chamfer SW/SE corners so no vertical "murito" post blocks mat → W/E channel mouths.
  {
    const pedH = gutterDepth;
    const pedCy = -pedH / 2;
    const inset = 0.001;
    const chamfer = chW * 0.95; // open corner into side channels
    const full = matHalf * 2 - inset * 2;
    // Main body shortened in Z so SW/SE corners are open; north stays full width
    const mainD = full - chamfer;
    const mainCz = -chamfer / 2; // shift north
    mkBoard(full, pedH, mainD, 0, pedCy, mainCz);
    // South-center tongue (between chamfers) keeps south mat supported
    const tongueW = full - chamfer * 2;
    if (tongueW > 0.04) {
      mkBoard(tongueW, pedH, chamfer, 0, pedCy, matHalf - inset - chamfer / 2);
    }
    const ped = mkStatic(woodMat);
    ped.addShape(
      new CANNON.Box(new CANNON.Vec3(full / 2, pedH / 2, mainD / 2)),
      new CANNON.Vec3(0, pedCy, mainCz),
    );
    if (tongueW > 0.04) {
      ped.addShape(
        new CANNON.Box(new CANNON.Vec3(tongueW / 2, pedH / 2, chamfer / 2)),
        new CANNON.Vec3(0, pedCy, matHalf - inset - chamfer / 2),
      );
    }
  }

  // Trough pads under chamfered SW/SE mat corners (land marbles into channel)
  {
    const chamfer = chW * 0.95;
    const padT = 0.008;
    const padCy = -gutterDepth + padT / 2;
    const padBody = mkStatic(woodMat);
    for (const side of [-1, 1] as const) {
      const cx = side * (matHalf - chamfer / 2);
      const cz = matHalf - chamfer / 2;
      mkBoard(chamfer * 0.98, padT, chamfer * 0.98, cx, padCy, cz);
      padBody.addShape(
        new CANNON.Box(new CANNON.Vec3((chamfer * 0.98) / 2, padT / 2, (chamfer * 0.98) / 2)),
        new CANNON.Vec3(cx, padCy, cz),
      );
    }
  }

  // Playmat visual — coplanar with desk top (tiny epsilon above Y=0)
  const matGeo = new THREE.PlaneGeometry(matHalf * 2, matHalf * 2);
  const matVis = new THREE.MeshStandardMaterial({
    color: 0x4a7a32,
    roughness: 0.92,
    metalness: 0.0,
  });
  const matMesh = new THREE.Mesh(matGeo, matVis);
  matMesh.rotation.x = -Math.PI / 2;
  matMesh.position.y = 0.0004;
  matMesh.receiveShadow = true;
  matMesh.renderOrder = 1;
  desk.add(matMesh);
  matVis.polygonOffset = true;
  matVis.polygonOffsetFactor = -1;
  matVis.polygonOffsetUnits = -1;

  // Mat physics: box top face exactly at local Y=0 (matches visual / desk plane)
  {
    const matBody = mkStatic(matMat);
    const hh = 0.004;
    matBody.addShape(
      new CANNON.Box(new CANNON.Vec3(matHalf, hh, matHalf)),
      new CANNON.Vec3(0, -hh, 0),
    );
  }

  // ——— Concave U channels (W/N/E) + L-corner fills + holes flush with trough ———
  const chMat = woodStandard(0x5a2e16, { map: grain.clone(), roughness: 0.48 });
  (chMat.map as THREE.Texture).repeat.set(1.2, 0.4);
  const lipMat = woodStandard(0x4a2410, { map: grain.clone(), roughness: 0.5 });
  const channelBody = mkStatic(woodMat);

  /** Visual/physics trough floor top (marble rests at troughY + radius). */
  const troughY = -gutterDepth;
  const floorT = 0.007;
  const floorW = chW * 0.4;
  const bankW = (chW - floorW) * 0.5;
  const bankAng = 0.5; // ~29° banks → readable concave U

  const addShapeBox = (
    body: CANNON.Body,
    hx: number,
    hy: number,
    hz: number,
    ox: number,
    oy: number,
    oz: number,
    quat?: CANNON.Quaternion,
  ) => {
    if (hx < 0.002 || hy < 0.001 || hz < 0.002) return;
    const shape = new CANNON.Box(new CANNON.Vec3(hx, hy, hz));
    if (quat) body.addShape(shape, new CANNON.Vec3(ox, oy, oz), quat);
    else body.addShape(shape, new CANNON.Vec3(ox, oy, oz));
  };

  /** Concave U segment. alongX=true → runs along X (north gutter). outerSign: lip on +/− side.
   *  INNER edge (toward mat) is OPEN — no murito / stub wall — so marbles roll off mat into trough.
   *  Only the OUTER lip + outer bank keep marbles from falling off the desk. */
  const addUChannel = (
    length: number,
    cx: number,
    cz: number,
    alongX: boolean,
    outerSign: number,
  ) => {
    if (length < 0.03) return;
    const fw = alongX ? length : floorW;
    const fd = alongX ? floorW : length;
    const floorCy = troughY + floorT / 2;
    const floorM = new THREE.Mesh(new THREE.BoxGeometry(fw, floorT, fd), chMat);
    floorM.position.set(cx, floorCy, cz);
    floorM.receiveShadow = true;
    desk.add(floorM);
    addShapeBox(channelBody, fw / 2, floorT / 2, fd / 2, cx, floorCy, cz);

    // Outer concave bank only (visual). No inner bank — that was the corner "murito".
    {
      const side = outerSign as -1 | 1;
      const bankDepth = bankW * 1.05;
      const bankThick = 0.01;
      const bank = alongX
        ? new THREE.Mesh(new THREE.BoxGeometry(length, bankThick, bankDepth), lipMat)
        : new THREE.Mesh(new THREE.BoxGeometry(bankDepth, bankThick, length), lipMat);
      const mid = floorW / 2 + bankW * 0.45;
      const ox = alongX ? 0 : side * mid;
      const oz = alongX ? side * mid : 0;
      const by = troughY + gutterDepth * 0.42;
      bank.position.set(cx + ox, by, cz + oz);
      if (alongX) bank.rotation.x = -side * bankAng;
      else bank.rotation.z = side * bankAng;
      bank.castShadow = true;
      bank.receiveShadow = true;
      desk.add(bank);
    }

    // Physics: ONLY outer vertical wall (inner edge open to mat)
    {
      const wallH = gutterDepth * 0.92;
      const wallT = 0.005;
      const wallCy = troughY + wallH / 2;
      const side = outerSign;
      const ox = alongX ? 0 : side * (chW / 2 - wallT / 2);
      const oz = alongX ? side * (chW / 2 - wallT / 2) : 0;
      addShapeBox(
        channelBody,
        alongX ? length / 2 : wallT / 2,
        wallH / 2,
        alongX ? wallT / 2 : length / 2,
        cx + ox,
        wallCy,
        cz + oz,
      );
    }

    // Thin outer lip at desk-top edge (visual + physics)
    const lipH = 0.01;
    const lipT = 0.006;
    const lip = alongX
      ? new THREE.Mesh(new THREE.BoxGeometry(length, lipH, lipT), lipMat)
      : new THREE.Mesh(new THREE.BoxGeometry(lipT, lipH, length), lipMat);
    const lox = alongX ? 0 : outerSign * (chW / 2 - lipT / 2);
    const loz = alongX ? outerSign * (chW / 2 - lipT / 2) : 0;
    lip.position.set(cx + lox, -lipH / 2 + 0.0002, cz + loz);
    lip.castShadow = true;
    desk.add(lip);
    addShapeBox(
      channelBody,
      alongX ? length / 2 : lipT / 2,
      lipH / 2,
      alongX ? lipT / 2 : length / 2,
      cx + lox,
      -lipH / 2,
      cz + loz,
    );
  };

  // North (-Z) full run including NW/NE corners
  {
    const cz = -(matHalf + chW / 2);
    addUChannel(matHalf * 2 + chW * 2, 0, cz, true, -1);
  }

  // West / East: trough runs to hole rim (open terminus — marble drops in)
  {
    const holeClear = holeR * 1.05;
    const weZ0 = -(matHalf + chW);
    const weZ1 = matHalf + chW / 2 - holeClear;
    const weLen = weZ1 - weZ0;
    const weCz = (weZ0 + weZ1) / 2;
    if (weLen > 0.04) {
      addUChannel(weLen, -(matHalf + chW / 2), weCz, false, -1);
      addUChannel(weLen, matHalf + chW / 2, weCz, false, +1);
    }
  }

  // South-of-mat wood (NO south gutter).
  // Center span only — SW/SE corners stay OPEN into W/E channels (no murito end-walls).
  {
    const bridgeZ = matHalf + chW / 2;
    const cornerOpen = chW * 0.95; // open mouth wrapping mat SW/SE into side channels
    const bridgeW = Math.max(0.08, matHalf * 2 - cornerOpen * 2);
    mkBoard(bridgeW, gutterDepth, chW, 0, -gutterDepth / 2, bridgeZ);
    const br = mkStatic(woodMat);
    br.addShape(
      new CANNON.Box(new CANNON.Vec3(bridgeW / 2, gutterDepth / 2, chW / 2)),
      new CANNON.Vec3(0, -gutterDepth / 2, bridgeZ),
    );
  }

  // SW / SE termini: continuous desk-top wood with ONLY circular hole openings
  // + a narrow recessed corridor from the W/E channel into each hole.
  // No rectangular L-voids; no murito posts at mat corners.
  const fillCorner = (hx: number, hz: number) => {
    const side = Math.sign(hx) || 1;
    const cornerBody = mkStatic(woodMat);

    const xMat = side * matHalf;
    const xOut = side * outerHalf;
    const zMat = matHalf;
    const zOut = outerHalf;
    const xLo = Math.min(xMat, xOut);
    const xHi = Math.max(xMat, xOut);

    const fillH = gutterDepth;
    const fillCy = -fillH / 2;
    const corridorW = chW * 0.92; // full channel width stays open from mat → hole (no murito)

    // Desk-top wood ONLY south of hole + outer flank — NEVER between mat and hole
    // (that band stays recessed so SW/SE mouths are open).
    {
      // South-of-hole band across full strip
      {
        const za = hz + holeR * 1.08;
        const zb = zOut;
        const d = zb - za;
        if (d > 0.004) {
          mkBoard(xHi - xLo, fillH, d, (xLo + xHi) / 2, fillCy, (za + zb) / 2);
          addShapeBox(cornerBody, (xHi - xLo) / 2, fillH / 2, d / 2, (xLo + xHi) / 2, fillCy, (za + zb) / 2);
        }
      }
      // Outer flank beside hole (away from mat)
      {
        const za = zMat;
        const zb = hz + holeR * 1.08;
        const d = zb - za;
        if (d > 0.004) {
          if (side < 0) {
            const xa = xOut;
            const xb = hx - Math.max(corridorW / 2, holeR * 1.05);
            const w = xb - xa;
            if (w > 0.004) {
              mkBoard(w, fillH, d, (xa + xb) / 2, fillCy, (za + zb) / 2);
              addShapeBox(cornerBody, w / 2, fillH / 2, d / 2, (xa + xb) / 2, fillCy, (za + zb) / 2);
            }
          } else {
            const xa = hx + Math.max(corridorW / 2, holeR * 1.05);
            const xb = xOut;
            const w = xb - xa;
            if (w > 0.004) {
              mkBoard(w, fillH, d, (xa + xb) / 2, fillCy, (za + zb) / 2);
              addShapeBox(cornerBody, w / 2, fillH / 2, d / 2, (xa + xb) / 2, fillCy, (za + zb) / 2);
            }
          }
        }
      }
    }

    // Trough floor only in the corridor + around hole rim (marble path)
    {
      const apronT = floorT;
      const apronCy = troughY + apronT / 2;
      const slabs: [number, number, number, number][] = [
        // corridor from mat to hole
        [hx - corridorW / 2, hx + corridorW / 2, zMat, hz - holeR * 1.02],
        // ring around hole
        [xLo, xHi, hz - holeR * 1.02, hz + holeR * 1.02],
        [hx - holeR * 1.02, hx + holeR * 1.02, hz - holeR * 1.02, hz + holeR * 1.02],
      ];
      // Refine ring into 4 slabs excluding hole disk
      const ring: [number, number, number, number][] = [
        [hx - corridorW / 2, hx + corridorW / 2, zMat, hz - holeR * 1.02],
        [xLo, xHi, hz + holeR * 1.02, Math.min(zOut, hz + holeR * 1.02 + 0.004)], // tiny deadzone
        [hx - holeR * 1.02, hx + holeR * 1.02, hz - holeR * 1.02, hz + holeR * 1.02], // will skip center via mesh only at edges
      ];
      void slabs;
      // Corridor floor
      {
        const w = corridorW;
        const d = hz - holeR * 1.02 - zMat;
        if (d > 0.004) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(w, apronT, d), chMat);
          m.position.set(hx, apronCy, (zMat + (hz - holeR * 1.02)) / 2);
          m.receiveShadow = true;
          desk.add(m);
          addShapeBox(channelBody, w / 2, apronT / 2, d / 2, hx, apronCy, (zMat + (hz - holeR * 1.02)) / 2);
        }
      }
      // Floor pads N/S/W/E of hole
      for (const [xa, xb, za, zb] of [
        [hx - holeR * 1.6, hx + holeR * 1.6, hz + holeR * 1.02, hz + holeR * 1.6],
        [hx - holeR * 1.6, hx - holeR * 1.02, hz - holeR * 1.02, hz + holeR * 1.02],
        [hx + holeR * 1.02, hx + holeR * 1.6, hz - holeR * 1.02, hz + holeR * 1.02],
      ] as [number, number, number, number][]) {
        const w = xb - xa;
        const d = zb - za;
        if (w < 0.003 || d < 0.003) continue;
        const cx = (xa + xb) / 2;
        const cz = (za + zb) / 2;
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, apronT, d), chMat);
        m.position.set(cx, apronCy, cz);
        m.receiveShadow = true;
        desk.add(m);
        addShapeBox(channelBody, w / 2, apronT / 2, d / 2, cx, apronCy, cz);
      }
      void ring;
    }

    // Through-hole visual — rim FLUSH with trough floor
    const pit = new THREE.Mesh(
      new THREE.CircleGeometry(holeR * 1.05, 28),
      new THREE.MeshBasicMaterial({ color: 0x000000 }),
    );
    pit.rotation.x = -Math.PI / 2;
    pit.position.set(hx, troughY - 0.0005, hz);
    desk.add(pit);

    const shaftH = gutterDepth + deskThick + 0.16;
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(holeR * 0.98, holeR * 1.06, shaftH, 22, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0x120805,
        roughness: 0.95,
        side: THREE.DoubleSide,
      }),
    );
    shaft.position.set(hx, troughY - shaftH / 2, hz);
    desk.add(shaft);

    {
      const cap = new THREE.Mesh(
        new THREE.CircleGeometry(holeR * 1.05, 24),
        new THREE.MeshBasicMaterial({ color: 0x000000 }),
      );
      cap.rotation.x = -Math.PI / 2;
      cap.position.set(hx, troughY - shaftH + 0.002, hz);
      desk.add(cap);
    }

    const rim = new THREE.Mesh(
      new THREE.RingGeometry(holeR * 0.98, holeR * 1.22, 28),
      new THREE.MeshStandardMaterial({ color: 0x1a0c06, roughness: 0.92, metalness: 0 }),
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(hx, troughY + floorT + 0.0002, hz);
    desk.add(rim);

    // Outer cheek only
    {
      const cheekW = 0.007;
      const cheekH = 0.012;
      const cheek = new THREE.Mesh(
        new THREE.BoxGeometry(cheekW, cheekH, holeR * 2.4),
        lipMat,
      );
      cheek.position.set(hx + side * (chW / 2 - cheekW / 2), -cheekH / 2, hz);
      cheek.castShadow = true;
      desk.add(cheek);
      addShapeBox(
        channelBody,
        cheekW / 2,
        cheekH / 2,
        holeR * 1.2,
        hx + side * (chW / 2 - cheekW / 2),
        -cheekH / 2,
        hz,
      );
    }
  };

  for (const h of holeCentersLocal) fillCorner(h.x, h.z);

  // Right wing top — MUST sit fully east of the play well (no overlap with mat/channels/holes)
  const rightCX = leftMaxX + rightWidth / 2 + 0.01; // ≈ 0.895
  desk.userData.rightCX = rightCX;
  desk.userData.leftMaxX = leftMaxX;
  desk.userData.outerHalf = outerHalf;
  const rightCZ = 0.28;
  mkBoard(rightWidth, deskThick, rightLen, rightCX, topYc, rightCZ);
  {
    const rw = mkStatic(woodMat);
    rw.addShape(
      new CANNON.Box(new CANNON.Vec3(rightWidth / 2, deskThick / 2, rightLen / 2)),
      new CANNON.Vec3(rightCX, topYc, rightCZ),
    );
  }

  // Legs (tilt with desk)
  const mkLeg = (x: number, z: number) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.055, legH, 0.055), metal);
    leg.position.set(x, -legH / 2, z);
    leg.castShadow = true;
    leg.receiveShadow = true;
    desk.add(leg);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.014, 0.07), metal);
    foot.position.set(x, -legH + 0.007, z);
    desk.add(foot);
  };
  mkLeg(-0.78, -0.4);
  mkLeg(-0.78, 0.48);
  mkLeg(leftMaxX - 0.05, -0.32);
  mkLeg(rightCX + rightWidth / 2 - 0.05, rightCZ + rightLen / 2 - 0.08);

  // Apron
  const apronH = 0.07;
  const apronMat = woodStandard(0x4a2410, { map: grain.clone(), roughness: 0.6 });
  const addApron = (w: number, d: number, x: number, z: number) => {
    const a = new THREE.Mesh(new THREE.BoxGeometry(w, apronH, d), apronMat);
    a.position.set(x, -deskThick - apronH / 2, z);
    a.castShadow = true;
    desk.add(a);
  };
  addApron(leftLen, 0.03, -0.15, 0.05 - leftDepth / 2 + 0.015);
  addApron(leftLen, 0.03, -0.15, 0.05 + leftDepth / 2 - 0.015);
  addApron(0.03, leftDepth, -0.15 - leftLen / 2 + 0.015, 0.05);
  addApron(0.03, leftDepth * 0.55, -0.15 + leftLen / 2 - 0.015, 0.05 - leftDepth * 0.2);
  addApron(rightWidth, 0.03, rightCX, rightCZ - rightLen / 2 + 0.015);
  addApron(rightWidth, 0.03, rightCX, rightCZ + rightLen / 2 - 0.015);
  addApron(0.03, rightLen, rightCX + rightWidth / 2 - 0.015, rightCZ);

  const underFill = new THREE.PointLight(0xffe0b0, 0.55, 2.2, 2);
  underFill.position.set(0.1, -legH * 0.55, 0.1);
  desk.add(underFill);
  const floorFill = new THREE.HemisphereLight(0xf0e8d8, 0x2a1810, 0.35);
  desk.add(floorFill);

  // ——— Clutter + solid Cannon props ———
  const clutter = new THREE.Group();
  clutter.position.set(rightCX, 0, rightCZ);
  desk.add(clutter);
  const propBody = mkStatic(woodMat);

  const addPropBox = (w: number, h: number, d: number, lx: number, ly: number, lz: number) => {
    propBody.addShape(
      new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)),
      new CANNON.Vec3(rightCX + lx, ly, rightCZ + lz),
    );
  };

  // Laptop
  const laptopBase = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.012, 0.22), plastic);
  laptopBase.position.set(0.05, 0.008, -0.12);
  laptopBase.castShadow = true;
  clutter.add(laptopBase);
  addPropBox(0.32, 0.012, 0.22, 0.05, 0.008, -0.12);
  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.2, 0.008),
    new THREE.MeshStandardMaterial({ color: 0x111118, metalness: 0.4, roughness: 0.4 }),
  );
  screen.position.set(0.05, 0.11, -0.22);
  screen.rotation.x = -0.2;
  clutter.add(screen);
  addPropBox(0.32, 0.18, 0.03, 0.05, 0.11, -0.22);
  const screenGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.28, 0.16),
    new THREE.MeshBasicMaterial({ color: 0x3a6ea5 }),
  );
  screenGlow.position.set(0.05, 0.11, -0.215);
  screenGlow.rotation.x = -0.2;
  clutter.add(screenGlow);

  // Mouse mat + mouse
  const mousePad = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.004, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x0d0d0f, roughness: 0.85 }),
  );
  mousePad.position.set(0.22, 0.004, 0.08);
  clutter.add(mousePad);
  addPropBox(0.16, 0.004, 0.2, 0.22, 0.004, 0.08);
  const mouse = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.018, 0.06), plastic);
  mouse.position.set(0.22, 0.014, 0.06);
  clutter.add(mouse);
  addPropBox(0.04, 0.018, 0.06, 0.22, 0.014, 0.06);

  // Books
  const bookColors = [0x2c4a6e, 0x6e3b2c, 0x3d5a3a];
  for (let i = 0; i < 3; i++) {
    const bw = 0.14 + i * 0.01;
    const bh = 0.022;
    const bd = 0.2 - i * 0.01;
    const bx = -0.18;
    const by = 0.015 + i * 0.024;
    const bz = 0.18;
    const b = new THREE.Mesh(
      new THREE.BoxGeometry(bw, bh, bd),
      woodStandard(bookColors[i]!, { roughness: 0.8 }),
    );
    b.position.set(bx, by, bz);
    b.rotation.y = (i - 1) * 0.12;
    b.castShadow = true;
    clutter.add(b);
    addPropBox(bw, bh, bd, bx, by, bz);
  }

  // Phone
  const phone = new THREE.Mesh(
    new THREE.BoxGeometry(0.036, 0.008, 0.072),
    new THREE.MeshStandardMaterial({ color: 0x1c1c1e, metalness: 0.6, roughness: 0.3 }),
  );
  phone.position.set(0.0, 0.006, 0.22);
  phone.rotation.y = 0.4;
  clutter.add(phone);
  addPropBox(0.036, 0.008, 0.072, 0.0, 0.006, 0.22);
  const phoneScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.03, 0.06),
    new THREE.MeshBasicMaterial({ color: 0x5ac8fa }),
  );
  phoneScreen.rotation.x = -Math.PI / 2;
  phoneScreen.position.set(0.0, 0.011, 0.22);
  phoneScreen.rotation.z = 0.4;
  clutter.add(phoneScreen);

  // Shaker
  const shaker = new THREE.Mesh(
    new THREE.CylinderGeometry(0.032, 0.028, 0.14, 16),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.45, metalness: 0.15 }),
  );
  shaker.position.set(-0.28, 0.07, -0.05);
  shaker.castShadow = true;
  clutter.add(shaker);
  propBody.addShape(
    new CANNON.Cylinder(0.032, 0.028, 0.14, 10),
    new CANNON.Vec3(rightCX - 0.28, 0.07, rightCZ - 0.05),
    new CANNON.Quaternion().setFromEuler(Math.PI / 2, 0, 0),
  );
  const shakerLid = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.025, 16), plastic);
  shakerLid.position.set(-0.28, 0.15, -0.05);
  clutter.add(shakerLid);

  // Chess
  const chess = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.018, 0.18),
    woodStandard(0x8b5a2b, { roughness: 0.55 }),
  );
  chess.position.set(0.12, 0.012, 0.28);
  chess.rotation.y = -0.25;
  chess.castShadow = true;
  clutter.add(chess);
  addPropBox(0.18, 0.018, 0.18, 0.12, 0.012, 0.28);
  const chessTop = new THREE.Mesh(
    new THREE.PlaneGeometry(0.16, 0.16),
    new THREE.MeshStandardMaterial({
      color: 0xc4a574,
      map: (() => {
        const c = document.createElement('canvas');
        c.width = 64;
        c.height = 64;
        const ctx = c.getContext('2d')!;
        for (let y = 0; y < 8; y++)
          for (let x = 0; x < 8; x++) {
            ctx.fillStyle = (x + y) % 2 ? '#3e2723' : '#d7ccc8';
            ctx.fillRect(x * 8, y * 8, 8, 8);
          }
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
      })(),
      roughness: 0.6,
    }),
  );
  chessTop.rotation.x = -Math.PI / 2;
  chessTop.position.set(0.12, 0.022, 0.28);
  chessTop.rotation.z = -0.25;
  clutter.add(chessTop);

  // Trash can
  const binH = 0.28;
  const bin = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.08, binH, 14),
    new THREE.MeshStandardMaterial({ color: 0x333338, roughness: 0.55, metalness: 0.4 }),
  );
  bin.position.set(rightCX - 0.2, -legH + binH / 2, rightCZ + 0.35);
  bin.castShadow = true;
  desk.add(bin);
  {
    const binBody = mkStatic(woodMat);
    binBody.addShape(
      new CANNON.Cylinder(0.09, 0.08, binH, 10),
      new CANNON.Vec3(rightCX - 0.2, -legH + binH / 2, rightCZ + 0.35),
      new CANNON.Quaternion().setFromEuler(Math.PI / 2, 0, 0),
    );
  }
  for (let i = 0; i < 4; i++) {
    const scrap = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.002, 0.05),
      woodStandard(0xe8e0d0),
    );
    scrap.position.set(
      0.35 + (i - 1.5) * 0.025,
      -legH + binH * 0.55 + i * 0.01,
      0.55 + (i % 2) * 0.02,
    );
    scrap.rotation.y = i * 0.5;
    desk.add(scrap);
  }

  // Lamp — matte black gooseneck desk lamp (reference remodel)
  const lampGroup = new THREE.Group();
  lampGroup.name = 'gooseneckLamp';
  lampGroup.position.set(-0.7, 0, -0.42);
  desk.add(lampGroup);

  const lampBlack = new THREE.MeshStandardMaterial({
    color: 0x0a0a0a,
    roughness: 0.72,
    metalness: 0.18,
  });
  const lampShadeIn = new THREE.MeshStandardMaterial({
    color: 0xf2f2f0,
    roughness: 0.55,
    metalness: 0.05,
    side: THREE.BackSide,
  });
  const lampSwitchFace = new THREE.MeshStandardMaterial({
    color: 0x111111,
    roughness: 0.55,
    metalness: 0.1,
  });
  const lampMark = new THREE.MeshStandardMaterial({
    color: 0xe8e8e8,
    roughness: 0.6,
    metalness: 0,
  });
  const cordMat = new THREE.MeshStandardMaterial({
    color: 0x6a6a6e,
    roughness: 0.85,
    metalness: 0.05,
  });

  // Circular base: low disc + slight dome
  const baseR = 0.062;
  const baseH = 0.016;
  const baseDisc = new THREE.Mesh(
    new THREE.CylinderGeometry(baseR, baseR * 1.02, baseH, 32),
    lampBlack,
  );
  baseDisc.position.y = baseH / 2;
  baseDisc.castShadow = true;
  baseDisc.receiveShadow = true;
  lampGroup.add(baseDisc);
  const baseDome = new THREE.Mesh(
    new THREE.SphereGeometry(baseR * 1.02, 28, 12, 0, Math.PI * 2, 0, Math.PI * 0.28),
    lampBlack,
  );
  baseDome.scale.y = 0.28;
  baseDome.position.y = baseH * 0.65;
  baseDome.castShadow = true;
  lampGroup.add(baseDome);
  // Bottom lip / seam
  const baseLip = new THREE.Mesh(
    new THREE.TorusGeometry(baseR * 0.98, 0.0022, 8, 40),
    lampBlack,
  );
  baseLip.rotation.x = Math.PI / 2;
  baseLip.position.y = 0.0015;
  lampGroup.add(baseLip);

  // Rocker switch on top toward front (+Z)
  const switchBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.016, 0.006, 0.022),
    lampSwitchFace,
  );
  const swY = baseH + 0.014;
  switchBody.position.set(0.018, swY, 0.034);
  lampGroup.add(switchBody);
  const rocker = new THREE.Mesh(
    new THREE.BoxGeometry(0.012, 0.004, 0.018),
    lampBlack,
  );
  rocker.position.set(0.018, swY + 0.004, 0.034);
  rocker.rotation.x = -0.12;
  lampGroup.add(rocker);
  // I / O marks
  const markI = new THREE.Mesh(new THREE.BoxGeometry(0.0012, 0.0008, 0.005), lampMark);
  markI.position.set(0.018, swY + 0.0065, 0.028);
  lampGroup.add(markI);
  const markO = new THREE.Mesh(
    new THREE.TorusGeometry(0.0022, 0.00055, 6, 12),
    lampMark,
  );
  markO.rotation.x = Math.PI / 2;
  markO.position.set(0.018, swY + 0.0065, 0.040);
  lampGroup.add(markO);

  // Thin grey cord from back of base
  const cordCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.006, -baseR * 0.85),
    new THREE.Vector3(0.01, -0.02, -baseR - 0.04),
    new THREE.Vector3(0.04, -0.12, -baseR - 0.08),
    new THREE.Vector3(0.08, -0.35, -baseR - 0.06),
  ]);
  const cord = new THREE.Mesh(
    new THREE.TubeGeometry(cordCurve, 16, 0.0032, 6, false),
    cordMat,
  );
  lampGroup.add(cord);

  // Flexible gooseneck: rise from center, smooth C toward +Z (desk / light area)
  const neckCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, baseH + 0.01, 0),
    new THREE.Vector3(0, 0.12, 0.01),
    new THREE.Vector3(0.01, 0.26, 0.04),
    new THREE.Vector3(0.03, 0.34, 0.12),
    new THREE.Vector3(0.05, 0.36, 0.22),
    new THREE.Vector3(0.06, 0.32, 0.30),
  ]);
  const ribCount = 56;
  const neckFrames = neckCurve.computeFrenetFrames(ribCount, false);
  const neckPts = neckCurve.getSpacedPoints(ribCount);
  const ribGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
  const upY = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < neckPts.length; i++) {
    const p = neckPts[i]!;
    const tang = neckFrames.tangents[i]!.clone().normalize();
    const next = neckPts[Math.min(i + 1, neckPts.length - 1)]!;
    const seg = Math.max(p.distanceTo(next) * 1.15, 0.0028);
    const r = i % 2 === 0 ? 0.0092 : 0.0074;
    const rib = new THREE.Mesh(ribGeo, lampBlack);
    rib.scale.set(r, seg, r);
    rib.position.copy(p);
    rib.quaternion.setFromUnitVectors(upY, tang);
    rib.castShadow = true;
    lampGroup.add(rib);
  }
  // Small ferrule at base of neck
  const ferrule = new THREE.Mesh(
    new THREE.CylinderGeometry(0.011, 0.013, 0.014, 14),
    lampBlack,
  );
  ferrule.position.set(0, baseH + 0.012, 0);
  lampGroup.add(ferrule);

  // Shade tip = end of neck
  const shadeTip = neckPts[neckPts.length - 1]!.clone();
  const shadeTang = neckFrames.tangents[neckPts.length - 1]!.clone().normalize();

  // Pivot joint at neck→shade
  const pivot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.01, 0.01, 0.018, 12),
    lampBlack,
  );
  pivot.position.copy(shadeTip);
  pivot.quaternion.setFromUnitVectors(upY, shadeTang);
  lampGroup.add(pivot);
  const pivotBall = new THREE.Mesh(new THREE.SphereGeometry(0.011, 12, 10), lampBlack);
  pivotBall.position.copy(shadeTip).addScaledVector(shadeTang, 0.01);
  lampGroup.add(pivotBall);

  // Bell / dome shade (black exterior + white interior)
  // Lathe profile: tip at +Y, open rim at Y=0. Local +Y aims back toward neck.
  const shadeH = 0.055;
  const shadeProfile: THREE.Vector2[] = [
    new THREE.Vector2(0.01, shadeH),
    new THREE.Vector2(0.018, 0.052),
    new THREE.Vector2(0.032, 0.042),
    new THREE.Vector2(0.048, 0.025),
    new THREE.Vector2(0.056, 0.01),
    new THREE.Vector2(0.058, 0.0),
  ];
  const shadeOuter = new THREE.Mesh(new THREE.LatheGeometry(shadeProfile, 28), lampBlack);
  const shadeInner = new THREE.Mesh(
    new THREE.LatheGeometry(
      shadeProfile.map((v) => new THREE.Vector2(Math.max(0.004, v.x - 0.0025), v.y)),
      28,
    ),
    lampShadeIn,
  );
  const shadeAttach = shadeTip.clone().addScaledVector(shadeTang, 0.014);
  const shadeGroup = new THREE.Group();
  shadeGroup.quaternion.setFromUnitVectors(upY, shadeTang.clone().negate());
  // tip (local +shadeH) sits on pivot; rim (y=0) opens along +shadeTang
  shadeGroup.position.copy(shadeAttach).addScaledVector(shadeTang, shadeH);
  shadeOuter.castShadow = true;
  shadeGroup.add(shadeOuter);
  shadeGroup.add(shadeInner);
  lampGroup.add(shadeGroup);

  // Large spherical frosted bulb — partially recessed, protrudes past rim
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xf5f7fa,
    emissive: 0xdde8ff,
    emissiveIntensity: 1.45,
    roughness: 0.85,
    metalness: 0,
    transparent: true,
    opacity: 0.92,
  });
  const bulbR = 0.036;
  const bulbMesh = new THREE.Mesh(new THREE.SphereGeometry(bulbR, 24, 18), bulbMat);
  // local −Y = +shadeTang → past the rim
  bulbMesh.position.set(0, -0.042, 0);
  shadeGroup.add(bulbMesh);

  // Cool-white lighting (SpotLight kept for OfficeDeskBuild API + PointLight for fill)
  const lampLight = new THREE.SpotLight(0xe8f2ff, 2.6, 3.0, Math.PI / 4.2, 0.55, 1.15);
  const bulbWorld = shadeAttach.clone().addScaledVector(shadeTang, shadeH + 0.04);
  lampLight.position.copy(bulbWorld);
  lampLight.target.position.set(0.55, 0.02, 0.45);
  lampLight.castShadow = true;
  lampLight.shadow.mapSize.set(512, 512);
  lampGroup.add(lampLight);
  lampGroup.add(lampLight.target);
  const bulbGlow = new THREE.PointLight(0xeaf2ff, 0.9, 2.0, 1.8);
  bulbGlow.position.copy(bulbWorld);
  lampGroup.add(bulbGlow);

  // Solid colliders: base cylinder + shade approx sphere (desk-local)
  const lampOx = -0.7;
  const lampOz = -0.42;
  propBody.addShape(
    new CANNON.Cylinder(baseR, baseR, baseH + 0.01, 12),
    new CANNON.Vec3(lampOx, (baseH + 0.01) / 2, lampOz),
    new CANNON.Quaternion().setFromEuler(Math.PI / 2, 0, 0),
  );
  propBody.addShape(
    new CANNON.Sphere(0.058),
    new CANNON.Vec3(lampOx + bulbWorld.x, bulbWorld.y, lampOz + bulbWorld.z),
  );
  for (const t of [0.25, 0.5, 0.75]) {
    const p = neckCurve.getPoint(t);
    propBody.addShape(
      new CANNON.Sphere(0.014),
      new CANNON.Vec3(lampOx + p.x, p.y, lampOz + p.z),
    );
  }

  // Blinds (room)
  const blinds = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 1.1),
    woodStandard(0x9aa0a6, { roughness: 0.85, transparent: true, opacity: 0.55 }),
  );
  blinds.position.set(0.2, 1.6, -2.74);
  root.add(blinds);

  scene.add(root);

  // Hole centers ≈ world XZ (tilt factor kept for API; currently 0)
  const cy = Math.cos(L4_TILT);
  const sy = Math.sin(L4_TILT);
  const holeCenters = holeCentersLocal.map((h) => {
    const yLocal = -gutterDepth;
    return { x: h.x, z: yLocal * sy + h.z * cy };
  });

  let currentMatId = 'avocado';
  let matTex: THREE.Texture | null = null;

  const applyTex = (t: THREE.Texture) => {
    if (matTex && matTex !== t) matTex.dispose();
    matTex = t;
    matVis.map = t;
    matVis.color.setHex(0xffffff);
    matVis.needsUpdate = true;
    // Keep mat flush after texture swap
    matMesh.position.set(0, 0.0004, 0);
    matMesh.rotation.set(-Math.PI / 2, 0, 0);
  };

  const setMatPreset = (id: string) => {
    const preset = MAT_PRESETS.find((p) => p.id === id);
    if (!preset?.url) return;
    currentMatId = id;
    loadMatTexture(preset.url, applyTex);
  };

  const setMatFromDataUrl = (dataUrl: string) => {
    currentMatId = 'custom';
    const loader = new THREE.TextureLoader();
    loader.load(dataUrl, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(1.5, 1.5);
      applyTex(t);
    });
  };

  setMatPreset('avocado');

  let tSec = 0;
  const update = (dt: number) => {
    tSec += dt;
    const pulse = Math.sin(tSec * 1.7) * 0.12;
    lampLight.intensity = 2.45 + pulse;
    bulbGlow.intensity = 0.85 + pulse * 0.35;
    bulbMat.emissiveIntensity = 1.35 + pulse * 0.25;
  };

  
  
  return {
    root,
    bodies,
    woodMat,
    matMat,
    holeCenters,
    holeRadius: holeR,
    deskBounds: { ...L4_DESK_BOUNDS },
    lampLight,
    matMesh,
    update,
    setMatPreset,
    setMatFromDataUrl,
    getMatPresets: () => MAT_PRESETS.map(({ id, label }) => ({ id, label })),
    get currentMatId() {
      return currentMatId;
    },
    set currentMatId(v: string) {
      currentMatId = v;
    },
  };
}
