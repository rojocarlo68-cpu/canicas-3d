/**
 * Level 4 — lived-in L-shaped mahogany office desk.
 *
 * CRITICAL layout:
 * - ONE tilted desk assembly (mat + wood + half-pipe ring + props + legs share L4_TILT).
 * - Mat is coplanar with desk top (full rectangle visible; never independently tilted).
 * - Continuous HALF-PIPE channel ring on ALL four sides (N/S/E/W) with rounded corners.
 * - ONE scoring through-hole only (south-center of the ring). No second SW/SE hole.
 * - Tiny south tilt (L4_TILT ≈ 0.001°) for balance; do not retune lightly.
 * - Open mat→channel lips (rounded); no square 90° trough corners (no wedging).
 * - Solid Cannon bodies on clutter props.
 * - Invisible shooter-only BRIDGES over the half-pipe ring (collision groups) so field
 *   marbles fall into the trough / score via the single hole, while player+AI shooters
 *   roll across the channel onto outer wood as if a bridge spanned the gap.
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
export const L4_CHANNEL_W = MARBLE_RADIUS * 3.6; // ~1.8× diameter — one marble rolls freely
/** Hole radius — large enough for one marble. */
export const L4_HOLE_RADIUS = MARBLE_RADIUS * 1.65;
/** Desk assembly tilt (rad). 0 = fully flat / straight. */
export const L4_TILT = (0.001 * Math.PI) / 180;

/** Recessed U-channel trough depth (local Y below desk top). */
export const L4_GUTTER_DEPTH = L4_CHANNEL_W / 2; // true half-pipe radius
/** Half-pipe cross-section radius (= channel half-width). */
export const L4_PIPE_R = L4_CHANNEL_W / 2;

/** Room floor Y relative to desk top assembly (legs). */
export const L4_ROOM_FLOOR_Y = -0.74;

/** Cannon collision groups (bit masks). Default world/field = 1. */
export const L4_COL_GROUP_DEFAULT = 1;
export const L4_COL_GROUP_SHOOTER = 2;
export const L4_COL_GROUP_SHOOTER_BLOCKER = 4;

/** Tag a shooter body so it collides with L4 channel/hole lids (field marbles do not). */
export function applyL4ShooterCollisionFilter(body: CANNON.Body): void {
  body.collisionFilterGroup = L4_COL_GROUP_SHOOTER;
  body.collisionFilterMask = -1; // default world + other shooters + blockers
}

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
/** Single L4 scoring hole — south-center of the half-pipe ring. */
export function l4HoleCentersLocal(): { x: number; z: number }[] {
  const mh = L4_MAT_HALF;
  const r = L4_PIPE_R;
  return [{ x: 0, z: mh + r }];
}

/**
 * Signed lateral offset from the rounded-rect channel centerline.
 * 0 = centerline (trough bottom); ±L4_PIPE_R = lips at desk top.
 * null = not in the channel band (mat interior or outside the ring).
 */
export function l4ChannelLateral(x: number, z: number): number | null {
  const mh = L4_MAT_HALF;
  const R = L4_PIPE_R;
  const ax = Math.abs(x);
  const az = Math.abs(z);
  // Interior of mat — not in channel
  if (ax <= mh && az <= mh) return null;
  // Outside the outer lip of the ring
  const outer = mh + 2 * R;
  if (ax > outer + 1e-6 || az > outer + 1e-6) return null;
  if (ax <= mh) {
    // North / south straight: centerline at |z| = mh + R
    return az - (mh + R);
  }
  if (az <= mh) {
    // West / east straight: centerline at |x| = mh + R
    return ax - (mh + R);
  }
  // Corner quarter-circle centerline centered at (±mh, ±mh) with radius R
  const dist = Math.hypot(ax - mh, az - mh);
  // Outside outer corner lip
  if (dist > 2 * R + 1e-6) return null;
  return dist - R;
}

/**
 * Local desk-top Y of the collider under (x, z), or null if open air / hole.
 * Desk top = 0; half-pipe floor = −sqrt(R² − lat²). World Y ≈ PLAY_SURFACE_Y + local − sin(tilt)·z.
 */
