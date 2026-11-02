import { describe, expect, it, vi } from "vitest";
import {
  consoleLogger,
  formatLogRecord,
  logger,
  redact,
  scrubString,
  setLoggerSink,
} from "../src/logger";

describe("scrubString", () => {
  it("replaces a JWT in the middle of a message", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abc-DEF_123";
    expect(scrubString(`auth failed for ${jwt} on retry`)).toBe(
      "auth failed for [REDACTED_JWT] on retry",
    );
  });

  it("keeps the scheme but drops the credential for Bearer and Basic", () => {
    expect(scrubString("Authorization: Bearer ghs_abcdefghijklmnop")).toBe(
      "Authorization: Bearer [REDACTED]",
    );
    expect(scrubString("sent Basic dXNlcjpwYXNzd29yZA==")).toBe(
      "sent Basic [REDACTED]",
    );
  });

  it("leaves ordinary prose and dotted paths alone", () => {
    expect(scrubString("parsed src/server/core/logger.ts fine")).toBe(
      "parsed src/server/core/logger.ts fine",
    );
    expect(scrubString("a.b.c")).toBe("a.b.c");
  });
});

describe("redact", () => {
  it("masks values under sensitive keys, case-insensitively and by substring", () => {
    expect(
      redact({
        apiKey: "x",
        API_KEY: "y",
        total_input_tokens: 5,
        nested: { password: "p" },
      }),
    ).toEqual({
      apiKey: "[REDACTED]",
      API_KEY: "[REDACTED]",
      total_input_tokens: "[REDACTED]",
      nested: { password: "[REDACTED]" },
    });
  });

  it("serializes Error instances instead of flattening them to {}", () => {
    const error = new Error("Bearer ghs_abcdefghijklmnop rejected");
    const result = redact(error);
    expect(result.name).toBe("Error");
    expect(result.message).toBe("Bearer [REDACTED] rejected");
    expect(typeof result.stack).toBe("string");
  });

  it("passes through primitives and recurses into arrays", () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
    expect(redact(7)).toBe(7);
    expect(
      redact([{ secret: "a" }, "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig"]),
    ).toEqual([{ secret: "[REDACTED]" }, "[REDACTED_JWT]"]);
  });
});

describe("formatLogRecord", () => {
  it("spreads contexts in order, later winning, and scrubs the message", () => {
    const record = formatLogRecord(
      "info",
      "Bearer ghs_abcdefghijklmnop",
      [{ requestId: "a", jobId: "1" }, { jobId: "2" }],
      { count: 3 },
    );
    expect(record.level).toBe("info");
    expect(record.message).toBe("Bearer [REDACTED]");
    expect(record.requestId).toBe("a");
    expect(record.jobId).toBe("2");
    expect(record.data).toEqual({ count: 3 });
    expect(typeof record.timestamp).toBe("string");
  });

  it("omits `data` entirely when none is given", () => {
    expect("data" in formatLogRecord("warn", "no payload", [])).toBe(false);
  });
});

describe("logger facade", () => {
  it("routes through whichever sink is installed, including one installed after import", () => {
    const calls: Array<[string, string]> = [];
    const fake = {
      info: (m: string) => calls.push(["info", m]),
      warn: (m: string) => calls.push(["warn", m]),
      error: (m: string) => calls.push(["error", m]),
      debug: (m: string) => calls.push(["debug", m]),
    };
    setLoggerSink(fake);
    try {
      logger.info("i");
      logger.warn("w");
      logger.error("e");
      logger.debug("d");
      expect(calls).toEqual([
        ["info", "i"],
        ["warn", "w"],
        ["error", "e"],
        ["debug", "d"],
      ]);
    } finally {
      setLoggerSink(consoleLogger);
    }
  });

  it("falls back to the console sink, routing errors to console.error and warnings to console.warn", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      logger.error("boom");
      logger.warn("careful");
      logger.info("fyi");
      expect(JSON.parse(error.mock.calls[0][0]).level).toBe("error");
      expect(JSON.parse(warn.mock.calls[0][0]).level).toBe("warn");
      expect(JSON.parse(log.mock.calls[0][0]).level).toBe("info");
    } finally {
      error.mockRestore();
      warn.mockRestore();
      log.mockRestore();
    }
  });
});
