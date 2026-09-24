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
  return looping.size > 0;
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
  if (!isHealthyTeamMarble(m)) return;
  if (!isPhysicallyInChannel(m)) {
    if (m.channelState === 'in_channel') m.channelState = 'none';
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
  | { kind: 'convert'; channel: MarbleEntity; by: TeamSide; prev: TeamSide }
  | { kind: 'zombie_kill'; zombie: MarbleEntity; victim: MarbleEntity; victimSide: TeamSide };

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
      x.channelState === 'in_channel' &&
      !looping.has(x) &&
      isHealthyTeamMarble(x) &&
      isHealthyTeamMarble(y) &&
      (y.owner === 'player' || y.owner === 'ai')
    ) {
      const cool = contactCoolUntil.get(x) ?? 0;
      if (now < cool) return { kind: 'none' };
      const prev = x.owner as TeamSide;
      const by = y.owner as TeamSide;
      contactCoolUntil.set(x, now + CONTACT_COOLDOWN_MS);
      // Same team = rescued (stays that color); other team = convert. Either way
      // mark converted so unrecovered→zombie does not apply if they reach the hole.
      if (prev !== by) applyTeamAppearance(x, by);
      x.channelState = 'in_channel';
      (x as MarbleEntity & { experimentConverted?: boolean }).experimentConverted = true;
      return { kind: 'convert', channel: x, by, prev };
    }
  }
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

export function beginLoopTransit(
  marble: MarbleEntity,
  desk: OfficeDeskBuild | null,
  exitAs: 'converted' | 'zombie',
): void {
  if (!ENABLE_L4_CHANNEL_RESCUE_EXPERIMENT) return;
  if (looping.has(marble)) return;
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

export function updateLoopTransits(dt: number): void {
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
  for (const m of done) finishLoop(m);
}

function finishLoop(marble: MarbleEntity): void {
  const st = looping.get(marble);
  if (!st) return;
  looping.delete(marble);
  const exit = getReturnHatchXZ();
  const rest = l4MarbleRestY(exit.x, exit.z) ?? MARBLE_REST_Y;
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
  marble.active = true;
  marble.channelState = 'none';
  if (st.exitAs === 'zombie' || st.teamAtExit === 'neutral') {
    applyZombieAppearance(marble);
  } else {
    applyTeamAppearance(marble, st.teamAtExit);
  }
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
