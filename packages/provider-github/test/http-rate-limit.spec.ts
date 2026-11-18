import { afterEach, describe, expect, it, vi } from "vitest";
import { setLoggerSink } from "@codraoss/core/logger";
import type { Logger } from "@codraoss/core/logger";
import {
  assertResponseOk,
  GitHubError,
  withRetry,
} from "../src/http";

const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};
const NOW = 1_700_000_000_000;
const PRIMARY_BODY = "API rate limit exceeded for installation ID 12345";

function rateLimitError(headers?: Headers) {
  return new GitHubError(403, PRIMARY_BODY, "/repos/o/r", "request failed", headers);
}

function captureDelays() {
  const delays: number[] = [];
  vi.spyOn(globalThis, "setTimeout").mockImplementation((
    (cb: (...args: unknown[]) => void, ms?: number) => {
      delays.push(Number(ms));
      cb();
      return 0;
    }
  ) as typeof setTimeout);
  return delays;
}

afterEach(() => {
  vi.restoreAllMocks();
  setLoggerSink(noopLogger);
});

describe("withRetry: primary rate limit", () => {
  it("retries a 403 with primary rate-limit body text and succeeds later", async () => {
    setLoggerSink(noopLogger);
    captureDelays();
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(rateLimitError())
      .mockResolvedValueOnce("ok");

    await expect(withRetry("list repos", fn, 2)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("waits until x-ratelimit-reset when present", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const delays = captureDelays();
    const reset = String(Math.floor(NOW / 1000) + 5);
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(
        rateLimitError(new Headers({ "x-ratelimit-reset": reset })),
      )
      .mockResolvedValueOnce("ok");

    await expect(withRetry("list repos", fn, 2)).resolves.toBe("ok");
    // (reset * 1000 - now) + 1000 = 5000 + 1000
    expect(delays).toEqual([6000]);
  });

  it("falls back to 2^attempt * 30s without a reset header", async () => {
    const delays = captureDelays();
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(rateLimitError())
      .mockResolvedValueOnce("ok");

    await expect(withRetry("list repos", fn, 2)).resolves.toBe("ok");
    expect(delays).toEqual([Math.pow(2, 1) * 30000]);
  });
});

describe("assertResponseOk", () => {
  it("carries response headers on the thrown GitHubError", async () => {
    const response = new Response(JSON.stringify({ message: PRIMARY_BODY }), {
      status: 403,
      headers: { "x-ratelimit-reset": "1234567890" },
    });
    const error = await assertResponseOk(response, "/repos/o/r", "request").then(
      () => null,
      (e) => e as GitHubError,
    );

    expect(error).toBeInstanceOf(GitHubError);
    expect(error!.headers?.get("x-ratelimit-reset")).toBe("1234567890");
  });
});
