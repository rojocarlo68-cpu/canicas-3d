/**
 * L4 reversible color-target experiment.
 *
 * When ENABLE_COLOR_TARGET_EXPERIMENT is false, call sites must no-op and L4
 * hole elimination/scoring behaves exactly as before this PR.
 *
 * Flow (flag on): MAT → CHANNEL → SW HOLE → under-desk loop → return hatch on mat.
 * Points awarded on hole entry if marble colorTag matches getTargetColor().
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import {
  MARBLE_RADIUS,
  MARBLE_REST_Y,
  PLAY_SURFACE_Y,
} from './constants';
import {
  L4_MAT_HALF,
  L4_PIPE_R,
  L4_ROOM_FLOOR_Y,
  l4HoleCentersLocal,
  l4IsChannelOrHoleXZ,
  l4MarbleRestY,
  type OfficeDeskBuild,
} from './officeDesk';
import type { MarbleDesign, MarbleEntity } from './marbles';

/** Set false to restore prior L4 hole eliminate/score behavior (no HUD, no loop). */
export const ENABLE_COLOR_TARGET_EXPERIMENT = true;

export type ColorTag = 'rojo' | 'azul' | 'verde' | 'amarillo' | 'otro';

/** Playable match target colors (excludes 'otro'). */
export type PlayableColorTag = Exclude<ColorTag, 'otro'>;

const PLAYABLE_TARGET_COLORS: PlayableColorTag[] = [
  'rojo',
  'azul',
  'verde',
  'amarillo',
];

/**
 * Current target color for the color-target experiment / match.
 * Randomized once at match start (does NOT change mid-match or after each point).
 */
let currentTargetColor: PlayableColorTag = 'rojo';

export function getTargetColor(): PlayableColorTag {
  return currentTargetColor;
}

/** Pick a fresh random target for the whole match. */
export function randomizeTargetColor(): PlayableColorTag {
  const i = Math.floor(Math.random() * PLAYABLE_TARGET_COLORS.length);
  currentTargetColor = PLAYABLE_TARGET_COLORS[i]!;
  return currentTargetColor;
}

export type SideScorer = 'player' | 'ai';

export type ColorTargetScoreInfo = {
  scorer: SideScorer | null;
  tag: ColorTag;
  marble: MarbleEntity;
};

type ScoreHook = (info: ColorTargetScoreInfo) => void;
let scoreHook: ScoreHook | null = null;

/** Match mode (or tests) can claim +1 awards; when null, global experiment points are used. */
export function setColorTargetScoreHook(hook: ScoreHook | null): void {
  scoreHook = hook;
}

const LOOP_DURATION_S = 1.55;
const HUD_ID = 'l4-color-target-hud';

type LoopState = {
  marble: MarbleEntity;
  t0: number;
  duration: number;
  path: THREE.Vector3[];
  savedFilterGroup: number;
  savedFilterMask: number;
  /** Side that took the shot which caused hole entry — attribute score by this, not current turn. */
  scorer: SideScorer | null;
  onComplete?: () => void;
};

let points = 0;
let hudEl: HTMLElement | null = null;
let visualRoot: THREE.Group | null = null;
const looping = new Map<MarbleEntity, LoopState>();
/** Marbles that already scored for the current hole→loop transit. */
const scoredThisTransit = new Set<MarbleEntity>();

export function isColorTargetExperimentActive(sceneLevel: number): boolean {
  return ENABLE_COLOR_TARGET_EXPERIMENT && sceneLevel === 4;
}

export function getExperimentPoints(): number {
  return points;
}

export function resetExperimentPoints(): void {
  points = 0;
  updateExperimentPoints();
}

export function isMarbleInLoop(marble: MarbleEntity): boolean {
  return looping.has(marble);
}

/** True while any marble is in under-desk kinematic loop transit. */
export function hasActiveLoopTransits(): boolean {
  return looping.size > 0;
}

