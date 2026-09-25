import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_TIME_ZONE,
  formatDateTime,
  formatDayLabel,
  resolvedTimeZone,
  setStoredTimeZone,
} from "@client/lib/timezone";

// Guards a TS-invisible bug: mixing dateStyle/timeStyle with timeZoneName throws at runtime (crashed job detail once).
describe("timezone formatting", () => {
  beforeEach(() => {
    setStoredTimeZone(null);
  });

  const INSTANT = "2026-07-31T21:00:00.000Z";
  const DAY_OPTS: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
  };

  const renderedIn = (
    zone: string,
    opts: Intl.DateTimeFormatOptions = DAY_OPTS,
  ) => new Date(INSTANT).toLocaleString(undefined, { ...opts, timeZone: zone });

  it("defaults to UTC rather than the host time zone", () => {
    expect(resolvedTimeZone()).toBe(DEFAULT_TIME_ZONE);
    expect(formatDateTime(INSTANT, DAY_OPTS)).toBe(renderedIn("UTC"));
    expect(renderedIn("UTC")).not.toBe(renderedIn("Asia/Kolkata"));
  });

  it("renders in the chosen zone once one is set", () => {
    setStoredTimeZone("Asia/Kolkata");
    expect(resolvedTimeZone()).toBe("Asia/Kolkata");
    expect(formatDateTime(INSTANT, DAY_OPTS)).toBe(renderedIn("Asia/Kolkata"));
    expect(formatDateTime(INSTANT, DAY_OPTS)).not.toBe(renderedIn("UTC"));
  });

  const APP_OPTION_SETS: Array<[string, Intl.DateTimeFormatOptions]> = [
    [
      "default (dateStyle + timeStyle only)",
      { dateStyle: "medium", timeStyle: "short" },
    ],
    [
      "jobs table",
      { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" },
    ],
    [
      "job chips absolute",
      {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      },
    ],
    [
      "account signed-in",
      {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      },
    ],
    [
      "repos last activity",
      { year: "numeric", month: "short", day: "numeric" },
    ],
  ];

  it.each(APP_OPTION_SETS)(
    "formats without throwing: %s",
    (_label, options) => {
      expect(
        () =>
          new Intl.DateTimeFormat(undefined, { ...options, timeZone: "UTC" }),
      ).not.toThrow();
      expect(formatDateTime(INSTANT, options)).toBeTruthy();
    },
  );

  // Exercises the real call site, not a copy of its options, so it can't drift from what it protects.
  it("formats the job-detail absolute stamp with its requested options", async () => {
    const { formatAbsoluteDate } =
      await import("@client/components/features/job-detail/job-chip-utils");
    const stamp = formatAbsoluteDate(INSTANT);

    expect(stamp).toBeTruthy();
    // Checks the zone name is present; formatDateTime silently drops illegal options, so "doesn't throw" alone wouldn't catch this.
    expect(stamp).toMatch(/UTC|GMT/);

    expect(formatAbsoluteDate(null)).toBeUndefined();
    expect(formatAbsoluteDate("not-a-date")).toBeUndefined();
  });

  it("degrades instead of throwing on an illegal option combination", () => {
    const illegal = {
      dateStyle: "medium",
      timeZoneName: "short",
    } as Intl.DateTimeFormatOptions;
    expect(() => formatDateTime(INSTANT, illegal)).not.toThrow();
    expect(formatDateTime(INSTANT, illegal)).toBeTruthy();
  });

  it("degrades instead of throwing on an unknown time zone", () => {
    setStoredTimeZone("Mars/Olympus_Mons");
    expect(resolvedTimeZone()).toBe(DEFAULT_TIME_ZONE);
    expect(() => formatDateTime(INSTANT)).not.toThrow();
  });

  it("renders a day-only label verbatim, regardless of display zone", () => {
    const expected = new Date("2026-07-31T00:00:00Z").toLocaleDateString(
      undefined,
      { month: "short", day: "numeric", timeZone: "UTC" },
    );
    // Negative-offset zone would shift a naively-parsed label back a day.
    setStoredTimeZone("America/New_York");
    expect(formatDayLabel("2026-07-31")).toBe(expected);
    setStoredTimeZone("Asia/Kolkata");
    expect(formatDayLabel("2026-07-31")).toBe(expected);
  });

  it("returns the input unchanged for unparseable values", () => {
    expect(formatDateTime("not-a-date")).toBe("not-a-date");
    expect(formatDayLabel("nope")).toBe("nope");
  });
});
