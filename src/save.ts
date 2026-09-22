/** localStorage persistence for TAMA Project. */

export type CollectedMarble = {
  seed: string;
  name: string;
  createdAt: number;
  fromLevel?: number;
  /** Optional gallery tooltip / description */
  description?: string;
};

export type MarbleBodySnap = {
  designId: string;
  owner: 'field' | 'player' | 'ai';
  active: boolean;
  visible: boolean;
  inScoring: boolean;
  knockedBy: 'player' | 'ai' | null;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  vx: number;
  vy: number;
  vz: number;
  wx: number;
  wy: number;
  wz: number;
  bodyType: 'dynamic' | 'kinematic' | 'static';
};

export type MatchSnapshot = {
  version: 1;
  savedAt: number;
  sceneLevel: 1 | 2 | 3;
  phase:
    | 'ready'
    | 'dropping'
    | 'settling'
    | 'playing'
    | 'ai_thinking'
    | 'shot_flying'
    | 'ended';
  turn: 'player' | 'ai';
  playerName: string;
  opponentName: string;
  playerScore: number;
  aiScore: number;
  playerMoney: number;
  lastScorer: 'player' | 'ai' | null;
  scoringEnabled: boolean;
  holeOpen: boolean;
  field: MarbleBodySnap[];
  player: MarbleBodySnap | null;
  ai: MarbleBodySnap | null;
  camX: number;
  camY: number;
  camZ: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  label?: string;
};

export type SaveData = {
  version: 2;
  unlockedLevels: number[];
  collection: CollectedMarble[];
  equippedSkinSeed: string | null;
  sfxMute: boolean;
  quality: 'auto' | 'high' | 'low';
  playerName: string;
  playerMoney: number;
  matchSnapshot: MatchSnapshot | null;
};

const KEY = 'tama-project-save-v1';

/** Fixed seed for the Marblus ↔ Carlo collaboration marble (always in collection). */
export const COLLAB_MARBLE_SEED = 'tama-collab-marblus-carlo-v1';
export const COLLAB_MARBLE_NAME = 'Lazo Marblus–Carlo';
export const COLLAB_MARBLE_DESC =
  'Amistad y colaboración · Marblus (asistente) + Carlo (jugador) · TAMA Project';

export const DEFAULT_PLAYER_NAME = 'Jugador1';

const COLLAB_ENTRY: CollectedMarble = {
  seed: COLLAB_MARBLE_SEED,
  name: COLLAB_MARBLE_NAME,
  createdAt: 0,
  description: COLLAB_MARBLE_DESC,
};

const DEFAULT: SaveData = {
  version: 2,
  unlockedLevels: [1],
  collection: [{ ...COLLAB_ENTRY }],
  equippedSkinSeed: COLLAB_MARBLE_SEED,
  sfxMute: false,
  quality: 'auto',
  playerName: DEFAULT_PLAYER_NAME,
  playerMoney: 0,
  matchSnapshot: null,
};

function ensureCollab(collection: CollectedMarble[]): CollectedMarble[] {
  if (collection.some((c) => c.seed === COLLAB_MARBLE_SEED)) {
    return collection.map((c) =>
      c.seed === COLLAB_MARBLE_SEED
        ? {
            ...c,
            name: COLLAB_MARBLE_NAME,
            description: c.description || COLLAB_MARBLE_DESC,
          }
        : c,
    );
  }
  return [{ ...COLLAB_ENTRY }, ...collection];
}

function normalizeLevels(levels: number[]): number[] {
  const allowed = levels.filter((n) => n === 1 || n === 2 || n === 3);
  const set = new Set(allowed.length ? allowed : [1]);
  if (!set.has(1)) set.add(1);
  return [...set].sort((a, b) => a - b);
}

function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_PLAYER_NAME;
  const t = raw.trim().slice(0, 24);
  return t.length ? t : DEFAULT_PLAYER_NAME;
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      const fresh = {
        ...DEFAULT,
        unlockedLevels: [...DEFAULT.unlockedLevels],
        collection: ensureCollab([]),
        equippedSkinSeed: COLLAB_MARBLE_SEED,
        playerName: DEFAULT_PLAYER_NAME,
        playerMoney: 0,
        matchSnapshot: null,
      };
      writeSave(fresh);
      return fresh;
    }
    const parsed = JSON.parse(raw) as Partial<SaveData> & { version?: number };
    const collection = ensureCollab(
      Array.isArray(parsed.collection)
        ? parsed.collection.filter(
            (c): c is CollectedMarble =>
              !!c && typeof c.seed === 'string' && typeof c.name === 'string',
          )
        : [],
    );
    const data: SaveData = {
      version: 2,
      unlockedLevels: Array.isArray(parsed.unlockedLevels)
        ? normalizeLevels(parsed.unlockedLevels)
        : [1],
      collection,
      equippedSkinSeed:
        typeof parsed.equippedSkinSeed === 'string'
          ? parsed.equippedSkinSeed
          : COLLAB_MARBLE_SEED,
      sfxMute: !!parsed.sfxMute,
      quality:
        parsed.quality === 'high' || parsed.quality === 'low' || parsed.quality === 'auto'
          ? parsed.quality
          : 'auto',
      playerName: sanitizeName(parsed.playerName),
      playerMoney:
        typeof parsed.playerMoney === 'number' && Number.isFinite(parsed.playerMoney)
          ? Math.max(0, Math.floor(parsed.playerMoney))
          : 0,
      matchSnapshot:
        parsed.matchSnapshot && typeof parsed.matchSnapshot === 'object'
          ? (parsed.matchSnapshot as MatchSnapshot)
          : null,
    };
    // Persist collab injection if it was missing
    if (!raw.includes(COLLAB_MARBLE_SEED)) writeSave(data);
    return data;
  } catch {
    return {
      ...DEFAULT,
      unlockedLevels: [...DEFAULT.unlockedLevels],
      collection: ensureCollab([]),
      matchSnapshot: null,
    };
  }
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* quota / private mode */
  }
}