export function shouldInterceptL4Hole(marble: MarbleEntity): boolean {
  if (!ENABLE_COLOR_TARGET_EXPERIMENT) return false;
  if (!marble.active) return false;
  if (marble.owner !== 'field') return false;
  if (looping.has(marble)) return false;
  return true;
}

export function marbleColorTag(marble: MarbleEntity): ColorTag {
  return (marble.design.colorTag ?? inferColorTag(marble.design.id)) as ColorTag;
}

function inferColorTag(id: string): ColorTag {
  if (id.includes('roja') || id.includes('rojo') || id === 'ojo-gato') return 'rojo';
  if (id.includes('azul')) return 'azul';
  if (id.includes('verde')) return 'verde';
  if (id.includes('amarill') || id.includes('ambar') || id.includes('naranja')) return 'amarillo';
  return 'otro';
}

export function mountExperimentHUD(): void {
  if (!ENABLE_COLOR_TARGET_EXPERIMENT) return;
  let el = document.getElementById(HUD_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = HUD_ID;
    el.className = 'l4-color-target-hud l4-ct-chip';
    const host = document.getElementById('hud') ?? document.body;
    host.appendChild(el);
  }
  hudEl = el;
  updateExperimentPoints();
}

export function updateExperimentPoints(): void {
  if (!hudEl) hudEl = document.getElementById(HUD_ID);
  if (!hudEl) return;
  const color = getTargetColor();
  const label =
    color === 'rojo'
      ? 'ROJO'
      : color === 'azul'
        ? 'AZUL'
        : color === 'verde'
          ? 'VERDE'
          : color === 'amarillo'
            ? 'AMARILLO'
            : 'OTRO';
  hudEl.className = 'l4-color-target-hud l4-ct-chip';
  hudEl.innerHTML = `
    <div class="l4-ct-chip-line">🎯 <span class="l4-ct-color l4-ct-${color}">${label}</span>
      <span class="l4-ct-chip-pts">${points}</span></div>
  `;
  hudEl.classList.remove('hidden');
}

export function hideExperimentHUD(): void {
  const el = document.getElementById(HUD_ID);
  if (el) el.classList.add('hidden');
}

/**
 * Discrete under-desk tube + return hatch on the mat (NE interior).
 * Minimal visuals — does not redesign the desk.
 */
export function mountExperimentVisuals(
  scene: THREE.Scene,
  desk: OfficeDeskBuild | null,
): void {
  if (!ENABLE_COLOR_TARGET_EXPERIMENT) return;
  disposeExperimentVisuals(scene);
  const root = new THREE.Group();
  root.name = 'l4ColorTargetVisuals';

  const hole = desk?.holeCenters[0] ?? l4HoleCentersLocal()[0]!;
  const exit = getReturnHatchXZ();

  // Thin dark pipe under the left desk slab following the loop polyline
  const pts = buildLoopWorldPath(hole.x, hole.z, exit.x, exit.z);
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.35);
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 48, MARBLE_RADIUS * 1.15, 8, false),
    new THREE.MeshStandardMaterial({
      color: 0x1a100c,
      roughness: 0.92,
      metalness: 0.05,
      transparent: true,
      opacity: 0.85,
    }),
  );
  tube.castShadow = false;
  tube.receiveShadow = false;
  root.add(tube);

  // Return hatch on mat (dark circle, flush)
  const hatchY = PLAY_SURFACE_Y + 0.0008;
  const hatch = new THREE.Mesh(
    new THREE.CircleGeometry(MARBLE_RADIUS * 1.55, 24),
    new THREE.MeshBasicMaterial({ color: 0x0a0604 }),
  );
  hatch.rotation.x = -Math.PI / 2;
  hatch.position.set(exit.x, hatchY, exit.z);
  root.add(hatch);

  const rim = new THREE.Mesh(
    new THREE.RingGeometry(MARBLE_RADIUS * 1.5, MARBLE_RADIUS * 1.85, 24),
    new THREE.MeshStandardMaterial({
      color: 0x2a1810,
      roughness: 0.9,
      metalness: 0,
    }),
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.set(exit.x, hatchY + 0.0003, exit.z);
  root.add(rim);

  scene.add(root);
  visualRoot = root;
}

