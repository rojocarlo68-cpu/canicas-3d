// Zombie-zombie collision probe: spawn several zombies at exit / hole / loop / channel and
// verify pairwise XZ+Y 3D distance >= 2R - eps for every non-loop active pair over time.
import puppeteer from 'puppeteer';
const BASE = process.env.PREVIEW_URL || 'http://127.0.0.1:4190/canicas-3d/';
const url = `${BASE}?level=4&control=mouse&debugChannel=1`;
const R = 0.008;
const EPS = Number(process.env.EPS || 0.0012); // 1.2 mm tolerance (soft contacts)
const GRACE = Number(process.env.GRACE || 900); // ms: debug spawns are deliberately overlapped; physics must separate them within this
const browser = await puppeteer.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
page.setDefaultTimeout(120000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__TAMA_CHANNEL_DEBUG__, { timeout: 45000 });
const D = (fn, ...a) => page.evaluate((f, args) => window.__TAMA_CHANNEL_DEBUG__[f](...args), fn, a);
await D('drop');
for (let i = 0; i < 200; i++) {
  const p = await D('phase');
  if (['playing', 'ai_thinking', 'shot_flying'].includes(p)) break;
  await new Promise((r) => setTimeout(r, 250));
}
async function minDist() {
  const s = await D('snapshot');
  let min = Infinity, pair = null, zz = Infinity;
  for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) {
    const a = s[i], b = s[j];
    if (a.loop || b.loop) continue;
    const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    if (d < min) { min = d; pair = [a, b]; }
    if (a.role === 'zombie' && b.role === 'zombie' && d < zz) zz = d;
  }
  return { min, zz, pair, n: s.length };
}
const results = {};
for (const mode of ['exit', 'hole', 'loop', 'channel']) {
  // restart level for isolation
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__TAMA_CHANNEL_DEBUG__, { timeout: 45000 });
  await D('drop');
  for (let i = 0; i < 200; i++) {
    const p = await D('phase');
    if (['playing', 'ai_thinking', 'shot_flying'].includes(p)) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const sp = await D('spawnZombies', 4, mode);
  let worst = Infinity, worstZZ = Infinity, worstPair = null, samples = 0, worstT = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < Number(process.env.DUR || 14000)) {
    const m = await minDist();
    samples++;
    if (Date.now() - t0 >= GRACE && m.min < worst) { worst = m.min; worstPair = m.pair; worstT = Date.now() - t0; }
    if (Date.now() - t0 >= GRACE && m.zz < worstZZ) worstZZ = m.zz;
    await new Promise((r) => setTimeout(r, 60));
  }
  const pass = worst >= 2 * R - EPS;
  results[mode] = { spawn: sp, samples, minPairDist_mm: +(worst * 1000).toFixed(2), minZombiePair_mm: +(worstZZ * 1000).toFixed(2), needed_mm: +((2 * R - EPS) * 1000).toFixed(2), tAtMin_ms: worstT, pass };
  console.log(mode, JSON.stringify(results[mode]), worstPair ? JSON.stringify(worstPair) : '');
}
await browser.close();
const ok = Object.values(results).every((r) => r.pass);
console.log('ZOMBIE_COLLISION', ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 2);
