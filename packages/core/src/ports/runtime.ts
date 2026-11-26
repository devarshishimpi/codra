import type { TokenTracker } from "../token-tracker";
import type { Clock, IdGenerator, KvStore } from "./platform";
import type { FileReviewStore } from "./file-reviews";
import type { GitProviderFactory, ReviewGitProvider } from "./git-provider";
import type { JobStore } from "./jobs";
import type { ModelErrorClassifier, ReviewModel } from "./model";
import type { ReviewFormatter } from "./formatter";
import type {
  LearningStore,
  ModelConfigReader,
  RepoConfigLoader,
  ReviewSettingsReader,
  WebhookDeliveryReader,
} from "./settings";
import type { TelemetrySink } from "./telemetry";

export interface ReviewRuntime {
  kv: KvStore;
  clock: Clock;
  ids: IdGenerator;
  botUsername: string;
  jobs: JobStore;
  fileReviews: FileReviewStore;
  settings: ReviewSettingsReader;
  webhooks: WebhookDeliveryReader;
  learning: LearningStore;
  modelConfigs: ModelConfigReader;
  repoConfig: RepoConfigLoader;
  telemetry: TelemetrySink;

  createTokenTracker(): TokenTracker;
  createGitHub(
    installationId: string,
    tracker: TokenTracker,
  ): ReviewGitProvider;
  createModel(jobId: string, tracker: TokenTracker): ReviewModel;
  createFormatter(): ReviewFormatter;

  githubClients: GitProviderFactory;
  modelErrors: ModelErrorClassifier;
}
