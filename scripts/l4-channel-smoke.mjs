/**
 * Headless L4 channel→SW hole smoke test (mirrors officeDesk + Game drain).
 * Run: node scripts/l4-channel-smoke.mjs
 */
import * as CANNON from '../node_modules/cannon-es/dist/cannon-es.js';

const MARBLE_RADIUS = 0.008;
const MARBLE_MASS = 0.0055;
const PLAY_SURFACE_Y = 0.004;
const CIRCLE_RADIUS = 0.32;
const L4_MAT_HALF = CIRCLE_RADIUS;
const L4_CHANNEL_W = MARBLE_RADIUS * 3.6;
const L4_PIPE_R = L4_CHANNEL_W / 2;
const L4_HOLE_RADIUS = MARBLE_RADIUS * 1.65;
const L4_CHANNEL_SLOPE_DEG = Number(process.env.L4_SLOPE_DEG || 0.55);
const L4_CHANNEL_TILT = (L4_CHANNEL_SLOPE_DEG * Math.PI) / 180;
const L4_CHANNEL_DRAIN_DEG = Number(process.env.L4_DRAIN_DEG || 2.0);
const L4_CHANNEL_DRAIN = (L4_CHANNEL_DRAIN_DEG * Math.PI) / 180;
const CHANNEL_FRICTION = Number(process.env.L4_CHAN_FRICTION || 0.008);
const SEGS = 16;
const LINEAR_DAMPING_DEFAULT = 0.12;
const LINEAR_DAMPING_CHANNEL = 0.035;

