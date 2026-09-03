// Weights are stored in integer grams throughout. This is the only place that
// turns them into something a person reads.

export function formatKg(grams: number): string {
  const kg = Math.round(grams / 100) / 10; // one decimal place
  return `${kg} kg`;
}
