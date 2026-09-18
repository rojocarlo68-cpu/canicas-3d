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
  KNOCKOUT_PUNCH_IN,
  KNOCKOUT_PUNCH_HOLD,
  KNOCKOUT_PUNCH_ZOOM,
  AI_DIRECTOR_MIN_CUT,
  AI_DIRECTOR_MAX_CUTS,
  MARBLE_PICK_TOLERANCE,
  PUSH_MAX_SPEED,
  PUSH_VELOCITY_GAIN,
  PLAYER_IDLE_HINT_SEC,
} from './constants';
import {
  pickDirectorSubject,
  framingForDirectorMode,
  nextDirectorMode,
  directorModeDuration,
  directorBlendDuration,
  type DirectorMode,
} from './cameraDirector';
import {
  requireSceneLevel,
  sceneLevelLabel,
  buildGameHref,
  buildMenuHref,
  type SceneLevel,
} from './levelSelect';
import { buildDesertCamp, type DesertCampBuild } from './desertCamp';
import { playMarbleClack, unlockMarbleAudio, installMarbleAudioUnlock } from './marbleSounds';
import {
  createSpyBriefcase,
  resetBriefcase,
  triggerBriefcaseDrop,
  updateBriefcase,
  type SpyBriefcase,
} from './briefcase';
import { loadSave, unlockLevel, addToCollection } from './save';
import {
  createDesignFromSeed,
  randomMarbleSeed,
  paramsFromSeed,
  paintSeedPreview,
} from './proceduralMarble';
import { openGalleryFromGame } from './titleMenu';
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
import { SportsCommentator } from './commentator';
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
  private briefcase!: SpyBriefcase;
  private sky!: Sky;
  private sunLight!: THREE.DirectionalLight;
  private hemiLight!: THREE.HemisphereLight;
  private playFillLight!: THREE.PointLight;
  private streetLamps: StreetLamp[] = [];
  private parkLife: ParkLife | null = null;
  private desertCamp: DesertCampBuild | null = null;
  /** Map / scene from URL (?level=1 park, ?level=2 desert camp). */
  private sceneLevel: SceneLevel = requireSceneLevel(1);
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
  private paused = false;
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

  /** Desktop: RMB drag while LMB-aiming orbits the camera (touch: 2nd finger). */
  private rmbOrbiting = false;
  private rmbLastX = 0;
  private rmbLastY = 0;
  private pendingContinueLevel: SceneLevel | null = null;

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
  private commentator: SportsCommentator | null = null;

  /** Field marbles still inside the circle after the post-drop freeze (scoring set). */
  private scoringMarbles = new Set<MarbleEntity>();
  /** Only award score for knockouts during a player/AI shot. */
  private scoringEnabled = false;

  /** Physics time scale (1 = normal, <1 = cámara lenta). */
  private timeScale = 1;
  private slowMoTimer = 0;
  private slowMoFollow: MarbleEntity | null = null;
  private readonly _slowMoCamOffset = new THREE.Vector3();
  /**
   * Celebratory knockout punch-in: ease toward the exiting marble, hold a beat,
   * then release — no mandatory ease-back to the player/shooter marble.
   * Owns the camera while active.
   */
  private knockoutPunch: {
    active: boolean;
    phase: 'in' | 'hold';
    t: number;
    inDur: number;
    holdDur: number;
    follow: MarbleEntity | null;
    fromPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    offsetDir: THREE.Vector3;
    offsetLen: number;
    lastFollow: THREE.Vector3;
  } | null = null;
  private readonly _punchPos = new THREE.Vector3();
  private readonly _punchTarget = new THREE.Vector3();
  private readonly _aimFwd = new THREE.Vector3();
  private readonly _aimRight = new THREE.Vector3();

  /**
   * AI-turn TV director camera. Picks a subject (active AI shooter or hottest
   * action) and cycles dramatic but stable angles while the AI shot is live.
   */
  private aiDirector: {
    active: boolean;
    mode: DirectorMode;
    modeT: number;
    modeDur: number;
    blendT: number;
    blendDur: number;
    blending: boolean;
    hardCut: boolean;
    subject: MarbleEntity | null;
    impactHint: MarbleEntity | null;
    impactUntil: number;
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    cutGate: number;
    /** Shot changes after establish (cap ≈1 → max ~2 shots total). */
    cutsUsed: number;
  } | null = null;
  private readonly _dirLook = new THREE.Vector3();

  // Replay transport
  private replayPaused = false;
  private replaySpeed = 1;
  private replayScrubbing = false;
  /** After first seed, replay keeps orbit/zoom; only the look target tracks the marble. */
  private replayCamSeeded = false;
  /** Smooth follow target while replaying (player marble = orbit target). */
  private readonly _replayLook = new THREE.Vector3();
  private readonly _replayCamDesired = new THREE.Vector3();

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
    btnContinueLevel: HTMLButtonElement;
    gachaOverlay: HTMLElement;
    gachaCase: HTMLElement;
    gachaReveal: HTMLElement;
    gachaStatus: HTMLElement;
    gachaMarbleCanvas: HTMLCanvasElement;
    gachaMarbleName: HTMLElement;
    gachaMarbleSub: HTMLElement;
    btnGachaContinue: HTMLButtonElement;
    btnPauseGallery: HTMLButtonElement | null;
    btnPauseMenu: HTMLButtonElement | null;
    settleBanner: HTMLElement;
    instructions: HTMLElement;
    btnHudRestart: HTMLButtonElement;
    btnPause: HTMLButtonElement;
    btnPauseClose: HTMLButtonElement;
    pauseOverlay: HTMLElement;
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
      btnContinueLevel: document.getElementById('btn-continue-level') as HTMLButtonElement,
      gachaOverlay: document.getElementById('gacha-overlay')!,
      gachaCase: document.getElementById('gacha-case')!,
      gachaReveal: document.getElementById('gacha-reveal')!,
      gachaStatus: document.getElementById('gacha-status')!,
      gachaMarbleCanvas: document.getElementById('gacha-marble-canvas') as HTMLCanvasElement,
      gachaMarbleName: document.getElementById('gacha-marble-name')!,
      gachaMarbleSub: document.getElementById('gacha-marble-sub')!,
      btnGachaContinue: document.getElementById('btn-gacha-continue') as HTMLButtonElement,
      btnPauseGallery: document.getElementById('btn-pause-gallery') as HTMLButtonElement | null,
      btnPauseMenu: document.getElementById('btn-pause-menu') as HTMLButtonElement | null,
      settleBanner: document.getElementById('settle-banner')!,
      instructions: document.getElementById('instructions')!,
      btnHudRestart: document.getElementById('btn-hud-restart') as HTMLButtonElement,
      btnPause: document.getElementById('btn-pause') as HTMLButtonElement,
      btnPauseClose: document.getElementById('btn-pause-close') as HTMLButtonElement,
      pauseOverlay: document.getElementById('pause-overlay')!,
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
    const casterEl = document.getElementById('caster-toast');
    this.commentator = casterEl ? new SportsCommentator(casterEl) : null;

    this.rollOpponentName();
    this.applyEquippedSkinFromSave();
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
    // LMB empty-space orbit (prior); RMB also orbits (esp. while aiming with LMB)
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };

    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, GRAVITY, 0),
    });
    this.world.broadphase = new CANNON.NaiveBroadphase();
    this.world.allowSleep = true;
    // Extra iterations help small spheres stay on the play surface under cañonazo hits
    (this.world.solver as CANNON.GSSolver).iterations = 20;

    this.groundMat = new CANNON.Material('ground');
    const marbleMat = getMarbleCannonMaterial();
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.groundMat, marbleMat, {
        friction: GROUND_FRICTION,
        restitution: GROUND_RESTITUTION,
        contactEquationStiffness: 1e8,
        contactEquationRelaxation: 3,
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
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
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
    this.commentator?.dispose(); /* caster:dispose */
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
      color: this.sceneLevel === 2 ? '#c4a574' : '#5a7a42',
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

    // Thick static box (not an infinitely thin Plane) — prevents tunneling when
    // tiny marbles get multi-m/s velocities after AI / player collisions.
    // Top face sits exactly at PLAY_SURFACE_Y (park grass + L2 sand).
    const groundHalfH = 0.12;
    const groundBody = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      shape: new CANNON.Box(
        new CANNON.Vec3(GROUND_SIZE / 2, groundHalfH, GROUND_SIZE / 2),
      ),
      material: this.groundMat,
    });
    groundBody.position.set(0, PLAY_SURFACE_Y - groundHalfH, 0);
    this.world.addBody(groundBody);

    // Scoring ring visuals — park: chalk; desert: imperfect sand line from desertCamp
    if (this.sceneLevel === 1) {
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
      edgeRing.position.y = PLAY_SURFACE_Y + 0.00045;
      edgeRing.renderOrder = 3;
      this.scene.add(edgeRing);

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
      this.circleMesh.position.y = PLAY_SURFACE_Y + 0.0007;
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
      fill.position.y = PLAY_SURFACE_Y + 0.00015;
      fill.renderOrder = 2;
      this.scene.add(fill);
    } else {
      // Placeholder so circleMesh exists; desertCamp draws the imperfect ring
      this.circleMesh = new THREE.Mesh(
        new THREE.RingGeometry(CIRCLE_RADIUS - 0.001, CIRCLE_RADIUS + 0.001, 8),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
    }

    // Spy briefcase dropper (all levels) — starts upside-down above the circle
    this.briefcase = createSpyBriefcase();
    this.scene.add(this.briefcase.root);

    this.buildInvisibleBoundary();

    // Impact sparks + dirt dust + money bill FX
    this.particles = new ParticleFX(this.scene);

    if (this.sceneLevel === 2) {
      // Night desert camp (mountains, sand, campfire) — same gameplay
      this.desertCamp = buildDesertCamp(this.scene, this.groundMat);
      for (const b of this.desertCamp.bumpBodies) {
        this.world.addBody(b);
      }
      // Stone props: grippy, modest bounce (like rock)
      this.world.addContactMaterial(
        new CANNON.ContactMaterial(this.desertCamp.stoneMat, getMarbleCannonMaterial(), {
          friction: 0.72,
          restitution: 0.32,
          contactEquationStiffness: 1e7,
          contactEquationRelaxation: 3,
        }),
      );
      this.streetLamps = [];
      this.parkLife = null;
      // Start at night; full day cycle still 30 minutes
      this.dayNightTime = DAY_CYCLE_SECONDS * 0.72;
      // Dim generic play fill — campfire is the hero light
      this.playFillLight.intensity = 0.12;
      this.playFillLight.distance = 1.8;
      this.playFillLight.color.setHex(0xffc080);
    } else {
      const park = buildPark(this.scene);
      this.streetLamps = park.lamps;
      this.parkLife = new ParkLife(this.scene);
      this.desertCamp = null;
      this.dayNightTime = DAY_CYCLE_SECONDS * 0.18; // late morning
    }
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
    // Desert: warmer night fog + campfire carries night readability
    if (this.sceneLevel === 2 && this.desertCamp) {
      const phase =
        (((this.dayNightTime % DAY_CYCLE_SECONDS) + DAY_CYCLE_SECONDS) %
          DAY_CYCLE_SECONDS) /
        DAY_CYCLE_SECONDS;
      const elev = Math.sin(phase * Math.PI * 2);
      const dayAmount = THREE.MathUtils.smoothstep(elev, -0.05, 0.35);
      const nightAmount = 1 - dayAmount;
      fog.color.lerp(new THREE.Color(0x1a1210), nightAmount * 0.55);
      // Keep play fill modest; fire light is primary
      this.playFillLight.intensity = 0.08 + nightAmount * 0.22;
      this.desertCamp.fireLight.visible = true;
      // Slightly boost fire at night, ease off in daytime
      this.desertCamp.fireLight.distance = 5.5 + nightAmount * 1.5;
    }
  }

  /** Night amount 0..1 for desert FX (stars / fire). */
  private currentNightAmount(): number {
    const phase =
      (((this.dayNightTime % DAY_CYCLE_SECONDS) + DAY_CYCLE_SECONDS) %
        DAY_CYCLE_SECONDS) /
      DAY_CYCLE_SECONDS;
    const elev = Math.sin(phase * Math.PI * 2);
    const dayAmount = THREE.MathUtils.smoothstep(elev, -0.05, 0.35);
    return 1 - dayAmount;
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

  private setPaused(paused: boolean): void {
    this.paused = paused;
    this.els.pauseOverlay.classList.toggle('hidden', !paused);
    this.els.pauseOverlay.setAttribute('aria-hidden', paused ? 'false' : 'true');
    this.controls.enabled = !paused && this.phase !== 'ended';
    if (paused) {
      this.cancelAimGesture(true);
      this.els.powerWrap.classList.add('hidden');
    }
  }

  private bindUI(): void {
    this.els.btnDrop.addEventListener('click', () => {
      unlockMarbleAudio();
      this.dropMarbles();
    });
    this.els.btnRestart.addEventListener('click', () => this.restart());
    this.els.btnReplay.addEventListener('click', () => this.startReplay());
    this.els.btnEndReplay.addEventListener('click', () => this.startReplay());
    this.els.btnContinueLevel.addEventListener('click', () => this.continueToNextLevel());
    this.els.btnGachaContinue.addEventListener('click', () => this.finishGachaAndShowEnd());
    this.els.btnPauseGallery?.addEventListener('click', () => {
      openGalleryFromGame();
    });
    this.els.btnPauseMenu?.addEventListener('click', () => {
      window.location.href = buildMenuHref();
    });

    this.els.btnHudRestart.addEventListener('click', () => {
      unlockMarbleAudio();
      this.setPaused(false);
      this.restart();
    });
    this.els.btnPause.addEventListener('click', () => {
      unlockMarbleAudio();
      this.setPaused(true);
    });
    this.els.btnPauseClose.addEventListener('click', () => this.setPaused(false));
    this.els.pauseOverlay.addEventListener('click', (e) => {
      if (e.target === this.els.pauseOverlay) this.setPaused(false);
    });
    // Unlock audio on first interaction with UI / canvas (gesture-gated AudioContext)
    installMarbleAudioUnlock();
    for (const b of [this.els.btnDrop, this.els.btnReplay, this.els.btnPause, this.els.btnHudRestart]) {
      b.addEventListener('pointerdown', () => unlockMarbleAudio(), { once: true });
    }
    this.canvas.addEventListener('pointerdown', () => unlockMarbleAudio(), { once: true, capture: true });

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
      this.updateReplayCamera(0, true);
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
      this.els.settleBanner.textContent = 'Canicas cayendo…';
    }

    this.els.replayBanner.classList.toggle('hidden', phase !== 'replay');
    this.els.btnReplay.disabled = phase === 'replay' || this.replay.length < 30;
    if (phase !== 'replay') {
      this.els.replayControls.classList.add('hidden');
      this.commentator?.setEnabled(true); /* caster:replay-on */
    } else {
      this.commentator?.setEnabled(false);
    }

    const modeHint = controlModeHint(this.controlMode);
    if (phase === 'ready') {
      this.els.instructions.textContent =
        `Pulsa el botón de soltar (~10 cm). Luego turnos Jugador ↔ ${this.opponentName}.`;
    } else if (phase === 'settling') {
      this.els.instructions.textContent = 'Las canicas caen y se acomodan…';
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
    // Control / level toggles removed from HUD — URL query only (?control=&level=).
  }

  private updateTurnHUD(): void {
    const turnText =
      this.turn === 'player'
        ? 'Turno: Jugador'
        : `Turno: ${this.opponentName}`;
    this.els.turnLabel.textContent = turnText;
    this.els.turnLabel.classList.toggle('turn-player', this.turn === 'player');
    this.els.turnLabel.classList.toggle('turn-ai', this.turn === 'ai');
    this.els.levelLabel.textContent = sceneLevelLabel(this.sceneLevel);
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
    this.clearKnockoutCamPunch(false);
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
    this.els.gachaOverlay.classList.add('hidden');
    this.replay.clear();
    this.recording = true;
    this.camEase = null;
    this.particles?.clear();
    this.dirtCooldown.clear();
    this.rollOpponentName();
    this.setPhase('dropping');
    this.commentator?.say('drop', { preferLower: false }); /* caster:drop */

    // Briefcase opens → releases marbles at same height → holds 3s → rises away
    triggerBriefcaseDrop(this.briefcase, () => this.spawnFieldFromBriefcase());
  }

  private spawnFieldFromBriefcase(): void {
    const designs = this.fieldDesigns.slice(0, FIELD_MARBLE_COUNT);
    for (let i = 0; i < FIELD_MARBLE_COUNT; i++) {
      const angle = (i / FIELD_MARBLE_COUNT) * Math.PI * 2;
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
    const restY = MARBLE_REST_Y;
    const maxY = PLAY_SURFACE_Y + MARBLE_RADIUS * 4;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
      p.set(0, restY, 0);
    }
    if (hardStop) {
      // Freeze flush on dirt: center = surface + radius (contact, no gap)
      p.y = restY;
      m.body.velocity.setZero();
      m.body.angularVelocity.setZero();
    } else {
      // Anti-sink / flyaway; also pull tiny float gaps down onto contact
      if (p.y < restY || p.y > maxY || (p.y < restY + 0.001 && m.body.velocity.length() < SETTLE_SPEED * 3)) {
        p.y = restY;
      }
      if (m.body.velocity.y < 0 && p.y <= restY + 1e-4) {
        m.body.velocity.y = 0;
      }
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

    // Player turn: classic aim cam. AI turn: establish hero, then TV director.
    if (side === 'player') this.stopAIDirector();

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
    if (!this.playerMarble || this.camEase?.active || this.knockoutPunch?.active || this.aiDirector?.active) return;
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
    this.rmbOrbiting = false;
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
    // never leave them disabled after cancel (unless a camera ease / punch owns them).
    if (!this.camEase?.active && !this.knockoutPunch?.active && !this.aiDirector?.active) {
      this.controls.enabled = true;
    }
  }

  private onAimPointerDown(e: PointerEvent): void {
    // Desktop: while aiming with LMB, RMB starts camera orbit (same role as 2nd finger)
    if (e.pointerType === 'mouse' && e.button === 2 && this.aiming) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.rmbOrbiting = true;
      this.rmbLastX = e.clientX;
      this.rmbLastY = e.clientY;
      return;
    }
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
    // RMB orbit while aiming (mouse shares pointerId across buttons)
    if (this.aiming && e.pointerType === 'mouse' && (this.rmbOrbiting || (e.buttons & 2) !== 0)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!this.rmbOrbiting) {
        this.rmbOrbiting = true;
        this.rmbLastX = e.clientX;
        this.rmbLastY = e.clientY;
        return;
      }
      const dx = e.clientX - this.rmbLastX;
      const dy = e.clientY - this.rmbLastY;
      this.rmbLastX = e.clientX;
      this.rmbLastY = e.clientY;
      this.orbitCameraByDelta(dx, dy);
      return;
    }
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
    // Only consume RMB when we were orbiting during aim (don't steal OrbitControls RMB)
    if (this.rmbOrbiting && e.pointerType === 'mouse' && e.button === 2) {
      this.rmbOrbiting = false;
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    if (e.button === 2) return; // ignore RMB for shoot release
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
    // Big shots: high power flick or strong push
    const pushSp =
      push && push.pushVx !== undefined && push.pushVz !== undefined
        ? Math.hypot(push.pushVx, push.pushVz)
        : 0;
    if (power01 >= 0.72 || pushSp >= 1.35) {
      this.commentator?.say('bigShot', { side, preferLower: true }); /* caster:bigShot */
    }
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
    // Resync onto surface before impulse — kinematic→dynamic can inherit sink
    if (!Number.isFinite(body.position.y) || body.position.y < MARBLE_REST_Y) {
      body.position.y = MARBLE_REST_Y;
    }
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
        this.commentator?.say('knockout', {
          side: scorer === 'player' ? 'player' : 'ai',
          preferLower: false,
        }); /* caster:knockout */
        this.scoringMarbles.delete(m);
        this.updateScoreHUD();
        this.startKnockoutCamPunch(m);
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
    this.clearKnockoutCamPunch(false);
    this.stopAIDirector();

    const p = this.playerScore;
    const a = this.aiScore;
    const won = p > a;
    this.pendingContinueLevel = null;
    this.els.btnContinueLevel.classList.add('hidden');

    if (won) {
      this.commentator?.say('win', { force: true, preferLower: false }); /* caster:win */
      this.els.endTitle.textContent = '¡Victoria!';
      this.els.endMessage.textContent =
        `Sacaste más canicas del círculo que ${this.opponentName}.`;
      this.level += 1;
      // Unlock next map level in save
      if (this.sceneLevel === 1) {
        unlockLevel(2);
        this.pendingContinueLevel = 2;
        this.els.btnContinueLevel.textContent = 'Continuar · Nivel 2';
        this.els.btnContinueLevel.classList.remove('hidden');
      } else {
        unlockLevel(2);
        this.els.btnContinueLevel.textContent = 'Menú título';
        this.els.btnContinueLevel.classList.remove('hidden');
        this.pendingContinueLevel = null; // special: menu
      }
    } else if (a > p) {
      this.commentator?.say('lose', { force: true, preferLower: false }); /* caster:lose */
      this.els.endTitle.textContent = 'Derrota';
      this.els.endMessage.textContent =
        `${this.opponentName} sacó más canicas. ¡Inténtalo de nuevo!`;
    } else {
      this.els.endTitle.textContent = 'Empate';
      this.els.endMessage.textContent =
        'Misma cantidad de canicas fuera. ¡Casi!';
    }
    this.els.endScore.textContent =
      `Jugador ${p} ($${this.playerMoney}) · ${this.opponentName} ${a}  (${sceneLevelLabel(this.sceneLevel)} · IA ${this.level})`;
    this.updateTurnHUD();

    if (won) {
      // Victory gacha first, then end card + Continuar
      this.startVictoryGacha();
    } else {
      this.els.endScreen.classList.remove('hidden');
    }
  }

  private restart(): void {
    this.commentator?.hide(); /* caster:restart */
    this.els.endScreen.classList.add('hidden');
    this.els.gachaOverlay.classList.add('hidden');
    resetBriefcase(this.briefcase);
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
    this.clearKnockoutCamPunch(false);
    this.stopAIDirector();
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
    this.commentator?.setEnabled(false); /* caster:replay-off */
    this.commentator?.hide();
    // Hide end screen during replay so the scene is visible
    this.els.endScreen.classList.add('hidden');

    this.cancelAimGesture(true);
    this.els.powerWrap.classList.add('hidden');
    // Follow player marble as orbit target; drag = orbit, pinch = zoom
    this.controls.enabled = true;
    this.controls.enableDamping = true;
    this.replayCamSeeded = false;
    this.stopAIDirector();
    this.canPlayerShoot = false;
    this.disarmPlayerIdleHint();
    this.hideLocationBanner();
    this.markerGroup.visible = false;
    this.recording = false;
    this.camEase = null;
    this.clearKnockoutCamPunch(false);

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
      'Repetición: sigue tu canica · arrastra para orbitar · pellizca para zoom';
    // Seed framing on first frame immediately
    if (this.replayPlaying[0]) {
      this.playReplayFrame(this.replayPlaying[0]);
      this.updateReplayCamera(0, true);
    }
  }

  private finishReplay(): void {
    this.replayPlaying = [];
    this.recording = true;
    this.controls.enabled = true;
    this.controls.enableDamping = true;
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
    // Camera follows the player marble continuously (see updateReplayCamera).
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

  /**
   * Safety net vs discrete collision tunneling: keep every active marble's
   * center at/above the play surface and kill downward velocity when clamped.
   * Runs every frame after world.step (park grass + L2 sand share PLAY_SURFACE_Y).
   */
  private preventMarbleTunneling(): void {
    const minY = MARBLE_REST_Y;
    const list: MarbleEntity[] = this.fieldMarbles.slice();
    if (this.playerMarble) list.push(this.playerMarble);
    if (this.aiMarble) list.push(this.aiMarble);

    for (const m of list) {
      if (!m.active) continue;
      const body = m.body;
      if (body.type === CANNON.Body.STATIC) continue;
      const p = body.position;

      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
        p.set(0, minY, 0);
        body.velocity.setZero();
        body.angularVelocity.setZero();
        continue;
      }

      // Hard floor — mesh sync follows body, so this keeps AI / field visible
      if (p.y < minY) {
        p.y = minY;
        if (body.velocity.y < 0) body.velocity.y = 0;
      }

      // Soft sticky contact: if barely above surface with downward vel, pin it
      if (
        body.type === CANNON.Body.DYNAMIC &&
        p.y <= minY + MARBLE_RADIUS * 0.15 &&
        body.velocity.y < 0
      ) {
        p.y = minY;
        body.velocity.y = 0;
      }
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

    this.clearKnockoutCamPunch(true);
    this.exitSlowMo(true);
    this.stopAIDirector();
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

    this.commentator?.say('endTurn', { preferLower: true }); /* caster:endTurn */

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
      if (mi && mj && impact > 0.18 && now > this.sparkCooldownUntil) {
        // Contact point in world space
        const nx = c.ni.x;
        const ny = c.ni.y;
        const nz = c.ni.z;
        const px = bi.position.x - nx * MARBLE_RADIUS;
        const py = bi.position.y - ny * MARBLE_RADIUS;
        const pz = bi.position.z - nz * MARBLE_RADIUS;
        const intensity = Math.min(2.2, impact / 0.6);
        this.particles.spawnSparks(px, py, pz, intensity);
        playMarbleClack(impact);
        this.sparkCooldownUntil = now + 55;
        // Cámara lenta on heavy collisions — follow the faster marble
        if (impact >= SLOWMO_IMPACT_THRESHOLD && this.phase === 'shot_flying') {
          const bodyA = bi;
          const bodyB = bj;
          const followBody =
            bodyA.velocity.length() >= bodyB.velocity.length() ? bodyA : bodyB;
          const followEnt = this.entityFromBody(followBody);
          if (followEnt) this.enterSlowMo(followEnt);
          this.commentator?.say('hit'); /* caster:hit */
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
    if (this.knockoutPunch?.active) return;
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
      this.restoreControlsAfterCinematic();
      return;
    }

    // Keep camera looking at target without OrbitControls overwriting the ease
    this.camera.lookAt(this.controls.target);

    if (u >= 1) {
      this.camera.position.copy(this.camEase.toPos);
      this.controls.target.copy(this.camEase.toTarget);
      this.camEase.active = false;
      this.camEase = null;
      // AI turn → director takes over; player turn → free orbit / aim
      this.restoreControlsAfterCinematic();
      if (this.controls.enabled) this.controls.update();
    }
  }


  private enterSlowMo(follow: MarbleEntity): void {
    if (this.phase === 'replay') return;
    // Knockout punch owns the camera — only refresh celebratory time scale
    if (this.knockoutPunch?.active) {
      this.timeScale = SLOWMO_SCALE;
      this.slowMoTimer = Math.max(this.slowMoTimer, SLOWMO_DURATION * 0.45);
      return;
    }
    // AI TV director owns framing — slow-mo time only + brief impact cut
    if (this.shouldAIDirectorRun()) {
      this.timeScale = SLOWMO_SCALE;
      this.slowMoTimer = Math.max(this.slowMoTimer, SLOWMO_DURATION * 0.55);
      this.slowMoFollow = null;
      this.aiDirectorRequestImpact(follow);
      return;
    }
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
    // Punch / AI director still own orbit disable — don't re-enable under them
    if (this.knockoutPunch?.active) return;
    if (this.shouldAIDirectorRun()) {
      this.controls.enabled = false;
      return;
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
    // Knockout punch owns framing; impact slow-mo only moves camera when free
    if (!this.knockoutPunch?.active && follow && follow.active) {
      const fp = follow.body.position;
      // Continuously follow + look at the relevant marble for the whole slow-mo window
      const fy = Math.max(MARBLE_REST_Y, Number.isFinite(fp.y) ? fp.y : MARBLE_REST_Y);
      this.camera.position.set(
        fp.x + this._slowMoCamOffset.x,
        Math.max(0.08, fy + this._slowMoCamOffset.y),
        fp.z + this._slowMoCamOffset.z,
      );
      this.controls.target.set(fp.x, fy, fp.z);
      this.camera.lookAt(this.controls.target);
    }
    if (this.slowMoTimer <= 0) {
      this.exitSlowMo(true);
    }
  }

  /**
   * Celebratory punch-in toward a scoring knockout marble, hold, then release
   * in place (no ease-back to the shooter). Multiple near-simultaneous exits
   * retarget the most recent. Skips while aiming so multitouch orbit stays free.
   */
  private startKnockoutCamPunch(follow: MarbleEntity): void {
    if (this.phase === 'replay') return;
    // Don't steal the view mid-aim / multitouch orbit gesture
    if (this.aiming) return;

    const fp = follow.body.position;
    if (!Number.isFinite(fp.x) || !Number.isFinite(fp.z)) return;

    const lookY = Math.max(MARBLE_RADIUS, Number.isFinite(fp.y) ? fp.y : MARBLE_RADIUS);
    const ox = this.camera.position.x - fp.x;
    const oy = this.camera.position.y - fp.y;
    const oz = this.camera.position.z - fp.z;
    let len = Math.hypot(ox, oy, oz);
    let dx = ox;
    let dy = oy;
    let dz = oz;
    if (len < 0.08) {
      dx = 0.12;
      dy = 0.14;
      dz = 0.18;
      len = Math.hypot(dx, dy, dz);
    }
    dx /= len;
    dy /= len;
    dz /= len;
    // Mild zoom — celebratory without a hard cut or seasick swing
    const punchLen = Math.min(len * 0.92, Math.max(0.1, len * KNOCKOUT_PUNCH_ZOOM));

    if (this.knockoutPunch?.active) {
      const kp = this.knockoutPunch;
      kp.follow = follow;
      kp.offsetDir.set(dx, dy, dz);
      kp.offsetLen = punchLen;
      kp.lastFollow.set(fp.x, lookY, fp.z);
      // Retarget most recent; refresh hold beat without stacking a return ease
      if (kp.phase === 'hold') {
        kp.t = Math.min(kp.t, kp.holdDur * 0.35);
      } else {
        // Still easing in — keep in, just retarget
        kp.fromPos.copy(this.camera.position);
        kp.fromTarget.copy(this.controls.target);
        kp.t = Math.min(kp.t, kp.inDur * 0.5);
      }
    } else {
      this.camEase = null;
      this.controls.enabled = false;
      this.controls.enableDamping = false;
      this.knockoutPunch = {
        active: true,
        phase: 'in',
        t: 0,
        inDur: KNOCKOUT_PUNCH_IN,
        holdDur: KNOCKOUT_PUNCH_HOLD,
        follow,
        fromPos: this.camera.position.clone(),
        fromTarget: this.controls.target.clone(),
        offsetDir: new THREE.Vector3(dx, dy, dz),
        offsetLen: punchLen,
        lastFollow: new THREE.Vector3(fp.x, lookY, fp.z),
      };
    }

    // Matching celebratory slow-mo (camera owned by punch)
    const total = KNOCKOUT_PUNCH_IN + KNOCKOUT_PUNCH_HOLD + 0.05;
    this.timeScale = SLOWMO_SCALE;
    this.slowMoTimer = Math.max(this.slowMoTimer, total);
    this.slowMoFollow = null;
  }

  private clearKnockoutCamPunch(restoreControls: boolean): void {
    if (!this.knockoutPunch) return;
    this.knockoutPunch.active = false;
    this.knockoutPunch = null;
    if (restoreControls) {
      this.restoreControlsAfterCinematic();
    }
  }

  /** After punch/cinematic: AI director keeps ownership; else free orbit. */
  private restoreControlsAfterCinematic(): void {
    if (this.shouldAIDirectorRun()) {
      this.controls.enabled = false;
      this.controls.enableDamping = false;
      return;
    }
    if (
      this.phase === 'playing' ||
      this.phase === 'ai_thinking' ||
      this.phase === 'shot_flying'
    ) {
      this.controls.enabled = true;
      this.controls.enableDamping = true;
      this.controls.update();
    }
  }

  /** End punch in place — leave framing on the exiting marble / current pose. */
  private finishKnockoutCamPunch(): void {
    if (!this.knockoutPunch) return;
    this.knockoutPunch = null;
    this.restoreControlsAfterCinematic();
    // End punch-tied slow-mo if it was only for this beat
    if (this.slowMoFollow === null && this.slowMoTimer > 0) {
      this.exitSlowMo(true);
    }
  }

  private updateKnockoutCamPunch(dt: number): void {
    const kp = this.knockoutPunch;
    if (!kp?.active) return;

    // Track follow marble (or last known if it despawned)
    const f = kp.follow;
    if (f && f.active) {
      const bp = f.body.position;
      if (Number.isFinite(bp.x) && Number.isFinite(bp.z)) {
        kp.lastFollow.set(
          bp.x,
          Math.max(MARBLE_RADIUS, Number.isFinite(bp.y) ? bp.y : MARBLE_RADIUS),
          bp.z,
        );
      }
    }
    this._punchTarget.copy(kp.lastFollow);
    this._punchPos.set(
      this._punchTarget.x + kp.offsetDir.x * kp.offsetLen,
      Math.max(0.08, this._punchTarget.y + kp.offsetDir.y * kp.offsetLen),
      this._punchTarget.z + kp.offsetDir.z * kp.offsetLen,
    );

    kp.t += dt;
    const smooth = (u: number) => {
      const x = Math.min(1, Math.max(0, u));
      return x * x * (3 - 2 * x);
    };

    if (kp.phase === 'in') {
      const e = smooth(kp.t / Math.max(1e-6, kp.inDur));
      this.camera.position.lerpVectors(kp.fromPos, this._punchPos, e);
      this.controls.target.lerpVectors(kp.fromTarget, this._punchTarget, e);
      if (kp.t >= kp.inDur) {
        kp.phase = 'hold';
        kp.t = 0;
      }
    } else {
      // Hold on the exiting marble, then release — no ease-back to shooter
      this.camera.position.copy(this._punchPos);
      this.controls.target.copy(this._punchTarget);
      if (kp.t >= kp.holdDur) {
        this.finishKnockoutCamPunch();
        return;
      }
    }

    if (
      !Number.isFinite(this.camera.position.x) ||
      !Number.isFinite(this.controls.target.x)
    ) {
      this.clearKnockoutCamPunch(true);
      this.fitCameraToArena(true);
      return;
    }
    this.camera.lookAt(this.controls.target);
  }

  // ─── AI TV director camera ───────────────────────────────────────────

  private shouldAIDirectorRun(): boolean {
    return (
      this.turn === 'ai' &&
      (this.phase === 'ai_thinking' || this.phase === 'shot_flying')
    );
  }

  private stopAIDirector(): void {
    if (!this.aiDirector) return;
    this.aiDirector.active = false;
    this.aiDirector = null;
  }

  private ensureAIDirector(): void {
    if (this.aiDirector?.active) return;
    this.aiDirector = {
      active: true,
      mode: 'hero',
      modeT: 0,
      modeDur: directorModeDuration('hero', 'thinking'),
      blendT: 0,
      blendDur: 0.7,
      blending: true,
      hardCut: false,
      subject: this.aiMarble,
      impactHint: null,
      impactUntil: 0,
      fromPos: this.camera.position.clone(),
      toPos: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toTarget: this.controls.target.clone(),
      cutGate: 0,
      cutsUsed: 0,
    };
    this.controls.enabled = false;
    this.controls.enableDamping = false;
    // Blend from current pose into the first director shot (no hard pop)
    this.refreshAIDirectorFraming(false);
  }

  private aiDirectorRequestImpact(follow: MarbleEntity): void {
    if (!this.shouldAIDirectorRun()) return;
    this.ensureAIDirector();
    const d = this.aiDirector!;
    d.impactHint = follow;
    d.impactUntil = performance.now() + 900;
    // Impact counts as the (optional) second shot — skip if already cut once
    if (d.mode === 'impact') return;
    if (d.cutsUsed >= AI_DIRECTOR_MAX_CUTS) {
      // Stay on current framing; still bias subject toward the impact marble
      return;
    }
    this.switchAIDirectorMode('impact', true);
  }

  private switchAIDirectorMode(mode: DirectorMode, hardCut: boolean): void {
    const d = this.aiDirector;
    if (!d) return;
    if (mode !== d.mode) {
      d.cutsUsed += 1;
    }
    d.mode = mode;
    d.modeT = 0;
    const phase = this.phase === 'ai_thinking' ? 'thinking' : 'action';
    d.modeDur = directorModeDuration(mode, phase);
    d.hardCut = hardCut;
    d.blendDur = directorBlendDuration(mode, hardCut);
    d.blendT = 0;
    d.blending = true;
    d.cutGate = AI_DIRECTOR_MIN_CUT;
    d.fromPos.copy(this.camera.position);
    d.fromTarget.copy(this.controls.target);
    this.refreshAIDirectorFraming(false);
  }

  private refreshAIDirectorFraming(snap: boolean): void {
    const d = this.aiDirector;
    if (!d) return;
    const portrait = window.innerHeight > window.innerWidth;
    const shooters: MarbleEntity[] = [];
    if (this.aiMarble) shooters.push(this.aiMarble);
    // Future: push every AI shooter; preferred = active turn's marble
    const hint =
      d.impactUntil > performance.now() ? d.impactHint : null;
    const subject = pickDirectorSubject(
      shooters,
      this.fieldMarbles,
      this.aiMarble,
      hint,
    );
    d.subject = subject;
    if (!subject) {
      d.toTarget.set(0, MARBLE_REST_Y, 0);
      d.toPos.set(0.35, 0.4, 0.45);
      if (snap) {
        this.camera.position.copy(d.toPos);
        this.controls.target.copy(d.toTarget);
      }
      return;
    }
    const frame = framingForDirectorMode(
      d.mode,
      subject,
      this.fieldMarbles,
      this.defaultCamAzimuth,
      portrait,
      this._dirLook,
    );
    d.toPos.copy(frame.pos);
    d.toTarget.copy(frame.target);
    if (snap) {
      this.camera.position.copy(d.toPos);
      this.controls.target.copy(d.toTarget);
      d.blending = false;
    }
  }

  private updateAIDirector(dt: number): void {
    if (!this.shouldAIDirectorRun()) {
      this.stopAIDirector();
      return;
    }
    // Yield while turn-start ease or knockout punch owns the lens
    if (this.camEase?.active || this.knockoutPunch?.active) return;

    this.ensureAIDirector();
    const d = this.aiDirector!;
    d.modeT += dt;
    d.cutGate = Math.max(0, d.cutGate - dt);

    const phase = this.phase === 'ai_thinking' ? 'thinking' : 'action';

    // Continuously refresh chase targets so low_chase / side_track track motion
    if (!d.blending && (d.mode === 'low_chase' || d.mode === 'side_track' || d.mode === 'impact')) {
      this.refreshAIDirectorFraming(false);
      const trackK = 1 - Math.exp(-5.5 * dt);
      this.camera.position.lerp(d.toPos, trackK);
      this.controls.target.lerp(d.toTarget, trackK);
    } else if (d.blending) {
      d.blendT += dt;
      const u = Math.min(1, d.blendT / Math.max(1e-6, d.blendDur));
      const e = d.hardCut ? u : u * u * (3 - 2 * u);
      // Keep destination fresh while blending into chase modes
      if (d.mode === 'low_chase' || d.mode === 'side_track' || d.mode === 'impact') {
        this.refreshAIDirectorFraming(false);
      }
      this.camera.position.lerpVectors(d.fromPos, d.toPos, e);
      this.controls.target.lerpVectors(d.fromTarget, d.toTarget, e);
      if (u >= 1) {
        d.blending = false;
        this.camera.position.copy(d.toPos);
        this.controls.target.copy(d.toTarget);
      }
    } else if (d.mode === 'high_wide' || d.mode === 'cluster' || d.mode === 'hero') {
      // Soft drift toward refreshed framing
      this.refreshAIDirectorFraming(false);
      const k = 1 - Math.exp(-2.2 * dt);
      this.camera.position.lerp(d.toPos, k);
      this.controls.target.lerp(d.toTarget, k);
    }

    if (
      !Number.isFinite(this.camera.position.x) ||
      !Number.isFinite(this.controls.target.x)
    ) {
      this.stopAIDirector();
      this.fitCameraToArena(true);
      return;
    }
    this.camera.lookAt(this.controls.target);
    this.controls.enabled = false;

    // Advance shot vocabulary rarely — at most ~2 shots (establish + one cut)
    if (
      d.modeT >= d.modeDur &&
      d.cutGate <= 0 &&
      !d.blending &&
      d.cutsUsed < AI_DIRECTOR_MAX_CUTS
    ) {
      const wantImpact = d.impactUntil > performance.now();
      const next = nextDirectorMode(
        d.mode,
        phase,
        wantImpact && d.mode !== 'impact',
      );
      if (next && next !== d.mode) {
        const hard = next === 'impact' || d.mode === 'impact';
        this.switchAIDirectorMode(next, hard);
      }
    }
  }

  private update(): void {
    if (this.paused) {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      return;
    }
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.liveTime += dt;
    this.dayNightTime += dt;
    this.syncDayNight();
    if (this.briefcase) updateBriefcase(this.briefcase, dt);
    this.parkLife?.update(dt);
    if (this.desertCamp) {
      this.desertCamp.update(dt, this.currentNightAmount());
    }

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
      // Continuous smooth follow of the player's marble (scrub snaps instantly)
      this.updateReplayCamera(dt, this.replayScrubbing);
      this.renderer.render(this.scene, this.camera);
      return;
    }

    // Scale physics dt during cámara lenta (visual dt stays real-time for camera follow)
    const physDt = dt * this.timeScale;
    // Finer fixed step + more substeps reduces sphere–ground tunneling on hard hits
    this.world.step(1 / 120, physDt, 10);
    this.preventMarbleTunneling();
    this.updateSlowMo(dt);
    this.updateKnockoutCamPunch(dt);
    this.updateAIDirector(dt);
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
      this.clearKnockoutCamPunch(false);
      this.stopAIDirector();
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

    // Do NOT call controls.update() while camEase / knockout punch / AI director is active —
    // OrbitControls damping/spherical rewrite would fight the lerp and could point at sky.
    if (
      !this.camEase?.active &&
      !this.knockoutPunch?.active &&
      !this.aiDirector?.active
    ) {
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
    } else if (
      !this.camEase?.active &&
      !this.knockoutPunch?.active &&
      !this.aiDirector?.active
    ) {
      // Soft-correct only when not mid cinematic
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

  /**
   * Replay camera: keep orbit target on the player's marble, preserve user
   * orbit angle + pinch zoom (OrbitControls). Seed once behind the marble.
   */
  private updateReplayCamera(dt: number, instant = false): void {
    let tx = 0;
    let ty = MARBLE_REST_Y;
    let tz = 0;
    let have = false;

    const mesh = this.playerMarble?.mesh;
    if (mesh && mesh.visible) {
      tx = mesh.position.x;
      ty = mesh.position.y;
      tz = mesh.position.z;
      have = Number.isFinite(tx) && Number.isFinite(tz);
    }
    if (!have) {
      const frame = this.replayPlaying[this.replayIndex];
      const s = frame?.player;
      if (s && s.visible) {
        tx = s.x;
        ty = s.y;
        tz = s.z;
        have = Number.isFinite(tx) && Number.isFinite(tz);
      }
    }
    if (!have) {
      tx = this.controls.target.x;
      ty = Math.max(MARBLE_REST_Y, this.controls.target.y);
      tz = this.controls.target.z;
    }

    const lookY = Math.max(MARBLE_RADIUS, Number.isFinite(ty) ? ty : MARBLE_REST_Y);
    this._replayLook.set(tx, lookY, tz);

    // First frame / fresh replay: seed a readable behind-marble framing once
    if (!this.replayCamSeeded) {
      const portrait = window.innerHeight > window.innerWidth;
      let dirX = tx;
      let dirZ = tz;
      const radial = Math.hypot(dirX, dirZ);
      if (radial < 1e-4) {
        dirX = Math.sin(this.defaultCamAzimuth);
        dirZ = Math.cos(this.defaultCamAzimuth);
      } else {
        dirX /= radial;
        dirZ /= radial;
      }
      const back = portrait ? 0.24 : 0.3;
      const up = portrait ? 0.12 : 0.15;
      this._replayCamDesired.set(tx + dirX * back, lookY + up, tz + dirZ * back);
      this.controls.target.copy(this._replayLook);
      this.camera.position.copy(this._replayCamDesired);
      this.replayCamSeeded = true;
      this.controls.enabled = true;
      this.controls.enableDamping = true;
      this.controls.update();
      return;
    }

    // Track marble: move target (and camera by the same delta) so orbit/zoom stick
    const prevX = this.controls.target.x;
    const prevY = this.controls.target.y;
    const prevZ = this.controls.target.z;
    const k = instant ? 1 : 1 - Math.exp(-12 * Math.max(0, dt));
    const nx = prevX + (this._replayLook.x - prevX) * k;
    const ny = prevY + (this._replayLook.y - prevY) * k;
    const nz = prevZ + (this._replayLook.z - prevZ) * k;
    const dx = nx - prevX;
    const dy = ny - prevY;
    const dz = nz - prevZ;
    this.controls.target.set(nx, ny, nz);
    this.camera.position.x += dx;
    this.camera.position.y += dy;
    this.camera.position.z += dz;

    if (
      !Number.isFinite(this.camera.position.x) ||
      !Number.isFinite(this.controls.target.x)
    ) {
      this.controls.target.copy(this._replayLook);
      this.replayCamSeeded = false;
      return;
    }
    this.controls.enabled = true;
    this.controls.update();
  }

  private syncReplayPlayButton(): void {
    this.els.replayBtnPlay.textContent = this.replayPaused ? '▶' : '⏸';
    this.els.replayBanner.textContent = this.replayPaused
      ? '⏸ Repetición (pausa) — órbita / zoom activos'
      : '▶ Repetición — órbita / zoom activos';
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
    this.updateReplayCamera(0, true);
    this.syncReplayPlayButton();
  }

  private stopReplayPlayback(): void {
    if (this.phase !== 'replay' || this.replayPlaying.length === 0) return;
    this.replayPaused = true;
    this.replayIndex = 0;
    this.replayAcc = 0;
    this.playReplayFrame(this.replayPlaying[0]!);
    this.updateReplayCamera(0, true);
    this.syncReplayPlayButton();
  }

  private onResize(): void {
    this.fitCameraToArena(false);
  }

  private applyEquippedSkinFromSave(): void {
    const save = loadSave();
    if (save.equippedSkinSeed) {
      try {
        this.playerDesign = createDesignFromSeed(save.equippedSkinSeed);
      } catch {
        /* keep default */
      }
    }
  }

  /** Orbit camera around controls.target by screen pixel deltas (RMB-while-aim). */
  private orbitCameraByDelta(dx: number, dy: number): void {
    const offset = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    const rotSpeed = 0.0055;
    spherical.theta -= dx * rotSpeed;
    spherical.phi -= dy * rotSpeed;
    const eps = 0.05;
    spherical.phi = Math.max(
      this.controls.minPolarAngle + eps,
      Math.min(this.controls.maxPolarAngle - eps, spherical.phi),
    );
    spherical.makeSafe();
    offset.setFromSpherical(spherical);
    this.camera.position.copy(this.controls.target).add(offset);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  private continueToNextLevel(): void {
    const control = resolveControlMode();
    if (this.pendingContinueLevel === 2) {
      window.location.href = buildGameHref(control, 2);
      return;
    }
    // L2 victory or no next → title
    window.location.href = buildMenuHref();
  }

  private startVictoryGacha(): void {
    this.els.endScreen.classList.add('hidden');
    this.els.gachaOverlay.classList.remove('hidden');
    this.els.gachaOverlay.setAttribute('aria-hidden', 'false');
    this.els.gachaReveal.classList.add('hidden');
    this.els.gachaCase.classList.add('spinning');
    this.els.gachaCase.classList.remove('open');
    this.els.gachaStatus.classList.remove('hidden');
    this.els.gachaStatus.textContent = 'Generando canica única…';

    const seed = randomMarbleSeed(`L${this.sceneLevel}`);
    const params = paramsFromSeed(seed);

    // Spin + lightning beat, then open
    window.setTimeout(() => {
      this.els.gachaStatus.textContent = 'Abriendo maletín…';
      this.els.gachaCase.classList.remove('spinning');
      this.els.gachaCase.classList.add('open');
    }, 1600);

    window.setTimeout(() => {
      paintSeedPreview(this.els.gachaMarbleCanvas, seed);
      this.els.gachaMarbleName.textContent = params.name;
      this.els.gachaMarbleSub.textContent = 'Añadida a tu colección · puedes equiparla en Galería';
      this.els.gachaStatus.classList.add('hidden');
      this.els.gachaReveal.classList.remove('hidden');
      addToCollection({
        seed,
        name: params.name,
        createdAt: Date.now(),
        fromLevel: this.sceneLevel,
      });
      // Auto-equip the new marble as shooter skin
      this.playerDesign = createDesignFromSeed(seed);
    }, 2300);
  }

  private finishGachaAndShowEnd(): void {
    this.els.gachaOverlay.classList.add('hidden');
    this.els.gachaOverlay.setAttribute('aria-hidden', 'true');
    this.els.endScreen.classList.remove('hidden');
  }
}
