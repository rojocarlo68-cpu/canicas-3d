/**
 * L4 Channel Rescue / Conversion / Zombie experiment (reversible).
 *
 * Disable: set ENABLE_L4_CHANNEL_RESCUE_EXPERIMENT = false
 * Full revert: flag off, or git revert of experiment commit(s).
 *
 * When inactive, call sites no-op — L4 matches baseline HEAD.
 *
 * Flow: MAT → CHANNEL (in_channel, DYNAMIC, cruise 0.16 (exp) / 0.32 (baseline) via applyL4ChannelDrain)
 * → hit converts to hitter team OR unrecovered SW hole → under-desk LOOP
 * → return as converted healthy OR zombie (skull).
 *
 * Scoreboard (#score-player / #score-ai) = healthy counts (start 10/10).
 * No money awards. No new HUD. Open edges: healthy −1 (not zombie).
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { MARBLE_RADIUS, MARBLE_REST_Y, PLAY_SURFACE_Y } from './constants';
import { clampCamAboveSurface, LOOK_MIN_Y } from './cameraDirector';
import {
  L4_MAT_HALF,
  L4_PIPE_R,
  L4_ROOM_FLOOR_Y,
  l4HoleCentersLocal,
  l4MarbleRestY,
  l4ChannelLateral,
  type OfficeDeskBuild,
  applyL4FieldMarbleCollisionFilter,
} from './officeDesk';
import {
  l4ChannelArcLengthFromSW,
  l4ChannelPointAtArcLength,
  l4ChannelCenterlinePerimeter,
} from './officeDesk';
import { playRescueChime } from './marbleSounds';
import type { MarbleDesign, MarbleEntity, MarbleOwner } from './marbles';
import type { ParticleFX } from './particles';

/** Master switch — false restores baseline L4 hole-knockout scoring. */
export const ENABLE_L4_CHANNEL_RESCUE_EXPERIMENT = true;

export type TeamSide = 'player' | 'ai';
export type ChannelState = 'none' | 'in_channel' | 'in_loop';
export type MarbleRole = 'healthy' | 'zombie';

const LOOP_DURATION_S = 1.55;
const TEAM_FIELD_EACH = 10; // all on mat; selected shooter is one of these (no separate commander)
const CONTACT_COOLDOWN_MS = 180;
const SKULL_CHILD = 'l4ZombieSkull';

type LoopState = {
  marble: MarbleEntity;
  t0: number;
  duration: number;
  path: THREE.Vector3[];
  savedFilterGroup: number;
  savedFilterMask: number;
  exitAs: 'converted' | 'zombie';
  teamAtExit: TeamSide | 'neutral';
};

type RescueSession = {
  opener: TeamSide;
  interventionsDone: number;
};

let visualRoot: THREE.Group | null = null;
const looping = new Map<MarbleEntity, LoopState>();
let rescueSession: RescueSession | null = null;
const contactCoolUntil = new WeakMap<MarbleEntity, number>();
const solidDesignCache = new Map<string, MarbleDesign>();

export function isL4ChannelRescueExperimentActive(sceneLevel: number): boolean {
  return ENABLE_L4_CHANNEL_RESCUE_EXPERIMENT && sceneLevel === 4;
}

export function experimentFieldCount(sceneLevel: number, baseline: number): number {
  if (!isL4ChannelRescueExperimentActive(sceneLevel)) return baseline;
  return TEAM_FIELD_EACH * 2;
}

export function isMarbleInLoop(marble: MarbleEntity): boolean {
  return looping.has(marble);
}

export function hasActiveLoopTransits(): boolean {
  return looping.size > 0 || slides.size > 0;
}

export function getChannelState(m: MarbleEntity): ChannelState {
  return m.channelState ?? 'none';
}

export function getMarbleRole(m: MarbleEntity): MarbleRole {
  return m.role ?? 'healthy';
}

export function isHealthyTeamMarble(m: MarbleEntity): boolean {
  return (
    !!m.active &&
    getMarbleRole(m) === 'healthy' &&
    (m.owner === 'player' || m.owner === 'ai')
  );
}

export function isZombieMarble(m: MarbleEntity): boolean {
  return !!m.active && getMarbleRole(m) === 'zombie';
}

export function countHealthy(
  field: MarbleEntity[],
  shooters: (MarbleEntity | null)[],
  side: TeamSide,
): number {
  // Selected shooters may also live in `field` (no separate commander) — dedupe.
  const seen = new Set<MarbleEntity>();
  let n = 0;
  for (const m of field) {
    if (!isHealthyTeamMarble(m) || m.owner !== side) continue;
    if (seen.has(m)) continue;
    seen.add(m);
    n += 1;
  }
  for (const s of shooters) {
    if (!s || !isHealthyTeamMarble(s) || s.owner !== side) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    n += 1;
  }
  return n;
}

export function syncHealthyScores(
  field: MarbleEntity[],
  playerMarble: MarbleEntity | null,
  aiMarble: MarbleEntity | null,
): { player: number; ai: number } {
  return {
    player: countHealthy(field, [playerMarble, aiMarble], 'player'),
    ai: countHealthy(field, [playerMarble, aiMarble], 'ai'),
  };
}

function shadeHex(hex: string, amt: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, (n >> 16) + amt));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + amt));
  const b = Math.min(255, Math.max(0, (n & 0xff) + amt));
  return `rgb(${r},${g},${b})`;
}

