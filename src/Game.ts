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
  DROP_FREEZE_MS,
  FIELD_MARBLE_COUNT,
  GRAVITY,
  GROUND_FRICTION,
  GROUND_RESTITUTION,
  GROUND_SIZE,
  MARBLE_RADIUS,
  MARBLE_REST_Y,
  PLAY_SURFACE_Y,
  OUT_MARGIN,
  SETTLE_MAX_MS,
  SETTLE_SPEED,
  DESPAWN_DIST,
  START_LEVEL,
  REPLAY_FPS,
  MONEY_PER_KNOCKOUT,
  SLOWMO_SCALE,
  SLOWMO_DURATION,
  SLOWMO_IMPACT_THRESHOLD,
  MARBLE_PICK_TOLERANCE,
  PUSH_MAX_SPEED,
  PUSH_VELOCITY_GAIN,
  PLAYER_IDLE_HINT_SEC,
} from './constants';
import {
  createAIDesign,
  createFieldDesigns,
  createMarbleEntity,
  createPlayerDesign,
  getMarbleCannonMaterial,
  type MarbleEntity,
} from './marbles';
import { planAIShot, impulseFromPower } from './ai';
import {
  resolveControlMode,
  controlModeLabel,
  controlModeHint,
  powerFromFlick,
  powerFromPush,
  isGestureStrongEnough,
  type ControlMode,
} from './controlMode';
import {
  ReplayBuffer,
  makeEmptyFrame,
  type MarbleSnap,
  type ReplayFrame,
  type Side,
} from './replay';
import { pickOpponentName } from './names';
import { ParticleFX } from './particles';
import { buildPark } from './park';
import { ParkLife } from './parkLife';
import {
  DAY_CYCLE_SECONDS,
  applyDayNight,
  type StreetLamp,
} from './dayNight';

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
  private hemiLight!: THREE.HemisphereLight;
  private playFillLight!: THREE.PointLight;
  private streetLamps: StreetLamp[] = [];
  private parkLife!: ParkLife;
  private sunDir = new THREE.Vector3();
  /** Elapsed seconds for the 30-min day/night cycle (independent of match reset). */
  private dayNightTime = 0;

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
  private turn: Side = 'player';
  private level = START_LEVEL;

  /** Player shoot control: flick (aim line) or push (finger shove). */
  private controlMode: ControlMode = resolveControlMode();

  private aiming = false;
  private aimPointerId: number | null = null;
  private aimStartClientX = 0;
  private aimStartClientY = 0;
  private aimDirX = 0;
  private aimDirZ = -1;
  private aimPower = 0;
  private aimSamples: { t: number; x: number; y: number; gx?: number; gz?: number }[] = [];
  private canPlayerShoot = false;

  private aimLineGroup: THREE.Group | null = null;
  private aimShaft: THREE.Mesh | null = null;
  private aimHead: THREE.Mesh | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -PLAY_SURFACE_Y);
  private readonly _ndc = new THREE.Vector2();
  private readonly _groundHit = new THREE.Vector3();
  private readonly _tmpV = new THREE.Vector3();

  private groundMat!: CANNON.Material;
  private boundaryMat!: CANNON.Material;

  private throwPendingImpulse: {
    side: Side;
    dirX: number;
    dirZ: number;
    power01: number;
    /** Push: world-space finger velocity on ground (m/s). When set, overrides power impulse. */
    pushVx?: number;
    pushVz?: number;
  } | null = null;

  private markerGroup: THREE.Group;
  private markerRing!: THREE.Mesh;
  private markerArrow!: THREE.Mesh;
  private markerBeam!: THREE.Mesh;
  private markerLife = 0;
  /** Stronger pulse while an idle / turn-start location cue is active. */
  private markerHintBoost = 0;
  /** Player-turn idle “Tu canica” reminder: armed only while player can shoot. */
  private playerIdleHintArmed = false;
  private playerIdleHintAcc = 0;
  private locationBannerHideTimer: ReturnType<typeof setTimeout> | null = null;

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

  /** Random rival name for this match (never shown as "IA"). */
  private opponentName = pickOpponentName();
  private particles!: ParticleFX;
  private dirtCooldown = new Map<object, number>();
  private sparkCooldownUntil = 0;

  /** Running player balance ($2 per knockout). */
  private playerMoney = 0;

  /** Field marbles still inside the circle after the post-drop freeze (scoring set). */
  private scoringMarbles = new Set<MarbleEntity>();
  /** Only award score for knockouts during a player/AI shot. */
  private scoringEnabled = false;

  /** Physics time scale (1 = normal, <1 = cámara lenta). */
  private timeScale = 1;
  private slowMoTimer = 0;
  private slowMoFollow: MarbleEntity | null = null;
  private readonly _slowMoCamOffset = new THREE.Vector3();
  private readonly _aimFwd = new THREE.Vector3();
  private readonly _aimRight = new THREE.Vector3();

  // Replay transport
  private replayPaused = false;
  private replaySpeed = 1;
  private replayScrubbing = false;

  private els: {
    btnDrop: HTMLButtonElement;
    btnRestart: HTMLButtonElement;
    btnReplay: HTMLButtonElement;
    btnEndReplay: HTMLButtonElement;
    scorePlayer: HTMLElement;
    scoreAI: HTMLElement;
    scoreAIName: HTMLElement;
    scoreMoney: HTMLElement;
    scorePlayerSide: HTMLElement;
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
    controlModeLabel: HTMLElement;
    linkFlick: HTMLAnchorElement;
    linkPush: HTMLAnchorElement;
    locationBanner: HTMLElement;
    replayBanner: HTMLElement;
    replayControls: HTMLElement;
    replayBtnPlay: HTMLButtonElement;
    replayBtnBack: HTMLButtonElement;
    replayBtnFwd: HTMLButtonElement;
    replayBtnStop: HTMLButtonElement;
    replayBtnExit: HTMLButtonElement;
    replayScrub: HTMLInputElement;
    replaySpeed: HTMLSelectElement;
    moneyToast: HTMLElement;
    punchOverlay: HTMLElement;
    gameRoot: HTMLElement;
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
      btnRestart: document.getElementById('btn-restart') as HTMLButtonElement,
      btnReplay: document.getElementById('btn-replay') as HTMLButtonElement,
      btnEndReplay: document.getElementById('btn-end-replay') as HTMLButtonElement,
      scorePlayer: document.getElementById('score-player')!,
      scoreAI: document.getElementById('score-ai')!,
      scoreAIName: document.getElementById('score-ai-name')!,
      scoreMoney: document.getElementById('score-money')!,
      scorePlayerSide: document.getElementById('score-player-side')!,
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
      controlModeLabel: document.getElementById('control-mode-label')!,
      linkFlick: document.getElementById('link-flick') as HTMLAnchorElement,
      linkPush: document.getElementById('link-push') as HTMLAnchorElement,
      locationBanner: document.getElementById('location-banner')!,
      replayBanner: document.getElementById('replay-banner')!,
      replayControls: document.getElementById('replay-controls')!,
      replayBtnPlay: document.getElementById('replay-btn-play') as HTMLButtonElement,
      replayBtnBack: document.getElementById('replay-btn-back') as HTMLButtonElement,
      replayBtnFwd: document.getElementById('replay-btn-fwd') as HTMLButtonElement,
      replayBtnStop: document.getElementById('replay-btn-stop') as HTMLButtonElement,
      replayBtnExit: document.getElementById('replay-btn-exit') as HTMLButtonElement,
      replayScrub: document.getElementById('replay-scrub') as HTMLInputElement,
      replaySpeed: document.getElementById('replay-speed') as HTMLSelectElement,
      moneyToast: document.getElementById('money-toast')!,
      punchOverlay: document.getElementById('punch-overlay')!,
      gameRoot: document.getElementById('game-root')!,
    };

    this.rollOpponentName();
    this.updateScoreHUD();
    this.applyControlModeUI();

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
    this.scene.fog = new THREE.FogExp2(0xb8d4ef, 0.009);

    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.01,
      400,
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
    // Billiard-like marble–marble: cannon-es resolves impulses along the
    // contact normal by default. Keep friction low so glancing vs head-on
    // transfers feel physical; do not override velocities on impact.
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(marbleMat, marbleMat, {
        friction: 0.08,
        restitution: 0.58,
        contactEquationStiffness: 1e7,
        contactEquationRelaxation: 3,
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

    this.boundPointerDown = (e) => this.onAimPointerDown(e);
    this.boundPointerUp = (e) => this.onAimPointerUp(e);
    this.boundPointerMove = (e) => this.onAimPointerMove(e);
    this.boundPointerCancel = (e) => this.onAimPointerCancel(e);
    this.boundOrient = () => this.onResize();

    this.buildAimLine();
    // Capture phase so aim pointer moves/ups are handled before OrbitControls
    // (which listens on document) — critical for multi-touch aim + orbit.
    this.canvas.addEventListener('pointerdown', this.boundPointerDown, { capture: true });
    window.addEventListener('pointerup', this.boundPointerUp, { capture: true });
    window.addEventListener('pointermove', this.boundPointerMove, { capture: true });
    window.addEventListener('pointercancel', this.boundPointerCancel, { capture: true });
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
    this.canvas.removeEventListener('pointerdown', this.boundPointerDown, { capture: true } as EventListenerOptions);
    window.removeEventListener('pointerup', this.boundPointerUp, { capture: true } as EventListenerOptions);
    window.removeEventListener('pointermove', this.boundPointerMove, { capture: true } as EventListenerOptions);
    window.removeEventListener('pointercancel', this.boundPointerCancel, { capture: true } as EventListenerOptions);
    window.removeEventListener('resize', this.boundOrient);
    window.removeEventListener('orientationchange', this.boundOrient);
  }

  private buildMarker(): void {
    const ringGeo = new THREE.RingGeometry(MARBLE_RADIUS * 2.4, MARBLE_RADIUS * 3.8, 40);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffe08a,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    this.markerRing = new THREE.Mesh(ringGeo, ringMat);
    this.markerRing.rotation.x = -Math.PI / 2;
    this.markerGroup.add(this.markerRing);

    const beamGeo = new THREE.CylinderGeometry(0.0018, 0.005, 0.1, 8);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffe08a,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    });
    this.markerBeam = new THREE.Mesh(beamGeo, beamMat);
    this.markerBeam.position.y = 0.055;
    this.markerGroup.add(this.markerBeam);

    const arrowGeo = new THREE.ConeGeometry(0.01, 0.022, 10);
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffc107 });
    this.markerArrow = new THREE.Mesh(arrowGeo, arrowMat);
    // Cone default tip is +Y; flip so it points DOWN toward the marble
    this.markerArrow.rotation.x = Math.PI;
    this.markerArrow.position.y = 0.115;
    this.markerGroup.add(this.markerArrow);
  }

  private buildEnvironment(): void {
    this.hemiLight = new THREE.HemisphereLight(0xb8d8ff, 0x6b5030, 0.55);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff2d6, 1.4);
    this.sunLight.position.set(0.6, 1.2, 0.4);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(1024, 1024);
    this.sunLight.shadow.camera.near = 0.05;
    this.sunLight.shadow.camera.far = 12;
    const s = 3.5;
    this.sunLight.shadow.camera.left = -s;
    this.sunLight.shadow.camera.right = s;
    this.sunLight.shadow.camera.top = s;
    this.sunLight.shadow.camera.bottom = -s;
    this.sunLight.shadow.bias = -0.0002;
    this.scene.add(this.sunLight);

    // Soft fill over the play circle (boosted at night for readability)
    this.playFillLight = new THREE.PointLight(0xfff5e0, 0.2, 2.5, 1.5);
    this.playFillLight.position.set(0, 1.2, 0);
    this.playFillLight.castShadow = false;
    this.scene.add(this.playFillLight);

    // Sky
    this.sky = new Sky();
    this.sky.scale.setScalar(450);
    this.scene.add(this.sky);
    const skyUniforms = this.sky.material.uniforms;
    skyUniforms['turbidity'].value = 4;
    skyUniforms['rayleigh'].value = 2.2;
    skyUniforms['mieCoefficient'].value = 0.004;
    skyUniforms['mieDirectionalG'].value = 0.85;
    this.sunDir.setFromSphericalCoords(
      1,
      THREE.MathUtils.degToRad(82),
      THREE.MathUtils.degToRad(160),
    );
    skyUniforms['sunPosition'].value.copy(this.sunDir);
    this.sunLight.position.copy(this.sunDir).multiplyScalar(3);

    // Base grass ground — keep center flat so displaced quads never poke through dirt
    const groundGeo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, 64, 64);
    const groundMat3 = new THREE.MeshStandardMaterial({
      color: '#5a7a42',
      roughness: 0.95,
      metalness: 0.0,
    });
    const pos = groundGeo.attributes.position;
    const flatR = CIRCLE_RADIUS * 2.2; // covers dirt pad + chalk ring
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const r = Math.hypot(x, y);
      if (r < flatR) {
        pos.setZ(i, -0.002); // slightly below dirt / chalk
        continue;
      }
      const fade = Math.min(1, (r - flatR) / (flatR * 0.5));
      const n =
        (Math.sin(x * 12) * Math.cos(y * 10) * 0.002 +
          Math.sin(x * 3.1 + y * 2.7) * 0.004) *
        fade;
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
    // Match dirt pad top so marbles rest on the visual play surface
    groundBody.position.y = PLAY_SURFACE_Y;
    this.world.addBody(groundBody);

    // Dark under-edge so the scoring limit reads against dirt and grass
    const edgeGeo = new THREE.RingGeometry(
      CIRCLE_RADIUS - 0.012,
      CIRCLE_RADIUS + 0.012,
      96,
    );
    const edgeMat = new THREE.MeshBasicMaterial({
      color: '#1a120c',
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const edgeRing = new THREE.Mesh(edgeGeo, edgeMat);
    edgeRing.rotation.x = -Math.PI / 2;
    edgeRing.position.y = PLAY_SURFACE_Y + 0.0015;
    edgeRing.renderOrder = 3;
    this.scene.add(edgeRing);

    // High-contrast chalk scoring ring at CIRCLE_RADIUS (gameplay radius unchanged)
    const ringGeo = new THREE.RingGeometry(
      CIRCLE_RADIUS - 0.007,
      CIRCLE_RADIUS + 0.007,
      96,
    );
    const ringMat = new THREE.MeshBasicMaterial({
      color: '#fff8e7',
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.circleMesh = new THREE.Mesh(ringGeo, ringMat);
    this.circleMesh.rotation.x = -Math.PI / 2;
    this.circleMesh.position.y = PLAY_SURFACE_Y + 0.002;
    this.circleMesh.renderOrder = 4;
    this.scene.add(this.circleMesh);

    const fillGeo = new THREE.CircleGeometry(CIRCLE_RADIUS - 0.008, 64);
    const fillMat = new THREE.MeshBasicMaterial({
      color: '#5c3d1e',
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.rotation.x = -Math.PI / 2;
    fill.position.y = PLAY_SURFACE_Y + 0.0012;
    fill.renderOrder = 2;
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

    // Park scenery (grass, trees, paths, benches, faroles — no stadium)
    const park = buildPark(this.scene);
    this.streetLamps = park.lamps;

    // Ambient park life (birds only — walkers removed)
    this.parkLife = new ParkLife(this.scene);

    // Impact sparks + dirt dust + money bill FX
    this.particles = new ParticleFX(this.scene);

    // Seed day/night from current elapsed (morning-ish start offset)
    this.dayNightTime = DAY_CYCLE_SECONDS * 0.18; // late morning
    this.syncDayNight();
  }

  private syncDayNight(): void {
    const fog = this.scene.fog;
    if (!(fog instanceof THREE.FogExp2)) return;
    applyDayNight(this.dayNightTime, {
      sky: this.sky,
      sunLight: this.sunLight,
      hemiLight: this.hemiLight,
      fog,
      renderer: this.renderer,
      lamps: this.streetLamps,
      playFill: this.playFillLight,
      sunDir: this.sunDir,
    });
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

    this.els.replayBtnPlay.addEventListener('click', () => this.toggleReplayPlay());
    this.els.replayBtnBack.addEventListener('click', () => this.nudgeReplay(-Math.round(REPLAY_FPS * 0.5)));
    this.els.replayBtnFwd.addEventListener('click', () => this.nudgeReplay(Math.round(REPLAY_FPS * 0.5)));
    this.els.replayBtnStop.addEventListener('click', () => this.stopReplayPlayback());
    this.els.replayBtnExit.addEventListener('click', () => this.finishReplay());
    this.els.replaySpeed.addEventListener('change', () => {
      const v = parseFloat(this.els.replaySpeed.value);
      this.replaySpeed = Number.isFinite(v) && v > 0 ? v : 1;
    });
    this.els.replayScrub.addEventListener('pointerdown', () => {
      this.replayScrubbing = true;
      this.replayPaused = true;
      this.syncReplayPlayButton();
    });
    this.els.replayScrub.addEventListener('input', () => {
      if (this.phase !== 'replay' || this.replayPlaying.length === 0) return;
      const max = Math.max(1, this.replayPlaying.length - 1);
      const t = parseInt(this.els.replayScrub.value, 10) / 1000;
      this.replayIndex = Math.max(0, Math.min(max, Math.round(t * max)));
      this.replayAcc = 0;
      this.playReplayFrame(this.replayPlaying[this.replayIndex]!);
    });
    const endScrub = () => {
      this.replayScrubbing = false;
    };
    this.els.replayScrub.addEventListener('pointerup', endScrub);
    this.els.replayScrub.addEventListener('pointercancel', endScrub);
  }

  private rollOpponentName(): void {
    this.opponentName = pickOpponentName();
    this.els.scoreAIName.textContent = this.opponentName;
  }

  private setPhase(phase: GamePhase): void {
    this.phase = phase;
    this.els.btnDrop.disabled = phase !== 'ready';
    this.canPlayerShoot =
      phase === 'playing' && this.turn === 'player' && !this.aiming;
    this.els.settleBanner.classList.toggle(
      'hidden',
      phase !== 'settling' && phase !== 'ai_thinking',
    );
    if (phase === 'ai_thinking') {
      this.els.settleBanner.textContent = `Turno de ${this.opponentName}…`;
    } else if (phase === 'settling') {
      this.els.settleBanner.textContent = 'Canicas cayendo… se congelan a los 5 s';
    }

    this.els.replayBanner.classList.toggle('hidden', phase !== 'replay');
    this.els.btnReplay.disabled = phase === 'replay' || this.replay.length < 30;
    if (phase !== 'replay') {
      this.els.replayControls.classList.add('hidden');
    }

    const modeHint = controlModeHint(this.controlMode);
    if (phase === 'ready') {
      this.els.instructions.textContent =
        `Pulsa «Soltar canicas» (~10 cm). Luego turnos Jugador ↔ ${this.opponentName}. Modo ${controlModeLabel(this.controlMode)}.`;
    } else if (phase === 'settling') {
      this.els.instructions.textContent = 'Espera 5 segundos: las canicas de campo se congelan donde queden.';
    } else if (phase === 'playing') {
      this.els.instructions.textContent =
        this.turn === 'player' ? modeHint : `Turno de ${this.opponentName}…`;
    } else if (phase === 'ai_thinking' || phase === 'shot_flying') {
      this.els.instructions.textContent =
        this.turn === 'ai'
          ? `${this.opponentName} está tirando…`
          : 'Canicas en movimiento…';
    } else if (phase === 'replay') {
      this.els.instructions.textContent = 'Repetición de los últimos segundos…';
    } else if (phase === 'ended') {
      this.els.instructions.textContent = '';
    }

    this.updateTurnHUD();
  }

  private applyControlModeUI(): void {
    const label = controlModeLabel(this.controlMode);
    this.els.controlModeLabel.textContent = `Modo: ${label}`;
    this.els.linkFlick.classList.toggle('active', this.controlMode === 'flick');
    this.els.linkPush.classList.toggle('active', this.controlMode === 'push');
    // Keep shareable relative links under the Pages base path
    const base = import.meta.env.BASE_URL || '/canicas-3d/';
    this.els.linkFlick.href = `${base}?control=flick`;
    this.els.linkPush.href = `${base}?control=push`;
  }

  private updateTurnHUD(): void {
    const turnText =
      this.turn === 'player'
        ? 'Turno: Jugador'
        : `Turno: ${this.opponentName}`;
    this.els.turnLabel.textContent = turnText;
    this.els.turnLabel.classList.toggle('turn-player', this.turn === 'player');
    this.els.turnLabel.classList.toggle('turn-ai', this.turn === 'ai');
    this.els.levelLabel.textContent = `Nivel ${this.level}`;
  }

  private updateScoreHUD(): void {
    this.els.scorePlayer.textContent = String(this.playerScore);
    this.els.scoreAI.textContent = String(this.aiScore);
    this.els.scoreAIName.textContent = this.opponentName;
    this.els.scoreMoney.textContent = `$${this.playerMoney}`;
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
    this.scoringMarbles.clear();
    this.scoringEnabled = false;
    this.playerScore = 0;
    this.aiScore = 0;
    this.playerMoney = 0;
    this.lastScorer = null;
    this.exitSlowMo(false);
    this.particles?.clear();
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
    this.particles?.clear();
    this.dirtCooldown.clear();
    this.rollOpponentName();
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
    this.freezeFieldAfterDrop();
    this.spawnShootersInitial();
    this.turn = 'player';
    this.scoringEnabled = false;
    this.setPhase('playing');
    this.beginTurn('player');
  }

  /**
   * Fully stop every field marble wherever it is after the drop wait.
   * Build the scoring set from marbles still inside the circle; early exits
   * do NOT award points and are left outside (not teleported back in).
   */
  private freezeFieldAfterDrop(): void {
    this.scoringMarbles.clear();
    this.scoringEnabled = false;
    this.playerKnocked.clear();
    this.aiKnocked.clear();
    this.playerScore = 0;
    this.aiScore = 0;
    this.lastScorer = null;
    this.updateScoreHUD();

    for (const m of this.fieldMarbles) {
      if (!m.active) continue;
      this.snapMarblePhysics(m, true);
      const dist = Math.hypot(m.body.position.x, m.body.position.z);
      const out = dist > CIRCLE_RADIUS + OUT_MARGIN || m.body.position.y < -0.05;
      if (out) {
        // Left during drop/settle — no score, keep visible but inert
        m.body.velocity.setZero();
        m.body.angularVelocity.setZero();
        m.body.sleep();
      } else {
        this.scoringMarbles.add(m);
        m.body.velocity.setZero();
        m.body.angularVelocity.setZero();
        m.body.sleep();
      }
      this.syncOneMesh(m);
    }
  }

  /** Snap body Y onto the play surface, clear bad velocities / penetration. */
  private snapMarblePhysics(m: MarbleEntity, hardStop: boolean): void {
    const p = m.body.position;
    const minY = MARBLE_REST_Y;
    const maxY = PLAY_SURFACE_Y + MARBLE_RADIUS * 4;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
      p.set(0, minY, 0);
    }
    // Sit on dirt pad: center = surface + radius (no intersection with dirt disk)
    if (p.y < minY || p.y > maxY) {
      p.y = minY;
    }
    if (hardStop) {
      m.body.velocity.setZero();
      m.body.angularVelocity.setZero();
    } else {
      // Kill downward penetration velocity that leaves mesh half-buried
      if (m.body.velocity.y < 0) m.body.velocity.y = 0;
      if (p.y < PLAY_SURFACE_Y + MARBLE_RADIUS) p.y = minY;
    }
    m.body.wakeUp();
    if (hardStop) m.body.sleep();
  }

  private syncOneMesh(m: MarbleEntity): void {
    m.mesh.position.set(m.body.position.x, m.body.position.y, m.body.position.z);
    m.mesh.quaternion.set(
      m.body.quaternion.x,
      m.body.quaternion.y,
      m.body.quaternion.z,
      m.body.quaternion.w,
    );
  }

private spawnShootersInitial(): void {
    this.removeShooter('player');
    this.removeShooter('ai');
    const dist = CIRCLE_RADIUS + MARBLE_RADIUS * 3.5;
    const y = MARBLE_REST_Y;

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
    this.scoringEnabled = false;
    this.snapMarblePhysics(shooter, true);
    this.syncOneMesh(shooter);

    this.showLocationMarker(shooter, side);
    this.easeCameraToward(shooter);

    if (side === 'player') {
      this.setPhase('playing');
      this.canPlayerShoot = true;
      this.flashLocationBanner('Aquí está tu canica', 'banner-player', 2200);
      this.armPlayerIdleHint();
    } else {
      this.canPlayerShoot = false;
      this.disarmPlayerIdleHint();
      this.cancelAimGesture(false);
      this.flashLocationBanner(
        `Aquí está la canica de ${this.opponentName}`,
        'banner-ai',
        2200,
      );
      this.aiPlan = planAIShot(shooter, this.fieldMarbles, this.level);
      this.aiThinkUntil = performance.now() + 700 + Math.random() * 500;
      this.setPhase('ai_thinking');
    }
  }

  /** Keep shooter body in a renderable, finite pose for camera framing. */
  private sanitizeShooterPose(shooter: MarbleEntity): void {
    const p = shooter.body.position;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
      const sideDist = CIRCLE_RADIUS + MARBLE_RADIUS * 3.5;
      const x = this.turn === 'player' ? sideDist : -sideDist;
      p.set(x, MARBLE_REST_Y, 0);
    }
    if (p.y < PLAY_SURFACE_Y + MARBLE_RADIUS * 0.5 || p.y > 1) {
      p.y = MARBLE_REST_Y;
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
    (this.markerRing.material as THREE.MeshBasicMaterial).opacity = 0.95;
    (this.markerBeam.material as THREE.MeshBasicMaterial).opacity = 0.7;
    this.markerGroup.position.set(
      shooter.body.position.x,
      PLAY_SURFACE_Y + 0.001,
      shooter.body.position.z,
    );
    this.markerGroup.visible = true;
    this.markerLife = 2.8;
    this.markerHintBoost = 2.6;
  }

  private armPlayerIdleHint(): void {
    this.playerIdleHintArmed = true;
    this.playerIdleHintAcc = 0;
  }

  private disarmPlayerIdleHint(): void {
    this.playerIdleHintArmed = false;
    this.playerIdleHintAcc = 0;
  }

  private clearLocationBannerTimer(): void {
    if (this.locationBannerHideTimer !== null) {
      clearTimeout(this.locationBannerHideTimer);
      this.locationBannerHideTimer = null;
    }
  }

  private hideLocationBanner(): void {
    this.clearLocationBannerTimer();
    this.els.locationBanner.classList.add('hidden');
  }

  private flashLocationBanner(
    text: string,
    kind: 'banner-player' | 'banner-ai',
    ms: number,
  ): void {
    this.clearLocationBannerTimer();
    this.els.locationBanner.textContent = text;
    this.els.locationBanner.classList.remove('hidden', 'banner-player', 'banner-ai');
    this.els.locationBanner.classList.add(kind);
    this.locationBannerHideTimer = setTimeout(() => {
      this.els.locationBanner.classList.add('hidden');
      this.locationBannerHideTimer = null;
    }, ms);
  }

  /**
   * Player-turn only: every PLAYER_IDLE_HINT_SEC while idle (not aiming),
   * flash the location marker + brief “Tu canica” cue.
   */
  private updatePlayerIdleHint(dt: number): void {
    if (!this.playerIdleHintArmed) return;
    if (
      this.phase !== 'playing' ||
      this.turn !== 'player' ||
      !this.playerMarble
    ) {
      this.disarmPlayerIdleHint();
      return;
    }
    // Pause while holding/aiming the marble — timer resumes (fresh) on release.
    if (this.aiming) return;

    this.playerIdleHintAcc += dt;
    if (this.playerIdleHintAcc < PLAYER_IDLE_HINT_SEC) return;
    this.playerIdleHintAcc = 0;
    this.showPlayerIdleMarbleHint();
  }

  private showPlayerIdleMarbleHint(): void {
    if (
      !this.playerMarble ||
      this.phase !== 'playing' ||
      this.turn !== 'player' ||
      this.aiming
    ) {
      return;
    }
    this.showLocationMarker(this.playerMarble, 'player');
    this.flashLocationBanner('Tu canica', 'banner-player', 1400);
    this.nudgeCameraTowardPlayerMarble();
  }

  /** Subtle look-at nudge toward the player marble (skipped if already framed). */
  private nudgeCameraTowardPlayerMarble(): void {
    if (!this.playerMarble || this.camEase?.active) return;
    const p = this.playerMarble.body.position;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return;

    const lookY = Math.max(MARBLE_RADIUS, Number.isFinite(p.y) ? p.y : MARBLE_RADIUS);
    const marble = new THREE.Vector3(p.x, lookY, p.z);
    const distLook = this.controls.target.distanceTo(marble);
    // Already looking near it — marker/banner is enough
    if (distLook < 0.08) return;

    const fromTarget = this.controls.target.clone();
    const toTarget = fromTarget.clone().lerp(marble, 0.4);
    const fromPos = this.camera.position.clone();
    // Soft pull closer along the current camera→marble vector
    const toPos = fromPos.clone().lerp(
      new THREE.Vector3(
        p.x + (fromPos.x - p.x) * 0.9,
        fromPos.y,
        p.z + (fromPos.z - p.z) * 0.9,
      ),
      0.22,
    );
    if (
      !Number.isFinite(toPos.x) ||
      !Number.isFinite(toTarget.x) ||
      !Number.isFinite(fromPos.x)
    ) {
      return;
    }
    this.controls.enableDamping = false;
    this.camEase = {
      active: true,
      t: 0,
      dur: 0.4,
      fromPos,
      toPos,
      fromTarget,
      toTarget,
    };
  }

  /**
   * Cinematic turn-start framing for player AND opponent:
   * - Camera sits BEHIND the active marble (outside the circle radially)
   * - lookAt is the marble mesh center → projects to true viewport center
   * - View direction continues through the marble toward the play circle
   *   (billiards-style aiming via camera)
   * Disables OrbitControls while easing (same prior pattern).
   */
  private easeCameraToward(shooter: MarbleEntity): void {
    const px = shooter.body.position.x;
    const py = shooter.body.position.y;
    const pz = shooter.body.position.z;
    if (!Number.isFinite(px) || !Number.isFinite(pz)) {
      this.camEase = null;
      this.fitCameraToArena(true);
      return;
    }

    const portrait = window.innerHeight > window.innerWidth;
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);

    // Radial outward from play-circle origin through the marble (= "behind")
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

    // Exact marble center — geometric screen center (no HUD look bias)
    const lookY = Number.isFinite(py) ? Math.max(MARBLE_RADIUS, py) : MARBLE_RADIUS;
    const look = new THREE.Vector3(px, lookY, pz);

    // Behind marble along radial; height chosen so lookAt keeps marble centered
    // (no lateral bias — that was offsetting the marble on screen)
    const back = portrait ? 0.26 : 0.34;
    const up = portrait ? 0.13 : 0.16;
    const toPos = new THREE.Vector3(
      px + dirX * back,
      up,
      pz + dirZ * back,
    );

    // FOV: slightly wider on tall phones so arena ahead stays in frame
    // while the marble still projects near dead-center
    this.camera.fov = portrait ? (aspect < 0.55 ? 52 : 46) : 40;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();

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

    // Pause orbit / damping while easing so controls cannot yank the view
    this.controls.enabled = false;
    this.controls.enableDamping = false;
    this.camEase = {
      active: true,
      t: 0,
      dur: 0.7,
      fromPos: this.camera.position.clone(),
      toPos,
      fromTarget: this.controls.target.clone(),
      toTarget: look,
    };
  }


  private buildAimLine(): void {
    const group = new THREE.Group();
    group.visible = false;
    group.renderOrder = 5;

    const shaftGeo = new THREE.CylinderGeometry(0.0012, 0.0012, 1, 8);
    shaftGeo.translate(0, 0.5, 0);
    const shaftMat = new THREE.MeshBasicMaterial({
      color: 0xffe08a,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      depthTest: false,
    });
    const shaft = new THREE.Mesh(shaftGeo, shaftMat);
    shaft.rotation.x = Math.PI / 2;

    const headGeo = new THREE.ConeGeometry(0.0045, 0.014, 12);
    headGeo.translate(0, 0.007, 0);
    const headMat = new THREE.MeshBasicMaterial({
      color: 0xfff3c4,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      depthTest: false,
    });
    const head = new THREE.Mesh(headGeo, headMat);
    head.rotation.x = Math.PI / 2;

    group.add(shaft);
    group.add(head);
    this.scene.add(group);
    this.aimLineGroup = group;
    this.aimShaft = shaft;
    this.aimHead = head;
  }

  private hideAimLine(): void {
    if (this.aimLineGroup) this.aimLineGroup.visible = false;
  }

  private updateAimLineVisual(): void {
    if (!this.aimLineGroup || !this.aimShaft || !this.aimHead || !this.playerMarble) {
      return;
    }
    // Push mode: no aim line (or extremely minimal — we hide).
    if (this.controlMode === 'push') {
      this.aimLineGroup.visible = false;
      return;
    }
    const len = Math.hypot(this.aimDirX, this.aimDirZ);
    if (len < 1e-6 || this.aimPower < 0.02) {
      this.aimLineGroup.visible = false;
      return;
    }
    const dx = this.aimDirX / len;
    const dz = this.aimDirZ / len;
    const px = this.playerMarble.body.position.x;
    const pz = this.playerMarble.body.position.z;
    const py = Math.max(MARBLE_RADIUS * 1.2, this.playerMarble.body.position.y);

    // Visual length scales with power (readable but not huge)
    const worldLen = MARBLE_RADIUS * (4 + this.aimPower * 22);
    this.aimLineGroup.position.set(px, py, pz);
    this.aimLineGroup.visible = true;

    // Shaft/head point along group +Z. Yaw from the SAME normalized aimDirX/Z
    // fed into applyImpulse — single source of truth (no extra camera yaw).
    this.aimLineGroup.rotation.set(0, Math.atan2(dx, dz), 0);

    this.aimShaft.scale.set(1, worldLen, 1);
    this.aimHead.position.set(0, 0, worldLen);
    const glow = 0.55 + this.aimPower * 0.45;
    (this.aimShaft.material as THREE.MeshBasicMaterial).opacity = glow;
    (this.aimHead.material as THREE.MeshBasicMaterial).opacity = Math.min(1, glow + 0.05);
  }

  private clientToGround(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    this._ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this._ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this._ndc, this.camera);
    const hit = this._groundHit;
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null;
    if (!Number.isFinite(hit.x) || !Number.isFinite(hit.z)) return null;
    return hit;
  }

  private projectMarbleToScreen(marble: MarbleEntity): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    this._tmpV.set(
      marble.body.position.x,
      Math.max(MARBLE_RADIUS, marble.body.position.y),
      marble.body.position.z,
    );
    this._tmpV.project(this.camera);
    return {
      x: (this._tmpV.x * 0.5 + 0.5) * rect.width + rect.left,
      y: (-this._tmpV.y * 0.5 + 0.5) * rect.height + rect.top,
    };
  }

  /**
   * True only when the pointer hits the player marble (visual radius × pick tolerance).
   * Empty space / ground never starts a shoot gesture — OrbitControls keeps those drags.
   */
  private picksPlayerMarble(clientX: number, clientY: number): boolean {
    if (!this.playerMarble) return false;
    const marble = this.playerMarble;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;

    // Screen pick: project marble center + a point one radius out → visual px radius
    const screen = this.projectMarbleToScreen(marble);
    this._tmpV.set(
      marble.body.position.x + MARBLE_RADIUS,
      Math.max(MARBLE_RADIUS, marble.body.position.y),
      marble.body.position.z,
    );
    this._tmpV.project(this.camera);
    const edgeX = (this._tmpV.x * 0.5 + 0.5) * rect.width + rect.left;
    const edgeY = (-this._tmpV.y * 0.5 + 0.5) * rect.height + rect.top;
    const visualR = Math.max(10, Math.hypot(edgeX - screen.x, edgeY - screen.y));
    const touchR = visualR * MARBLE_PICK_TOLERANCE;
    if (Math.hypot(clientX - screen.x, clientY - screen.y) <= touchR) return true;

    // World pick: ray vs expanded sphere (same tolerance)
    this._ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this._ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this._ndc, this.camera);
    const cx = marble.body.position.x;
    const cy = marble.body.position.y;
    const cz = marble.body.position.z;
    const ray = this.raycaster.ray;
    const ocx = cx - ray.origin.x;
    const ocy = cy - ray.origin.y;
    const ocz = cz - ray.origin.z;
    const t = ocx * ray.direction.x + ocy * ray.direction.y + ocz * ray.direction.z;
    const closestT = Math.max(0, t);
    const qx = ray.origin.x + ray.direction.x * closestT - cx;
    const qy = ray.origin.y + ray.direction.y * closestT - cy;
    const qz = ray.origin.z + ray.direction.z * closestT - cz;
    const pickR = MARBLE_RADIUS * MARBLE_PICK_TOLERANCE;
    if (qx * qx + qy * qy + qz * qz <= pickR * pickR) return true;

    // Ground footprint under the marble (finger slightly off the top of a small sphere)
    const g = this.clientToGround(clientX, clientY);
    if (g && Math.hypot(g.x - cx, g.z - cz) <= pickR) return true;
    return false;
  }

  private noteAimSample(x: number, y: number): void {
    const t = performance.now();
    // Bake ground hits at sample time so a second-finger orbit cannot
    // re-unproject old screen samples with a moved camera.
    const g = this.clientToGround(x, y);
    this.aimSamples.push({
      t,
      x,
      y,
      gx: g ? g.x : undefined,
      gz: g ? g.z : undefined,
    });
    while (this.aimSamples.length > 1 && t - this.aimSamples[0]!.t > 120) {
      this.aimSamples.shift();
    }
  }

  private getAimSwipeSpeed(): number {
    if (this.aimSamples.length < 2) return 0;
    // Peak screen speed over recent segments (fast flicks register)
    let peak = 0;
    for (let i = 1; i < this.aimSamples.length; i++) {
      const a = this.aimSamples[i - 1]!;
      const b = this.aimSamples[i]!;
      const dt = Math.max(1, b.t - a.t) / 1000;
      const sp = Math.hypot(b.x - a.x, b.y - a.y) / dt;
      if (sp > peak) peak = sp;
    }
    const a = this.aimSamples[0]!;
    const b = this.aimSamples[this.aimSamples.length - 1]!;
    const dtAll = Math.max(1, b.t - a.t) / 1000;
    const avg = Math.hypot(b.x - a.x, b.y - a.y) / dtAll;
    return Math.max(peak, avg);
  }

  /**
   * Finger velocity on the ground plane (m/s) from recent baked samples.
   * Uses peak segment speed so a quick swipe isn't washed out by a long hold.
   */
  private getAimWorldSwipeVelocity(): { vx: number; vz: number; speed: number } {
    if (this.aimSamples.length < 2) return { vx: 0, vz: 0, speed: 0 };

    let bestVx = 0;
    let bestVz = 0;
    let bestSpeed = 0;
    let sumVx = 0;
    let sumVz = 0;
    let sumW = 0;

    for (let i = 1; i < this.aimSamples.length; i++) {
      const a = this.aimSamples[i - 1]!;
      const b = this.aimSamples[i]!;
      if (
        a.gx === undefined ||
        a.gz === undefined ||
        b.gx === undefined ||
        b.gz === undefined
      ) {
        continue;
      }
      const dt = Math.max(0.008, (b.t - a.t) / 1000);
      // Prefer the freshest ~70 ms of motion for the weighted average
      const age = Math.max(0, this.aimSamples[this.aimSamples.length - 1]!.t - b.t);
      if (age > 70) continue;
      const vx = (b.gx - a.gx) / dt;
      const vz = (b.gz - a.gz) / dt;
      const speed = Math.hypot(vx, vz);
      const w = dt * (1 + (70 - age) / 70);
      sumVx += vx * w;
      sumVz += vz * w;
      sumW += w;
      if (speed > bestSpeed) {
        bestSpeed = speed;
        bestVx = vx;
        bestVz = vz;
      }
    }

    if (sumW > 1e-8) {
      const avgVx = sumVx / sumW;
      const avgVz = sumVz / sumW;
      const avgSpeed = Math.hypot(avgVx, avgVz);
      // Blend peak (responsive) with recent average (stable)
      if (bestSpeed > avgSpeed * 1.15) {
        return { vx: bestVx, vz: bestVz, speed: bestSpeed };
      }
      return { vx: avgVx, vz: avgVz, speed: avgSpeed };
    }

    if (bestSpeed > 1e-8) return { vx: bestVx, vz: bestVz, speed: bestSpeed };
    return { vx: 0, vz: 0, speed: 0 };
  }

  /**
   * Single source of truth for flick aim: ground-plane direction from the
   * marble center to the finger's ground hit (same vector for guide + impulse).
   */
  private computeAimDirFromPointer(
    clientX: number,
    clientY: number,
  ): { dx: number; dz: number } {
    const marble = this.playerMarble;
    if (!marble) return { dx: this.aimDirX, dz: this.aimDirZ };

    const mx = marble.body.position.x;
    const mz = marble.body.position.z;
    const g = this.clientToGround(clientX, clientY);
    let dx = 0;
    let dz = 0;
    if (g) {
      dx = g.x - mx;
      dz = g.z - mz;
    }
    // Fallback: screen drag mapped onto camera ground-forward / right
    if (Math.hypot(dx, dz) < 1e-6) {
      this.camera.getWorldDirection(this._aimFwd);
      this._aimFwd.y = 0;
      if (this._aimFwd.lengthSq() < 1e-10) this._aimFwd.set(0, 0, -1);
      this._aimFwd.normalize();
      this._aimRight.set(this._aimFwd.z, 0, -this._aimFwd.x);
      const sx = (clientX - this.aimStartClientX) / 120;
      const sy = (clientY - this.aimStartClientY) / 120;
      // Screen +Y is down; dragging up = camera forward
      dx = this._aimRight.x * sx + this._aimFwd.x * -sy;
      dz = this._aimRight.z * sx + this._aimFwd.z * -sy;
    }
    const len = Math.hypot(dx, dz);
    if (len < 1e-8) return { dx: this.aimDirX, dz: this.aimDirZ };
    return { dx: dx / len, dz: dz / len };
  }

  private recomputeAimFromPointer(clientX: number, clientY: number): void {
    if (!this.playerMarble) return;
    const dragPx = Math.hypot(clientX - this.aimStartClientX, clientY - this.aimStartClientY);
    const speed = this.getAimSwipeSpeed();
    const world = this.getAimWorldSwipeVelocity();

    const dir = this.computeAimDirFromPointer(clientX, clientY);
    this.aimDirX = dir.dx;
    this.aimDirZ = dir.dz;

    this.aimPower =
      this.controlMode === 'push'
        ? powerFromPush(dragPx, speed, world.speed)
        : powerFromFlick(dragPx, speed);
    this.updateAimLineVisual();
  }

  private cancelAimGesture(_reenableControls: boolean): void {
    const pid = this.aimPointerId;
    this.aiming = false;
    this.aimPointerId = null;
    this.aimSamples = [];
    this.aimPower = 0;
    this.hideAimLine();
    if (pid !== null) {
      try {
        this.canvas.releasePointerCapture(pid);
      } catch {
        /* ignore */
      }
    }
    // Keep OrbitControls enabled during aim so a second finger can orbit;
    // never leave them disabled after cancel (unless a camera ease owns them).
    if (!this.camEase?.active) this.controls.enabled = true;
  }

  private onAimPointerDown(e: PointerEvent): void {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (this.phase !== 'playing' || this.turn !== 'player' || !this.playerMarble) return;

    // Already aiming with another pointer → ignore this down for shoot;
    // do NOT stopPropagation so OrbitControls can orbit/pan with it.
    if (this.aiming) return;
    if (!this.canPlayerShoot) return;

    // Miss → OrbitControls owns the drag (empty-space single finger = camera)
    if (!this.picksPlayerMarble(e.clientX, e.clientY)) return;

    // Claim ONLY this pointerId so OrbitControls never starts a rotate on it.
    // Leave controls.enabled = true: a second non-marble finger can still orbit.
    e.preventDefault();
    e.stopImmediatePropagation();
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.aiming = true;
    this.canPlayerShoot = false;
    // Touching marble resets the idle Tu canica timer; hide cue while gesturing
    this.armPlayerIdleHint();
    this.markerGroup.visible = false;
    this.hideLocationBanner();
    this.aimPointerId = e.pointerId;
    this.aimStartClientX = e.clientX;
    this.aimStartClientY = e.clientY;
    this.aimSamples = [];
    this.noteAimSample(e.clientX, e.clientY);
    this.aimPower = 0;
    // Default aim along camera forward until drag establishes direction
    this.camera.getWorldDirection(this._aimFwd);
    this._aimFwd.y = 0;
    if (this._aimFwd.lengthSq() < 1e-10) {
      const p = this.playerMarble.body.position;
      this._aimFwd.set(-p.x, 0, -p.z);
    }
    this._aimFwd.normalize();
    this.aimDirX = this._aimFwd.x;
    this.aimDirZ = this._aimFwd.z;
    this.hideAimLine();
  }

  private onAimPointerMove(e: PointerEvent): void {
    if (!this.aiming || this.aimPointerId !== e.pointerId) return;
    // Keep OrbitControls from seeing the aim pointer's moves
    e.stopImmediatePropagation();
    this.noteAimSample(e.clientX, e.clientY);
    this.recomputeAimFromPointer(e.clientX, e.clientY);
  }

  private onAimPointerCancel(e: PointerEvent): void {
    if (!this.aiming) return;
    if (this.aimPointerId !== null && e.pointerId !== this.aimPointerId) return;
    this.cancelAimGesture(true);
    this.canPlayerShoot = this.phase === 'playing' && this.turn === 'player';
    if (this.canPlayerShoot) this.armPlayerIdleHint();
    else this.disarmPlayerIdleHint();
  }

  private onAimPointerUp(e: PointerEvent): void {
    if (!this.aiming) return;
    if (this.aimPointerId !== null && e.pointerId !== this.aimPointerId) return;
    e.preventDefault();
    e.stopImmediatePropagation();

    this.noteAimSample(e.clientX, e.clientY);
    this.recomputeAimFromPointer(e.clientX, e.clientY);
    const dragPx = Math.hypot(e.clientX - this.aimStartClientX, e.clientY - this.aimStartClientY);
    const speed = this.getAimSwipeSpeed();
    const world = this.getAimWorldSwipeVelocity();
    const power01 = this.aimPower;
    // Capture the SAME aimDir the guide was drawn with
    const dirX = this.aimDirX;
    const dirZ = this.aimDirZ;
    const mode = this.controlMode;

    this.cancelAimGesture(true);

    if (!this.playerMarble || this.phase !== 'playing' || this.turn !== 'player') {
      return;
    }
    if (!isGestureStrongEnough(mode, dragPx, speed, world.speed)) {
      this.canPlayerShoot = true;
      this.armPlayerIdleHint();
      return;
    }

    if (mode === 'push') {
      this.startThrow('player', dirX, dirZ, Math.max(0.08, Math.min(1, power01)), {
        pushVx: world.vx,
        pushVz: world.vz,
      });
    } else {
      this.startThrow('player', dirX, dirZ, Math.max(0.08, Math.min(1, power01)));
    }
  }

  private startThrow(
    side: Side,
    dirX: number,
    dirZ: number,
    power01: number,
    push?: { pushVx: number; pushVz: number },
  ): void {
    const shooter = side === 'player' ? this.playerMarble : this.aiMarble;
    if (!shooter) return;

    this.throwPendingImpulse = {
      side,
      dirX,
      dirZ,
      power01,
      pushVx: push?.pushVx,
      pushVz: push?.pushVz,
    };
    // Apply immediately (no hand wind-up)
    this.applyPendingImpulse();

    this.canPlayerShoot = false;
    this.disarmPlayerIdleHint();
    this.markerGroup.visible = false;
    this.hideLocationBanner();
    this.hideAimLine();
    this.setPhase('shot_flying');
    this.shotSettleTimer = performance.now();
    this.lastScorer = side;
    this.scoringEnabled = true;
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

    // Push mode: map finger world velocity → heavy marble exit + roll spin
    if (
      pending.pushVx !== undefined &&
      pending.pushVz !== undefined &&
      Number.isFinite(pending.pushVx) &&
      Number.isFinite(pending.pushVz)
    ) {
      let vx = pending.pushVx * PUSH_VELOCITY_GAIN;
      let vz = pending.pushVz * PUSH_VELOCITY_GAIN;
      let speed = Math.hypot(vx, vz);
      // Fallback: if world samples were tiny, use aim dir × power-scaled speed
      if (speed < 0.05) {
        const fallback = 0.15 + pending.power01 * (PUSH_MAX_SPEED - 0.15);
        vx = pending.dirX * fallback;
        vz = pending.dirZ * fallback;
        speed = fallback;
      }
      if (speed > PUSH_MAX_SPEED && speed > 1e-8) {
        const s = PUSH_MAX_SPEED / speed;
        vx *= s;
        vz *= s;
        speed = PUSH_MAX_SPEED;
      }
      // Slight upward so it doesn't dig into the ground; keep heavy (small hop)
      const vy = Math.min(0.12, speed * 0.04);
      body.velocity.set(vx, vy, vz);
      // Rolling spin: ω ≈ v × n / r  (tangential shove → linear + angular)
      const invR = 1 / Math.max(1e-6, MARBLE_RADIUS);
      const spinScale = 0.85; // a bit under pure rolling so it feels like a shove
      body.angularVelocity.set(-vz * invR * spinScale, 0, vx * invR * spinScale);
      return;
    }

    // Flick / AI: impulse along aim direction (horizontal) — billiard-style cue strike.
    // Marble–marble collisions then transfer momentum along the contact normal
    // via cannon-es (no custom velocity overrides).
    const impulseMag = impulseFromPower(pending.power01);
    // relativePoint is offset from COM — must be zero or shot veers (was body.position).
    body.applyImpulse(
      new CANNON.Vec3(
        pending.dirX * impulseMag,
        impulseMag * 0.08,
        pending.dirZ * impulseMag,
      ),
      new CANNON.Vec3(0, 0, 0),
    );
  }

  private updateScoreAndWin(): boolean {
    // Score only while a shot is in flight (human or opponent). Never during drop/settle.
    if (this.phase !== 'shot_flying' || !this.scoringEnabled) {
      return false;
    }

    for (const m of this.fieldMarbles) {
      if (!m.active) continue;
      const dist = Math.hypot(m.body.position.x, m.body.position.z);
      const out = dist > CIRCLE_RADIUS + OUT_MARGIN;
      const fallen = m.body.position.y < -0.05;

      if (!(out || fallen)) continue;

      const eligible =
        this.scoringMarbles.has(m) &&
        !this.playerKnocked.has(m) &&
        !this.aiKnocked.has(m);

      if (eligible) {
        const scorer = this.lastScorer ?? this.turn;
        const kx = m.body.position.x;
        const ky = Math.max(MARBLE_RADIUS * 2, m.body.position.y);
        const kz = m.body.position.z;
        if (scorer === 'player') {
          this.playerKnocked.add(m);
          this.playerScore = this.playerKnocked.size;
          this.playerMoney += MONEY_PER_KNOCKOUT;
          this.celebratePlayerKnockout(kx, ky, kz);
        } else {
          this.aiKnocked.add(m);
          this.aiScore = this.aiKnocked.size;
          this.particles?.spawnMoney(kx, ky, kz, true);
        }
        this.scoringMarbles.delete(m);
        this.updateScoreHUD();
        this.enterSlowMo(m);
      }

      if (fallen || dist > DESPAWN_DIST) {
        m.active = false;
        m.mesh.visible = false;
        m.body.velocity.setZero();
        m.body.angularVelocity.setZero();
        m.body.position.y = -1;
        m.body.type = CANNON.Body.STATIC;
      }
    }

    // End when no scoring-set marbles remain in play (all knocked or none ever eligible)
    if (this.scoringMarbles.size === 0 && this.fieldMarbles.length > 0) {
      this.endGame();
      return true;
    }
    return false;
  }


  private endGame(): void {
    this.setPhase('ended');
    this.canPlayerShoot = false;
    this.disarmPlayerIdleHint();
    this.hideLocationBanner();
    this.cancelAimGesture(true);
    this.els.powerWrap.classList.add('hidden');
    this.controls.enabled = true;
    this.markerGroup.visible = false;
    this.camEase = null;

    const p = this.playerScore;
    const a = this.aiScore;
    if (p > a) {
      this.els.endTitle.textContent = '¡Victoria!';
      this.els.endMessage.textContent =
        `Sacaste más canicas del círculo que ${this.opponentName}.`;
      this.level += 1;
    } else if (a > p) {
      this.els.endTitle.textContent = 'Derrota';
      this.els.endMessage.textContent =
        `${this.opponentName} sacó más canicas. ¡Inténtalo de nuevo!`;
    } else {
      this.els.endTitle.textContent = 'Empate';
      this.els.endMessage.textContent =
        'Misma cantidad de canicas fuera. ¡Casi!';
    }
    this.els.endScore.textContent =
      `Jugador ${p} ($${this.playerMoney}) · ${this.opponentName} ${a}  (Nivel ${this.level})`;
    this.els.endScreen.classList.remove('hidden');
    this.updateTurnHUD();
  }

  private restart(): void {
    this.els.endScreen.classList.add('hidden');
    this.clearFieldMarbles();
    this.removeShooter('player');
    this.removeShooter('ai');
    this.disarmPlayerIdleHint();
    this.hideLocationBanner();
    this.cancelAimGesture(true);
    this.els.powerWrap.classList.add('hidden');
    this.els.powerBar.style.width = '0%';
    this.controls.enabled = true;
    this.markerGroup.visible = false;
    this.recording = true;
    this.camEase = null;
    this.throwPendingImpulse = null;
    this.particles?.clear();
    this.dirtCooldown.clear();
    this.rollOpponentName();
    this.setPhase('ready');
  }

  private startReplay(): void {
    if (this.phase === 'replay') return;
    const frames = this.replay.snapshot();
    if (frames.length < 30) return;

    this.phaseBeforeReplay = this.phase;
    // Hide end screen during replay so the scene is visible
    this.els.endScreen.classList.add('hidden');

    this.cancelAimGesture(true);
    this.els.powerWrap.classList.add('hidden');
    // Free camera during replay — user can orbit/pinch while scrubbing
    this.controls.enabled = true;
    this.controls.enableDamping = true;
    this.canPlayerShoot = false;
    this.disarmPlayerIdleHint();
    this.hideLocationBanner();
    this.markerGroup.visible = false;
    this.recording = false;
    this.camEase = null;

    this.replayPlaying = frames;
    this.replayIndex = 0;
    this.replayAcc = 0;
    this.replayPaused = false;
    this.replaySpeed = parseFloat(this.els.replaySpeed.value) || 1;
    this.replayScrubbing = false;
    this.els.replayControls.classList.remove('hidden');
    this.els.replayScrub.value = '0';
    this.syncReplayPlayButton();
    this.setPhase('replay');
    this.els.instructions.textContent =
      'Repetición: órbita libre · pellizca zoom · usa la barra para pausar/rebobinar';
  }

  private finishReplay(): void {
    this.replayPlaying = [];
    this.recording = true;
    this.controls.enabled = true;
    this.els.replayControls.classList.add('hidden');
    this.replayPaused = false;
    this.replayScrubbing = false;
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
      this.canPlayerShoot = true;
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
    // Camera is NOT restored from the frame — free orbit/zoom while replaying.
    this.playerScore = frame.playerScore;
    this.aiScore = frame.aiScore;
    this.turn = frame.turn;
    this.updateScoreHUD();
    this.updateTurnHUD();
    if (this.replayPlaying.length > 1) {
      const t = this.replayIndex / (this.replayPlaying.length - 1);
      this.els.replayScrub.value = String(Math.round(t * 1000));
    }
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

    this.exitSlowMo(true);
    this.scoringEnabled = false;

    // Keep shooters where they stopped (dynamic → freeze for next turn)
    for (const m of [this.playerMarble, this.aiMarble]) {
      if (!m) continue;
      m.body.velocity.setZero();
      m.body.angularVelocity.setZero();
      m.body.type = CANNON.Body.KINEMATIC;
      this.snapMarblePhysics(m, true);
      this.syncOneMesh(m);
      if (m.body.position.y < MARBLE_REST_Y) {
        m.body.position.y = MARBLE_REST_Y;
      }
      if (
        !Number.isFinite(m.body.position.x) ||
        !Number.isFinite(m.body.position.z)
      ) {
        const sideDist = CIRCLE_RADIUS + MARBLE_RADIUS * 3.5;
        const x = m.owner === 'player' ? sideDist : -sideDist;
        m.body.position.set(x, MARBLE_REST_Y, 0);
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


  private entityFromBody(body: CANNON.Body): MarbleEntity | null {
    if (this.playerMarble && this.playerMarble.body === body) return this.playerMarble;
    if (this.aiMarble && this.aiMarble.body === body) return this.aiMarble;
    for (const m of this.fieldMarbles) {
      if (m.body === body) return m;
    }
    return null;
  }

  private isMarbleBody(body: CANNON.Body): boolean {
    if (this.playerMarble && body === this.playerMarble.body) return true;
    if (this.aiMarble && body === this.aiMarble.body) return true;
    for (const m of this.fieldMarbles) {
      if (m.active && body === m.body) return true;
    }
    return false;
  }


  /** Sparks on hard marble–marble hits; dirt on ground scrapes / hard landings. */
  private processImpactFX(): void {
    if (!this.particles) return;
    if (
      this.phase !== 'shot_flying' &&
      this.phase !== 'settling' &&
      this.phase !== 'dropping'
    ) {
      return;
    }

    const now = performance.now();
    const contacts = this.world.contacts;
    for (let i = 0; i < contacts.length; i++) {
      const c = contacts[i]!;
      const bi = c.bi;
      const bj = c.bj;
      const impact = Math.abs(c.getImpactVelocityAlongNormal());

      const mi = this.isMarbleBody(bi);
      const mj = this.isMarbleBody(bj);
      if (mi && mj && impact > 0.35 && now > this.sparkCooldownUntil) {
        // Contact point in world space
        const nx = c.ni.x;
        const ny = c.ni.y;
        const nz = c.ni.z;
        const px = bi.position.x - nx * MARBLE_RADIUS;
        const py = bi.position.y - ny * MARBLE_RADIUS;
        const pz = bi.position.z - nz * MARBLE_RADIUS;
        const intensity = Math.min(2.2, impact / 0.6);
        this.particles.spawnSparks(px, py, pz, intensity);
        this.sparkCooldownUntil = now + 55;
        // Cámara lenta on heavy collisions — follow the faster marble
        if (impact >= SLOWMO_IMPACT_THRESHOLD && this.phase === 'shot_flying') {
          const bodyA = bi;
          const bodyB = bj;
          const followBody =
            bodyA.velocity.length() >= bodyB.velocity.length() ? bodyA : bodyB;
          const followEnt = this.entityFromBody(followBody);
          if (followEnt) this.enterSlowMo(followEnt);
        }
      }

      // Ground contact: one marble, other roughly static plane (mass 0)
      if (impact > 0.55 && (mi || mj)) {
        const marbleBody = mi ? bi : bj;
        const other = mi ? bj : bi;
        if (other.mass === 0 && marbleBody.position.y < MARBLE_RADIUS * 3) {
          const speed = marbleBody.velocity.length();
          if (speed > 0.25) {
            const intensity = Math.min(0.65, speed / 1.6);
            this.particles.spawnDirt(
              marbleBody.position.x,
              PLAY_SURFACE_Y + 0.001,
              marbleBody.position.z,
              intensity,
            );
          }
        }
      }
    }
  }

  /** Continuous dirt when marbles scrape/roll fast — kept tiny & sparse. */
  private processDirtRollFX(dt: number): void {
    if (!this.particles) return;
    if (this.phase !== 'shot_flying' && this.phase !== 'settling') return;

    const list: MarbleEntity[] = [...this.fieldMarbles];
    if (this.playerMarble) list.push(this.playerMarble);
    if (this.aiMarble) list.push(this.aiMarble);

    for (const m of list) {
      if (!m.active) continue;
      const body = m.body;
      if (body.type === CANNON.Body.KINEMATIC) continue;
      const y = body.position.y;
      if (y > MARBLE_RADIUS * 2.5) continue;
      const speed = body.velocity.length();
      // Higher threshold so only fast scrapes kick dust
      if (speed < 0.55) continue;

      const key = body as unknown as object;
      const cd = this.dirtCooldown.get(key) ?? 0;
      const next = cd - dt;
      if (next > 0) {
        this.dirtCooldown.set(key, next);
        continue;
      }
      const intensity = Math.min(0.7, (speed - 0.45) / 1.4);
      this.particles.spawnDirt(
        body.position.x,
        PLAY_SURFACE_Y + 0.001,
        body.position.z,
        intensity,
      );
      // Sparse cadence — never a dust cloud
      this.dirtCooldown.set(key, Math.max(0.18, 0.38 - intensity * 0.08));
    }
  }

  private updateMarker(dt: number): void {
    if (!this.markerGroup.visible) return;
    this.markerLife -= dt;
    if (this.markerHintBoost > 0) this.markerHintBoost -= dt;
    const boost = this.markerHintBoost > 0;
    const t = performance.now();
    const amp = boost ? 0.28 : 0.1;
    const freq = boost ? 0.014 : 0.008;
    const pulse = 1 + Math.sin(t * freq) * amp;
    this.markerRing.scale.setScalar(pulse);
    const ringMat = this.markerRing.material as THREE.MeshBasicMaterial;
    const beamMat = this.markerBeam.material as THREE.MeshBasicMaterial;
    ringMat.opacity = boost ? 0.55 + 0.4 * (0.5 + 0.5 * Math.sin(t * 0.012)) : 0.9;
    beamMat.opacity = boost ? 0.75 : 0.55;
    this.markerArrow.position.y =
      0.115 + Math.sin(t * (boost ? 0.014 : 0.01)) * (boost ? 0.018 : 0.01);
    // Keep tip pointing DOWN at the marble; spin around vertical only
    this.markerArrow.rotation.x = Math.PI;
    this.markerArrow.rotation.y += dt * (boost ? 4.2 : 2.5);
    if (this.markerLife <= 0) {
      this.markerGroup.visible = false;
      this.markerHintBoost = 0;
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
      this.controls.enableDamping = true;
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
      this.controls.enableDamping = true;
      this.controls.enabled = true;
      // Sync OrbitControls internal spherical from final pose
      this.controls.update();
    }
  }


  private enterSlowMo(follow: MarbleEntity): void {
    if (this.phase === 'replay') return;
    // Capture camera offset relative to follow target so we can keep framing it
    const fp = follow.body.position;
    this._slowMoCamOffset.set(
      this.camera.position.x - fp.x,
      this.camera.position.y - fp.y,
      this.camera.position.z - fp.z,
    );
    // Prefer a readable chase offset if current offset is tiny/odd
    if (this._slowMoCamOffset.length() < 0.08) {
      this._slowMoCamOffset.set(0.12, 0.14, 0.18);
    }
    this.slowMoFollow = follow;
    this.slowMoTimer = SLOWMO_DURATION;
    this.timeScale = SLOWMO_SCALE;
    this.camEase = null;
    this.controls.enabled = false;
  }

  private exitSlowMo(resync = true): void {
    const was = this.timeScale < 0.999;
    this.timeScale = 1;
    this.slowMoTimer = 0;
    this.slowMoFollow = null;
    if (!was && !resync) return;
    if (resync) {
      // Fix half-buried / desynced transforms after time-scale change
      for (const m of this.fieldMarbles) {
        if (!m.active) continue;
        this.snapMarblePhysics(m, false);
        this.syncOneMesh(m);
      }
      for (const m of [this.playerMarble, this.aiMarble]) {
        if (!m) continue;
        this.snapMarblePhysics(m, false);
        this.syncOneMesh(m);
      }
    }
    if (this.phase === 'playing' || this.phase === 'ai_thinking' || this.phase === 'shot_flying') {
      this.controls.enabled = true;
      this.controls.enableDamping = true;
    }
  }

  private updateSlowMo(realDt: number): void {
    if (this.slowMoTimer <= 0) return;
    this.slowMoTimer -= realDt;
    const follow = this.slowMoFollow;
    if (follow && follow.active) {
      const fp = follow.body.position;
      // Continuously follow + look at the relevant marble for the whole slow-mo window
      this.camera.position.set(
        fp.x + this._slowMoCamOffset.x,
        Math.max(0.08, fp.y + this._slowMoCamOffset.y),
        fp.z + this._slowMoCamOffset.z,
      );
      this.controls.target.set(fp.x, Math.max(MARBLE_RADIUS, fp.y), fp.z);
      this.camera.lookAt(this.controls.target);
    }
    if (this.slowMoTimer <= 0) {
      this.exitSlowMo(true);
    }
  }

  private update(): void {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.liveTime += dt;
    this.dayNightTime += dt;
    this.syncDayNight();
    this.parkLife?.update(dt);

    if (this.phase === 'replay') {
      this.updateMoneyHudTarget();
      this.particles?.update(dt);
      if (!this.replayPaused && !this.replayScrubbing && this.replayPlaying.length > 0) {
        this.replayAcc += dt * this.replaySpeed;
        const step = 1 / REPLAY_FPS;
        while (this.replayAcc >= step && this.replayIndex < this.replayPlaying.length) {
          this.replayAcc -= step;
          this.playReplayFrame(this.replayPlaying[this.replayIndex]!);
          this.replayIndex++;
        }
        if (this.replayIndex >= this.replayPlaying.length) {
          // Freeze on last frame — user exits via Salir / Stop
          this.replayIndex = this.replayPlaying.length - 1;
          this.replayPaused = true;
          this.syncReplayPlayButton();
          if (this.replayPlaying[this.replayIndex]) {
            this.playReplayFrame(this.replayPlaying[this.replayIndex]!);
          }
        }
      }
      if (!this.camEase?.active) {
        this.controls.update();
      }
      this.renderer.render(this.scene, this.camera);
      return;
    }

    // Scale physics dt during cámara lenta (visual dt stays real-time for camera follow)
    const physDt = dt * this.timeScale;
    this.world.step(1 / 60, physDt, 4);
    this.updateSlowMo(dt);
    this.processImpactFX();
    this.processDirtRollFX(dt);
    this.updateMoneyHudTarget();
    this.particles?.update(dt);

    if (this.aiming && this.playerMarble) {
      this.updateAimLineVisual();
    }

    if (this.phase === 'settling') {
      const now = performance.now();
      // Always wait DROP_FREEZE_MS after drop, then hard-stop field marbles in place.
      if (now - this.settleStart >= DROP_FREEZE_MS) {
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

    this.updatePlayerIdleHint(dt);
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


  /** Satisfying feedback + money burst flying toward the saldo HUD. */
  private celebratePlayerKnockout(x: number, y: number, z: number): void {
    this.particles?.spawnMoney(x, y, z, false);
    this.particles?.spawnSparks(x, y + 0.01, z, 1.6);
    this.triggerScreenPunch();
    this.showMoneyToast();
    this.els.scorePlayerSide.classList.remove('money-flash');
    void this.els.scorePlayerSide.offsetWidth;
    this.els.scorePlayerSide.classList.add('money-flash');
  }

  private triggerScreenPunch(): void {
    this.els.punchOverlay.classList.remove('punch');
    this.els.gameRoot.classList.remove('punch-shake');
    void this.els.punchOverlay.offsetWidth;
    this.els.punchOverlay.classList.add('punch');
    this.els.gameRoot.classList.add('punch-shake');
    window.setTimeout(() => {
      this.els.punchOverlay.classList.remove('punch');
      this.els.gameRoot.classList.remove('punch-shake');
    }, 340);
  }

  private showMoneyToast(): void {
    this.els.moneyToast.textContent = `+$${MONEY_PER_KNOCKOUT}`;
    this.els.moneyToast.classList.remove('hidden');
        window.setTimeout(() => {
      this.els.moneyToast.classList.add('hidden');
    }, 900);
  }

  /** Project the score/saldo HUD into a world point so money particles home in. */
  private updateMoneyHudTarget(): void {
    if (!this.particles) return;
    const el = this.els.scoreMoney;
    const rect = el.getBoundingClientRect();
    const ndcX = ((rect.left + rect.width * 0.5) / window.innerWidth) * 2 - 1;
    const ndcY = -((rect.top + rect.height * 0.5) / window.innerHeight) * 2 + 1;
    const v = new THREE.Vector3(ndcX, ndcY, 0.35).unproject(this.camera);
    this.particles.setHudTarget(v.x, v.y, v.z);
  }

  private syncReplayPlayButton(): void {
    this.els.replayBtnPlay.textContent = this.replayPaused ? '▶' : '⏸';
    this.els.replayBanner.textContent = this.replayPaused
      ? '⏸ Repetición (pausa) — órbita libre'
      : '▶ Repetición — órbita libre';
  }

  private toggleReplayPlay(): void {
    if (this.phase !== 'replay') return;
    if (this.replayIndex >= this.replayPlaying.length - 1 && this.replayPaused) {
      this.replayIndex = 0;
      this.replayAcc = 0;
    }
    this.replayPaused = !this.replayPaused;
    this.syncReplayPlayButton();
  }

  private nudgeReplay(deltaFrames: number): void {
    if (this.phase !== 'replay' || this.replayPlaying.length === 0) return;
    this.replayPaused = true;
    this.replayIndex = Math.max(
      0,
      Math.min(this.replayPlaying.length - 1, this.replayIndex + deltaFrames),
    );
    this.replayAcc = 0;
    this.playReplayFrame(this.replayPlaying[this.replayIndex]!);
    this.syncReplayPlayButton();
  }

  private stopReplayPlayback(): void {
    if (this.phase !== 'replay' || this.replayPlaying.length === 0) return;
    this.replayPaused = true;
    this.replayIndex = 0;
    this.replayAcc = 0;
    this.playReplayFrame(this.replayPlaying[0]!);
    this.syncReplayPlayButton();
  }

  private onResize(): void {
    this.fitCameraToArena(false);
  }
}
