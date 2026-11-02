/**
 * The logging port. A correct implementation must:
 *  - never throw, for any input, including circular objects (callers log on failure paths, so a
 *    throwing logger converts a handled error into an unhandled one);
 *  - never block the caller on I/O;
 *  - scrub secrets before emitting, using `scrubString`/`redact` below rather than its own rules.
 * Ordering between calls is not guaranteed and callers must not rely on it.
 */
export interface Logger {
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
  debug(message: string, data?: unknown): void;
}

const SENSITIVE_KEYS = [
  "api_key",
  "api-key",
  "apikey",
  "secret",
  "password",
  "token",
  "private_key",
  "private-key",
  "database_url",
  "authorization",
  "session",
  "cookie",
];

const JWT = /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;

export function scrubString(value: string): string {
  return value
    .replace(JWT, "[REDACTED_JWT]")
    .replace(BEARER, (m) => `${m.split(/\s+/)[0]} [REDACTED]`);
}

export function redact(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") {
    return typeof obj === "string" ? scrubString(obj) : obj;
  }
  if (Array.isArray(obj)) return obj.map(redact);
  if (obj instanceof Error) {
    return {
      name: obj.name,
      message: scrubString(obj.message),
      ...(obj.stack ? { stack: scrubString(obj.stack) } : {}),
    };
  }

  const redacted: any = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.some((sk) => lowerKey.includes(sk))) {
      redacted[key] = "[REDACTED]";
    } else {
      redacted[key] = redact(value);
    }
  }
  return redacted;
}

export function formatLogRecord(
  level: string,
  message: string,
  contexts: Array<Record<string, any>>,
  data?: any,
): Record<string, unknown> {
  return {
    timestamp: new Date().toISOString(),
    level,
    message: scrubString(message),
    ...contexts.reduce<Record<string, unknown>>(
      (merged, context) => Object.assign(merged, redact(context)),
      {},
    ),
    ...(data ? { data: redact(data) } : {}),
  };
}

export const consoleLogger: Logger = {
  info: (message, data) =>
    console.log(JSON.stringify(formatLogRecord("info", message, [], data))),
  warn: (message, data) =>
    console.warn(JSON.stringify(formatLogRecord("warn", message, [], data))),
  error: (message, data) =>
    console.error(JSON.stringify(formatLogRecord("error", message, [], data))),
  debug: (message, data) =>
    console.log(JSON.stringify(formatLogRecord("debug", message, [], data))),
};

let sink: Logger = consoleLogger;

/**
 * Installs the host's logger. Called once at import scope by src/server/core/logger.ts, and by tests
 * that want to capture output.
 *
 * This is the one piece of module-level mutable state in this package, and it is deliberate: `logger`
 * below is used at import scope by fifteen modules here, several of them (model-output/*, rules/*,
 * finding-gates.ts) pure functions with no runtime parameter to hang a port off. Threading a Logger
 * argument through all of them would be by far the largest and least mechanical part of the
 * extraction, for no behavioural gain.
 */
export function setLoggerSink(next: Logger) {
  sink = next;
}

export const logger: Logger = {
  info: (message, data) => sink.info(message, data),
  warn: (message, data) => sink.warn(message, data),
  error: (message, data) => sink.error(message, data),
  debug: (message, data) => sink.debug(message, data),
};
