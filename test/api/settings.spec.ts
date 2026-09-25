import { describe, expect, it } from "vitest";
import { normalizeGlobalConfig } from "@client/hooks/use-provider-settings";

describe("settings model strategy", () => {
  it("does not invent a global strategy when none has been saved", () => {
    expect(normalizeGlobalConfig(null)).toEqual({
      main: null,
      fallbacks: [],
      size_overrides: [],
    });
  });

  it("preserves an explicit empty global fallback list", () => {
    const config = normalizeGlobalConfig({
      main: "gemini-3.1-pro-preview",
      fallbacks: [],
      size_overrides: [
        {
          max_lines: 300,
          model: "gemini-3.1-pro-preview",
          fallbacks: [],
        },
      ],
    });

    expect(config.fallbacks).toEqual([]);
    expect(config.size_overrides[0].fallbacks).toEqual([]);
  });
});
