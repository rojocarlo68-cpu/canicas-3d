// Round 7 chunk B probe: the three rescue examples (Ex1/Ex2/Ex3) for BOTH sides, with the scoreboard recorded
// at every stage: before shot / channel+salvadora travelling / contact / in loop / after exit.
// Headless, virtual-time fast-forward of the real game code (see round7-lib.mjs).
import fs from 'node:fs';
import { launch, SHOTS, pick, CH } from './round7-lib.mjs';
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const g = await launch();
const { R, S, D, info, ff } = g;
const results = {};
async function run(name, fn) {
  if (ONLY.length && !ONLY.includes(name)) return;
  const t0 = Date.now();
  try { await g.fresh(); if (name !== 'AI_autonomous_rescue_phase') { await S('setAIIntervention', false); await S('setAIFrozen', true); } const out = await fn(); out.sec = +((Date.now() - t0) / 1000).toFixed(1); results[name] = out; }
  catch (e) { results[name] = { pass: false, error: String(e && e.stack || e).slice(0, 700) }; }
  console.log(name, JSON.stringify(results[name]).slice(0, 2200));
}
const stage = async (label) => {
  const b = await S('board');
  const loops = await S('loops');
  return { stage: label, score: `${b.scores.player}-${b.scores.ai}`, text: `${b.scoreText.player}-${b.scoreText.ai}`, money: b.scoreText.money, mat: `b${b.blueMat}/r${b.redMat}`, channel: b.channel, inLoop: b.loopTotal, loops: loops.map((l) => `${l.exitAs}:${l.team}`).join(','), zMat: b.zombiesMat };
};
const sc = (st) => st.score;

// Generic scenario runner. kind: 'hit' | 'miss'; chSide = side of the channel marble; by = salvadora side ('player' = human, 'ai')
async function scenario({ chSide, by, kind }) {
  const stages = [];
  const s0 = await R('census');
  stages.push(await stage('before shot'));
  const ch = await R('placeChannel', chSide, 0.0, -CH);
  if (kind === 'hit') {
    await ff(0.3);
    const i0 = await info(ch.id);
    const sx = i0.x + i0.vx * 0.07, sz = -0.25;
    await R('clearZone', sx, sz, 0.09, [ch.id]);
    const sh = await R('placeMat', by, sx, sz, [ch.id]);
    await R('clearZone', sx, sz, 0.002, [ch.id, sh.id]);
    if (by === 'player') { await R('select', sh.id); await R('shoot', 0, -1, 0.45); }
    else { await S('aiRescueShot', sh.id, 0, -1, 0.45); }
    stages.push(await stage('shot fired (channel marble + salvadora travelling)'));
    return await finish(stages, ch, sh, s0, kind);
  }
  // miss: salvadora goes into the north trough far from the target (target far east), both ride to the hole
  await R('clearZone', -0.2, -0.25, 0.1, [ch.id]);
  await R('move', ch.id, 0.28, -CH);
  const sh = await R('placeMat', by, -0.2, -0.25, [ch.id]);
  await R('clearZone', -0.2, -0.25, 0.002, [ch.id, sh.id]);
  if (by === 'player') { await R('select', sh.id); await R('shoot', 0, -1, 0.5); }
  else { await S('aiRescueShot', sh.id, 0, -1, 0.5); }
  stages.push(await stage('shot fired (channel marble + salvadora travelling)'));
  return await finish(stages, ch, sh, s0, kind);
}
async function finish(stages, ch, sh, s0, kind) {
  let loopStage = null, contactStage = null;
  const tl = [];
  g.lastTimeline = tl;
  for (let k = 0; k < 400; k++) {
    const r = await ff(0.1);
    tl.push(...r.timeline);
    const rs = await R('rescueStats');
    if (!contactStage && rs.contacts >= 1) contactStage = await stage('contact (salvadora touched channel marble)');
    const loops = await S('loops');
    if (!loopStage && loops.length >= 1) loopStage = await stage('first marble dropped into the hole / loop');
    const b = await S('board');
    if (loopStage && loops.length === 0 && b.channel === 0) break;
  }
  if (contactStage) stages.push(contactStage);
  if (loopStage) stages.push(loopStage);
  // both inside the loop at once (Ex1/Ex2: salvadora follows right behind) – capture if it happens
  const afterExit = await stage('after exit (loop empty, channel empty)');
  stages.push(afterExit);
  const chI = await info(ch.id), shI = await info(sh.id);
  const cs = await R('census');
  const rs = await R('rescueStats');
  const timeline = tl.map((e) => `${e.t}s ${e.scores} ${e.money} loop${e.loop} ch${e.ch} z${e.zMat}`);
  return { stages, timeline, ch: pick(chI), sal: pick(shI), s0: s0.scoreText, final: cs.scoreText, contacts: rs.contacts, rescued: rs.rescued, converted: rs.converted, census: { entities: cs.entities, zombies: cs.zombies, inLoop: cs.inLoop, inChannel: cs.inChannel }, kind };
}
const expect = (o, { chOwner, chRole, salOwner, salRole, deltaP, deltaA, contacts }) => {
  const s = o.s0.split ? o.s0 : o.s0;
  const [p0, a0] = [+o.stages[0].score.split('-')[0], +o.stages[0].score.split('-')[1]];
  const fin = o.stages[o.stages.length - 1].score.split('-').map(Number);
  return o.ch.owner === chOwner && o.ch.role === chRole && o.sal.owner === salOwner && o.sal.role === salRole && fin[0] === p0 + deltaP && fin[1] === a0 + deltaA && o.contacts === contacts && o.census.entities === 20 && o.census.inLoop === 0 && o.census.inChannel === 0;
};
const mid = (o) => { // scoreboard must never dip/double count the salvadora: check every stage score vs allowed set
  return o.stages.map((s) => s.score);
};

