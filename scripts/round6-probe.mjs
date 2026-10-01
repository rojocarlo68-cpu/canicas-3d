// Round 6 headless probe — drives the REAL game (vite preview + Chrome) through debug hooks
// (__TAMA_CHANNEL_DEBUG__ / __TAMA_R6__). Setup is deterministic (marbles placed by hook);
// all rescue/convert/zombie/camera/intervention logic under test is the real game code.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const BASE = process.env.PREVIEW_URL || 'http://127.0.0.1:4190/canicas-3d/';
const url = `${BASE}?level=4&control=mouse&debugChannel=1`;
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const SHOTS = '/workspace/round6-shots';
fs.mkdirSync(SHOTS, { recursive: true });
const browser = await puppeteer.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
const VW = +(process.env.VW || 640), VH = +(process.env.VH || 400);
await page.setViewport({ width: VW, height: VH });
// Software GL runs ~4-9 fps and the game caps dt at 0.05 s/frame → sim ≈ 0.2-0.45x real time. Scale waits.
const TS = +(process.env.TS || 2.5);
page.setDefaultTimeout(120000);
const pageErrors = [];
page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('[pageerror]', e.message); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * TS));
const D = (fn, ...a) => page.evaluate((f, args) => window.__TAMA_CHANNEL_DEBUG__[f](...args), fn, a);
const R = (fn, ...a) => page.evaluate((f, args) => window.__TAMA_R6__[f](...args), fn, a);
const waitFor = async (pred, ms = 20000, step = 100) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms * TS) { const v = await pred(); if (v) return v; await new Promise((r) => setTimeout(r, Math.max(30, step))); }
  return null;
};
const results = {};
function pick(i) { return i && { owner: i.owner, role: i.role, ch: i.ch, loop: i.loop, rescuer: i.rescuer }; }
const R_ = 0.008;
const MH = 0.32; // mat half
const CH = MH + R_ * 1.8; // channel centerline offset

async function fresh() {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__TAMA_CHANNEL_DEBUG__ && !!window.__TAMA_R6__, { timeout: 45000 });
  await D('drop');
  await waitFor(async () => ['playing', 'ai_thinking', 'shot_flying'].includes(await D('phase')), 60000);
  await D('forcePlayerTurn');
  await waitFor(async () => (await D('phase')) === 'playing', 20000);
  await sleep(300);
  // quiet board: nothing riding the channel / looping; keep the loop-exit hatch area clear
  await waitFor(async () => { const c = await R('census'); return c.inChannel === 0 && c.inLoop === 0; }, 60000, 200);
  await R('clearZone', 0.134, -0.122, 0.07, []);
  await sleep(300);
}
async function placeShooter(side, x, z, keep) {
  await R('clearZone', x, z, 0.06, keep);
  const sh = await R('placeMat', side, x, z, keep);
  await R('clearZone', x, z, 0.0001, [...keep, sh.id]);
  await R('select', sh.id);
  return sh;
}
// Invariant monitor: entity count constant, unique bodies, category sum == active.
async function startMonitor(label) {
  await page.evaluate((lab) => {
    const R6 = window.__TAMA_R6__;
    const c0 = R6.census();
    window.__MON__ = { label: lab, base: c0.entities, viol: [], samples: 0, minActive: c0.active, maxEntities: c0.entities, lastElim: c0.eliminationsCounted, timer: null };
    window.__MON__.timer = setInterval(() => {
      const c = R6.census(); const M = window.__MON__; M.samples++;
      if (c.entities !== M.base) M.viol.push({ why: 'entities_changed', c });
      if (c.uniqueBodies !== c.entities) M.viol.push({ why: 'dup_body', c });
      if (c.blue + c.red + c.zombies + c.inLoop !== c.active) M.viol.push({ why: 'category_sum', c });
      M.minActive = Math.min(M.minActive, c.active);
    }, 50);
  }, label);
}
async function stopMonitor() {
  return page.evaluate(() => { const M = window.__MON__; clearInterval(M.timer); return { samples: M.samples, base: M.base, violations: M.viol.length, first: M.viol[0] || null, minActive: M.minActive }; });
}
const info = (id) => R('info', id);
async function waitHome(id, ms = 30000) { // channel/loop finished: active, not loop, ch none
  return waitFor(async () => { const i = await info(id); return i && i.active && !i.loop && i.ch === 'none' ? i : null; }, ms, 120);
}
async function measureVel(id) {
  const a = await info(id);
  return { vx: a.vx, vz: a.vz, a, b: a };
}
// Place channel marble on the north channel, shooter on mat and aim at it (or away).
async function setupChannelShot({ chSide, shooterSide, aim = 'hit', chX = 0.0 }) {
  const ch = await R('placeChannel', chSide, chX, -CH);
  await sleep(150);
  const v = await measureVel(ch.id);
  const info0 = await info(ch.id);
  let tx = info0.x;
  const flight = 0.07;
  tx += v.vx * flight;
  const sx = tx, sz = -0.25;
  await R('clearZone', sx, sz, 0.09, [ch.id]);
  const sh = await R('placeMat', shooterSide, sx, sz, [ch.id]);
  await R('clearZone', sx, sz, 0.002, [ch.id, sh.id]);
  await R('select', sh.id);
  return { ch, sh, vel: v, tx };
}

