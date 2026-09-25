// Packing & Diff Limits
export const PACKABLE_MAX_DIFF_LINES = 150;
export const BIN_TARGET_DIFF_LINES = 300;
export const BIN_MAX_FILES = 4;
export const BIN_DIFF_CHAR_BUDGET = 24_000;
// Files with many scattered hunks get whole-file context; the line floor excludes trivial files.
export const FRAGMENTED_HUNK_THRESHOLD = 5;
export const FRAGMENTED_MIN_LINES = 60;
// Whole-job input ceiling: a pathological-input valve, NOT an operating limit -- `max_files` and
// `max_diff_lines_per_file` are the controls. Deliberately a constant and not repo config: it was a
// config field with no UI and no file source, so every stored config carried a value nobody chose,
// and raising the schema default left those rows untouched. A 500-file review at ~7.5k chars per
// file needs ~3.8M, so this clears the largest review `max_files` permits.
export const MAX_TOTAL_DIFF_CHARS = 4_000_000;
export const DIFF_CACHE_TTL_SECONDS = 6 * 60 * 60;

// Phase Control & Timers
export const REVIEW_CHUNK_WALL_CLOCK_MS = 12 * 60 * 1000;
export const JOB_LEASE_SECONDS = 15 * 60;
export const BUSY_RETRY_SECONDS = 60;
export const RETRYABLE_MODEL_FAILURE_RETRY_DELAYS_SECONDS = [
  30,
  2 * 60,
  5 * 60,
];
export const FRESH_INVOCATION_YIELD_SECONDS = 8;
export const ASYNC_BATCH_POLL_DELAY_SECONDS = 20;
export const MAX_RETRYABLE_FILE_REVIEW_FAILURES = 6;
export const MAX_JOB_CONTINUATIONS = 20;
export const MAX_FINALIZE_CONTINUATIONS = 3;

// Budget & Attempts
export const FILE_FIXED_SUBREQUESTS = 2;
export const MAX_MODEL_ATTEMPTS_ESTIMATE = 4;
export const MISSING_FILE_ERROR =
  "Model omitted this file from a batched review; retrying later.";

// Model Output Parsing
export const MIN_DISCRIMINATING_EVIDENCE_CHARS = 8;
export const NON_ANSWER_MAX_RESPONSE_CHARS = 600;
export const NON_ANSWER_MIN_DIFF_LINES = 200;
export const MAX_LOGGED_JSON_CHARS = 2_000;
export const SEVERITY_ORDER = ["P0", "P1", "P2", "P3", "nit"] as const;

// Finding Gates
export const VERIFY_MIN_ANSWER_RATIO = 0.6;

// Rules
export const MAX_RULE_SCAN_ADDED_LINES = 600;

// Prompts
export const EXEMPLAR_BLOCK_CHARS = 700;
export const PR_DESCRIPTION_CHARS = 2_000;
// Changelog entries are short; keep well under the description budget.
export const CHANGELOG_EXCERPT_CHARS = 600;
// Whole-file context budget when full_file_context is on; half the bin diff budget.
export const FILE_CONTEXT_CHAR_BUDGET = 8_000;
// Per-chunk window, not a repeated whole-file block, to stay within the budget above.
export const FILE_CONTEXT_WINDOW_LINES = 120;
