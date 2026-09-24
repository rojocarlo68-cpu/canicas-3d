/**
 * L4 reversible competitive MATCH MODE (PLAYER vs AI rival) on top of the
 * color-target experiment.
 *
 * When ENABLE_MATCH_MODE is false (or color experiment is off), call sites
 * no-op and L4 behaves exactly like today's color-target free-play experiment.
 *
 * Scoring: +1 via Game's existing playerScore/aiScore when the shot that
 * sent a TARGET_COLOR marble into the hole is attributed (lastScorer).
 * Wrong color → 0. No penalties. Both colors still loop and return.
 *
 * Win: first to POINTS_TO_WIN (5). Secondary fallback: playable-on-mat < 2
 * if neither side ever reaches 5.
 *
 * Scoreboard: NEVER draws its own scorer counters — the existing
 * name-vs-name HUD (score-player / score-ai) is the only scorer display.
 * This HUD is a tiny 🎯 COLOR chip only (turn lives in #turn-label).
 */
import {
  ENABLE_COLOR_TARGET_EXPERIMENT,
  getTargetColor,
  marbleColorTag,
  isMarbleInLoop,
  setColorTargetScoreHook,
  randomizeTargetColor,
  type SideScorer,
} from './l4ColorTargetExperiment';
import {
  L4_MAT_HALF,
  L4_CHANNEL_W,
  L4_DESK_BOUNDS,
  l4HoleCentersLocal,
  l4IsChannelOrHoleXZ,
} from './officeDesk';
import { MARBLE_RADIUS, PLAY_SURFACE_Y } from './constants';
import type { MarbleEntity } from './marbles';
import type { AIShotPlan } from './ai';
import { planAIShot } from './ai';

/** Master switch — set false to restore prior color-target experiment only. */
export const ENABLE_MATCH_MODE = true;

/** First side to this many target-color hole points wins. */
export const POINTS_TO_WIN = 5;

/**
 * Secondary end: playable-on-mat field count drops below this.
 * Only used if scores never hit POINTS_TO_WIN.
 */
export const MIN_PLAYABLE_ON_MAT = 2;

const HUD_ID = 'l4-color-target-hud';
const END_OVERLAY_ID = 'l4-match-end-overlay';

let matchOver = false;
let turnSide: SideScorer = 'player';
let onReplay: (() => void) | null = null;
let onMenu: (() => void) | null = null;
let onTargetScore: ((scorer: SideScorer | null) => void) | null = null;
let getDisplayNames: (() => { player: string; ai: string }) | null = null;

export function isMatchModeActive(sceneLevel: number): boolean {
  return ENABLE_MATCH_MODE && ENABLE_COLOR_TARGET_EXPERIMENT && sceneLevel === 4;
}

export function isMatchOver(): boolean {
  return matchOver;
}

/** Reset match flags + pick a fresh target color for the new match. */
export function resetMatchScores(): void {
  matchOver = false;
  randomizeTargetColor();
  refreshMatchHUD(turnSide);
}

export function matchReachedWinScore(playerScore: number, aiScore: number): boolean {
  return playerScore >= POINTS_TO_WIN || aiScore >= POINTS_TO_WIN;
}

/** Active field marble resting on the mat surface (not channel/hole/loop/fallen). */
export function isPlayableOnMat(marble: MarbleEntity): boolean {
  if (!marble.active || !marble.mesh.visible) return false;
  if (isMarbleInLoop(marble)) return false;
  const { x, y, z } = marble.body.position;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
  if (Math.abs(x) > L4_MAT_HALF + 1e-4 || Math.abs(z) > L4_MAT_HALF + 1e-4) return false;
  if (l4IsChannelOrHoleXZ(x, z)) return false;
  if (y < PLAY_SURFACE_Y - MARBLE_RADIUS * 0.75) return false;
  return true;
}

export function countPlayableOnMat(field: MarbleEntity[]): number {
  let n = 0;
  for (const m of field) {
    if (isPlayableOnMat(m)) n += 1;
  }
  return n;
}

/** Secondary end condition only — prefer first-to-POINTS_TO_WIN. */
export function shouldEndMatch(field: MarbleEntity[]): boolean {
  return countPlayableOnMat(field) < MIN_PLAYABLE_ON_MAT;
}

/**
 * AI target pool for L4 match:
 * 1) current target-color playable on mat (always prefer when any exist)
 * 2) else any playable on mat
 * 3) else any active non-loop field marble
 */
