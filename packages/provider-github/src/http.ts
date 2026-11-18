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
      const body = error instanceof GitHubError ? error.body?.toLowerCase() : "";
      const isSecondaryRateLimit =
        error instanceof GitHubError &&
        error.status === 403 &&
        body?.includes("secondary rate limit");
      const isPrimaryRateLimit =
        error instanceof GitHubError &&
        error.status === 403 &&
        (body?.includes("rate limit exceeded") ||
          body?.includes("api rate limit"));
      const isRateLimit = isSecondaryRateLimit || isPrimaryRateLimit;

      const isRetryable =
        isRateLimit ||
        (error instanceof GitHubError &&
          (error.status === 429 || error.status >= 500)) ||
        error.name === "TimeoutError" ||
        error.message.includes("timeout");

      if (!isRetryable || attempt > maxRetries) {
        throw error;
      }

      const rateLimitReset =
        error instanceof GitHubError
          ? error.headers?.get("x-ratelimit-reset")
          : undefined;
      const delay = rateLimitReset
        ? Math.max(0, parseInt(rateLimitReset, 10) * 1000 - Date.now()) + 1000
        : isRateLimit
          ? Math.pow(2, attempt) * 30000
          : Math.pow(2, attempt) * 1000;
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