function makeSolidGlassDesign(id: string, name: string, color: string): MarbleDesign {
  const cached = solidDesignCache.get(id);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const s = 256;
  const g = ctx.createRadialGradient(s * 0.35, s * 0.32, s * 0.05, s / 2, s / 2, s * 0.55);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.2, color);
  g.addColorStop(0.75, shadeHex(color, -30));
  g.addColorStop(1, shadeHex(color, -55));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const hl = ctx.createRadialGradient(s * 0.32, s * 0.28, s * 0.02, s * 0.35, s * 0.32, s * 0.42);
  hl.addColorStop(0, 'rgba(255,255,255,0.55)');
  hl.addColorStop(0.35, 'rgba(255,255,255,0.12)');
  hl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hl;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  const design: MarbleDesign = {
    id,
    name,
    material: new THREE.MeshPhysicalMaterial({
      map: tex,
      roughness: 0.12,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      reflectivity: 0.55,
      envMapIntensity: 1,
    }),
  };
  solidDesignCache.set(id, design);
  return design;
}

let zombieSkullTexture: THREE.Texture | null = null;
let zombieSkullTextureLoading = false;
const zombieSkullReadyWaiters: Array<(t: THREE.Texture) => void> = [];

function loadZombieSkullTexture(onReady?: (t: THREE.Texture) => void): void {
  if (zombieSkullTexture) {
    onReady?.(zombieSkullTexture);
    return;
  }
  if (onReady) zombieSkullReadyWaiters.push(onReady);
  if (zombieSkullTextureLoading) return;
  zombieSkullTextureLoading = true;
  const base = (import.meta.env.BASE_URL as string) || '/';
  const loader = new THREE.TextureLoader();
  const apply = (t: THREE.Texture) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.needsUpdate = true;
    zombieSkullTexture = t;
    zombieSkullTextureLoading = false;
    const cached = solidDesignCache.get('zombie-skull');
    if (cached) {
      const mat = cached.material as THREE.MeshPhysicalMaterial;
      mat.map = t;
      mat.color.setHex(0x000000);
      mat.needsUpdate = true;
    }
    const waiters = zombieSkullReadyWaiters.splice(0, zombieSkullReadyWaiters.length);
    for (const w of waiters) w(t);
  };
  loader.load(
    `${base}ui/zombie-skull.webp`,
    apply,
    undefined,
    () => {
      loader.load(`${base}ui/zombie-skull.jpg`, apply, undefined, () => {
        zombieSkullTextureLoading = false;
        zombieSkullReadyWaiters.length = 0;
      });
    },
  );
}

/** Fully black marble; skull image sphere-mapped (asset already has black surround). */
function makeZombieDesign(): MarbleDesign {
  const id = 'zombie-skull';
  const cached = solidDesignCache.get(id);
  if (cached) return cached;
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x000000,
    roughness: 0.58,
    metalness: 0.04,
    clearcoat: 0.35,
    clearcoatRoughness: 0.45,
    emissive: new THREE.Color(0x0a1808),
    emissiveIntensity: 0.12,
  });
  if (zombieSkullTexture) {
    material.map = zombieSkullTexture;
  } else {
    loadZombieSkullTexture((t) => {
      material.map = t;
      material.needsUpdate = true;
    });
  }
  const design: MarbleDesign = {
    id,
    name: 'Zombie',
    material,
  };
  solidDesignCache.set(id, design);
  return design;
}

export function createTeamSolidDesign(side: TeamSide): MarbleDesign {
  if (side === 'player') {
    return makeSolidGlassDesign('team-player-blue', 'Equipo azul', '#1565c0');
  }
  return makeSolidGlassDesign('team-ai-red', 'Equipo rojo', '#c62828');
}

function attachSkullSprite(_mesh: THREE.Mesh): void {
  // Intentionally empty: emoji canvas skull caused main-thread freezes on loop exit.
  // Skull is shown via sphere-mapped texture on a fully black marble instead.
}

function detachSkullSprite(mesh: THREE.Mesh): void {
  const existing = mesh.getObjectByName(SKULL_CHILD);
  if (!existing) return;
  mesh.remove(existing);
  const spr = existing as THREE.Sprite;
  const mat = spr.material as THREE.SpriteMaterial;
  mat.map?.dispose();
  mat.dispose();
}

export function applyTeamAppearance(marble: MarbleEntity, side: TeamSide): void {
  const design = createTeamSolidDesign(side);
  const old = marble.mesh.material;
  marble.mesh.material = design.material.clone();
  if (Array.isArray(old)) old.forEach((x) => x.dispose());
  else (old as THREE.Material).dispose();
  marble.design = design;
  marble.owner = side;
  marble.role = 'healthy';
  marble.team = side;
  detachSkullSprite(marble.mesh);
  // Converted / returning healthy are normal field marbles (no channel bridge).
  applyL4FieldMarbleCollisionFilter(marble.body);
}

export function applyZombieAppearance(marble: MarbleEntity): void {
  const design = makeZombieDesign();
  const old = marble.mesh.material;
  const mat = design.material.clone() as THREE.MeshPhysicalMaterial;
  mat.color.setHex(0x000000);
  if (zombieSkullTexture) mat.map = zombieSkullTexture;
  else {
    loadZombieSkullTexture((t) => {
      mat.map = t;
      mat.needsUpdate = true;
    });
  }
  marble.mesh.material = mat;
  if (Array.isArray(old)) old.forEach((x) => x.dispose());
  else (old as THREE.Material).dispose();
  marble.design = design;
  marble.owner = 'field';
  marble.role = 'zombie';
  marble.team = 'neutral';
  marble.channelState = 'none';
  detachSkullSprite(marble.mesh);
  attachSkullSprite(marble.mesh); // no-op (kept for API stability)
  applyL4FieldMarbleCollisionFilter(marble.body);
  // Stay awake so gentle contacts still generate world.contacts (zombie kills)
  marble.body.allowSleep = false;
  marble.body.wakeUp();
}

