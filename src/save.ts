/** localStorage persistence for TAMA Project. */

export type CollectedMarble = {
  seed: string;
  name: string;
  createdAt: number;
  fromLevel?: number;
  /** Optional gallery tooltip / description */
  description?: string;
};

export type SaveData = {
  version: 1;
  unlockedLevels: number[];
  collection: CollectedMarble[];
  equippedSkinSeed: string | null;
  sfxMute: boolean;
  quality: 'auto' | 'high' | 'low';
};

const KEY = 'tama-project-save-v1';

/** Fixed seed for the Marblus ↔ Carlo collaboration marble (always in collection). */
export const COLLAB_MARBLE_SEED = 'tama-collab-marblus-carlo-v1';
export const COLLAB_MARBLE_NAME = 'Lazo Marblus–Carlo';
export const COLLAB_MARBLE_DESC =
  'Amistad y colaboración · Marblus (asistente) + Carlo (jugador) · TAMA Project';

const COLLAB_ENTRY: CollectedMarble = {
  seed: COLLAB_MARBLE_SEED,
  name: COLLAB_MARBLE_NAME,
  createdAt: 0,
  description: COLLAB_MARBLE_DESC,
};

const DEFAULT: SaveData = {
  version: 1,
  unlockedLevels: [1],
  collection: [{ ...COLLAB_ENTRY }],
  equippedSkinSeed: COLLAB_MARBLE_SEED,
  sfxMute: false,
  quality: 'auto',
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

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      const fresh = {
        ...DEFAULT,
        unlockedLevels: [...DEFAULT.unlockedLevels],
        collection: ensureCollab([]),
        equippedSkinSeed: COLLAB_MARBLE_SEED,
      };
      writeSave(fresh);
      return fresh;
    }
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    const collection = ensureCollab(
      Array.isArray(parsed.collection)
        ? parsed.collection.filter(
            (c): c is CollectedMarble =>
              !!c && typeof c.seed === 'string' && typeof c.name === 'string',
          )
        : [],
    );
    const data: SaveData = {
      version: 1,
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
    };
    // Persist collab injection if it was missing
    if (!raw.includes(COLLAB_MARBLE_SEED)) writeSave(data);
    return data;
  } catch {
    return {
      ...DEFAULT,
      unlockedLevels: [...DEFAULT.unlockedLevels],
      collection: ensureCollab([]),
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

export function hasSaveProgress(): boolean {
  const s = loadSave();
  return (
    s.collection.length > 1 ||
    s.unlockedLevels.includes(2) ||
    s.unlockedLevels.includes(3) ||
    (!!s.equippedSkinSeed && s.equippedSkinSeed !== COLLAB_MARBLE_SEED)
  );
}