export function l4SupportLocalY(x: number, z: number): number | null {
  const mh = L4_MAT_HALF;
  const R = L4_PIPE_R;
  const hr = L4_HOLE_RADIUS;
  const outer = mh + 2 * R;

  // Single scoring hole — open (fall through)
  for (const h of l4HoleCentersLocal()) {
    if (Math.hypot(x - h.x, z - h.z) < hr) return null;
  }

  // Playmat top
  if (Math.abs(x) <= mh && Math.abs(z) <= mh) return 0;

  // Half-pipe ring (straights + rounded corners)
  const lat = l4ChannelLateral(x, z);
  if (lat !== null && Math.abs(lat) <= R + 1e-6) {
    const clamped = Math.max(-R, Math.min(R, lat));
    return -Math.sqrt(Math.max(0, R * R - clamped * clamped));
  }

  // Left desk slab wood margins (outside the play well)
  const leftMinX = -0.825;
  const leftMaxX = 0.525;
  const leftMinZ = -0.425;
  const leftMaxZ = 0.525;
  if (x >= leftMinX && x <= leftMaxX && z >= leftMinZ && z <= leftMaxZ) {
    // Outside the channel outer lip → desk top wood
    if (Math.abs(x) >= outer - 1e-6 || Math.abs(z) >= outer - 1e-6 || lat === null) {
      return 0;
    }
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

  // Outer wood ring just beyond the half-pipe (within left slab footprint)
  if (x >= leftMinX && x <= leftMaxX && z >= leftMinZ && z <= leftMaxZ) {
    return 0;
  }

  return null;
}

/** World-space resting center Y for a marble on L4 support (or null if unsupported). */
export function l4MarbleRestY(x: number, z: number): number | null {
  const local = l4SupportLocalY(x, z);
  if (local === null) return null;
  return PLAY_SURFACE_Y + local - Math.sin(L4_TILT) * z + MARBLE_RADIUS;
}

/**
 * Shooter support: invisible bridges span the half-pipe ring + hole at desk-top height.
 * Returns local Y (=0 on play well / wood / bridges) or null if off the desk entirely.
 */
export function l4ShooterSupportLocalY(x: number, z: number): number | null {
  const mh = L4_MAT_HALF;
  const R = L4_PIPE_R;
  const outer = mh + 2 * R;
  // Entire play well (mat + full half-pipe ring + single hole) is solid for shooters
  if (Math.abs(x) <= outer + 1e-4 && Math.abs(z) <= outer + 1e-4) return 0;
  return l4SupportLocalY(x, z);
}

/** World rest Y for shooters (bridges over channels/hole). */
export function l4ShooterMarbleRestY(x: number, z: number): number | null {
  const local = l4ShooterSupportLocalY(x, z);
  if (local === null) return null;
  return PLAY_SURFACE_Y + local - Math.sin(L4_TILT) * z + MARBLE_RADIUS;
}

/** True if XZ is over the recessed half-pipe trough or the scoring-hole opening. */
export function l4IsChannelOrHoleXZ(x: number, z: number): boolean {
  const hr = L4_HOLE_RADIUS;
  for (const h of l4HoleCentersLocal()) {
    if (Math.hypot(x - h.x, z - h.z) < hr) return true;
  }
  const lat = l4ChannelLateral(x, z);
  return lat !== null && Math.abs(lat) <= L4_PIPE_R + 1e-6;
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

  // Single scoring hole — south-center of the half-pipe ring
  const holeCentersLocal = l4HoleCentersLocal();
  const pipeR = L4_PIPE_R;

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

  // Solid underplate under the left desk with a tight opening only at the single south hole.
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
    const hole = holeCentersLocal[0]!;
    const gap = holeR * 2.05;
    // North of hole — full width
    {
      const z1 = hole.z - gap / 2;
      const d = z1 - leftMinZ;
      if (d > 0.02) addPlate(leftLen, d, leftCX, (leftMinZ + z1) / 2);
    }
    // South of hole — full width
    {
      const z0 = hole.z + gap / 2;
      const d = leftMaxZ - z0;
      if (d > 0.02) addPlate(leftLen, d, leftCX, (z0 + leftMaxZ) / 2);
    }
    // Mid band (hole row) — two segments left/right of the single south hole
    {
      const d = gap;
      const cz = hole.z;
      const hx = hole.x;
      addPlate(Math.max(0.02, hx - gap / 2 - leftMinX), d, (leftMinX + (hx - gap / 2)) / 2, cz);
      addPlate(Math.max(0.02, leftMaxX - (hx + gap / 2)), d, ((hx + gap / 2) + leftMaxX) / 2, cz);
    }
  }

  // Mat pedestal — top flush with desk (Y=0). Full rectangle; all four sides open into the half-pipe.
  {
    const pedH = gutterDepth;
    const pedCy = -pedH / 2;
    const inset = 0.001;
    const full = matHalf * 2 - inset * 2;
    mkBoard(full, pedH, full, 0, pedCy, 0);
    const ped = mkStatic(woodMat);
    ped.addShape(
      new CANNON.Box(new CANNON.Vec3(full / 2, pedH / 2, full / 2)),
      new CANNON.Vec3(0, pedCy, 0),
    );
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

  // ——— Continuous half-pipe ring (N/S/E/W + rounded corners) + single south hole ———
  const chMat = woodStandard(0x5a2e16, { map: grain.clone(), roughness: 0.48 });
  (chMat.map as THREE.Texture).repeat.set(1.2, 0.4);
  const lipMat = woodStandard(0x4a2410, { map: grain.clone(), roughness: 0.5 });
  const channelBody = mkStatic(woodMat);

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

  /**
   * Half-pipe cross-section: semicircle of radius pipeR, lips at local Y=0.
   * Visual = Lathe-like ribbon; physics = N box facets along the arc.
   * `alongX` → pipe runs along X (north/south). Otherwise along Z (west/east).
   * Skip a hole gap when |along-axis center| falls inside hole disk.
   */
  const SEGS = 10;
  const addHalfPipeStraight = (
    length: number,
    cx: number,
    cz: number,
    alongX: boolean,
    holeSkip?: { x: number; z: number; r: number },
  ) => {
    if (length < 0.02) return;
    // Optionally split around the scoring hole
    const spans: { len: number; cAlong: number }[] = [];
    if (holeSkip) {
      const cAlong0 = alongX ? cx : cz;
      const hAlong = alongX ? holeSkip.x : holeSkip.z;
      const hPerp = alongX ? holeSkip.z : holeSkip.x;
      const cPerp = alongX ? cz : cx;
      // Only skip if hole sits on this segment's perpendicular centerline
      if (Math.abs(hPerp - cPerp) < pipeR * 0.85) {
        const half = length / 2;
        const a0 = cAlong0 - half;
        const a1 = cAlong0 + half;
        const gap = holeSkip.r * 1.08;
        const g0 = hAlong - gap;
        const g1 = hAlong + gap;
        if (g0 > a0 + 0.01) spans.push({ len: g0 - a0, cAlong: (a0 + g0) / 2 });
        if (a1 > g1 + 0.01) spans.push({ len: a1 - g1, cAlong: (g1 + a1) / 2 });
      } else {
        spans.push({ len: length, cAlong: cAlong0 });
      }
    } else {
      spans.push({ len: length, cAlong: alongX ? cx : cz });
    }

    for (const span of spans) {
      if (span.len < 0.015) continue;
      const scx = alongX ? span.cAlong : cx;
      const scz = alongX ? cz : span.cAlong;

      // Visual half-pipe via many thin boxes (matches physics)
      for (let i = 0; i < SEGS; i++) {
        const t0 = i / SEGS;
        const t1 = (i + 1) / SEGS;
        const a0 = Math.PI * t0; // 0 = outer lip (+perp), π = inner lip (−perp)
        const a1 = Math.PI * t1;
        const amid = 0.5 * (a0 + a1);
        const arc = (a1 - a0) * pipeR;
        const thick = Math.max(0.0045, arc * 0.95);
        // Lateral from centerline: +pipeR at outer (a=0), 0 at bottom (a=π/2), −pipeR at inner (a=π)
        const lat = pipeR * Math.cos(amid);
        const y = -pipeR * Math.sin(amid);
        // Tangent angle for facet
        const ang = amid - Math.PI / 2; // rotate facet to follow circle

        const bw = alongX ? span.len : thick;
        const bd = alongX ? thick : span.len;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.0055, bd), chMat);
        if (alongX) {
          mesh.position.set(scx, y, scz + lat);
          mesh.rotation.x = ang;
        } else {
          mesh.position.set(scx + lat, y, scz);
          mesh.rotation.z = -ang;
        }
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        desk.add(mesh);

        // Physics facet
        const q = new CANNON.Quaternion();
        if (alongX) q.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), ang);
        else q.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), -ang);
        addShapeBox(
          channelBody,
          alongX ? span.len / 2 : thick / 2,
          0.0028,
          alongX ? thick / 2 : span.len / 2,
          alongX ? scx : scx + lat,
          y,
          alongX ? scz + lat : scz,
          q,
        );
      }

      // Rounded lip beads (visual + light physics) at inner & outer edges
      for (const side of [-1, 1] as const) {
        const lipR = 0.0035;
        const lat = side * pipeR;
        const bead = alongX
          ? new THREE.Mesh(new THREE.CylinderGeometry(lipR, lipR, span.len, 8), lipMat)
          : new THREE.Mesh(new THREE.CylinderGeometry(lipR, lipR, span.len, 8), lipMat);
        if (alongX) {
          bead.rotation.z = Math.PI / 2;
          bead.position.set(scx, -lipR * 0.15, scz + lat);
        } else {
          bead.rotation.x = Math.PI / 2;
          bead.position.set(scx + lat, -lipR * 0.15, scz);
        }
        bead.castShadow = true;
        desk.add(bead);
        addShapeBox(
          channelBody,
          alongX ? span.len / 2 : lipR,
          lipR,
          alongX ? lipR : span.len / 2,
          alongX ? scx : scx + lat,
          -lipR * 0.15,
          alongX ? scz + lat : scz,
        );
      }
    }
  };

  /** Rounded corner elbow: quarter-circle of half-pipe around (±matHalf, ±matHalf). */
  const addHalfPipeCorner = (signX: number, signZ: number) => {
    const cornerCx = signX * matHalf;
    const cornerCz = signZ * matHalf;
    const slices = 8;
    for (let s = 0; s < slices; s++) {
      // Angle along the plan-view quarter: from south/east etc.
      // For +X+Z (SE): from angle 0 (east, +X) to π/2 (south, +Z) in standard CCW from +X
      // General: start at angle toward the east/west straight end
      // signX>0,signZ>0 (SE): θ from 0 (+X) to π/2 (+Z)
      // signX<0,signZ>0 (SW): θ from π/2 (+Z) to π (−X)
      // signX<0,signZ<0 (NW): θ from π (−X) to 3π/2 (−Z)
      // signX>0,signZ<0 (NE): θ from −π/2 / 3π/2 (−Z) to 0 / 2π (+X)
      let theta0: number;
      if (signX > 0 && signZ > 0) theta0 = 0;
      else if (signX < 0 && signZ > 0) theta0 = Math.PI / 2;
      else if (signX < 0 && signZ < 0) theta0 = Math.PI;
      else theta0 = -Math.PI / 2;
      const t0 = theta0 + (Math.PI / 2) * (s / slices);
      const t1 = theta0 + (Math.PI / 2) * ((s + 1) / slices);
      const tmid = 0.5 * (t0 + t1);
      const arcLen = pipeR * (t1 - t0);
      // Centerline point
      const clx = cornerCx + pipeR * Math.cos(tmid);
      const clz = cornerCz + pipeR * Math.sin(tmid);
      // Radial (outward in XZ) and tangent
      const radX = Math.cos(tmid);
      const radZ = Math.sin(tmid);

      for (let i = 0; i < SEGS; i++) {
        const a0 = Math.PI * (i / SEGS);
        const a1 = Math.PI * ((i + 1) / SEGS);
        const amid = 0.5 * (a0 + a1);
        const thick = Math.max(0.0045, (a1 - a0) * pipeR * 0.95);
        const lat = pipeR * Math.cos(amid); // along radial in XZ
        const y = -pipeR * Math.sin(amid);
        const px = clx + lat * radX;
        const pz = clz + lat * radZ;

        // Facet orientation: rotate about tangent axis
        const tangX = -Math.sin(tmid);
        const tangZ = Math.cos(tmid);
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(arcLen, 0.0055, thick), chMat);
        mesh.position.set(px, y, pz);
        // Look along tangent; roll by amid
        mesh.lookAt(px + tangX, y, pz + tangZ);
        mesh.rotateX(amid - Math.PI / 2);
        mesh.receiveShadow = true;
        desk.add(mesh);

        // Physics: approximate with unrotated box at facet center (good enough for marbles)
        addShapeBox(
          channelBody,
          Math.max(arcLen, thick) / 2,
          0.0028,
          Math.min(arcLen, thick) / 2 + 0.001,
          px,
          y,
          pz,
        );
      }
    }
  };

  // Straights (centerline at matHalf + pipeR; length = 2 * matHalf between corner centers)
  const straightLen = matHalf * 2;
  const hole = holeCentersLocal[0]!;
  addHalfPipeStraight(straightLen, 0, -(matHalf + pipeR), true); // north
  addHalfPipeStraight(straightLen, 0, matHalf + pipeR, true, { x: hole.x, z: hole.z, r: holeR }); // south (gap at hole)
  addHalfPipeStraight(straightLen, -(matHalf + pipeR), 0, false); // west
  addHalfPipeStraight(straightLen, matHalf + pipeR, 0, false); // east

  // Rounded corners (no square 90° pits)
  addHalfPipeCorner(1, 1);
  addHalfPipeCorner(-1, 1);
  addHalfPipeCorner(-1, -1);
  addHalfPipeCorner(1, -1);

  // Single south hole visual + shaft (open through underplate)
  {
    const hx = hole.x;
    const hz = hole.z;
    const troughY = -pipeR;
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

    const rim = new THREE.Mesh(
      new THREE.RingGeometry(holeR * 0.98, holeR * 1.22, 28),
      new THREE.MeshStandardMaterial({ color: 0x1a0c06, roughness: 0.92, metalness: 0 }),
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(hx, troughY + 0.001, hz);
    desk.add(rim);
  }

  // Outer wood apron just outside the half-pipe ring (fills leftover square voids with mahogany)
  {
    const outer = matHalf + chW;
    const apronT = gutterDepth;
    const apronCy = -apronT / 2;
    const apronBody = mkStatic(woodMat);
    // North outer strip (between channel outer lip and left desk north edge) already framed;
    // fill SE/SW former dual-hole voids with continuous wood south of the ring except the hole gap.
    const southZ0 = outer;
    const southZ1 = leftMaxZ;
    const southD = southZ1 - southZ0;
    if (southD > 0.01) {
      mkBoard(leftLen, apronT, southD, leftCX, apronCy, (southZ0 + southZ1) / 2);
      apronBody.addShape(
        new CANNON.Box(new CANNON.Vec3(leftLen / 2, apronT / 2, southD / 2)),
        new CANNON.Vec3(leftCX, apronCy, (southZ0 + southZ1) / 2),
      );
    }
  }

  // ——— Shooter-only invisible BRIDGES over the full half-pipe ring + hole ———
  // Field marbles ignore these (collision mask); shooters roll across at desk-top height.
  {
    const bridgeBody = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      material: woodMat,
      collisionFilterGroup: L4_COL_GROUP_SHOOTER_BLOCKER,
      collisionFilterMask: L4_COL_GROUP_SHOOTER,
    });
    bridgeBody.position.set(0, PLAY_SURFACE_Y, 0);
    bridgeBody.quaternion.copy(qTilt);
    bodies.push(bridgeBody);

    const bridgeT = 0.006;
    const bridgeCy = -bridgeT / 2; // top face flush with desk top (local Y=0)
    const addBridge = (hx: number, hz: number, ox: number, oz: number) => {
      if (hx < 0.002 || hz < 0.002) return;
      bridgeBody.addShape(
        new CANNON.Box(new CANNON.Vec3(hx, bridgeT / 2, hz)),
        new CANNON.Vec3(ox, bridgeCy, oz),
      );
    };

    // Full ring coverage (N/S/E/W) — shooters pass OVER the concave channel
    addBridge(outerHalf, chW / 2, 0, -(matHalf + chW / 2)); // north
    addBridge(outerHalf, chW / 2, 0, matHalf + chW / 2); // south (incl. hole)
    addBridge(chW / 2, outerHalf, -(matHalf + chW / 2), 0); // west
    addBridge(chW / 2, outerHalf, matHalf + chW / 2, 0); // east

    // Corner caps so bridges meet cleanly at rounded corners
    const cap = chW * 0.55;
    for (const sx of [-1, 1] as const) {
      for (const sz of [-1, 1] as const) {
        addBridge(cap, cap, sx * (matHalf + chW / 2), sz * (matHalf + chW / 2));
      }
    }
  }

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
