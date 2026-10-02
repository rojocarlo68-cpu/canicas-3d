// Round 8 probe: zombies drift 15–20 cm away from the loop hatch after their exit hop.
// Headless, virtual-time fast-forward of the real game code (round7-lib.mjs).
import fs from 'node:fs';
import { launch, SHOTS } from './round7-lib.mjs';
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const g = await launch();
const { R, S, D, info, ff } = g;
const results = {};
const HATCH = { x: 0.32 * 0.42, z: -0.32 * 0.38 };
const R_ = 0.008;
const hd = (m) => Math.hypot(m.x - HATCH.x, m.z - HATCH.z);
async function run(name, fn) {
  if (ONLY.length && !ONLY.includes(name)) return;
  const t0 = Date.now();
  try { await g.fresh(); await S('setAIIntervention', false); await S('setAIFrozen', true); const out = await fn(); out.sec = +((Date.now() - t0) / 1000).toFixed(1); results[name] = out; }
  catch (e) { results[name] = { pass: false, error: String(e && e.stack || e).slice(0, 700) }; }
  console.log(name, JSON.stringify(results[name]).slice(0, 2400));
}
async function burst(n, gapS, drift) {
  await S('setDrift', drift);
  const red = await S('listTeam', 'ai');
  const ids = red.slice(0, n).map((m) => m.id);
  const before = (await D('snapshot')).filter((m) => !ids.includes(m.id)).map((m) => ({ id: m.id, x: m.x, z: m.z }));
  for (const id of ids) { await S('toLoop', id, 'zombie'); await ff(gapS); }
  let minPair = Infinity, minAt = 0, off = 0;
  const T = 24; // seconds after the last zombie was sent
  for (let k = 0; k < T * 10; k++) {
    await ff(0.1);
    if (k < 20) continue; // 2 s grace: last exit comes ~1.6 s after toLoop and the hop lands in <0.1 s
    const snap = (await D('snapshot')).filter((m) => !m.loop);
    for (let a = 0; a < snap.length; a++) {
      const s = snap[a];
      if (Math.abs(s.x) > 0.3 || Math.abs(s.z) > 0.3 || s.y < -0.01) off++;
      for (let b = a + 1; b < snap.length; b++) {
        const d = Math.hypot(snap[a].x - snap[b].x, snap[a].y - snap[b].y, snap[a].z - snap[b].z);
        if (d < minPair) { minPair = d; minAt = k / 10; }
      }
    }
  }
  const snap = (await D('snapshot')).filter((m) => !m.loop);
  const zs = snap.filter((m) => m.role === 'zombie');
  const dists = zs.map(hd).map((v) => +(v * 100).toFixed(1));
  const near8All = snap.filter((m) => hd(m) < 0.08); const preexisting = near8All.filter((m) => m.role !== 'zombie' && before.some((b) => b.id === m.id && Math.hypot(b.x - m.x, b.z - m.z) < 0.002)); const near8 = near8All.filter((m) => !preexisting.includes(m)); const within8 = near8.length; // healthy marbles that were already resting there from the initial layout (never moved) are not counted
  const preexistingHealthyNearHatch = preexisting.map((m) => ({ id: m.id, d_cm: +(hd(m) * 100).toFixed(1) })); const near8Detail = near8.map((m) => ({ id: m.id, role: m.role, owner: m.owner, d_cm: +(hd(m) * 100).toFixed(1) }));
  const disp = before.map((b) => { const c = snap.find((m) => m.id === b.id); return c ? Math.hypot(c.x - b.x, c.z - b.z) : 0; });
  const ex = await S('exitStats'); const ds = await S('driftStats');
  const loops = await S('loops');
  const maxEdge = Math.max(...zs.map((m) => Math.max(Math.abs(m.x), Math.abs(m.z))));
  return { zombies: zs.length, hatchDist_cm: dists.sort((a, b) => a - b), minHatchDist_cm: Math.min(...dists), maxHatchDist_cm: Math.max(...dists), minPair_mm: +(minPair * 1000).toFixed(2), minPairAtS: minAt, offDeskSamples: off, within8cmOfHatch: within8, near8Detail, preexistingHealthyNearHatch, healthyMaxDisplacement_mm: +(Math.max(0, ...disp) * 1000).toFixed(2), maxAbsXZ_cm: +(maxEdge * 100).toFixed(1), edgeLimit_cm: +((0.32 - 5 * R_) * 100).toFixed(1), loopsLeft: loops.length, exits: ex.exits, forced: ex.forced, drift: { started: ds.started, arrived: ds.arrived, blocked: ds.blocked, replans: ds.replans, knocked: ds.knocked, timedOut: ds.timedOut, stillActive: ds.active.length } };
}
await run('D0_baseline_no_drift_8_zombies', async () => {
  const r = await burst(8, 0.7, false);
  return { ...r, pass: true, note: 'drift OFF (Round 7 behaviour) for comparison: expect zombies piled near the hatch' };
});
await run('D1_drift_8_zombies_in_succession', async () => {
  const r = await burst(8, 0.7, true);
  const pass = r.zombies === 8 && r.minHatchDist_cm >= 15.0 && r.maxHatchDist_cm <= 20.5 && r.minPair_mm >= 14.8 && r.offDeskSamples === 0 && r.within8cmOfHatch === 0 && r.loopsLeft === 0 && r.healthyMaxDisplacement_mm < 2 && r.maxAbsXZ_cm <= r.edgeLimit_cm + 0.5;
  return { ...r, pass };
});
await run('D2_drift_6_zombies_slower_succession', async () => {
  const r = await burst(6, 2.2, true);
  const pass = r.zombies === 6 && r.minPair_mm >= 14.8 && r.offDeskSamples === 0 && r.within8cmOfHatch === 0 && r.healthyMaxDisplacement_mm < 2;
  return { ...r, pass };
});
// obstacles: ring of healthy blue marbles on the drift paths – zombies must stop/replan without pushing them
await run('D3_blocked_by_healthy_marbles_no_push', async () => {
  await S('setDrift', true);
  const blue = await S('listTeam', 'player');
  // surround the hatch at ~11 cm with 8 blue marbles
  const placed = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2;
    const x = HATCH.x + Math.cos(a) * 0.11, z = HATCH.z + Math.sin(a) * 0.11;
    if (Math.abs(x) > 0.27 || Math.abs(z) > 0.27) continue;
    // only on free spots (>= 4R from every other marble) so the setup itself causes no overlap push
    const cur = (await D('snapshot')).filter((m) => !m.loop && m.id !== blue[k].id);
    if (cur.some((m) => Math.hypot(m.x - x, m.z - z) < 4 * R_)) continue;
    await R('move', blue[k].id, x, z); placed.push({ id: blue[k].id, x, z });
  }
  await ff(4);
  const before = (await D('snapshot')).filter((m) => placed.some((p) => p.id === m.id)).map((m) => ({ id: m.id, x: m.x, z: m.z }));
  const red = await S('listTeam', 'ai');
  for (let i = 0; i < 3; i++) { await S('toLoop', red[i].id, 'zombie'); await ff(0.8); }
  await ff(22);
  const snap = (await D('snapshot')).filter((m) => !m.loop);
  const zs = snap.filter((m) => m.role === 'zombie');
  const disp = before.map((b) => { const c = snap.find((m) => m.id === b.id); return c ? Math.hypot(c.x - b.x, c.z - b.z) : 99; });
  const alive = placed.every((p) => snap.some((m) => m.id === p.id && m.role === 'healthy'));
  const detail = placed.map((p, i) => ({ id: p.id, role: (snap.find((m) => m.id === p.id) || {}).role || 'gone', disp_mm: +(disp[i] * 1000).toFixed(1) }));
  let minPair = Infinity;
  for (let a = 0; a < snap.length; a++) for (let b = a + 1; b < snap.length; b++) minPair = Math.min(minPair, Math.hypot(snap[a].x - snap[b].x, snap[a].y - snap[b].y, snap[a].z - snap[b].z));
  const ds = await S('driftStats');
  return { pass: alive && Math.max(...disp) * 1000 < 2 && minPair * 1000 >= 14.8 && zs.length >= 3, extraZombiesFromChannelRescue: zs.length - 3, ringMarbles: placed.length, detail, ringMaxDisplacement_mm: +(Math.max(...disp) * 1000).toFixed(2), ringAllStillHealthy: alive, zombieHatchDist_cm: zs.map((m) => +(hd(m) * 100).toFixed(1)), minPair_mm: +(minPair * 1000).toFixed(2), drift: { started: ds.started, arrived: ds.arrived, blocked: ds.blocked, replans: ds.replans, knocked: ds.knocked } };
});
// zombies still kill healthy marbles on contact after drifting (real shot, real contact)
await run('D4_drifted_zombie_still_kills_on_contact', async () => {
  await S('setDrift', true);
  const red = await S('listTeam', 'ai');
  await S('toLoop', red[0].id, 'zombie');
  await ff(12);
  const z = await info(red[0].id);
  const before = await R('census');
  // blue shooter placed next to the zombie, flicked straight into it
  const dirx = 1, dirz = 0;
  const sx = z.x - 0.06, sz = z.z;
  await R('clearZone', sx, sz, 0.05, [red[0].id]);
  const sh = await R('placeMat', 'player', sx, sz, [red[0].id]);
  await R('clearZone', sx, sz, 0.002, [red[0].id, sh.id]);
  await R('select', sh.id);
  await R('shoot', dirx, dirz, 0.4);
  await ff(5);
  const after = await R('census');
  const shI = await info(sh.id);
  return { pass: !shI.active && after.scores.player < before.scores.player, note: 'scenario setup can occasionally also route a stray marble through the channel (seen with drift off too), so only require the shooter killed and score down', zombieStoppedAt_cm: +(hd(z) * 100).toFixed(1), shooterActive: shI.active, scoreBefore: before.scoreText, scoreAfter: after.scoreText };
});
fs.writeFileSync(`${SHOTS}/round8-drift-results.json`, JSON.stringify(results, null, 1));
const bad = Object.entries(results).filter(([, v]) => !v.pass);
console.log(bad.length ? 'ROUND8_DRIFT FAIL ' + bad.map(([k]) => k).join(',') : `ROUND8_DRIFT PASS (${Object.keys(results).length} tests, pageErrors=${g.pageErrors.length})`);
await g.browser.close();
process.exit(bad.length ? 1 : 0);
