import { isSupportedTimeZone } from "@codraoss/schema/timezone";

// Purely presentation; storage is always TIMESTAMPTZ. Mirrored to localStorage so first paint
// skips the fetch. Defaults to UTC (not browser zone) so a timestamp reads the same for everyone.

const STORAGE_KEY = "codra-timezone";

export const DEFAULT_TIME_ZONE = "UTC";

let cached: string | null | undefined;

// null means falling back to UTC default, not "unset".
export function getStoredTimeZone(): string | null {
  if (cached !== undefined) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cached = raw && isSupportedTimeZone(raw) ? raw : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function setStoredTimeZone(zone: string | null) {
  cached = zone && isSupportedTimeZone(zone) ? zone : null;
  try {
    if (cached) localStorage.setItem(STORAGE_KEY, cached);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage write failed; value still held in memory
  }
}

export function resolvedTimeZone(): string {
  return getStoredTimeZone() ?? DEFAULT_TIME_ZONE;
}

export function browserTimeZone(): string {
  try {
    return (
      Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIME_ZONE
    );
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

const offsetCache = new Map<string, string>();

export function timeZoneOffsetLabel(zone: string): string {
  if (offsetCache.has(zone)) return offsetCache.get(zone)!;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date());
    const label = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    offsetCache.set(zone, label);
    return label;
  } catch {
    return "";
  }
}

export function formatDateTime(
  value: string | number | Date,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
  },
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  try {
    return date.toLocaleString(undefined, {
      ...options,
      timeZone: resolvedTimeZone(),
    });
  } catch {
    // Intl throws on bad zone/options combo; retry without options
    try {
      return date.toLocaleString(undefined, { timeZone: resolvedTimeZone() });
    } catch {
      return date.toLocaleString();
    }
  }
}

// value is date-only, already resolved by server; parse/render as UTC or the day shifts
export function formatDayLabel(
  day: string,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
): string {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  try {
    return date.toLocaleDateString(undefined, { ...options, timeZone: "UTC" });
  } catch {
    return day;
  }
}

export const COMMON_TIME_ZONES: string[] = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Moscow",
  "Africa/Lagos",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Perth",
  "Australia/Sydney",
  "Pacific/Auckland",
];

// Precompute labels statically
COMMON_TIME_ZONES.forEach((zone) => timeZoneOffsetLabel(zone));
timeZoneOffsetLabel(DEFAULT_TIME_ZONE);
