/** All business logic runs in San Diego time, regardless of server/browser TZ. */
export const TIMEZONE = "America/Los_Angeles";

/** YYYY-MM-DD for "today" (or `date`) in America/Los_Angeles. */
export function laDateString(date: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function formatTime(iso: string | Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export function formatDate(iso: string | Date, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, ...opts }).format(new Date(iso));
}

export function formatDateTime(iso: string | Date): string {
  return `${formatDate(iso)} · ${formatTime(iso)}`;
}
