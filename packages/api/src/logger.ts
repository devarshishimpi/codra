import { AsyncLocalStorage } from "node:async_hooks";
import { formatLogRecord, setLoggerSink } from "@codraoss/core/logger";

// The request-context half of the logger. Scrubbing and record shaping live in @codraoss/core/logger;
// this file owns everything platform-bound -- AsyncLocalStorage and the console sink -- so that
// node:async_hooks never enters the engine package. Importing this module installs it as the sink
// that @codraoss/core's `logger` facade delegates to (see the bottom of the file).
const storage = new AsyncLocalStorage<Record<string, any>>();

class Logger {
  constructor(private context: Record<string, any> = {}) {}

  withContext(newContext: Record<string, any>) {
    return new Logger({ ...this.context, ...newContext });
  }

  private log(level: string, message: string, data?: any) {
    const store = storage.getStore() || {};
    const output = formatLogRecord(level, message, [store, this.context], data);

    if (level === "error") {
      console.error(JSON.stringify(output));
    } else if (level === "warn") {
      console.warn(JSON.stringify(output));
    } else {
      console.log(JSON.stringify(output));
    }
  }

  runWithContext<T>(context: Record<string, any>, fn: () => T): T {
    return storage.run({ ...storage.getStore(), ...context }, fn);
  }

  info(message: string, data?: any) {
    this.log("info", message, data);
  }

  error(message: string, data?: any) {
    if (data instanceof Error) {
      this.log("error", message, {
        name: data.name,
        message: data.message,
        stack: data.stack,
      });
    } else {
      this.log("error", message, data);
    }
  }

  warn(message: string, data?: any) {
    this.log("warn", message, data);
  }

  debug(message: string, data?: any) {
    this.log("debug", message, data);
  }
}

export const logger = new Logger();

// Wired at import scope so engine code logging through @codraoss/core's facade lands here, with request
// context attached, rather than in core's bare console fallback.
setLoggerSink(logger);
