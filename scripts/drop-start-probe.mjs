import puppeteer from 'puppeteer';

const BASE = process.env.PREVIEW_URL || 'http://127.0.0.1:4175/canicas-3d/';
const RUNS = Number(process.env.DROP_RUNS || 5);

const browser = await puppeteer.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
page.setDefaultTimeout(120000);

async function waitPlaying() {
  const t0 = Date.now();
  while (Date.now() - t0 < 45000) {
    const p = await page.evaluate(() => window.__TAMA_CHANNEL_DEBUG__?.phase?.());
    if (p === 'playing' || p === 'ai_thinking') return p;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('timeout waiting for playing');
}

const results = [];
for (let i = 0; i < RUNS; i++) {
  const url = `${BASE}?level=4&control=mouse&debugChannel=1&t=${Date.now()}`;
  console.log(`\n=== DROP ${i + 1}/${RUNS} ===`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__TAMA_CHANNEL_DEBUG__, { timeout: 30000 });
  await page.evaluate(() => window.__TAMA_CHANNEL_DEBUG__.drop());
  await waitPlaying();
  // small settle after shooters spawn
  await new Promise((r) => setTimeout(r, 300));
  const counts = await page.evaluate(() => window.__TAMA_CHANNEL_DEBUG__.startCounts());
  console.log(JSON.stringify(counts));
  results.push(counts);
}

const allOk = results.every(
  (r) =>
    r.player === 10 &&
    r.ai === 10 &&
    r.fieldActive >= 18 &&
    r.inChannel === 0 &&
    r.inLoop === 0,
);
console.log('\nSUMMARY', JSON.stringify({ allOk, results }, null, 2));
console.log(allOk ? 'DROP_START_OK' : 'DROP_START_FAIL');
await browser.close();
process.exit(allOk ? 0 : 1);