function l4HoleCentersLocal() {
  return [{ x: -(L4_MAT_HALF + L4_PIPE_R), z: L4_MAT_HALF + L4_PIPE_R }];
}
function l4ChannelLateral(x, z) {
  const mh = L4_MAT_HALF, R = L4_PIPE_R;
  const ax = Math.abs(x), az = Math.abs(z);
  if (ax <= mh && az <= mh) return null;
  const outer = mh + 2 * R;
  if (ax > outer + 1e-6 || az > outer + 1e-6) return null;
  if (ax <= mh) return az - (mh + R);
  if (az <= mh) return ax - (mh + R);
  const dist = Math.hypot(ax - mh, az - mh);
  if (dist > 2 * R + 1e-6) return null;
  return dist - R;
}
function l4ChannelCenterlinePerimeter() {
  return 8 * L4_MAT_HALF + 2 * Math.PI * L4_PIPE_R;
}
function l4ChannelArcLengthFromSW(x, z) {
  const mh = L4_MAT_HALF, R = L4_PIPE_R;
  const lat = l4ChannelLateral(x, z);
  if (lat === null || Math.abs(lat) > R + 1e-6) return null;
  const peri = l4ChannelCenterlinePerimeter();
  const swHalf = (Math.PI / 4) * R;
  const cornerQ = (Math.PI / 2) * R;
  const straight = 2 * mh;
  const ax = Math.abs(x), az = Math.abs(z);
  let s;
  if (ax <= mh + 1e-9 && az > mh) {
    const clx = Math.max(-mh, Math.min(mh, x));
    if (z < 0) s = swHalf + straight + cornerQ + (clx + mh);
    else s = swHalf + straight + cornerQ + straight + cornerQ + straight + cornerQ + (mh - clx);
  } else if (az <= mh + 1e-9 && ax > mh) {
    const clz = Math.max(-mh, Math.min(mh, z));
    if (x < 0) s = swHalf + (mh - clz);
    else s = swHalf + straight + cornerQ + straight + cornerQ + (clz + mh);
  } else if (ax > mh && az > mh) {
    const cx = Math.sign(x) * mh, cz = Math.sign(z) * mh;
    let th = Math.atan2(z - cz, x - cx);
    if (x > 0 && z > 0) {
      th = Math.max(0, Math.min(Math.PI / 2, th));
      s = swHalf + straight + cornerQ + straight + cornerQ + straight + th * R;
    } else if (x < 0 && z > 0) {
      th = Math.max(Math.PI / 2, Math.min(Math.PI, th));
      if (th >= (3 * Math.PI) / 4) s = (th - (3 * Math.PI) / 4) * R;
      else s = peri - ((3 * Math.PI) / 4 - th) * R;
    } else if (x < 0 && z < 0) {
      if (th < 0) th += 2 * Math.PI;
      th = Math.max(Math.PI, Math.min((3 * Math.PI) / 2, th));
      s = swHalf + straight + (th - Math.PI) * R;
    } else {
      if (th < 0) th += 2 * Math.PI;
      th = Math.max((3 * Math.PI) / 2, Math.min(2 * Math.PI, th));
      s = swHalf + straight + cornerQ + straight + (th - (3 * Math.PI) / 2) * R;
    }
  } else return null;
  return ((s % peri) + peri) % peri;
}
function l4ChannelArcDistToSW(x, z) {
  const s = l4ChannelArcLengthFromSW(x, z);
  if (s === null) return null;
  const peri = l4ChannelCenterlinePerimeter();
  return Math.min(s, peri - s);
}
function l4ChannelHeightBias(x, z) {
  const dist = l4ChannelArcDistToSW(x, z);
  if (dist === null) return 0;
  return Math.min(L4_PIPE_R * 0.55, Math.sin(L4_CHANNEL_TILT) * dist);
}
function l4ChannelDrainDirXZ(x, z) {
  const lat = l4ChannelLateral(x, z);
  if (lat === null || Math.abs(lat) > L4_PIPE_R + 1e-6) return null;
  const mh = L4_MAT_HALF, R = L4_PIPE_R;
  const ax = Math.abs(x), az = Math.abs(z);
  let clx, clz, tx, tz;
  if (ax <= mh + 1e-9 && az > mh) {
    clx = Math.max(-mh, Math.min(mh, x));
    if (z < 0) { clz = -(mh + R); tx = 1; tz = 0; }
    else { clz = mh + R; tx = -1; tz = 0; }
  } else if (az <= mh + 1e-9 && ax > mh) {
    clz = Math.max(-mh, Math.min(mh, z));
    if (x < 0) { clx = -(mh + R); tx = 0; tz = -1; }
    else { clx = mh + R; tx = 0; tz = 1; }
  } else if (ax > mh && az > mh) {
    const cx = Math.sign(x) * mh, cz = Math.sign(z) * mh;
    const th = Math.atan2(z - cz, x - cx);
    clx = cx + R * Math.cos(th); clz = cz + R * Math.sin(th);
    tx = -Math.sin(th); tz = Math.cos(th);
  } else return null;
  const peri = l4ChannelCenterlinePerimeter();
  const s0 = l4ChannelArcLengthFromSW(clx, clz);
  if (s0 === null) return null;
  const d0 = Math.min(s0, peri - s0);
  const eps = 0.012;
  const dFwd = l4ChannelArcDistToSW(clx + tx * eps, clz + tz * eps);
  const dBwd = l4ChannelArcDistToSW(clx - tx * eps, clz - tz * eps);
  let dx = tx, dz = tz;
  if (dFwd !== null && dBwd !== null) {
    if (dBwd < dFwd) { dx = -tx; dz = -tz; }
  } else if (dBwd !== null && dBwd < d0) { dx = -tx; dz = -tz; }
  const len = Math.hypot(dx, dz) || 1;
  return { x: dx / len, z: dz / len };
}

function centerlinePoint(label) {
  const mh = L4_MAT_HALF, R = L4_PIPE_R, mid = mh * 0.55;
  switch (label) {
    case 'N': return { x: 0, z: -(mh + R) };
    case 'E': return { x: mh + R, z: 0 };
    case 'S': return { x: mid, z: mh + R };
    case 'W': return { x: -(mh + R), z: -mid };
    case 'NE': return { x: mh + R * Math.SQRT1_2, z: -(mh + R * Math.SQRT1_2) };
    case 'NW': return { x: -(mh + R * Math.SQRT1_2), z: -(mh + R * Math.SQRT1_2) };
    case 'SE': return { x: mh + R * Math.SQRT1_2, z: mh + R * Math.SQRT1_2 };
    default: throw new Error(label);
  }
}

