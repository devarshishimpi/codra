import { ModelRegistrySchema, defaultRepoConfig, TEST_FILE_SKIP_GLOBS, type RepoConfig } from "@codraoss/schema";
import { ModelRegistryService, applyModelProfile } from "@codraoss/models";
import bundledRegistry from "../../packages/models/src/registry/model-profiles.json" with { type: "json" };

const withModel = (main: string | null, review: Partial<RepoConfig["review"]> = {}): RepoConfig => ({
  ...defaultRepoConfig,
  review: { ...defaultRepoConfig.review, ...review },
  model: { ...defaultRepoConfig.model, main },
});

describe("model registry", () => {
  // A registry that fails its schema makes getInstance() throw, and production swallowed that and
  // silently ran every model untuned. This keeps the bundled file valid.
  it("bundled model-profiles.json parses against its schema", () => {
    const parsed = ModelRegistrySchema.safeParse(bundledRegistry);
    expect(parsed.success ? "ok" : parsed.error.issues.slice(0, 3)).toBe("ok");
  });

  it.each([
    ["glm-4.7-flash", "zai-glm-4"],
    ["stepfun-ai/step-5-preview", "nvidia/step-5-preview"],
    ["nvidia/nemotron-3.5-lightning-30b-a3b", "nvidia/nemotron-3.5-lightning-30b-a3b"],
    ["nvidia/nemotron-3.5-super-vl-120b-a12b", "nvidia/nemotron-3.5-super-vl-120b-a12b"],
    ["gemini-3.1-flash-lite", "gemini-3.1-flash-lite"],
    ["gemini-3.5-flash-lite", "gemini-3.5-flash-lite"],
  ])("resolves %s to its registered profile", (model, id) => {
    expect(ModelRegistryService.getInstance().findProfile(model)?.id).toBe(id);
  });

  it.each([
    ["google:gemini-3.1-flash-lite", "gemini-3.1-flash-lite"],
    ["@cf/zai-org/glm-4.7-flash", "zai-glm-4"],
    ["@cf/google/gemma-4-26b-a4b-it", "google/gemma-4-26b"],
    ["nvidia:nvidia/nemotron-3.5-lightning-30b-a3b", "nvidia/nemotron-3.5-lightning-30b-a3b"],
  ])("resolves the configured id %s to %s", (model, id) => {
    expect(ModelRegistryService.getInstance().findProfile(model)?.id).toBe(id);
  });

  it("has no registered profile for an unknown model", () => {
    expect(ModelRegistryService.getInstance().findProfile("acme/unknown-model")).toBeUndefined();
  });

  // The Nemotron profiles were measured on NVIDIA build; the Workers AI deployment gets no profile.
  it("does not apply an NVIDIA-tuned profile to the Workers AI Nemotron", () => {
    expect(ModelRegistryService.getInstance().findProfile("@cf/nvidia/nemotron-3-120b-a12b")).toBeUndefined();
  });
});

describe("applyModelProfile", () => {
  it("gives a config without a model test-file suppression and nothing else", () => {
    const out = applyModelProfile(withModel(null));
    expect(out.review.model_tuning).toBeUndefined();
    expect(out.review.max_comments).toBe(defaultRepoConfig.review.max_comments);
    for (const glob of TEST_FILE_SKIP_GLOBS) expect(out.review.skip_files).toContain(glob);
  });

  it("gives an unknown model test-file suppression and nothing else", () => {
    const out = applyModelProfile(withModel("acme/unknown-model"));
    expect(out.review.model_tuning).toBeUndefined();
    expect(out.review.max_comments).toBe(defaultRepoConfig.review.max_comments);
    for (const glob of TEST_FILE_SKIP_GLOBS) expect(out.review.skip_files).toContain(glob);
  });

  it("applies the GLM 4.7 Flash profile: cap 8, verifier off", () => {
    const out = applyModelProfile(withModel("glm-4.7-flash"));
    expect(out.review.max_comments).toBe(8);
    expect(out.review.min_severity).toBe("P3");
    expect(out.review.min_confidence).toBe(0.5);
    expect(out.review.skip_files).not.toContain("**/test/**");
    expect(out.review.model_tuning).toMatchObject({
      profile: "zai-glm-4",
      prompt_style: "balanced",
      verify: false,
      topology: "chunked",
    });
  });

  it("applies the Step-5 profile: calibrated, tests suppressed, verifier on", () => {
    const out = applyModelProfile(withModel("stepfun-ai/step-5-preview"));
    expect(out.review.prompt_style).toBe("calibrated");
    expect(out.review.max_comments).toBe(5);
    expect(out.review.skip_files).toContain("**/test/**");
    expect(out.review.model_tuning).toMatchObject({ prompt_style: "calibrated", verify: true });
  });

  it("applies the Nemotron Lightning profile: trace_then_report, unified topology, verifier off", () => {
    const out = applyModelProfile(withModel("nvidia/nemotron-3.5-lightning-30b-a3b"));
    expect(out.review.max_comments).toBe(8);
    expect(out.review.model_tuning).toMatchObject({
      prompt_style: "trace_then_report",
      verify: false,
      topology: "unified",
    });
  });

  it("applies the Nemotron 120B and Gemini profiles", () => {
    const nemo = applyModelProfile(withModel("nvidia/nemotron-3.5-super-vl-120b-a12b")).review;
    expect(nemo.model_tuning).toMatchObject({ prompt_style: "trace_then_report", verify: false, topology: "unified" });
    const gemini = applyModelProfile(withModel("gemini-3.1-flash-lite")).review;
    expect(gemini.model_tuning).toMatchObject({ prompt_style: "balanced", verify: true });
    expect(gemini.max_comments).toBe(8);
  });

  it("keeps a value the repo set explicitly over the profile's", () => {
    const out = applyModelProfile(withModel("glm-4.7-flash", { max_comments: 10, min_severity: "P1" }));
    expect(out.review.max_comments).toBe(10);
    expect(out.review.min_severity).toBe("P1");
    expect(out.review.min_confidence).toBe(0.5);
  });
});
