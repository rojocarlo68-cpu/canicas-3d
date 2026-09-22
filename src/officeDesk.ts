/**
 * Level 4 — lived-in L-shaped mahogany office desk.
 * Playmat on left wing with carved U-shaped wood gutters (W/N/E only; open south)
 * → two holes at SW/SE channel termini. Desk elevated on 4 black metal legs.
 * Interim scoring: field marbles into corner holes count like L1 knockouts.
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
export const L4_CHANNEL_W = MARBLE_RADIUS * 7.2; // ≥1 marble + margin; readable gutter
/** Hole radius — large enough for one marble. */
export const L4_HOLE_RADIUS = MARBLE_RADIUS * 1.65;
/** Subtle south tilt (rad) — downhill toward +Z. */
export const L4_TILT = 0.028;

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
  /** World-space hole centers (XZ) after tilt — approximate for scoring. */
  holeCenters: { x: number; z: number }[];
  holeRadius: number;
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
  // Subtle knots
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
      /* keep fallback color */
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

  // Room shell — lived-in, not tidy
  // Play physics stay at PLAY_SURFACE_Y; room floor drops so the desk reads as a real elevated table.
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

  // Diamond linoleum suggestion
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
  // Peeling paint patch near corner
  const peel = new THREE.Mesh(
    new THREE.PlaneGeometry(0.55, 0.4),
    woodStandard(0xd8d0c0, { roughness: 1 }),
  );
  peel.position.set(-2.74, 0.35, -2.4);
  peel.rotation.y = Math.PI / 2;
  root.add(peel);

  // ——— L-shaped desk: left wing (play) + right wing (clutter) ———
  // Desk top flush with play surface (physics). Legs span down to room floor.
  const deskY = PLAY_SURFACE_Y;
  const leftLen = 1.35; // X extent of left wing
  const leftDepth = 0.95; // Z
  const rightLen = 0.85; // Z extent of right wing along +X stub
  const rightWidth = 0.72;
  const deskThick = 0.05;

  // Left wing: framed top + recessed well so U-gutters are not buried inside a solid slab
  const wellHalf = L4_MAT_HALF + L4_CHANNEL_W;
  const wellDepth = Math.max(MARBLE_RADIUS * 3.0, 0.022);
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
    root.add(m);
    return m;
  };

  const leftCX = -0.15;
  const leftCZ = 0.05;
  const leftMinX = leftCX - leftLen / 2;
  const leftMaxX = leftCX + leftLen / 2;
  const leftMinZ = leftCZ - leftDepth / 2;
  const leftMaxZ = leftCZ + leftDepth / 2;
  const wMinX = -wellHalf;
  const wMaxX = wellHalf;
  const wMinZ = -wellHalf;
  const wMaxZ = wellHalf;
  const topYc = deskY - deskThick / 2;

  // North margin (-Z)
  if (wMinZ > leftMinZ + 0.01) {
    mkBoard(leftLen, deskThick, wMinZ - leftMinZ, leftCX, topYc, (leftMinZ + wMinZ) / 2);
  }
  // South margin (+Z) — open face (no gutter)
  if (leftMaxZ > wMaxZ + 0.01) {
    mkBoard(leftLen, deskThick, leftMaxZ - wMaxZ, leftCX, topYc, (wMaxZ + leftMaxZ) / 2);
  }
  // West margin (-X)
  if (wMinX > leftMinX + 0.01) {
    mkBoard(wMinX - leftMinX, deskThick, wellHalf * 2, (leftMinX + wMinX) / 2, topYc, 0);
  }
  // East margin (+X)
  if (leftMaxX > wMaxX + 0.01) {
    mkBoard(leftMaxX - wMaxX, deskThick, wellHalf * 2, (wMaxX + leftMaxX) / 2, topYc, 0);
  }

  // Recessed well floor (channel bed)
  const wellFloorMat = woodStandard(0x4a2410, { map: grain.clone(), roughness: 0.55 });
  mkBoard(wellHalf * 2, 0.018, wellHalf * 2, 0, deskY - wellDepth - 0.009, 0, wellFloorMat);

  // Mat pedestal — top flush with desk frame
  mkBoard(L4_MAT_HALF * 2, wellDepth, L4_MAT_HALF * 2, 0, deskY - wellDepth / 2, 0);

  // South flush bridge (no concave south channel); gaps at SW/SE for holes
  {
    const holeR0 = L4_HOLE_RADIUS;
    const bridgeZ = L4_MAT_HALF + L4_CHANNEL_W * 0.5;
    const bridgeW = Math.max(0.04, L4_MAT_HALF * 2 - holeR0 * 4.2);
    if (bridgeW > 0.02) {
      mkBoard(bridgeW, wellDepth, L4_CHANNEL_W, 0, deskY - wellDepth / 2, bridgeZ);
    }
  }

  // Corner / right wing
  const rightTop = new THREE.Mesh(
    new THREE.BoxGeometry(rightWidth, deskThick, rightLen),
    mahog,
  );
  rightTop.position.set(0.55, deskY - deskThick / 2, 0.28);
  rightTop.castShadow = true;
  rightTop.receiveShadow = true;
  root.add(rightTop);

  // Desk legs (4 black metal) — floor → underside; slightly proud of top so they read from orbit
  const mkLeg = (x: number, z: number) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.055, legH, 0.055), metal);
    leg.position.set(x, floorY + legH / 2, z);
    leg.castShadow = true;
    leg.receiveShadow = true;
    root.add(leg);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.014, 0.07), metal);
    foot.position.set(x, floorY + 0.007, z);
    root.add(foot);
  };
  // Corners of the L footprint (just outside the top so posts are visible past the edge)
  mkLeg(-0.78, -0.40);
  mkLeg(-0.78, 0.48);
  mkLeg(0.48, -0.32);
  mkLeg(0.88, 0.62);

  // Vertical apron / skirt under desk edge — reads as real table thickness from side angles
  const apronH = 0.07;
  const apronMat = woodStandard(0x4a2410, { map: grain.clone(), roughness: 0.6 });
  const addApron = (w: number, d: number, x: number, z: number) => {
    const a = new THREE.Mesh(new THREE.BoxGeometry(w, apronH, d), apronMat);
    a.position.set(x, deskY - deskThick - apronH / 2, z);
    a.castShadow = true;
    root.add(a);
  };
  // Left wing apron ring (thin walls under perimeter)
  addApron(leftLen, 0.03, -0.15, 0.05 - leftDepth / 2 + 0.015); // south of left
  addApron(leftLen, 0.03, -0.15, 0.05 + leftDepth / 2 - 0.015); // north of left
  addApron(0.03, leftDepth, -0.15 - leftLen / 2 + 0.015, 0.05); // west
  addApron(0.03, leftDepth * 0.55, -0.15 + leftLen / 2 - 0.015, 0.05 - leftDepth * 0.2); // east stub
  // Right wing apron
  addApron(rightWidth, 0.03, 0.55, 0.28 - rightLen / 2 + 0.015);
  addApron(rightWidth, 0.03, 0.55, 0.28 + rightLen / 2 - 0.015);
  addApron(0.03, rightLen, 0.55 + rightWidth / 2 - 0.015, 0.28);

  // Soft fill under the desk so black legs are not lost in shadow
  const underFill = new THREE.PointLight(0xffe0b0, 0.55, 2.2, 2);
  underFill.position.set(0.1, floorY + legH * 0.45, 0.1);
  root.add(underFill);
  const floorFill = new THREE.HemisphereLight(0xf0e8d8, 0x2a1810, 0.35);
  floorFill.position.set(0, deskY, 0);
  root.add(floorFill);

  // ——— Playmat + U-channels (tilted group) ———
  const play = new THREE.Group();
  play.name = 'l4Play';
  play.rotation.x = L4_TILT; // south (+Z) downhill toward holes
  play.position.set(0, deskY, 0);
  root.add(play);

  const matHalf = L4_MAT_HALF;
  const chW = L4_CHANNEL_W;
  const holeR = L4_HOLE_RADIUS;
  const outerHalf = matHalf + chW;
  const gutterDepth = Math.max(MARBLE_RADIUS * 3.0, 0.022);

  // Mat visual — perfectly flush with mahogany desk top plane (y≈0 in play group)
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
  play.add(matMesh);

  // Channel wood (same mahogany family — carved gutters, not floating rails)
  const chMat = woodStandard(0x5a2e16, { map: grain.clone(), roughness: 0.48 });
  (chMat.map as THREE.Texture).repeat.set(1.2, 0.4);
  const lipMat = woodStandard(0x4a2410, { map: grain.clone(), roughness: 0.5 });

  /** Concave gutter segment: sunken floor + inner/outer lips (U cross-section). */
  const addTrough = (
    length: number,
    width: number,
    cx: number,
    cz: number,
    alongX: boolean,
  ) => {
    const floorT = 0.007;
    const lipT = 0.01;
    const lipW = Math.min(0.006, width * 0.14);
    const innerW = Math.max(width - lipW * 2, MARBLE_RADIUS * 2.4);
    // Sunken floor
    const fw = alongX ? length : innerW;
    const fd = alongX ? innerW : length;
    const floorM = new THREE.Mesh(new THREE.BoxGeometry(fw, floorT, fd), chMat);
    floorM.position.set(cx, -gutterDepth + floorT / 2, cz);
    floorM.receiveShadow = true;
    play.add(floorM);
    // Outer + inner lips (flush with desk / mat plane)
    if (alongX) {
      // length along X; width along Z — lips on ±Z edges
      const lip = (zOff: number) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(length, lipT, lipW), lipMat);
        m.position.set(cx, -lipT / 2 + 0.0002, cz + zOff);
        m.castShadow = true;
        play.add(m);
      };
      lip(-(width / 2 - lipW / 2));
      lip(width / 2 - lipW / 2);
    } else {
      // length along Z; width along X — lips on ±X edges
      const lip = (xOff: number) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(lipW, lipT, length), lipMat);
        m.position.set(cx + xOff, -lipT / 2 + 0.0002, cz);
        m.castShadow = true;
        play.add(m);
      };
      lip(-(width / 2 - lipW / 2));
      lip(width / 2 - lipW / 2);
    }
  };

  // U topology: West + North + East only (NO south gutter). Corners overlap so path connects.
  // North (-Z)
  addTrough(matHalf * 2 + chW * 2, chW, 0, -(matHalf + chW / 2), true);
  // West / East: from north corner down to just above the hole (open terminus)
  const holeClearVis = holeR * 2.1;
  const weVisZ0 = -(matHalf + chW);
  const weVisZ1 = matHalf - holeClearVis;
  const weVisLen = weVisZ1 - weVisZ0;
  const weVisCz = (weVisZ0 + weVisZ1) / 2;
  if (weVisLen > 0.04) {
    addTrough(weVisLen, chW, -(matHalf + chW / 2), weVisCz, false);
    addTrough(weVisLen, chW, matHalf + chW / 2, weVisCz, false);
  }

  // Holes at SW / SE termini of the U (where W/E channels meet the open south)
  const holeCentersLocal = [
    { x: -(matHalf + chW / 2), z: matHalf - holeR * 0.15 },
    { x: matHalf + chW / 2, z: matHalf - holeR * 0.15 },
  ];
  for (const h of holeCentersLocal) {
    // Dark pit + short shaft so it reads as a real hole in the wood
    const pit = new THREE.Mesh(
      new THREE.CircleGeometry(holeR, 28),
      new THREE.MeshStandardMaterial({ color: 0x050302, roughness: 1, metalness: 0 }),
    );
    pit.rotation.x = -Math.PI / 2;
    pit.position.set(h.x, -gutterDepth + 0.001, h.z);
    play.add(pit);
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(holeR * 0.98, holeR * 1.05, 0.1, 20, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0x1a0c06,
        roughness: 0.9,
        side: THREE.DoubleSide,
      }),
    );
    shaft.position.set(h.x, -gutterDepth - 0.05, h.z);
    play.add(shaft);
    const rim = new THREE.Mesh(
      new THREE.RingGeometry(holeR * 0.92, holeR * 1.15, 28),
      woodStandard(0x3a1a0c, { roughness: 0.55 }),
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(h.x, -0.0005, h.z);
    play.add(rim);
  }

  // Physics: mat box (high friction) — top flush with desk / mat visual
  const matBody = new CANNON.Body({
    mass: 0,
    type: CANNON.Body.STATIC,
    material: matMat,
  });
  const qTilt = new CANNON.Quaternion();
  qTilt.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), L4_TILT);
  matBody.quaternion.copy(qTilt);
  matBody.position.set(0, deskY - 0.003, 0);
  matBody.addShape(
    new CANNON.Box(new CANNON.Vec3(matHalf, 0.003, matHalf)),
    new CANNON.Vec3(0, 0, 0),
  );
  bodies.push(matBody);

  // Channel physics (lower friction wood) — U only; leave circular gaps at SW/SE holes
  const addChanBody = (hx: number, hz: number, ox: number, oz: number, oy = -gutterDepth + 0.004) => {
    const b = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      material: woodMat,
    });
    b.quaternion.copy(qTilt);
    b.position.set(0, deskY, 0);
    b.addShape(
      new CANNON.Box(new CANNON.Vec3(hx, 0.004, hz)),
      new CANNON.Vec3(ox, oy, oz),
    );
    bodies.push(b);
  };

  // North full (includes NW/NE corner floors)
  addChanBody(outerHalf, chW / 2, 0, -(matHalf + chW / 2));

  // West / East: stop before hole so marbles fall in
  const holeClear = holeR * 2.05;
  const weZ0 = -(matHalf + chW); // north tip
  const weZ1 = matHalf - holeClear; // just north of hole
  const weHalfLen = (weZ1 - weZ0) / 2;
  const weCz = (weZ0 + weZ1) / 2;
  if (weHalfLen > 0.02) {
    addChanBody(chW / 2, weHalfLen, -(matHalf + chW / 2), weCz);
    addChanBody(chW / 2, weHalfLen, matHalf + chW / 2, weCz);
  }

  // Outer retaining lips (N/W/E only — open south)
  const lipH = 0.014;
  const addLip = (hx: number, hy: number, hz: number, ox: number, oy: number, oz: number) => {
    const b = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      material: woodMat,
    });
    b.quaternion.copy(qTilt);
    b.position.set(0, deskY, 0);
    b.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)), new CANNON.Vec3(ox, oy, oz));
    bodies.push(b);
  };
  addLip(outerHalf + 0.01, lipH, 0.006, 0, lipH * 0.2, -(outerHalf + 0.004));
  addLip(0.006, lipH, outerHalf, -(outerHalf + 0.004), lipH * 0.2, -chW * 0.15);
  addLip(0.006, lipH, outerHalf, outerHalf + 0.004, lipH * 0.2, -chW * 0.15);
  // Tiny outer cheek beside each hole (keeps marble in gutter → hole); no south mid gutter lip
  addLip(0.006, lipH, holeR * 1.1, -(outerHalf + 0.004), lipH * 0.2, matHalf - holeR);
  addLip(0.006, lipH, holeR * 1.1, outerHalf + 0.004, lipH * 0.2, matHalf - holeR);

  // Catcher floors under holes
  for (const h of holeCentersLocal) {
    const catcher = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      material: woodMat,
    });
    catcher.position.set(h.x, deskY - 0.14, h.z);
    catcher.addShape(new CANNON.Box(new CANNON.Vec3(holeR * 1.4, 0.01, holeR * 1.4)));
    bodies.push(catcher);
  }

  const holeCenters = holeCentersLocal.map((h) => ({ x: h.x, z: h.z }));

  // ——— Right wing clutter ———
  const clutter = new THREE.Group();
  clutter.position.set(0.55, deskY, 0.28);
  root.add(clutter);

  // Laptop
  const laptopBase = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.012, 0.22), plastic);
  laptopBase.position.set(0.05, 0.008, -0.12);
  laptopBase.castShadow = true;
  clutter.add(laptopBase);
  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.2, 0.008),
    new THREE.MeshStandardMaterial({ color: 0x111118, metalness: 0.4, roughness: 0.4 }),
  );
  screen.position.set(0.05, 0.11, -0.22);
  screen.rotation.x = -0.2;
  clutter.add(screen);
  const screenGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.28, 0.16),
    new THREE.MeshBasicMaterial({ color: 0x3a6ea5 }),
  );
  screenGlow.position.set(0.05, 0.11, -0.215);
  screenGlow.rotation.x = -0.2;
  clutter.add(screenGlow);

  // Black PC mouse mat + mouse
  const mouseMat = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.004, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x0d0d0f, roughness: 0.85 }),
  );
  mouseMat.position.set(0.22, 0.004, 0.08);
  clutter.add(mouseMat);
  const mouse = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.018, 0.06),
    plastic,
  );
  mouse.position.set(0.22, 0.014, 0.06);
  clutter.add(mouse);

  // 3 stacked messy books
  const bookColors = [0x2c4a6e, 0x6e3b2c, 0x3d5a3a];
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(
      new THREE.BoxGeometry(0.14 + i * 0.01, 0.022, 0.2 - i * 0.01),
      woodStandard(bookColors[i]!, { roughness: 0.8 }),
    );
    b.position.set(-0.18, 0.015 + i * 0.024, 0.18);
    b.rotation.y = (i - 1) * 0.12;
    b.castShadow = true;
    clutter.add(b);
  }

  // Smartphone (iPhone-like)
  const phone = new THREE.Mesh(
    new THREE.BoxGeometry(0.036, 0.008, 0.072),
    new THREE.MeshStandardMaterial({ color: 0x1c1c1e, metalness: 0.6, roughness: 0.3 }),
  );
  phone.position.set(0.0, 0.006, 0.22);
  phone.rotation.y = 0.4;
  clutter.add(phone);
  const phoneScreen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.03, 0.06),
    new THREE.MeshBasicMaterial({ color: 0x5ac8fa }),
  );
  phoneScreen.rotation.x = -Math.PI / 2;
  phoneScreen.position.set(0.0, 0.011, 0.22);
  phoneScreen.rotation.z = 0.4;
  clutter.add(phoneScreen);

  // Black gym shaker
  const shaker = new THREE.Mesh(
    new THREE.CylinderGeometry(0.032, 0.028, 0.14, 16),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.45, metalness: 0.15 }),
  );
  shaker.position.set(-0.28, 0.07, -0.05);
  shaker.castShadow = true;
  clutter.add(shaker);
  const shakerLid = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.025, 16),
    plastic,
  );
  shakerLid.position.set(-0.28, 0.15, -0.05);
  clutter.add(shakerLid);

  // Folded wooden chess board
  const chess = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.018, 0.18),
    woodStandard(0x8b5a2b, { roughness: 0.55 }),
  );
  chess.position.set(0.12, 0.012, 0.28);
  chess.rotation.y = -0.25;
  chess.castShadow = true;
  clutter.add(chess);
  // Checker hint
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
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      })(),
      roughness: 0.6,
    }),
  );
  chessTop.rotation.x = -Math.PI / 2;
  chessTop.position.set(0.12, 0.022, 0.28);
  chessTop.rotation.z = -0.25;
  clutter.add(chessTop);

  // Trash can under desk with some trash
  const bin = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.08, 0.28, 14),
    new THREE.MeshStandardMaterial({ color: 0x333338, roughness: 0.55, metalness: 0.4 }),
  );
  const binH = 0.28;
  bin.position.set(0.35, floorY + binH / 2, 0.55);
  bin.castShadow = true;
  root.add(bin);
  for (let i = 0; i < 4; i++) {
    const scrap = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.002, 0.05),
      woodStandard(0xe8e0d0),
    );
    scrap.position.set(
      0.35 + (i - 1.5) * 0.025,
      floorY + binH * 0.55 + i * 0.01,
      0.55 + (i % 2) * 0.02,
    );
    scrap.rotation.y = i * 0.5;
    root.add(scrap);
  }

  // Clip-on desk lamp — clamp on desk edge, warm light on playmat
  const lampGroup = new THREE.Group();
  lampGroup.position.set(-0.7, deskY, -0.42);
  root.add(lampGroup);
  const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.025, 0.08), metal);
  clamp.position.set(0, 0.01, 0);
  lampGroup.add(clamp);
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
  lampLight.target.position.set(0, 0, 0.15);
  lampLight.castShadow = true;
  lampLight.shadow.mapSize.set(512, 512);
  lampGroup.add(lampLight);
  lampGroup.add(lampLight.target);
  // Warm bulb fill
  const bulb = new THREE.PointLight(0xffb060, 0.55, 1.6, 2);
  bulb.position.set(0.02, 0.36, 0.14);
  lampGroup.add(bulb);

  // Window blinds suggestion
  const blinds = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 1.1),
    woodStandard(0x9aa0a6, { roughness: 0.85, transparent: true, opacity: 0.55 }),
  );
  blinds.position.set(0.2, 1.6, -2.74);
  root.add(blinds);

  scene.add(root);

  let currentMatId = 'avocado';
  let matTex: THREE.Texture | null = null;

  const applyTex = (t: THREE.Texture) => {
    if (matTex && matTex !== t) matTex.dispose();
    matTex = t;
    matVis.map = t;
    matVis.color.setHex(0xffffff);
    matVis.needsUpdate = true;
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

  // Default avocado
  setMatPreset('avocado');

  let t = 0;
  const update = (dt: number) => {
    t += dt;
    lampLight.intensity = 2.25 + Math.sin(t * 1.7) * 0.12;
  };

  return {
    root,
    bodies,
    woodMat,
    matMat,
    holeCenters,
    holeRadius: holeR,
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
