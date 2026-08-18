// Money is stored and calculated in integer pence to avoid floating-point error.

export function formatGBP(pence: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(pence / 100);
}

export function poundsToPence(pounds: number): number {
  return Math.round(pounds * 100);
}

// Savings of the group price against a typical shop price (both in pence).
// Returns null when there's no shop price or no actual saving.
export function savings(
  pricePerPortion: number,
  shopPricePerPortion: number | null | undefined
): { perPortion: number; percent: number } | null {
  if (!shopPricePerPortion || shopPricePerPortion <= pricePerPortion) return null;
  const perPortion = shopPricePerPortion - pricePerPortion;
  const percent = Math.round((perPortion / shopPricePerPortion) * 100);
  return { perPortion, percent };
}
