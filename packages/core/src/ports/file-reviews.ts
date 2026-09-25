import type { ParsedReviewComment } from "@codraoss/schema";

export type FileReviewRow = {
  id: string;
  job_id: string;
  file_path: string;
  file_status: "pending" | "done" | "skipped" | "failed";
  model_used: string;
  diff_line_count: number;
  diff_input: string | null;
  raw_ai_output: string | null;
  parsed_comments: ParsedReviewComment[];
  input_tokens: number | null;
  output_tokens: number | null;
  duration_ms: number | null;
  verdict: "approve" | "comment" | null;
  file_summary: string | null;
  overall_correctness: string | null;
  confidence_score: number | null;
  error_msg: string | null;
  model_provider: string | null;
  transient_error_count: number;
  async_request_id: string | null;
  async_model: string | null;
  withheld_counts: {
    evidence?: number;
    claimDenied?: number;
    contextOnly?: number;
    absenceRefuted?: number;
  };
  batch_size: number | null;
};

export type SuppressedFinding = {
  fingerprint: string | null;
  anchor_hash: string | null;
  fingerprint_v2: string | null;
  anchored: boolean;
};

export type BulkFileReviewInput = {
  filePath: string;
  fileStatus: "pending" | "done" | "skipped" | "failed";
  modelUsed: string;
  modelProvider?: string | null;
  diffLineCount: number;
  rawAiOutput: string | null;
  parsedComments: ParsedReviewComment[];
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
  verdict: "approve" | "comment" | null;
  fileSummary: string | null;
  overallCorrectness?: string | null;
  confidenceScore?: number | null;
  errorMessage: string | null;
  withheldCounts?: {
    evidence: number;
    claimDenied: number;
    contextOnly?: number;
    absenceRefuted?: number;
  } | null;
  // The call answered, but not cleanly: it ran without a response grammar, or its output was cut off
  // and salvaged. Persisted rather than logged so "how often did this happen" is a query.
  degraded?: string | null;
  batchSize: number;
};

export interface FileReviewStore {
  upsertFileReview(
    jobId: string,
    input: {
      filePath: string;
      fileStatus: "pending" | "done" | "skipped" | "failed";
      modelUsed: string;
      modelProvider?: string | null;
      diffLineCount: number;
      diffInput: string | null;
      rawAiOutput: string | null;
      parsedComments: ParsedReviewComment[];
      inputTokens: number | null;
      outputTokens: number | null;
      durationMs: number | null;
      verdict: "approve" | "comment" | null;
      fileSummary: string | null;
      overallCorrectness?: string | null;
      confidenceScore?: number | null;
      errorMessage: string | null;
      withheldCounts?: {
        evidence: number;
        claimDenied: number;
        contextOnly?: number;
        absenceRefuted?: number;
      } | null;
      degraded?: string | null;
      asyncRequestId?: string | null;
      asyncModel?: string | null;
    },
  ): Promise<void>;

  recordRetryableFileReviewFailure(
    jobId: string,
    input: {
      filePath: string;
      modelUsed: string;
      modelProvider?: string | null;
      diffLineCount: number;
      diffInput: string | null;
      durationMs: number | null;
      errorMessage: string;
      countsAsAttempt?: boolean;
    },
  ): Promise<number>;

  getFileReviewsForJobs(jobIds: string[]): Promise<FileReviewRow[]>;

  bulkInheritFileReviews(input: {
    jobId: string;
    parentJobId: string;
    filePaths: string[];
  }): Promise<string[]>;
  bulkUpsertFileReviews(
    jobId: string,
    inputs: BulkFileReviewInput[],
  ): Promise<void>;
  bulkRecordRetryableFileReviewFailures(
    jobId: string,
    inputs: Array<{
      filePath: string;
      modelUsed: string;
      diffLineCount: number;
      errorMessage: string;
    }>,
    opts?: { countsAsAttempt?: boolean },
  ): Promise<Array<{ filePath: string; transientErrorCount: number }>>;
  bulkMarkFilesFailed(
    jobId: string,
    files: Array<{ filePath: string; diffLineCount: number }>,
    opts: { modelUsed: string; errorMessage: string },
  ): Promise<void>;

  getSuppressedFindings(jobId: string): Promise<SuppressedFinding[]>;
  markCommentsPosted(jobId: string, fingerprints: string[]): Promise<void>;
  markCommentDispositions(
    jobId: string,
    byFingerprint: Map<
      string,
      { disposition: string | null; reason: string | null }
    >,
  ): Promise<void>;
}
