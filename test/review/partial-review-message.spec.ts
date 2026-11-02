import { describe, expect, it } from "vitest";
import { partialReviewMessage } from "../../packages/core/src/review/finalize";

// A review can fall short of the pull request two ways: files that failed, and files the limits never
// took. Only the first was ever reported, and the second used to be visible only in the PR comment
// that no longer carries it -- so a 250-file pull request reviewed 25 and reported plain success.
describe("partialReviewMessage", () => {
  it("says nothing when the whole diff was reviewed", () => {
    expect(
      partialReviewMessage({
        failedFileCount: 0,
        reviewedFileCount: 12,
        filesOverCap: 0,
      }),
    ).toBeNull();
  });

  it("reports files that failed to review", () => {
    const message = partialReviewMessage({
      failedFileCount: 1,
      reviewedFileCount: 2,
      filesOverCap: 0,
    });

    expect(message).toBe("Partial review: 1 of 2 files could not be reviewed.");
  });

  it("reports files the limits left out", () => {
    const message = partialReviewMessage({
      failedFileCount: 0,
      reviewedFileCount: 25,
      filesOverCap: 225,
    });

    expect(message).toContain(
      "225 files left out by the file and diff-size limits",
    );
    expect(message).toMatch(/^Partial review: /);
  });

  it("reports both causes when both apply", () => {
    const message = partialReviewMessage({
      failedFileCount: 2,
      reviewedFileCount: 25,
      filesOverCap: 225,
    });

    expect(message).toContain("2 of 25 files could not be reviewed");
    expect(message).toContain("225 files left out");
  });

  it("gets singulars right", () => {
    expect(
      partialReviewMessage({
        failedFileCount: 1,
        reviewedFileCount: 1,
        filesOverCap: 1,
      }),
    ).toBe(
      "Partial review: 1 of 1 file could not be reviewed; 1 file left out by the file and diff-size limits.",
    );
  });
});
