/**
 * L4 reversible competitive MATCH MODE (PLAYER vs CPU) on top of the
 * color-target experiment.
 *
 * When ENABLE_MATCH_MODE is false (or color experiment is off), call sites
 * no-op and L4 behaves exactly like today's color-target free-play experiment.
 *
 * Scoring: +1 to the side whose shot sent a TARGET_COLOR marble into the hole
 * (scorer stored at beginLoopTransit). Wrong color → 0. No penalties.
 *
 * End: when playable field marbles currently on the mat surface
 * (not channel / loop / fallen / inactive) are fewer than MIN_PLAYABLE_ON_MAT.
 */
import {
  ENABLE_COLOR_TARGET_EXPERIMENT,
  TARGET_COLOR,
  marbleColorTag,
  isMarbleInLoop,
  setColorTargetScoreHook,
  type SideScorer,
} from './l4ColorTargetExperiment';
import { L4_MAT_HALF, l4IsChannelOrHoleXZ } from './officeDesk';
import { MARBLE_RADIUS, PLAY_SURFACE_Y } from './constants';
import type { MarbleEntity } from './marbles';

/** Master switch — set false to restore prior color-target experiment only. */
export const ENABLE_MATCH_MODE = true;

/**
 * Match ends when playable-on-mat field count drops below this.
 * Need at least 2 so there is still something to hit / enough game left.
 * Excludes channel, loop, fallen, and inactive marbles.
 */
export const MIN_PLAYABLE_ON_MAT = 2;

const HUD_ID = 'l4-color-target-hud';
const END_OVERLAY_ID = 'l4-match-end-overlay';

let playerPoints = 0;
let aiPoints = 0;
let matchOver = false;
let turnSide: SideScorer = 'player';
let onReplay: (() => void) | null = null;
let onMenu: (() => void) | null = null;

export function isMatchModeActive(sceneLevel: number): boolean {
  return ENABLE_MATCH_MODE && ENABLE_COLOR_TARGET_EXPERIMENT && sceneLevel === 4;
}

export function getMatchScores(): { player: number; ai: number } {
  return { player: playerPoints, ai: aiPoints };
}

export function isMatchOver(): boolean {
  return matchOver;
}

export function resetMatchScores(): void {
  playerPoints = 0;
  aiPoints = 0;
  matchOver = false;
  refreshMatchHUD(turnSide);
}

export function awardMatchPoint(scorer: SideScorer | null): void {
  if (matchOver) return;
  if (scorer === 'player') playerPoints += 1;
  else if (scorer === 'ai') aiPoints += 1;
  // null scorer → no award (should be rare)
  refreshMatchHUD(turnSide);
}

/** Active field marble resting on the mat surface (not channel/hole/loop/fallen). */
export function isPlayableOnMat(marble: MarbleEntity): boolean {
  if (!marble.active || !marble.mesh.visible) return false;
  if (isMarbleInLoop(marble)) return false;
  const { x, y, z } = marble.body.position;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
  if (Math.abs(x) > L4_MAT_HALF + 1e-4 || Math.abs(z) > L4_MAT_HALF + 1e-4) return false;
  if (l4IsChannelOrHoleXZ(x, z)) return false;
  // Below mat support → fallen into trough / floor path
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

export function shouldEndMatch(field: MarbleEntity[]): boolean {
  return countPlayableOnMat(field) < MIN_PLAYABLE_ON_MAT;
}

/**
 * CPU target pool for L4 match:
 * 1) TARGET_COLOR playable on mat
 * 2) else any playable on mat
 * 3) else any active non-loop field marble (still attempt a shot)
 */
export function fieldPoolForMatchAI(field: MarbleEntity[]): MarbleEntity[] {
  const onMat = field.filter(isPlayableOnMat);
  const targets = onMat.filter((m) => marbleColorTag(m) === TARGET_COLOR);
  if (targets.length > 0) return targets;
  if (onMat.length > 0) return onMat;
  return field.filter((m) => m.active && m.mesh.visible && !isMarbleInLoop(m));
}

function targetLabel(): string {
  return TARGET_COLOR === 'rojo'
    ? 'ROJO'
    : TARGET_COLOR === 'azul'
      ? 'AZUL'
      : TARGET_COLOR === 'verde'
        ? 'VERDE'
        : TARGET_COLOR === 'amarillo'
          ? 'AMARILLO'
          : 'OTRO';
}

export function refreshMatchHUD(turn: SideScorer): void {
  turnSide = turn;
  if (!ENABLE_MATCH_MODE) return;
  let el = document.getElementById(HUD_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = HUD_ID;
    el.className = 'l4-color-target-hud';
    const host = document.getElementById('hud') ?? document.body;
    host.appendChild(el);
  }
  const turnText = turn === 'player' ? '🎮 TU TURNO' : '🤖 TURNO DE LA CPU';
  el.innerHTML = `
    <div class="l4-ct-title">🎯 OBJETIVO</div>
    <div class="l4-ct-color l4-ct-${TARGET_COLOR}">${targetLabel()}</div>
    <div class="l4-ct-match-scores">
      <div class="l4-ct-side">JUGADOR: ${playerPoints}</div>
      <div class="l4-ct-side">CPU: ${aiPoints}</div>
    </div>
    <div class="l4-ct-turn ${turn === 'player' ? 'l4-ct-turn-player' : 'l4-ct-turn-ai'}">${turnText}</div>
  `;
  el.classList.remove('hidden');
}

export function mountMatchMode(handlers: {
  onReplay: () => void;
  onMenu: () => void;
}): void {
  if (!ENABLE_MATCH_MODE || !ENABLE_COLOR_TARGET_EXPERIMENT) return;
  onReplay = handlers.onReplay;
  onMenu = handlers.onMenu;
  matchOver = false;
  playerPoints = 0;
  aiPoints = 0;
  setColorTargetScoreHook((info) => {
    awardMatchPoint(info.scorer);
  });
  refreshMatchHUD('player');
  ensureEndOverlay();
  hideMatchEndOverlay();
}

export function disposeMatchMode(): void {
  setColorTargetScoreHook(null);
  hideMatchEndOverlay();
  matchOver = false;
  playerPoints = 0;
  aiPoints = 0;
  onReplay = null;
  onMenu = null;
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

export function showMatchEndOverlay(player: number, ai: number): void {
  matchOver = true;
  const el = ensureEndOverlay();
  const scores = el.querySelector('#l4-match-end-scores');
  const winner = el.querySelector('#l4-match-end-winner');
  if (scores) {
    scores.innerHTML = `<div>JUGADOR: ${player}</div><div>CPU: ${ai}</div>`;
  }
  if (winner) {
    if (player > ai) winner.textContent = '🏆 VICTORIA';
    else if (ai > player) winner.textContent = '🤖 VICTORIA DE LA CPU';
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