export function createExperimentFieldPlan(): { design: MarbleDesign; owner: MarbleOwner }[] {
  const blue = createTeamSolidDesign('player');
  const red = createTeamSolidDesign('ai');
  const out: { design: MarbleDesign; owner: MarbleOwner }[] = [];
  for (let i = 0; i < TEAM_FIELD_EACH; i++) out.push({ design: blue, owner: 'player' });
  for (let i = 0; i < TEAM_FIELD_EACH; i++) out.push({ design: red, owner: 'ai' });
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

export function initExperimentMarble(m: MarbleEntity, owner: MarbleOwner): void {
  m.role = 'healthy';
  m.channelState = 'none';
  (m as MarbleEntity & { experimentConverted?: boolean }).experimentConverted = false;
  m.team = owner === 'player' || owner === 'ai' ? owner : 'neutral';
  if (owner === 'player' || owner === 'ai') applyTeamAppearance(m, owner);
  // Non-shooter team marbles must use field collision (fall into channel). Shooter
  // filter is applied only to playerMarble/aiMarble in Game.
  applyL4FieldMarbleCollisionFilter(m.body);
}

export function mountExperimentVisuals(
  scene: THREE.Scene,
  desk: OfficeDeskBuild | null,
): void {
  if (!ENABLE_L4_CHANNEL_RESCUE_EXPERIMENT) return;
  loadZombieSkullTexture();
  disposeExperimentVisuals(scene);
  const root = new THREE.Group();
  root.name = 'l4ChannelRescueVisuals';
  const hole = desk?.holeCenters[0] ?? l4HoleCentersLocal()[0]!;
  const exit = getReturnHatchXZ();
  const pts = buildLoopWorldPath(hole.x, hole.z, exit.x, exit.z);
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.35);
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 48, MARBLE_RADIUS * 1.15, 8, false),
    new THREE.MeshStandardMaterial({
      color: 0x1a100c,
      roughness: 0.92,
      metalness: 0.05,
      transparent: true,
      opacity: 0.7,
    }),
  );
  tube.castShadow = false;
  tube.receiveShadow = false;
  root.add(tube);
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
    new THREE.MeshStandardMaterial({ color: 0x2a1810, roughness: 0.9, metalness: 0 }),
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
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material;
    if (mat) {
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else (mat as THREE.Material).dispose();
    }
  });
  visualRoot = null;
}

export function getReturnHatchXZ(): { x: number; z: number } {
  return { x: L4_MAT_HALF * 0.42, z: -L4_MAT_HALF * 0.38 };
}

