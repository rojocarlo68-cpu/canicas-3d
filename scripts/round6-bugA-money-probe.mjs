// Bug A (selected marble killed by zombie) + Money scoreboard probe. Headless real game.
import puppeteer from 'puppeteer';
const BASE = process.env.PREVIEW_URL || 'http://127.0.0.1:4190/canicas-3d/';
const url = `${BASE}?level=4&control=mouse&debugChannel=1`;
const browser = await puppeteer.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 700 });
page.setDefaultTimeout(120000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__TAMA_CHANNEL_DEBUG__, { timeout: 45000 });
const D = (fn, ...a) => page.evaluate((f, args) => window.__TAMA_CHANNEL_DEBUG__[f](...args), fn, a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (pred, ms = 20000, step = 150) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await pred(); if (v) return v; await sleep(step); }
  return null;
};
const out = {};
await D('drop');
await waitFor(async () => ['playing', 'ai_thinking', 'shot_flying'].includes(await D('phase')), 60000);
await D('forcePlayerTurn');
await waitFor(async () => (await D('state')).phase === 'playing', 20000);
let st = await D('state');
out.startMoney = st.scoreText.money; out.startScores = st.scoreText;
console.log('start', JSON.stringify(st.scoreText), 'phase', st.phase);
out.moneyStartOk = st.scoreText.money === '$20' && st.scoreText.player === '10';

// ---- A1: zombie kills the selected PLAYER marble during player's turn
const before = await D('state');
const z = await D('zombieOntoSelected', 'player');
const killed = await waitFor(async () => { const s = await D('state'); return s.scores.player === 9 ? s : null; }, 8000, 60);
console.log('A1 zombie', JSON.stringify(z), 'killed?', !!killed);
await sleep(600);
st = await D('state');
console.log('A1 after', JSON.stringify({ player: st.player, canPlayerShoot: st.canPlayerShoot, aiming: st.aiming, pending: st.pending, scores: st.scoreText, cam: st.camTarget, outline: st.outlineOn, phase: st.phase, turn: st.turn }));
out.A1 = {
  scoreDown: st.scores.player === 9,
  moneyDown: st.scoreText.money === '$18',
  autoSelected: !!st.player && st.player.valid && Math.hypot(st.player.x - before.player.x, st.player.z - before.player.z) > 0.004,
  canPlayerShoot: st.canPlayerShoot, notAiming: !st.aiming, phase: st.phase, turn: st.turn,
};
// camera re-aimed at new selection (wait for ease)
await sleep(1200);
st = await D('state');
const camDist = st.player ? Math.hypot(st.camTarget.x - st.player.x, st.camTarget.z - st.player.z) : 99;
out.A1.cameraOnNewSelection = camDist < 0.08; out.A1.camDist_m = +camDist.toFixed(3);

// ---- A2: real mouse: tap another own marble to select, then flick selected to shoot
let sc = await D('selectablesScreen');
const cur = sc.find((m) => m.selected);
const other = sc.filter((m) => !m.selected).sort((a, b) => Math.hypot(a.sx - cur.sx, a.sy - cur.sy) - Math.hypot(b.sx - cur.sx, b.sy - cur.sy))[0];
await page.mouse.move(other.sx, other.sy);
await page.mouse.down();
await sleep(60);
await page.mouse.up();
await sleep(500);
st = await D('state');
out.A2_tapSelectsOther = !!st.player && Math.hypot(st.player.x - other.x, st.player.z - other.z) < 0.003;
console.log('A2 tapSelect', out.A2_tapSelectsOther);
sc = await D('selectablesScreen');
const sel = sc.find((m) => m.selected);
await page.mouse.move(sel.sx, sel.sy);
await page.mouse.down();
for (let i = 1; i <= 8; i++) { await page.mouse.move(sel.sx, sel.sy - i * 14); await sleep(12); }
await page.mouse.up();
const shot = await waitFor(async () => ['shot_flying'].includes(await D('phase')), 3000, 50);
out.A2_flickShoots = !!shot;
console.log('A2 flickShoots', !!shot);
await waitFor(async () => (await D('phase')) !== 'shot_flying', 40000, 300);
await waitFor(async () => ['playing', 'ai_thinking'].includes(await D('phase')), 20000);

// ---- A3: AI marble killed while thinking → re-pick + still shoots
await waitFor(async () => ['playing', 'ai_thinking'].includes(await D('phase')), 40000);
await D('forceAITurn');
await waitFor(async () => (await D('phase')) === 'ai_thinking', 5000, 30);
const aiBefore = (await D('state')).ai;
const zr = await D('zombieOntoSelected', 'ai');
const ap = await waitFor(async () => { const s = await D('state'); return s.ai && s.ai.valid && aiBefore && Math.hypot(s.ai.x - aiBefore.x, s.ai.z - aiBefore.z) > 0.004 ? s : null; }, 6000, 50);
st = await D('state');
console.log('A3', JSON.stringify(zr), 'repicked?', !!ap, JSON.stringify({ ai: st.ai, hasAiPlan: st.hasAiPlan, phase: st.phase, turn: st.turn, scores: st.scoreText }));
out.A3 = { repicked: !!ap, hasPlanOrShot: st.hasAiPlan || st.phase === 'shot_flying' };
const aiShot = await waitFor(async () => (await D('phase')) === 'shot_flying', 8000, 80);
out.A3.aiShootsAfterRepick = !!aiShot;

// ---- B: money = healthy × 2 after more changes
await sleep(300);
st = await D('state');
out.B_moneyMatchesHealthy = st.scoreText.money === `$${st.scores.player * 2}`;
out.B_final = st.scoreText;
console.log('SUMMARY', JSON.stringify(out, null, 2));
await browser.close();
const ok = out.moneyStartOk && out.A1.scoreDown && out.A1.moneyDown && out.A1.autoSelected && out.A1.canPlayerShoot &&
  out.A1.cameraOnNewSelection && out.A2_tapSelectsOther && out.A2_flickShoots && out.A3.repicked && out.A3.aiShootsAfterRepick && out.B_moneyMatchesHealthy;
console.log('ROUND6_BUGA_MONEY', ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 2);
