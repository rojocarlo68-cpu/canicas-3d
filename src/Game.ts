import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  CIRCLE_RADIUS,
  DROP_HEIGHT,
  FIELD_MARBLE_COUNT,
  GRAVITY,
  GROUND_FRICTION,
  GROUND_RESTITUTION,
  GROUND_SIZE,
  MARBLE_RADIUS,
  OUT_MARGIN,
  SETTLE_MAX_MS,
  SETTLE_SPEED,
  SETTLE_WAIT_MS,
  SHOT_MAX,
  SHOT_MIN,
  CHARGE_MS,
} from './constants';
import {
  createFieldDesigns,
  createMarbleEntity,
  createPlayerDesign,
  drawPreviewMarble,
  getMarbleCannonMaterial,
  type MarbleEntity,
} from './marbles';

type GamePhase = 'ready' | 'dropping' | 'settling' | 'playing' | 'ended';

export class Game {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private world: CANNON.World;
  private clock = new THREE.Clock();
  private animId = 0;

  private groundMesh!: THREE.Mesh;
  private circleMesh!: THREE.Mesh;
  private containerMesh!: THREE.Group;
  private fieldMarbles: MarbleEntity[] = [];
  private playerMarble: MarbleEntity | null = null;
  private knockedOut = new Set<MarbleEntity>();
  private score = 0;

  private phase: GamePhase = 'ready';
  private settleStart = 0;
  private settleStableSince = 0;

  private charging = false;
  private chargeStart = 0;
  private power = 0;
  private nextShotTimer = 0;
  private aimYaw = 0; // radians offset from center direction

  private groundBody!: CANNON.Body;
  private groundMat!: CANNON.Material;

  private els: {
    btnDrop: HTMLButtonElement;
    btnShoot: HTMLButtonElement;
    btnRestart: HTMLButtonElement;
    scoreValue: HTMLElement;
    scoreTotal: HTMLElement;
    powerWrap: HTMLElement;
    powerBar: HTMLElement;
    endScreen: HTMLElement;
    endTitle: HTMLElement;
    endMessage: HTMLElement;
    endScore: HTMLElement;
    settleBanner: HTMLElement;
    instructions: HTMLElement;
    playerPreview: HTMLCanvasElement;
  };

  private playerDesign = createPlayerDesign();
  private fieldDesigns = createFieldDesigns();

  private boundPointerDown: (e: PointerEvent) => void;
  private boundPointerUp: (e: PointerEvent) => void;
  private boundPointerMove: (e: PointerEvent) => void;
  private boundPointerCancel: (e: PointerEvent) => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.els = {
      btnDrop: document.getElementById('btn-drop') as HTMLButtonElement,
      btnShoot: document.getElementById('btn-shoot') as HTMLButtonElement,
      btnRestart: document.getElementById('btn-restart') as HTMLButtonElement,
      scoreValue: document.getElementById('score-value')!,
      scoreTotal: document.getElementById('score-total')!,
      powerWrap: document.getElementById('power-wrap')!,
      powerBar: document.getElementById('power-bar')!,
      endScreen: document.getElementById('end-screen')!,
      endTitle: document.getElementById('end-title')!,
      endMessage: document.getElementById('end-message')!,
      endScore: document.getElementById('end-score')!,
      settleBanner: document.getElementById('settle-banner')!,
      instructions: document.getElementById('instructions')!,
      playerPreview: document.getElementById('player-preview') as HTMLCanvasElement,
    };

