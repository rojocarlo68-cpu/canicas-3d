/**
 * L4 Channel Rescue / Conversion / Zombie experiment (reversible).
 *
 * Disable: set ENABLE_L4_CHANNEL_RESCUE_EXPERIMENT = false
 * Full revert: flag off, or git revert of experiment commit(s).
 *
 * When inactive, call sites no-op — L4 matches baseline HEAD.
 *
 * Flow: MAT → CHANNEL (in_channel, DYNAMIC, cruise 0.32 via applyL4ChannelDrain)
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
} from './officeDesk';
import type { MarbleDesign, MarbleEntity, MarbleOwner } from './marbles';
import type { ParticleFX } from './particles';

/** Master switch — false restores baseline L4 hole-knockout scoring. */
export const ENABLE_L4_CHANNEL_RESCUE_EXPERIMENT = true;

export type TeamSide = 'player' | 'ai';
export type ChannelState = 'none' | 'in_channel' | 'in_loop';
export type MarbleRole = 'healthy' | 'zombie';

const LOOP_DURATION_S = 1.55;
const TEAM_FIELD_EACH = 9; // +1 shooter = 10 healthy / side
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
  let n = 0;
  for (const m of field) {
    if (isHealthyTeamMarble(m) && m.owner === side) n += 1;
  }
  for (const s of shooters) {
    if (s && isHealthyTeamMarble(s) && s.owner === side) n += 1;
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

function makeZombieDesign(): MarbleDesign {
  const id = 'zombie-skull';
  const cached = solidDesignCache.get(id);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const s = 256;
  const g = ctx.createRadialGradient(s * 0.4, s * 0.35, s * 0.05, s / 2, s / 2, s * 0.55);
  g.addColorStop(0, '#3a3a3a');
  g.addColorStop(0.35, '#1a1a1a');
  g.addColorStop(0.8, '#0a0a0a');
  g.addColorStop(1, '#000000');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = 'rgba(60,90,40,0.55)';
  ctx.lineWidth = 4;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(s * 0.2, s * (0.2 + i * 0.1));
    ctx.bezierCurveTo(
      s * 0.4,
      s * (0.1 + i * 0.12),
      s * 0.6,
      s * (0.4 + i * 0.08),
      s * 0.85,
      s * (0.25 + i * 0.1),
    );
    ctx.stroke();
  }
  ctx.font = `bold ${Math.floor(s * 0.42)}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(240,240,240,0.96)';
  ctx.fillText('\u{1F480}', s / 2, s / 2 + s * 0.02);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  const design: MarbleDesign = {
    id,
    name: 'Zombie',
    material: new THREE.MeshPhysicalMaterial({
      map: tex,
      color: 0x222222,
      roughness: 0.55,
      metalness: 0.05,
      clearcoat: 0.35,
      clearcoatRoughness: 0.4,
      emissive: new THREE.Color(0x1a3010),
      emissiveIntensity: 0.15,
    }),
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

function attachSkullSprite(mesh: THREE.Mesh): void {
  detachSkullSprite(mesh);
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 128);
  ctx.font = '90px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('\u{1F480}', 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.name = SKULL_CHILD;
  sprite.scale.set(MARBLE_RADIUS * 2.8, MARBLE_RADIUS * 2.8, 1);
  sprite.position.set(0, MARBLE_RADIUS * 1.35, 0);
  sprite.renderOrder = 10;
  mesh.add(sprite);
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
}

export function applyZombieAppearance(marble: MarbleEntity): void {
  const design = makeZombieDesign();
  const old = marble.mesh.material;
  marble.mesh.material = design.material.clone();
  if (Array.isArray(old)) old.forEach((x) => x.dispose());
  else (old as THREE.Material).dispose();
  marble.design = design;
  marble.owner = 'field';
  marble.role = 'zombie';
  marble.team = 'neutral';
  marble.channelState = 'none';
  attachSkullSprite(marble.mesh);
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
}

export function mountExperimentVisuals(
  scene: THREE.Scene,
  desk: OfficeDeskBuild | null,
): void {
  if (!ENABLE_L4_CHANNEL_RESCUE_EXPERIMENT) return;
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
      if (prev === by) return { kind: 'none' };
      applyTeamAppearance(x, by);
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

export function burstShatter(
  particles: ParticleFX | null | undefined,
  x: number,
  y: number,
  z: number,
  colorHex = 0x90caf9,
): void {
  particles?.spawnShatter(x, y, z, colorHex);
}
