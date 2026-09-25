import type { RepoConfig } from "@codraoss/schema";
import type { FileDiff } from "../diff";
import type {
  BatchReviewResult,
  parseFileReviewResponse,
} from "../model-output";
import type { RejectedExemplar } from "../prompts/file-review";
import type { VerifyCandidate } from "../prompts/verify";

type ParsedFileReview = ReturnType<typeof parseFileReviewResponse>;

export type ModelResponse = {
  rawText: string;
  inputTokens: number;
  outputTokens: number;
  modelUsed: string;
  provider: string;
  // schema-dropped: model refused the grammar. truncated: parsed prefix of a cut-off answer, may be incomplete.
  degraded?: "schema-dropped" | "schema-dropped-catchall" | "truncated";
};

export type ModelResponseSchema = {
  name: string;
  schema: Record<string, unknown>;
};

export type FileReviewOutcome = ModelResponse & {
  parsed: ParsedFileReview;
  reviewedLineCount: number;
  wasPromptTruncated: boolean;
  userPrompt: string;
};

export interface ReviewModel {
  reviewFile(params: {
    file: FileDiff;
    fileContext?: string | null;
    prTitle: string | null;
    prDescription: string | null;
    changelogExcerpt?: string | null;
    config: RepoConfig;
    totalLineCount: number;
    compactPrompt?: boolean;
    rejectedExemplars?: readonly RejectedExemplar[];
  }): Promise<FileReviewOutcome>;

  reviewFiles(params: {
    files: readonly FileDiff[];
    prTitle: string | null;
    prDescription: string | null;
    changelogExcerpt?: string | null;
    config: RepoConfig;
    totalLineCount: number;
    rejectedExemplars?: readonly RejectedExemplar[];
  }): Promise<ModelResponse & { batch: BatchReviewResult; userPrompt: string }>;

  submitReviewBatch(params: {
    file: FileDiff;
    fileContext?: string | null;
    prTitle: string | null;
    prDescription: string | null;
    changelogExcerpt?: string | null;
    config: RepoConfig;
    totalLineCount: number;
    compactPrompt?: boolean;
  }): Promise<{ requestId: string; model: string } | null>;

  pollReviewBatch(params: {
    model: string;
    requestId: string;
    file: FileDiff;
    config: RepoConfig;
  }): Promise<
    | { status: "pending" }
    | { status: "done"; response: FileReviewOutcome }
    | { status: "failed"; error: unknown }
  >;

  verifyFindings(params: {
    candidates: VerifyCandidate[];
    config: RepoConfig;
  }): Promise<ModelResponse>;
}

export interface ModelErrorClassifier {
  isRetryableModelError(error: unknown): boolean;
  nextChainIndexOf(error: unknown): number | null;
}
