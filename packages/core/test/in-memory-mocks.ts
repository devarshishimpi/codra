import type { ParsedReviewComment } from "@codraoss/schema";
import type {
  PersistedReviewJob,
  ReviewFormatter,
  ReviewGitProvider,
  ReviewModel,
} from "../src/ports";
import type { ModelBehaviour, Recorded } from "./in-memory";
import { SAMPLE_DIFF } from "./in-memory";

export class TokenTrackerStub {
  incrementSubrequests() {}
  getSubrequestCount() {
    return 0;
  }
  remainingSafeBudget() {
    return 40;
  }
  getTotalUsage() {
    return { inputTokens: 0, outputTokens: 0 };
  }
  getWasted() {
    return { calls: 0, inputTokens: 0, outputTokens: 0 };
  }
}

export function findingsFor(
  model: ModelBehaviour,
  path: string,
): ParsedReviewComment[] {
  return (model.findingsByPath?.[path] ?? []).map((finding) => ({
    path,
    line: finding.line,
    title: finding.title,
    body: finding.body,
    severity: "P1" as const,
    confidenceScore: 90,
    evidence: finding.evidence,
  })) as ParsedReviewComment[];
}

export function createMockGitHub(params: {
  job: PersistedReviewJob;
  recorded: Recorded;
  record: (name: string) => void;
}): ReviewGitProvider {
  const { job, recorded, record } = params;
  return {
    getPullRequest: async () => ({
      number: job.prNumber,
      title: job.prTitle,
      body: "Adds a retry helper.",
      draft: false,
      head: { sha: job.commitSha, ref: "feature" },
      base: { sha: "b".repeat(40), ref: "main" },
      user: { login: job.prAuthor ?? "octocat" },
    }),
    getPullRequestDiff: async () => {
      record("getPullRequestDiff");
      return SAMPLE_DIFF;
    },
    getCompareDiff: async () => SAMPLE_DIFF,
    createCheckRun: async (_o, _r, p) => {
      recorded.checkRuns.push({ title: p.title });
      return { id: 555 };
    },
    updateCheckRun: async (_o, _r, _id, p) => {
      recorded.checkRuns.push({
        title: p.title,
        status: p.status,
        conclusion: p.conclusion,
      });
      return undefined;
    },
    createReview: async (_o, _r, _pr, p) => {
      record("createReview");
      recorded.postedReviews.push({
        body: p.body,
        comments: p.comments.map((c) => ({
          path: c.path,
          body: c.body,
        })),
      });
      return {
        id: 999,
        postedIndices: p.comments.map((_c, index) => index),
      };
    },
    findBotReviewForCommit: async () => null,
    ensureLabel: async () => undefined,
    addIssueLabels: async () => undefined,
    removeIssueLabelsIfPresent: async () => undefined,
  };
}

export function createMockModel(params: {
  model: ModelBehaviour;
  record: (name: string) => void;
}): ReviewModel {
  const { model, record } = params;
  return {
    reviewFile: async (p) => {
      if (model.failEveryCall) throw model.failEveryCall;
      record(`reviewFile:${p.file.path}`);
      const comments = findingsFor(model, p.file.path);
      return {
        rawText: JSON.stringify({ comments }),
        inputTokens: 100,
        outputTokens: 20,
        modelUsed: "fake/model",
        provider: "fake",
        reviewedLineCount: p.file.lineCount,
        wasPromptTruncated: false,
        userPrompt: "prompt",
        parsed: {
          comments,
          verdict: comments.length > 0 ? "comment" : "approve",
          fileSummary: `Reviewed ${p.file.path}`,
        },
      } as never;
    },
    reviewFiles: async (p) => {
      if (model.failEveryCall) throw model.failEveryCall;
      record(`reviewFiles:${p.files.length}`);
      const reviews = new Map(
        p.files.map((file) => {
          const comments = findingsFor(model, file.path);
          return [
            file.path,
            {
              comments,
              verdict: comments.length > 0 ? "comment" : "approve",
              fileSummary: `Reviewed ${file.path}`,
            },
          ];
        }),
      );
      return {
        rawText: "batch",
        inputTokens: 200,
        outputTokens: 40,
        modelUsed: "fake/model",
        provider: "fake",
        userPrompt: "prompt",
        batch: { reviews, missing: [] },
      } as never;
    },
    submitReviewBatch: async () => null,
    pollReviewBatch: async () => ({ status: "pending" as const }),
    verifyFindings: async (p) => {
      record(`verifyFindings:${p.candidates.length}`);
      const results = p.candidates.map((candidate) => ({
        index: candidate.index,
        verdict: model.verifyVerdicts?.[candidate.index] ?? "keep",
        reason: "fake verdict",
      }));
      return {
        rawText: JSON.stringify({ results }),
        inputTokens: 50,
        outputTokens: 10,
        modelUsed: "fake/model",
        provider: "fake",
      };
    },
  };
}

export function createMockFormatter(): ReviewFormatter {
  return {
    toReviewEvent: (verdict) => (verdict === "approve" ? "APPROVE" : "COMMENT"),
    summarizeVerdict: (comments, hasFailures) => ({
      verdict: comments.length > 0 || hasFailures ? "comment" : "approve",
      errors: 0,
      warnings: comments.length,
    }),
    formatInlineComment: (comment) => `**${comment.title}**\n\n${comment.body}`,
    formatReviewOverview: ({ commitSha, postedFindings }) =>
      `### Codra Review\nReviewed ${commitSha.slice(0, 7)}: ${postedFindings} posted`,
  };
}
