import { logger } from "./logger";

export interface TokenUsage {
  input: number;
  output: number;
}

export interface ModelUsage extends TokenUsage {
  model: string;
  calls: number;
}

export type WastedAttemptReason = "rate-limited" | "error";

export interface WastedUsage {
  attempts: number;
  estimatedInput: number;
  skips: number;
  byReason: Record<string, number>;
}

export class TokenTracker {
  private usage: Map<string, ModelUsage> = new Map();
  private wasted = { attempts: 0, estimatedInput: 0, skips: 0 };
  private wastedByReason: Map<string, number> = new Map();
  private subrequests = 0;
  private readonly MAX_SUBREQUESTS = 50;
  private readonly SAFE_MARGIN = 25;

  incrementSubrequests(count = 1) {
    this.subrequests += count;
  }

  getSubrequestCount() {
    return this.subrequests;
  }

  hasRemainingSubrequests(needed = 1) {
    return this.subrequests + needed <= this.MAX_SUBREQUESTS;
  }

  isNearLimit() {
    return this.subrequests >= this.MAX_SUBREQUESTS - this.SAFE_MARGIN;
  }

  remainingSafeBudget() {
    return Math.max(
      0,
      this.MAX_SUBREQUESTS - this.SAFE_MARGIN - this.subrequests,
    );
  }

  record(model: string, input: number, output: number) {
    const existing = this.usage.get(model) || {
      model,
      input: 0,
      output: 0,
      calls: 0,
    };

    this.usage.set(model, {
      model,
      input: existing.input + input,
      output: existing.output + output,
      calls: existing.calls + 1,
    });

    logger.debug(`Token usage recorded for ${model}`, {
      input,
      output,
      totalInput: existing.input + input,
      totalOutput: existing.output + output,
    });
  }

  recordFailedAttempt(
    model: string,
    estimatedInputTokens: number,
    reason: WastedAttemptReason,
  ) {
    this.wasted.attempts += 1;
    this.wasted.estimatedInput += estimatedInputTokens;
    this.wastedByReason.set(reason, (this.wastedByReason.get(reason) ?? 0) + 1);

    logger.debug(`Wasted model attempt on ${model}`, {
      estimatedInput: estimatedInputTokens,
      reason,
    });
  }

  recordSkippedCall(model: string, reason: string) {
    this.wasted.skips += 1;

    logger.debug(`Skipped model call on ${model}`, { reason });
  }

  getWasted(): WastedUsage {
    return {
      ...this.wasted,
      byReason: Object.fromEntries(this.wastedByReason),
    };
  }

  getTotalUsage(): TokenUsage {
    let input = 0;
    let output = 0;
    for (const modelUsage of this.usage.values()) {
      input += modelUsage.input;
      output += modelUsage.output;
    }
    return { input, output };
  }

  getBreakdown(): ModelUsage[] {
    return Array.from(this.usage.values());
  }

  merge(other: TokenTracker) {
    for (const usage of other.getBreakdown()) {
      this.record(usage.model, usage.input, usage.output);
    }

    const otherWasted = other.getWasted();
    this.wasted.attempts += otherWasted.attempts;
    this.wasted.estimatedInput += otherWasted.estimatedInput;
    this.wasted.skips += otherWasted.skips;
    for (const [reason, count] of Object.entries(otherWasted.byReason)) {
      this.wastedByReason.set(
        reason,
        (this.wastedByReason.get(reason) ?? 0) + count,
      );
    }
  }

  reset() {
    this.usage.clear();
    this.wasted = { attempts: 0, estimatedInput: 0, skips: 0 };
    this.wastedByReason.clear();
  }
}