// Human salvadora (blue): Ex1 red target hit → 2 blue; Ex2 blue target hit → 2 blue; Ex3 miss (red / blue target)
await run('Ex1_red_channel_blue_salvadora_hit', async () => {
  const o = await scenario({ chSide: 'ai', by: 'player', kind: 'hit' });
  o.pass = expect(o, { chOwner: 'player', chRole: 'healthy', salOwner: 'player', salRole: 'healthy', deltaP: +1, deltaA: -1, contacts: 1 });
  return o;
});
await run('Ex2_blue_channel_blue_salvadora_hit', async () => {
  const o = await scenario({ chSide: 'player', by: 'player', kind: 'hit' });
  o.pass = expect(o, { chOwner: 'player', chRole: 'healthy', salOwner: 'player', salRole: 'healthy', deltaP: 0, deltaA: 0, contacts: 1 });
  return o;
});
await run('Ex3a_red_channel_blue_salvadora_miss', async () => {
  const o = await scenario({ chSide: 'ai', by: 'player', kind: 'miss' });
  o.pass = expect(o, { chOwner: 'field', chRole: 'zombie', salOwner: 'player', salRole: 'healthy', deltaP: 0, deltaA: -1, contacts: 0 });
  return o;
});
await run('Ex3b_blue_channel_blue_salvadora_miss', async () => {
  const o = await scenario({ chSide: 'player', by: 'player', kind: 'miss' });
  o.pass = expect(o, { chOwner: 'field', chRole: 'zombie', salOwner: 'player', salRole: 'healthy', deltaP: -1, deltaA: 0, contacts: 0 });
  return o;
});
// Symmetric: AI salvadora (red) during the human's turn
await run('Ex1_AI_blue_channel_red_salvadora_hit', async () => {
  const o = await scenario({ chSide: 'player', by: 'ai', kind: 'hit' });
  o.pass = expect(o, { chOwner: 'ai', chRole: 'healthy', salOwner: 'ai', salRole: 'healthy', deltaP: -1, deltaA: +1, contacts: 1 });
  return o;
});
await run('Ex2_AI_red_channel_red_salvadora_hit', async () => {
  const o = await scenario({ chSide: 'ai', by: 'ai', kind: 'hit' });
  o.pass = expect(o, { chOwner: 'ai', chRole: 'healthy', salOwner: 'ai', salRole: 'healthy', deltaP: 0, deltaA: 0, contacts: 1 });
  return o;
});
await run('Ex3a_AI_blue_channel_red_salvadora_miss', async () => {
  const o = await scenario({ chSide: 'player', by: 'ai', kind: 'miss' });
  o.pass = expect(o, { chOwner: 'field', chRole: 'zombie', salOwner: 'ai', salRole: 'healthy', deltaP: -1, deltaA: 0, contacts: 0 });
  return o;
});
await run('Ex3b_AI_red_channel_red_salvadora_miss', async () => {
  const o = await scenario({ chSide: 'ai', by: 'ai', kind: 'miss' });
  o.pass = expect(o, { chOwner: 'field', chRole: 'zombie', salOwner: 'ai', salRole: 'healthy', deltaP: 0, deltaA: -1, contacts: 0 });
  return o;
});

// Autonomous AI reaction: blue marble rides the channel during the human's turn; the AI decides by itself.
await run('AI_autonomous_rescue_phase', async () => {
  const s0 = await R('census');
  await S('setAIIntervention', true);
  const ch = await R('placeChannel', 'player', 0.0, -CH);
  const stages = [await stage('blue marble in channel (human turn)')];
  const r = await ff(14, { until: "window.__TAMA_R7__.aiIvInfo().shots>=1" });
  const iv = await S('aiIvInfo');
  stages.push(await stage('after AI reaction'));
  await ff(30, { until: "window.__TAMA_R7__.loops().length===0 && window.__TAMA_R6__.census().inChannel===0 && window.__TAMA_R6__.rescueStats().contacts+0>=0" });
  const rs = await R('rescueStats');
  const cs = await R('census');
  stages.push(await stage('end'));
  return { pass: iv.shots >= 1 && iv.shots <= 2 && cs.entities === 20 && cs.inLoop === 0, aiShots: iv.shots, max: iv.max, reactAfterSimSec: r.stoppedAt, contacts: rs.contacts, converted: rs.converted, stages, violations: r.violations.length, note: 'AI aims with lead prediction + ±1.7° error, so it may hit (convert) or miss; both outcomes follow the rules' };
});

fs.writeFileSync(`${SHOTS}/round7-rescue-results.json`, JSON.stringify(results, null, 1));
const bad = Object.entries(results).filter(([, v]) => !v.pass);
console.log(bad.length ? 'ROUND7_RESCUE FAIL ' + bad.map(([k]) => k).join(',') : `ROUND7_RESCUE PASS (${Object.keys(results).length} tests, pageErrors=${g.pageErrors.length})`);
await g.browser.close();
process.exit(bad.length ? 1 : 0);