function buildLoopWorldPath(
  holeX: number,
  holeZ: number,
  exitX: number,
  exitZ: number,
): THREE.Vector3[] {
  const underY = Math.min(PLAY_SURFACE_Y - L4_PIPE_R - 0.06, L4_ROOM_FLOOR_Y + 0.12);
  const midY = PLAY_SURFACE_Y - L4_PIPE_R * 0.35;
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

export function isPhysicallyInChannel(m: MarbleEntity): boolean {
  if (!m.active || looping.has(m)) return false;
  const { x, y, z } = m.body.position;
  const lat = l4ChannelLateral(x, z);
  if (lat === null || Math.abs(lat) > L4_PIPE_R * 0.99) return false;
  const localY = y - PLAY_SURFACE_Y;
  if (localY > MARBLE_RADIUS + L4_PIPE_R * 0.12) return false;
  if (localY < -L4_PIPE_R - MARBLE_RADIUS * 4) return false;
  return true;
}

export function markInChannelIfNeeded(m: MarbleEntity, turnSide: TeamSide): void {
  if (!m.active || isZombieMarble(m) || looping.has(m)) return;
  if (slides.has(m)) return; // rescuer being guided into the channel (kinematic glide)
  if (!isHealthyTeamMarble(m)) return;
  if (!isPhysicallyInChannel(m)) {
    if (m.channelState === 'in_channel') {
      m.channelState = 'none';
      rescueRegistered.delete(m);
      // Knocked back onto the mat (rescued/converted stays healthy there): drop the stale flag.
      (m as MarbleEntity & { experimentConverted?: boolean }).experimentConverted = false;
    }
    return;
  }
  if (m.channelState !== 'in_channel') {
    m.channelState = 'in_channel';
    if (m.body.type !== CANNON.Body.DYNAMIC) {
      m.body.type = CANNON.Body.DYNAMIC;
      m.body.collisionResponse = true;
    }
    if (!rescueSession) {
      rescueSession = { opener: turnSide, interventionsDone: 0 };
    }
  }
}

export function hasInChannelMarbles(field: MarbleEntity[]): boolean {
  for (const m of field) {
    if (m.active && m.channelState === 'in_channel' && !looping.has(m)) return true;
  }
  return false;
}

export function planTurnAfterSettle(
  field: MarbleEntity[],
  normalNext: TeamSide,
): { defer: boolean; next: TeamSide } {
  if (!hasInChannelMarbles(field)) {
    rescueSession = null;
    return { defer: false, next: normalNext };
  }
  if (!rescueSession) {
    rescueSession = {
      opener: normalNext === 'player' ? 'ai' : 'player',
      interventionsDone: 0,
    };
  }
  if (rescueSession.interventionsDone === 0) {
    const opp: TeamSide = rescueSession.opener === 'player' ? 'ai' : 'player';
    rescueSession.interventionsDone = 1;
    return { defer: true, next: opp };
  }
  if (rescueSession.interventionsDone === 1) {
    rescueSession.interventionsDone = 2;
    return { defer: true, next: rescueSession.opener };
  }
  return { defer: false, next: normalNext };
}

export function shouldIgnoreForSettle(m: MarbleEntity): boolean {
  return looping.has(m) || m.channelState === 'in_channel';
}

export function shouldBlockSettleMaxForce(field: MarbleEntity[]): boolean {
  return hasInChannelMarbles(field) || hasActiveLoopTransits();
}

export type ContactResult =
  | { kind: 'none' }
  | { kind: 'zombie_kill'; zombie: MarbleEntity; victim: MarbleEntity; victimSide: TeamSide };

/** Zombie touching a healthy team marble (any phase) → victim eliminated. */
export function handleMarbleContact(
  a: MarbleEntity,
  b: MarbleEntity,
  now: number,
): ContactResult {
  const pairs: [MarbleEntity, MarbleEntity][] = [
    [a, b],
    [b, a],
  ];
  for (const [x, y] of pairs) {
    if (
      isZombieMarble(x) &&
      isHealthyTeamMarble(y) &&
      (y.owner === 'player' || y.owner === 'ai')
    ) {
      const cool = contactCoolUntil.get(y) ?? 0;
      if (now < cool) return { kind: 'none' };
      contactCoolUntil.set(y, now + CONTACT_COOLDOWN_MS);
      return {
        kind: 'zombie_kill',
        zombie: x,
        victim: y,
        victimSide: y.owner as TeamSide,
      };
    }
  }
  return { kind: 'none' };
}

// ───────────────────────── Rescuers / interception (Round 6) ─────────────────────────
//
// RESCUER = any marble shot (human flick, intervention flick, or AI shot) while at least one
// healthy marble is traveling in the channel. A rescuer can never become a zombie (hard guard in
// beginLoopTransit/finishLoop) — it rides the channel/loop and exits HEALTHY, own colour.
// Immunity is cleared once it has settled on the mat or exited the loop.
//
// CONTACT = a cannon-es `beginContact` event between the in_channel marble and any healthy team
// marble (queued by Game, processed after world.step). Registered ONCE per channel marble.

export const RESCUE_FLASHES = 3;
const RESCUE_FLASH_ON_S = 0.4;
const RESCUE_FLASH_OFF_S = 0.4;
const RESCUER_MAX_IMMUNITY_MS = 30000;
const GUIDE_SLIDE_S = 0.45;

const rescuers = new Map<MarbleEntity, number>();
const rescueRegistered = new WeakSet<MarbleEntity>();
type Slide = {
  marble: MarbleEntity;
  target: MarbleEntity;
  t0: number;
  from: THREE.Vector3;
  savedGroup: number;
  savedMask: number;
};
const slides = new Map<MarbleEntity, Slide>();
type RescueFx = { t0: number; flashes: number; wasOn: boolean };
const rescueFx = new Map<MarbleEntity, RescueFx>();

export const rescueDebug = {
  contacts: 0,
  rescued: 0,
  converted: 0,
  rescuerZombieBlocked: 0,
  guided: 0,
  eliminations: 0,
  log: [] as { id: number; hitterId: number; kind: 'rescued' | 'converted'; t: number }[],
};

export function isRescuer(m: MarbleEntity): boolean {
  return rescuers.has(m);
}

export function rescuerCount(): number {
  return rescuers.size;
}

export function isGuideSliding(m: MarbleEntity): boolean {
  return slides.has(m);
}

export function rescueFlashesDone(m: MarbleEntity): number {
  return rescueFx.get(m)?.flashes ?? -1;
}

/** Tag the shooter as a rescuer if any healthy marble is in the channel right now. */
export function tagRescuerOnShot(shooter: MarbleEntity, field: MarbleEntity[]): boolean {
  if (!ENABLE_L4_CHANNEL_RESCUE_EXPERIMENT) return false;
  if (!hasInChannelMarbles(field)) return false;
  rescuers.set(shooter, performance.now());
  return true;
}

export type RescueResult =
  | { kind: 'none' }
  | {
      kind: 'rescue';
      channel: MarbleEntity;
      hitter: MarbleEntity;
      prev: TeamSide;
      by: TeamSide;
      same: boolean;
    };

/**
 * Real physics contact (from beginContact) between `a` and `b`. If one is an unregistered
 * in_channel healthy marble and the other a healthy team marble → RESCUED (same team) or
 * CONVERTED (enemy → hitter's team). Registered once; target never becomes a zombie.
 */
export function handleRescueContact(
  a: MarbleEntity,
  b: MarbleEntity,
  desk: OfficeDeskBuild | null,
  allMarbles: MarbleEntity[],
): RescueResult {
  if (!ENABLE_L4_CHANNEL_RESCUE_EXPERIMENT) return { kind: 'none' };
  const pairs: [MarbleEntity, MarbleEntity][] = [
    [a, b],
    [b, a],
  ];
  for (const [x, y] of pairs) {
    if (
      !x.active ||
      !y.active ||
      x.channelState !== 'in_channel' ||
      looping.has(x) ||
      looping.has(y) ||
      !isHealthyTeamMarble(x) ||
      !isHealthyTeamMarble(y) ||
      rescuers.has(x) || // rescuers are already immune — they are not the target
      rescueRegistered.has(x) ||
      slides.has(x)
    ) {
      continue;
    }
    // Two plain channel riders touching each other is convoy traffic, not an interception.
    if (y.channelState === 'in_channel' && !rescuers.has(y)) continue;
    const prev = x.owner as TeamSide;
    const by = y.owner as TeamSide;
    rescueRegistered.add(x);
    rescueDebug.contacts += 1;
    if (prev !== by) {
      applyTeamAppearance(x, by);
      rescueDebug.converted += 1;
    } else {
      rescueDebug.rescued += 1;
    }
    rescueDebug.log.push({
      id: x.body.id,
      hitterId: y.body.id,
      kind: prev === by ? 'rescued' : 'converted',
      t: performance.now(),
    });
    const flagged = x as MarbleEntity & { experimentConverted?: boolean };
    flagged.experimentConverted = true; // → exits the loop HEALTHY (never zombie)
    x.channelState = 'in_channel';
    // Hitter becomes an immune rescuer and is guided into the hole system too.
    rescuers.set(y, performance.now());
    (y as MarbleEntity & { experimentConverted?: boolean }).experimentConverted = true;
    rescueFx.set(x, { t0: performance.now(), flashes: 0, wasOn: false });
    playRescueChime();
    if (y.channelState !== 'in_channel') startGuideSlide(y, x, desk, allMarbles);
    return { kind: 'rescue', channel: x, hitter: y, prev, by, same: prev === by };
  }
  return { kind: 'none' };
}

function startGuideSlide(
  hitter: MarbleEntity,
  target: MarbleEntity,
  _desk: OfficeDeskBuild | null,
  _all: MarbleEntity[],
): void {
  if (slides.has(hitter)) return;
  const body = hitter.body;
  rescueDebug.guided += 1;
  hitter.channelState = 'in_channel';
  slides.set(hitter, {
    marble: hitter,
    target,
    t0: performance.now(),
    from: new THREE.Vector3(body.position.x, body.position.y, body.position.z),
    savedGroup: body.collisionFilterGroup,
    savedMask: body.collisionFilterMask,
  });
  body.velocity.setZero();
  body.angularVelocity.setZero();
  body.type = CANNON.Body.KINEMATIC;
  body.collisionFilterGroup = 0;
  body.collisionFilterMask = 0;
  body.wakeUp();
}

/** Centerline spot `back` metres behind `target` (away from the SW hole), or null. */
function spotBehind(target: MarbleEntity, back: number): { x: number; z: number } | null {
  const tp = target.body.position;
  const s = l4ChannelArcLengthFromSW(tp.x, tp.z);
  if (s === null) return null;
  const peri = l4ChannelCenterlinePerimeter();
  // Marble travels toward s=0 along the shorter arc → "behind" is the other way.
  const towardDecreasing = s <= peri - s;
  const sb = towardDecreasing ? s + back : s - back;
  return l4ChannelPointAtArcLength(sb);
}

function updateGuideSlides(now: number, others: MarbleEntity[]): void {
  for (const [m, sl] of [...slides]) {
    if (!m.active) {
      slides.delete(m);
      continue;
    }
    const body = m.body;
    const hole = l4HoleCentersLocal()[0]!;
    const u = Math.min(1, (now - sl.t0) / (GUIDE_SLIDE_S * 1000));
    const e = u * u * (3 - 2 * u);
    // Destination: behind the target in the channel; if the target already left the channel,
    // go straight to the hole.
    let dest: { x: number; y: number; z: number };
    const back = MARBLE_RADIUS * 2.4;
    const spot =
      sl.target.active && !looping.has(sl.target) && sl.target.channelState === 'in_channel'
        ? spotBehind(sl.target, back)
        : null;
    if (spot) {
      dest = {
        x: spot.x,
        y: l4MarbleRestY(spot.x, spot.z) ?? PLAY_SURFACE_Y - L4_PIPE_R + MARBLE_RADIUS,
        z: spot.z,
      };
    } else {
      dest = { x: hole.x, y: PLAY_SURFACE_Y - L4_PIPE_R * 0.4, z: hole.z };
    }
    body.position.set(
      sl.from.x + (dest.x - sl.from.x) * e,
      sl.from.y + (dest.y - sl.from.y) * e,
      sl.from.z + (dest.z - sl.from.z) * e,
    );
    body.previousPosition.copy(body.position);
    if (body.interpolatedPosition) body.interpolatedPosition.copy(body.position);
    body.velocity.setZero();
    m.mesh.position.set(body.position.x, body.position.y, body.position.z);
    if (u < 1) continue;
    // Landed in the channel (or hole): hand over to normal physics + channel drain.
    // Never land on top of another marble — slide further back until clear.
    if (spot) {
      const clearance = MARBLE_RADIUS * 2 * 1.04;
      for (let k = 0; k < 6; k++) {
        const bx = body.position.x;
        const bz = body.position.z;
        let clash: MarbleEntity | null = null;
        for (const o of others) {
          if (o === m || !o.active || !o.mesh.visible || looping.has(o)) continue;
          const p = o.body.position;
          if (Math.hypot(p.x - bx, p.y - body.position.y, p.z - bz) < clearance) {
            clash = o;
            break;
          }
        }
        if (!clash) break;
        const nb = spotBehind(clash, back);
        if (!nb) break;
        body.position.set(nb.x, l4MarbleRestY(nb.x, nb.z) ?? body.position.y, nb.z);
      }
    }
    slides.delete(m);
    body.type = CANNON.Body.DYNAMIC;
    body.collisionResponse = true;
    applyL4FieldMarbleCollisionFilter(body);
    body.allowSleep = false;
    body.velocity.setZero();
    body.angularVelocity.setZero();
    body.wakeUp();
    m.channelState = 'in_channel';
    m.mesh.position.set(body.position.x, body.position.y, body.position.z);
  }
}

function setEmissive(m: MarbleEntity, on: boolean): void {
  const mat = m.mesh.material;
  if (!mat || Array.isArray(mat) || !('emissive' in mat)) return;
  const pm = mat as THREE.MeshPhysicalMaterial;
  if (on) {
    pm.emissive.setHex(0xffffff);
    pm.emissiveIntensity = 0.9;
  } else {
    pm.emissive.setHex(0x000000);
    pm.emissiveIntensity = 1;
  }
}

/** Exactly RESCUE_FLASHES slow flashes: 0.4 s on / 0.4 s off each. */
function updateRescueFx(now: number): void {
  const period = RESCUE_FLASH_ON_S + RESCUE_FLASH_OFF_S;
  for (const [m, fx] of [...rescueFx]) {
    if (!m.active) {
      rescueFx.delete(m);
      continue;
    }
    const el = (now - fx.t0) / 1000;
    const total = RESCUE_FLASHES * period;
    if (el >= total) {
      setEmissive(m, false);
      fx.flashes = RESCUE_FLASHES;
      fx.wasOn = false;
      // keep the record (flashes==3) but stop touching the material
      rescueFx.set(m, fx);
      continue;
    }
    const on = el % period < RESCUE_FLASH_ON_S;
    if (on && !fx.wasOn) fx.flashes += 1;
    fx.wasOn = on;
    setEmissive(m, on);
  }
}

function updateRescuerImmunity(now: number): void {
  for (const [m, since] of [...rescuers]) {
    if (!m.active) {
      rescuers.delete(m);
      continue;
    }
    if (looping.has(m) || slides.has(m) || m.channelState === 'in_channel') continue;
    const age = now - since;
    if (age > RESCUER_MAX_IMMUNITY_MS) {
      rescuers.delete(m);
      continue;
    }
    if (age < 700) continue;
    // Settled on the mat (not in the trough, not moving) → immunity ends.
    if (isPhysicallyInChannel(m)) continue;
    const v = m.body.velocity.length();
    const w = m.body.angularVelocity.length();
    if (v < 0.02 && w < 0.6) rescuers.delete(m);
  }
}

/** Per-frame rescue bookkeeping (guide slides, flashes, immunity expiry). */
export function updateRescueSystem(others: MarbleEntity[]): void {
  if (!ENABLE_L4_CHANNEL_RESCUE_EXPERIMENT) return;
  const now = performance.now();
  updateGuideSlides(now, others);
  updateRescueFx(now);
  updateRescuerImmunity(now);
}

export function clearRescueState(): void {
  rescuers.clear();
  slides.clear();
  rescueFx.clear();
}

export function beginLoopTransit(
  marble: MarbleEntity,
  desk: OfficeDeskBuild | null,
  exitAs: 'converted' | 'zombie',
): void {
  if (!ENABLE_L4_CHANNEL_RESCUE_EXPERIMENT) return;
  if (looping.has(marble)) return;
  // Rescuers NEVER become zombies (hit or miss): force a healthy exit.
  if (exitAs === 'zombie' && rescuers.has(marble)) {
    exitAs = 'converted';
    rescueDebug.rescuerZombieBlocked += 1;
  }
  const teamAtExit: TeamSide | 'neutral' =
    exitAs === 'zombie'
      ? 'neutral'
      : marble.owner === 'player' || marble.owner === 'ai'
        ? marble.owner
        : 'neutral';
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
  marble.channelState = 'in_loop';
  slides.delete(marble);
  looping.set(marble, {
    marble,
    t0: performance.now(),
    duration: LOOP_DURATION_S * 1000,
    path,
    savedFilterGroup,
    savedFilterMask,
    exitAs,
    teamAtExit,
  });
}

/**
 * Find a free spot for a marble leaving the loop at the return hatch: the hatch itself
 * if no other body overlaps it, else rings of candidate offsets around it. Returns null
 * if every candidate is occupied (caller keeps the marble waiting under the desk).
 * Root cause of "fused zombies": every exit used the exact same point, so a marble that
 * exited on top of another (distance 0 → degenerate zero contact normal) was never pushed apart.
 */
function findFreeExitSpot(
  marble: MarbleEntity,
  others: MarbleEntity[],
): { x: number; z: number; y: number } | null {
  const exit = getReturnHatchXZ();
  const clearance = MARBLE_RADIUS * 2 * 1.04;
  const free = (x: number, z: number): boolean => {
    for (const o of others) {
      if (o === marble || !o.active || !o.mesh.visible || looping.has(o)) continue;
      if (o.body.type === CANNON.Body.STATIC) continue;
      const p = o.body.position;
      if (Math.hypot(p.x - x, p.z - z) < clearance && Math.abs(p.y - (MARBLE_REST_Y)) < 0.05) {
        return false;
      }
    }
    return true;
  };
  const cands: { x: number; z: number }[] = [{ x: exit.x, z: exit.z }];
  for (let ring = 1; ring <= 2; ring++) {
    const r = clearance * ring;
    const n = ring === 1 ? 6 : 12;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + ring * 0.5;
      cands.push({ x: exit.x + Math.cos(a) * r, z: exit.z + Math.sin(a) * r });
    }
  }
  for (const c of cands) {
    if (!free(c.x, c.z)) continue;
    const y = l4MarbleRestY(c.x, c.z);
    if (y === null) continue;
    return { x: c.x, z: c.z, y };
  }
  return null;
}

