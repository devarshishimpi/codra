import {
  FILE_FIXED_SUBREQUESTS,
  MAX_MODEL_ATTEMPTS_ESTIMATE,
} from "../constants";

export function budgetAwareFileLimit(
  remainingSafeBudget: number,
  configuredChunkFileLimit: number,
  modelChainLength = 1,
  fetchesFileContent = false,
  runsSecondaryReviewer = false,
) {
  const budgetLimit = Math.floor(
    remainingSafeBudget /
      estimatedSubrequestsPerFile(
        modelChainLength,
        fetchesFileContent,
        runsSecondaryReviewer,
      ),
  );
  // Never zero while any budget remains: a file limit of 0 defers every file forever, and a job that
  // can afford one file at a time should make progress one file at a time.
  return Math.max(
    remainingSafeBudget > 0 ? 1 : 0,
    Math.min(configuredChunkFileLimit, budgetLimit),
  );
}

export function estimatedSubrequestsPerFile(
  modelChainLength: number,
  fetchesFileContent = false,
  runsSecondaryReviewer = false,
) {
  const modelAttempts = Math.max(
    1,
    Math.min(modelChainLength, MAX_MODEL_ATTEMPTS_ESTIMATE),
  );
  // A second reviewer walks its own chain, so it doubles the model half of the estimate but not the
  // fixed per-file cost. Roughly halving files per invocation is the correct answer, not a problem:
  // the continuation loop already carries the rest of the job into the next invocation.
  return (
    FILE_FIXED_SUBREQUESTS +
    modelAttempts * (runsSecondaryReviewer ? 2 : 1) +
    (fetchesFileContent ? 1 : 0)
  );
}
