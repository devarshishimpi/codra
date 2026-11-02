export function isRetryableGeminiStatus(status: number) {
  return (
    status === 408 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    status === 524
  );
}

export function defaultRetryDelayMs(attempt: number) {
  return Math.pow(2, attempt) * 800 + Math.random() * 400;
}

export function retryAfterDelayMs(value: string | null) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return null;
}

export function requestedRetryDelayFromBody(message: string): number | null {
  const match = /retry in ([\d.]+)s/i.exec(message);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

export function classifySchemaRejection(
  status: number,
  message: string,
): "confident" | "catchall" | null {
  if (status !== 400) return null;
  const lower = message.toLowerCase();

  const namesTheGrammar =
    lower.includes("responsejsonschema") ||
    lower.includes("response_json_schema") ||
    lower.includes("responseschema") ||
    lower.includes("response_schema") ||
    lower.includes("invalid json payload") ||
    lower.includes("unknown name") ||
    lower.includes("schema");
  if (namesTheGrammar) return "confident";

  const grammarAdjacent =
    lower.includes("generation_config") ||
    lower.includes("generationconfig") ||
    lower.includes("json") ||
    lower.includes("constrained") ||
    lower.includes("too many states");
  if (lower.includes("invalid argument") && grammarAdjacent) return "catchall";

  return null;
}

export function isRetryableTransportError(error: unknown) {
  if (!(error instanceof Error)) return false;
  // Skip retrying timeouts.
  if (
    error.name === "TimeoutError" ||
    error.message.toLowerCase().includes("timed out")
  )
    return false;
  if (error.message.includes("fetch failed")) return true;
  return error instanceof TypeError;
}
