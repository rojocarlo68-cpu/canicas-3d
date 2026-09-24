import puppeteer from 'puppeteer';

const BASE = process.env.PREVIEW_URL || 'http://127.0.0.1:4175/canicas-3d/';
const url = `${BASE}?level=4&control=mouse&debugChannel=1`;

const browser = await puppeteer.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  args: [
    '--no-sandbox',
    '--use-angle=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
  ],
});
const page = await browser.newPage();
page.setDefaultTimeout(120000);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

console.log('GOTO', url);
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__TAMA_GAME__ && !!window.__TAMA_CHANNEL_DEBUG__, {
  timeout: 45000,
});

const dbg = () => window.__TAMA_CHANNEL_DEBUG__;

await page.evaluate(() => window.__TAMA_CHANNEL_DEBUG__.drop());
{
  const t0 = Date.now();
  while (Date.now() - t0 < 45000) {
    const p = await page.evaluate(() => window.__TAMA_CHANNEL_DEBUG__.phase());
    if (p === 'playing' || p === 'ai_thinking' || p === 'shot_flying') break;
    await new Promise((r) => setTimeout(r, 250));
  }
}
console.log('phase', await page.evaluate(() => window.__TAMA_CHANNEL_DEBUG__.phase()));
console.log('start', await page.evaluate(() => window.__TAMA_CHANNEL_DEBUG__.startCounts()));
console.log('filters', await page.evaluate(() => window.__TAMA_CHANNEL_DEBUG__.filters()));

// 1) Tip into channel
const tip = await page.evaluate(() => window.__TAMA_CHANNEL_DEBUG__.tip('player'));
console.log('tip', tip);
let tipEntered = false;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 100));
  const s = await page.evaluate(() => window.__TAMA_CHANNEL_DEBUG__.sample('player'));
  if (s.physicallyInChannel || s.channelState === 'in_channel') {
    tipEntered = true;
    console.log('tip_entered', s);
    break;
  }
}
console.log('tipEntered', tipEntered);

// 2) Cruise speed + time to hole
const placed = await page.evaluate(() => window.__TAMA_CHANNEL_DEBUG__.place('ai'));
console.log('placed', placed);
const speeds = [];
let nearHole = false;
let inLoop = false;
let outLoop = false;
let role = null;
let timeToHoleMs = null;
let timeToLoopMs = null;
const tCruise = Date.now();
for (let i = 0; i < 160; i++) {
  await new Promise((r) => setTimeout(r, 200));
  const s = await page.evaluate(() => window.__TAMA_CHANNEL_DEBUG__.sample('ai'));
  if (s.speed != null && (s.physicallyInChannel || s.channelState === 'in_channel')) {
    speeds.push(s.speed);
  }
  if (s.arcDistToSW != null && s.arcDistToSW < 0.12) {
    nearHole = true;
    if (timeToHoleMs == null) timeToHoleMs = Date.now() - tCruise;
  }
  if (s.inLoop) {
    inLoop = true;
    if (timeToLoopMs == null) timeToLoopMs = Date.now() - tCruise;
  }
  if (inLoop && !s.inLoop) {
    outLoop = true;
    role = s.role;
  }
  role = s.role;
  if (i % 10 === 0) {
    console.log(
      `cruise t=${((Date.now() - tCruise) / 1000).toFixed(1)} state=${s.channelState} role=${s.role} loop=${s.inLoop} speed=${s.speed?.toFixed?.(3)} arc=${s.arcDistToSW?.toFixed?.(3)}`,
    );
  }
  if (outLoop) break;
}
const avg =
  speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : null;
const max = speeds.length ? Math.max(...speeds) : null;
console.log('cruise', {
  avg,
  max,
  n: speeds.length,
  nearHole,
  inLoop,
  outLoop,
  role,
  timeToHoleMs,
  timeToLoopMs,
});

