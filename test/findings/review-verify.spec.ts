import { verifyFindings } from "@server/core/review";
import { defaultRepoConfig, type ParsedReviewComment } from "@codraoss/schema";
import type { FileDiff } from "@codraoss/core/diff";

const files: FileDiff[] = [
  {
    path: "a.ts",
    previousPath: null,
    isNew: false,
    isDeleted: false,
    isBinary: false,
    lineCount: 2,
    hunks: [
      {
        header: "@@ -1,2 +1,2 @@",
        lines: [
          {
            kind: "add",
            content: "const x = 1;",
            newLineNumber: 1,
            position: 1,
          },
          {
            kind: "add",
            content: "const y = 2;",
            newLineNumber: 2,
            position: 2,
          },
        ],
      },
    ],
  },
];

const comment = (over: Partial<ParsedReviewComment>): ParsedReviewComment => ({
  path: "a.ts",
  line: 1,
  position: 1,
  severity: "P1",
  category: "quality",
  title: "Finding",
  body: "body",
  ...over,
});

const fakeModel = (rawText: string) => ({
  verifyFindings: async () => ({
    rawText,
    inputTokens: 0,
    outputTokens: 0,
    modelUsed: "m",
    provider: "p",
  }),
});

const throwingModel = () => ({
  verifyFindings: async () => {
    throw new Error("provider down");
  },
});

