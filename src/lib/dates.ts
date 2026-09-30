const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const isIsoDate = (value: string) => DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

export function isValidTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Calendar day (YYYY-MM-DD) of an instant in the given IANA timezone. */
export function dayInTimezone(instant: Date | string, tz: string) {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export const todayIn = (tz: string) => dayInTimezone(new Date(), tz);

/** 2026-09-30 -> 20260930 (ESPN `dates` format). */
export const toEspnDate = (isoDate: string) => isoDate.replaceAll("-", "");

/** ESPN uses "2026-09-28T02:00Z" (no seconds). Normalise to full ISO-8601. */
export function toIso(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function addDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