function addShapeBox(body, hx, hy, hz, ox, oy, oz, quat) {
  if (hx < 0.002 || hy < 0.001 || hz < 0.002) return;
  const shape = new CANNON.Box(new CANNON.Vec3(hx, hy, hz));
  if (quat) body.addShape(shape, new CANNON.Vec3(ox, oy, oz), quat);
  else body.addShape(shape, new CANNON.Vec3(ox, oy, oz));
}

function buildChannelWorld() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
  world.broadphase = new CANNON.NaiveBroadphase();
  world.allowSleep = false;
  const channelMat = new CANNON.Material('channelTrough');
  const marbleMat = new CANNON.Material('marble');
  const woodMat = new CANNON.Material('deskWood');
  world.addContactMaterial(new CANNON.ContactMaterial(channelMat, marbleMat, {
    friction: CHANNEL_FRICTION, restitution: 0.08,
    contactEquationStiffness: 1e7, contactEquationRelaxation: 3,
  }));
  world.addContactMaterial(new CANNON.ContactMaterial(woodMat, marbleMat, {
    friction: 0.22, restitution: 0.2,
  }));

  const matHalf = L4_MAT_HALF, pipeR = L4_PIPE_R, holeR = L4_HOLE_RADIUS;
  const hole = l4HoleCentersLocal()[0];
  const channelBody = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, material: channelMat });
  channelBody.position.set(0, PLAY_SURFACE_Y, 0);
  world.addBody(channelBody);

  const addHalfPipeStraight = (length, cx, cz, alongX, holeSkip) => {
    if (length < 0.02) return;
    const spans = [];
    if (holeSkip) {
      const cAlong0 = alongX ? cx : cz;
      const hAlong = alongX ? holeSkip.x : holeSkip.z;
      const hPerp = alongX ? holeSkip.z : holeSkip.x;
      const cPerp = alongX ? cz : cx;
      if (Math.abs(hPerp - cPerp) < pipeR * 0.85) {
        const half = length / 2;
        const a0 = cAlong0 - half, a1 = cAlong0 + half;
        const gap = holeSkip.r * 1.18;
        const g0 = hAlong - gap, g1 = hAlong + gap;
        if (g0 > a0 + 0.01) spans.push({ len: g0 - a0, cAlong: (a0 + g0) / 2 });
        if (a1 > g1 + 0.01) spans.push({ len: a1 - g1, cAlong: (g1 + a1) / 2 });
      } else spans.push({ len: length, cAlong: cAlong0 });
    } else spans.push({ len: length, cAlong: alongX ? cx : cz });

    for (const span of spans) {
      if (span.len < 0.015) continue;
      const alongSlices = Math.max(6, Math.ceil(span.len / 0.022));
      const sliceLen = span.len / alongSlices;
      const aStart = span.cAlong - span.len / 2;
      for (let si = 0; si < alongSlices; si++) {
        const alongMid = aStart + sliceLen * (si + 0.5);
        const scx = alongX ? alongMid : cx;
        const scz = alongX ? cz : alongMid;
        for (let i = 0; i < SEGS; i++) {
          const amid = Math.PI * ((i + 0.5) / SEGS);
          const thick = Math.max(0.0045, (Math.PI / SEGS) * pipeR * 0.95);
          const lat = pipeR * Math.cos(amid);
          const y = -pipeR * Math.sin(amid) + l4ChannelHeightBias(scx, scz);
          const ang = amid - Math.PI / 2;
          const q = new CANNON.Quaternion();
          if (alongX) q.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), ang);
          else q.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), -ang);
          addShapeBox(channelBody,
            alongX ? sliceLen / 2 : thick / 2, 0.0025, alongX ? thick / 2 : sliceLen / 2,
            alongX ? scx : scx + lat, y, alongX ? scz + lat : scz, q);
        }
      }
    }
  };

  const addHalfPipeCorner = (signX, signZ) => {
    if (signX < 0 && signZ > 0) return;
    const cornerCx = signX * matHalf, cornerCz = signZ * matHalf;
    const slices = 14;
    for (let s = 0; s < slices; s++) {
      let theta0;
      if (signX > 0 && signZ > 0) theta0 = 0;
      else if (signX < 0 && signZ < 0) theta0 = Math.PI;
      else theta0 = -Math.PI / 2;
      const t0 = theta0 + (Math.PI / 2) * (s / slices);
      const t1 = theta0 + (Math.PI / 2) * ((s + 1) / slices);
      const tmid = 0.5 * (t0 + t1);
      const arcLen = pipeR * (t1 - t0) * 1.08;
      const clx = cornerCx + pipeR * Math.cos(tmid);
      const clz = cornerCz + pipeR * Math.sin(tmid);
      const radX = Math.cos(tmid), radZ = Math.sin(tmid);
      const tangX = -Math.sin(tmid), tangZ = Math.cos(tmid);
      const bias = l4ChannelHeightBias(clx, clz);
      const floorY = -pipeR + bias;
      const qYaw = new CANNON.Quaternion();
      qYaw.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), Math.atan2(tangX, tangZ));
      addShapeBox(channelBody, arcLen / 2, 0.003, pipeR * 1.05, clx, floorY - 0.003, clz, qYaw);
      const railH = pipeR * 0.55, railY = floorY + railH / 2, railOff = pipeR * 1.05;
      addShapeBox(channelBody, arcLen / 2, railH / 2, 0.0022, clx + radX * railOff, railY, clz + radZ * railOff, qYaw);
      addShapeBox(channelBody, arcLen / 2, railH / 2, 0.0022, clx - radX * railOff, railY, clz - radZ * railOff, qYaw);
    }
  };

  const straightLen = matHalf * 2;
  const holeClear = holeR * 1.25 + pipeR * 0.45;
  addHalfPipeStraight(straightLen, 0, -(matHalf + pipeR), true);
  {
    const sLen = Math.max(0.04, straightLen - holeClear);
    addHalfPipeStraight(sLen, holeClear / 2, matHalf + pipeR, true, { x: hole.x, z: hole.z, r: holeR });
  }
  {
    const wLen = Math.max(0.04, straightLen - holeClear);
    addHalfPipeStraight(wLen, -(matHalf + pipeR), -holeClear / 2, false, { x: hole.x, z: hole.z, r: holeR });
  }
  addHalfPipeStraight(straightLen, matHalf + pipeR, 0, false);
  addHalfPipeCorner(1, 1); addHalfPipeCorner(-1, -1); addHalfPipeCorner(1, -1);

  // Mat pedestal
  {
    const ped = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, material: woodMat });
    ped.position.set(0, PLAY_SURFACE_Y, 0);
    ped.addShape(new CANNON.Box(new CANNON.Vec3(matHalf - 0.001, pipeR / 2, matHalf - 0.001)),
      new CANNON.Vec3(0, -pipeR / 2, 0));
    world.addBody(ped);
  }
  // Underplate with SW gap
  {
    const plate = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, material: woodMat });
    plate.position.set(0, PLAY_SURFACE_Y, 0);
    const plateH = 0.045, plateCy = -pipeR - plateH / 2 - 0.003;
    const leftMinX = -0.825, leftMaxX = 0.525, leftMinZ = -0.425, leftMaxZ = 0.525;
    const leftCX = -0.15, leftLen = 1.35, gap = holeR * 2.25;
    const addPlate = (w, d, cx, cz) => {
      if (w < 0.015 || d < 0.015) return;
      plate.addShape(new CANNON.Box(new CANNON.Vec3(w / 2, plateH / 2, d / 2)),
        new CANNON.Vec3(cx, plateCy, cz));
    };
    const z1 = hole.z - gap / 2;
    if (z1 - leftMinZ > 0.02) addPlate(leftLen, z1 - leftMinZ, leftCX, (leftMinZ + z1) / 2);
    const z0 = hole.z + gap / 2;
    if (leftMaxZ - z0 > 0.02) addPlate(leftLen, leftMaxZ - z0, leftCX, (z0 + leftMaxZ) / 2);
    addPlate(Math.max(0.02, hole.x - gap / 2 - leftMinX), gap, (leftMinX + (hole.x - gap / 2)) / 2, hole.z);
    addPlate(Math.max(0.02, leftMaxX - (hole.x + gap / 2)), gap, ((hole.x + gap / 2) + leftMaxX) / 2, hole.z);
    world.addBody(plate);
  }
  // Room floor
  {
    const floorBody = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, material: woodMat });
    floorBody.addShape(new CANNON.Box(new CANNON.Vec3(4, 0.04, 4)));
    floorBody.position.set(0, -0.74 - 0.04, 0);
    world.addBody(floorBody);
  }
  return { world, marbleMat, hole };
}


