import type { GitProviderFactory, ModelErrorClassifier, ReviewFormatter, ReviewGitProvider, ReviewModel } from '@codraoss/core/ports';
import type { TokenTracker } from '@codraoss/core/token-tracker';
import type { AppBindings } from '../env';
import { GitHubService } from '@codraoss/provider-github';
import { isRetryableModelError, ModelRunner, nextChainIndexOf } from '@codraoss/models';
import { FormatterService } from '@codraoss/core/formatter';
import { getResolvedModelConfig } from '@codraoss/db/model-configs';

// The only place the four job-scoped collaborators are constructed. Every specifier above is the
// barrel form on purpose: nine specs vi.mock '@server/services/github' and '@codraoss/models',
// and reaching for a sibling here would bypass those mocks while the tests kept passing.

export function makeGitHubFactory(env: AppBindings) {
  return (installationId: string, tracker: TokenTracker): ReviewGitProvider => new GitHubService(env, installationId, tracker);
}

export function makeModelFactory(env: AppBindings) {
  return (jobId: string, tracker: TokenTracker): ReviewModel => new ModelRunner({
    kv: env.APP_KV as any, // APP_KV matches KvStore interface
    secretStore: {
      getSecret: async (key) => env[key as keyof AppBindings] as string || null,
    },
    getConfig: (modelId) => getResolvedModelConfig(env, modelId),
    aiBinding: env.AI,
    tracker,
    jobId,
  });
}

export function makeFormatterFactory(env: AppBindings) {
  return (): ReviewFormatter => new FormatterService(env.APP_URL);
}

// Webhook resolution runs before a job row exists, so it cannot go through the job-scoped factory
// above: GitHubClient is the lower-level client the engine uses for label cleanup on a closed pull
// request and for finding the pull request behind an issue comment.
export function makeGitHubClientFactory(env: AppBindings): GitProviderFactory {
  return {
    forInstallation(installationId: string): ReviewGitProvider {
      return new GitHubService(env, installationId);
    },
  };
}

export function makeModelErrorClassifier(): ModelErrorClassifier {
  return { isRetryableModelError, nextChainIndexOf };
}