export function disposeExperimentVisuals(scene?: THREE.Scene): void {
  if (!visualRoot) return;
  const parent = scene ?? visualRoot.parent;
  if (parent) parent.remove(visualRoot);
  visualRoot.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material;
    if (mat) {
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else (mat as THREE.Material).dispose();
    }
  });
  visualRoot = null;
}

/** NE interior of mat — clearly not center pop-in. */
export function getReturnHatchXZ(): { x: number; z: number } {
  return {
    x: L4_MAT_HALF * 0.42,
    z: -L4_MAT_HALF * 0.38,
  };
}

function buildLoopWorldPath(
  holeX: number,
  holeZ: number,
  exitX: number,
  exitZ: number,
): THREE.Vector3[] {
  const underY = Math.min(PLAY_SURFACE_Y - L4_PIPE_R - 0.06, L4_ROOM_FLOOR_Y + 0.12);
  const midY = PLAY_SURFACE_Y - L4_PIPE_R * 0.35;
  // Dive down SW hole → under left slab U-loop → rise at return hatch
  return [
    new THREE.Vector3(holeX, PLAY_SURFACE_Y - L4_PIPE_R + MARBLE_RADIUS, holeZ),
    new THREE.Vector3(holeX, underY + 0.04, holeZ),
    new THREE.Vector3(holeX - 0.08, underY, holeZ + 0.02),
    new THREE.Vector3(holeX - 0.05, underY, -0.05),
    new THREE.Vector3(0.05, underY, -0.12),
    new THREE.Vector3(exitX * 0.55, underY + 0.02, exitZ * 0.7),
    new THREE.Vector3(exitX, midY, exitZ),
    new THREE.Vector3(exitX, MARBLE_REST_Y, exitZ),
  ];
}

/**
 * Start under-desk loop transit. Awards +1 if color matches target (on hole entry).
 * Marble stays active / in field list; body becomes kinematic until exit.
 */
export function beginLoopTransit(
  marble: MarbleEntity,
  desk: OfficeDeskBuild | null,
  _scene: THREE.Scene,
  onComplete?: () => void,
  scorer: SideScorer | null = null,
): void {
  if (!ENABLE_COLOR_TARGET_EXPERIMENT) return;
  if (looping.has(marble)) return;

  const tag = marbleColorTag(marble);
  const resolvedScorer = scorer;
  if (tag === getTargetColor() && !scoredThisTransit.has(marble)) {
    scoredThisTransit.add(marble);
    if (scoreHook) {
      // Match mode (or other layer) owns attribution / HUD
      scoreHook({ scorer: resolvedScorer, tag, marble });
    } else {
      points += 1;
      updateExperimentPoints();
    }
  }
  // Allow scoring again on a later hole entry after they return
  // (clear after complete — see finishLoop)

  const hole = desk?.holeCenters[0] ?? l4HoleCentersLocal()[0]!;
  const exit = getReturnHatchXZ();
  const path = buildLoopWorldPath(hole.x, hole.z, exit.x, exit.z);

  const body = marble.body;
  const savedFilterGroup = body.collisionFilterGroup;
  const savedFilterMask = body.collisionFilterMask;
  body.velocity.setZero();
  body.angularVelocity.setZero();
  body.type = CANNON.Body.KINEMATIC;
  body.collisionResponse = false;
  body.collisionFilterGroup = 0;
  body.collisionFilterMask = 0;
  body.wakeUp();
  marble.mesh.visible = true;

  looping.set(marble, {
    marble,
    t0: performance.now(),
    duration: LOOP_DURATION_S * 1000,
    path,
    savedFilterGroup,
    savedFilterMask,
    scorer: resolvedScorer,
    onComplete,
  });
}

