// Round 7 chunk A probe: victory with a marble stuck in the loop queue, exit hop, forced-launch guarantee.
// Headless, virtual-time fast-forward of the REAL game code (see round7-lib.mjs).
import fs from 'node:fs';
import { launch, SHOTS, pick } from './round7-lib.mjs';
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const g = await launch();
const { page, R, S, D, info, ff } = g;
const results = {};
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
async function run(name, fn) {
  if (ONLY.length && !ONLY.includes(name)) return;
  const t0 = Date.now();
  try { await g.fresh(); const out = await fn(); out.sec = +((Date.now() - t0) / 1000).toFixed(1); results[name] = out; }
  catch (e) { results[name] = { pass: false, error: String(e && e.stack || e).slice(0, 600) }; }
  console.log(name, JSON.stringify(results[name]).slice(0, 1800));
}
const stripTl = (r) => ({ ...r, timeline: r.timeline.slice(0, 14) });

// A1 — REPRODUCTION (legacy behaviour): last red marble falls in the hole as a zombie, exit crowded.
// Expected old behaviour: scoreboard still shows red 1 (zombie-bound marble counted healthy) and the marble
// waits forever → no victory.
await run('A1_repro_legacy_stuck_loop_no_victory', async () => {
  await S('killTeam', 'ai', 1);
  const red = (await S('listTeam', 'ai'))[0];
  await S('setLegacy', true, true, true);
  await S('setExitTuning', 1, 700);
  const blk = await S('blockExit', 1, 7, [red.id]);
  await ff(0.5);
  const before = await S('board');
  await S('toLoop', red.id, 'zombie');
  const r = await ff(40, { until: "window.__TAMA_R7__.endState().phase==='ended'" });
  const after = await S('board');
  const loops = await S('loops');
  const end = await S('endState');
  return { pass: end.phase !== 'ended' && loops.length === 1 && after.scores.ai === 1 && loops[0].waitMs > 20000,
    note: 'LEGACY switches on: expected = NO victory, red still counted 1, marble waiting >20 s in loop',
    obstacles: blk, scoreBefore: before.scores, scoreAfter: after.scores, loops, end, timeline: r.timeline.slice(0, 8), violations: r.violations.length };
});

await run('A2_fixed_victory_when_last_marble_zombie_bound_even_with_crowded_exit', async () => {
  await S('killTeam', 'ai', 1);
  const red = (await S('listTeam', 'ai'))[0];
  await S('setLegacy', false, false, false);
  await S('setExitTuning', 1, 700);
  const blk = await S('blockExit', 1, 7, [red.id]);
  await ff(0.5);
  const before = await S('board');
  await S('toLoop', red.id, 'zombie');
  const r = await ff(10, { until: "window.__TAMA_R7__.endState().phase==='ended'" });
  const after = await S('board');
  const end = await S('endState');
  const loops = await S('loops');
  return { pass: end.phase === 'ended' && /Victoria|Victory/i.test(end.endTitle || '') !== null && loops.length === 0 && after.loopTotal === 0 && after.scores.ai === 0 && after.channel === 0 && r.violations.length === 0,
    obstacles: blk, scoreBefore: before.scores, scoreAfter: after.scores, victoryAfterSimSec: r.stoppedAt, end, loopsLeft: loops.length, boardAfter: { loopTotal: after.loopTotal, channel: after.channel, zombiesMat: after.zombiesMat }, violations: r.violations.length };
});

// A3 — the same through the real channel flow: last red marble rides the channel to the hole.
await run('A3_fixed_victory_last_red_marble_rides_channel_to_hole', async () => {
  await S('killTeam', 'ai', 1);
  const red = (await S('listTeam', 'ai'))[0];
  await S('setExitTuning', 1, 700);
  await S('blockExit', 1, 7, [red.id]);
  const ch = await R('placeChannel', 'ai', 0.0, -0.3344);
  const before = await S('board');
  const r = await ff(60, { until: "window.__TAMA_R7__.endState().phase==='ended'" });
  const end = await S('endState');
  const after = await S('board');
  return { pass: end.phase === 'ended' && after.loopTotal === 0 && after.channel === 0 && after.scores.ai === 0 && r.violations.length === 0,
    placed: ch, scoreBefore: before.scores, scoreAfter: after.scores, victoryAfterSimSec: r.stoppedAt, end, timeline: r.timeline.slice(0, 10), violations: r.violations.length };
});