export function fieldPoolForMatchAI(field: MarbleEntity[]): MarbleEntity[] {
  const target = getTargetColor();
  const onMat = field.filter(isPlayableOnMat);
  const targets = onMat.filter((m) => marbleColorTag(m) === target);
  if (targets.length > 0) return targets;
  if (onMat.length > 0) return onMat;
  return field.filter((m) => m.active && m.mesh.visible && !isMarbleInLoop(m));
}

function targetLabel(): string {
  const c = getTargetColor();
  return c === 'rojo'
    ? 'ROJO'
    : c === 'azul'
      ? 'AZUL'
      : c === 'verde'
        ? 'VERDE'
        : c === 'amarillo'
          ? 'AMARILLO'
          : 'OTRO';
}

/**
 * Match HUD: tiny objective chip only (🎯 VERDE).
 * Turn indication stays on #turn-label — do NOT duplicate TU TURNO here.
 * Does NOT draw score counters (existing name-vs-name scoreboard owns that).
 */
export function refreshMatchHUD(turn: SideScorer): void {
  turnSide = turn;
  if (!ENABLE_MATCH_MODE) return;
  let el = document.getElementById(HUD_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = HUD_ID;
    const host = document.getElementById('hud') ?? document.body;
    host.appendChild(el);
  }
  const color = getTargetColor();
  el.className = 'l4-color-target-hud l4-ct-chip';
  el.innerHTML = `
    <div class="l4-ct-chip-line">🎯 <span class="l4-ct-color l4-ct-${color}">${targetLabel()}</span></div>
  `;
  el.classList.remove('hidden');
}

export function mountMatchMode(handlers: {
  onReplay: () => void;
  onMenu: () => void;
  /** Wire into Game.playerScore / Game.aiScore — do NOT keep a second scorer. */
  onTargetScore: (scorer: SideScorer | null) => void;
  getDisplayNames: () => { player: string; ai: string };
}): void {
  if (!ENABLE_MATCH_MODE || !ENABLE_COLOR_TARGET_EXPERIMENT) return;
  onReplay = handlers.onReplay;
  onMenu = handlers.onMenu;
  onTargetScore = handlers.onTargetScore;
  getDisplayNames = handlers.getDisplayNames;
  matchOver = false;
  randomizeTargetColor();
  setColorTargetScoreHook((info) => {
    onTargetScore?.(info.scorer);
  });
  refreshMatchHUD('player');
  ensureEndOverlay();
  hideMatchEndOverlay();
}

export function disposeMatchMode(): void {
  setColorTargetScoreHook(null);
  hideMatchEndOverlay();
  matchOver = false;
  onReplay = null;
  onMenu = null;
  onTargetScore = null;
  getDisplayNames = null;
}

function ensureEndOverlay(): HTMLElement {
  let el = document.getElementById(END_OVERLAY_ID);
  if (el) return el;
  el = document.createElement('div');
  el.id = END_OVERLAY_ID;
  el.className = 'l4-match-end-overlay hidden';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `
    <div class="l4-match-end-card">
      <div class="l4-match-end-scores" id="l4-match-end-scores"></div>
      <div class="l4-match-end-winner" id="l4-match-end-winner"></div>
      <div class="l4-match-end-actions">
        <button type="button" class="premium-btn" id="l4-match-btn-replay">Otra vez</button>
        <button type="button" class="premium-btn" id="l4-match-btn-menu">Menú</button>
      </div>
    </div>
  `;
  document.body.appendChild(el);
  el.querySelector('#l4-match-btn-replay')?.addEventListener('click', () => {
    hideMatchEndOverlay();
    onReplay?.();
  });
  el.querySelector('#l4-match-btn-menu')?.addEventListener('click', () => {
    hideMatchEndOverlay();
    onMenu?.();
  });
  return el;
}

/**
 * Simple result screen using existing player/AI display names
 * (same identity as the name-vs-name scoreboard — no third naming system).
 */
export function showMatchEndOverlay(playerScore: number, aiScore: number): void {
  matchOver = true;
  const names = getDisplayNames?.() ?? { player: 'Jugador', ai: 'Rival' };
  const el = ensureEndOverlay();
  const scores = el.querySelector('#l4-match-end-scores');
  const winner = el.querySelector('#l4-match-end-winner');
  if (scores) {
    scores.innerHTML = `<div>${names.player}: ${playerScore}</div><div>${names.ai}: ${aiScore}</div>`;
  }
  if (winner) {
    if (playerScore > aiScore) winner.textContent = `🏆 ¡${names.player} gana!`;
    else if (aiScore > playerScore) winner.textContent = `🤖 ¡${names.ai} gana!`;
    else winner.textContent = '🤝 EMPATE';
  }
  el.classList.remove('hidden');
  el.setAttribute('aria-hidden', 'false');
}