async function runTest(name, fn) {
  if (ONLY.length && !ONLY.includes(name)) return;
  const t0 = Date.now();
  try {
    await fresh();
    await startMonitor(name);
    const out = await fn();
    const mon = await stopMonitor();
    out.invariant = mon;
    out.pass = !!out.pass && mon.violations === 0;
    out.sec = +((Date.now() - t0) / 1000).toFixed(1);
    results[name] = out;
  } catch (e) {
    results[name] = { pass: false, error: String(e && e.message || e) };
  }
  console.log(name, JSON.stringify(results[name]).slice(0, 1500));
}

// ───────── G1: own marble in channel, player hits it with another own marble
await runTest('G1_own_hit', async () => {
  const s0 = await R('census');
  const { ch, sh } = await setupChannelShot({ chSide: 'player', shooterSide: 'player' });
  await sleep(100);
  const snd0 = await R('sounds');
  const sh0 = await info(sh.id);
  await R('shoot', 0, -1, 0.45);
  // watch flashes / chime
  const watch = await watchRescue(ch.id, 9000);
  const rs = await R('rescueStats');
  const chHome = await waitHome(ch.id, 30000);
  const shHome = await waitHome(sh.id, 30000);
  const cs = await R('census');
  const snd1 = await R('sounds');
  return {
    pass: rs.contacts === 1 && rs.rescued === 1 && rs.converted === 0 && chHome && shHome && chHome.role === 'healthy' && shHome.role === 'healthy' &&
      chHome.owner === 'player' && shHome.owner === 'player' && cs.scores.player === s0.scores.player && cs.scores.ai === s0.scores.ai && snd1.triggers - snd0.triggers === 1 && watch.flashes === 3,
    contacts: rs.contacts, rescued: rs.rescued, chime: snd1.triggers - snd0.triggers, flashesSeen: watch.flashes, flashEdges: watch.edges,
    channelEnd: pick(chHome), shooterEnd: pick(shHome), scoreBefore: s0.scoreText, scoreAfter: cs.scoreText, guided: rs.guided,
  };
});
async function watchRescue(id, ms) {
  ms = ms * TS;
  // sample emissive at ~25 ms; count rising edges and on/off durations
  return page.evaluate(async (id, ms) => {
    const R6 = window.__TAMA_R6__; const t0 = performance.now(); let prev = false; let edges = []; let lastT = null; let on = []; let off = []; let started = false; let maxFlashes = 0;
    while (performance.now() - t0 < ms) {
      const i = R6.info(id); if (!i) break;
      maxFlashes = Math.max(maxFlashes, i.flashes);
      if (i.emissiveOn !== prev) { const t = performance.now(); if (lastT !== null) (prev ? on : off).push(+((t - lastT) / 1000).toFixed(2)); lastT = t; if (i.emissiveOn) edges.push(+((t - t0) / 1000).toFixed(2)); prev = i.emissiveOn; started = started || i.emissiveOn; }
      if (started && i.flashes >= 3 && !i.emissiveOn && performance.now() - (lastT||0) > 900) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    return { flashes: maxFlashes, edges: edges.length, edgeTimes: edges, onDur: on, offDur: off };
  }, id, ms);
}

// ───────── G2: own marble in channel, player misses → channel marble becomes zombie, rescuer healthy
await runTest('G2_own_miss', async () => {
  const s0 = await R('census');
  const ch = await R('placeChannel', 'player', 0.0, -CH);
  await sleep(150);
  const sh = await placeShooter('player', 0.05, 0.1, [ch.id]);
  const snd0 = await R('sounds');
  await R('shoot', 0, 1, 0.3); // away from channel (toward south, stays on mat)
  const chHome = await waitFor(async () => { const i = await info(ch.id); return i && i.active && !i.loop && i.ch === 'none' && i.role === 'zombie' ? i : null; }, 40000, 150);
  const shI = await info(sh.id);
  const cs = await R('census');
  const snd1 = await R('sounds');
  const rs = await R('rescueStats');
  return {
    pass: !!chHome && chHome.role === 'zombie' && shI.role === 'healthy' && shI.owner === 'player' && cs.scores.player === s0.scores.player - 1 && snd1.triggers === snd0.triggers && rs.contacts === 0,
    channelEnd: pick(chHome), shooterEnd: pick(shI), scoreBefore: s0.scoreText, scoreAfter: cs.scoreText, chimeTriggers: snd1.triggers - snd0.triggers, contacts: rs.contacts,
  };
});

// ───────── G3: enemy marble in channel, player hits → converted to player colour
await runTest('G3_enemy_hit', async () => {
  const s0 = await R('census');
  const { ch, sh } = await setupChannelShot({ chSide: 'ai', shooterSide: 'player' });
  const snd0 = await R('sounds');
  await R('shoot', 0, -1, 0.45);
  const watch = await watchRescue(ch.id, 9000);
  const rs = await R('rescueStats');
  const mid = await R('census');
  const chHome = await waitHome(ch.id, 30000);
  const shHome = await waitHome(sh.id, 30000);
  const cs = await R('census');
  const snd1 = await R('sounds');
  return {
    pass: rs.contacts === 1 && rs.converted === 1 && !!chHome && !!shHome && chHome.owner === 'player' && chHome.role === 'healthy' && shHome.owner === 'player' && shHome.role === 'healthy' &&
      mid.scores.player === s0.scores.player + 1 && mid.scores.ai === s0.scores.ai - 1 && cs.scores.player === s0.scores.player + 1 && cs.scores.ai === s0.scores.ai - 1 && snd1.triggers - snd0.triggers === 1 && watch.flashes === 3,
    contacts: rs.contacts, converted: rs.converted, chime: snd1.triggers - snd0.triggers, flashesSeen: watch.flashes,
    channelEnd: pick(chHome), shooterEnd: pick(shHome), scoreBefore: s0.scoreText, scoreRightAfterHit: mid.scoreText, scoreFinal: cs.scoreText,
  };
});

// ───────── G4: enemy marble in channel, player misses → enemy becomes zombie
await runTest('G4_enemy_miss', async () => {
  const s0 = await R('census');
  const ch = await R('placeChannel', 'ai', 0.0, -CH);
  await sleep(150);
  const sh = await placeShooter('player', 0.05, 0.1, [ch.id]);
  await R('shoot', 0, 1, 0.3);
  const chHome = await waitFor(async () => { const i = await info(ch.id); return i && i.active && !i.loop && i.ch === 'none' && i.role === 'zombie' ? i : null; }, 40000, 150);
  const shI = await info(sh.id);
  const cs = await R('census');
  const rs = await R('rescueStats');
  return {
    pass: !!chHome && shI.role === 'healthy' && cs.scores.ai === s0.scores.ai - 1 && cs.scores.player === s0.scores.player && rs.contacts === 0,
    channelEnd: pick(chHome), shooterEnd: pick(shI), scoreBefore: s0.scoreText, scoreAfter: cs.scoreText, contacts: rs.contacts,
  };
});

// ───────── G5: rescuer never becomes zombie even if it falls into channel / hole after missing
await runTest('G5_rescuer_never_zombie', async () => {
  const s0 = await R('census');
  // target far east on north channel; rescuer shot into the trough far from it (miss) and rides to the hole
  const ch = await R('placeChannel', 'ai', 0.28, -CH);
  await sleep(150);
  await R('clearZone', -0.2, -0.25, 0.1, [ch.id]);
  const sh = await R('placeMat', 'player', -0.2, -0.25, [ch.id]);
  await R('clearZone', -0.2, -0.25, 0.002, [ch.id, sh.id]);
  await R('select', sh.id);
  await R('shoot', 0, -1, 0.5); // falls into north trough at x=-0.2 → rides channel
  const wasRescuer = await waitFor(async () => { const i = await info(sh.id); return i && i.rescuer && i.ch === 'in_channel' ? i : null; }, 6000, 50);
  let sawLoop = false; let everZombie = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 40000) {
    const i = await info(sh.id);
    if (i.role === 'zombie') everZombie = true;
    if (i.loop) sawLoop = true;
    if (sawLoop && !i.loop && i.ch === 'none' && i.active) break;
    await sleep(80);
  }
  const shI = await info(sh.id);
  const rs = await R('rescueStats');
  const cs = await R('census');
  return {
    pass: !!wasRescuer && sawLoop && !everZombie && shI.role === 'healthy' && shI.owner === 'player' && !shI.rescuer && cs.scores.player === s0.scores.player,
    rescuerRodeChannel: !!wasRescuer, enteredLoop: sawLoop, everZombie, rescuerEnd: pick(shI), zombieGuardTriggers: rs.rescuerZombieBlocked, scoreBefore: s0.scoreText, scoreAfter: cs.scoreText,
  };
});

