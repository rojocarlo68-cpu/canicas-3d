/** Scale: 1 Three/Cannon unit = 1 meter */
export const MARBLE_RADIUS = 0.008; // 1.6 cm diameter
export const DROP_HEIGHT = 0.13; // 13 cm above ground
export const CIRCLE_RADIUS = 0.16; // play circle on ground
export const GROUND_SIZE = 0.7;
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

/** Shot power: impulse magnitude range (N·s / mass-scale via applyImpulse) */
export const SHOT_MIN = 0.0008;
export const SHOT_MAX = 0.0065;
export const CHARGE_MS = 1200;

/** Out-of-circle when center is beyond circle + small margin */
export const OUT_MARGIN = MARBLE_RADIUS * 0.25;
