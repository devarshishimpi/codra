export const reviewSeverities = ["P0", "P1", "P2", "P3", "nit"] as const;

export const reviewConcurrencyLevels = [
  "low",
  "medium",
  "high",
  "max",
] as const;
export type ReviewConcurrencyLevel = (typeof reviewConcurrencyLevels)[number];

export const REVIEW_CONCURRENCY_LIMITS: Record<ReviewConcurrencyLevel, number> =
  {
    low: 1,
    medium: 2,
    high: 3,
    max: 4,
  };

export const reviewMaxCommentsOptions = [5, 10, 15, 20] as const;

export const reviewMaxFilesRange = { min: 1, max: 500, default: 200 } as const;