    this.els.scoreTotal.textContent = String(FIELD_MARBLE_COUNT);
    drawPreviewMarble(this.els.playerPreview, this.playerDesign);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#87b4d4');
    this.scene.fog = new THREE.Fog('#87b4d4', 0.8, 2.2);

    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.01,
      10,
    );
    this.camera.position.set(0.28, 0.22, 0.28);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0, 0);
    this.controls.minDistance = 0.12;
    this.controls.maxDistance = 0.9;
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.minPolarAngle = 0.15;
    this.controls.enablePan = false;
    this.controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_ROTATE,
    };

    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, GRAVITY, 0),
    });
    this.world.broadphase = new CANNON.NaiveBroadphase();
    this.world.allowSleep = true;
    (this.world.solver as CANNON.GSSolver).iterations = 12;

    this.groundMat = new CANNON.Material('ground');
    const marbleMat = getMarbleCannonMaterial();
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.groundMat, marbleMat, {
        friction: GROUND_FRICTION,
        restitution: GROUND_RESTITUTION,
      }),
    );
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(marbleMat, marbleMat, {
        friction: 0.3,
        restitution: 0.45,
      }),
    );

    this.buildEnvironment();
    this.bindUI();

    this.boundPointerDown = (e) => this.onShootPointerDown(e);
    this.boundPointerUp = (e) => this.onShootPointerUp(e);
    this.boundPointerMove = (e) => this.onShootPointerMove(e);
    this.boundPointerCancel = (e) => this.onShootPointerCancel(e);

    this.els.btnShoot.addEventListener('pointerdown', this.boundPointerDown);
    window.addEventListener('pointerup', this.boundPointerUp);
    window.addEventListener('pointermove', this.boundPointerMove);
    window.addEventListener('pointercancel', this.boundPointerCancel);

    window.addEventListener('resize', () => this.onResize());
    this.setPhase('ready');
  }

  start(): void {
    this.clock.start();
    const loop = () => {
      this.animId = requestAnimationFrame(loop);
      this.update();
    };
    loop();
  }

  dispose(): void {
    cancelAnimationFrame(this.animId);
    this.controls.dispose();
    this.renderer.dispose();
  }

  private buildEnvironment(): void {
    // Lights
    const hemi = new THREE.HemisphereLight(0xb8d4f0, 0x6b4a2a, 0.85);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff2d6, 1.35);
    sun.position.set(0.4, 0.8, 0.25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 0.05;
    sun.shadow.camera.far = 2;
    const s = 0.4;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    this.scene.add(sun);

    // Dirt ground
    const groundGeo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, 32, 32);
    const groundMat3 = new THREE.MeshStandardMaterial({
      color: '#8B5A2B',
      roughness: 0.92,
      metalness: 0.0,
    });
    // Subtle height noise in vertex colors / displace slightly for dirt feel
    const pos = groundGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const n = Math.sin(x * 40) * Math.cos(y * 35) * 0.0008;
      pos.setZ(i, n);
    }
    groundGeo.computeVertexNormals();

    this.groundMesh = new THREE.Mesh(groundGeo, groundMat3);
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.receiveShadow = true;
    this.scene.add(this.groundMesh);

    this.groundBody = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Plane(),
      material: this.groundMat,
    });
    this.groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(this.groundBody);

    // Play circle ring
    const ringGeo = new THREE.RingGeometry(
      CIRCLE_RADIUS - 0.003,
      CIRCLE_RADIUS + 0.003,
      64,
    );
    const ringMat = new THREE.MeshBasicMaterial({
      color: '#f5e6c8',
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    });
    this.circleMesh = new THREE.Mesh(ringGeo, ringMat);
    this.circleMesh.rotation.x = -Math.PI / 2;
    this.circleMesh.position.y = 0.0012;
    this.scene.add(this.circleMesh);

    // Inner faint fill
    const fillGeo = new THREE.CircleGeometry(CIRCLE_RADIUS, 64);
    const fillMat = new THREE.MeshBasicMaterial({
      color: '#5c3d1e',
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide,
    });
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.rotation.x = -Math.PI / 2;
    fill.position.y = 0.0008;
    this.scene.add(fill);

    // Drop container (visual hopper above center)
    this.containerMesh = new THREE.Group();
    const cupGeo = new THREE.CylinderGeometry(0.035, 0.028, 0.04, 24, 1, true);
    const cupMat = new THREE.MeshStandardMaterial({
      color: '#5d4037',
      roughness: 0.6,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });
    const cup = new THREE.Mesh(cupGeo, cupMat);
    cup.castShadow = true;
    this.containerMesh.add(cup);

    const rimGeo = new THREE.TorusGeometry(0.035, 0.003, 8, 24);
    const rim = new THREE.Mesh(rimGeo, new THREE.MeshStandardMaterial({ color: '#8d6e63' }));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.02;
    this.containerMesh.add(rim);

    this.containerMesh.position.set(0, DROP_HEIGHT + 0.02, 0);
    this.scene.add(this.containerMesh);

    // Soft ground skirt / table edge feel
    const skirt = new THREE.Mesh(
      new THREE.CylinderGeometry(GROUND_SIZE * 0.55, GROUND_SIZE * 0.58, 0.02, 48),
      new THREE.MeshStandardMaterial({ color: '#6b4226', roughness: 0.95 }),
    );
    skirt.position.y = -0.011;
    skirt.receiveShadow = true;
    this.scene.add(skirt);
  }

  private bindUI(): void {
    this.els.btnDrop.addEventListener('click', () => this.dropMarbles());
    this.els.btnRestart.addEventListener('click', () => this.restart());
  }

  private setPhase(phase: GamePhase): void {
    this.phase = phase;
    this.els.btnDrop.disabled = phase !== 'ready';
    this.els.btnShoot.disabled = phase !== 'playing';
    this.els.settleBanner.classList.toggle('hidden', phase !== 'settling');
    if (phase === 'ready') {
      this.els.instructions.textContent =
        'Pulsa «Soltar canicas» para soltar 10 canicas desde el recipiente (~13 cm).';
    } else if (phase === 'settling') {
      this.els.instructions.textContent = 'Espera a que las canicas se detengan…';
    } else if (phase === 'playing') {
      this.els.instructions.textContent =
        'Mantén tu canica (abajo a la derecha) para cargar potencia; suelta para disparar al centro. Arrastra ligeramente al cargar para apuntar.';
    } else if (phase === 'ended') {
      this.els.instructions.textContent = '';
    }
  }

  private clearFieldMarbles(): void {
    for (const m of this.fieldMarbles) {
      this.scene.remove(m.mesh);
      this.world.removeBody(m.body);
      m.mesh.geometry.dispose();
      const mat = m.mesh.material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat.dispose();
    }
    this.fieldMarbles = [];
    this.knockedOut.clear();
    this.score = 0;
    this.els.scoreValue.textContent = '0';
  }

  private removePlayerMarble(): void {
    if (!this.playerMarble) return;
    this.scene.remove(this.playerMarble.mesh);
    this.world.removeBody(this.playerMarble.body);
    this.playerMarble.mesh.geometry.dispose();
    const mat = this.playerMarble.mesh.material;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat.dispose();
    this.playerMarble = null;
  }

  private dropMarbles(): void {
    if (this.phase !== 'ready') return;
    this.clearFieldMarbles();
    this.removePlayerMarble();
    this.els.endScreen.classList.add('hidden');
    this.setPhase('dropping');

    const designs = this.fieldDesigns.slice(0, FIELD_MARBLE_COUNT);
    for (let i = 0; i < FIELD_MARBLE_COUNT; i++) {
      const angle = (i / FIELD_MARBLE_COUNT) * Math.PI * 2;
      const r = 0.012 + (i % 3) * 0.006;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const y = DROP_HEIGHT + 0.01 + Math.floor(i / 5) * (MARBLE_RADIUS * 2.2);
      const entity = createMarbleEntity(
        designs[i]!,
        new CANNON.Vec3(x, y, z),
        false,
      );
      // Tiny random spin / lateral nudge
      entity.body.velocity.set(
        (Math.random() - 0.5) * 0.02,
        0,
        (Math.random() - 0.5) * 0.02,
      );
      entity.body.angularVelocity.set(
        (Math.random() - 0.5) * 3,
        (Math.random() - 0.5) * 3,
        (Math.random() - 0.5) * 3,
      );
      this.scene.add(entity.mesh);
      this.world.addBody(entity.body);
      this.fieldMarbles.push(entity);
    }

    this.settleStart = performance.now();
    this.settleStableSince = 0;
    this.setPhase('settling');
  }

  private allFieldSettled(): boolean {
    for (const m of this.fieldMarbles) {
      if (!m.active) continue;
      const v = m.body.velocity.length();
      const w = m.body.angularVelocity.length();
      if (v > SETTLE_SPEED || w > SETTLE_SPEED * 40) return false;
    }
    return true;
  }

  private beginPlaying(): void {
    this.containFieldMarblesInCircle();
    this.setPhase('playing');
    this.spawnPlayerAtEdge();
  }

  /** Ensure field marbles start in-play after the drop settle. */
  private containFieldMarblesInCircle(): void {
    const limit = CIRCLE_RADIUS - MARBLE_RADIUS * 1.5;
    let i = 0;
    for (const m of this.fieldMarbles) {
      if (!m.active) continue;
      const dx = m.body.position.x;
      const dz = m.body.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > limit || m.body.position.y < 0) {
        const angle = (i / FIELD_MARBLE_COUNT) * Math.PI * 2 + 0.2;
        const r = Math.min(limit * 0.7, 0.02 + (i % 4) * 0.012);
        m.body.position.set(Math.cos(angle) * r, MARBLE_RADIUS + 0.0005, Math.sin(angle) * r);
        m.body.velocity.setZero();
        m.body.angularVelocity.setZero();
        m.body.wakeUp();
      }
      i++;
    }
  }

  private spawnPlayerAtEdge(): void {
    this.removePlayerMarble();
    // Launch position: just outside the circle, on +X side (can rotate with aim)
    const dist = CIRCLE_RADIUS + MARBLE_RADIUS * 3.5;
    const x = dist;
    const z = 0;
    const y = MARBLE_RADIUS + 0.0005;
    const entity = createMarbleEntity(
      this.playerDesign,
      new CANNON.Vec3(x, y, z),
      true,
    );
    // Hold still until shot
    entity.body.velocity.setZero();
    entity.body.angularVelocity.setZero();
    entity.body.type = CANNON.Body.KINEMATIC;
    this.scene.add(entity.mesh);
    this.world.addBody(entity.body);
    this.playerMarble = entity;
    this.aimYaw = 0;
    this.updatePlayerAimPose();
  }

  private updatePlayerAimPose(): void {
    if (!this.playerMarble || this.playerMarble.body.type !== CANNON.Body.KINEMATIC) return;
    const dist = CIRCLE_RADIUS + MARBLE_RADIUS * 3.5;
    const x = Math.cos(this.aimYaw) * dist;
    const z = Math.sin(this.aimYaw) * dist;
    this.playerMarble.body.position.set(x, MARBLE_RADIUS + 0.0005, z);
    this.playerMarble.body.velocity.setZero();
    this.playerMarble.body.angularVelocity.setZero();
  }

  private onShootPointerDown(e: PointerEvent): void {
    if (this.phase !== 'playing' || !this.playerMarble) return;
    if (this.els.btnShoot.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    this.charging = true;
    this.chargeStart = performance.now();
    this.power = 0;
    this.els.btnShoot.classList.add('charging');
    this.els.powerWrap.classList.remove('hidden');
    this.controls.enabled = false;
  }

  private onShootPointerMove(e: PointerEvent): void {
    if (!this.charging) return;
    // Slight aim: horizontal drag while holding changes yaw
    const dx = e.movementX || 0;
    this.aimYaw += dx * 0.008;
    this.aimYaw = Math.max(-0.7, Math.min(0.7, this.aimYaw));
    this.updatePlayerAimPose();
  }

  private onShootPointerCancel(_e: PointerEvent): void {
    if (!this.charging) return;
    this.charging = false;
    this.els.btnShoot.classList.remove('charging');
    this.els.powerWrap.classList.add('hidden');
    this.els.powerBar.style.width = '0%';
    this.controls.enabled = true;
  }

  private onShootPointerUp(e: PointerEvent): void {
    if (!this.charging) return;
    e.preventDefault();
    this.charging = false;
    this.els.btnShoot.classList.remove('charging');
    this.els.powerWrap.classList.add('hidden');
    this.controls.enabled = true;

    const elapsed = performance.now() - this.chargeStart;
    const t = Math.min(1, elapsed / CHARGE_MS);
    // Ease-in so short taps are gentle
    const eased = t * t;
    this.power = eased;
    this.els.powerBar.style.width = '0%';
    this.firePlayerShot(eased);
  }

  private firePlayerShot(power01: number): void {
    if (!this.playerMarble || this.phase !== 'playing') return;
    const body = this.playerMarble.body;
    body.type = CANNON.Body.DYNAMIC;
    body.wakeUp();

    const impulseMag = SHOT_MIN + (SHOT_MAX - SHOT_MIN) * power01;
    // Direction toward circle center from player position
    const px = body.position.x;
    const pz = body.position.z;
    const len = Math.hypot(px, pz) || 1;
    const dirX = -px / len;
    const dirZ = -pz / len;

    body.applyImpulse(
      new CANNON.Vec3(dirX * impulseMag, impulseMag * 0.08, dirZ * impulseMag),
      body.position,
    );

    // Disable shoot until settle / next turn — player marble stays in play
    this.els.btnShoot.disabled = true;
    // After shot, briefly wait then allow another shot if game not over
    // (classic: one shooter marble; reuse it after it stops)
    this.scheduleNextShotWhenSettled();
  }

  private scheduleNextShotWhenSettled(): void {
    this.nextShotTimer = performance.now();
  }

  private tryEnableNextShot(): void {
    if (this.phase !== 'playing' || !this.playerMarble) return;
    if (!this.els.btnShoot.disabled) return;
    if (!this.nextShotTimer) return;

    const now = performance.now();
    if (now - this.nextShotTimer < 400) return;

    // Wait until player marble mostly settled
    const v = this.playerMarble.body.velocity.length();
    const w = this.playerMarble.body.angularVelocity.length();
    if (v > SETTLE_SPEED * 2 || w > SETTLE_SPEED * 80) return;

    // Reposition to edge for next shot (keep marble in play style: reset to edge)
    this.spawnPlayerAtEdge();
    this.els.btnShoot.disabled = false;
    this.nextShotTimer = 0;
  }

  private updateScoreAndWin(): void {
    if (this.phase !== 'playing') return;

    let inside = 0;
    for (const m of this.fieldMarbles) {
      if (!m.active) continue;
      const dx = m.body.position.x;
      const dz = m.body.position.z;
      const dist = Math.hypot(dx, dz);
      const out = dist > CIRCLE_RADIUS + OUT_MARGIN;

      // Also count as out if fallen off the ground table
      const fallen =
        m.body.position.y < -0.05 ||
        Math.abs(m.body.position.x) > GROUND_SIZE * 0.48 ||
        Math.abs(m.body.position.z) > GROUND_SIZE * 0.48;

      if (out || fallen) {
        if (!this.knockedOut.has(m)) {
          this.knockedOut.add(m);
          this.score = this.knockedOut.size;
          this.els.scoreValue.textContent = String(this.score);
        }
        // Soft-despawn far away marbles for clarity
        if (fallen || dist > CIRCLE_RADIUS * 2.5) {
          m.active = false;
          m.mesh.visible = false;
          m.body.velocity.setZero();
          m.body.angularVelocity.setZero();
          m.body.position.y = -1;
          m.body.type = CANNON.Body.STATIC;
        }
      } else {
        inside++;
      }
    }

    if (inside === 0 && this.fieldMarbles.length > 0) {
      this.endGame();
    }
  }

  private endGame(): void {
    this.setPhase('ended');
    this.els.btnShoot.disabled = true;
    this.charging = false;
    this.els.powerWrap.classList.add('hidden');
    this.controls.enabled = true;

    this.els.endTitle.textContent = '¡Victoria!';
    this.els.endMessage.textContent =
      'No quedan canicas dentro del círculo. Has limpiado el terreno.';
    this.els.endScore.textContent = `Canicas sacadas: ${this.score} / ${FIELD_MARBLE_COUNT}`;
    this.els.endScreen.classList.remove('hidden');
  }

  private restart(): void {
    this.els.endScreen.classList.add('hidden');
    this.clearFieldMarbles();
    this.removePlayerMarble();
    this.nextShotTimer = 0;
    this.charging = false;
    this.els.powerWrap.classList.add('hidden');
    this.els.powerBar.style.width = '0%';
    this.controls.enabled = true;
    this.setPhase('ready');
  }

  private syncMeshes(): void {
    for (const m of this.fieldMarbles) {
      if (!m.active && !m.mesh.visible) continue;
      m.mesh.position.set(m.body.position.x, m.body.position.y, m.body.position.z);
      m.mesh.quaternion.set(
        m.body.quaternion.x,
        m.body.quaternion.y,
        m.body.quaternion.z,
        m.body.quaternion.w,
      );
    }
    if (this.playerMarble) {
      const m = this.playerMarble;
      m.mesh.position.set(m.body.position.x, m.body.position.y, m.body.position.z);
      m.mesh.quaternion.set(
        m.body.quaternion.x,
        m.body.quaternion.y,
        m.body.quaternion.z,
        m.body.quaternion.w,
      );
    }
  }

  private update(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.world.step(1 / 60, dt, 4);

    if (this.charging) {
      const t = Math.min(1, (performance.now() - this.chargeStart) / CHARGE_MS);
      this.power = t * t;
      this.els.powerBar.style.width = `${Math.round(this.power * 100)}%`;
    }

    if (this.phase === 'settling') {
      const now = performance.now();
      if (this.allFieldSettled()) {
        if (!this.settleStableSince) this.settleStableSince = now;
        if (now - this.settleStableSince >= SETTLE_WAIT_MS) {
          this.beginPlaying();
        }
      } else {
        this.settleStableSince = 0;
      }
      if (now - this.settleStart >= SETTLE_MAX_MS) {
        this.beginPlaying();
      }
      this.updateScoreAndWin();
    }

    if (this.phase === 'playing') {
      this.updateScoreAndWin();
      this.tryEnableNextShot();
    }

    this.syncMeshes();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }
}
