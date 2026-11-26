import { logger } from "@codraoss/core/logger";

export class GitHubError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly path: string,
    message: string,
    public readonly headers?: Headers,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

export async function assertResponseOk(
  response: Response,
  path: string,
  action: string,
) {
  if (!response.ok) {
    let errText;
    try {
      errText = await response.text();
    } catch {
      errText = "<unreadable>";
    }
    throw new GitHubError(
      response.status,
      errText,
      path,
      `${action} failed with ${response.status}: ${errText}`,
      response.headers,
    );
  }
}

// 406 too_large beyond 20,000 lines diff cap.
export function isDiffTooLargeError(error: unknown): boolean {
  return (
    error instanceof GitHubError &&
    error.status === 406 &&
    /too_large|maximum number of lines/i.test(error.body ?? "")
  );
}

function getHeader(
  headers: Headers | Record<string, string | undefined> | undefined,
  name: string,
): string | null | undefined {
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name) ?? undefined;
  }
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower && typeof value === "string") {
      return value;
    }
  }
  return undefined;
}

export async function withRetry<T>(
  operation: string,
  fn: () => Promise<T>,
  maxRetries = 2,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;
      const isSecondaryRateLimit =
        error instanceof GitHubError &&
        error.status === 403 &&
        error.body?.toLowerCase().includes("secondary rate limit");

      const isPrimaryRateLimit =
        error instanceof GitHubError &&
        error.status === 403 &&
        (error.body?.toLowerCase().includes("rate limit exceeded") ||
          error.body?.toLowerCase().includes("api rate limit"));

      const isRetryable =
        isSecondaryRateLimit ||
        isPrimaryRateLimit ||
        (error instanceof GitHubError &&
          (error.status === 429 || error.status >= 500)) ||
        error.name === "TimeoutError" ||
        (typeof error.message === "string" && error.message.includes("timeout"));

      if (!isRetryable || attempt > maxRetries) {
        throw error;
      }

      const rateLimitReset =
        error instanceof GitHubError
          ? getHeader(error.headers, "x-ratelimit-reset")
          : undefined;
      const retryAfter =
        error instanceof GitHubError
          ? getHeader(error.headers, "retry-after")
          : undefined;

      const resetSeconds = rateLimitReset ? parseInt(rateLimitReset, 10) : NaN;
      const retrySeconds = retryAfter ? parseInt(retryAfter, 10) : NaN;

      let delay: number;
      if (!Number.isNaN(resetSeconds)) {
        delay = Math.max(0, resetSeconds * 1000 - Date.now()) + 1000;
      } else if (!Number.isNaN(retrySeconds)) {
        delay = Math.max(0, retrySeconds * 1000);
      } else if (isSecondaryRateLimit) {
        delay = Math.pow(2, attempt) * 30000;
      } else {
        delay = Math.pow(2, attempt) * 1000;
      }

      logger.warn(
        `Retrying GitHub operation ${operation} (attempt ${attempt}/${maxRetries}) in ${delay}ms`,
        {
          status: error instanceof GitHubError ? error.status : undefined,
          error: error.message,
        },
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export function installationCacheKey(installationId: string) {
  return `install:${installationId}`;
}

export function encodeGitHubContentPath(path: string) {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

export function repoApiPath(owner: string, repo: string) {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

// The authenticated-request surface the extracted diff-fetch and review-post helpers need.
// An implementation detail of GitHubClient, NOT new public API: `request`/`requestAndCheck` stay private on the class, which hands one of these to the free functions.
export type GitHubRequestContext = {
  request(path: string, init?: RequestInit, accept?: string): Promise<Response>;
  requestAndCheck(
    path: string,
    init?: RequestInit,
    accept?: string,
  ): Promise<Response>;
};
