import { expect, it } from "vitest";
import { getStats, trendBucketDays } from "@codraoss/db/stats";
import { createTestEnv, dbDescribe } from "../helpers";

const env = createTestEnv();

dbDescribe("stats trend bucketing", () => {
  it("collapses long ranges into evenly spaced buckets with no gaps", async () => {
    for (const days of [7, 14, 30, 90]) {
      const width = trendBucketDays(days);
      const stats = await getStats(env, days, "Asia/Kolkata");

      expect(stats.trendBucketDays).toBe(width);
      // Range spans `days + 1` calendar days (the rolling window starts mid-day), split by width.
      expect(stats.trend).toHaveLength(Math.ceil((days + 1) / width));
      expect(stats.trend.length).toBeLessThanOrEqual(15);

      for (const point of stats.trend) {
        expect(point.endDay >= point.day).toBe(true);
      }
      // Buckets are contiguous and ascending.
      for (let i = 1; i < stats.trend.length; i += 1) {
        expect(stats.trend[i].day > stats.trend[i - 1].endDay).toBe(true);
      }
    }
  }, 60_000);
});
