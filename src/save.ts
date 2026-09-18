/** localStorage persistence for TAMA Project. */

export type CollectedMarble = {
  seed: string;
  name: string;
  createdAt: number;
  fromLevel?: number;
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

const DEFAULT: SaveData = {
  version: 1,
  unlockedLevels: [1],
  collection: [],
  equippedSkinSeed: null,
  sfxMute: false,
  quality: 'auto',
};

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT, unlockedLevels: [...DEFAULT.unlockedLevels], collection: [] };
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    return {
      version: 1,
      unlockedLevels: Array.isArray(parsed.unlockedLevels)
        ? [...new Set(parsed.unlockedLevels.filter((n) => n === 1 || n === 2))]
        : [1],
      collection: Array.isArray(parsed.collection)
        ? parsed.collection.filter(
            (c): c is CollectedMarble =>
              !!c && typeof c.seed === 'string' && typeof c.name === 'string',
          )
        : [],
      equippedSkinSeed:
        typeof parsed.equippedSkinSeed === 'string' ? parsed.equippedSkinSeed : null,
      sfxMute: !!parsed.sfxMute,
      quality:
        parsed.quality === 'high' || parsed.quality === 'low' || parsed.quality === 'auto'
          ? parsed.quality
          : 'auto',
    };
  } catch {
    return { ...DEFAULT, unlockedLevels: [...DEFAULT.unlockedLevels], collection: [] };
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
    s.unlockedLevels.sort((a, b) => a - b);
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
  return s.collection.length > 0 || s.unlockedLevels.includes(2) || !!s.equippedSkinSeed;
}
