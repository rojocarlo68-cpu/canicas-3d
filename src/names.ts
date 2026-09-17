/** Realistic given names for the opponent (Spanish + English mix). */
export const OPPONENT_NAMES: readonly string[] = [
  'Jorge',
  'Bob',
  'Christian',
  'Carlos',
  'María',
  'Ana',
  'Luis',
  'Sofía',
  'Diego',
  'Elena',
  'Miguel',
  'Laura',
  'Pedro',
  'Carmen',
  'Andrés',
  'Valeria',
  'Mateo',
  'Isabel',
  'Daniel',
  'Camila',
  'Alex',
  'Sam',
  'Chris',
  'Jordan',
  'Taylor',
  'Jamie',
  'Rafael',
  'Lucía',
  'Héctor',
  'Patricia',
  'Fernando',
  'Gabriela',
];

export function pickOpponentName(rng: () => number = Math.random): string {
  const i = Math.floor(rng() * OPPONENT_NAMES.length) % OPPONENT_NAMES.length;
  return OPPONENT_NAMES[i]!;
}
