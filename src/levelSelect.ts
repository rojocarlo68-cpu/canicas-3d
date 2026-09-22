/** Scene / map selection via URL (independent of AI difficulty). */

export type SceneLevel = 1 | 2 | 3 | 4;

/**
 * Resolve play scene from ?level= / ?nivel= (1 park, 2 desert camp, 3 dentist, 4 office desk).
 * Returns null when absent — title / menu should show.
 */
export function resolveSceneLevel(): SceneLevel | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = (
      params.get('level') ||
      params.get('nivel') ||
      ''
    ).trim();
    const n = parseInt(raw, 10);
    if (n === 4) return 4;
    if (n === 3) return 3;
    if (n === 2) return 2;
    if (n === 1) return 1;
  } catch {
    /* ignore */
  }
  return null;
}

/** For Game constructor when already on a level URL. */
export function requireSceneLevel(fallback: SceneLevel = 1): SceneLevel {
  return resolveSceneLevel() ?? fallback;
}

export function sceneLevelLabel(level: SceneLevel): string {
  if (level === 4) return 'Nivel 4 · Escritorio';
  if (level === 3) return 'Nivel 3 · Consultorio';
  if (level === 2) return 'Nivel 2 · Campamento';
  return 'Nivel 1 · Parque';
}

export function sceneLevelShort(level: SceneLevel): string {
  if (level === 4) return 'Escritorio';
  if (level === 3) return 'Consultorio';
  if (level === 2) return 'Campamento';
  return 'Parque';
}

/** Build shareable href preserving control mode + scene level. */
export function buildGameHref(
  control: 'flick' | 'push',
  scene: SceneLevel,
  base = '/canicas-3d/',
): string {
  const b = base.endsWith('/') ? base : `${base}/`;
  return `${b}?control=${control}&level=${scene}`;
}

export function buildMenuHref(base = '/canicas-3d/'): string {
  const b = base.endsWith('/') ? base : `${base}/`;
  return b;
}
