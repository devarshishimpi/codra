import type { GitProviderFactory, ModelErrorClassifier, ReviewFormatter, ReviewGitProvider, ReviewModel } from '@codraoss/core/ports';
import type { TokenTracker } from '@codraoss/core/token-tracker';
import type { NodeAppBindings } from '../env';
import { GitHubService } from '@codraoss/provider-github';
import { isRetryableModelError, ModelRunner, nextChainIndexOf } from '@codraoss/models';
import { FormatterService } from '@codraoss/core/formatter';
import { getResolvedModelConfig } from '@codraoss/db/model-configs';

export function makeGitHubFactory(env: NodeAppBindings) {
  return (installationId: string, tracker: TokenTracker): ReviewGitProvider => new GitHubService(env, installationId, tracker);
}

export function makeModelFactory(env: NodeAppBindings) {
  return (jobId: string, tracker: TokenTracker): ReviewModel => new ModelRunner({
    kv: env.APP_KV as any,
    secretStore: {
      getSecret: async (key) => (env[key as keyof NodeAppBindings] as string | undefined | null) ?? process.env[key] ?? null,
    },
    getConfig: (modelId) => getResolvedModelConfig({ HYPERDRIVE: env.DATABASE_CONFIG, APP_KV: env.APP_KV }, modelId),
    aiBinding: undefined,
    tracker,
    jobId,
  });
}

export function makeFormatterFactory(env: NodeAppBindings) {
  return (): ReviewFormatter => new FormatterService(env.APP_URL);
}

export function makeGitHubClientFactory(env: NodeAppBindings): GitProviderFactory {
  return {
    forInstallation(installationId: string, tracker?: TokenTracker): ReviewGitProvider {
      return new GitHubService(env, installationId, tracker);
    },
  };
}

export function makeModelErrorClassifier(): ModelErrorClassifier {
  return { isRetryableModelError, nextChainIndexOf };
}
