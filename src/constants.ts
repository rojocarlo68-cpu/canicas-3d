/** Scale: 1 Three/Cannon unit = 1 meter */
export const MARBLE_RADIUS = 0.008; // 1.6 cm diameter
/** Glass-marble mass ≈ density 2500 kg/m³ × (4/3)πr³ */
export const MARBLE_MASS = 0.0055;
/** Fat-finger pick radius vs visual marble radius (screen or world) */
export const MARBLE_PICK_TOLERANCE = 1.4;
/** Push mode: max exit speed along ground (m/s) — heavy, not floaty */
export const PUSH_MAX_SPEED = 1.25;
/** Fraction of finger world-speed transferred to the marble */
export const PUSH_VELOCITY_GAIN = 0.72;
export const DROP_HEIGHT = 0.1; // 10 cm above ground
/** Play circle on ground (2× original 0.16) */
export const CIRCLE_RADIUS = 0.32;
export const GROUND_SIZE = 40; // very large so edge is not visible
export const FIELD_MARBLE_COUNT = 10;
export const GRAVITY = -9.81;

export const GROUND_FRICTION = 0.55;
export const GROUND_RESTITUTION = 0.28;
export const MARBLE_FRICTION = 0.4;
export const MARBLE_RESTITUTION = 0.42;
export const MARBLE_LINEAR_DAMPING = 0.12;
export const MARBLE_ANGULAR_DAMPING = 0.18;

/** Settling: consider at rest when speed below this (m/s) */
export const SETTLE_SPEED = 0.015;
export const SETTLE_WAIT_MS = 900;
export const SETTLE_MAX_MS = 6000;

/** After drop: wait this long, then fully freeze field marbles in place */
export const DROP_FREEZE_MS = 5000;

/** Slow-mo time scale during dramatic marble impacts / knockouts */
export const SLOWMO_SCALE = 0.22;
export const SLOWMO_DURATION = 1.15; // real-time seconds
export const SLOWMO_IMPACT_THRESHOLD = 0.55;

/** Shot power: impulse magnitude range */
export const SHOT_MIN = 0.0012;
export const SHOT_MAX = 0.0095;
/** Out-of-circle when center is beyond circle + small margin */
export const OUT_MARGIN = MARBLE_RADIUS * 0.25;

/** Invisible physics boundary ~3 m outside the play circle */
export const BOUNDARY_OFFSET = 3;
export const BOUNDARY_RADIUS = CIRCLE_RADIUS + BOUNDARY_OFFSET; // ≈ 3.32 m
export const BOUNDARY_WALL_HEIGHT = 0.45;
export const BOUNDARY_WALL_THICKNESS = 0.1;
export const BOUNDARY_SEGMENTS = 48;
export const BOUNDARY_FRICTION = 0.35;
export const BOUNDARY_RESTITUTION = 0.55;

/** Soft despawn just beyond the invisible wall (tunneling safety net) */
export const DESPAWN_DIST = BOUNDARY_RADIUS + 0.5;

/** Replay ring buffer ~10 s at 60 fps */
export const REPLAY_SECONDS = 10;
export const REPLAY_FPS = 60;
export const REPLAY_CAPACITY = REPLAY_SECONDS * REPLAY_FPS;

/** Starting AI difficulty level */
export const START_LEVEL = 1;

/** Dollars credited per field marble knocked out of the circle */
export const MONEY_PER_KNOCKOUT = 2;
