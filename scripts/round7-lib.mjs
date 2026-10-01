// Shared harness for the Round 7 probes: real game in headless Chrome, VIRTUAL TIME fast-forward.
// performance.now is patched to a virtual clock that only advances inside __TAMA_R7__.stepFrames, which runs the
// game's real update() (physics, loop, rescue, victory...) with rendering skipped. Game code is unmodified;
// only the clock is driven by the probe. Setup helpers (placeChannel etc.) are the Round 6 debug hooks.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
export const BASE = process.env.PREVIEW_URL || 'http://127.0.0.1:4190/canicas-3d/';
export const SHOTS = '/workspace/round7-shots';
fs.mkdirSync(SHOTS, { recursive: true });
export const R_ = 0.008, MH = 0.32, CH = MH + R_ * 1.8;
export async function launch() {
  const browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage();
  await page.setViewport({ width: +(process.env.VW || 640), height: +(process.env.VH || 400) });
  page.setDefaultTimeout(300000);
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('[pageerror]', e.message); });
  await page.evaluateOnNewDocument(() => {
    const real = performance.now.bind(performance);
    window.__VT__ = { on: false, t: 0 };
    performance.now = () => (window.__VT__.on ? window.__VT__.t : real());
  });
  const api = {
    browser, page, pageErrors,
    D: (fn, ...a) => page.evaluate((f, args) => window.__TAMA_CHANNEL_DEBUG__[f](...args), fn, a),
    R: (fn, ...a) => page.evaluate((f, args) => window.__TAMA_R6__[f](...args), fn, a),
    S: (fn, ...a) => page.evaluate((f, args) => window.__TAMA_R7__[f](...args), fn, a),
  };
  api.info = (id) => api.R('info', id);
  // advance the game `sec` simulated seconds; every 0.1 s check invariants & record board changes.
  api.ff = (sec, opts = {}) => page.evaluate((sec, opts) => {
    const R6 = window.__TAMA_R6__, R7 = window.__TAMA_R7__;
    const out = { violations: [], timeline: [], steps: 0 };
    const base = window.__BASE_ENT__ ?? (window.__BASE_ENT__ = R6.census().entities);
    let last = '';
    const n = Math.round(sec * 10);
    for (let i = 0; i < n; i++) {
      R7.stepFrames(6, 1000 / 60);
      out.steps++;
      const c = R6.census();
      if (c.entities !== base) out.violations.push({ why: 'entities_changed', c });
      if (c.uniqueBodies !== c.entities) out.violations.push({ why: 'dup_body' });
      if (c.blue + c.red + c.zombies + c.inLoop !== c.active) out.violations.push({ why: 'category_sum', c });
      const b = R7.board();
      const key = JSON.stringify([b.scores, b.loopTotal, b.channel, b.zombiesMat, b.zombiesLoop, b.phase, b.turn]);
      if (key !== last) { last = key; out.timeline.push({ t: +((i + 1) / 10).toFixed(1), scores: `${b.scores.player}-${b.scores.ai}`, money: b.scoreText.money, loop: b.loopTotal, ch: b.channel, zMat: b.zombiesMat, zLoop: b.zombiesLoop, phase: b.phase, turn: b.turn }); }
      if (opts.until && eval(opts.until)) { out.stoppedAt = +((i + 1) / 10).toFixed(1); break; }
    }
    return out;
  }, sec, opts);
  api.fresh = async (url) => {
    await page.goto(url || `${BASE}?level=4&control=mouse&debugChannel=1`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__TAMA_CHANNEL_DEBUG__ && !!window.__TAMA_R6__ && !!window.__TAMA_R7__, { timeout: 60000 });
    await page.evaluate(() => { const v = window.__VT__; v.t = performance.now(); v.on = true; });
    // Real time may have moved between evaluate calls; from here on it is fully virtual.
    await api.D('drop');
    for (let k = 0; k < 40 && (await api.D('phase')) !== 'playing'; k++) await api.S('stepFrames', 30, 1000 / 60);
    await api.D('forcePlayerTurn');
    await api.S('stepFrames', 30, 1000 / 60);
    await api.page.evaluate(() => { window.__BASE_ENT__ = window.__TAMA_R6__.census().entities; });
    await api.ff(1.0);
    // quiet board; hatch zone clear
    for (let k = 0; k < 40; k++) { const c = await api.R('census'); if (c.inChannel === 0 && c.inLoop === 0) break; await api.ff(1.0); }
    // Deterministic board: pull every mat marble that sits on the lip (within 6 cm of the channel) inwards, so no
    // stray marble tips into the channel on its own during a scenario.
    const d = await api.S('dump');
    const used = d.filter((m) => m.a && Math.max(Math.abs(m.x), Math.abs(m.z)) <= 0.26).map((m) => ({ x: m.x, z: m.z }));
    const spots = [];
    for (let gx = -4; gx <= 4; gx++) for (let gz = -4; gz <= 4; gz++) spots.push({ x: gx * 0.05, z: gz * 0.05 });
    for (const m of d) {
      if (!m.a || m.lp || m.ch !== 'none' || Math.max(Math.abs(m.x), Math.abs(m.z)) <= 0.26) continue;
      const free = spots.find((s) => used.every((u) => Math.hypot(u.x - s.x, u.z - s.z) > 0.03) && Math.hypot(s.x - 0.134, s.z + 0.122) > 0.1);
      if (free) { await api.R('move', m.id, free.x, free.z); used.push(free); }
    }
    await api.R('clearZone', 0.134, -0.122, 0.09, []);
    await api.ff(0.8);
  };
  api.placeShooter = async (side, x, z, keep) => {
    await api.R('clearZone', x, z, 0.06, keep);
    const sh = await api.R('placeMat', side, x, z, keep);
    await api.R('clearZone', x, z, 0.0001, [...keep, sh.id]);
    await api.R('select', sh.id);
    return sh;
  };
  api.setupChannelShot = async ({ chSide, shooterSide, aim = 'hit', chX = 0.0 }) => {
    const ch = await api.R('placeChannel', chSide, chX, -CH);
    await api.ff(0.3);
    const i0 = await api.info(ch.id);
    const flight = 0.07;
    const tx = i0.x + i0.vx * flight;
    const sx = tx, sz = -0.25;
    await api.R('clearZone', sx, sz, 0.09, [ch.id]);
    const sh = await api.R('placeMat', shooterSide, sx, sz, [ch.id]);
    await api.R('clearZone', sx, sz, 0.002, [ch.id, sh.id]);
    await api.R('select', sh.id);
    return { ch, sh };
  };
  return api;
}
export const pick = (i) => i && { owner: i.owner, role: i.role, ch: i.ch, loop: i.loop, rescuer: i.rescuer };
