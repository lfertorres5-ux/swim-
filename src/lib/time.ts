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

// ---------------------------------------------------------------------------
// Wall-clock ⇄ instant conversion for America/Los_Angeles (no dependencies).
// ---------------------------------------------------------------------------

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIMEZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function laParts(ms: number) {
  const p: Record<string, number> = {};
  for (const { type, value } of partsFormatter.formatToParts(new Date(ms))) {
    if (type !== "literal") p[type] = Number(value);
  }
  return p as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Offset of LA local time from UTC at instant `ms`, in ms (e.g. −7h during PDT). */
function laOffsetMs(ms: number): number {
  const p = laParts(ms);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant at which the LA wall clock reads `isoDate` + `minutesOfDay`.
 * Nonexistent times (spring-forward gap) resolve forward; ambiguous times
 * (fall-back hour) resolve to the earlier (PDT) instant.
 */
export function laWallTimeToUtc(isoDate: string, minutesOfDay: number): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, minutesOfDay);
  const first = guess - laOffsetMs(guess);
  const second = guess - laOffsetMs(first);
  return Math.min(first, second);
}

/** Minutes since local midnight in LA for instant `ms`. */
export function laMinutesOfDay(ms: number): number {
  const p = laParts(ms);
  return p.hour * 60 + p.minute;
}

/** Day of week (0 = Sunday) for a calendar date string — timezone-independent. */
export function weekdayOf(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** "HH:MM" or "HH:MM:SS" → minutes since midnight. */
export function parseTimeOfDay(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

export function formatTimeOfDay(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** True once the instant has passed (server-rendered pages evaluate this per request). */
export function hasStarted(iso: string): boolean {
  return Date.parse(iso) <= Date.now();
}
