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
  MARBLE_PICK_TOLERANCE,
  PUSH_MAX_SPEED,
  PUSH_VELOCITY_GAIN,
  PLAYER_IDLE_HINT_SEC,
  AI_THINK_MS,
  L3_HOLE_RADIUS,
} from './constants';
import {
  framingAIAim,
  framingAIWide,
  aiShotBlendDuration,
  clampCamAboveSurface,
  CAM_MIN_Y,
  LOOK_MIN_Y,
  type AIShotCam,
} from './cameraDirector';
import {
  requireSceneLevel,
  sceneLevelLabel,
  buildGameHref,
  buildMenuHref,
  type SceneLevel,
} from './levelSelect';
import { buildDesertCamp, type DesertCampBuild } from './desertCamp';
import { buildDentistOffice, type DentistOfficeBuild, L3_BOWL_INNER_R } from './dentistOffice';
import {
  buildOfficeDesk,
  type OfficeDeskBuild,
  L4_MAT_HALF,
  L4_GUTTER_DEPTH,
  L4_ROOM_FLOOR_Y,
  L4_CHANNEL_W,
  l4SupportLocalY,
  l4MarbleRestY,
  l4ShooterMarbleRestY,
  l4ShooterSupportLocalY,
  l4IsChannelOrHoleXZ,
  l4ChannelDrainDirXZ,
  l4ChannelStepTowardSW,
  l4ChannelArcDistToSW,
  l4ChannelLateral,
  L4_PIPE_R,
  applyL4ShooterCollisionFilter,
} from './officeDesk';
import { playMarbleClack, unlockMarbleAudio, installMarbleAudioUnlock } from './marbleSounds';
import {
  createSpyBriefcase,
  resetBriefcase,
  triggerBriefcaseDrop,
  updateBriefcase,
  type SpyBriefcase,
} from './briefcase';
import {
  loadSave,
  unlockLevel,
  addToCollection,
  writeMatchSnapshot,
  formatSaveToast,
  DEFAULT_PLAYER_NAME,
  type MatchSnapshot,
  type MarbleBodySnap,
} from './save';
import {
  createDesignFromSeed,
  paramsFromSeed,
  generateUniqueMarbleSeed,
} from './proceduralMarble';
import { t, setLang, applyI18n, isLang } from './i18n';
import { MarbleShowcase } from './marbleShowcase';
import {
  openGalleryFromGame,
  setGalleryLiveApplyHandler,
  startVictoryConfetti,
  stopVictoryConfetti,
} from './titleMenu';
import {
  createAIDesign,
  createFieldDesigns,
  createLevel3FieldDesigns,
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
  private dentistOffice: DentistOfficeBuild | null = null;
  private officeDesk: OfficeDeskBuild | null = null;
  /** Player marble X-ray outline (visible through occluders). */
  private playerOutline: THREE.Mesh | null = null;
  /** Map / scene from URL (?level=1..4). */
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
  /** L3: personal marble fail forces the opposing side to win. */
  private forcedWinner: Side | null = null;

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
  /** Display name from save / name prompt (default Jugador1). */
  private playerName = DEFAULT_PLAYER_NAME;
  private commentator: SportsCommentator | null = null;
  /** Pairs that already contacted during the current shot (near-miss bookkeeping). */
  private shotContactPairs = new Set<string>();
  private nearMissCooldownUntil = 0;

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
   * AI-turn 2-phase camera: aim framing while thinking, one ease to a wide
   * play-circle overview once the shot is flying. No multi-cut cycling.
   */
  private aiDirector: {
    active: boolean;
    shot: AIShotCam;
    blendT: number;
    blendDur: number;
    blending: boolean;
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
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
    scorePlayerName: HTMLElement;
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
    victoryOverlay: HTMLElement;
    victoryWinner: HTMLElement;
    victoryMoney: HTMLElement;
    victoryMarbles: HTMLElement;
    victoryMeta: HTMLElement;
    victoryMarbleCanvas: HTMLCanvasElement;
    btnVictoryMenu: HTMLButtonElement;
    btnVictoryContinue: HTMLButtonElement;
    gachaOverlay: HTMLElement;
    gachaCase: HTMLElement;
    gachaReveal: HTMLElement;
    gachaStatus: HTMLElement;
    gachaMarbleCanvas: HTMLCanvasElement;
    gachaMarbleName: HTMLElement;
    gachaMarbleSub: HTMLElement;
    btnGachaContinue: HTMLButtonElement;
    btnPauseGallery: HTMLButtonElement | null;
    btnPauseSave: HTMLButtonElement | null;
    btnPauseLoad: HTMLButtonElement | null;
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
    gameToast: HTMLElement | null;
    punchOverlay: HTMLElement;
    gameRoot: HTMLElement;
  };

  private playerDesign = createPlayerDesign();
  private aiDesign = createAIDesign();
  private victoryShowcase: MarbleShowcase | null = null;
  private gachaShowcase: MarbleShowcase | null = null;
  /** Pending gacha seed while victory screen is up (generated on Continuar). */
  private pendingGachaSeed: string | null = null;
  private fieldDesigns = createFieldDesigns(); // overwritten per scene in ctor

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
      scorePlayerName: document.getElementById('score-player-name')!,
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
      victoryOverlay: document.getElementById('victory-overlay')!,
      victoryWinner: document.getElementById('victory-winner')!,
      victoryMoney: document.getElementById('victory-money')!,
      victoryMarbles: document.getElementById('victory-marbles')!,
      victoryMeta: document.getElementById('victory-meta')!,
      victoryMarbleCanvas: document.getElementById('victory-marble-canvas') as HTMLCanvasElement,
      btnVictoryMenu: document.getElementById('btn-victory-menu') as HTMLButtonElement,
      btnVictoryContinue: document.getElementById('btn-victory-continue') as HTMLButtonElement,
      gachaOverlay: document.getElementById('gacha-overlay')!,
      gachaCase: document.getElementById('gacha-case')!,
      gachaReveal: document.getElementById('gacha-reveal')!,
      gachaStatus: document.getElementById('gacha-status')!,
      gachaMarbleCanvas: document.getElementById('gacha-marble-canvas') as HTMLCanvasElement,
      gachaMarbleName: document.getElementById('gacha-marble-name')!,
      gachaMarbleSub: document.getElementById('gacha-marble-sub')!,
      btnGachaContinue: document.getElementById('btn-gacha-continue') as HTMLButtonElement,
      btnPauseGallery: document.getElementById('btn-pause-gallery') as HTMLButtonElement | null,
      btnPauseSave: document.getElementById('btn-pause-save') as HTMLButtonElement | null,
      btnPauseLoad: document.getElementById('btn-pause-load') as HTMLButtonElement | null,
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
      gameToast: document.getElementById('game-toast'),
      punchOverlay: document.getElementById('punch-overlay')!,
      gameRoot: document.getElementById('game-root')!,
    };
    const casterEl = document.getElementById('caster-toast');
    this.commentator = casterEl ? new SportsCommentator(casterEl) : null;

    this.rollOpponentName();
    this.applyEquippedSkinFromSave();
    this.loadPlayerIdentityFromSave();
    this.fieldDesigns =
      this.sceneLevel === 3 ? createLevel3FieldDesigns() : createFieldDesigns();
    // AI skill tier follows map level (L1 easy → L3 strongest)
    this.level = this.sceneLevel;
    this.els.levelLabel.textContent = sceneLevelLabel(this.sceneLevel);
    this.updateScoreHUD();
    this.applyControlModeUI();
    this.syncL4PersonalizarVisibility();

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
    this.controls.maxDistance = this.sceneLevel === 4 ? 6.5 : 4.5;
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
    // Restore mid-match if title/pause Cargar requested (?load=1)
    if (this.shouldRestoreMatchOnBoot()) {
      try {
        this.restoreMatchFromSave();
      } catch (err) {
        console.warn('No se pudo restaurar la partida', err);
      }
    }
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
    this.syncL4PersonalizarVisibility();
    // Force-hide even if sceneLevel were still 4 during teardown / title return
    document.getElementById('btn-l4-personalizar')?.classList.add('hidden');
    document.getElementById('l4-mat-menu')?.classList.add('hidden');
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
    // Player hint: white ground ring only (no spike / arrow / beam).
    // Raised + polygonOffset so the FULL ring always draws (no half z-fight).
    const ringGeo = new THREE.RingGeometry(MARBLE_RADIUS * 2.4, MARBLE_RADIUS * 3.8, 40);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -8,
      polygonOffsetUnits: -8,
    });
    this.markerRing = new THREE.Mesh(ringGeo, ringMat);
    this.markerRing.rotation.x = -Math.PI / 2;
    this.markerRing.renderOrder = 30;
    this.markerGroup.renderOrder = 30;
    this.markerGroup.add(this.markerRing);

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
      color:
        this.sceneLevel === 4
          ? '#b8a888'
          : this.sceneLevel === 3
            ? '#2a2e32'
            : this.sceneLevel === 2
              ? '#c4a574'
              : '#5a7a42',
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
    const groundHalfH = 0.25;
    const groundBody = new CANNON.Body({
      mass: 0,
      type: CANNON.Body.STATIC,
      shape: new CANNON.Box(
        new CANNON.Vec3(GROUND_SIZE / 2, groundHalfH, GROUND_SIZE / 2),
      ),
      material: this.groundMat,
    });
    groundBody.position.set(0, PLAY_SURFACE_Y - groundHalfH, 0);
    // L4: desk assembly owns all play colliders (tilted mat + U-channels + holes).
    // A flat ground body at PLAY_SURFACE_Y would float marbles above the tilted desk
    // and block entry into recessed channels / through-holes.
    if (this.sceneLevel !== 4) {
      this.world.addBody(groundBody);
    }
    // Keep visual plane flush with physics top (park dirt / camp sand share this Y)
    this.groundMesh.position.y = 0;

    // Scoring ring visuals — park: chalk; desert: sand line; L3: bowl is the vessel
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
    // L4 only: drop 5 cm closer to the mat / play surface (prior −4cm + another −1cm)
    if (this.sceneLevel === 4) {
      this.briefcase.restY -= 0.05;
      this.briefcase.root.position.y = this.briefcase.restY;
    }
    this.scene.add(this.briefcase.root);

    this.buildInvisibleBoundary();

    // Impact sparks + dirt dust + money bill FX
    this.particles = new ParticleFX(this.scene);

    if (this.sceneLevel === 2) {
      // Night desert camp (mountains, sand, campfire) — same gameplay
      this.desertCamp = buildDesertCamp(this.scene, this.groundMat);
      this.dentistOffice = null;
      this.officeDesk = null;
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
    } else if (this.sceneLevel === 3) {
      this.desertCamp = null;
      this.parkLife = null;
      this.streetLamps = [];
      this.officeDesk = null;
      this.dentistOffice = buildDentistOffice(this.scene, this.groundMat);
      for (const b of this.dentistOffice.bodies) {
        this.world.addBody(b);
      }
      this.world.addContactMaterial(
        new CANNON.ContactMaterial(this.dentistOffice.ceramicMat, getMarbleCannonMaterial(), {
          friction: 0.45,
          restitution: 0.38,
          contactEquationStiffness: 1e7,
          contactEquationRelaxation: 3,
        }),
      );
      // Dim room; bowl key light is the hero
      this.dayNightTime = DAY_CYCLE_SECONDS * 0.78;
      this.playFillLight.intensity = 0.04;
      this.playFillLight.distance = 1.2;
      this.playFillLight.color.setHex(0xaabbcc);
      this.hemiLight.intensity = 0.18;
      this.sunLight.intensity = 0.12;
      this.scene.fog = new THREE.FogExp2(0x0a0c10, 0.045);
      if (this.sky) this.sky.visible = false;
    } else if (this.sceneLevel === 4) {
      this.desertCamp = null;
      this.dentistOffice = null;
      this.parkLife = null;
      this.streetLamps = [];
      this.officeDesk = buildOfficeDesk(this.scene, this.groundMat);
      for (const b of this.officeDesk.bodies) {
        this.world.addBody(b);
      }
      // Mat: plush / antiderrape — +30% grip vs prior 3.8 (avocado mat only; wood/channel untouched)
      this.world.addContactMaterial(
        new CANNON.ContactMaterial(this.officeDesk.matMat, getMarbleCannonMaterial(), {
          friction: 4.94, // 3.8 * 1.30
          restitution: 0.015,
          contactEquationStiffness: 1e7,
          contactEquationRelaxation: 3,
          frictionEquationStiffness: 1e7,
          frictionEquationRelaxation: 3,
        }),
      );
      // Desk wood (apron, props, outer) — unchanged grip vs prior L4 wood
      this.world.addContactMaterial(
        new CANNON.ContactMaterial(this.officeDesk.woodMat, getMarbleCannonMaterial(), {
          friction: 0.22,
          restitution: 0.32,
          contactEquationStiffness: 1e7,
          contactEquationRelaxation: 3,
        }),
      );
      // Half-pipe trough only — near-ice friction so arc-slope drains to SW hole
      this.world.addContactMaterial(
        new CANNON.ContactMaterial(this.officeDesk.channelMat, getMarbleCannonMaterial(), {
          friction: 0.008,
          restitution: 0.08,
          contactEquationStiffness: 1e7,
          contactEquationRelaxation: 3,
        }),
      );
      this.dayNightTime = DAY_CYCLE_SECONDS * 0.35;
      this.playFillLight.intensity = 0.22;
      this.playFillLight.distance = 2.4;
      this.playFillLight.color.setHex(0xffd0a0);
      this.playFillLight.position.set(0, 0.55, 0.15);
      this.hemiLight.intensity = 0.55;
      this.sunLight.intensity = 0.55;
      this.scene.fog = new THREE.FogExp2(0xd8c8b0, 0.012);
      if (this.sky) this.sky.visible = false;
      this.groundMesh.visible = false;
      if (this.circleMesh) this.circleMesh.visible = false;
    } else {
      const park = buildPark(this.scene);
      this.streetLamps = park.lamps;
      this.parkLife = new ParkLife(this.scene);
      this.desertCamp = null;
      this.dentistOffice = null;
      this.officeDesk = null;
      this.dayNightTime = DAY_CYCLE_SECONDS * 0.18; // late morning
    }
    this.syncDayNight();
  }

  private syncDayNight(): void {
    const fog = this.scene.fog;
    if (!(fog instanceof THREE.FogExp2)) return;
    if (this.sceneLevel === 3) {
      // Dentist: keep room dim; bowl lights handled in dentistOffice.update
      fog.color.setHex(0x0a0c10);
      fog.density = 0.045;
      this.sunLight.intensity = 0.08;
      this.hemiLight.intensity = 0.16;
      this.playFillLight.intensity = 0.03;
      this.renderer.toneMappingExposure = 0.85;
      return;
    }
    if (this.sceneLevel === 4) {
      fog.color.setHex(0xd8c8b0);
      fog.density = 0.012;
      this.sunLight.intensity = 0.5;
      this.hemiLight.intensity = 0.5;
      this.playFillLight.intensity = 0.2;
      this.renderer.toneMappingExposure = 1.12;
      return;
    }
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
    this.els.btnVictoryMenu.addEventListener('click', () => {
      this.hideVictoryScreen();
      document.getElementById('btn-l4-personalizar')?.classList.add('hidden');
      document.getElementById('l4-mat-menu')?.classList.add('hidden');
      window.location.href = buildMenuHref();
    });
    this.els.btnVictoryContinue.addEventListener('click', () => {
      this.hideVictoryScreen();
      this.startVictoryGacha();
    });
    this.els.btnGachaContinue.addEventListener('click', () => this.finishGachaAndContinue());
    this.els.btnPauseGallery?.addEventListener('click', () => {
      openGalleryFromGame();
    });
    setGalleryLiveApplyHandler((seed) => this.applyPlayerSkinLive(seed));
    this.bindL4Personalizar();
    this.els.btnPauseSave?.addEventListener('click', () => {
      unlockMarbleAudio();
      this.saveMatchCheckpoint();
    });
    this.els.btnPauseLoad?.addEventListener('click', () => {
      unlockMarbleAudio();
      this.loadMatchCheckpointFromPause();
    });
    this.els.btnPauseMenu?.addEventListener('click', () => {
      document.getElementById('btn-l4-personalizar')?.classList.add('hidden');
      document.getElementById('l4-mat-menu')?.classList.add('hidden');
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
    {
      const s = loadSave();
      if (isLang(s.language)) setLang(s.language);
      applyI18n(document);
    }
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
        this.sceneLevel === 3
          ? `L3 Escupidera: mete canicas de campo al HOYO. Tu canica al hoyo o fuera del bowl = pierdes. IA L3.`
          : this.sceneLevel === 4
            ? `L4 Escritorio: saca canicas al half-pipe → hoyo SW (cuenta como KO). Personalizar = playmat.`
            : `Pulsa el botón de soltar (~10 cm). Luego turnos ${this.playerName} ↔ ${this.opponentName}.`;
    } else if (phase === 'settling') {
      this.els.instructions.textContent =
        this.sceneLevel === 3
          ? 'Canicas en el bowl… luego se abre el hoyo central.'
          : 'Las canicas caen y se acomodan…';
    } else if (phase === 'playing') {
      this.els.instructions.textContent =
        this.turn === 'player'
          ? this.sceneLevel === 3
            ? `${modeHint} · Meta: hoyo · No caigas al hoyo ni fuera del bowl`
            : this.sceneLevel === 4
              ? `${modeHint} · Meta: half-pipe → hoyo SW`
              : modeHint
          : `Turno de ${this.opponentName}…`;
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
    const name = this.turn === 'player' ? this.playerName : this.opponentName;
    this.els.turnLabel.textContent = t('hud.turn.player', { name });
    this.els.turnLabel.classList.toggle('turn-player', this.turn === 'player');
    this.els.turnLabel.classList.toggle('turn-ai', this.turn === 'ai');
  }

    private updateScoreHUD(): void {
    this.els.scorePlayer.textContent = String(this.playerScore);
    this.els.scorePlayerName.textContent = this.playerName;
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
    if (which === 'player') this.clearPlayerOutline();
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
    this.forcedWinner = null;
    this.clearFieldMarbles();
    this.removeShooter('player');
    this.removeShooter('ai');
    this.els.endScreen.classList.add('hidden');
    this.els.gachaOverlay.classList.add('hidden');
    this.hideVictoryScreen();
    this.replay.clear();
    this.recording = true;
    this.camEase = null;
    this.particles?.clear();
    this.dirtCooldown.clear();
    this.rollOpponentName();
    this.setPhase('dropping');
    this.commentator?.say('drop', { force: true, preferLower: false }); /* caster:drop */

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
      const dropBase = this.sceneLevel === 4 ? DROP_HEIGHT - 0.02 : DROP_HEIGHT;
      const y = dropBase + 0.01 + Math.floor(i / 5) * (MARBLE_RADIUS * 2.2);
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

    const l4 = this.sceneLevel === 4;
    for (const m of this.fieldMarbles) {
      if (!m.active) continue;
      const dist = Math.hypot(m.body.position.x, m.body.position.z);
      const offL4 =
        l4 &&
        (this.isOffL4Desk(m.body.position.x, m.body.position.y, m.body.position.z) ||
          this.isInL4Hole(m.body.position.x, m.body.position.y, m.body.position.z));
      const out =
        dist > CIRCLE_RADIUS + OUT_MARGIN || m.body.position.y < -0.05 || offL4;
      if (offL4) {
        // Fell off desk / through hole during drop — eliminate, never float
        m.active = false;
        m.mesh.visible = false;
        m.body.velocity.setZero();
        m.body.angularVelocity.setZero();
        m.body.position.y = -1;
        m.body.type = CANNON.Body.STATIC;
        continue;
      }
      this.snapMarblePhysics(m, true);
      if (out) {
        // Left circle during drop/settle — no score, keep visible but inert ON support
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

    // L3: after settle, center opens as a hole — marbles on the mark fall (no score)
    if (this.sceneLevel === 3 && this.dentistOffice) {
      this.dentistOffice.openCenterHole(this.world);
      for (const m of this.fieldMarbles) {
        if (!m.active) continue;
        const dist = Math.hypot(m.body.position.x, m.body.position.z);
        if (dist < L3_HOLE_RADIUS + OUT_MARGIN) {
          this.scoringMarbles.delete(m);
          m.active = false;
          m.mesh.visible = false;
          m.body.velocity.setZero();
          m.body.angularVelocity.setZero();
          m.body.position.y = -1;
          m.body.type = CANNON.Body.STATIC;
        }
      }
    }
  }

  /** Snap body Y onto the play surface, clear bad velocities / penetration. */
  private snapMarblePhysics(m: MarbleEntity, hardStop: boolean): void {
    const p = m.body.position;
    const l4 = this.sceneLevel === 4;
    // L4 desk is tilted with recessed channels — never force MARBLE_REST_Y off support.
    const restY = MARBLE_REST_Y;
    const minY = l4 ? L4_ROOM_FLOOR_Y + MARBLE_RADIUS : restY;
    const maxY = PLAY_SURFACE_Y + MARBLE_RADIUS * 4;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
      p.set(0, restY, 0);
    }
    if (hardStop) {
      if (!l4) {
        // Freeze flush on dirt: center = surface + radius (contact, no gap)
        p.y = restY;
        m.body.velocity.setZero();
        m.body.angularVelocity.setZero();
      } else {
        // L4: snap onto real support (mat / wood / trough). Never invent a mid-air shelf.
        const supported = l4MarbleRestY(p.x, p.z);
        if (supported !== null) {
          p.y = supported;
          m.body.velocity.setZero();
          m.body.angularVelocity.setZero();
        } else {
          // Unsupported — do NOT sleep at desk height; drop under gravity
          m.body.angularVelocity.setZero();
          m.body.velocity.x = 0;
          m.body.velocity.z = 0;
          if (m.body.velocity.y > -0.15) m.body.velocity.y = -0.35;
          m.body.wakeUp();
          return;
        }
      }
    } else if (!l4) {
      // Anti-sink / flyaway; also pull tiny float gaps down onto contact
      if (p.y < restY || p.y > maxY || (p.y < restY + 0.001 && m.body.velocity.length() < SETTLE_SPEED * 3)) {
        p.y = restY;
      }
      if (m.body.velocity.y < 0 && p.y <= restY + 1e-4) {
        m.body.velocity.y = 0;
      }
    } else {
      // L4: only rescue deep underground / extreme flyaways; never pin to desk Y in air
      if (p.y < minY) p.y = minY;
      if (p.y > maxY + 0.5) {
        const supported = l4MarbleRestY(p.x, p.z);
        p.y = supported ?? restY;
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
    // L1/L2: outside chalk circle. L3: inside cuspidor. L4: ON the mat (not mid-channel).
    const dist =
      this.sceneLevel === 3
        ? (L3_BOWL_INNER_R + L3_HOLE_RADIUS) * 0.55
        : this.sceneLevel === 4
          ? L4_MAT_HALF - MARBLE_RADIUS * 5
          : CIRCLE_RADIUS + MARBLE_RADIUS * 3.5;
    const y =
      this.sceneLevel === 4
        ? (l4MarbleRestY(dist, 0) ?? MARBLE_REST_Y)
        : MARBLE_REST_Y;

    const player = createMarbleEntity(
      this.playerDesign,
      new CANNON.Vec3(dist, y, 0),
      'player',
    );
    player.body.velocity.setZero();
    player.body.angularVelocity.setZero();
    player.body.type = CANNON.Body.KINEMATIC;
    if (this.sceneLevel === 4) applyL4ShooterCollisionFilter(player.body);
    this.scene.add(player.mesh);
    this.world.addBody(player.body);
    this.playerMarble = player;
    this.attachPlayerOutline(player);

    const ai = createMarbleEntity(
      this.aiDesign,
      new CANNON.Vec3(-dist, y, 0),
      'ai',
    );
    ai.body.velocity.setZero();
    ai.body.angularVelocity.setZero();
    ai.body.type = CANNON.Body.KINEMATIC;
    if (this.sceneLevel === 4) applyL4ShooterCollisionFilter(ai.body);
    this.scene.add(ai.mesh);
    this.world.addBody(ai.body);
    this.aiMarble = ai;

  }

  /** White silhouette — X-ray ONLY while occluded from camera (never when fully visible). */
  private attachPlayerOutline(player: MarbleEntity): void {
    this.clearPlayerOutline();
    const geo = new THREE.SphereGeometry(MARBLE_RADIUS * 1.16, 28, 22);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.72,
      depthTest: false, // punch through occluders when shown
      depthWrite: false,
    });
    const outline = new THREE.Mesh(geo, mat);
    outline.renderOrder = 999;
    outline.frustumCulled = false;
    outline.visible = false; // start hidden — beauty marble until occluded
    player.mesh.add(outline);
    this.playerOutline = outline;
  }

  private clearPlayerOutline(): void {
    if (!this.playerOutline) return;
    this.playerOutline.parent?.remove(this.playerOutline);
    this.playerOutline.geometry.dispose();
    (this.playerOutline.material as THREE.Material).dispose();
    this.playerOutline = null;
  }

  private readonly _outlineCam = new THREE.Vector3();
  private readonly _outlineTarget = new THREE.Vector3();
  private readonly _outlineDir = new THREE.Vector3();
  private readonly _outlineRay = new THREE.Raycaster();

  /** True if some scene mesh sits between the camera and the player marble. */
  private isPlayerMarbleOccluded(): boolean {
    if (!this.playerMarble?.active) return false;
    const cam = this.camera.getWorldPosition(this._outlineCam);
    const target = this.playerMarble.mesh.getWorldPosition(this._outlineTarget);
    const dist = cam.distanceTo(target);
    if (!(dist > MARBLE_RADIUS * 2)) return false;
    this._outlineDir.subVectors(target, cam).normalize();
    this._outlineRay.set(cam, this._outlineDir);
    this._outlineRay.far = Math.max(0.001, dist - MARBLE_RADIUS * 0.9);
    this._outlineRay.near = 0.01;
    const hits = this._outlineRay.intersectObjects(this.scene.children, true);
    const playerRoot = this.playerMarble.mesh;
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      let skip = false;
      while (o) {
        if (o === playerRoot || o === this.playerOutline || o === this.markerGroup) {
          skip = true;
          break;
        }
        if (o === this.sky || o.name === 'stars') {
          skip = true;
          break;
        }
        o = o.parent;
      }
      if (skip) continue;
      // Ignore pure overlay / non-solid helpers
      const mat = (h.object as THREE.Mesh).material;
      const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
      if (
        mats.length > 0 &&
        mats.every(
          (m) =>
            m instanceof THREE.PointsMaterial ||
            (m as THREE.Material).depthWrite === false &&
              (m as THREE.Material).transparent === true &&
              ((m as THREE.MeshBasicMaterial).opacity ?? 1) < 0.35,
        )
      ) {
        continue;
      }
      if (h.distance < dist - MARBLE_RADIUS * 0.85) return true;
    }
    return false;
  }

  private syncPlayerOutline(): void {
    if (!this.playerOutline || !this.playerMarble) return;
    if (!this.playerMarble.active || !this.playerMarble.mesh.visible) {
      this.playerOutline.visible = false;
      return;
    }
    this.playerOutline.visible = this.isPlayerMarbleOccluded();
  }

  private getActiveShooter(): MarbleEntity | null {
    return this.turn === 'player' ? this.playerMarble : this.aiMarble;
  }

  private beginTurn(side: Side): void {
    this.turn = side;
    this.updateTurnHUD();
    const shooter = this.getActiveShooter();
    if (!shooter) return;

    // Player turn: classic aim cam. AI turn: 2-phase aim → wide overview.
    if (side === 'player') this.stopAIDirector();

    // Scoring window closed while aiming — residual exits never credit anyone
    this.scoringEnabled = false;
    this.shotContactPairs.clear();
    this.cullExitsWithoutScore();
    this.softSleepSlowFieldMarbles();

    // Clamp shooter onto ground / finite coords before framing camera
    this.sanitizeShooterPose(shooter);

    // Freeze ONLY the active shooter until they fire (aim stability).
    // The opposing shooter stays DYNAMIC so it can be struck like a field marble.
    shooter.body.velocity.setZero();
    shooter.body.angularVelocity.setZero();
    shooter.body.type = CANNON.Body.KINEMATIC;
    this.snapMarblePhysics(shooter, true);
    this.syncOneMesh(shooter);

    const other = side === 'player' ? this.aiMarble : this.playerMarble;
    if (other && other.active) {
      other.body.type = CANNON.Body.DYNAMIC;
      other.body.velocity.setZero();
      other.body.angularVelocity.setZero();
      this.snapMarblePhysics(other, true);
      this.syncOneMesh(other);
      // Sleep at rest but remain dynamic — collisions wake it
      other.body.sleep();
    }

    this.showLocationMarker(shooter, side);
    this.easeCameraToward(shooter);

    if (side === 'player') {
      this.setPhase('playing');
      this.canPlayerShoot = true;
      this.flashLocationBanner(`Aquí está la canica de ${this.playerName}`, 'banner-player', 2200);
      this.armPlayerIdleHint();
      this.commentator?.say('playerPlay', { side: 'player', preferLower: true });
    } else {
      this.canPlayerShoot = false;
      this.disarmPlayerIdleHint();
      this.cancelAimGesture(false);
      this.flashLocationBanner(
        `Aquí está la canica de ${this.opponentName}`,
        'banner-ai',
        2200,
      );
      const mode =
        this.sceneLevel === 3
          ? 'hole_in'
          : this.sceneLevel === 4
            ? 'channel_out'
            : 'circle_out';
      this.aiPlan = planAIShot(
        shooter,
        this.fieldMarbles,
        this.sceneLevel,
        mode,
        L3_HOLE_RADIUS,
      );
      // Thinking pause ~2s before shooting
      this.aiThinkUntil = performance.now() + AI_THINK_MS + Math.random() * 250;
      this.setPhase('ai_thinking');
      this.commentator?.say('aiPlay', { side: 'ai', preferLower: true });
    }
  }

  /** Keep shooter body in a renderable, finite pose for camera framing. */
  private sanitizeShooterPose(shooter: MarbleEntity): void {
    const p = shooter.body.position;
    const l4 = this.sceneLevel === 4;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
      const sideDist = l4
        ? L4_MAT_HALF - MARBLE_RADIUS * 5
        : CIRCLE_RADIUS + MARBLE_RADIUS * 3.5;
      const x = this.turn === 'player' ? sideDist : -sideDist;
      p.set(x, l4MarbleRestY(x, 0) ?? MARBLE_REST_Y, 0);
    }
    if (l4) {
      // Shooters treat half-pipe/hole as desk-top (bridges). Spawn on mat, not over trough.
      if (l4IsChannelOrHoleXZ(p.x, p.z)) {
        const maxOnMat = L4_MAT_HALF - MARBLE_RADIUS * 2;
        p.x = Math.max(-maxOnMat, Math.min(maxOnMat, p.x));
        p.z = Math.max(-maxOnMat, Math.min(maxOnMat, p.z));
      }
      let rest = l4ShooterMarbleRestY(p.x, p.z);
      if (rest === null) {
        // Off desk — clamp onto mat so we don't create floaters outside the desk
        const maxOnMat = L4_MAT_HALF - MARBLE_RADIUS * 2;
        const horiz = Math.hypot(p.x, p.z) || 1;
        const s = Math.min(1, maxOnMat / horiz);
        p.x *= s;
        p.z *= s;
        rest = l4ShooterMarbleRestY(p.x, p.z) ?? MARBLE_REST_Y;
      }
      // Only lift/drop onto support when near it or below floor; leave falling alone if deep
      if (p.y > 1 || p.y < L4_ROOM_FLOOR_Y + MARBLE_RADIUS * 2 || Math.abs(p.y - rest) < 0.08) {
        p.y = rest;
      }
    } else {
      if (p.y < PLAY_SURFACE_Y + MARBLE_RADIUS * 0.5 || p.y > 1) {
        p.y = MARBLE_REST_Y;
      }
      // Soft clamp extreme flyaways so turn handoff stays on-arena
      const horiz = Math.hypot(p.x, p.z);
      const maxR =
        this.sceneLevel === 3 ? CIRCLE_RADIUS * 0.92 : CIRCLE_RADIUS * 3.5;
      if (horiz > maxR) {
        const s = maxR / horiz;
        p.x *= s;
        p.z *= s;
      }
    }
    shooter.body.velocity.setZero();
    shooter.body.angularVelocity.setZero();
  }

  private showLocationMarker(shooter: MarbleEntity, side: Side): void {
    // White ground ring only (player); soft blue ring for AI — no spike/arrow
    const color = side === 'player' ? 0xffffff : 0x90caf9;
    (this.markerRing.material as THREE.MeshBasicMaterial).color.setHex(color);
    (this.markerRing.material as THREE.MeshBasicMaterial).opacity = 0.95;
    this.markerGroup.position.set(
      shooter.body.position.x,
      PLAY_SURFACE_Y + 0.0045,
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
    const lookY = Number.isFinite(py) ? Math.max(LOOK_MIN_Y, py) : LOOK_MIN_Y;
    const look = new THREE.Vector3(px, lookY, pz);

    // Behind marble along radial; height stays safely above play surface
    // (no lateral bias — that was offsetting the marble on screen)
    const back = portrait ? 0.26 : 0.34;
    const up = Math.max(CAM_MIN_Y, portrait ? 0.18 : 0.22);
    const toPos = new THREE.Vector3(
      px + dirX * back,
      up,
      pz + dirZ * back,
    );
    clampCamAboveSurface(toPos, look);

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
    // Options → aim guide off: hide visual, aiming/firing still works.
    if (loadSave().aimGuide === false) {
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
    this.shotContactPairs.clear();
    this.nearMissCooldownUntil = 0;
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

    // Both personal marbles must be DYNAMIC so they share field-marble physics
    // (can be struck / moved by any marble, including each other).
    const l4impulse = this.sceneLevel === 4;
    for (const m of [this.playerMarble, this.aiMarble]) {
      if (!m || !m.active) continue;
      m.body.type = CANNON.Body.DYNAMIC;
      // L4: don't yank shooters up out of channels; only fix NaN / deep sinks
      if (!Number.isFinite(m.body.position.y) || (!l4impulse && m.body.position.y < MARBLE_REST_Y)) {
        m.body.position.y = MARBLE_REST_Y;
      }
      if (!l4impulse) {
        m.body.previousPosition.y = Math.max(m.body.previousPosition.y, MARBLE_REST_Y);
      }
      m.body.wakeUp();
    }

    const body = shooter.body;
    // Resync onto surface before impulse — kinematic→dynamic can inherit sink
    if (!Number.isFinite(body.position.y) || (!l4impulse && body.position.y < MARBLE_REST_Y)) {
      body.position.y = MARBLE_REST_Y;
    }
    if (!l4impulse) {
      body.previousPosition.y = Math.max(body.previousPosition.y, MARBLE_REST_Y);
      if (body.position.y < MARBLE_REST_Y + 1e-5) {
        body.position.y = MARBLE_REST_Y;
        body.previousPosition.y = MARBLE_REST_Y;
      }
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

    const l3 = this.sceneLevel === 3;
    const l4 = this.sceneLevel === 4;
    const holeOpen = l3 && !!this.dentistOffice?.holeOpen;

    // L3: personal marble into hole OR out of bowl = loss of that marble / match
    if (l3 && holeOpen) {
      const personalLoss = this.checkPersonalMarbleFail();
      if (personalLoss) return true;
    }
    // L4: personal marble off desk edge (to floor) = perdiste; channels/holes blocked for shooters
    if (l4) {
      const personalLoss = this.checkL4PersonalMarbleFail();
      if (personalLoss) return true;
    }

    for (const m of this.fieldMarbles) {
      if (!m.active) continue;
      const dist = Math.hypot(m.body.position.x, m.body.position.z);
      const fallen = m.body.position.y < -0.05 || (l4 && this.isOffL4Desk(m.body.position.x, m.body.position.y, m.body.position.z));
      const inL4Hole = l4 && this.isInL4Hole(m.body.position.x, m.body.position.y, m.body.position.z);
      // L1/L2: out of chalk circle. L3: into the center hole. L4: single south channel hole.
      const scored = l3
        ? holeOpen && (dist < L3_HOLE_RADIUS + OUT_MARGIN || fallen)
        : l4
          ? inL4Hole || fallen
          : dist > CIRCLE_RADIUS + OUT_MARGIN || fallen;
      // L3 also despawn if they somehow leave the bowl
      const leftBowl = l3 && dist > CIRCLE_RADIUS + OUT_MARGIN * 4;

      if (!(scored || leftBowl)) continue;

      const eligible =
        scored &&
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
          force: true,
          preferLower: false,
        }); /* caster:knockout */
        this.scoringMarbles.delete(m);
        this.updateScoreHUD();
        this.startKnockoutCamPunch(m);
        if (
          this.scoringMarbles.size <= 2 ||
          Math.abs(this.playerScore - this.aiScore) <= 1
        ) {
          this.commentator?.say('clutch', {
            side: scorer === 'player' ? 'player' : 'ai',
            preferLower: false,
          }); /* caster:clutch */
        }
      } else if (leftBowl && this.scoringMarbles.has(m)) {
        // Left bowl without hole — no score, remove from scoring set
        this.scoringMarbles.delete(m);
      }

      if (fallen || dist > DESPAWN_DIST || (l3 && (scored || leftBowl)) || (l4 && scored)) {
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

  /**
   * L3 lose conditions for a personal (shooter) marble:
   * falls into the hole OR out of the bowl → that side loses the match.
   */
  private checkPersonalMarbleFail(): boolean {
    const check = (m: MarbleEntity | null, side: Side): boolean => {
      if (!m || !m.active) return false;
      const dist = Math.hypot(m.body.position.x, m.body.position.z);
      const inHole = dist < L3_HOLE_RADIUS + OUT_MARGIN || m.body.position.y < -0.02;
      const outBowl = dist > CIRCLE_RADIUS + MARBLE_RADIUS * 1.2;
      if (!(inHole || outBowl)) return false;

      m.active = false;
      m.mesh.visible = false;
      m.body.velocity.setZero();
      m.body.angularVelocity.setZero();
      m.body.type = CANNON.Body.STATIC;
      if (side === 'player') this.clearPlayerOutline();

      this.forcedWinner = side === 'player' ? 'ai' : 'player';
      const why = inHole ? 'cayó al hoyo' : 'salió del bowl';
      if (side === 'player') {
        this.flashLocationBanner(
          `Canica de ${this.playerName} ${why} — pierdes la canica`,
          'banner-player',
          2800,
        );
      } else {
        this.flashLocationBanner(
          `Canica de ${this.opponentName} ${why}`,
          'banner-ai',
          2800,
        );
      }
      this.endGame();
      return true;
    };
    if (check(this.playerMarble, 'player')) return true;
    if (check(this.aiMarble, 'ai')) return true;
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
    let won = p > a;
    let lost = a > p;
    if (this.forcedWinner === 'player') {
      won = true;
      lost = false;
    } else if (this.forcedWinner === 'ai') {
      won = false;
      lost = true;
    }
    this.pendingContinueLevel = null;
    this.els.btnContinueLevel.classList.add('hidden');

    const beatMsg =
      this.sceneLevel === 3
        ? `Metiste más canicas al hoyo que ${this.opponentName}.`
        : this.sceneLevel === 4
          ? `Metiste más canicas a los hoyos del escritorio que ${this.opponentName}.`
          : `Sacaste más canicas del círculo que ${this.opponentName}.`;
    const loseMsg =
      this.sceneLevel === 3
        ? `${this.opponentName} metió más canicas al hoyo. ¡Inténtalo de nuevo!`
        : this.sceneLevel === 4
          ? `${this.opponentName} metió más canicas a los hoyos. ¡Inténtalo de nuevo!`
          : `${this.opponentName} sacó más canicas. ¡Inténtalo de nuevo!`;

    if (won) {
      this.commentator?.say('win', { force: true, preferLower: false }); /* caster:win */
      this.els.endTitle.textContent = t('end.victory');
      this.els.endMessage.textContent =
        this.forcedWinner === 'player'
          ? `La canica rival salió del bowl / cayó al hoyo. ${beatMsg}`
          : beatMsg;
      // Unlock next map: L1→L2→L3→L4
      if (this.sceneLevel === 1) {
        unlockLevel(2);
        this.pendingContinueLevel = 2;
        this.els.btnContinueLevel.textContent = t('end.continue.n', { n: 2 });
        this.els.btnContinueLevel.classList.remove('hidden');
      } else if (this.sceneLevel === 2) {
        unlockLevel(3);
        this.pendingContinueLevel = 3;
        this.els.btnContinueLevel.textContent = t('end.continue.n', { n: 3 });
        this.els.btnContinueLevel.classList.remove('hidden');
      } else if (this.sceneLevel === 3) {
        unlockLevel(4);
        this.pendingContinueLevel = 4;
        this.els.btnContinueLevel.textContent = t('end.continue.n', { n: 4 });
        this.els.btnContinueLevel.classList.remove('hidden');
      } else {
        unlockLevel(4);
        this.els.btnContinueLevel.textContent = t('end.menu');
        this.els.btnContinueLevel.classList.remove('hidden');
        this.pendingContinueLevel = null;
      }
    } else if (lost) {
      this.commentator?.say('lose', { force: true, preferLower: false }); /* caster:lose */
      this.els.endTitle.textContent = t('end.defeat');
      this.els.endMessage.textContent =
        this.forcedWinner === 'ai'
          ? `La canica de ${this.playerName} cayó al hoyo o salió del bowl. Pierdes la canica.`
          : loseMsg;
    } else {
      this.els.endTitle.textContent = t('end.draw');
      this.els.endMessage.textContent =
        this.sceneLevel === 3
          ? 'Misma cantidad de canicas en el hoyo. ¡Casi!'
          : this.sceneLevel === 4
            ? 'Misma cantidad de canicas en los hoyos. ¡Casi!'
            : 'Misma cantidad de canicas fuera. ¡Casi!';
    }
    this.els.endScore.textContent =
      `${this.playerName} ${p} ($${this.playerMoney}) · ${this.opponentName} ${a}  (${sceneLevelLabel(this.sceneLevel)} · IA L${this.sceneLevel})`;
    this.forcedWinner = null;
    this.updateTurnHUD();

    if (won) {
      // Victory UI first → Continuar opens gacha → then next level / menú
      this.showVictoryScreen(p, a);
    } else {
      this.els.endScreen.classList.remove('hidden');
    }
  }

  private restart(): void {
    // L3 hole can't be re-sealed cleanly — reload the level
    if (this.sceneLevel === 3 && this.dentistOffice?.holeOpen) {
      window.location.href = buildGameHref(resolveControlMode(), 3);
      return;
    }
    this.forcedWinner = null;
    this.commentator?.hide(); /* caster:restart */
    this.els.endScreen.classList.add('hidden');
    this.els.gachaOverlay.classList.add('hidden');
    this.hideVictoryScreen();
    this.pendingGachaSeed = null;
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
   * L4 field marbles in the half-pipe: CPU centerline convoy toward the SW hole.
   *
   * Root cause of live "spin in place": convoy ran ONLY before world.step; the
   * multi-substep contact solver vs half-pipe facets cancelled linear velocity while
   * ω (and friction spin) remained — marbles looked stuck spinning. Also a tight
   * localY depth gate skipped shallow N/E trough sits.
   *
   * Fix: kinematic path-follow AFTER physics with a wide in-channel gate, forced
   * centerline-tangential linear velocity every frame, matching rolling ω, cruise
   * ~0.65 m/s. Shooters unchanged (bridges). Field-only.
   */
  private applyL4ChannelDrain(frameDt: number): void {
    if (this.sceneLevel !== 4) return;
    // Match simulated time from world.step(1/120, physDt, 10)
    const dt = Math.max(1 / 240, Math.min(frameDt, 10 / 120));
    const cruiseSpeed = 0.65; // m/s — fast travel through channel (was 0.34, felt stuck live)
    const hole = this.officeDesk?.holeCenters[0];
    const holeR = this.officeDesk?.holeRadius ?? MARBLE_RADIUS * 1.65;
    for (const m of this.fieldMarbles) {
      if (!m.active) continue;
      const body = m.body;
      if (body.type !== CANNON.Body.DYNAMIC) continue;
      const x = body.position.x;
      const z = body.position.z;
      const lat = l4ChannelLateral(x, z);
      // Cover full trough band including corners (N/E/S/W)
      if (lat === null || Math.abs(lat) > L4_PIPE_R * 0.99) {
        if (body.linearDamping < 0.11) body.linearDamping = 0.12;
        continue;
      }
      const localY = body.position.y - PLAY_SURFACE_Y;
      // Wide gate: any marble whose center is at/below desk-top lip (+ small float).
      // Old gate (-PIPE_R*0.18+R) skipped shallow wedged sits that still spin from friction.
      if (localY > MARBLE_RADIUS + L4_PIPE_R * 0.12) continue;
      // Already fell through / under desk — leave alone
      if (localY < -L4_PIPE_R - MARBLE_RADIUS * 4) continue;
      body.linearDamping = 0.008;
      body.angularDamping = 0.12;
      body.wakeUp();

      const dist = l4ChannelArcDistToSW(x, z);
      if (dist === null) continue;
      // Near SW hole — let gravity pull through the open shaft
      if (hole && Math.hypot(x - hole.x, z - hole.z) < holeR * 1.15) {
        body.velocity.y = Math.min(body.velocity.y, -0.55);
        // Still nudge XZ into hole center so they don't orbit the rim
        body.velocity.x += (hole.x - x) * 2.5;
        body.velocity.z += (hole.z - z) * 2.5;
        continue;
      }

      // Mild ease: always translate meaningfully (min ~78% cruise)
      const depth = Math.max(0, -localY - MARBLE_RADIUS * 0.15);
      const depthK = Math.min(1, depth / (L4_PIPE_R * 0.45));
      const alongK = Math.min(1, Math.max(0.35, 1 - dist / 1.8));
      const speed = cruiseSpeed * (0.78 + 0.22 * depthK) * (0.85 + 0.15 * alongK);

      const next = l4ChannelStepTowardSW(x, z, speed * dt);
      if (!next) continue;
      // Force onto trough floor at new centerline — kinematic override after solver
      const support = l4SupportLocalY(next.x, next.z);
      body.position.x = next.x;
      body.position.z = next.z;
      if (support !== null) {
        body.position.y = PLAY_SURFACE_Y + support + MARBLE_RADIUS;
      } else {
        // Fallback: half-pipe floor at lat=0
        body.position.y = PLAY_SURFACE_Y - L4_PIPE_R + MARBLE_RADIUS;
      }
      const dir = l4ChannelDrainDirXZ(next.x, next.z);
      if (dir) {
        body.velocity.x = dir.x * speed;
        body.velocity.z = dir.z * speed;
        body.velocity.y = Math.min(0, body.velocity.y);
        // Rolling spin matching travel (ω = v × n / r)
        const invR = 1 / MARBLE_RADIUS;
        body.angularVelocity.x = -dir.z * speed * invR;
        body.angularVelocity.y = 0;
        body.angularVelocity.z = dir.x * speed * invR;
      }
      body.previousPosition.copy(body.position);
      if (body.interpolatedPosition) body.interpolatedPosition.copy(body.position);
    }
  }

  /**
   * Safety net vs discrete collision tunneling: keep every active marble's
   * center at/above the play surface and kill downward velocity when clamped.
   * Runs every frame after world.step (park grass + L2 sand share PLAY_SURFACE_Y).
   */
  private preventMarbleTunneling(): void {
    // L4: mat/channels/holes live below PLAY_SURFACE_Y in places (tilted desk + troughs).
    // Only rescue marbles that tunnel through the room floor — never pin to desk Y in air.
    const l4 = this.sceneLevel === 4;
    const minY = l4 ? L4_ROOM_FLOOR_Y + MARBLE_RADIUS : MARBLE_REST_Y;
    const list: MarbleEntity[] = this.fieldMarbles.slice();
    if (this.playerMarble) list.push(this.playerMarble);
    if (this.aiMarble) list.push(this.aiMarble);

    for (const m of list) {
      if (!m.active) continue;
      const body = m.body;
      if (body.type === CANNON.Body.STATIC) continue;
      const p = body.position;

      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
        const ry = l4 ? (l4MarbleRestY(0, 0) ?? MARBLE_REST_Y) : minY;
        p.set(0, ry, 0);
        body.previousPosition.set(0, ry, 0);
        body.velocity.setZero();
        body.angularVelocity.setZero();
        body.wakeUp();
        continue;
      }

      let clamped = false;
      // Hard floor (room floor on L4) — rewind previousPosition so next integrate doesn't re-sink
      if (p.y < minY) {
        p.y = minY;
        body.previousPosition.y = Math.max(body.previousPosition.y, minY);
        if (body.velocity.y < 0) body.velocity.y = 0;
        clamped = true;
      }

      if (!l4) {
        // Soft sticky contact: if barely above surface with downward vel, pin it
        if (
          body.type === CANNON.Body.DYNAMIC &&
          p.y <= minY + MARBLE_RADIUS * 0.35 &&
          body.velocity.y < 0
        ) {
          p.y = minY;
          body.previousPosition.y = minY;
          body.velocity.y = 0;
          clamped = true;
        }

        // Escape deep underground / rock-wedge jams (camp bumps intersecting ground)
        if (p.y < PLAY_SURFACE_Y) {
          p.y = minY;
          body.previousPosition.y = minY;
          body.velocity.y = Math.max(0, body.velocity.y);
          clamped = true;
        }
      } else {
        // L4: if marble is sleeping mid-air with no support, wake it so gravity drops it
        if (
          body.sleepState === CANNON.Body.SLEEPING &&
          l4SupportLocalY(p.x, p.z) === null &&
          p.y > L4_ROOM_FLOOR_Y + MARBLE_RADIUS * 3
        ) {
          body.wakeUp();
          if (body.velocity.y > -0.05) body.velocity.y = -0.2;
        }
      }

      if (clamped) body.wakeUp();
    }
  }

  private syncMeshes(): void {
    // L4: allow mesh Y down to room floor (channels / holes / falls).
    const floorY = this.sceneLevel === 4 ? L4_ROOM_FLOOR_Y + MARBLE_RADIUS : MARBLE_REST_Y;
    for (const m of this.fieldMarbles) {
      if (!m.active && !m.mesh.visible) continue;
      let y = m.body.position.y;
      if (m.active && Number.isFinite(y) && y < floorY) y = floorY;
      m.mesh.position.set(m.body.position.x, y, m.body.position.z);
      m.mesh.quaternion.set(
        m.body.quaternion.x,
        m.body.quaternion.y,
        m.body.quaternion.z,
        m.body.quaternion.w,
      );
    }
    for (const m of [this.playerMarble, this.aiMarble]) {
      if (!m) continue;
      let y = m.body.position.y;
      if (Number.isFinite(y) && y < floorY) y = floorY;
      m.mesh.position.set(m.body.position.x, y, m.body.position.z);
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
    // Final cull of any residual exits without awarding (window closed)
    this.cullExitsWithoutScore();

    // Keep shooters where they stopped — stay DYNAMIC (sleep) so the next
    // shot can collide with them like field marbles. beginTurn will only
    // kinematic-freeze the active aimer.
    for (const m of [this.playerMarble, this.aiMarble]) {
      if (!m) continue;
      m.body.velocity.setZero();
      m.body.angularVelocity.setZero();
      m.body.type = CANNON.Body.DYNAMIC;
      this.snapMarblePhysics(m, true);
      this.syncOneMesh(m);
      if (this.sceneLevel !== 4 && m.body.position.y < MARBLE_REST_Y) {
        m.body.position.y = MARBLE_REST_Y;
      }
      if (
        !Number.isFinite(m.body.position.x) ||
        !Number.isFinite(m.body.position.z)
      ) {
        const sideDist =
          this.sceneLevel === 4
            ? L4_MAT_HALF - MARBLE_RADIUS * 5
            : CIRCLE_RADIUS + MARBLE_RADIUS * 3.5;
        const x = m.owner === 'player' ? sideDist : -sideDist;
        const y =
          this.sceneLevel === 4
            ? (l4MarbleRestY(x, 0) ?? MARBLE_REST_Y)
            : MARBLE_REST_Y;
        m.body.position.set(x, y, 0);
      }
      m.body.sleep();
    }

    // cullExitsWithoutScore may have ended the match
    if (this.phase !== 'shot_flying') return;

    this.commentator?.say('endTurn', { preferLower: true }); /* caster:endTurn */

    const next: Side = this.turn === 'player' ? 'ai' : 'player';
    this.beginTurn(next);
  }

  private updateAI(dt: number): void {
    if (this.phase !== 'ai_thinking' || !this.aiMarble || !this.aiPlan) return;

    // Charge visual on power meter only
    const remain = this.aiThinkUntil - performance.now();
    const chargeT = Math.max(0, Math.min(1, 1 - remain / AI_THINK_MS));

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
        }
        // Bookkeeping for near-miss (pairs that actually touched this shot)
        const pairKey = this.contactPairKey(bi, bj);
        this.shotContactPairs.add(pairKey);

        if (impact >= 0.42) {
          this.commentator?.say('hit', { side: this.turn }); /* caster:hit */
        } else if (impact >= 0.18) {
          this.commentator?.say('softTap', { side: this.turn, preferLower: true });
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
    const now = performance.now();
    const amp = boost ? 0.28 : 0.1;
    const freq = boost ? 0.014 : 0.008;
    const pulse = 1 + Math.sin(now * freq) * amp;
    this.markerRing.scale.setScalar(pulse);
    const ringMat = this.markerRing.material as THREE.MeshBasicMaterial;
    ringMat.opacity = boost ? 0.55 + 0.4 * (0.5 + 0.5 * Math.sin(now * 0.012)) : 0.9;
    if (this.markerLife <= 0) {
      this.markerGroup.visible = false;
      this.markerHintBoost = 0;
    } else {
      const shooter = this.getActiveShooter();
      if (shooter && (this.phase === 'playing' || this.phase === 'ai_thinking')) {
        this.markerGroup.position.x = shooter.body.position.x;
        this.markerGroup.position.y = PLAY_SURFACE_Y + 0.0045;
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
    clampCamAboveSurface(this.camera.position, this.controls.target);
    this.camera.lookAt(this.controls.target);

    if (u >= 1) {
      this.camera.position.copy(this.camEase.toPos);
      this.controls.target.copy(this.camEase.toTarget);
      clampCamAboveSurface(this.camera.position, this.controls.target);
      this.camEase.active = false;
      this.camEase = null;
      // AI turn → 2-phase cam takes over; player turn → free orbit / aim
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
    // AI 2-phase cam owns framing — slow-mo time only (stay on aim/wide shot)
    if (this.shouldAIDirectorRun()) {
      this.timeScale = SLOWMO_SCALE;
      this.slowMoTimer = Math.max(this.slowMoTimer, SLOWMO_DURATION * 0.55);
      this.slowMoFollow = null;
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
      const fy = Math.max(LOOK_MIN_Y, Number.isFinite(fp.y) ? fp.y : LOOK_MIN_Y);
      this.camera.position.set(
        fp.x + this._slowMoCamOffset.x,
        Math.max(CAM_MIN_Y, fy + this._slowMoCamOffset.y),
        fp.z + this._slowMoCamOffset.z,
      );
      this.controls.target.set(fp.x, fy, fp.z);
      clampCamAboveSurface(this.camera.position, this.controls.target);
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

    const lookY = Math.max(LOOK_MIN_Y, Number.isFinite(fp.y) ? fp.y : LOOK_MIN_Y);
    const ox = this.camera.position.x - fp.x;
    const oy = this.camera.position.y - fp.y;
    const oz = this.camera.position.z - fp.z;
    let len = Math.hypot(ox, oy, oz);
    let dx = ox;
    let dy = oy;
    let dz = oz;
    if (len < 0.08) {
      dx = 0.12;
      dy = 0.18;
      dz = 0.18;
      len = Math.hypot(dx, dy, dz);
    }
    // Prefer a slightly elevated punch vector so we never dive under dirt
    if (dy < 0.12) {
      dy = 0.12;
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
          Math.max(LOOK_MIN_Y, Number.isFinite(bp.y) ? bp.y : LOOK_MIN_Y),
          bp.z,
        );
      }
    }
    this._punchTarget.copy(kp.lastFollow);
    this._punchPos.set(
      this._punchTarget.x + kp.offsetDir.x * kp.offsetLen,
      Math.max(CAM_MIN_Y, this._punchTarget.y + kp.offsetDir.y * kp.offsetLen),
      this._punchTarget.z + kp.offsetDir.z * kp.offsetLen,
    );
    clampCamAboveSurface(this._punchPos, this._punchTarget);

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
    clampCamAboveSurface(this.camera.position, this.controls.target);
    this.camera.lookAt(this.controls.target);
  }

  // ─── AI 2-phase camera (aim → wide) ─────────────────────────────────

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

  private desiredAIShot(): AIShotCam {
    return this.phase === 'shot_flying' ? 'wide' : 'aim';
  }

  private ensureAIDirector(): void {
    if (this.aiDirector?.active) return;
    const shot = this.desiredAIShot();
    this.aiDirector = {
      active: true,
      shot,
      blendT: 0,
      blendDur: aiShotBlendDuration(shot),
      blending: true,
      fromPos: this.camera.position.clone(),
      toPos: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toTarget: this.controls.target.clone(),
    };
    this.controls.enabled = false;
    this.controls.enableDamping = false;
    // Blend from current pose into the first phase shot (no hard pop)
    this.refreshAIDirectorFraming(false);
  }

  /** Switch aim ↔ wide at most once per phase change (no cut cycling). */
  private switchAIDirectorShot(shot: AIShotCam): void {
    const d = this.aiDirector;
    if (!d || d.shot === shot) return;
    d.shot = shot;
    d.blendDur = aiShotBlendDuration(shot);
    d.blendT = 0;
    d.blending = true;
    d.fromPos.copy(this.camera.position);
    d.fromTarget.copy(this.controls.target);
    this.refreshAIDirectorFraming(false);
  }

  private refreshAIDirectorFraming(snap: boolean): void {
    const d = this.aiDirector;
    if (!d) return;
    const portrait = window.innerHeight > window.innerWidth;

    let frame;
    if (d.shot === 'aim') {
      const subject = this.aiMarble;
      if (!subject?.active) {
        d.toTarget.set(0, LOOK_MIN_Y, 0);
        // L3 default aim pose: open side of bowl (never over chair at +X)
        if (this.sceneLevel === 3) {
          d.toPos.set(-0.35, Math.max(CAM_MIN_Y, 0.42), 0.28);
        } else {
          d.toPos.set(0.35, Math.max(CAM_MIN_Y, 0.4), 0.45);
        }
        clampCamAboveSurface(d.toPos, d.toTarget);
      } else {
        frame = framingAIAim(
          subject,
          this.defaultCamAzimuth,
          portrait,
          this.sceneLevel,
        );
        d.toPos.copy(frame.pos);
        d.toTarget.copy(frame.target);
      }
    } else {
      frame = framingAIWide(
        this.fieldMarbles,
        this.aiMarble,
        this.defaultCamAzimuth,
        portrait,
        this._dirLook,
        this.sceneLevel,
      );
      d.toPos.copy(frame.pos);
      d.toTarget.copy(frame.target);
    }

    clampCamAboveSurface(d.toPos, d.toTarget);
    if (snap) {
      this.camera.position.copy(d.toPos);
      this.controls.target.copy(d.toTarget);
      clampCamAboveSurface(this.camera.position, this.controls.target);
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

    // Phase change: thinking→flying triggers one ease to wide (and never back-cycles)
    const want = this.desiredAIShot();
    if (want !== d.shot) {
      this.switchAIDirectorShot(want);
    }

    // Keep destination fresh so aim tracks the AI marble / wide tracks the circle
    this.refreshAIDirectorFraming(false);

    if (d.blending) {
      d.blendT += dt;
      const u = Math.min(1, d.blendT / Math.max(1e-6, d.blendDur));
      const e = u * u * (3 - 2 * u);
      this.camera.position.lerpVectors(d.fromPos, d.toPos, e);
      this.controls.target.lerpVectors(d.fromTarget, d.toTarget, e);
      if (u >= 1) {
        d.blending = false;
        this.camera.position.copy(d.toPos);
        this.controls.target.copy(d.toTarget);
      }
    } else {
      // Soft track — aim follows marble; wide drifts with field centroid
      const k = 1 - Math.exp((d.shot === 'aim' ? -3.2 : -2.0) * dt);
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
    clampCamAboveSurface(this.camera.position, this.controls.target);
    this.camera.lookAt(this.controls.target);
    this.controls.enabled = false;
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
    if (this.dentistOffice) {
      this.dentistOffice.update(dt);
    }
    if (this.officeDesk) {
      this.officeDesk.update(dt);
    }
    this.syncPlayerOutline();

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
    // L4 convoy AFTER physics: kinematic centerline drive so the contact solver cannot
    // cancel translation (root cause of live spin-in-place). Uses simulated dt.
    const simDt = Math.min(physDt, 10 / 120);
    this.applyL4ChannelDrain(simDt);
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
      this.processNearMisses();
      this.tryFinishShotTurn();
    }

    // Aim / think: never award — only strip leftover exits from the scoring set
    if (this.phase === 'playing' || this.phase === 'ai_thinking') {
      this.cullExitsWithoutScore();
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
    // L4 elevated desk: absolute meters (circle×scale is too tight to show legs)
    const l4 = this.sceneLevel === 4;
    const dist = l4
      ? portrait ? 2.55 : 2.25
      : CIRCLE_RADIUS * (portrait ? 3.0 : 2.5);
    const polar = l4 ? (portrait ? 1.28 : 1.2) : portrait ? 1.05 : 0.92;
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


  private loadPlayerIdentityFromSave(): void {
    const save = loadSave();
    this.playerName = save.playerName || DEFAULT_PLAYER_NAME;
    this.playerMoney = save.playerMoney || 0;
    this.commentator?.setPlayerName(this.playerName);
    this.updateScoreHUD();
    this.updateTurnHUD();
  }

  private showGameToast(msg: string, ms = 2600): void {
    const el = this.els.gameToast;
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    el.classList.add('show');
    window.clearTimeout((this.showGameToast as unknown as { _t?: number })._t);
    (this.showGameToast as unknown as { _t?: number })._t = window.setTimeout(() => {
      el.classList.add('hidden');
      el.classList.remove('show');
    }, ms);
  }

  private contactPairKey(a: CANNON.Body, b: CANNON.Body): string {
    const ia = (a as unknown as { id?: number }).id ?? 0;
    const ib = (b as unknown as { id?: number }).id ?? 0;
    return ia < ib ? `${ia}:${ib}` : `${ib}:${ia}`;
  }

  /**
   * Soft-sleep very slow leftovers when entering aim so residual momentum
   * rarely causes late exits during the next player's aiming window.
   */
  private softSleepSlowFieldMarbles(): void {
    const list: MarbleEntity[] = this.fieldMarbles.slice();
    if (this.playerMarble) list.push(this.playerMarble);
    if (this.aiMarble) list.push(this.aiMarble);
    const l4 = this.sceneLevel === 4;
    for (const m of list) {
      if (!m.active) continue;
      if (m.body.type === CANNON.Body.KINEMATIC) continue;
      // L4: never sleep mid-air / off-support floaters — let gravity drop them
      if (l4 && l4SupportLocalY(m.body.position.x, m.body.position.z) === null) {
        m.body.wakeUp();
        continue;
      }
      const v = m.body.velocity.length();
      const w = m.body.angularVelocity.length();
      if (v < SETTLE_SPEED * 2.5 && w < SETTLE_SPEED * 80) {
        m.body.velocity.setZero();
        m.body.angularVelocity.setZero();
        m.body.sleep();
      }
    }
  }

  /**
   * During aim / after scoring window closes: if a field marble has already
   * left the circle / fallen in the hole, remove it from the scoring set
   * WITHOUT awarding anyone. Fixes residual-momentum wrong attribution.
   */
  private cullExitsWithoutScore(): void {
    const l3 = this.sceneLevel === 3;
    const l4 = this.sceneLevel === 4;
    const holeOpen = l3 && !!this.dentistOffice?.holeOpen;

    for (const m of this.fieldMarbles) {
      if (!m.active) continue;
      if (!this.scoringMarbles.has(m)) continue;
      const dist = Math.hypot(m.body.position.x, m.body.position.z);
      const fallen = m.body.position.y < -0.05 || (l4 && this.isOffL4Desk(m.body.position.x, m.body.position.y, m.body.position.z));
      const inL4Hole = l4 && this.isInL4Hole(m.body.position.x, m.body.position.y, m.body.position.z);
      const scored = l3
        ? holeOpen && (dist < L3_HOLE_RADIUS + OUT_MARGIN || fallen)
        : l4
          ? inL4Hole || fallen
          : dist > CIRCLE_RADIUS + OUT_MARGIN || fallen;
      const leftBowl = l3 && dist > CIRCLE_RADIUS + OUT_MARGIN * 4;
      if (!(scored || leftBowl || fallen)) continue;

      // No points — strip eligibility only
      this.scoringMarbles.delete(m);
      this.commentator?.say('badLuck', {
        side: this.turn,
        preferLower: true,
      });

      if (fallen || dist > DESPAWN_DIST || (l3 && (scored || leftBowl)) || (l4 && scored)) {
        m.active = false;
        m.mesh.visible = false;
        m.body.velocity.setZero();
        m.body.angularVelocity.setZero();
        m.body.position.y = -1;
        m.body.type = CANNON.Body.STATIC;
      } else {
        // Outside circle but still visible — freeze inert
        m.body.velocity.setZero();
        m.body.angularVelocity.setZero();
        m.body.sleep();
      }
    }

    // Match can end if cull emptied the set (rare; don't award)
    if (
      this.scoringMarbles.size === 0 &&
      this.fieldMarbles.length > 0 &&
      this.phase !== 'ended' &&
      this.phase !== 'ready' &&
      this.phase !== 'dropping' &&
      this.phase !== 'settling'
    ) {
      this.endGame();
    }
  }

  /** Fast marble passes very close to another without contact → near-miss line. */
  private processNearMisses(): void {
    if (this.phase !== 'shot_flying' || !this.scoringEnabled) return;
    const now = performance.now();
    if (now < this.nearMissCooldownUntil) return;

    const list: MarbleEntity[] = [];
    for (const m of this.fieldMarbles) if (m.active) list.push(m);
    if (this.playerMarble?.active) list.push(this.playerMarble);
    if (this.aiMarble?.active) list.push(this.aiMarble);

    const nearDist = MARBLE_RADIUS * 2.55;
    const minFast = 0.55;
    for (let i = 0; i < list.length; i++) {
      const a = list[i]!;
      const va = a.body.velocity.length();
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j]!;
        const vb = b.body.velocity.length();
        if (Math.max(va, vb) < minFast) continue;
        const dx = a.body.position.x - b.body.position.x;
        const dy = a.body.position.y - b.body.position.y;
        const dz = a.body.position.z - b.body.position.z;
        const dist = Math.hypot(dx, dy, dz);
        if (dist > nearDist || dist < MARBLE_RADIUS * 2.02) continue;
        const key = this.contactPairKey(a.body, b.body);
        if (this.shotContactPairs.has(key)) continue;
        // Closing or grazing: relative approach along separation
        const rvx = a.body.velocity.x - b.body.velocity.x;
        const rvz = a.body.velocity.z - b.body.velocity.z;
        const closing = dx * rvx + dz * rvz;
        // Allow both approaching and just-passed (small positive) near-misses
        if (closing > Math.max(va, vb) * nearDist * 0.35) continue;

        if (
          this.commentator?.say('nearMiss', {
            side: this.turn,
            preferLower: true,
          })
        ) {
          this.nearMissCooldownUntil = now + 1800;
          return;
        }
      }
    }
  }

  private shouldRestoreMatchOnBoot(): boolean {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('load') !== '1') return false;
      const save = loadSave();
      return !!save.matchSnapshot && save.matchSnapshot.sceneLevel === this.sceneLevel;
    } catch {
      return false;
    }
  }

  private bodyTypeFromSnap(t: MarbleBodySnap['bodyType']): CANNON.Body['type'] {
    if (t === 'kinematic') return CANNON.Body.KINEMATIC as CANNON.Body['type'];
    if (t === 'static') return CANNON.Body.STATIC as CANNON.Body['type'];
    return CANNON.Body.DYNAMIC as CANNON.Body['type'];
  }

  private snapBodyType(body: CANNON.Body): MarbleBodySnap['bodyType'] {
    if (body.type === CANNON.Body.KINEMATIC) return 'kinematic';
    if (body.type === CANNON.Body.STATIC) return 'static';
    return 'dynamic';
  }

  private captureMarbleSnap(m: MarbleEntity): MarbleBodySnap {
    const knockedBy = this.playerKnocked.has(m)
      ? 'player'
      : this.aiKnocked.has(m)
        ? 'ai'
        : null;
    return {
      designId: m.design.id,
      owner: m.owner,
      active: m.active,
      visible: m.mesh.visible,
      inScoring: this.scoringMarbles.has(m),
      knockedBy,
      x: m.body.position.x,
      y: m.body.position.y,
      z: m.body.position.z,
      qx: m.body.quaternion.x,
      qy: m.body.quaternion.y,
      qz: m.body.quaternion.z,
      qw: m.body.quaternion.w,
      vx: m.body.velocity.x,
      vy: m.body.velocity.y,
      vz: m.body.velocity.z,
      wx: m.body.angularVelocity.x,
      wy: m.body.angularVelocity.y,
      wz: m.body.angularVelocity.z,
      bodyType: this.snapBodyType(m.body),
    };
  }

  private applyMarbleSnap(m: MarbleEntity, snap: MarbleBodySnap): void {
    m.active = snap.active;
    m.mesh.visible = snap.visible;
    m.body.position.set(snap.x, snap.y, snap.z);
    m.body.previousPosition.set(snap.x, snap.y, snap.z);
    m.body.quaternion.set(snap.qx, snap.qy, snap.qz, snap.qw);
    m.body.velocity.set(snap.vx, snap.vy, snap.vz);
    m.body.angularVelocity.set(snap.wx, snap.wy, snap.wz);
    m.body.type = this.bodyTypeFromSnap(snap.bodyType);
    if (snap.active && snap.bodyType === 'dynamic') {
      const speed = Math.hypot(snap.vx, snap.vy, snap.vz);
      if (speed < SETTLE_SPEED * 2) m.body.sleep();
      else m.body.wakeUp();
    } else if (!snap.active) {
      m.body.type = CANNON.Body.STATIC;
    }
    this.syncOneMesh(m);
  }

  private designForFieldId(id: string) {
    return (
      this.fieldDesigns.find((d) => d.id === id) ??
      this.fieldDesigns[0] ??
      createFieldDesigns()[0]!
    );
  }

  private captureMatchSnapshot(): MatchSnapshot {
    const phase =
      this.phase === 'replay'
        ? 'playing'
        : (this.phase as MatchSnapshot['phase']);
    return {
      version: 1,
      savedAt: Date.now(),
      sceneLevel: this.sceneLevel,
      phase,
      turn: this.turn,
      playerName: this.playerName,
      opponentName: this.opponentName,
      playerScore: this.playerScore,
      aiScore: this.aiScore,
      playerMoney: this.playerMoney,
      lastScorer: this.lastScorer,
      scoringEnabled: false, // always resume in a safe non-scoring window
      holeOpen: !!this.dentistOffice?.holeOpen,
      field: this.fieldMarbles.map((m) => this.captureMarbleSnap(m)),
      player: this.playerMarble ? this.captureMarbleSnap(this.playerMarble) : null,
      ai: this.aiMarble ? this.captureMarbleSnap(this.aiMarble) : null,
      camX: this.camera.position.x,
      camY: this.camera.position.y,
      camZ: this.camera.position.z,
      targetX: this.controls.target.x,
      targetY: this.controls.target.y,
      targetZ: this.controls.target.z,
    };
  }

  private saveMatchCheckpoint(): void {
    if (this.phase === 'ready' || this.phase === 'dropping' || this.phase === 'settling') {
      this.showGameToast('Aún no hay partida para guardar — suelta las canicas primero.');
      return;
    }
    if (this.phase === 'replay') {
      this.showGameToast('Sal de la repetición para guardar.');
      return;
    }
    const snap = this.captureMatchSnapshot();
    writeMatchSnapshot(snap);
    this.showGameToast(formatSaveToast(snap));
  }

  private loadMatchCheckpointFromPause(): void {
    const save = loadSave();
    const snap = save.matchSnapshot;
    if (!snap) {
      this.showGameToast('No hay partida guardada.');
      return;
    }
    if (snap.sceneLevel !== this.sceneLevel) {
      const control = resolveControlMode();
      window.location.href =
        buildGameHref(control, snap.sceneLevel) +
        (buildGameHref(control, snap.sceneLevel).includes('?') ? '&' : '?') +
        'load=1';
      return;
    }
    try {
      this.restoreMatchFromSave();
      this.setPaused(false);
      this.showGameToast('Partida cargada.');
    } catch (err) {
      console.warn(err);
      this.showGameToast('No se pudo cargar la partida.');
    }
  }

  private restoreMatchFromSave(): void {
    const save = loadSave();
    const snap = save.matchSnapshot;
    if (!snap || snap.sceneLevel !== this.sceneLevel) {
      throw new Error('snapshot missing or wrong level');
    }

    this.forcedWinner = null;
    this.commentator?.hide();
    this.els.endScreen.classList.add('hidden');
    this.els.gachaOverlay.classList.add('hidden');
    this.hideVictoryScreen();
    this.cancelAimGesture(true);
    this.els.powerWrap.classList.add('hidden');
    this.camEase = null;
    this.clearKnockoutCamPunch(false);
    this.stopAIDirector();
    this.throwPendingImpulse = null;
    this.particles?.clear();
    this.dirtCooldown.clear();
    this.disarmPlayerIdleHint();
    this.hideLocationBanner();
    this.markerGroup.visible = false;
    this.recording = true;
    this.replay.clear();

    this.playerName = snap.playerName || DEFAULT_PLAYER_NAME;
    this.opponentName = snap.opponentName || this.opponentName;
    this.commentator?.setPlayerName(this.playerName);
    this.playerScore = snap.playerScore;
    this.aiScore = snap.aiScore;
    this.playerMoney = snap.playerMoney;
    this.lastScorer = snap.lastScorer;
    this.scoringEnabled = false;
    this.turn = snap.turn;
    this.level = this.sceneLevel;

    if (this.sceneLevel === 3 && this.dentistOffice && snap.holeOpen) {
      this.dentistOffice.openCenterHole(this.world);
    }

    this.clearFieldMarbles();
    this.removeShooter('player');
    this.removeShooter('ai');

    // Restore field (do not wipe scores again — clearFieldMarbles zeroed them)
    this.playerScore = snap.playerScore;
    this.aiScore = snap.aiScore;
    this.playerMoney = snap.playerMoney;
    this.playerKnocked.clear();
    this.aiKnocked.clear();
    this.scoringMarbles.clear();

    for (const fs of snap.field) {
      const design = this.designForFieldId(fs.designId);
      const ent = createMarbleEntity(
        design,
        new CANNON.Vec3(fs.x, fs.y, fs.z),
        'field',
      );
      this.scene.add(ent.mesh);
      this.world.addBody(ent.body);
      this.fieldMarbles.push(ent);
      this.applyMarbleSnap(ent, fs);
      if (fs.inScoring && ent.active) this.scoringMarbles.add(ent);
      if (fs.knockedBy === 'player') this.playerKnocked.add(ent);
      if (fs.knockedBy === 'ai') this.aiKnocked.add(ent);
    }

    if (snap.player) {
      const player = createMarbleEntity(
        this.playerDesign,
        new CANNON.Vec3(snap.player.x, snap.player.y, snap.player.z),
        'player',
      );
      if (this.sceneLevel === 4) applyL4ShooterCollisionFilter(player.body);
      this.scene.add(player.mesh);
      this.world.addBody(player.body);
      this.playerMarble = player;
      this.applyMarbleSnap(player, snap.player);
      this.attachPlayerOutline(player);
    }
    if (snap.ai) {
      const ai = createMarbleEntity(
        this.aiDesign,
        new CANNON.Vec3(snap.ai.x, snap.ai.y, snap.ai.z),
        'ai',
      );
      if (this.sceneLevel === 4) applyL4ShooterCollisionFilter(ai.body);
      this.scene.add(ai.mesh);
      this.world.addBody(ai.body);
      this.aiMarble = ai;
      this.applyMarbleSnap(ai, snap.ai);
    }

    this.camera.position.set(snap.camX, snap.camY, snap.camZ);
    this.controls.target.set(snap.targetX, snap.targetY, snap.targetZ);
    this.controls.update();

    // Resume in a safe phase: if was mid-shot, treat as settled handoff to current turn
    let phase = snap.phase;
    if (phase === 'shot_flying' || phase === 'dropping' || phase === 'settling') {
      phase = snap.turn === 'ai' ? 'ai_thinking' : 'playing';
    }
    if (phase === 'ended') {
      this.setPhase('ended');
      this.updateScoreHUD();
      this.updateTurnHUD();
      return;
    }

    // Re-enter turn framing without resetting marble poses
    this.scoringEnabled = false;
    if (phase === 'playing' || phase === 'ai_thinking') {
      this.beginTurn(snap.turn);
    } else {
      this.setPhase(phase);
    }
    this.updateScoreHUD();
    this.updateTurnHUD();
  }


  /** L4: marble in the single SW-corner channel hole (or fallen into pit). */
  private isInL4Hole(x: number, y: number, z: number): boolean {
    const desk = this.officeDesk;
    if (!desk) return false;
    if (y < PLAY_SURFACE_Y - 0.04) {
      // Fallen below desk near a hole
      for (const h of desk.holeCenters) {
        if (Math.hypot(x - h.x, z - h.z) < desk.holeRadius * 2.2) return true;
      }
    }
    for (const h of desk.holeCenters) {
      if (Math.hypot(x - h.x, z - h.z) < desk.holeRadius + OUT_MARGIN) {
        // Must be at/near channel height or below mat
        if (y < PLAY_SURFACE_Y + MARBLE_RADIUS * 1.5) return true;
      }
    }
    return false;
  }


  /** L4: marble left real desk support or dropped below the top (fell off / through). */
  private isOffL4Desk(
    x: number,
    y: number,
    z: number,
    opts?: { shooter?: boolean },
  ): boolean {
    if (!this.officeDesk) return y < PLAY_SURFACE_Y - 0.06;
    // Below desk trough / into room → fallen
    if (y < PLAY_SURFACE_Y - L4_GUTTER_DEPTH - MARBLE_RADIUS * 2) return true;
    if (opts?.shooter) {
      // Shooters ride bridges over half-pipe/hole — only leave via desk edge → floor
      if (l4ShooterSupportLocalY(x, z) === null) {
        return y < PLAY_SURFACE_Y - MARBLE_RADIUS * 0.5;
      }
      return false;
    }
    // Field: no collider under this XZ (past outer lip, hole opening, or void) → off desk
    return l4SupportLocalY(x, z) === null;
  }

  /**
   * If a shooter somehow ends up in a channel/hole (tunneling / old pose), snap it
   * back onto the mat. Does not affect field marbles.
   */
  private rescueL4ShootersFromChannels(): void {
    if (this.sceneLevel !== 4 || !this.officeDesk) return;
    const outer = L4_MAT_HALF + L4_CHANNEL_W;
    for (const m of [this.playerMarble, this.aiMarble]) {
      if (!m || !m.active) continue;
      const p = m.body.position;
      const overPlayWell = Math.abs(p.x) <= outer + 0.02 && Math.abs(p.z) <= outer + 0.02;
      // Bridges keep shooters at desk-top; only rescue if they tunneled into the trough.
      const sunkInTrough =
        overPlayWell && p.y < PLAY_SURFACE_Y - L4_GUTTER_DEPTH * 0.25;
      if (!sunkInTrough) continue;
      // Keep XZ — lift onto the invisible bridge (do NOT yank back onto the mat).
      p.y = l4ShooterMarbleRestY(p.x, p.z) ?? MARBLE_REST_Y;
      m.body.velocity.setZero();
      m.body.angularVelocity.setZero();
      this.syncOneMesh(m);
    }
  }

  /**
   * L4 lose conditions for a personal (shooter) marble:
   * falling off the desk edge to the floor → that side loses ("perdiste").
   * Half-pipe / SW hole are shooter-bridged; field marbles still fall in / score.
   */
  private checkL4PersonalMarbleFail(): boolean {
    this.rescueL4ShootersFromChannels();
    const check = (m: MarbleEntity | null, side: Side): boolean => {
      if (!m || !m.active) return false;
      const { x, y, z } = m.body.position;
      const offDesk = this.isOffL4Desk(x, y, z, { shooter: true });
      if (!offDesk) return false;

      m.active = false;
      m.mesh.visible = false;
      m.body.velocity.setZero();
      m.body.angularVelocity.setZero();
      m.body.type = CANNON.Body.STATIC;
      if (side === 'player') this.clearPlayerOutline();

      this.forcedWinner = side === 'player' ? 'ai' : 'player';
      const why = 'se cayó del escritorio';
      if (side === 'player') {
        this.flashLocationBanner(
          `¡Perdiste! Canica de ${this.playerName} ${why}`,
          'banner-player',
          2800,
        );
      } else {
        this.flashLocationBanner(
          `Canica de ${this.opponentName} ${why} — ¡ganas!`,
          'banner-ai',
          2800,
        );
      }
      this.endGame();
      return true;
    };
    if (check(this.playerMarble, 'player')) return true;
    if (check(this.aiMarble, 'ai')) return true;
    return false;
  }

  /** Mid-match: swap only the player shooter mesh/material; keep pose & match state. */
  private applyPlayerSkinLive(seed: string): void {
    try {
      const design = createDesignFromSeed(seed);
      this.playerDesign = design;
      const player = this.playerMarble;
      if (!player) return;
      const old = player.mesh.material;
      player.mesh.material = design.material.clone();
      player.design = design;
      if (Array.isArray(old)) old.forEach((m) => m.dispose());
      else old.dispose();
      // Re-attach outline if it was a child (material swap keeps children)
      if (!this.playerOutline || this.playerOutline.parent !== player.mesh) {
        this.attachPlayerOutline(player);
      }
    } catch {
      /* ignore bad seed */
    }
  }

  /** Personalizar + mat picker: visible only on Level 4. */
  private syncL4PersonalizarVisibility(): void {
    const btn = document.getElementById('btn-l4-personalizar');
    if (btn) btn.classList.toggle('hidden', this.sceneLevel !== 4);
    const menu = document.getElementById('l4-mat-menu');
    if (menu && this.sceneLevel !== 4) menu.classList.add('hidden');
  }

  private bindL4Personalizar(): void {

    const btn = document.getElementById('btn-l4-personalizar');
    const menu = document.getElementById('l4-mat-menu');
    const presetsEl = document.getElementById('l4-mat-presets');
    const file = document.getElementById('l4-mat-file') as HTMLInputElement | null;
    const closeBtn = document.getElementById('btn-l4-mat-close');
    if (!btn || !menu || !presetsEl) return;

    const refreshPresets = () => {
      const desk = this.officeDesk;
      presetsEl.innerHTML = '';
      if (!desk) return;
      for (const p of desk.getMatPresets()) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className =
          'l4-mat-preset' + (desk.currentMatId === p.id ? ' active' : '');
        b.textContent = p.label;
        b.addEventListener('click', () => {
          desk.setMatPreset(p.id);
          refreshPresets();
        });
        presetsEl.appendChild(b);
      }
    };

    btn.addEventListener('click', () => {
      if (this.sceneLevel !== 4 || !this.officeDesk) {
        btn.classList.add('hidden');
        menu.classList.add('hidden');
        return;
      }
      refreshPresets();
      menu.classList.remove('hidden');
    });
    closeBtn?.addEventListener('click', () => menu.classList.add('hidden'));
    menu.addEventListener('click', (e) => {
      if (e.target === menu) menu.classList.add('hidden');
    });
    file?.addEventListener('change', () => {
      const f = file.files?.[0];
      file.value = '';
      if (!f || !this.officeDesk) return;
      const reader = new FileReader();
      reader.onload = () => {
        const url = String(reader.result || '');
        if (url) this.officeDesk?.setMatFromDataUrl(url);
        refreshPresets();
      };
      reader.readAsDataURL(f);
    });
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
    if (
      this.pendingContinueLevel === 2 ||
      this.pendingContinueLevel === 3 ||
      this.pendingContinueLevel === 4
    ) {
      window.location.href = buildGameHref(control, this.pendingContinueLevel);
      return;
    }
    // L4 victory or no next → title
    window.location.href = buildMenuHref();
  }

  private showVictoryScreen(playerScore: number, aiScore: number): void {
    this.els.endScreen.classList.add('hidden');
    this.els.gachaOverlay.classList.add('hidden');
    const aiMoney = aiScore * MONEY_PER_KNOCKOUT;
    const scoringVerb =
      this.sceneLevel === 3
        ? 'Canicas al hoyo'
        : this.sceneLevel === 4
          ? 'Canicas al hoyo SW (half-pipe)'
          : 'Canicas sacadas';
    this.els.victoryWinner.textContent = t('victory.winner');
    this.els.victoryMoney.textContent =
      `Dinero · ${this.playerName} $${this.playerMoney} · ${this.opponentName} $${aiMoney}`;
    this.els.victoryMarbles.textContent =
      `${scoringVerb} · ${this.playerName} ${playerScore} · ${this.opponentName} ${aiScore}`;
    this.els.victoryMeta.textContent =
      `${sceneLevelLabel(this.sceneLevel)} · Rival: ${this.opponentName}`;

    this.els.victoryOverlay.classList.remove('hidden');
    this.els.victoryOverlay.setAttribute('aria-hidden', 'false');
    startVictoryConfetti();

    if (!this.victoryShowcase) {
      this.victoryShowcase = new MarbleShowcase(this.els.victoryMarbleCanvas);
    }
    // Equipped shooter — battle materials, slow spin in the ring hole
    this.victoryShowcase.show(this.playerDesign);
  }

  private hideVictoryScreen(): void {
    this.els.victoryOverlay.classList.add('hidden');
    this.els.victoryOverlay.setAttribute('aria-hidden', 'true');
    stopVictoryConfetti();
    this.victoryShowcase?.stop();
  }

  private startVictoryGacha(): void {
    this.els.endScreen.classList.add('hidden');
    this.hideVictoryScreen();
    this.els.gachaOverlay.classList.remove('hidden');
    this.els.gachaOverlay.setAttribute('aria-hidden', 'false');
    this.els.gachaReveal.classList.add('hidden');
    this.els.gachaCase.classList.add('spinning');
    this.els.gachaCase.classList.remove('open');
    this.els.gachaStatus.classList.remove('hidden');
    this.els.gachaStatus.textContent = t('gacha.status.gen');

    if (!this.pendingGachaSeed) {
      const existing = loadSave().collection.map((c) => c.seed);
      this.pendingGachaSeed = generateUniqueMarbleSeed(
        existing,
        `L${this.sceneLevel}`,
      );
    }
    const seed = this.pendingGachaSeed;
    const params = paramsFromSeed(seed);
    const rewardDesign = createDesignFromSeed(seed);

    // Spin + lightning beat, then open
    window.setTimeout(() => {
      if (this.els.gachaOverlay.classList.contains('hidden')) return;
      this.els.gachaStatus.textContent = t('gacha.status.open');
      this.els.gachaCase.classList.remove('spinning');
      this.els.gachaCase.classList.add('open');
    }, 1600);

    window.setTimeout(() => {
      if (this.els.gachaOverlay.classList.contains('hidden')) return;
      if (!this.gachaShowcase) {
        this.gachaShowcase = new MarbleShowcase(this.els.gachaMarbleCanvas);
      }
      this.gachaShowcase.show(rewardDesign);
      this.els.gachaMarbleName.textContent = params.name;
      this.els.gachaMarbleSub.textContent = t('gacha.sub');
      this.els.gachaStatus.classList.add('hidden');
      this.els.gachaReveal.classList.remove('hidden');
      addToCollection({
        seed,
        name: params.name,
        createdAt: Date.now(),
        fromLevel: this.sceneLevel,
      });
      // Auto-equip the new marble as shooter skin
      this.playerDesign = rewardDesign;
      this.pendingGachaSeed = null;
    }, 2300);
  }

  private finishGachaAndContinue(): void {
    this.els.gachaOverlay.classList.add('hidden');
    this.els.gachaOverlay.setAttribute('aria-hidden', 'true');
    this.gachaShowcase?.stop();
    // After reward, advance (next level or title) — victory already showed the match card
    this.continueToNextLevel();
  }
}