// A4 — legacy-gate reproduction: healthy marble drops in the hole with NO shot in flight and no in_channel flag.
await run('A4_hole_drop_outside_shot_window_resolves', async () => {
  await S('killTeam', 'ai', 1);
  const red = (await S('listTeam', 'ai'))[0];
  const before = await S('board');
  await S('zombieToLoopHole', red.id); // plain healthy marble put into the shaft (phase 'playing', no shot)
  const r = await ff(6, { until: "window.__TAMA_R7__.endState().phase==='ended'" });
  const end = await S('endState');
  const after = await S('board');
  return { pass: end.phase === 'ended' && after.scores.ai === 0 && after.loopTotal === 0, scoreBefore: before.scores, scoreAfter: after.scores, victoryAfterSimSec: r.stoppedAt, end, timeline: r.timeline.slice(0, 8) };
});
// A5 — exit hop numbers (several exits, mixed converted / zombie) with an open hatch.
await run('A5_exit_hop_numbers', async () => {
  const team = await S('listTeam', 'player');
  const rows = [];
  for (let k = 0; k < 6; k++) {
    const id = team[k].id; // blue marbles, moved into the loop one at a time
    const as = k % 2 === 0 ? 'converted' : 'zombie';
    await R('clearZone', 0.134, -0.122, 0.09, [id]);
    await S('hopStart', id, 1.2);
    await S('toLoop', id, as);
    await ff(3.2, { until: `window.__TAMA_R7__.loops().length===0` });
    await ff(1.5);
    const h = await S('hopGet');
    const i = await info(id);
    rows.push({ id, as, apex_mm: h.apexAboveRest_mm, startAboveRest_mm: h.startAboveRest_mm, landedAt_ms: h.landedAt_ms, horizAtLand_mm: h.horizAtLand_mm, endHoriz_mm: h.endHoriz_mm, onMat: h.onMat, roleEnd: i.role, activeEnd: i.active });
    await S('stepFrames', 1, 16);
  }
  const apex = rows.map((r) => r.apex_mm);
  return { pass: rows.every((r) => r.onMat && r.activeEnd && r.apex_mm > 2.5 && r.apex_mm < 7.5), rows, apexMin: Math.min(...apex), apexMax: Math.max(...apex) };
});


// A8 — 6 zombies fall in the hole at once with an OPEN hatch: sequential exits + hop, pairwise distance over time.
await run('A8_six_zombies_burst_no_overlap_and_on_desk', async () => {
  const red = await S('listTeam', 'ai');
  const ids = red.slice(0, 6).map((m) => m.id);
  for (const id of ids) await S('toLoop', id, 'zombie');
  await ff(1.7);
  let minPair = Infinity; let worstOff = 0;
  for (let k = 0; k < 60; k++) {
    await ff(0.1);
    const snap = await D('snapshot');
    for (let a = 0; a < snap.length; a++) for (let b = a + 1; b < snap.length; b++) {
      if (snap[a].loop || snap[b].loop) continue;
      const d = Math.hypot(snap[a].x - snap[b].x, snap[a].y - snap[b].y, snap[a].z - snap[b].z);
      if (k >= 9 && d < minPair) minPair = d; // 0.9 s grace after the last exit
    }
    for (const s of snap) if (!s.loop) worstOff = Math.max(worstOff, Math.abs(s.x) > 0.34 || Math.abs(s.z) > 0.34 || s.y < -0.01 ? 1 : 0);
  }
  const ex = await S('exitStats'); const loops = await S('loops'); const b = await S('board');
  return { pass: loops.length === 0 && minPair * 1000 >= 14.8 - 0.3 && worstOff === 0 && b.entities === 20, minPair_mm: +(minPair * 1000).toFixed(2), needed_mm: 14.8, exits: ex.exits, forced: ex.forced, hops: ex.hops, maxWaitMs: Math.round(ex.maxWaitMs), anyOffMat: worstOff, board: { zombiesMat: b.zombiesMat, loopTotal: b.loopTotal } };
});