export function unlockLevel(level: number): SaveData {
  const s = loadSave();
  if (!s.unlockedLevels.includes(level)) {
    s.unlockedLevels.push(level);
    s.unlockedLevels = normalizeLevels(s.unlockedLevels);
    writeSave(s);
  }
  return s;
}

export function addToCollection(marble: CollectedMarble): SaveData {
  const s = loadSave();
  if (!s.collection.some((c) => c.seed === marble.seed)) {
    s.collection.push(marble);
  }
  if (!s.equippedSkinSeed) s.equippedSkinSeed = marble.seed;
  writeSave(s);
  return s;
}


export function removeFromCollection(seed: string): SaveData {
  const s = loadSave();
  // Soft-lock: collaboration marble cannot be deleted
  if (seed === COLLAB_MARBLE_SEED) return s;
  const before = s.collection.length;
  s.collection = s.collection.filter((c) => c.seed !== seed);
  if (s.collection.length === before) return s;
  if (s.equippedSkinSeed === seed) {
    // Unequip to default procedural skin (null → createPlayerDesign)
    s.equippedSkinSeed = null;
  }
  writeSave(s);
  return s;
}

export function setEquippedSkin(seed: string | null): SaveData {
  const s = loadSave();
  s.equippedSkinSeed = seed;
  writeSave(s);
  return s;
}

export function setSfxMute(mute: boolean): SaveData {
  const s = loadSave();
  s.sfxMute = mute;
  writeSave(s);
  return s;
}

export function setQuality(quality: SaveData['quality']): SaveData {
  const s = loadSave();
  s.quality = quality;
  writeSave(s);
  return s;
}

export function setPlayerName(name: string): SaveData {
  const s = loadSave();
  s.playerName = sanitizeName(name);
  writeSave(s);
  return s;
}

export function setPlayerMoney(money: number): SaveData {
  const s = loadSave();
  s.playerMoney = Math.max(0, Math.floor(money));
  writeSave(s);
  return s;
}

export function writeMatchSnapshot(snap: MatchSnapshot | null): SaveData {
  const s = loadSave();
  s.matchSnapshot = snap;
  if (snap) {
    s.playerName = sanitizeName(snap.playerName);
    s.playerMoney = Math.max(0, Math.floor(snap.playerMoney));
    if (!s.unlockedLevels.includes(snap.sceneLevel)) {
      s.unlockedLevels.push(snap.sceneLevel);
      s.unlockedLevels = normalizeLevels(s.unlockedLevels);
    }
  }
  writeSave(s);
  return s;
}

export function clearMatchSnapshot(): SaveData {
  return writeMatchSnapshot(null);
}

export function hasMatchSnapshot(): boolean {
  const s = loadSave();
  return !!s.matchSnapshot && typeof s.matchSnapshot.sceneLevel === 'number';
}

export function hasSaveProgress(): boolean {
  const s = loadSave();
  return (
    hasMatchSnapshot() ||
    s.collection.length > 1 ||
    s.unlockedLevels.includes(2) ||
    s.unlockedLevels.includes(3) ||
    (!!s.equippedSkinSeed && s.equippedSkinSeed !== COLLAB_MARBLE_SEED) ||
    s.playerMoney > 0 ||
    (s.playerName !== DEFAULT_PLAYER_NAME && s.playerName.length > 0)
  );
}

/** Format toast: Guardado. [nivel, fecha y hora. Nombre]. */
export function formatSaveToast(snap: MatchSnapshot): string {
  const d = new Date(snap.savedAt);
  const fecha = d.toLocaleString('es-MX', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
  const nivel = `Nivel ${snap.sceneLevel}`;
  const nombre = snap.playerName || DEFAULT_PLAYER_NAME;
  const label = snap.label ? ` ${snap.label}` : '';
  return `Guardado. [${nivel}, ${fecha}. ${nombre}]${label}`;
}
