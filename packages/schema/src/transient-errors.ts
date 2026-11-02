export const SHARED_TRANSIENT_ERROR_SUBSTRINGS = [
  "unavailable",
  "high demand",
  "returned no review content",
  "empty response",
  "[redacted]",
] as const;

export function isTimeoutMessage(lowerMessage: string): boolean {
  return lowerMessage.includes("timed out") || lowerMessage.includes("timeout");
}

export function isSubrequestBudgetMessage(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.toLowerCase().includes("subrequest");
}

export function matchesAnyTransientSubstring(
  lowerMessage: string,
  substrings: readonly string[] = SHARED_TRANSIENT_ERROR_SUBSTRINGS,
): boolean {
  return substrings.some((substring) => lowerMessage.includes(substring));
}