function l4ChannelCenterlinePoint(x, z) {
  const lat = l4ChannelLateral(x, z);
  if (lat === null || Math.abs(lat) > L4_PIPE_R + 1e-6) return null;
  const mh = L4_MAT_HALF, R = L4_PIPE_R;
  const ax = Math.abs(x), az = Math.abs(z);
  if (ax <= mh + 1e-9 && az > mh) return { x: Math.max(-mh, Math.min(mh, x)), z: Math.sign(z) * (mh + R) };
  if (az <= mh + 1e-9 && ax > mh) return { x: Math.sign(x) * (mh + R), z: Math.max(-mh, Math.min(mh, z)) };
  if (ax > mh && az > mh) {
    const cx = Math.sign(x) * mh, cz = Math.sign(z) * mh;
    const th = Math.atan2(z - cz, x - cx);
    return { x: cx + R * Math.cos(th), z: cz + R * Math.sin(th) };
  }
  return null;
}
function l4ChannelPointAtArcLength(s) {
  const mh = L4_MAT_HALF, R = L4_PIPE_R;
  const peri = l4ChannelCenterlinePerimeter();
  let u = ((s % peri) + peri) % peri;
  const swHalf = (Math.PI / 4) * R;
  const cornerQ = (Math.PI / 2) * R;
  const straight = 2 * mh;
  if (u <= swHalf) {
    const th = (3 * Math.PI) / 4 + u / R;
    return { x: -mh + R * Math.cos(th), z: mh + R * Math.sin(th) };
  }
  u -= swHalf;
  if (u <= straight) return { x: -(mh + R), z: mh - u };
  u -= straight;
  if (u <= cornerQ) {
    const th = Math.PI + u / R;
    return { x: -mh + R * Math.cos(th), z: -mh + R * Math.sin(th) };
  }
  u -= cornerQ;
  if (u <= straight) return { x: -mh + u, z: -(mh + R) };
  u -= straight;
  if (u <= cornerQ) {
    const th = (3 * Math.PI) / 2 + u / R;
    return { x: mh + R * Math.cos(th), z: -mh + R * Math.sin(th) };
  }
  u -= cornerQ;
  if (u <= straight) return { x: mh + R, z: -mh + u };
  u -= straight;
  if (u <= cornerQ) {
    const th = u / R;
    return { x: mh + R * Math.cos(th), z: mh + R * Math.sin(th) };
  }
  u -= cornerQ;
  if (u <= straight) return { x: mh - u, z: mh + R };
  u -= straight;
  const th = Math.PI / 2 + u / R;
  return { x: -mh + R * Math.cos(th), z: mh + R * Math.sin(th) };
}
function l4ChannelStepTowardSW(x, z, ds) {
  const cl = l4ChannelCenterlinePoint(x, z);
  if (!cl) return null;
  const peri = l4ChannelCenterlinePerimeter();
  let s = l4ChannelArcLengthFromSW(cl.x, cl.z);
  if (s === null) return null;
  const dist = Math.min(s, peri - s);
  if (dist < 1e-4) return cl;
  const step = Math.min(ds, dist);
  if (s <= peri - s) s = Math.max(0, s - step);
  else s = Math.min(peri, s + step);
  return l4ChannelPointAtArcLength(s);
}
function applyDrain(body) {
  const x = body.position.x, z = body.position.z;
  const lat = l4ChannelLateral(x, z);
  if (lat === null || Math.abs(lat) > L4_PIPE_R * 0.98) {
    body.linearDamping = LINEAR_DAMPING_DEFAULT;
    return;
  }
  const localY = body.position.y - PLAY_SURFACE_Y;
  if (localY > -L4_PIPE_R * 0.18 + MARBLE_RADIUS) return;
  body.linearDamping = 0.02;
  const hole = l4HoleCentersLocal()[0];
  const holeR = L4_HOLE_RADIUS;
  if (Math.hypot(x - hole.x, z - hole.z) < holeR * 1.05) {
    body.velocity.y = Math.min(body.velocity.y, -0.35);
    return;
  }
  const dt = 1 / 120;
  const speed = 0.16;
  const next = l4ChannelStepTowardSW(x, z, speed * dt);
  if (!next) return;
  const bias = l4ChannelHeightBias(next.x, next.z);
  body.position.x = next.x;
  body.position.z = next.z;
  body.position.y = PLAY_SURFACE_Y - L4_PIPE_R + bias + MARBLE_RADIUS;
  const dir = l4ChannelDrainDirXZ(next.x, next.z);
  if (dir) {
    body.velocity.x = dir.x * speed;
    body.velocity.z = dir.z * speed;
    body.velocity.y = Math.min(0, body.velocity.y);
  }
  body.previousPosition.copy(body.position);
}

