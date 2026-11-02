import type { ModelSamplingConfig } from "@codraoss/schema";
import { ModelRegistryService } from "../registry/service";

/**
 * The registered profile's sampling for the model an adapter is about to call, or undefined when the
 * registry has no profile for it (the adapter then keeps its own defaults). Looked up per call, so a
 * fallback model in a chain gets its own profile, not the main model's.
 */
export function profileSampling(model: string): ModelSamplingConfig | undefined {
  return ModelRegistryService.getInstance().findProfile(model)?.sampling;
}

/**
 * A profile's Gemini thinking budget in tokens: "off" is 0, a number is used as is, and "auto" (or no
 * profile) is Codra's default derived from the answer budget.
 */
export function geminiThinkingBudget(
  sampling: ModelSamplingConfig | undefined,
  codraDefault: number,
): number {
  if (sampling?.thinkingBudget === "off") return 0;
  if (typeof sampling?.thinkingBudget === "number") return sampling.thinkingBudget;
  return codraDefault;
}