// ───────── G7: AI side symmetric (AI hits blue in channel → converts to red; AI hits red → rescued)
await runTest('G7_ai_symmetric', async () => {
  await D('forceAITurn');
  await R('holdAI');
  await waitFor(async () => (await D('phase')) === 'ai_thinking', 5000, 30);
  const s0 = await R('census');
  // blue marble in channel, red AI marble hits it
  const ch = await R('placeChannel', 'player', 0.0, -CH);
  await sleep(150);
  const v = await measureVel(ch.id);
  const i0 = await info(ch.id);
  const sx = i0.x + v.vx * 0.07;
  await R('clearZone', sx, -0.25, 0.09, [ch.id]);
  const rd = await R('placeMat', 'ai', sx, -0.25, [ch.id]);
  await R('clearZone', sx, -0.25, 0.002, [ch.id, rd.id]);
  await R('select', rd.id);
  const sel = await R('selectedIds');
  const snd0 = await R('sounds');
  const sh = await R('shootAI', 0, -1, 0.45);
  const watch = await watchRescue(ch.id, 9000);
  const rs = await R('rescueStats');
  const mid = await R('census');
  const chHome = await waitHome(ch.id, 30000);
  const rdHome = await waitHome(rd.id, 30000);
  const cs = await R('census');
  const snd1 = await R('sounds');
  const aiSelectedWasHitter = sel.ai === rd.id;
  return {
    pass: aiSelectedWasHitter && sh.ok && rs.converted === 1 && !!chHome && !!rdHome && chHome.owner === 'ai' && chHome.role === 'healthy' && rdHome.owner === 'ai' && rdHome.role === 'healthy' &&
      mid.scores.ai === s0.scores.ai + 1 && mid.scores.player === s0.scores.player - 1 && snd1.triggers - snd0.triggers === 1 && watch.flashes === 3,
    aiSelectedWasHitter, converted: rs.converted, chime: snd1.triggers - snd0.triggers, flashesSeen: watch.flashes,
    channelEnd: pick(chHome), hitterEnd: pick(rdHome), scoreBefore: s0.scoreText, scoreRightAfterHit: mid.scoreText, scoreFinal: cs.scoreText,
  };
});

