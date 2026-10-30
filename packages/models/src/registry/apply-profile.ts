import {
  defaultRepoConfig,
  TEST_FILE_SKIP_GLOBS,
  type RepoConfig,
} from "@codraoss/schema";
import { ModelRegistryService } from "./service";

/**
 * Applies the model registry profile of `config.model.main` to a repo config.
 *
 * Precedence: a review setting the repo or user changed from its schema default wins; the profile only
 * replaces values still at their default. The profile's behaviour switches (prompt style, verifier,
 * topology) go to `review.model_tuning`, which core reads. A model without a registered profile, and a
 * config with no main model, keep the repo config as is plus test-file suppression, which used to be a
 * global default.
 */
export function applyModelProfile(
  config: RepoConfig,
  registry: Pick<ModelRegistryService, "findProfile"> = ModelRegistryService.getInstance(),
): RepoConfig {
  const review = { ...config.review };
  const modelId = config.model?.main;
  // No main model configured (the schema default) gets the same test-file suppression as an unknown one.
  const profile = modelId ? registry.findProfile(modelId) : undefined;
  if (!profile) {
    review.skip_files = withGlobs(review.skip_files, TEST_FILE_SKIP_GLOBS);
    return { ...config, review };
  }

  const gates = profile.gates;
  const atDefault = <K extends keyof RepoConfig["review"]>(key: K) =>
    JSON.stringify(review[key]) === JSON.stringify(defaultRepoConfig.review[key]);

  if (gates) {
    if (atDefault("max_comments")) review.max_comments = gates.maxComments;
    if (atDefault("min_severity")) review.min_severity = gates.minSeverity;
    if (atDefault("min_confidence")) review.min_confidence = gates.minConfidence;
    if (gates.suppressTestFiles) review.skip_files = withGlobs(review.skip_files, TEST_FILE_SKIP_GLOBS);
  }

  const topology = profile.topology;
  if (topology?.maxDiffLinesPerFile && atDefault("max_diff_lines_per_file")) {
    review.max_diff_lines_per_file = topology.maxDiffLinesPerFile;
  }

  // "calibrated" is also the base prompt builder's restraint style.
  const style = profile.prompts.style;
  if (style === "calibrated" && atDefault("prompt_style")) {
    review.prompt_style = "calibrated";
  }

  review.model_tuning = {
    profile: profile.id,
    prompt_style: style,
    verify: profile.verification.enabled ?? true,
    topology: topology?.mode,
    verification_radius: topology?.verifierFullContext ? 250 : undefined,
  };

  return { ...config, review };
}

function withGlobs(existing: string[], extra: readonly string[]): string[] {
  const set = new Set(existing);
  return [...existing, ...extra.filter((glob) => !set.has(glob))];
}
