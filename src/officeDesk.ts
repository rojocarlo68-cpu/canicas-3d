/**
 * Level 4 — lived-in L-shaped mahogany office desk.
 *
 * CRITICAL layout:
 * - ONE tilted desk assembly (mat + wood + channels + props + legs share L4_TILT).
 * - Mat is coplanar with desk top (full rectangle visible; never independently tilted).
 * - Concave U channels W/N/E only; NO south gutter; NO raised lip between mat and channel.
 * - Real through-holes at BOTH SW and SE channel termini.
 * - Soft south tilt so off-mat wood/channel drift toward holes.
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
/** Soft south tilt (rad) — downhill toward +Z (~2.3°). */
export const L4_TILT = 0.04;

/** Approx desk footprint in untilted XZ (for off-desk elimination). */
export const L4_DESK_BOUNDS = {
  minX: -0.88,
  maxX: 0.98,
  minZ: -0.50,
  maxZ: 0.78,
};

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

  // ——— ONE tilted desk assembly (visual + physics share L4_TILT) ———
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
  const gutterDepth = Math.max(MARBLE_RADIUS * 3.2, 0.026);
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

  // South margin (+Z) with gaps at SW/SE holes
  if (leftMaxZ > wMaxZ + 0.01) {
    const d = leftMaxZ - wMaxZ;
    const cz = (wMaxZ + leftMaxZ) / 2;
    const holeGap = holeR * 2.2;
    const swX = holeCentersLocal[0]!.x;
    const seX = holeCentersLocal[1]!.x;
    const segs: [number, number][] = [
      [leftMinX, swX - holeGap / 2],
      [swX + holeGap / 2, seX - holeGap / 2],
      [seX + holeGap / 2, leftMaxX],
    ];
    for (const [a, b] of segs) {
      const w = b - a;
      if (w > 0.02) {
        mkBoard(w, deskThick, d, (a + b) / 2, topYc, cz);
        addFrameBox(w / 2, deskThick / 2, d / 2, (a + b) / 2, topYc, cz);
      }
    }
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

  // Mat pedestal — top flush with desk (Y=0). Edge meets channel: NO raised wall.
  mkBoard(matHalf * 2 - 0.004, gutterDepth, matHalf * 2 - 0.004, 0, -gutterDepth / 2, 0);
  {
    const ped = mkStatic(woodMat);
    ped.addShape(
      new CANNON.Box(new CANNON.Vec3(matHalf - 0.002, gutterDepth / 2, matHalf - 0.002)),
      new CANNON.Vec3(0, -gutterDepth / 2, 0),
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

  // ——— Concave U channels (W/N/E) + L-corner fills + holes flush with trough ———
  const chMat = woodStandard(0x5a2e16, { map: grain.clone(), roughness: 0.48 });
  (chMat.map as THREE.Texture).repeat.set(1.2, 0.4);
  const lipMat = woodStandard(0x4a2410, { map: grain.clone(), roughness: 0.5 });
  const bankMat = woodStandard(0x522814, { map: grain.clone(), roughness: 0.5 });
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

  /** Concave U segment. alongX=true → runs along X (north gutter). outerSign: lip on +/− side. */
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
    // Physics floor top = troughY + floorT (matches visual)
    addShapeBox(channelBody, fw / 2, floorT / 2, fd / 2, cx, floorCy, cz);

    // Visual concave banks (NO physics — avoid raised shelf that floats marbles)
    for (const side of [-1, 1] as const) {
      const isOuter = side === outerSign;
      const bankDepth = bankW * 1.05;
      const bankThick = 0.01;
      const bank = alongX
        ? new THREE.Mesh(new THREE.BoxGeometry(length, bankThick, bankDepth), isOuter ? lipMat : bankMat)
        : new THREE.Mesh(new THREE.BoxGeometry(bankDepth, bankThick, length), isOuter ? lipMat : bankMat);
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

    // Physics: thin vertical side walls at channel edges (true trough, no shelf)
    {
      const wallH = gutterDepth * 0.92;
      const wallT = 0.005;
      const wallCy = troughY + wallH / 2;
      for (const side of [-1, 1] as const) {
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

  // South flush bridge between holes (NO south gutter)
  {
    const bridgeZ = matHalf + chW / 2;
    const gap = holeR * 2.2;
    const bridgeW = Math.max(0.04, matHalf * 2 - gap * 2);
    if (bridgeW > 0.02) {
      mkBoard(bridgeW, gutterDepth, chW, 0, -gutterDepth / 2, bridgeZ);
      const br = mkStatic(woodMat);
      br.addShape(
        new CANNON.Box(new CANNON.Vec3(bridgeW / 2, gutterDepth / 2, chW / 2)),
        new CANNON.Vec3(0, -gutterDepth / 2, bridgeZ),
      );
    }
  }

  // Fill L-shaped corner voids + place through-holes flush with trough floor
  const fillCorner = (hx: number, hz: number) => {
    const side = Math.sign(hx) || 1;
    const cornerBody = mkStatic(woodMat);

    // Full corner rectangle of the play well (mat edge → outer channel edge)
    const xMat = side * matHalf;
    const xOut = side * outerHalf;
    const zMat = matHalf;
    const zOut = outerHalf;
    const xLo = Math.min(xMat, xOut);
    const xHi = Math.max(xMat, xOut);

    // Channel approach corridor kept recessed (not filled to desk top)
    const corridorW = chW * 0.9;
    const corridorHalf = corridorW / 2;

    // 1) Trough floor across the whole corner except the hole disk
    {
      const apronT = floorT;
      const apronCy = troughY + apronT / 2;
      // Cover corner with a few slabs avoiding the hole (north / south / west / east of hole)
      const slabs: [number, number, number, number][] = [
        // north of hole
        [xLo, xHi, zMat, hz - holeR * 1.02],
        // south of hole
        [xLo, xHi, hz + holeR * 1.02, zOut],
        // west of hole (between north/south bands already cover; fill mid flanks)
        [xLo, hx - holeR * 1.02, hz - holeR * 1.02, hz + holeR * 1.02],
        // east of hole
        [hx + holeR * 1.02, xHi, hz - holeR * 1.02, hz + holeR * 1.02],
      ];
      for (const [xa, xb, za, zb] of slabs) {
        const w = xb - xa;
        const d = zb - za;
        if (w < 0.004 || d < 0.004) continue;
        const cx = (xa + xb) / 2;
        const cz = (za + zb) / 2;
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, apronT, d), chMat);
        m.position.set(cx, apronCy, cz);
        m.receiveShadow = true;
        desk.add(m);
        addShapeBox(channelBody, w / 2, apronT / 2, d / 2, cx, apronCy, cz);
      }
    }

    // 2) Desk-top wood fill for the whole corner EXCEPT hole + channel corridor
    //    This is what kills the L-shaped floor peek-through.
    {
      const fillH = gutterDepth;
      const fillCy = -fillH / 2; // top at Y=0
      // Split corner into grid cells; skip corridor cells and hole cells
      const xs = [xLo, hx - corridorHalf, hx - holeR * 1.05, hx + holeR * 1.05, hx + corridorHalf, xHi].sort(
        (a, b) => a - b,
      );
      const zs = [zMat, hz - holeR * 1.05, hz + holeR * 1.05, zOut].sort((a, b) => a - b);
      // Unique
      const uniq = (arr: number[]) => {
        const o: number[] = [];
        for (const v of arr) {
          if (!o.length || Math.abs(o[o.length - 1]! - v) > 0.002) o.push(v);
        }
        return o;
      };
      const X = uniq(xs);
      const Z = uniq(zs);
      for (let i = 0; i < X.length - 1; i++) {
        for (let j = 0; j < Z.length - 1; j++) {
          const xa = X[i]!;
          const xb = X[i + 1]!;
          const za = Z[j]!;
          const zb = Z[j + 1]!;
          const cx = (xa + xb) / 2;
          const cz = (za + zb) / 2;
          const w = xb - xa;
          const d = zb - za;
          if (w < 0.003 || d < 0.003) continue;
          // Skip cells whose center is inside the hole
          if (Math.hypot(cx - hx, cz - hz) < holeR * 1.05) continue;
          // Skip channel corridor (recessed path into hole) north of hole center
          if (Math.abs(cx - hx) < corridorHalf && cz < hz + holeR * 0.2 && cz > zMat - 0.01) {
            // leave recessed — trough apron already provides floor
            continue;
          }
          mkBoard(w, fillH, d, cx, fillCy, cz);
          addShapeBox(cornerBody, w / 2, fillH / 2, d / 2, cx, fillCy, cz);
        }
      }
    }

    // 3) Outer desk apron south of the well (continuous wood; notch only at hole)
    {
      const z0 = outerHalf;
      const z1 = leftMaxZ;
      const d = z1 - z0;
      if (d > 0.015) {
        const cz = (z0 + z1) / 2;
        const topH = deskThick;
        const topCy = -topH / 2;
        const holeGap = holeR * 2.2;
        if (side < 0) {
          const a = leftMinX;
          const b = hx - holeGap / 2;
          const w = b - a;
          if (w > 0.02) {
            mkBoard(w, topH, d, (a + b) / 2, topCy, cz);
            addShapeBox(cornerBody, w / 2, topH / 2, d / 2, (a + b) / 2, topCy, cz);
          }
          const a2 = hx + holeGap / 2;
          const b2 = 0;
          const w2 = b2 - a2;
          if (w2 > 0.02) {
            mkBoard(w2, topH, d, (a2 + b2) / 2, topCy, cz);
            addShapeBox(cornerBody, w2 / 2, topH / 2, d / 2, (a2 + b2) / 2, topCy, cz);
          }
        } else {
          const a = 0;
          const b = hx - holeGap / 2;
          const w = b - a;
          if (w > 0.02) {
            mkBoard(w, topH, d, (a + b) / 2, topCy, cz);
            addShapeBox(cornerBody, w / 2, topH / 2, d / 2, (a + b) / 2, topCy, cz);
          }
          const a2 = hx + holeGap / 2;
          const b2 = leftMaxX;
          const w2 = b2 - a2;
          if (w2 > 0.02) {
            mkBoard(w2, topH, d, (a2 + b2) / 2, topCy, cz);
            addShapeBox(cornerBody, w2 / 2, topH / 2, d / 2, (a2 + b2) / 2, topCy, cz);
          }
        }
      }
    }

    // 4) Through-hole visual — rim FLUSH with trough floor (not desk top)
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
    // Rim sits on trough floor — marble rolls over it into the hole
    rim.position.set(hx, troughY + floorT + 0.0002, hz);
    desk.add(rim);

    // Outer cheek keeps marble in channel → hole
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

  // Lamp
  const lampGroup = new THREE.Group();
  lampGroup.position.set(-0.7, 0, -0.42);
  desk.add(lampGroup);
  const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.025, 0.08), metal);
  clamp.position.set(0, 0.01, 0);
  lampGroup.add(clamp);
  // Lamp base collider in desk space:
  propBody.addShape(
    new CANNON.Box(new CANNON.Vec3(0.04, 0.04, 0.04)),
    new CANNON.Vec3(-0.7, 0.04, -0.42),
  );
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.38, 8), metal);
  arm.position.set(0, 0.22, 0.05);
  arm.rotation.x = 0.55;
  lampGroup.add(arm);
  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.09, 0.08, 16, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0x2a2a28,
      side: THREE.DoubleSide,
      roughness: 0.6,
    }),
  );
  shade.position.set(0.02, 0.38, 0.14);
  shade.rotation.x = 0.9;
  lampGroup.add(shade);

  const lampLight = new THREE.SpotLight(0xffc878, 2.4, 2.8, Math.PI / 5, 0.45, 1.2);
  lampLight.position.set(0.02, 0.4, 0.12);
  lampLight.target.position.set(0.7, 0, 0.55);
  lampLight.castShadow = true;
  lampLight.shadow.mapSize.set(512, 512);
  lampGroup.add(lampLight);
  lampGroup.add(lampLight.target);
  const bulb = new THREE.PointLight(0xffb060, 0.55, 1.6, 2);
  bulb.position.set(0.02, 0.36, 0.14);
  lampGroup.add(bulb);

  // Blinds (room)
  const blinds = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 1.1),
    woodStandard(0x9aa0a6, { roughness: 0.85, transparent: true, opacity: 0.55 }),
  );
  blinds.position.set(0.2, 1.6, -2.74);
  root.add(blinds);

  scene.add(root);

  // Hole centers ≈ world XZ (small tilt; score with radius slack)
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
    lampLight.intensity = 2.25 + Math.sin(tSec * 1.7) * 0.12;
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