export function updateLoopTransits(dt: number, others: MarbleEntity[] = []): void {
  if (!ENABLE_L4_CHANNEL_RESCUE_EXPERIMENT || looping.size === 0) return;
  const now = performance.now();
  const done: MarbleEntity[] = [];
  for (const [, st] of looping) {
    const u = Math.min(1, (now - st.t0) / st.duration);
    const eased = u * u * (3 - 2 * u);
    const pos = samplePolyline(st.path, eased);
    const body = st.marble.body;
    body.position.set(pos.x, pos.y, pos.z);
    body.previousPosition.copy(body.position);
    if (body.interpolatedPosition) body.interpolatedPosition.copy(body.position);
    body.velocity.setZero();
    body.angularVelocity.set(1.8 * dt * 60, 2.4 * dt * 60, 0.6 * dt * 60);
    st.marble.mesh.position.set(pos.x, pos.y, pos.z);
    if (u >= 1) done.push(st.marble);
  }
  // Sequential: each released marble becomes an obstacle for the next one this frame.
  for (const m of done) {
    const spot = findFreeExitSpot(m, others);
    if (!spot) {
      // Exit occupied: wait under the hatch (still in loop, collisions off) and retry.
      const st = looping.get(m)!;
      const hold = st.path[st.path.length - 2]!;
      m.body.position.set(hold.x, hold.y, hold.z);
      m.mesh.position.set(hold.x, hold.y, hold.z);
      continue;
    }
    finishLoop(m, spot);
  }
}