// 3) Zombie kills
const scores0 = await page.evaluate(() => window.__TAMA_CHANNEL_DEBUG__.scores());
console.log('scores0', scores0);
const z = await page.evaluate(() => window.__TAMA_CHANNEL_DEBUG__.makeZombie('ai'));
console.log('makeZombie', z);
const killBlue = await page.evaluate(() => window.__TAMA_CHANNEL_DEBUG__.pushZombieInto('player'));
console.log('killBlue', killBlue);
const killRed = await page.evaluate(() => window.__TAMA_CHANNEL_DEBUG__.pushZombieInto('ai'));
console.log('killRed', killRed);
const kill2 = await page.evaluate(() => window.__TAMA_CHANNEL_DEBUG__.pushZombieInto('player'));
console.log('kill2', kill2);

// 4) Zombie re-loop → exit still zombie
const zHole = await page.evaluate(() => window.__TAMA_CHANNEL_DEBUG__.placeZombieInHole());
console.log('zombieHole', zHole);
let zReLoop = !!zHole.inLoop;
let zExitRole = null;
let zExitAsZombie = false;
{
  const t0 = Date.now();
  let sawLoop = zReLoop;
  while (Date.now() - t0 < 8000) {
    await new Promise((r) => setTimeout(r, 150));
    const st = await page.evaluate(() => window.__TAMA_CHANNEL_DEBUG__.sampleZombie());
    if (st?.inLoop) {
      sawLoop = true;
      zReLoop = true;
    }
    if (sawLoop && st?.found && !st.inLoop && st.role) {
      zExitRole = st.role;
      zExitAsZombie = st.role === 'zombie';
      console.log('zombie_exit', st);
      break;
    }
  }
}
console.log('zombieReLoop', zReLoop, 'exitRole', zExitRole, 'exitAsZombie', zExitAsZombie);

// 5) Select + flick non-default
{
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) {
    const p = await page.evaluate(() => window.__TAMA_CHANNEL_DEBUG__.phase());
    if (p === 'playing') break;
    await new Promise((r) => setTimeout(r, 300));
  }
}
const beforeSel = await page.evaluate(() => window.__TAMA_CHANNEL_DEBUG__.selected());
const flick = await page.evaluate(() => window.__TAMA_CHANNEL_DEBUG__.simulateSelectAndFlick());
const afterSel = await page.evaluate(() => window.__TAMA_CHANNEL_DEBUG__.selected());
console.log('selectFlick', { beforeSel, flick, afterSel });

// 6) AI pick
{
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    const p = await page.evaluate(() => window.__TAMA_CHANNEL_DEBUG__.phase());
    if (p === 'playing' || p === 'ai_thinking' || p === 'shot_flying') break;
    await new Promise((r) => setTimeout(r, 300));
  }
}
const ai = await page.evaluate(() => window.__TAMA_CHANNEL_DEBUG__.forceAITurn());
console.log('aiPick', ai);

const summary = {
  tipEntered,
  cruiseAvg: avg,
  cruiseMax: max,
  timeToHoleMs,
  timeToLoopMs,
  cruiseOk: avg != null && avg > 0.08 && avg < 0.22,
  killBlue: !!(killBlue?.ok && killBlue.after?.player === (killBlue.before?.player ?? 0) - 1),
  killRed: !!(killRed?.ok && killRed.after?.ai === (killRed.before?.ai ?? 0) - 1),
  killMulti: !!kill2?.ok,
  zombieReLoop: zReLoop,
  zombieExitAsZombie: zExitAsZombie || zExitRole === 'zombie' || (zReLoop && zHole?.inLoop),
  selectFlick: !!flick?.ok,
  aiPick: !!ai?.ok && !!ai?.selected,
};
console.log('SUMMARY', JSON.stringify(summary, null, 2));
await browser.close();
const required = [
  'tipEntered',
  'cruiseOk',
  'killBlue',
  'killRed',
  'killMulti',
  'zombieReLoop',
  'selectFlick',
  'aiPick',
];
process.exit(required.every((k) => summary[k]) ? 0 : 2);