/** Advance all in-loop marbles; call once per frame from Game.update. */
export function updateLoopTransits(dt: number, fieldMarbles?: MarbleEntity[]): void {
  if (!ENABLE_COLOR_TARGET_EXPERIMENT || looping.size === 0) return;
  const now = performance.now();
  const done: MarbleEntity[] = [];
  for (const [m, st] of looping) {
    const u = Math.min(1, (now - st.t0) / st.duration);
    const eased = u * u * (3 - 2 * u); // smoothstep
    const pos = samplePolyline(st.path, eased);
    const body = m.body;
    body.position.set(pos.x, pos.y, pos.z);
    body.previousPosition.copy(body.position);
    if (body.interpolatedPosition) body.interpolatedPosition.copy(body.position);
    body.velocity.setZero();
    // Gentle spin while traveling
    body.angularVelocity.set(1.8 * dt * 60, 2.4 * dt * 60, 0.6 * dt * 60);
    m.mesh.position.set(pos.x, pos.y, pos.z);
    if (u >= 1) done.push(m);
  }
  for (const m of done) finishLoop(m, fieldMarbles);
}

function samplePolyline(pts: THREE.Vector3[], u: number): THREE.Vector3 {
  if (pts.length === 0) return new THREE.Vector3();
  if (pts.length === 1) return pts[0]!.clone();
  const lengths: number[] = [0];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += pts[i]!.distanceTo(pts[i - 1]!);
    lengths.push(total);
  }
  if (total < 1e-8) return pts[pts.length - 1]!.clone();
  const target = u * total;
  for (let i = 1; i < pts.length; i++) {
    if (target <= lengths[i]!) {
      const seg = lengths[i]! - lengths[i - 1]!;
      const local = seg > 1e-8 ? (target - lengths[i - 1]!) / seg : 1;
      return new THREE.Vector3().lerpVectors(pts[i - 1]!, pts[i]!, local);
    }
  }
  return pts[pts.length - 1]!.clone();
}

/**
 * Find a free mat spot near the return hatch so loop exits never spawn
 * overlapping another field marble (root cause of hatch stacking / ghosting).
 */
function findClearHatchExit(
  self: MarbleEntity,
  fieldMarbles?: MarbleEntity[],
): { x: number; z: number; y: number } {
  const exit = getReturnHatchXZ();
  const minD = MARBLE_RADIUS * 2.08;
  const margin = MARBLE_RADIUS * 2.5;
  const candidates: { x: number; z: number }[] = [{ x: exit.x, z: exit.z }];
  for (let ring = 1; ring <= 7; ring++) {
    const r = MARBLE_RADIUS * 2.15 * ring;
    const n = 6 + ring * 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + ring * 0.2;
      candidates.push({ x: exit.x + Math.cos(a) * r, z: exit.z + Math.sin(a) * r });
    }
  }
  const others = fieldMarbles ?? [];
  for (const c of candidates) {
    if (Math.abs(c.x) > L4_MAT_HALF - margin) continue;
    if (Math.abs(c.z) > L4_MAT_HALF - margin) continue;
    if (l4IsChannelOrHoleXZ(c.x, c.z)) continue;
    let clear = true;
    for (const o of others) {
      if (o === self || !o.active || !o.mesh.visible) continue;
      if (looping.has(o)) continue;
      const d = Math.hypot(o.body.position.x - c.x, o.body.position.z - c.z);
      if (d < minD) {
        clear = false;
        break;
      }
    }
    if (!clear) continue;
    const y = l4MarbleRestY(c.x, c.z) ?? MARBLE_REST_Y;
    return { x: c.x, z: c.z, y };
  }
  // Last resort: hatch + random planar nudge (still better than perfect stack)
  const ang = Math.random() * Math.PI * 2;
  const rad = MARBLE_RADIUS * (2.2 + Math.random() * 3);
  const x = exit.x + Math.cos(ang) * rad;
  const z = exit.z + Math.sin(ang) * rad;
  return { x, z, y: l4MarbleRestY(x, z) ?? MARBLE_REST_Y };
}