// A6 — forced launch guarantee: exit completely crowded → waits ≤ max wait then force-launches; zombies never overlap afterwards.
await run('A6_forced_launch_and_no_overlap', async () => {
  await S('setExitTuning', 1, 700);
  const blue = await S('listTeam', 'player');
  const red = await S('listTeam', 'ai');
  const ids = [red[0].id, red[1].id, red[2].id];
  await S('blockExit', 1, 7, ids);
  await ff(0.5);
  for (const id of ids) await S('toLoop', id, 'zombie');
  const snap0 = await S('loops');
  const r = await ff(8, { until: `window.__TAMA_R7__.loops().length===0` });
  const ex = await S('exitStats');
  // pairwise distance of all active marbles over the next 3 s (after a 0.9 s grace)
  let minPair = Infinity;
  await ff(0.9);
  for (let k = 0; k < 30; k++) {
    await ff(0.1);
    const snap = await D('snapshot');
    for (let a = 0; a < snap.length; a++) for (let b = a + 1; b < snap.length; b++) {
      const d = Math.hypot(snap[a].x - snap[b].x, snap[a].y - snap[b].y, snap[a].z - snap[b].z);
      if (d < minPair) minPair = d;
    }
  }
  const loopsEnd = await S('loops');
  return { pass: loopsEnd.length === 0 && ex.forced >= 1 && ex.maxWaitMs <= 1400 && minPair * 1000 >= 14.8 - 0.5 && r.violations.length === 0,
    loopsAtStart: snap0.length, forcedLaunches: ex.forced, maxWaitMs: ex.maxWaitMs, exits: ex.exits, minPair_mm: +(minPair * 1000).toFixed(2), needed_mm: 14.8, violations: r.violations.length, log: ex.log.slice(-5) };
});

// A7 — nothing ever left in loop / channel at game end (victory with marbles mid-loop & mid-channel).
await run('A7_end_flushes_loop_and_channel', async () => {
  await S('killTeam', 'ai', 3);
  const red = await S('listTeam', 'ai');
  const blue = await S('listTeam', 'player');
  await R('placeChannel', 'player', 0.0, -0.3344); // blue rider
  await S('toLoop', blue[3].id, 'converted'); // blue healthy mid-loop
  await ff(0.3);
  // remove red entirely while blue marbles are mid-loop / in channel
  for (const m of red) await S('toLoop', m.id, 'zombie');
  const r = await ff(8, { until: "window.__TAMA_R7__.endState().phase==='ended'" });
  const end = await S('endState');
  const b = await S('board');
  const loops = await S('loops');
  return { pass: end.phase === 'ended' && b.loopTotal === 0 && b.channel === 0 && loops.length === 0 && r.violations.length === 0, victoryAfterSimSec: r.stoppedAt, board: b, end, violations: r.violations.length };
});

fs.writeFileSync(`${SHOTS}/round7-victory-exit-results.json`, JSON.stringify(results, null, 1));
const bad = Object.entries(results).filter(([, v]) => !v.pass);
console.log(bad.length ? 'ROUND7_VICTORY_EXIT FAIL ' + bad.map(([k]) => k).join(',') : `ROUND7_VICTORY_EXIT PASS (${Object.keys(results).length} tests, pageErrors=${g.pageErrors.length})`);
await g.browser.close();
process.exit(bad.length ? 1 : 0);
