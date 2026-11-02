import { describe, expect, it } from "vitest";
import { FormatterService } from "@codraoss/core/formatter";

// The overview used to open with "Here are some automated review suggestions for this pull request"
// whether or not there were any, so a clean pass read like a failed one.
describe("formatReviewOverview", () => {
  const formatter = new FormatterService("https://app.example.dev");
  const overview = (
    over: Partial<Parameters<typeof formatter.formatReviewOverview>[0]> = {},
  ) =>
    formatter.formatReviewOverview({
      commitSha: "4fcf9d3760aaaabbbb",
      postedFindings: 0,
      filesReviewed: 42,
      linesReviewed: 1898,
      withheldFindings: 0,
      filesFailed: 0,
      ...over,
    });

  it("says nothing was found when nothing was posted", () => {
    const body = overview();

    expect(body).toContain("Nothing to flag");
    expect(body).toContain("42 files");
    expect(body).toContain("1898 changed lines");
    // The old wording promised suggestions that were not there.
    expect(body).not.toContain("automated review suggestions");
  });

  it("keeps the original suggestions wording when findings were posted", () => {
    const body = overview({ postedFindings: 5 });

    expect(body).toContain(
      "Here are some automated review suggestions for this pull request.",
    );
    expect(body).not.toContain("Nothing to flag");
  });

  it("keeps the header, commit and about-section in both cases", () => {
    for (const posted of [0, 3]) {
      const body = overview({ postedFindings: posted });
      expect(body.startsWith("### Codra Review")).toBe(true);
      // Ten characters, not the full 40 -- the PR body should stay readable.
      expect(body).toContain("`4fcf9d3760`");
      expect(body).toContain("About Codra in GitHub");
    }
  });

  it("does not advertise the mention triggers", () => {
    for (const posted of [0, 3]) {
      const body = overview({ postedFindings: posted });
      expect(body).not.toContain('review"');
      expect(body).not.toContain("address that feedback");
    }
  });

  it("describes the thumbs-up as accompanying the summary on a clean pass", () => {
    const body = overview();

    expect(body).toContain("👍");
    // The old wording made comment and reaction alternatives; a clean pass now does both.
    expect(body).not.toContain("otherwise it will react");
  });

  it("keeps the original comment-or-react wording when findings were posted", () => {
    const body = overview({ postedFindings: 2 });

    expect(body).toContain(
      "If Codra has suggestions, it will comment; otherwise it will react with 👍.",
    );
  });

  // "No issues" is a weaker claim when candidates were dropped for failing to ground themselves.
  it("admits when a clean result had candidates dropped by the gates", () => {
    const body = overview({ withheldFindings: 3 });

    expect(body).toContain("3 candidates did not survive");
    expect(body).toContain("dashboard");
  });

  it("does not mention dropped candidates when findings were posted anyway", () => {
    const body = overview({ postedFindings: 2, withheldFindings: 3 });

    expect(body).not.toContain("did not survive");
  });

  it("flags an incomplete pass when files failed to review", () => {
    const body = overview({ filesFailed: 2 });

    expect(body).toContain("2 files could not be reviewed");
    expect(body).toContain("incomplete");
  });

  it("gets singular and plural right", () => {
    const one = overview({
      filesReviewed: 1,
      linesReviewed: 1,
      filesFailed: 1,
    });

    expect(one).toContain("Reviewed 1 file (1 changed line)");
    expect(one).toContain("1 file could not be reviewed");
    expect(one).not.toContain("1 files");
    expect(one).not.toContain("1 changed lines");
  });
});
