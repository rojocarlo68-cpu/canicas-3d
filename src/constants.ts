/** Scale: 1 Three/Cannon unit = 1 meter */
export const MARBLE_RADIUS = 0.008; // 1.6 cm diameter
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

/** Shot power: impulse magnitude range */
export const SHOT_MIN = 0.0012;
export const SHOT_MAX = 0.0095;
/** Vertical drag distance (px) from 0→1 power while holding shoot */
export const POWER_DRAG_PX = 160;

/** Out-of-circle when center is beyond circle + small margin */
export const OUT_MARGIN = MARBLE_RADIUS * 0.25;

/** Soft despawn distance (still on endless ground) */
export const DESPAWN_DIST = CIRCLE_RADIUS * 4;

/** Replay ring buffer ~10 s at 60 fps */
export const REPLAY_SECONDS = 10;
export const REPLAY_FPS = 60;
export const REPLAY_CAPACITY = REPLAY_SECONDS * REPLAY_FPS;

/** Starting AI difficulty level */
export const START_LEVEL = 1;