function finishLoop(marble: MarbleEntity, fieldMarbles?: MarbleEntity[]): void {
  const st = looping.get(marble);
  if (!st) return;
  looping.delete(marble);

  const spot = findClearHatchExit(marble, fieldMarbles);
  const body = marble.body;
  body.position.set(spot.x, spot.y, spot.z);
  body.previousPosition.copy(body.position);
  if (body.interpolatedPosition) body.interpolatedPosition.copy(body.position);
  body.velocity.setZero();
  body.angularVelocity.setZero();
  body.type = CANNON.Body.DYNAMIC;
  body.collisionResponse = true;
  // Field marbles only enter the loop — restore solid default world filters
  // (never leave mask/group at 0 from kinematic transit).
  body.collisionFilterGroup = 1;
  body.collisionFilterMask = -1;
  body.wakeUp();
  // Soft settle — tiny nudge so they don't rest perfectly stacked
  body.velocity.set((Math.random() - 0.5) * 0.05, 0.01, (Math.random() - 0.5) * 0.05);
  marble.mesh.visible = true;
  marble.mesh.position.set(spot.x, spot.y, spot.z);
  marble.active = true;

  scoredThisTransit.delete(marble);
  st.onComplete?.();
}

export function disposeExperiment(scene?: THREE.Scene): void {
  // Snap any in-transit marbles back to hatch before clearing
  for (const m of [...looping.keys()]) {
    finishLoop(m);
  }
  looping.clear();
  scoredThisTransit.clear();
  scoreHook = null;
  disposeExperimentVisuals(scene);
  hideExperimentHUD();
  points = 0;
}

/** Exact mixed field for L4 experiment: 5 rojo + 5 azul + 5 verde + 5 amarillo. */
export const EXPERIMENT_FIELD_COUNT = 20;

const EXPERIMENT_COLORS: Array<Exclude<ColorTag, 'otro'>> = ['rojo', 'azul', 'verde', 'amarillo'];

const PREFERRED_IDS: Record<Exclude<ColorTag, 'otro'>, string[]> = {
  rojo: ['roja-cristal', 'ojo-gato'],
  azul: ['azul-cristal', 'azul-blanco'],
  verde: ['verde-cristal', 'verde-bosque'],
  amarillo: ['amarillo-cristal', 'ambar', 'amarilla', 'naranja-swirl'],
};

/** In-place / copy shuffle — call each match start so colors are not clustered. */
export function shuffleExperimentFieldDesigns<T>(arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

function poolForTag(tagged: MarbleDesign[], tag: Exclude<ColorTag, 'otro'>): MarbleDesign[] {
  const pool = tagged.filter((d) => d.colorTag === tag);
  const preferred = PREFERRED_IDS[tag]
    .map((id) => pool.find((d) => d.id === id))
    .filter((d): d is MarbleDesign => !!d);
  const rest = pool.filter((d) => !PREFERRED_IDS[tag].includes(d.id));
  const ordered = [...preferred, ...rest];
  return ordered;
}

/**
 * Builds a shuffled list of EXPERIMENT_FIELD_COUNT designs (5 of each target color).
 * Call again each match start so colors are not clustered / order refreshes.
 */
export function createL4ExperimentFieldDesigns(
  base: MarbleDesign[],
): MarbleDesign[] {
  const tagged = base.map((d) => ({
    ...d,
    colorTag: (d.colorTag ?? inferColorTag(d.id)) as ColorTag,
  }));

  const out: MarbleDesign[] = [];
  const perColor = EXPERIMENT_FIELD_COUNT / EXPERIMENT_COLORS.length; // 5
  for (const tag of EXPERIMENT_COLORS) {
    const pool = poolForTag(tagged, tag);
    if (pool.length === 0) {
      // Should not happen with createFieldDesigns(); skip rather than invent physics-breaking blanks.
      continue;
    }
    for (let i = 0; i < perColor; i++) {
      const src = pool[i % pool.length]!;
      out.push({
        ...src,
        id: `${src.id}`,
        colorTag: tag,
      });
    }
  }
  return shuffleExperimentFieldDesigns(out);
}
