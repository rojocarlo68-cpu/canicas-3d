/** Scene / map selection via URL (independent of AI difficulty). */

export type SceneLevel = 1 | 2;

/**
 * Resolve play scene from ?level= / ?nivel= (1 park, 2 desert camp).
 * Default: 1.
 */
export function resolveSceneLevel(): SceneLevel {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = (
      params.get('level') ||
      params.get('nivel') ||
      ''
    ).trim();
    const n = parseInt(raw, 10);
    if (n === 2) return 2;
    if (n === 1) return 1;
  } catch {
    /* ignore */
  }
  return 1;
}

export function sceneLevelLabel(level: SceneLevel): string {
  return level === 2 ? 'Nivel 2 · Campamento' : 'Nivel 1 · Parque';
}

export function sceneLevelShort(level: SceneLevel): string {
  return level === 2 ? 'Campamento' : 'Parque';
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