function finishLoop(
  marble: MarbleEntity,
  spot?: { x: number; z: number; y: number } | null,
): void {
  const st = looping.get(marble);
  if (!st) return;
  looping.delete(marble);
  const exit = spot ?? getReturnHatchXZ();
  const rest = spot?.y ?? l4MarbleRestY(exit.x, exit.z) ?? MARBLE_REST_Y;
  const body = marble.body;
  body.position.set(exit.x, rest, exit.z);
  body.previousPosition.copy(body.position);
  if (body.interpolatedPosition) body.interpolatedPosition.copy(body.position);
  body.velocity.setZero();
  body.angularVelocity.setZero();
  body.type = CANNON.Body.DYNAMIC;
  body.collisionResponse = true;
  body.collisionFilterGroup = st.savedFilterGroup || 1;
  body.collisionFilterMask = st.savedFilterMask || 1;
  body.wakeUp();
  body.velocity.set((Math.random() - 0.5) * 0.04, 0, (Math.random() - 0.5) * 0.04);
  marble.mesh.visible = true;
  marble.mesh.position.set(exit.x, rest, exit.z);
  marble.mesh.scale.set(1, 1, 1);
  marble.active = true;
  marble.channelState = 'none';
  if ((st.exitAs === 'zombie' || st.teamAtExit === 'neutral') && !rescuers.has(marble)) {
    applyZombieAppearance(marble);
  } else {
    const side: TeamSide =
      st.teamAtExit !== 'neutral'
        ? st.teamAtExit
        : marble.owner === 'player' || marble.owner === 'ai'
          ? marble.owner
          : 'player';
    // Keep the existing material when it is already the right team colour so a rescue flash
    // that is still running is not cut off at the loop exit.
    if (!(marble.role === 'healthy' && marble.owner === side && marble.design === createTeamSolidDesign(side))) {
      applyTeamAppearance(marble, side);
    } else {
      applyL4FieldMarbleCollisionFilter(marble.body);
    }
  }
  // Exited the loop → rescue immunity ends.
  rescuers.delete(marble);
  rescueRegistered.delete(marble);
  (marble as MarbleEntity & { experimentConverted?: boolean }).experimentConverted = false;
  // Loop exit always returns a field marble (never the bridge shooter).
  applyL4FieldMarbleCollisionFilter(marble.body);
}

