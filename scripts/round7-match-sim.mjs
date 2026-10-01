// Round 7 chunk C: full automated matches to the end. Scripted human (same rescue-biased planner the AI uses, plus
// intervention shots on the AI turn) vs the real AI, real zombies/rescues/loop. Virtual-time fast-forward, rendering
// skipped. Verifies: game ends with the victory/defeat screen, nothing left in loop/channel/queue, no stuck state.
import fs from 'node:fs';
import { launch, SHOTS } from './round7-lib.mjs';
const N = +(process.env.MATCHES || 4);
const WEAK_EVERY = +(process.env.WEAK_EVERY || 3); // every Nth match uses a passive human so the AI can win
const CAP = +(process.env.CAP_SEC || 1500);
const g = await launch();
const { page } = g;
const all = [];
for (let n = 0; n < N; n++) {
  const t0 = Date.now();
  await g.fresh();
  await g.S('setAIIntervention', true);
  const weak = WEAK_EVERY > 0 && (n + 1) % WEAK_EVERY === 0;
  const res = await page.evaluate((CAP, seedAggr, weak) => {
    const R6 = window.__TAMA_R6__, R7 = window.__TAMA_R7__, D = window.__TAMA_CHANNEL_DEBUG__;
    const out = { simSec: 0, turnsPlayer: 0, turnsAI: 0, humanIv: 0, aiIv: 0, maxLoop: 0, maxChannel: 0, maxZombies: 0, violations: [], stuck: [], rescued: 0, converted: 0, ended: false, end: null, scoreTrail: [] };
    const base = R6.census().entities;
    let lastTurnKey = '', stuckSince = null, lastScoreKey = '', lastIvMs = -1e9, ivThisAI = 0, wasAIturn = false;
    let aggr = seedAggr;
    for (let step = 0; step < CAP * 10; step++) {
      R7.stepFrames(6, 1000 / 60);
      out.simSec = +((step + 1) / 10).toFixed(1);
      const c = R6.census(), b = R7.board();
      if (c.entities !== base) out.violations.push({ t: out.simSec, why: 'entities_changed', e: c.entities });
      if (c.uniqueBodies !== c.entities) out.violations.push({ t: out.simSec, why: 'dup_body' });
      if (c.blue + c.red + c.zombies + c.inLoop !== c.active) out.violations.push({ t: out.simSec, why: 'category_sum' });
      out.maxLoop = Math.max(out.maxLoop, b.loopTotal);
      out.maxChannel = Math.max(out.maxChannel, b.channel);
      out.maxZombies = Math.max(out.maxZombies, b.zombiesMat + b.zombiesLoop);
      const sk = b.scores.player + '-' + b.scores.ai;
      if (sk !== lastScoreKey) { lastScoreKey = sk; if (out.scoreTrail.length < 80) out.scoreTrail.push(`${out.simSec}s ${sk} ${b.scoreText.money}`); }
      // loop dwell watchdog: any marble in the loop longer than 8 s of wall (virtual) time = stuck
      for (const l of R7.loops()) if (l.ageMs > 8000) out.stuck.push({ t: out.simSec, loop: l });
      const es = R7.endState();
      if (es.phase === 'ended') { out.ended = true; out.end = es; break; }
      // zero-healthy-but-not-ended watchdog
      if ((b.scores.player <= 0 || b.scores.ai <= 0)) { if (stuckSince === null) stuckSince = out.simSec; else if (out.simSec - stuckSince > 1.5) { out.stuck.push({ t: out.simSec, why: 'zero_healthy_not_ended', scores: b.scores }); break; } } else stuckSince = null;
      const turnKey = b.turn + b.phase;
      if (b.phase === 'playing' && b.turn === 'player') {
        const r = R7.autoPlayerShot(weak ? 0 : aggr);
        if (r.ok) { out.turnsPlayer++; aggr = 0.7 + Math.random() * 0.5; }
      } else if (b.phase === 'ai_thinking' && b.turn === 'ai') {
        if (!wasAIturn) { out.turnsAI++; ivThisAI = 0; }
      }
      wasAIturn = b.turn === 'ai' && (b.phase === 'ai_thinking' || b.phase === 'shot_flying');
      // scripted human intervention on the AI turn: hit a red/blue channel rider (max 2 per AI turn, 0.9 s apart)
      if (!weak && wasAIturn && ivThisAI < 2 && out.simSec - lastIvMs > 0.9 && b.channel > 0) {
        const iv = R6.interventionInfo();
        if (iv.mode === 'intervention' && iv.shots < iv.max) {
          const riders = R6.census && R7.dump().filter((m) => m.a && m.ch === 'in_channel' && m.r === 'healthy' && !m.rs);
          const mine = R7.listTeam('player').filter((m) => m.ch === 'none' && !m.loop);
          if (riders.length && mine.length) {
            const t = riders[0];
            let best = null, bd = 1e9;
            for (const m of mine) { const d = Math.hypot(t.x - m.x, t.z - m.z); if (d < bd && d > 0.03 && d < 0.5) { bd = d; best = m; } }
            if (best) {
              const ti = R6.info(t.id); const lead = bd / 1.5;
              const px = t.x + (ti ? ti.vx : 0) * lead, pz = t.z + (ti ? ti.vz : 0) * lead;
              const dx = px - best.x, dz = pz - best.z, L = Math.hypot(dx, dz);
              R6.select(best.id);
              const sr = R6.shoot(dx / L, dz / L, Math.min(0.6, 0.28 + L * 0.8));
              if (sr && sr.ok) { out.humanIv++; ivThisAI++; lastIvMs = out.simSec; }
            }
          }
        }
      }
    }
    out.aiIv = R7.aiIvInfo().shots;
    const rs = R6.rescueStats(); out.rescued = rs.rescued; out.converted = rs.converted; out.contacts = rs.contacts;
    const fin = R7.board(); out.final = fin; out.loopsEnd = R7.loops(); out.exit = R7.exitStats();
    return out;
  }, CAP, 1, weak);
  const fin = res.final || {};
  const victoryUi = res.end && (res.end.victoryVisible || res.end.endVisible);
  const clean = res.ended && victoryUi && fin.loopTotal === 0 && fin.channel === 0 && (res.loopsEnd || []).length === 0 && res.violations.length === 0 && res.stuck.length === 0;
  const winner = fin.scores ? (fin.scores.ai <= 0 && fin.scores.player > 0 ? 'player (victory)' : fin.scores.player <= 0 && fin.scores.ai > 0 ? 'AI (defeat)' : 'draw/other') : '?';
  const row = { match: n + 1, humanStyle: weak ? 'passive' : 'active (rescues+interventions)', pass: clean, winner, simSec: res.simSec, playerTurns: res.turnsPlayer, aiTurns: res.turnsAI, humanInterventions: res.humanIv, aiInterventions: res.aiIv, rescued: res.rescued, converted: res.converted, contacts: res.contacts, maxZombiesAtOnce: res.maxZombies, maxInLoopAtOnce: res.maxLoop, maxInChannelAtOnce: res.maxChannel,
    finalScores: fin.scores, finalMoney: fin.scoreText && fin.scoreText.money, endTitle: res.end && res.end.endTitle, endScreen: res.end && { victoryOverlay: res.end.victoryVisible, endCard: res.end.endVisible }, atEnd: { inLoop: fin.loopTotal, inChannel: fin.channel, loopQueue: (res.loopsEnd || []).length, zombiesOnMat: fin.zombiesMat },
    exitStats: { exits: res.exit.exits, forced: res.exit.forced, hops: res.exit.hops, maxWaitMs: Math.round(res.exit.maxWaitMs), channelWatchdog: res.exit.watchdogChannel }, invariantViolations: res.violations.length, stuckEvents: res.stuck.slice(0, 3), trailHead: res.scoreTrail.slice(0, 6), trailTail: res.scoreTrail.slice(-4), wallSec: +((Date.now() - t0) / 1000).toFixed(1) };
  all.push(row);
  console.log(JSON.stringify(row));
}
fs.writeFileSync(`${SHOTS}/round7-match-sim-results.json`, JSON.stringify(all, null, 1));
const bad = all.filter((r) => !r.pass);
console.log(bad.length ? `ROUND7_MATCH_SIM FAIL matches ${bad.map((r) => r.match)}` : `ROUND7_MATCH_SIM PASS (${all.length} full matches, pageErrors=${g.pageErrors.length})`);
await g.browser.close();
process.exit(bad.length ? 1 : 0);
