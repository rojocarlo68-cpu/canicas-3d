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
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console:error]', m.text());
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

console.log('GOTO', url);
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__TAMA_GAME__ && !!window.__TAMA_CHANNEL_DEBUG__, {
  timeout: 30000,
});
console.log('phase0', await page.evaluate(() => window.__TAMA_CHANNEL_DEBUG__.phase()));

await page.evaluate(() => window.__TAMA_CHANNEL_DEBUG__.drop());
{
  const tWait = Date.now();
  while (Date.now() - tWait < 45000) {
    const p = await page.evaluate(() => window.__TAMA_CHANNEL_DEBUG__.phase());
    if (p === 'playing' || p === 'ai_thinking' || p === 'shot_flying') break;
    await new Promise((r) => setTimeout(r, 250));
  }
}
console.log('phase_after_drop', await page.evaluate(() => window.__TAMA_CHANNEL_DEBUG__.phase()));

const filters = await page.evaluate(() => window.__TAMA_CHANNEL_DEBUG__.filters());
const hits = (a, b) => a && b && (a.group & b.mask) !== 0 && (b.group & a.mask) !== 0;
const live_matrix = {
  commander_commander: hits(filters.player, filters.ai),
  commander_field: hits(filters.player, filters.field),
  filters,
};
console.log('live_matrix', JSON.stringify(live_matrix));

// Tip-in test first (uses one marble)
const tip = await page.evaluate(() => window.__TAMA_CHANNEL_DEBUG__.tip('player'));
console.log('tip_place', JSON.stringify(tip));
let tipEntered = false;
let tipT = null;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 100));
  const s = await page.evaluate(() => window.__TAMA_CHANNEL_DEBUG__.sample('player'));
  if (s.physicallyInChannel || s.channelState === 'in_channel') {
    tipEntered = true;
    tipT = i * 0.1;
    console.log('tip_entered', JSON.stringify({ t: tipT, ...s }));
    break;
  }
}
console.log('tip_result', { tipEntered, tipT });

// Place closer to SW for cruise→hole→loop
const placed = await page.evaluate(() => window.__TAMA_CHANNEL_DEBUG__.place('ai'));
console.log('placed', JSON.stringify(placed));

const samples = [];
const t0 = Date.now();
let entered = false;
let nearHole = false;
let inLoop = false;
let outLoop = false;
let maxSpeed = 0;
const speeds = [];
let zombieOrConverted = false;

for (let i = 0; i < 150; i++) {
  await new Promise((r) => setTimeout(r, 200));
  const s = await page.evaluate(() => window.__TAMA_CHANNEL_DEBUG__.sample('ai'));
  const t = (Date.now() - t0) / 1000;
  samples.push({ t: +t.toFixed(2), ...s });
  if (s.speed != null) {
    maxSpeed = Math.max(maxSpeed, s.speed);
    if (s.physicallyInChannel || s.channelState === 'in_channel') speeds.push(s.speed);
  }
  if (s.physicallyInChannel || s.channelState === 'in_channel') entered = true;
  if (s.arcDistToSW != null && s.arcDistToSW < 0.1) nearHole = true;
  if (s.inLoop) inLoop = true;
  if (inLoop && !s.inLoop) outLoop = true;
  if (s.role === 'zombie' || s.role === 'healthy' && outLoop) zombieOrConverted = s.role === 'zombie' || outLoop;
  if (i % 5 === 0) {
    console.log(
      `t=${t.toFixed(1)}s state=${s.channelState} role=${s.role} loop=${s.inLoop} phys=${s.physicallyInChannel} speed=${s.speed?.toFixed?.(3)} arc=${s.arcDistToSW?.toFixed?.(3)}`,
    );
  }
  if (inLoop && outLoop) break;
  if (inLoop && t > 6) break; // saw loop
  if (nearHole && t > 12 && !inLoop) {
    // keep a bit more for loop
  }
}

const avg = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : null;
const summary = {
  tip_entered_channel: tipEntered,
  tip_time_s: tipT,
  entered_channel: entered,
  near_hole: nearHole,
  entered_loop: inLoop,
  exited_loop: outLoop,
  max_speed: +maxSpeed.toFixed(4),
  avg_speed_in_channel: avg != null ? +avg.toFixed(4) : null,
  commander_collide: live_matrix.commander_commander,
  commander_field_collide: live_matrix.commander_field,
  last: samples.at(-1),
};
console.log('SUMMARY', JSON.stringify(summary, null, 2));
const ok =
  summary.commander_collide &&
  summary.commander_field_collide &&
  summary.entered_channel &&
  summary.tip_entered_channel &&
  summary.avg_speed_in_channel != null &&
  summary.avg_speed_in_channel > 0.15 &&
  summary.avg_speed_in_channel < 0.55;
console.log(ok ? 'PROBE_OK' : 'PROBE_FAIL');
await browser.close();
process.exit(ok ? 0 : 1);
