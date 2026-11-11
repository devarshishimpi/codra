import type { QuotaCheckInput, QuotaResult } from "../ports";
import type { KvCompat } from "./kv";

export interface DefaultQuotaOptions {
  windowSeconds?: number;
  maxReviewsPerWindow?: number;
  maxRetriesPerWindow?: number;
}

export const DEFAULT_QUOTA_WINDOW_SECONDS = 600; // 10 minutes
export const DEFAULT_MAX_REVIEWS_PER_WINDOW = 30; // 30 review requests per 10 minutes per repo/installation
export const DEFAULT_MAX_RETRIES_PER_WINDOW = 20; // 20 retries per 10 minutes per user/action

export function createDefaultQuotaChecker(
  kv: KvCompat,
  options: DefaultQuotaOptions = {},
): (input: QuotaCheckInput) => Promise<QuotaResult> {
  const windowSeconds = options.windowSeconds ?? DEFAULT_QUOTA_WINDOW_SECONDS;
  const maxReviews = options.maxReviewsPerWindow ?? DEFAULT_MAX_REVIEWS_PER_WINDOW;
  const maxRetries = options.maxRetriesPerWindow ?? DEFAULT_MAX_RETRIES_PER_WINDOW;

  return async (input: QuotaCheckInput): Promise<QuotaResult> => {
    let limit = maxReviews;
    if (input.action === "jobs.retry" || input.action === "jobs.rerun") {
      limit = maxRetries;
    }

    const subjectKey =
      input.subject?.installationId
        ? `install:${input.subject.installationId}`
        : input.subject?.owner && input.subject?.repo
          ? `repo:${input.subject.owner}/${input.subject.repo}`
          : input.user?.login
            ? `user:${input.user.login}`
            : "global";

    const currentTimestamp = Math.floor(Date.now() / 1000);
    const windowSlot = Math.floor(currentTimestamp / windowSeconds);
    const key = `quota:${input.action}:${subjectKey}:${windowSlot}`;

    try {
      const raw = await kv.get(key, "text");
      const count = raw ? parseInt(raw, 10) : 0;
      if (Number.isFinite(count) && count >= limit) {
        const retryAfterSeconds = Math.max(
          1,
          (windowSlot + 1) * windowSeconds - currentTimestamp,
        );
        return {
          allowed: false,
          retryAfterSeconds,
          reason: `Quota exceeded for ${input.action}. Limit is ${limit} per ${windowSeconds}s.`,
        };
      }

      await kv.put(key, String(count + 1), {
        expirationTtl: windowSeconds * 2,
      });
      return { allowed: true };
    } catch {
      // In case of KV lookup error, fail open to avoid blocking operations
      return { allowed: true };
    }
  };
}
