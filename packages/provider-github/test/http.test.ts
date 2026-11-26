import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GitHubError, assertResponseOk, withRetry } from "../src/http";
import { logger } from "@codraoss/core/logger";

describe("GitHubError", () => {
  it("carries headers when provided", () => {
    const headers = new Headers({
      "x-ratelimit-reset": "1700000000",
      "retry-after": "60",
    });
    const error = new GitHubError(
      403,
      "API rate limit exceeded",
      "/repos/owner/repo",
      "Request failed",
      headers,
    );

    expect(error.status).toBe(403);
    expect(error.body).toBe("API rate limit exceeded");
    expect(error.path).toBe("/repos/owner/repo");
    expect(error.message).toBe("Request failed");
    expect(error.headers).toBe(headers);
    expect(error.headers?.get("x-ratelimit-reset")).toBe("1700000000");
    expect(error.headers?.get("retry-after")).toBe("60");
  });

  it("handles omitted headers gracefully", () => {
    const error = new GitHubError(404, "Not Found", "/path", "Not found error");
    expect(error.headers).toBeUndefined();
  });
});

describe("assertResponseOk", () => {
  it("passes without throwing when response is ok", async () => {
    const response = new Response("ok", { status: 200 });
    await expect(assertResponseOk(response, "/test", "Test")).resolves.toBeUndefined();
  });

  it("throws GitHubError carrying response headers on error", async () => {
    const headers = new Headers({
      "x-ratelimit-reset": "1700005000",
      "retry-after": "30",
    });
    const response = new Response("API rate limit exceeded for user ID 12345", {
      status: 403,
      headers,
    });

    let caughtError: unknown;
    try {
      await assertResponseOk(response, "/repos/owner/repo/pulls", "Get PR");
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(GitHubError);
    const gitHubError = caughtError as GitHubError;
    expect(gitHubError.status).toBe(403);
    expect(gitHubError.body).toContain("API rate limit exceeded");
    expect(gitHubError.path).toBe("/repos/owner/repo/pulls");
    expect(gitHubError.headers).toBeDefined();
    expect(gitHubError.headers?.get("x-ratelimit-reset")).toBe("1700005000");
    expect(gitHubError.headers?.get("retry-after")).toBe("30");
  });
});

describe("withRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("detects and retries primary rate limit HTTP 403 errors with 'rate limit exceeded'", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        throw new GitHubError(
          403,
          "API rate limit exceeded for user ID 123",
          "/repos/owner/repo",
          "rate limit error",
        );
      }
      return "success";
    });

    const promise = withRetry("testPrimaryRateLimit", fn, 2);

    // Advance fake timers so the delay resolves
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("detects and retries primary rate limit HTTP 403 errors with 'api rate limit'", async () => {
    let callCount = 0;
    const fn = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        throw new GitHubError(
          403,
          "Request forbidden by administrative API rate limit",
          "/repos/owner/repo",
          "rate limit error",
        );
      }
      return "recovered";
    });

    const promise = withRetry("testApiRateLimit", fn, 2);
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws primary rate limit error when maxRetries exceeded", async () => {
    const fn = vi.fn(async () => {
      throw new GitHubError(
        403,
        "API rate limit exceeded",
        "/repos/owner/repo",
        "persistent rate limit",
      );
    });

    const promise = withRetry("testMaxRetries", fn, 2);
    promise.catch(() => {});

    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow("persistent rate limit");
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("respects x-ratelimit-reset header for delay calculation", async () => {
    const fixedNow = 1_000_000_000_000; // ms
    vi.setSystemTime(fixedNow);

    const resetSeconds = Math.floor(fixedNow / 1000) + 15; // 15 seconds into future
    const expectedDelay = 15 * 1000 + 1000; // 16,000 ms

    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const warnSpy = vi.spyOn(logger, "warn");

    let callCount = 0;
    const fn = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        const headers = new Headers({
          "x-ratelimit-reset": String(resetSeconds),
        });
        throw new GitHubError(
          403,
          "API rate limit exceeded",
          "/repos/owner/repo",
          "Rate limit",
          headers,
        );
      }
      return "done";
    });

    const promise = withRetry("testRateLimitReset", fn, 2);

    // Flush microtasks without advancing fake timers
    await Promise.resolve();
    await Promise.resolve();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`in ${expectedDelay}ms`),
      expect.any(Object),
    );
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), expectedDelay);

    await vi.advanceTimersByTimeAsync(expectedDelay);

    const result = await promise;
    expect(result).toBe("done");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("respects retry-after header for delay calculation", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const warnSpy = vi.spyOn(logger, "warn");

    let callCount = 0;
    const fn = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        const headers = new Headers({
          "retry-after": "45",
        });
        throw new GitHubError(
          429,
          "Too Many Requests",
          "/repos/owner/repo",
          "Too many requests",
          headers,
        );
      }
      return "done-retry-after";
    });

    const promise = withRetry("testRetryAfter", fn, 2);

    const expectedDelay = 45 * 1000; // 45,000 ms
    await Promise.resolve();
    await Promise.resolve();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`in ${expectedDelay}ms`),
      expect.any(Object),
    );
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), expectedDelay);

    await vi.advanceTimersByTimeAsync(expectedDelay);

    const result = await promise;
    expect(result).toBe("done-retry-after");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("falls back to secondary rate limit backoff when no headers present", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const warnSpy = vi.spyOn(logger, "warn");

    let callCount = 0;
    const fn = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        throw new GitHubError(
          403,
          "You have exceeded a secondary rate limit.",
          "/repos/owner/repo",
          "Secondary rate limit",
        );
      }
      return "secondary-ok";
    });

    const promise = withRetry("testSecondaryBackoff", fn, 2);

    const expectedDelay = Math.pow(2, 1) * 30000; // 60,000 ms
    await Promise.resolve();
    await Promise.resolve();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`in ${expectedDelay}ms`),
      expect.any(Object),
    );
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), expectedDelay);

    await vi.advanceTimersByTimeAsync(expectedDelay);

    const result = await promise;
    expect(result).toBe("secondary-ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("falls back to exponential backoff for other errors without headers", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const warnSpy = vi.spyOn(logger, "warn");

    let callCount = 0;
    const fn = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        throw new GitHubError(
          500,
          "Internal Server Error",
          "/repos/owner/repo",
          "Server error",
        );
      }
      return "500-recovered";
    });

    const promise = withRetry("test500Backoff", fn, 2);

    const expectedDelay = Math.pow(2, 1) * 1000; // 2000 ms
    await Promise.resolve();
    await Promise.resolve();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`in ${expectedDelay}ms`),
      expect.any(Object),
    );
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), expectedDelay);

    await vi.advanceTimersByTimeAsync(expectedDelay);

    const result = await promise;
    expect(result).toBe("500-recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable 403 errors (e.g. permission denied)", async () => {
    const fn = vi.fn(async () => {
      throw new GitHubError(
        403,
        "Resource not accessible by integration",
        "/repos/owner/repo",
        "Forbidden",
      );
    });

    await expect(withRetry("testForbidden", fn, 2)).rejects.toThrow("Forbidden");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
