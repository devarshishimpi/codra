import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelSamplingConfig } from "@codraoss/schema";

const sampling = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("../packages/models/src/providers/profile-sampling", () => ({
  profileSampling: () => sampling.current,
  geminiThinkingBudget: () => 0,
}));

import { callOpenAi, reasoningEffortFor } from "../packages/models/src/providers/openai";

const input = { systemPrompt: "system", userPrompt: "user" };
const okBody = JSON.stringify({
  choices: [{ message: { content: '{"findings":[]}' } }],
  usage: { prompt_tokens: 1, completion_tokens: 1 },
});

async function bodyFor(model: string, thinkingBudget?: ModelSamplingConfig["thinkingBudget"]) {
  sampling.current = thinkingBudget === undefined ? undefined : { temperature: 0.7, thinkingBudget };
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response(okBody, { status: 200 }));
  await callOpenAi(
    { apiKey: "k", baseUrl: "https://api.openai.com/v1", providerName: "OpenAI" },
    model,
    input,
  );
  return JSON.parse(String((fetchSpy.mock.calls.at(-1)![1] as RequestInit).body));
}

describe("reasoning_effort from the profile's thinking budget", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    sampling.current = undefined;
  });

  it("maps numeric budgets at the 3000 and 10000 boundaries", () => {
    expect(reasoningEffortFor(0)).toBe("low");
    expect(reasoningEffortFor(3000)).toBe("low");
    expect(reasoningEffortFor(3001)).toBe("medium");
    expect(reasoningEffortFor(10000)).toBe("medium");
    expect(reasoningEffortFor(10001)).toBe("high");
  });

  it("passes low, medium and high through and leaves off, auto and none unset", () => {
    expect(reasoningEffortFor("low")).toBe("low");
    expect(reasoningEffortFor("medium")).toBe("medium");
    expect(reasoningEffortFor("high")).toBe("high");
    expect(reasoningEffortFor("off")).toBeUndefined();
    expect(reasoningEffortFor("auto")).toBeUndefined();
    expect(reasoningEffortFor(undefined)).toBeUndefined();
  });

  it("sends reasoning_effort for a reasoning model with a numeric budget", async () => {
    expect((await bodyFor("o3-mini", 20000)).reasoning_effort).toBe("high");
    expect((await bodyFor("o4-mini", 5000)).reasoning_effort).toBe("medium");
    expect((await bodyFor("o3", 1000)).reasoning_effort).toBe("low");
  });

  it("sends a string budget as is", async () => {
    expect((await bodyFor("gpt-6", "medium")).reasoning_effort).toBe("medium");
  });

  it("omits it when no budget is configured, or the budget is off or auto", async () => {
    expect(await bodyFor("o3")).not.toHaveProperty("reasoning_effort");
    expect(await bodyFor("o3", "auto")).not.toHaveProperty("reasoning_effort");
    expect(await bodyFor("o3", "off")).not.toHaveProperty("reasoning_effort");
  });

  it("does not touch standard models", async () => {
    expect(await bodyFor("gpt-4o", 20000)).not.toHaveProperty("reasoning_effort");
  });
});
