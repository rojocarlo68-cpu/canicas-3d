import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import {
  BOUNDARY_FRICTION,
  BOUNDARY_RADIUS,
  BOUNDARY_RESTITUTION,
  BOUNDARY_SEGMENTS,
  BOUNDARY_WALL_HEIGHT,
  BOUNDARY_WALL_THICKNESS,
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
  POWER_DRAG_PX,
  DESPAWN_DIST,
  START_LEVEL,
  REPLAY_FPS,
} from './constants';
import {
  createAIDesign,
  createFieldDesigns,
  createMarbleEntity,
  createPlayerDesign,
  drawPreviewMarble,
  getMarbleCannonMaterial,
  type MarbleEntity,
} from './marbles';
import { planAIShot, impulseFromPower } from './ai';
import {
  ReplayBuffer,
  makeEmptyFrame,
  type MarbleSnap,
  type ReplayFrame,
  type Side,
} from './replay';

type GamePhase =
  | 'ready'
  | 'dropping'
  | 'settling'
  | 'playing'
  | 'ai_thinking'
  | 'shot_flying'
  | 'replay'
  | 'ended';

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
  private sky!: Sky;
  private sunLight!: THREE.DirectionalLight;

  private fieldMarbles: MarbleEntity[] = [];
  private playerMarble: MarbleEntity | null = null;
  private aiMarble: MarbleEntity | null = null;

  private playerKnocked = new Set<MarbleEntity>();
  private aiKnocked = new Set<MarbleEntity>();
  private playerScore = 0;
  private aiScore = 0;
  private lastScorer: Side | null = null;

  private phase: GamePhase = 'ready';
  private settleStart = 0;
  private settleStableSince = 0;
  private turn: Side = 'player';
  private level = START_LEVEL;

  private charging = false;
  private chargePointerY = 0;
  private power = 0;
  private aimYaw = 0;

  private groundMat!: CANNON.Material;
  private boundaryMat!: CANNON.Material;

  private throwPendingImpulse: {
    side: Side;
    dirX: number;
    dirZ: number;
    power01: number;
  } | null = null;

  private markerGroup: THREE.Group;
  private markerRing!: THREE.Mesh;
  private markerArrow!: THREE.Mesh;
  private markerBeam!: THREE.Mesh;
  private markerLife = 0;

  private camEase: {
    active: boolean;
    t: number;
    dur: number;
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
  } | null = null;

  private replay = new ReplayBuffer();
  private replayPlaying: ReplayFrame[] = [];
  private replayIndex = 0;
  private replayAcc = 0;
  private recording = true;
  private recordAcc = 0;
  private liveTime = 0;
  private phaseBeforeReplay: GamePhase = 'playing';

  private aiThinkUntil = 0;
  private aiPlan: ReturnType<typeof planAIShot> | null = null;
  private shotSettleTimer = 0;

  private defaultCamAzimuth = Math.PI * 0.25;

  private els: {
    btnDrop: HTMLButtonElement;
    btnShoot: HTMLButtonElement;
    btnRestart: HTMLButtonElement;
    btnReplay: HTMLButtonElement;
    btnEndReplay: HTMLButtonElement;
    scorePlayer: HTMLElement;
    scoreAI: HTMLElement;
    turnLabel: HTMLElement;
    levelLabel: HTMLElement;
    powerWrap: HTMLElement;
    powerBar: HTMLElement;
    powerPct: HTMLElement;
    endScreen: HTMLElement;
    endTitle: HTMLElement;
    endMessage: HTMLElement;
    endScore: HTMLElement;
    settleBanner: HTMLElement;
    instructions: HTMLElement;
    playerPreview: HTMLCanvasElement;
    locationBanner: HTMLElement;
    replayBanner: HTMLElement;
  };

  private playerDesign = createPlayerDesign();
  private aiDesign = createAIDesign();
  private fieldDesigns = createFieldDesigns();

  private boundPointerDown: (e: PointerEvent) => void;
  private boundPointerUp: (e: PointerEvent) => void;
  private boundPointerMove: (e: PointerEvent) => void;
  private boundPointerCancel: (e: PointerEvent) => void;
  private boundOrient: () => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.els = {
      btnDrop: document.getElementById('btn-drop') as HTMLButtonElement,
      btnShoot: document.getElementById('btn-shoot') as HTMLButtonElement,
      btnRestart: document.getElementById('btn-restart') as HTMLButtonElement,
      btnReplay: document.getElementById('btn-replay') as HTMLButtonElement,
      btnEndReplay: document.getElementById('btn-end-replay') as HTMLButtonElement,
      scorePlayer: document.getElementById('score-player')!,
      scoreAI: document.getElementById('score-ai')!,
      turnLabel: document.getElementById('turn-label')!,
      levelLabel: document.getElementById('level-label')!,
      powerWrap: document.getElementById('power-wrap')!,
      powerBar: document.getElementById('power-bar')!,
      powerPct: document.getElementById('power-pct')!,
      endScreen: document.getElementById('end-screen')!,
      endTitle: document.getElementById('end-title')!,
      endMessage: document.getElementById('end-message')!,
      endScore: document.getElementById('end-score')!,
      settleBanner: document.getElementById('settle-banner')!,
      instructions: document.getElementById('instructions')!,
      playerPreview: document.getElementById('player-preview') as HTMLCanvasElement,
      locationBanner: document.getElementById('location-banner')!,
      replayBanner: document.getElementById('replay-banner')!,
    };

    drawPreviewMarble(this.els.playerPreview, this.playerDesign);
    this.updateScoreHUD();

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
    this.renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x9ec8e6, 0.028);

    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.01,
      200,
    );

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0, 0);
    this.controls.minDistance = 0.2;
    this.controls.maxDistance = 4.5;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minPolarAngle = 0.12;
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

    this.boundaryMat = new CANNON.Material('boundary');
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.boundaryMat, marbleMat, {
        friction: BOUNDARY_FRICTION,
        restitution: BOUNDARY_RESTITUTION,
        contactEquationStiffness: 1e7,
        contactEquationRelaxation: 3,
      }),
    );

    this.markerGroup = new THREE.Group();
    this.markerGroup.visible = false;
    this.buildMarker();
    this.scene.add(this.markerGroup);

    this.buildEnvironment();
    this.bindUI();
    this.fitCameraToArena(true);

    this.boundPointerDown = (e) => this.onShootPointerDown(e);
    this.boundPointerUp = (e) => this.onShootPointerUp(e);
    this.boundPointerMove = (e) => this.onShootPointerMove(e);
    this.boundPointerCancel = (e) => this.onShootPointerCancel(e);
    this.boundOrient = () => this.onResize();

    this.els.btnShoot.addEventListener('pointerdown', this.boundPointerDown);
    window.addEventListener('pointerup', this.boundPointerUp);
    window.addEventListener('pointermove', this.boundPointerMove);
    window.addEventListener('pointercancel', this.boundPointerCancel);
    window.addEventListener('resize', this.boundOrient);
    window.addEventListener('orientationchange', this.boundOrient);

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
    window.removeEventListener('resize', this.boundOrient);
    window.removeEventListener('orientationchange', this.boundOrient);
  }

  private buildMarker(): void {
    const ringGeo = new THREE.RingGeometry(MARBLE_RADIUS * 2.2, MARBLE_RADIUS * 3.2, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffe08a,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    this.markerRing = new THREE.Mesh(ringGeo, ringMat);
    this.markerRing.rotation.x = -Math.PI / 2;
    this.markerGroup.add(this.markerRing);

    const beamGeo = new THREE.CylinderGeometry(0.0015, 0.004, 0.08, 8);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffe08a,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    this.markerBeam = new THREE.Mesh(beamGeo, beamMat);
    this.markerBeam.position.y = 0.045;
    this.markerGroup.add(this.markerBeam);

    const arrowGeo = new THREE.ConeGeometry(0.008, 0.018, 10);
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffc107 });
    this.markerArrow = new THREE.Mesh(arrowGeo, arrowMat);
    this.markerArrow.position.y = 0.09;
    this.markerGroup.add(this.markerArrow);
  }

  private buildEnvironment(): void {
    const hemi = new THREE.HemisphereLight(0xb8d8ff, 0x6b5030, 0.55);
    this.scene.add(hemi);

    this.sunLight = new THREE.DirectionalLight(0xfff2d6, 1.4);
    this.sunLight.position.set(0.6, 1.2, 0.4);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 0.05;
    this.sunLight.shadow.camera.far = 8;
    const s = 2.2;
    this.sunLight.shadow.camera.left = -s;
    this.sunLight.shadow.camera.right = s;
    this.sunLight.shadow.camera.top = s;
    this.sunLight.shadow.camera.bottom = -s;
    this.sunLight.shadow.bias = -0.0002;
    this.scene.add(this.sunLight);

    // Sky
    this.sky = new Sky();
    this.sky.scale.setScalar(450);
    this.scene.add(this.sky);
    const skyUniforms = this.sky.material.uniforms;
    skyUniforms['turbidity'].value = 4;
    skyUniforms['rayleigh'].value = 2.2;
    skyUniforms['mieCoefficient'].value = 0.004;
    skyUniforms['mieDirectionalG'].value = 0.85;
    const sun = new THREE.Vector3();
    const phi = THREE.MathUtils.degToRad(82);
    const theta = THREE.MathUtils.degToRad(160);
    sun.setFromSphericalCoords(1, phi, theta);
    skyUniforms['sunPosition'].value.copy(sun);
    this.sunLight.position.copy(sun).multiplyScalar(2);

    // Endless dirt ground
    const groundGeo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, 64, 64);
    const groundMat3 = new THREE.MeshStandardMaterial({
      color: '#7a5230',
      roughness: 0.95,
      metalness: 0.0,
    });
    const pos = groundGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const n =
        Math.sin(x * 12) * Math.cos(y * 10) * 0.002 +
        Math.sin(x * 3.1 + y * 2.7) * 0.004;
      pos.setZ(i, n);
    }
    groundGeo.computeVertexNormals();

    this.groundMesh = new THREE.Mesh(groundGeo, groundMat3);
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.receiveShadow = true;
    this.scene.add(this.groundMesh);

    const groundBody = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Plane(),
      material: this.groundMat,
    });
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(groundBody);

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
      opacity: 0.92,
    });
    this.circleMesh = new THREE.Mesh(ringGeo, ringMat);
    this.circleMesh.rotation.x = -Math.PI / 2;
    this.circleMesh.position.y = 0.0012;
    this.scene.add(this.circleMesh);

    const fillGeo = new THREE.CircleGeometry(CIRCLE_RADIUS, 64);
    const fillMat = new THREE.MeshBasicMaterial({
      color: '#5c3d1e',
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
    });
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.rotation.x = -Math.PI / 2;
    fill.position.y = 0.0008;
    this.scene.add(fill);

    // Drop hopper
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

    this.buildInvisibleBoundary();
  }

  /**
   * Invisible circular enclosure ~BOUNDARY_OFFSET m outside the play circle.
   * Segmented static boxes (no render mesh) so marbles bounce back instead of drifting away.
   */
  private buildInvisibleBoundary(): void {
    const halfH = BOUNDARY_WALL_HEIGHT / 2;
    const halfT = BOUNDARY_WALL_THICKNESS / 2;
    const innerR = BOUNDARY_RADIUS;
    const centerR = innerR + halfT;
    const chord =
      2 * centerR * Math.tan(Math.PI / BOUNDARY_SEGMENTS) * 1.08; // slight overlap
    const halfLen = chord / 2;

    for (let i = 0; i < BOUNDARY_SEGMENTS; i++) {
      const angle = (i / BOUNDARY_SEGMENTS) * Math.PI * 2;
      const body = new CANNON.Body({
        mass: 0,
        type: CANNON.Body.STATIC,
        material: this.boundaryMat,
      });
      body.addShape(
        new CANNON.Box(new CANNON.Vec3(halfT, halfH, halfLen)),
      );
      body.position.set(
        Math.cos(angle) * centerR,
        halfH,
        Math.sin(angle) * centerR,
      );
      // Face inward: box X is radial; rotate so +X points outward
      body.quaternion.setFromEuler(0, -angle, 0);
      this.world.addBody(body);
    }

  }

  private bindUI(): void {
    this.els.btnDrop.addEventListener('click', () => this.dropMarbles());
    this.els.btnRestart.addEventListener('click', () => this.restart());
    this.els.btnReplay.addEventListener('click', () => this.startReplay());
    this.els.btnEndReplay.addEventListener('click', () => this.startReplay());
  }

  private setPhase(phase: GamePhase): void {
    this.phase = phase;
    this.els.btnDrop.disabled = phase !== 'ready';
    const canShoot =
      phase === 'playing' && this.turn === 'player' && !this.charging;
    this.els.btnShoot.disabled = !canShoot;
    this.els.settleBanner.classList.toggle(
      'hidden',
      phase !== 'settling' && phase !== 'ai_thinking',
    );
    if (phase === 'ai_thinking') {
      this.els.settleBanner.textContent = 'Turno de la IA…';
    } else if (phase === 'settling') {
      this.els.settleBanner.textContent = 'Esperando a que se detengan las canicas…';
    }

    this.els.replayBanner.classList.toggle('hidden', phase !== 'replay');
    this.els.btnReplay.disabled = phase === 'replay' || this.replay.length < 30;

    if (phase === 'ready') {
      this.els.instructions.textContent =
        'Pulsa «Soltar canicas» (~10 cm). Luego turnos Jugador ↔ IA. Potencia = deslizar arriba/abajo al mantener.';
    } else if (phase === 'settling') {
      this.els.instructions.textContent = 'Espera a que las canicas se detengan…';
    } else if (phase === 'playing') {
      this.els.instructions.textContent =
        this.turn === 'player'
          ? 'Tu turno: mantén tu canica, desliza ARRIBA/ABAJO para potencia, horizontal para apuntar; suelta para disparar.'
          : 'Turno de la IA…';
    } else if (phase === 'ai_thinking' || phase === 'shot_flying') {
      this.els.instructions.textContent =
        this.turn === 'ai' ? 'La IA está tirando…' : 'Canicas en movimiento…';
    } else if (phase === 'replay') {
      this.els.instructions.textContent = 'Repetición de los últimos segundos…';
    } else if (phase === 'ended') {
      this.els.instructions.textContent = '';
    }

    this.updateTurnHUD();
  }

  private updateTurnHUD(): void {
    const turnText =
      this.turn === 'player' ? 'Turno: Jugador' : 'Turno: IA';
    this.els.turnLabel.textContent = turnText;
    this.els.turnLabel.classList.toggle('turn-player', this.turn === 'player');
    this.els.turnLabel.classList.toggle('turn-ai', this.turn === 'ai');
    this.els.levelLabel.textContent = `Nivel ${this.level}`;
  }

  private updateScoreHUD(): void {
    this.els.scorePlayer.textContent = String(this.playerScore);
    this.els.scoreAI.textContent = String(this.aiScore);
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
    this.playerKnocked.clear();
    this.aiKnocked.clear();
    this.playerScore = 0;
    this.aiScore = 0;
    this.lastScorer = null;
    this.updateScoreHUD();
  }

  private removeShooter(which: 'player' | 'ai'): void {
    const m = which === 'player' ? this.playerMarble : this.aiMarble;
    if (!m) return;
    this.scene.remove(m.mesh);
    this.world.removeBody(m.body);
    m.mesh.geometry.dispose();
    const mat = m.mesh.material;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat.dispose();
    if (which === 'player') this.playerMarble = null;
    else this.aiMarble = null;
  }

  private dropMarbles(): void {
    if (this.phase !== 'ready') return;
    this.clearFieldMarbles();
    this.removeShooter('player');
    this.removeShooter('ai');
    this.els.endScreen.classList.add('hidden');
    this.replay.clear();
    this.recording = true;
    this.camEase = null;
    this.setPhase('dropping');

    const designs = this.fieldDesigns.slice(0, FIELD_MARBLE_COUNT);
    for (let i = 0; i < FIELD_MARBLE_COUNT; i++) {
      const angle = (i / FIELD_MARBLE_COUNT) * Math.PI * 2;
      // Cluster under hopper; scale lightly with circle so they spread on bounce
      const r = CIRCLE_RADIUS * (0.04 + (i % 3) * 0.02);
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const y = DROP_HEIGHT + 0.01 + Math.floor(i / 5) * (MARBLE_RADIUS * 2.2);
      const entity = createMarbleEntity(
        designs[i]!,
        new CANNON.Vec3(x, y, z),
        'field',
      );
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

  private allRelevantSettled(): boolean {
    const list: MarbleEntity[] = [...this.fieldMarbles];
    if (this.playerMarble) list.push(this.playerMarble);
    if (this.aiMarble) list.push(this.aiMarble);
    for (const m of list) {
      if (!m.active) continue;
      const v = m.body.velocity.length();
      const w = m.body.angularVelocity.length();
      if (v > SETTLE_SPEED || w > SETTLE_SPEED * 40) return false;
    }
    return true;
  }

  private beginPlaying(): void {
    this.containFieldMarblesInCircle();
    this.spawnShootersInitial();
    this.turn = 'player';
    this.setPhase('playing');
    this.beginTurn('player');
  }

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
        const r = Math.min(
          limit * 0.75,
          CIRCLE_RADIUS * (0.18 + (i % 4) * 0.12),
        );
        m.body.position.set(
          Math.cos(angle) * r,
          MARBLE_RADIUS + 0.0005,
          Math.sin(angle) * r,
        );
        m.body.velocity.setZero();
        m.body.angularVelocity.setZero();
        m.body.wakeUp();
      }
      i++;
    }
  }

  private spawnShootersInitial(): void {
    this.removeShooter('player');
    this.removeShooter('ai');
    const dist = CIRCLE_RADIUS + MARBLE_RADIUS * 3.5;
    const y = MARBLE_RADIUS + 0.0005;

    const player = createMarbleEntity(
      this.playerDesign,
      new CANNON.Vec3(dist, y, 0),
      'player',
    );
    player.body.velocity.setZero();
    player.body.angularVelocity.setZero();
    player.body.type = CANNON.Body.KINEMATIC;
    this.scene.add(player.mesh);
    this.world.addBody(player.body);
    this.playerMarble = player;

    const ai = createMarbleEntity(
      this.aiDesign,
      new CANNON.Vec3(-dist, y, 0),
      'ai',
    );
    ai.body.velocity.setZero();
    ai.body.angularVelocity.setZero();
    ai.body.type = CANNON.Body.KINEMATIC;
    this.scene.add(ai.mesh);
    this.world.addBody(ai.body);
    this.aiMarble = ai;

    this.aimYaw = 0;
  }

  private getActiveShooter(): MarbleEntity | null {
    return this.turn === 'player' ? this.playerMarble : this.aiMarble;
  }

  private beginTurn(side: Side): void {
    this.turn = side;
    this.updateTurnHUD();
    const shooter = this.getActiveShooter();
    if (!shooter) return;

    // Clamp shooter onto ground / finite coords before framing camera
    this.sanitizeShooterPose(shooter);

    // Freeze shooter until shot
    shooter.body.velocity.setZero();
    shooter.body.angularVelocity.setZero();
    shooter.body.type = CANNON.Body.KINEMATIC;

    this.showLocationMarker(shooter, side);
    this.easeCameraToward(shooter);

    if (side === 'player') {
      this.setPhase('playing');
      this.els.btnShoot.disabled = false;
      this.els.locationBanner.textContent = 'Tu canica está aquí';
      this.els.locationBanner.classList.remove('hidden', 'banner-ai');
      this.els.locationBanner.classList.add('banner-player');
    } else {
      this.els.btnShoot.disabled = true;
      this.els.locationBanner.textContent = 'Canica de la IA';
      this.els.locationBanner.classList.remove('hidden', 'banner-player');
      this.els.locationBanner.classList.add('banner-ai');
      this.aiPlan = planAIShot(shooter, this.fieldMarbles, this.level);
      this.aiThinkUntil = performance.now() + 700 + Math.random() * 500;
      this.setPhase('ai_thinking');
    }

    window.setTimeout(() => {
      this.els.locationBanner.classList.add('hidden');
    }, 2200);
  }

  /** Keep shooter body in a renderable, finite pose for camera framing. */
  private sanitizeShooterPose(shooter: MarbleEntity): void {
    const p = shooter.body.position;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
      const sideDist = CIRCLE_RADIUS + MARBLE_RADIUS * 3.5;
      const x = this.turn === 'player' ? sideDist : -sideDist;
      p.set(x, MARBLE_RADIUS + 0.0005, 0);
    }
    if (p.y < MARBLE_RADIUS * 0.5 || p.y > 1) {
      p.y = MARBLE_RADIUS + 0.0005;
    }
    // Soft clamp extreme flyaways so turn handoff stays on-arena
    const horiz = Math.hypot(p.x, p.z);
    const maxR = CIRCLE_RADIUS * 3.5;
    if (horiz > maxR) {
      const s = maxR / horiz;
      p.x *= s;
      p.z *= s;
    }
    shooter.body.velocity.setZero();
    shooter.body.angularVelocity.setZero();
  }

  private showLocationMarker(shooter: MarbleEntity, side: Side): void {
    const color = side === 'player' ? 0xffe08a : 0x64b5f6;
    (this.markerRing.material as THREE.MeshBasicMaterial).color.setHex(color);
    (this.markerBeam.material as THREE.MeshBasicMaterial).color.setHex(color);
    (this.markerArrow.material as THREE.MeshBasicMaterial).color.setHex(color);
    this.markerGroup.position.set(
      shooter.body.position.x,
      0.001,
      shooter.body.position.z,
    );
    this.markerGroup.visible = true;
    this.markerLife = 2.4;
  }

  /**
   * Frame active marble + play circle. Avoids OrbitControls fighting the lerp
   * (root cause of blank/sky handoff after AI turns).
   */
  private easeCameraToward(shooter: MarbleEntity): void {
    const px = shooter.body.position.x;
    const pz = shooter.body.position.z;
    if (!Number.isFinite(px) || !Number.isFinite(pz)) {
      this.camEase = null;
      this.fitCameraToArena(true);
      return;
    }

    const portrait = window.innerHeight > window.innerWidth;
    // Blend marble ↔ origin so the circle stays in view
    const look = new THREE.Vector3(px * 0.42, 0, pz * 0.42);

    let radial = Math.hypot(px, pz);
    let dirX: number;
    let dirZ: number;
    if (radial < 1e-4) {
      dirX = Math.sin(this.defaultCamAzimuth);
      dirZ = Math.cos(this.defaultCamAzimuth);
      radial = CIRCLE_RADIUS;
    } else {
      dirX = px / radial;
      dirZ = pz / radial;
    }

    // Camera outside the marble, slightly off-axis, height scaled to circle
    const back = CIRCLE_RADIUS * (portrait ? 1.55 : 1.3);
    const side = CIRCLE_RADIUS * (portrait ? 0.55 : 0.45);
    const up = CIRCLE_RADIUS * (portrait ? 1.15 : 0.95);
    const toPos = new THREE.Vector3(
      look.x + dirX * back + dirZ * side,
      up,
      look.z + dirZ * back - dirX * side,
    );

    // Guard against NaN / degenerate ease endpoints
    if (
      !Number.isFinite(toPos.x) ||
      !Number.isFinite(toPos.y) ||
      !Number.isFinite(toPos.z) ||
      !Number.isFinite(this.camera.position.x) ||
      !Number.isFinite(this.controls.target.x)
    ) {
      this.camEase = null;
      this.camera.position.copy(toPos);
      this.controls.target.copy(look);
      this.controls.enabled = true;
      this.controls.update();
      return;
    }

    // Pause orbit while easing so damping/spherical state cannot yank the view
    this.controls.enabled = false;
    this.camEase = {
      active: true,
      t: 0,
      dur: 0.65,
      fromPos: this.camera.position.clone(),
      toPos,
      fromTarget: this.controls.target.clone(),
      toTarget: look,
    };
  }

  private syncPowerMeter(): void {
    const pct = Math.round(this.power * 100);
    this.els.powerBar.style.width = `${pct}%`;
    this.els.powerPct.textContent = `${pct}%`;
  }

  private onShootPointerDown(e: PointerEvent): void {
    if (this.phase !== 'playing' || this.turn !== 'player' || !this.playerMarble) return;
    if (this.els.btnShoot.disabled) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    this.charging = true;
    this.chargePointerY = e.clientY;
    // Baseline so a short tap still fires weakly; drag up/down adjusts
    this.power = 0.22;
    this.els.btnShoot.classList.add('charging');
    this.els.powerWrap.classList.remove('hidden');
    this.els.powerWrap.classList.add('visible');
    this.syncPowerMeter();
    this.controls.enabled = false;
  }

  private onShootPointerMove(e: PointerEvent): void {
    if (!this.charging || !this.playerMarble) return;
    // Horizontal drag → aim
    const dx = e.movementX || 0;
    this.aimYaw += dx * 0.01;
    this.aimYaw = Math.max(-1.1, Math.min(1.1, this.aimYaw));
    // Vertical drag → power (up increases, down decreases)
    const dy = e.movementY !== 0 ? e.movementY : e.clientY - this.chargePointerY;
    this.chargePointerY = e.clientY;
    this.power = Math.max(0, Math.min(1, this.power - dy / POWER_DRAG_PX));
    this.syncPowerMeter();
  }

  private onShootPointerCancel(_e: PointerEvent): void {
    if (!this.charging) return;
    this.charging = false;
    this.els.btnShoot.classList.remove('charging');
    this.els.powerWrap.classList.add('hidden');
    this.els.powerWrap.classList.remove('visible');
    this.els.powerBar.style.width = '0%';
    this.els.powerPct.textContent = '';
    this.controls.enabled = true;
  }

  private onShootPointerUp(e: PointerEvent): void {
    if (!this.charging) return;
    e.preventDefault();
    this.charging = false;
    this.els.btnShoot.classList.remove('charging');
    this.els.powerWrap.classList.add('hidden');
    this.els.powerWrap.classList.remove('visible');
    this.controls.enabled = true;

    const power01 = Math.max(0.05, Math.min(1, this.power));
    this.els.powerBar.style.width = '0%';
    this.els.powerPct.textContent = '';

    if (!this.playerMarble) return;
    const px = this.playerMarble.body.position.x;
    const pz = this.playerMarble.body.position.z;
    const base = Math.atan2(-pz, -px || -1e-6);
    const yaw = base + this.aimYaw;
    const dirX = Math.cos(yaw);
    const dirZ = Math.sin(yaw);

    this.startThrow('player', dirX, dirZ, power01);
  }

  private startThrow(
    side: Side,
    dirX: number,
    dirZ: number,
    power01: number,
  ): void {
    const shooter = side === 'player' ? this.playerMarble : this.aiMarble;
    if (!shooter) return;

    this.throwPendingImpulse = { side, dirX, dirZ, power01 };
    // Apply immediately (no hand wind-up)
    this.applyPendingImpulse();

    this.els.btnShoot.disabled = true;
    this.setPhase('shot_flying');
    this.shotSettleTimer = performance.now();
    this.lastScorer = side;
  }

  private applyPendingImpulse(): void {
    const pending = this.throwPendingImpulse;
    if (!pending) return;
    this.throwPendingImpulse = null;
    const shooter =
      pending.side === 'player' ? this.playerMarble : this.aiMarble;
    if (!shooter) return;

    const body = shooter.body;
    body.type = CANNON.Body.DYNAMIC;
    body.wakeUp();
    const impulseMag = impulseFromPower(pending.power01);
    body.applyImpulse(
      new CANNON.Vec3(
        pending.dirX * impulseMag,
        impulseMag * 0.08,
        pending.dirZ * impulseMag,
      ),
      body.position,
    );
  }

  private updateScoreAndWin(): boolean {
    if (
      this.phase !== 'playing' &&
      this.phase !== 'shot_flying' &&
      this.phase !== 'ai_thinking'
    ) {
      return false;
    }

    let inside = 0;
    for (const m of this.fieldMarbles) {
      if (!m.active) continue;
      const dx = m.body.position.x;
      const dz = m.body.position.z;
      const dist = Math.hypot(dx, dz);
      const out = dist > CIRCLE_RADIUS + OUT_MARGIN;
      const fallen = m.body.position.y < -0.05;

      if (out || fallen) {
        if (!this.playerKnocked.has(m) && !this.aiKnocked.has(m)) {
          const scorer = this.lastScorer ?? this.turn;
          if (scorer === 'player') {
            this.playerKnocked.add(m);
            this.playerScore = this.playerKnocked.size;
          } else {
            this.aiKnocked.add(m);
            this.aiScore = this.aiKnocked.size;
          }
          this.updateScoreHUD();
        }
        if (fallen || dist > DESPAWN_DIST) {
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
      return true;
    }
    return false;
  }

  private endGame(): void {
    this.setPhase('ended');
    this.els.btnShoot.disabled = true;
    this.charging = false;
    this.els.powerWrap.classList.add('hidden');
    this.controls.enabled = true;
    this.markerGroup.visible = false;
    this.camEase = null;

    const p = this.playerScore;
    const a = this.aiScore;
    if (p > a) {
      this.els.endTitle.textContent = '¡Victoria!';
      this.els.endMessage.textContent =
        'Sacaste más canicas del círculo que la IA.';
      this.level += 1;
    } else if (a > p) {
      this.els.endTitle.textContent = 'Derrota';
      this.els.endMessage.textContent =
        'La IA sacó más canicas. ¡Inténtalo de nuevo!';
    } else {
      this.els.endTitle.textContent = 'Empate';
      this.els.endMessage.textContent =
        'Misma cantidad de canicas fuera. ¡Casi!';
    }
    this.els.endScore.textContent = `Jugador ${p} · IA ${a}  (Nivel ${this.level})`;
    this.els.endScreen.classList.remove('hidden');
    this.updateTurnHUD();
  }

  private restart(): void {
    this.els.endScreen.classList.add('hidden');
    this.clearFieldMarbles();
    this.removeShooter('player');
    this.removeShooter('ai');
    this.charging = false;
    this.els.powerWrap.classList.add('hidden');
    this.els.powerBar.style.width = '0%';
    this.controls.enabled = true;
    this.markerGroup.visible = false;
    this.recording = true;
    this.camEase = null;
    this.throwPendingImpulse = null;
    this.setPhase('ready');
  }

  private startReplay(): void {
    if (this.phase === 'replay') return;
    const frames = this.replay.snapshot();
    if (frames.length < 30) return;

    this.phaseBeforeReplay = this.phase;
    // Hide end screen during replay so the scene is visible
    this.els.endScreen.classList.add('hidden');

    this.charging = false;
    this.els.powerWrap.classList.add('hidden');
    this.controls.enabled = false;
    this.els.btnShoot.disabled = true;
    this.markerGroup.visible = false;
    this.recording = false;
    this.camEase = null;

    this.replayPlaying = frames;
    this.replayIndex = 0;
    this.replayAcc = 0;
    this.setPhase('replay');
  }

  private finishReplay(): void {
    this.replayPlaying = [];
    this.recording = true;
    this.controls.enabled = true;
    this.syncMeshes();

    if (this.phaseBeforeReplay === 'ended') {
      this.els.endScreen.classList.remove('hidden');
      this.setPhase('ended');
      return;
    }
    if (this.fieldMarbles.length === 0 || this.phaseBeforeReplay === 'ready') {
      this.setPhase('ready');
      return;
    }
    // Resume turn without re-triggering AI think from scratch mid-flow
    if (this.turn === 'player') {
      this.setPhase('playing');
      this.els.btnShoot.disabled = false;
      this.updateTurnHUD();
      if (this.playerMarble) this.easeCameraToward(this.playerMarble);
    } else {
      this.beginTurn('ai');
    }
  }

  private snapMarble(m: MarbleEntity | null): MarbleSnap | null {
    if (!m) return null;
    return {
      x: m.body.position.x,
      y: m.body.position.y,
      z: m.body.position.z,
      qx: m.body.quaternion.x,
      qy: m.body.quaternion.y,
      qz: m.body.quaternion.z,
      qw: m.body.quaternion.w,
      visible: m.active && m.mesh.visible,
    };
  }

  private applySnapToMesh(m: MarbleEntity, s: MarbleSnap): void {
    m.mesh.position.set(s.x, s.y, s.z);
    m.mesh.quaternion.set(s.qx, s.qy, s.qz, s.qw);
    m.mesh.visible = s.visible;
  }

  private recordFrame(): void {
    const frame = makeEmptyFrame(this.liveTime);
    for (let i = 0; i < FIELD_MARBLE_COUNT; i++) {
      const m = this.fieldMarbles[i];
      if (m) {
        frame.field[i] = this.snapMarble(m)!;
      }
    }
    frame.player = this.snapMarble(this.playerMarble);
    frame.ai = this.snapMarble(this.aiMarble);
    frame.camX = this.camera.position.x;
    frame.camY = this.camera.position.y;
    frame.camZ = this.camera.position.z;
    frame.targetX = this.controls.target.x;
    frame.targetY = this.controls.target.y;
    frame.targetZ = this.controls.target.z;
    frame.playerScore = this.playerScore;
    frame.aiScore = this.aiScore;
    frame.turn = this.turn;
    frame.level = this.level;
    this.replay.push(frame);
    this.els.btnReplay.disabled = this.replay.length < 30;
  }

  private playReplayFrame(frame: ReplayFrame): void {
    for (let i = 0; i < this.fieldMarbles.length; i++) {
      const m = this.fieldMarbles[i];
      const s = frame.field[i];
      if (m && s) this.applySnapToMesh(m, s);
    }
    if (this.playerMarble && frame.player) {
      this.applySnapToMesh(this.playerMarble, frame.player);
    }
    if (this.aiMarble && frame.ai) {
      this.applySnapToMesh(this.aiMarble, frame.ai);
    }
    if (
      Number.isFinite(frame.camX) &&
      Number.isFinite(frame.camY) &&
      Number.isFinite(frame.camZ) &&
      Number.isFinite(frame.targetX) &&
      Number.isFinite(frame.targetY) &&
      Number.isFinite(frame.targetZ)
    ) {
      this.camera.position.set(frame.camX, frame.camY, frame.camZ);
      this.controls.target.set(frame.targetX, frame.targetY, frame.targetZ);
      this.controls.update();
    }
    this.playerScore = frame.playerScore;
    this.aiScore = frame.aiScore;
    this.turn = frame.turn;
    this.updateScoreHUD();
    this.updateTurnHUD();
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
    for (const m of [this.playerMarble, this.aiMarble]) {
      if (!m) continue;
      m.mesh.position.set(m.body.position.x, m.body.position.y, m.body.position.z);
      m.mesh.quaternion.set(
        m.body.quaternion.x,
        m.body.quaternion.y,
        m.body.quaternion.z,
        m.body.quaternion.w,
      );
    }
  }

  private tryFinishShotTurn(): void {
    if (this.phase !== 'shot_flying') return;
    const now = performance.now();
    if (now - this.shotSettleTimer < 450) return;
    if (!this.allRelevantSettled()) {
      if (now - this.shotSettleTimer > SETTLE_MAX_MS) {
        // force continue
      } else {
        return;
      }
    }

    // Ensure pending impulse applied
    if (this.throwPendingImpulse) this.applyPendingImpulse();

    // Keep shooters where they stopped (dynamic → freeze for next turn)
    for (const m of [this.playerMarble, this.aiMarble]) {
      if (!m) continue;
      m.body.velocity.setZero();
      m.body.angularVelocity.setZero();
      m.body.type = CANNON.Body.KINEMATIC;
      if (m.body.position.y < MARBLE_RADIUS) {
        m.body.position.y = MARBLE_RADIUS + 0.0005;
      }
      if (
        !Number.isFinite(m.body.position.x) ||
        !Number.isFinite(m.body.position.z)
      ) {
        const sideDist = CIRCLE_RADIUS + MARBLE_RADIUS * 3.5;
        const x = m.owner === 'player' ? sideDist : -sideDist;
        m.body.position.set(x, MARBLE_RADIUS + 0.0005, 0);
      }
    }

    if (this.updateScoreAndWin()) return;

    const next: Side = this.turn === 'player' ? 'ai' : 'player';
    this.beginTurn(next);
  }

  private updateAI(dt: number): void {
    if (this.phase !== 'ai_thinking' || !this.aiMarble || !this.aiPlan) return;

    // Charge visual on power meter only
    const remain = this.aiThinkUntil - performance.now();
    const chargeT = Math.max(0, Math.min(1, 1 - remain / 900));

    this.els.powerWrap.classList.remove('hidden');
    this.els.powerWrap.classList.add('visible');
    const pct = Math.round(chargeT * this.aiPlan.power01 * 100);
    this.els.powerBar.style.width = `${pct}%`;
    this.els.powerPct.textContent = `${pct}%`;

    if (performance.now() < this.aiThinkUntil) return;

    this.els.powerWrap.classList.add('hidden');
    this.els.powerWrap.classList.remove('visible');
    const plan = this.aiPlan;
    this.aiPlan = null;
    this.startThrow('ai', plan.dirX, plan.dirZ, plan.power01);
    void dt;
  }

  private updateMarker(dt: number): void {
    if (!this.markerGroup.visible) return;
    this.markerLife -= dt;
    const pulse = 1 + Math.sin(performance.now() * 0.008) * 0.08;
    this.markerRing.scale.setScalar(pulse);
    this.markerArrow.position.y = 0.085 + Math.sin(performance.now() * 0.01) * 0.01;
    this.markerArrow.rotation.y += dt * 2.5;
    if (this.markerLife <= 0) {
      this.markerGroup.visible = false;
    } else {
      const shooter = this.getActiveShooter();
      if (shooter && (this.phase === 'playing' || this.phase === 'ai_thinking')) {
        this.markerGroup.position.x = shooter.body.position.x;
        this.markerGroup.position.z = shooter.body.position.z;
      }
    }
  }

  private updateCamEase(dt: number): void {
    if (!this.camEase || !this.camEase.active) return;
    this.camEase.t += dt;
    const u = Math.min(1, this.camEase.t / this.camEase.dur);
    const e = u * u * (3 - 2 * u);
    this.camera.position.lerpVectors(this.camEase.fromPos, this.camEase.toPos, e);
    this.controls.target.lerpVectors(this.camEase.fromTarget, this.camEase.toTarget, e);

    if (
      !Number.isFinite(this.camera.position.x) ||
      !Number.isFinite(this.camera.position.y) ||
      !Number.isFinite(this.camera.position.z) ||
      !Number.isFinite(this.controls.target.x) ||
      !Number.isFinite(this.controls.target.y) ||
      !Number.isFinite(this.controls.target.z)
    ) {
      this.camEase.active = false;
      this.camEase = null;
      this.fitCameraToArena(true);
      this.controls.enabled = true;
      return;
    }

    // Keep camera looking at target without OrbitControls overwriting the ease
    this.camera.lookAt(this.controls.target);

    if (u >= 1) {
      this.camera.position.copy(this.camEase.toPos);
      this.controls.target.copy(this.camEase.toTarget);
      this.camEase.active = false;
      this.camEase = null;
      this.controls.enabled = true;
      // Sync OrbitControls internal spherical from final pose
      this.controls.update();
    }
  }

  private update(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.liveTime += dt;

    if (this.phase === 'replay') {
      this.replayAcc += dt;
      const step = 1 / REPLAY_FPS;
      while (this.replayAcc >= step && this.replayIndex < this.replayPlaying.length) {
        this.replayAcc -= step;
        this.playReplayFrame(this.replayPlaying[this.replayIndex]!);
        this.replayIndex++;
      }
      if (this.replayIndex >= this.replayPlaying.length) {
        this.finishReplay();
      }
      this.renderer.render(this.scene, this.camera);
      return;
    }

    this.world.step(1 / 60, dt, 4);

    if (this.charging && this.playerMarble) {
      this.syncPowerMeter();
    }

    if (this.phase === 'settling') {
      const now = performance.now();
      if (this.allRelevantSettled()) {
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
    }

    if (this.phase === 'ai_thinking') {
      this.updateAI(dt);
    }

    if (this.phase === 'shot_flying') {
      this.updateScoreAndWin();
      this.tryFinishShotTurn();
    }

    if (this.phase === 'playing') {
      this.updateScoreAndWin();
    }

    this.updateMarker(dt);
    this.updateCamEase(dt);
    this.syncMeshes();

    // Recover if camera ever becomes invalid (blank/white handoff)
    if (
      !Number.isFinite(this.camera.position.x) ||
      !Number.isFinite(this.controls.target.x)
    ) {
      this.camEase = null;
      this.fitCameraToArena(true);
      this.controls.enabled = true;
    }

    if (this.recording && this.phase !== 'ready') {
      this.recordAcc += dt;
      const step = 1 / REPLAY_FPS;
      while (this.recordAcc >= step) {
        this.recordAcc -= step;
        this.recordFrame();
      }
    }

    // Do NOT call controls.update() while camEase is active — OrbitControls
    // damping/spherical rewrite would fight the lerp and could point at sky.
    if (!this.camEase?.active) {
      this.controls.update();
    }
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Keep the play circle visually centered in the usable viewport,
   * accounting for top HUD and bottom-right controls (esp. portrait).
   */
  private fitCameraToArena(forcePos = false): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const portrait = h > w;

    // Usable framing offsets in NDC-ish vertical bias
    const topHud = portrait ? 0.1 : 0.07;
    const bottomHud = portrait ? 0.14 : 0.1;
    const usableCenterY = (bottomHud - topHud) * 0.5;

    const baseFov = portrait ? 52 : 42;
    this.camera.fov = baseFov;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    // Orbit distance scales with play circle so 2× radius stays framed
    const target = new THREE.Vector3(
      0,
      usableCenterY * CIRCLE_RADIUS * 0.25,
      portrait ? CIRCLE_RADIUS * 0.03 : 0,
    );
    const dist = CIRCLE_RADIUS * (portrait ? 3.0 : 2.5);
    const polar = portrait ? 1.05 : 0.92;
    const az = this.defaultCamAzimuth;

    if (forcePos || this.phase === 'ready') {
      const x = Math.sin(az) * Math.sin(polar) * dist;
      const y = Math.cos(polar) * dist + CIRCLE_RADIUS * 0.12;
      const z = Math.cos(az) * Math.sin(polar) * dist;
      this.camera.position.set(target.x + x, target.y + y, target.z + z);
      this.controls.target.copy(target);
      this.camEase = null;
    } else if (!this.camEase?.active) {
      // Soft-correct only when not mid turn-ease
      this.controls.target.lerp(target, 0.2);
    }
    this.controls.update();
    this.renderer.setSize(w, h, false);
  }

  private onResize(): void {
    this.fitCameraToArena(false);
  }
}
