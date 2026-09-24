import { FIELD_MARBLE_COUNT, REPLAY_CAPACITY } from './constants';

export type Side = 'player' | 'ai';

export type MarbleSnap = {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  visible: boolean;
};

export type ReplayFrame = {
  t: number;
  field: MarbleSnap[];
  player: MarbleSnap | null;
  ai: MarbleSnap | null;
  camX: number;
  camY: number;
  camZ: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  playerScore: number;
  aiScore: number;
  turn: Side;
  level: number;
};

function emptySnap(): MarbleSnap {
  return { x: 0, y: -1, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, visible: false };
}

export class ReplayBuffer {
  private frames: ReplayFrame[] = [];
  private write = 0;
  private count = 0;
  private capacity: number;

  constructor(capacity = REPLAY_CAPACITY) {
    this.capacity = capacity;
  }

  clear(): void {
    this.frames = [];
    this.write = 0;
    this.count = 0;
  }

  push(frame: ReplayFrame): void {
    if (this.frames.length < this.capacity) {
      this.frames.push(frame);
      this.write = this.frames.length % this.capacity;
      this.count = this.frames.length;
    } else {
      this.frames[this.write] = frame;
      this.write = (this.write + 1) % this.capacity;
      this.count = this.capacity;
    }
  }

  get length(): number {
    return this.count;
  }

  /** Chronological copy of buffered frames. */
  snapshot(): ReplayFrame[] {
    if (this.count === 0) return [];
    if (this.count < this.capacity) return this.frames.slice(0, this.count);
    const out: ReplayFrame[] = [];
    for (let i = 0; i < this.count; i++) {
      const idx = (this.write + i) % this.capacity;
      out.push(this.frames[idx]!);
    }
    return out;
  }
}

export function makeEmptyFrame(t: number, fieldCount = FIELD_MARBLE_COUNT): ReplayFrame {
  return {
    t,
    field: Array.from({ length: fieldCount }, () => emptySnap()),
    player: null,
    ai: null,
    camX: 0,
    camY: 0.22,
    camZ: 0.28,
    targetX: 0,
    targetY: 0,
    targetZ: 0,
    playerScore: 0,
    aiScore: 0,
    turn: 'player',
    level: 1,
  };
}