/** Cancel an in-progress under-desk loop without zombie/convert finish (pre-game rescue). */
export function abortLoopTransit(marble: MarbleEntity): void {
  const st = looping.get(marble);
  if (st) {
    looping.delete(marble);
    const body = marble.body;
    body.type = CANNON.Body.DYNAMIC;
    body.collisionResponse = true;
    body.collisionFilterGroup = st.savedFilterGroup || 1;
    body.collisionFilterMask = st.savedFilterMask || 1;
    applyL4FieldMarbleCollisionFilter(body);
  }
  marble.channelState = 'none';
}

export function deactivateMarble(marble: MarbleEntity): void {
  looping.delete(marble);
  rescuers.delete(marble);
  slides.delete(marble);
  rescueFx.delete(marble);
  if (marble.active) rescueDebug.eliminations += 1;
  detachSkullSprite(marble.mesh);
  marble.active = false;
  marble.mesh.visible = false;
  marble.body.velocity.setZero();
  marble.body.angularVelocity.setZero();
  marble.body.position.y = -1;
  marble.body.type = CANNON.Body.STATIC;
  marble.channelState = 'none';
}

export function disposeExperiment(scene?: THREE.Scene): void {
  for (const m of [...looping.keys()]) finishLoop(m);
  looping.clear();
  clearRescueState();
  rescueSession = null;
  disposeExperimentVisuals(scene);
}


