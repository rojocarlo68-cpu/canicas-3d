/** Player shoot control modes — selected via URL for shareable links. */

export type ControlMode = 'flick' | 'push';

/**
 * Resolve control mode from query (?control=), hash (#flick / #push),
 * or path aliases (.../flick, .../push). Default: flick.
 */
export function resolveControlMode(): ControlMode {
  try {
    const params = new URLSearchParams(window.location.search);
    const q = (params.get('control') || '').trim().toLowerCase();
    if (q === 'push' || q === 'flick') return q;

    const hash = (window.location.hash || '').replace(/^#/, '').trim().toLowerCase();
    if (hash === 'push' || hash === 'flick') return hash;
    if (hash.startsWith('control=')) {
      const v = hash.slice('control='.length);
      if (v === 'push' || v === 'flick') return v;
    }

    const path = (window.location.pathname || '').toLowerCase();
    if (/(^|\/)push\/?$/.test(path) || path.includes('/push')) return 'push';
    if (/(^|\/)flick\/?$/.test(path) || path.includes('/flick')) return 'flick';
  } catch {
    /* ignore */
  }
  return 'flick';
}

export function controlModeLabel(mode: ControlMode): string {
  return mode === 'push' ? 'Empuje' : 'Flick';
}

export function controlModeHint(mode: ControlMode): string {
  if (mode === 'push') {
    return 'Tu turno: toca cerca de tu canica y empújala con el dedo (más rápido = más fuerza).';
  }
  return 'Tu turno: toca cerca de tu canica o el círculo, arrastra para apuntar (línea) y suelta para disparar.';
}

/** Map flick drag length + swipe speed → power 0..1 (addictive but controllable). */
export function powerFromFlick(dragPx: number, speedPxPerSec: number): number {
  const fromDist = Math.min(1, Math.max(0, (dragPx - 18) / 150));
  const fromSpeed = Math.min(1, Math.max(0, (speedPxPerSec - 80) / 1400));
  const raw = fromDist * 0.62 + fromSpeed * 0.48;
  return Math.max(0.08, Math.min(1, raw));
}

/** Map push primarily by swipe velocity (physical shove feel). */
export function powerFromPush(dragPx: number, speedPxPerSec: number): number {
  const fromSpeed = Math.min(1, Math.max(0, (speedPxPerSec - 60) / 1600));
  const fromDist = Math.min(1, Math.max(0, (dragPx - 12) / 180));
  const raw = fromSpeed * 0.78 + fromDist * 0.28;
  return Math.max(0.1, Math.min(1, raw));
}

/** Minimum drag / speed to count as a real shot (else cancel). */
export function isGestureStrongEnough(
  mode: ControlMode,
  dragPx: number,
  speedPxPerSec: number,
): boolean {
  if (mode === 'push') {
    return dragPx >= 14 || speedPxPerSec >= 120;
  }
  return dragPx >= 22 || speedPxPerSec >= 180;
}