// ───────── G8: move marbles away from zombies (own turn)
await runTest('G8a_escape_zombie_own_turn', async () => {
  const sh = await placeShooter('player', 0.0, 0.0, []);
  const z = await R('makeZombieAt', 0.034, 0.0);
  await R('move', sh.id, 0.0, 0.0);
  await sleep(300);
  const z0 = await info(z.id); const s0 = await info(sh.id);
  const d0 = Math.hypot(z0.x - s0.x, z0.z - s0.z);
  await R('shoot', -1, 0, 0.35); // away from zombie (zombie at +x)
  await sleep(1500);
  const s1 = await info(sh.id); const z1 = await info(z.id);
  const d1 = Math.hypot(z1.x - s1.x, z1.z - s1.z);
  const cs = await R('census');
  return { pass: s1.active && s1.role === 'healthy' && d1 > d0 + 0.02 && d0 > 0.03, distBefore_mm: +(d0 * 1000).toFixed(1), distAfter_mm: +(d1 * 1000).toFixed(1), marbleAlive: s1.active, scoreAfter: cs.scoreText };
});
await runTest('G8b_escape_zombie_during_AI_turn', async () => {
  await D('forceAITurn'); await R('holdAI');
  await waitFor(async () => (await D('phase')) === 'ai_thinking', 5000, 30);
  const sh = await placeShooter('player', 0.0, 0.0, []);
  const z = await R('makeZombieAt', 0.034, 0.0);
  await R('move', sh.id, 0.0, 0.0);
  await sleep(300);
  const mode = (await R('interventionInfo')).mode;
  const z0 = await info(z.id); const s0 = await info(sh.id);
  const d0 = Math.hypot(z0.x - s0.x, z0.z - s0.z);
  const r = await R('shoot', -1, 0, 0.35);
  await sleep(1500);
  const s1 = await info(sh.id); const z1 = await info(z.id);
  const d1 = Math.hypot(z1.x - s1.x, z1.z - s1.z);
  const ph = await D('phase');
  return { pass: mode === 'intervention' && r.ok && s1.active && s1.role === 'healthy' && d1 > d0 + 0.02 && ph === 'ai_thinking', mode, shotOk: r.ok, distBefore_mm: +(d0 * 1000).toFixed(1), distAfter_mm: +(d1 * 1000).toFixed(1), phaseAfter: ph };
});

