// UK postcode helpers. The "outward code" is the first half of a postcode (e.g.
// "M14 5AB" -> "M14"), which we use as a coarse delivery zone.

export function outwardCode(postcode: string | null | undefined): string | null {
  if (!postcode) return null;
  const cleaned = postcode.trim().toUpperCase();
  if (!cleaned) return null;
  // Outward code is everything before the final 3 characters (the inward code),
  // or the whole thing if no space and it's short.
  const parts = cleaned.split(/\s+/);
  if (parts.length > 1) return parts[0];
  // No space: strip the last 3 chars (inward code) if long enough.
  return cleaned.length > 3 ? cleaned.slice(0, cleaned.length - 3) : cleaned;
}

// Does an outward code fall within a zone's comma-separated list of codes?
export function zoneCovers(outwardCodes: string, code: string | null): boolean {
  if (!code) return false;
  const list = outwardCodes
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  return list.includes(code.toUpperCase());
}
