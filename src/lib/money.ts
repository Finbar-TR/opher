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

// Price per kilogram, for the tier ladder. Input is pence per kg.
export function formatPricePerKg(pencePerKg: number): string {
  return `${formatGBP(pencePerKg)}/kg`;
}