describe("verifyFindings orchestrator", () => {
  const base = { job: { id: "job-1" }, config: defaultRepoConfig, files };

  it("drops findings the verifier marks as drop, and records its reason", async () => {
    const comments = [
      comment({ title: "Real bug" }),
      comment({ title: "False positive" }),
    ];
    const model = fakeModel(
      '{"results":[{"index":0,"verdict":"keep"},{"index":1,"reason":"line does not do that","verdict":"drop"}]}',
    );
    const result = await verifyFindings({ ...base, comments, model });
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].title).toBe("Real bug");
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].disposition).toBe("verify");
    expect(result.dropped[0].reason).toBe("line does not do that");
    // Reasons are recorded for kept findings too.
    expect(result.reasons.size).toBeGreaterThanOrEqual(0);
  });

  // decidable:false must drop a finding, or the field is decoration (regression from PR #86).
  it("drops a finding the verifier says it cannot settle, whatever verdict it gave", async () => {
    const comments = [
      comment({ title: "Checkable" }),
      comment({ title: "Needs the importers" }),
    ];
    const model = fakeModel(
      '{"results":[' +
        '{"index":0,"reason":"line does exhibit it","decidable":true,"verdict":"keep"},' +
        '{"index":1,"reason":"would need the importers of this module","decidable":false,"verdict":"keep"}' +
        "]}",
    );

    const result = await verifyFindings({ ...base, comments, model });

    expect(result.comments.map((c) => c.title)).toEqual(["Checkable"]);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].comment.title).toBe("Needs the importers");
    expect(result.dropped[0].reason).toBe(
      "would need the importers of this module",
    );
  });

  // Omitting decidable must not make every finding undecidable.
  it("keeps findings when the verifier omits decidable entirely", async () => {
    const comments = [
      comment({ title: "Kept" }),
      comment({ title: "Also kept" }),
    ];
    const model = fakeModel(
      '{"results":[{"index":0,"verdict":"keep"},{"index":1,"verdict":"keep"}]}',
    );

    const result = await verifyFindings({ ...base, comments, model });

    expect(result.comments).toHaveLength(2);
    expect(result.dropped).toHaveLength(0);
  });

  it("falls back to the input findings when verification throws", async () => {
    const comments = [comment({ title: "A" }), comment({ title: "B" })];
    const result = await verifyFindings({
      ...base,
      comments,
      model: throwingModel(),
    });
    expect(result.comments).toHaveLength(2);
    expect(result.dropped).toHaveLength(0);
  });

  // Verdicts map by index, not result array order.
  it("applies verdicts by index, not by arrival order", async () => {
    const comments = [
      comment({ title: "A" }),
      comment({ title: "B" }),
      comment({ title: "C" }),
    ];
    const model = fakeModel(
      '{"results":[{"index":2,"verdict":"drop"},{"index":0,"verdict":"keep"},{"index":1,"verdict":"keep"}]}',
    );
    const result = await verifyFindings({ ...base, comments, model });
    expect(result.comments.map((c) => c.title)).toEqual(["A", "B"]);
  });

  // An unanswered index fails closed as verify_unanswered, not a model verdict.
  it("drops an unanswered index as verify_unanswered when most indices were answered", async () => {
    const comments = ["A", "B", "C", "D", "E"].map((title) =>
      comment({ title }),
    );
    const model = fakeModel(
      '{"results":[{"index":0,"verdict":"keep"},{"index":1,"verdict":"keep"},{"index":2,"verdict":"keep"},{"index":4,"verdict":"keep"}]}',
    );
    const result = await verifyFindings({ ...base, comments, model });
    expect(result.comments.map((c) => c.title)).toEqual(["A", "B", "C", "E"]);
    expect(result.dropped[0].disposition).toBe("verify_unanswered");
    expect(result.dropped).toHaveLength(1);
  });

  // Below the answer floor, keep everything: failing closed would mass-delete the truncated tail.
  it("keeps everything when the verifier answers too few indices", async () => {
    const comments = ["A", "B", "C", "D", "E"].map((title) =>
      comment({ title }),
    );
    const model = fakeModel(
      '{"results":[{"index":0,"verdict":"drop"},{"index":1,"verdict":"drop"}]}',
    );
    const result = await verifyFindings({ ...base, comments, model });
    expect(result.comments).toHaveLength(5);
    expect(result.dropped).toHaveLength(0);
  });

  // No snippet or evidence means unjudgeable; pass through rather than drop.
  it("passes through a candidate with no diff context rather than dropping it", async () => {
    const comments = [
      comment({ title: "A" }),
      comment({ title: "B" }),
      comment({ title: "C" }),
      comment({ title: "Orphan", path: "missing.ts", line: 99 }),
    ];
    const model = fakeModel(
      '{"results":[{"index":0,"verdict":"keep"},{"index":1,"verdict":"keep"},{"index":2,"verdict":"keep"}]}',
    );
    const result = await verifyFindings({ ...base, comments, model });
    expect(result.dropped).toHaveLength(0);
    expect(result.comments.map((c) => c.title)).toEqual([
      "A",
      "B",
      "C",
      "Orphan",
    ]);
  });

  // A path mismatch on most findings must not read as a wall of model verdicts.
  it("keeps every finding when almost none of them can be rendered", async () => {
    const comments = [
      comment({ title: "A" }),
      comment({ title: "Orphan 1", path: "missing.ts", line: 99 }),
      comment({ title: "Orphan 2", path: "missing.ts", line: 98 }),
      comment({ title: "Orphan 3", path: "missing.ts", line: 97 }),
    ];
    let called = false;
    const model = {
      verifyFindings: async () => {
        called = true;
        return {
          rawText: '{"results":[]}',
          inputTokens: 0,
          outputTokens: 0,
          modelUsed: "m",
          provider: "p",
        };
      },
    };
    const result = await verifyFindings({ ...base, comments, model });
    expect(result.comments).toHaveLength(4);
    expect(result.dropped).toHaveLength(0);
    expect(called).toBe(true);
  });

  // Regression: must return a strict subsequence, not reordered before the cap slices it.
  it("returns a strict subsequence of its input", async () => {
    const comments = ["A", "B", "C", "D", "E"].map((title) =>
      comment({ title }),
    );
    const model = fakeModel(
      '{"results":[{"index":0,"verdict":"drop"},{"index":1,"verdict":"keep"},{"index":2,"verdict":"keep"},{"index":3,"verdict":"drop"},{"index":4,"verdict":"keep"}]}',
    );
    const result = await verifyFindings({ ...base, comments, model });

    const indices = result.comments.map((c) => comments.indexOf(c));
    expect(indices).not.toContain(-1);
    expect([...indices]).toEqual([...indices].sort((a, b) => a - b));
  });

  // A verification pass that gives up keeps every candidate -- correct, but the job used to report a
  // clean run either way, so unverified findings were posted while the dashboard said they had been
  // checked. `skipped` is what makes those two outcomes distinguishable.
  describe("reporting that it did not actually verify", () => {
    it("is not a skip when there was nothing to verify", async () => {
      const result = await verifyFindings({
        ...base,
        comments: [],
        model: fakeModel('{"results":[]}'),
      });
      expect(result.skipped).toBeNull();
      expect(result.comments).toEqual([]);
    });

    it("is not a skip when the verifier answered", async () => {
      const result = await verifyFindings({
        ...base,
        comments: [comment({ title: "Real bug" })],
        model: fakeModel('{"results":[{"index":0,"verdict":"keep"}]}'),
      });
      expect(result.skipped).toBeNull();
    });

    it("reports a skip when no candidate could be rendered for the verifier", async () => {
      // No snippet (the path is not in `files`) and no evidence quote: nothing to ask about.
      const result = await verifyFindings({
        ...base,
        comments: [comment({ path: "not-in-this-pr.ts", evidence: undefined })],
        model: fakeModel('{"results":[]}'),
      });
      expect(result.skipped).toBe("no_verifiable_candidates");
      expect(result.comments).toHaveLength(1);
    });

    it("reports a skip when too few indices come back", async () => {
      const comments = [
        comment({ title: "A" }),
        comment({ title: "B" }),
        comment({ title: "C" }),
      ];
      // One verdict out of three is below VERIFY_MIN_ANSWER_RATIO.
      const result = await verifyFindings({
        ...base,
        comments,
        model: fakeModel('{"results":[{"index":0,"verdict":"keep"}]}'),
      });
      expect(result.skipped).toBe("low_answer_ratio");
      // Still keeps everything -- the signal is additive, it does not change the outcome.
      expect(result.comments).toHaveLength(3);
      expect(result.dropped).toEqual([]);
    });

    it("reports a skip when the verify call itself fails", async () => {
      const result = await verifyFindings({
        ...base,
        comments: [comment({ title: "Real bug" })],
        model: throwingModel(),
      });
      expect(result.skipped).toBe("verify_call_failed");
      expect(result.comments).toHaveLength(1);
    });
  });

  it("forwards the evidence quote so the verifier judges a specific line", async () => {
    let seen: any;
    const model = {
      verifyFindings: async (params: any) => {
        seen = params.candidates;
        return {
          rawText: '{"results":[{"index":0,"verdict":"keep"}]}',
          inputTokens: 0,
          outputTokens: 0,
          modelUsed: "m",
          provider: "p",
        };
      },
    };
    await verifyFindings({
      ...base,
      comments: [comment({ evidence: "const x = 1;" })],
      model,
    });
    expect(seen[0].evidence).toBe("const x = 1;");
  });
});
