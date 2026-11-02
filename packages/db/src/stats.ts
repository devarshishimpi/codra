import type { DbEnv } from "./env";
import { isSupportedTimeZone } from "@codraoss/schema/timezone";
import { queryRows } from "./client";
import {
  statsSchema,
  jobStatuses,
  reviewTriggers,
  reviewSeverities,
  reviewCategories,
} from "@codraoss/schema";
import { getModelUsageStats } from "./file-reviews";

// Guard the zone before it reaches SQL, so an unknown name can't error the query.
const jobStatusSet = new Set<string>(jobStatuses);
const reviewTriggerSet = new Set<string>(reviewTriggers);
const reviewSeveritySet = new Set<string>(reviewSeverities);
const reviewCategorySet = new Set<string>(reviewCategories);

/**
 * Days rolled up into a single trend point. A 90-day range plotted daily is unreadable (and the
 * x-axis drops most labels anyway), so wider ranges are combined into multi-day buckets, keeping
 * every range at roughly a dozen-and-a-half points.
 */
export function trendBucketDays(days: number) {
  if (days <= 14) return 1;
  if (days <= 45) return 3;
  if (days <= 120) return 7;
  return 14;
}

// `created_at` is `timestamptz` (absolute); `AT TIME ZONE <zone>` converts it to wall-clock time before truncating, so a job at 03:00 IST lands on the IST day, not the UTC one.
export async function getStats(env: DbEnv, days = 30, timeZone = "UTC") {
  const parsedDays = Number(days);
  const safeDays = Number.isFinite(parsedDays) ? Math.trunc(parsedDays) : 30;
  const clampedDays = Math.min(Math.max(safeDays, 1), 365);
  const zone = isSupportedTimeZone(timeZone) ? timeZone : "UTC";
  const bucketDays = trendBucketDays(clampedDays);
  const [
    [totals],
    dailyRows,
    verdictRows,
    topRepos,
    modelRows,
    statusRows,
    triggerRows,
    severityRows,
    categoryRows,
    [performanceRow],
  ] = await Promise.all([
    queryRows<{
      jobs: number;
      input_tokens: number;
      output_tokens: number;
      comments: number;
    }>(
      env,
      `
        SELECT
          COUNT(*)::int AS jobs,
          COALESCE(SUM(total_input_tokens), 0)::int AS input_tokens,
          COALESCE(SUM(total_output_tokens), 0)::int AS output_tokens,
          COALESCE(SUM(comment_count), 0)::int AS comments
        FROM jobs
        WHERE created_at >= now() - ($1::int * interval '1 day')
      `,
      [clampedDays],
    ),
    // Buckets are generated first and LEFT JOINed, so quiet stretches come back as explicit zeros
    // instead of gaps -- the chart then shows a continuous, evenly spaced series for every range.
    queryRows<{
      day: string;
      end_day: string;
      jobs: number;
      input_tokens: number;
      output_tokens: number;
      comments: number;
    }>(
      env,
      `
        WITH bounds AS (
          SELECT
            ((now() - ($1::int * interval '1 day')) AT TIME ZONE $2)::date AS start_day,
            (now() AT TIME ZONE $2)::date AS end_day
        ),
        buckets AS (
          SELECT
            g::date AS bucket_start,
            LEAST((g + (($3::int - 1) * interval '1 day'))::date, b.end_day) AS bucket_end
          FROM bounds b,
               generate_series(b.start_day::timestamp, b.end_day::timestamp, ($3::int * interval '1 day')) AS g
        )
        SELECT
          TO_CHAR(bk.bucket_start, 'YYYY-MM-DD') AS day,
          TO_CHAR(bk.bucket_end, 'YYYY-MM-DD') AS end_day,
          COUNT(j.id)::int AS jobs,
          COALESCE(SUM(j.total_input_tokens), 0)::int AS input_tokens,
          COALESCE(SUM(j.total_output_tokens), 0)::int AS output_tokens,
          COALESCE(SUM(j.comment_count), 0)::int AS comments
        FROM buckets bk
        LEFT JOIN jobs j
          ON j.created_at >= now() - ($1::int * interval '1 day')
         AND (j.created_at AT TIME ZONE $2)::date BETWEEN bk.bucket_start AND bk.bucket_end
        GROUP BY bk.bucket_start, bk.bucket_end
        ORDER BY bk.bucket_start ASC
      `,
      [clampedDays, zone, bucketDays],
    ),
    queryRows<{ verdict: "approve" | "comment" | null; count: number }>(
      env,
      `
        SELECT verdict, COUNT(*)::int AS count
        FROM jobs
        GROUP BY verdict
        ORDER BY count DESC
      `,
    ),
    queryRows<{ owner: string; repo: string; jobs: number }>(
      env,
      `
        SELECT r.owner, r.repo, COUNT(*)::int AS jobs
        FROM jobs j
        JOIN repositories r ON j.repository_id = r.id
        WHERE j.created_at >= now() - ($1::int * interval '1 day')
        GROUP BY r.owner, r.repo
        ORDER BY jobs DESC, r.owner ASC, r.repo ASC
        LIMIT 10
      `,
      [clampedDays],
    ),
    getModelUsageStats(env, clampedDays),
    queryRows<{ status: string; count: number }>(
      env,
      `
        SELECT status, COUNT(*)::int AS count
        FROM jobs
        WHERE created_at >= now() - ($1::int * interval '1 day')
        GROUP BY status
        ORDER BY count DESC
      `,
      [clampedDays],
    ),
    queryRows<{ trigger: string; count: number }>(
      env,
      `
        SELECT trigger, COUNT(*)::int AS count
        FROM jobs
        WHERE created_at >= now() - ($1::int * interval '1 day')
        GROUP BY trigger
        ORDER BY count DESC
      `,
      [clampedDays],
    ),
    queryRows<{ severity: string; count: number }>(
      env,
      `
        SELECT rc.severity, COUNT(*)::int AS count
        FROM review_comments rc
        JOIN file_reviews fr ON fr.id = rc.file_review_id
        WHERE fr.created_at >= now() - ($1::int * interval '1 day')
        GROUP BY rc.severity
        ORDER BY count DESC
      `,
      [clampedDays],
    ),
    queryRows<{ category: string; count: number }>(
      env,
      `
        SELECT rc.category, COUNT(*)::int AS count
        FROM review_comments rc
        JOIN file_reviews fr ON fr.id = rc.file_review_id
        WHERE fr.created_at >= now() - ($1::int * interval '1 day')
        GROUP BY rc.category
        ORDER BY count DESC
      `,
      [clampedDays],
    ),
    queryRows<{
      avg_duration_ms: number | null;
      p95_duration_ms: number | null;
      avg_confidence: number | null;
    }>(
      env,
      `
        SELECT
          AVG(EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000) AS avg_duration_ms,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (finished_at - started_at)) * 1000) AS p95_duration_ms,
          AVG(overall_confidence_score) AS avg_confidence
        FROM jobs
        WHERE finished_at IS NOT NULL AND started_at IS NOT NULL AND created_at >= now() - ($1::int * interval '1 day')
      `,
      [clampedDays],
    ),
  ]);

  return statsSchema.parse({
    totals: {
      jobs: totals?.jobs ?? 0,
      inputTokens: totals?.input_tokens ?? 0,
      outputTokens: totals?.output_tokens ?? 0,
      comments: totals?.comments ?? 0,
    },
    trend: dailyRows.map((row) => ({
      day: row.day,
      endDay: row.end_day,
      jobs: row.jobs,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      comments: row.comments,
    })),
    trendBucketDays: bucketDays,
    verdicts: verdictRows.map((row) => ({
      verdict: row.verdict,
      count: row.count,
    })),
    models: modelRows.map((row) => ({
      modelUsed: row.model_used,
      provider: row.model_provider ?? undefined,
      calls: row.calls,
      inputTokens: row.input_tokens ?? 0,
      outputTokens: row.output_tokens ?? 0,
    })),
    topRepos: topRepos.map((row) => ({
      owner: row.owner,
      repo: row.repo,
      jobs: row.jobs,
    })),
    // Drop rows whose enum-typed column holds an unexpected value (e.g. legacy rows with no DB CHECK constraint) -- keeping them would fail statsSchema.parse and 500 the endpoint.
    statuses: statusRows.flatMap((row) =>
      jobStatusSet.has(row.status)
        ? [
            {
              status: row.status as (typeof jobStatuses)[number],
              count: row.count,
            },
          ]
        : [],
    ),
    triggers: triggerRows.flatMap((row) =>
      reviewTriggerSet.has(row.trigger)
        ? [
            {
              trigger: row.trigger as (typeof reviewTriggers)[number],
              count: row.count,
            },
          ]
        : [],
    ),
    severities: severityRows.flatMap((row) =>
      reviewSeveritySet.has(row.severity)
        ? [
            {
              severity: row.severity as (typeof reviewSeverities)[number],
              count: row.count,
            },
          ]
        : [],
    ),
    categories: categoryRows.flatMap((row) =>
      reviewCategorySet.has(row.category)
        ? [
            {
              category: row.category as (typeof reviewCategories)[number],
              count: row.count,
            },
          ]
        : [],
    ),
    performance: {
      avgDurationMs:
        performanceRow?.avg_duration_ms != null
          ? Math.round(performanceRow.avg_duration_ms)
          : null,
      p95DurationMs:
        performanceRow?.p95_duration_ms != null
          ? Math.round(performanceRow.p95_duration_ms)
          : null,
      avgConfidence: performanceRow?.avg_confidence ?? null,
    },
  });
}
