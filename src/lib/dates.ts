// Shared date formatting (en-GB) and small date arithmetic helpers.

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date);
}

export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}
