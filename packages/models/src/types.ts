// Re-export for compatibility.
import type { ModelResponse as ModelResponseShape, ModelResponseSchema } from '@codraoss/core/ports';
export type { ModelResponse, ModelResponseSchema } from '@codraoss/core/ports';

export type ModelInput = {
  systemPrompt: string;
  userPrompt: string;
  responseSchema?: ModelResponseSchema;
  // Advisory: adapters clamp to their max and never go below their own default.
  outputBudgetTokens?: number;
  // Only for callers needing a whole answer; adapters retry once with more room on MAX_TOKENS.
  truncationIntolerant?: boolean;
};

export class ProviderRequestError extends Error {
  constructor(
    public readonly provider: string,
    public readonly status: number,
    message: string,
  ) {
    super(`${provider} request failed with ${status}: ${message}`);
    this.name = 'ProviderRequestError';
  }
}

// Deliberately PERMANENT (not transient): outcome is deterministic, so retry just burns quota.
export class UnparseableModelResponseError extends Error {
  constructor(public readonly model: string, public readonly reason: string) {
    super(`Model ${model} produced no reviewable output (${reason}); the file review failed.`);
    this.name = 'UnparseableModelResponseError';
  }
}

export function attachPartialResponse(error: object, response: ModelResponseShape) {
  Object.defineProperty(error, 'partialResponse', { value: response, configurable: true });
}

export function partialResponseOf(error: unknown): ModelResponseShape | null {
  if (typeof error !== 'object' || error === null) return null;
  const partial = (error as { partialResponse?: unknown }).partialResponse;
  if (typeof partial !== 'object' || partial === null) return null;
  const { rawText } = partial as { rawText?: unknown };
  return typeof rawText === 'string' && rawText.trim() ? (partial as ModelResponseShape) : null;
}

function errorDetailText(error: unknown): string {
  const details = (error as Record<string, unknown> | null)?.details;
  if (!Array.isArray(details)) return '';

  const parts = new Set<string>();
  for (const entry of details) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    for (const candidate of [e, ...(Array.isArray(e.fieldViolations) ? e.fieldViolations : [])]) {
      const description = (candidate as Record<string, unknown> | null)?.description;
      if (typeof description === 'string' && description.trim()) parts.add(description.trim());
    }
  }
  return [...parts].join(' ');
}

export function providerErrorMessage(errorText: string) {
  try {
    const parsed = JSON.parse(errorText) as unknown;
    if (typeof parsed === 'object' && parsed !== null) {
      const obj = parsed as Record<string, unknown>;
      let message: unknown;

      if (typeof obj.error === 'object' && obj.error !== null) {
        message = (obj.error as Record<string, unknown>).message ?? obj.error;
      } else {
        message = obj.message ?? obj.error;
      }

      if (typeof message === 'string' && message.trim()) {
        // Gemini's top-level message is useless; the real reason is in error.details.
        const detail = errorDetailText(obj.error);
        return detail ? `${message.trim()} ${detail}` : message.trim();
      }
    }
  } catch {
    // Not JSON: fall through to the raw provider body below.
  }

  return errorText.trim() || 'The provider returned an error.';
}

export function isThinkingRejection(status: number, message: string) {
  if (status !== 400) return false;
  const lower = message.toLowerCase();
  return lower.includes('thinking') || lower.includes('thought');
}

export function jsonOnlyPrompts(input: ModelInput) {
  return {
    system: `${input.systemPrompt}\n\nReturn only the JSON object. Do not include chain-of-thought, analysis, markdown, code fences, or explanatory prose.`,
    user: `${input.userPrompt}\n\nRespond with the required JSON object only.`,
  };
}
