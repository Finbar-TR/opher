// Weights are stored in integer grams throughout. This is the only place that
// turns them into something a person reads.

export function formatKg(grams: number): string {
  const kg = Math.round(grams / 100) / 10; // one decimal place
  return `${kg} kg`;
}

// The other direction, for the action boundary. Operators type kg; the database
// stores integer grams. The mirror of `poundsToPence` in money.ts, and the only
// place this multiplication should appear.
export function kgToGrams(kg: number): number {
  return Math.round(kg * 1000);
}