// ───────── G10: several consecutive rescues → entity census constant
await runTest('G10_consecutive_rescues', async () => {
  const s0 = await R('census');
  const seq = [
    { chSide: 'player', shooterSide: 'player', chX: 0.0 },
    { chSide: 'ai', shooterSide: 'player', chX: 0.05 },
    { chSide: 'ai', shooterSide: 'player', chX: 0.1 },
    { chSide: 'player', shooterSide: 'player', chX: 0.15 },
  ];
  const ids = [];
  let hits = 0;
  for (const step of seq) {
    // wait until no channel traffic from previous rescue
    await waitFor(async () => !(await R('anyInChannel')), 40000, 150);
    await waitFor(async () => (await D('phase')) === 'playing' || (await D('phase')) === 'shot_flying', 20000);
    if ((await D('phase')) !== 'playing') { await D('forcePlayerTurn'); await sleep(200); }
    await R('resetInterventionGap');
    const { ch, sh } = await setupChannelShot(step);
    ids.push(ch.id, sh.id);
    await R('shoot', 0, -1, 0.45);
    const before = (await R('rescueStats')).contacts;
    await waitFor(async () => (await R('rescueStats')).contacts > before, 5000, 50);
    if ((await R('rescueStats')).contacts > before) hits += 1;
    await sleep(500);
  }
  await waitFor(async () => !(await R('anyInChannel')), 60000, 200);
  await waitFor(async () => (await R('census')).inLoop === 0, 30000, 200);
  await sleep(500);
  const cs = await R('census');
  const rs = await R('rescueStats');
  return {
    pass: hits === seq.length && cs.entities === s0.entities && cs.uniqueBodies === cs.entities && cs.zombies === 0 && cs.eliminationsCounted === 0 && rs.contacts === seq.length,
    hits, contacts: rs.contacts, rescued: rs.rescued, converted: rs.converted, chimes: (await R('sounds')).triggers,
    entitiesBefore: s0.entities, entitiesAfter: cs.entities, activeAfter: cs.active, zombies: cs.zombies, scoreBefore: s0.scoreText, scoreAfter: cs.scoreText,
    expectedBlue: s0.scores.player + 2, expectedRed: s0.scores.ai - 2,
  };
});