export function hideMatchEndOverlay(): void {
  const el = document.getElementById(END_OVERLAY_ID);
  if (!el) return;
  el.classList.add('hidden');
  el.setAttribute('aria-hidden', 'true');
}

/* ─── Match-aware AI planner ─────────────────────────────────────────── */

const MATCH_POWER_CAP = 0.16;
const MATCH_POWER_SOFT = 0.11;
const MATCH_POWER_REPOSITION = 0.07;
const AIM_SAMPLES = 9;
const AIM_SPREAD_RAD = 0.55;

/**
 * L4 match AI: knows target color, prefers those marbles nearer the channel,
 * samples aims toward the channel, discards obvious open-edge suicide lines,
 * adds human-like noise. Uses the same dir/power shape as planAIShot → startThrow.
 */
export function planMatchAIShot(
  shooter: MarbleEntity,
  field: MarbleEntity[],
): AIShotPlan {
  const target = getTargetColor();
  const sx = shooter.body.position.x;
  const sz = shooter.body.position.z;
  const hole = l4HoleCentersLocal()[0]!;
  const deskOuter = L4_MAT_HALF + L4_CHANNEL_W;

  const onMat = field.filter(isPlayableOnMat);
  const colorTargets = onMat.filter((m) => marbleColorTag(m) === target);
  // Never pick a random non-target when target-color marbles exist
  const pool =
    colorTargets.length > 0
      ? colorTargets
      : onMat.length > 0
        ? onMat
        : field.filter((m) => m.active && m.mesh.visible && !isMarbleInLoop(m));

  type Cand = {
    score: number;
    dirX: number;
    dirZ: number;
    power01: number;
    marble: MarbleEntity;
  };
  const cands: Cand[] = [];

  for (const m of pool) {
    const mx = m.body.position.x;
    const mz = m.body.position.z;
    const isTarget = marbleColorTag(m) === target;

    // Push toward nearest channel lip (outward from mat center)
    const toW = Math.abs(-L4_MAT_HALF - mx);
    const toE = Math.abs(L4_MAT_HALF - mx);
    const toN = Math.abs(-L4_MAT_HALF - mz);
    const toS = Math.abs(L4_MAT_HALF - mz);
    const nearest = Math.min(toW, toE, toN, toS);
    let ox = 0;
    let oz = 0;
    if (nearest === toW) ox = -1;
    else if (nearest === toE) ox = 1;
    else if (nearest === toN) oz = -1;
    else oz = 1;

    // Prefer SW hole when marble is in that half / close to both W+S lips
    const distToHole = Math.hypot(mx - hole.x, mz - hole.z);
    if (
      distToHole < L4_MAT_HALF * 1.85 ||
      (toW < L4_MAT_HALF * 0.85 && toS < L4_MAT_HALF * 0.85)
    ) {
      const hx = hole.x - mx;
      const hz = hole.z - mz;
      const hl = Math.hypot(hx, hz) || 1;
      ox = ox * 0.4 + (hx / hl) * 0.6;
      oz = oz * 0.4 + (hz / hl) * 0.6;
    }
    const ol = Math.hypot(ox, oz) || 1;
    ox /= ol;
    oz /= ol;

    const channelProx = 1 - Math.min(1, nearest / (L4_MAT_HALF + 1e-6));
    const toM = Math.hypot(mx - sx, mz - sz) || 1;
    const proxShooter = 1 - Math.min(1, toM / (L4_MAT_HALF * 2.2));

    // Ideal aim: through marble toward channel
    const aimPush = MARBLE_RADIUS * 0.4;
    const atx = mx + ox * aimPush;
    const atz = mz + oz * aimPush;
    const baseAng = Math.atan2(atz - sz, atx - sx);

    for (let i = 0; i < AIM_SAMPLES; i++) {
      const t = i / Math.max(1, AIM_SAMPLES - 1);
      const spread = (t - 0.5) * AIM_SPREAD_RAD;
      const ang = baseAng + spread;
      let dx = Math.cos(ang);
      let dz = Math.sin(ang);

      // Must roughly point at the marble (hit it, not shoot past randomly)
      const hitAlign = dx * ((mx - sx) / toM) + dz * ((mz - sz) / toM);
      if (hitAlign < 0.28) continue;

      const channelAlign = dx * ox + dz * oz;

      // Edge danger heuristic — open west/south desk borders are intentional risk
      const look = L4_MAT_HALF * 0.85;
      const predX = sx + dx * look;
      const predZ = sz + dz * look;
      const farX = sx + dx * look * 1.55;
      const farZ = sz + dz * look * 1.55;

      const towardOpenWest =
        dx < -0.35 &&
        (predX < L4_DESK_BOUNDS.minX + 0.12 || farX < L4_DESK_BOUNDS.minX + 0.05);
      const towardOpenSouth =
        dz > 0.35 &&
        (predZ > L4_DESK_BOUNDS.maxZ - 0.12 || farZ > L4_DESK_BOUNDS.maxZ - 0.05);
      const pastAnyRim =
        predX < L4_DESK_BOUNDS.minX + 0.02 ||
        predX > L4_DESK_BOUNDS.maxX - 0.02 ||
        predZ < L4_DESK_BOUNDS.minZ + 0.02 ||
        predZ > L4_DESK_BOUNDS.maxZ - 0.02;
      const rimOutward =
        (Math.abs(sx) > deskOuter * 0.5 && Math.sign(dx) === Math.sign(sx) ? 1 : 0) +
        (Math.abs(sz) > deskOuter * 0.5 && Math.sign(dz) === Math.sign(sz) ? 1 : 0);

      // Discard obvious suicide aims straight off open edges
      if (towardOpenWest || towardOpenSouth) continue;
      if (pastAnyRim && rimOutward > 0) continue;

      let edgePenalty = rimOutward * 1.6;
      if (Math.abs(predX) > deskOuter * 1.05 || Math.abs(predZ) > deskOuter * 1.05) {
        edgePenalty += 1.1;
      }

      const score =
        (isTarget ? 3.0 : 0.15) +
        channelProx * 1.55 +
        channelAlign * 1.35 +
        hitAlign * 1.0 +
        proxShooter * 0.7 -
        edgePenalty +
        (Math.random() - 0.5) * 0.4; // imperfect / human-like

      const softIdeal =
        MATCH_POWER_SOFT + Math.min(0.045, toM / (L4_MAT_HALF * 10));
      const power01 = Math.max(
        0.06,
        Math.min(MATCH_POWER_CAP, softIdeal + (Math.random() - 0.5) * 0.03),
      );

      cands.push({ score, dirX: dx, dirZ: dz, power01, marble: m });
    }
  }

  if (cands.length === 0) {
    // Safe fallback: soft channel_out on the filtered pool (still not random field
    // when targets exist — pool is already filtered).
    const fallbackPool = pool.length > 0 ? pool : field;
    const plan = planAIShot(shooter, fallbackPool, 4, 'channel_out');
    // Extra safety: if aim still points hard off open west/south, nudge centerward
    const riskWest = plan.dirX < -0.55 && sx < 0;
    const riskSouth = plan.dirZ > 0.55 && sz > 0;
    if (riskWest || riskSouth) {
      const toCx = -sx || 0.05;
      const toCz = -sz || -0.05;
      const cl = Math.hypot(toCx, toCz) || 1;
      return {
        dirX: toCx / cl,
        dirZ: toCz / cl,
        power01: MATCH_POWER_REPOSITION,
      };
    }
    return plan;
  }

  cands.sort((a, b) => b.score - a.score);
  // Usually best; sometimes 2nd/3rd (suboptimal target / slight miss)
  let pickIdx = 0;
  const r = Math.random();
  if (r > 0.78 && cands.length > 1) pickIdx = 1;
  if (r > 0.93 && cands.length > 2) pickIdx = 2;
  const pick = cands[pickIdx]!;

  // Small aim noise so it can "try and miss" without becoming random
  const nAmp = 0.055;
  let dirX = pick.dirX + (Math.random() * 2 - 1) * nAmp;
  let dirZ = pick.dirZ + (Math.random() * 2 - 1) * nAmp;
  const len = Math.hypot(dirX, dirZ) || 1;
  dirX /= len;
  dirZ /= len;

  return { dirX, dirZ, power01: pick.power01 };
}