function runOne(label, maxSec = 18) {
  const { world, marbleMat, hole } = buildChannelWorld();
  const pt = centerlinePoint(label);
  const body = new CANNON.Body({
    mass: MARBLE_MASS, material: marbleMat,
    linearDamping: LINEAR_DAMPING_DEFAULT, angularDamping: 0.18,
    shape: new CANNON.Sphere(MARBLE_RADIUS),
  });
  const y = PLAY_SURFACE_Y - L4_PIPE_R + l4ChannelHeightBias(pt.x, pt.z) + MARBLE_RADIUS + 0.0008;
  body.position.set(pt.x, y, pt.z);
  world.addBody(body);

  const dt = 1 / 120;
  const steps = Math.floor(maxSec / dt);
  const holeR = L4_HOLE_RADIUS;
  let passed = false, reason = 'timeout';
  let bestDist = Infinity, lastImprove = 0;
  for (let i = 0; i < steps; i++) {
    body.force.set(0, 0, 0);
    applyDrain(body);
    world.step(dt);
    const x = body.position.x, yb = body.position.y, z = body.position.z;
    const dHole = Math.hypot(x - hole.x, z - hole.z);
    if (dHole < bestDist - 0.002) { bestDist = dHole; lastImprove = i; }
    // Must reach SW hole region — falling elsewhere (facet cracks / off-desk) is FAIL
    if (dHole < holeR * 1.35 && yb < PLAY_SURFACE_Y - L4_PIPE_R * 0.25) {
      passed = true; reason = `SW-hole y=${yb.toFixed(3)} t=${(i * dt).toFixed(2)}s d=${dHole.toFixed(3)}`; break;
    }
    if (dHole < holeR * 2.0 && yb < PLAY_SURFACE_Y - L4_PIPE_R - MARBLE_RADIUS * 2.2) {
      passed = true; reason = `fell-near-SW y=${yb.toFixed(3)} t=${(i * dt).toFixed(2)}s d=${dHole.toFixed(3)}`; break;
    }
    // Stall only if no progress for 5s after first 2s
    if (i > 240 && i - lastImprove > 600 && body.velocity.length() < 0.01 && dHole > holeR * 1.4) {
      reason = `stalled d=${dHole.toFixed(3)} pos=(${x.toFixed(3)},${z.toFixed(3)}) v=${body.velocity.length().toFixed(4)}`;
      break;
    }
  }
  return { label, pass: passed, reason, arcDist: l4ChannelArcDistToSW(pt.x, pt.z), heightBias: l4ChannelHeightBias(pt.x, pt.z) };
}

const positions = ['N', 'E', 'S', 'W', 'NE', 'NW', 'SE'];
console.log(`L4 smoke slope=${L4_CHANNEL_SLOPE_DEG}° drain=${L4_CHANNEL_DRAIN_DEG}° friction=${CHANNEL_FRICTION}`);
const results = [];
for (const label of positions) {
  const r = runOne(label);
  results.push(r);
  console.log(`${r.pass ? 'PASS' : 'FAIL'} ${label.padEnd(2)} arc=${(r.arcDist ?? -1).toFixed(3)} → ${r.reason}`);
}
const req = ['N', 'E', 'S', 'W'];
const reqPass = req.filter((l) => results.find((r) => r.label === l)?.pass);
console.log(`--- required ${reqPass.length}/4; all ${results.filter((r) => r.pass).length}/${results.length} ---`);
process.exitCode = reqPass.length >= 4 ? 0 : 1;