// ───────── E: intervention during AI turn (real mouse) + limits + AI turn flow intact + no white overlay
await runTest('E_intervention_real_mouse', async () => {
  await D('forceAITurn'); await R('holdAI');
  await waitFor(async () => (await D('phase')) === 'ai_thinking', 5000, 30);
  await sleep(1200); // let the camera settle
  const cam = await R('camera');
  const st0 = await D('state');
  const out = { camera: cam };
  // real mouse: tap another blue marble (select), then flick it
  async function tapSelectAndFlick(tag) {
    const sc = await D('selectablesScreen');
    const cur = sc.find((m) => m.selected);
    const cand = sc.filter((m) => !m.selected && m.sx > 30 && m.sx < 1070 && m.sy > 90 && m.sy < 650);
    if (!cand.length) return { ok: false, why: 'no_candidate_on_screen' };
    const other = cand[0];
    await page.mouse.move(other.sx, other.sy); await page.mouse.down(); await sleep(60); await page.mouse.up(); await sleep(350);
    const sc2 = await D('selectablesScreen');
    const sel = sc2.find((m) => m.selected);
    if (!sel) { const st = await D('state'); return { ok: false, why: 'nothing_selected_after_tap', state: st, tapped: other, n: sc2.length }; }
    const selOk = !!sel && Math.hypot(sel.x - other.x, sel.z - other.z) < 0.003;
    await page.mouse.move(sel.sx, sel.sy); await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(sel.sx, sel.sy - i * 14); await sleep(12); }
    await page.mouse.up();
    await sleep(400);
    return { ok: true, selOk, tag };
  }
  const a = await tapSelectAndFlick('first');
  const i1 = await R('interventionInfo');
  await sleep(1000);
  const b = await tapSelectAndFlick('second');
  const i2 = await R('interventionInfo');
  await sleep(1000);
  const c = await tapSelectAndFlick('third');
  const i3 = await R('interventionInfo');
  const st1 = await D('state');
  const camAfter = await R('camera');
  await page.screenshot({ path: `${SHOTS}/ai-turn-intervention.png` });
  // AI still shoots and the turn order continues
  await R('releaseAI');
  const aiShot = await waitFor(async () => (await D('phase')) === 'shot_flying', 8000, 50);
  const back = await waitFor(async () => (await D('state')).turn === 'player' && (await D('state')).phase === 'playing', 60000, 200);
  Object.assign(out, { first: a, second: b, third: c, shotsAfter1: i1.shots, shotsAfter2: i2.shots, shotsAfter3: i3.shots, maxShots: i1.max,
    phaseDuring: st1.phase, turnDuring: st1.turn, outlineOn: st1.outlineOn, aiShotAfterRelease: !!aiShot, turnReturnedToPlayer: !!back, camTargetToCentroid_m: +camAfter.targetToCentroid_m.toFixed(3) });
  out.thirdBlockedByLimit = (!c.ok && c.why === 'nothing_selected_after_tap') || i3.shots === 2;
  out.pass = out.thirdBlockedByLimit && a.ok && a.selOk && i1.shots === 1 && i2.shots === 2 && i3.shots === 2 && st1.phase === 'ai_thinking' && st1.turn === 'ai' && !st1.outlineOn && !!aiShot && !!back;
  return out;
});

// ───────── D: camera during AI turn frames the player's marbles
await runTest('D_camera_ai_turn', async () => {
  await D('forceAITurn'); await R('holdAI');
  await waitFor(async () => (await D('phase')) === 'ai_thinking', 5000, 30);
  await sleep(1500);
  const aiThink = await R('camera');
  await page.screenshot({ path: `${SHOTS}/camera-ai-turn-thinking.png` });
  await R('releaseAI');
  await waitFor(async () => (await D('phase')) === 'shot_flying', 8000, 50);
  await sleep(1200);
  const aiFly = await R('camera');
  await page.screenshot({ path: `${SHOTS}/camera-ai-turn-shot-flying.png` });
  const ok = (c) => c.blueInFrustum === c.blueHealthy && c.targetToCentroid_m < 0.12 && c.camDistToTarget_m > 0.45;
  return { pass: ok(aiThink) && ok(aiFly), thinking: slim(aiThink), shotFlying: slim(aiFly) };
});
function slim(c) { return slimF(c); }
function slimF(c) { return ({ target: r3(c.camTarget), centroid: r3(c.blueCentroid), targetToCentroid_m: +c.targetToCentroid_m.toFixed(3), targetToAiMarble_m: c.targetToAiMarble_m && +c.targetToAiMarble_m.toFixed(3), blueHealthy: c.blueHealthy, blueInFrustum: c.blueInFrustum, blueInSafeView: c.blueInSafeView, camDist_m: +c.camDistToTarget_m.toFixed(2) }); }
function r3(o) { return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, +v.toFixed(3)])); }

fs.writeFileSync('/workspace/round6-shots/round6-probe-results.json', JSON.stringify({ results, pageErrors }, null, 2));
await browser.close();
const names = Object.keys(results);
const failed = names.filter((n) => !results[n].pass);
console.log('ROUND6_PROBE', failed.length === 0 ? 'PASS' : `FAIL: ${failed.join(', ')}`, `(${names.length} tests, pageErrors=${pageErrors.length})`);
process.exit(failed.length ? 2 : 0);