/** AI: pick which healthy marble to shoot this turn (imperfect). */
export function experimentAIPickShooter(
  field: MarbleEntity[],
  current: MarbleEntity | null,
  side: TeamSide,
): MarbleEntity | null {
  const candidates = field.filter(
    (m) =>
      m.active &&
      m.mesh.visible &&
      isHealthyTeamMarble(m) &&
      m.owner === side &&
      !looping.has(m) &&
      m.channelState !== 'in_channel' &&
      !isPhysicallyInChannel(m),
  );
  if (current && candidates.includes(current)) {
    // Keep current sometimes for imperfect play
    if (Math.random() < 0.35) return current;
  }
  if (candidates.length === 0) {
    if (current && isHealthyTeamMarble(current) && current.owner === side) return current;
    return null;
  }
  const bias = experimentAITargetBias(field, side);
  // Prefer a marble near a rescue target, else near an enemy to shove into channel
  const targets = bias.preferRescue.length
    ? bias.preferRescue
    : bias.preferIntoChannel.length
      ? bias.preferIntoChannel
      : [];
  if (targets.length > 0 && Math.random() < 0.7) {
    const t = targets[Math.floor(Math.random() * targets.length)]!;
    let best = candidates[0]!;
    let bestD = Infinity;
    for (const c of candidates) {
      const d = Math.hypot(
        c.body.position.x - t.body.position.x,
        c.body.position.z - t.body.position.z,
      );
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }
  return candidates[Math.floor(Math.random() * candidates.length)]!;
}

export function experimentAITargetBias(
  field: MarbleEntity[],
  shooterOwner: TeamSide,
): {
  preferIntoChannel: MarbleEntity[];
  preferRescue: MarbleEntity[];
} {
  const enemy: TeamSide = shooterOwner === 'player' ? 'ai' : 'player';
  const preferRescue: MarbleEntity[] = [];
  const preferIntoChannel: MarbleEntity[] = [];
  for (const m of field) {
    if (!m.active || !m.mesh.visible || looping.has(m)) continue;
    if (m.channelState === 'in_channel' && isHealthyTeamMarble(m)) {
      preferRescue.push(m);
      continue;
    }
    if (isHealthyTeamMarble(m) && m.owner === enemy && m.channelState !== 'in_channel') {
      preferIntoChannel.push(m);
    }
  }
  return { preferIntoChannel, preferRescue };
}

export function experimentVictoryMessage(
  won: boolean,
  playerName: string,
  opponentName: string,
): { titleKey: 'end.victory' | 'end.defeat'; message: string } {
  if (won) {
    return {
      titleKey: 'end.victory',
      message: `Dejaste a ${opponentName} sin canicas sanas. ¡Rescate y zombis controlados!`,
    };
  }
  return {
    titleKey: 'end.defeat',
    message: `${opponentName} dejó a ${playerName} en 0 canicas sanas. ¡Inténtalo de nuevo!`,
  };
}

/** Pending scale-down eliminations (avoid costly spawnShatter glass burst). */
type ElimFx = { marble: MarbleEntity; t0: number; duration: number; x: number; y: number; z: number };
const pendingEliminations: ElimFx[] = [];

/**
 * Simple readable elimination: flash + sparks + quick scale-down, then caller deactivates.
 * Kept as burstShatter name so Game call sites stay stable.
 */
export function burstShatter(
  particles: ParticleFX | null | undefined,
  x: number,
  y: number,
  z: number,
  _colorHex = 0x90caf9,
): void {
  particles?.spawnSparks(x, y, z, 1.35);
}

/** Start scale-down/flash on victim mesh; call finishEliminationFX each frame. */
export function beginEliminationFX(marble: MarbleEntity, particles: ParticleFX | null | undefined): void {
  const { x, y, z } = marble.body.position;
  particles?.spawnSparks(x, y, z, 1.35);
  const mat = marble.mesh.material;
  if (mat && !Array.isArray(mat) && 'emissive' in mat) {
    const m = mat as THREE.MeshPhysicalMaterial;
    m.emissive = new THREE.Color(0xffffff);
    m.emissiveIntensity = 0.85;
  }
  pendingEliminations.push({
    marble,
    t0: performance.now(),
    duration: 160,
    x,
    y,
    z,
  });
}

/** Advance elimination animations; returns marbles that finished (ready to deactivate). */
export function finishEliminationFX(now = performance.now()): MarbleEntity[] {
  const done: MarbleEntity[] = [];
  for (let i = pendingEliminations.length - 1; i >= 0; i--) {
    const fx = pendingEliminations[i]!;
    const u = Math.min(1, (now - fx.t0) / fx.duration);
    const s = Math.max(0.05, 1 - u);
    fx.marble.mesh.scale.setScalar(s);
    if (u >= 1) {
      pendingEliminations.splice(i, 1);
      fx.marble.mesh.scale.set(1, 1, 1);
      done.push(fx.marble);
    }
  }
  return done;
}

export function clearEliminationFX(): void {
  for (const fx of pendingEliminations) {
    fx.marble.mesh.scale.set(1, 1, 1);
  }
  pendingEliminations.length = 0;
}


/**
 * Round 6 (D): camera framing used during the AI's turn in the experiment — back on the human
 * player's side. Open shot centred on the centroid of the player's healthy marbles with enough
 * distance for all/most of them to be visible and tappable (never a close-up on one marble).
 */
export function framingPlayerArea(
  field: MarbleEntity[],
  fallbackAz: number,
  portrait: boolean,
  aspect: number,
  fovDeg: number,
): { pos: THREE.Vector3; target: THREE.Vector3; centroid: { x: number; z: number }; radius: number; count: number } {
  let cx = 0;
  let cz = 0;
  let n = 0;
  const pts: { x: number; z: number }[] = [];
  const seen = new Set<MarbleEntity>();
  for (const m of field) {
    if (seen.has(m)) continue;
    seen.add(m);
    if (!isHealthyTeamMarble(m) || m.owner !== 'player' || looping.has(m) || !m.mesh.visible) continue;
    const { x, z } = m.body.position;
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    cx += x;
    cz += z;
    n += 1;
    pts.push({ x, z });
  }
  if (n === 0) {
    cx = 0;
    cz = 0;
  } else {
    cx /= n;
    cz /= n;
  }
  let r = 0;
  for (const p of pts) r = Math.max(r, Math.hypot(p.x - cx, p.z - cz));
  const reach = r + MARBLE_RADIUS * 6; // margin so edge marbles stay selectable
  const tanHalf = Math.tan((fovDeg * Math.PI) / 360);
  const fit = Math.min(1, aspect) * tanHalf;
  const dist = Math.max(0.5, Math.min(2.4, reach / (fit * 0.78)));
  const polar = portrait ? 0.95 : 1.0;
  const az = fallbackAz;
  const target = new THREE.Vector3(cx, LOOK_MIN_Y, cz);
  const pos = new THREE.Vector3(
    cx + Math.sin(az) * Math.sin(polar) * dist,
    Math.cos(polar) * dist,
    cz + Math.cos(az) * Math.sin(polar) * dist,
  );
  clampCamAboveSurface(pos, target);
  return { pos, target, centroid: { x: cx, z: cz }, radius: r, count: n };
}
