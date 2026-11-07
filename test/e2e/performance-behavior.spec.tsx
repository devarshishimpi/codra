/**
 * @vitest-environment jsdom
 */
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { usePolling } from "@client/hooks/use-polling";
import { isJsonWithinBudget } from "@client/lib/json-size";
import {
  isDiffsCacheFresh,
  readDiffsCache,
  writeDiffsCache,
} from "@client/lib/diffs-cache";
import { FileDiff } from "@client/components/features/job-detail/diff-file-panel";
import { FileReviewList } from "@client/components/features/job-logs/file-review-list";

describe("performance safeguards", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("waits for each poll to finish before scheduling the next one", async () => {
    let finishFirst!: () => void;
    const firstRequest = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const callback = vi
      .fn<() => Promise<void> | void>()
      .mockReturnValueOnce(firstRequest)
      .mockReturnValue(undefined);

    const { unmount } = renderHook(() => usePolling(callback, 1_000));
    expect(callback).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    expect(callback).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishFirst();
      await firstRequest;
    });
    await act(async () => {
      vi.advanceTimersByTime(999);
    });
    expect(callback).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(callback).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("pauses polling while hidden and refreshes when visible again", async () => {
    let visibility: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
    const callback = vi.fn();
    const { unmount } = renderHook(() => usePolling(callback, 1_000));
    expect(callback).toHaveBeenCalledTimes(1);

    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });
    expect(callback).toHaveBeenCalledTimes(1);

    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(callback).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("stores fresh diff-cache entries and treats legacy entries as stale", () => {
    writeDiffsCache("job-1", { "src/a.ts": "diff" });
    const entry = readDiffsCache("job-1");
    expect(entry?.diffs["src/a.ts"]).toBe("diff");
    expect(isDiffsCacheFresh(entry)).toBe(true);

    sessionStorage.setItem("codra:job-diffs:legacy", JSON.stringify({ a: "old" }));
    const legacy = readDiffsCache("legacy");
    expect(legacy?.diffs).toEqual({ a: "old" });
    expect(isDiffsCacheFresh(legacy)).toBe(false);
  });

  it("rejects oversized JSON before constructing a serialized copy", () => {
    expect(isJsonWithinBudget({ diffs: { a: "x".repeat(400_000) } }, 2_000_000)).toBe(
      false,
    );
    writeDiffsCache("large", { a: "x".repeat(400_000) });
    expect(sessionStorage.getItem("codra:job-diffs:large")).toBeNull();
  });

  it("keeps large expanded diffs to the viewport plus overscan", () => {
    const lines = Array.from({ length: 700 }, (_, index) => `+const line${index} = ${index};`);
    const file = {
      id: "file-1",
      jobId: "job-1",
      filePath: "src/large.ts",
      fileStatus: "done",
      modelUsed: "",
      diffLineCount: 700,
      diffInput: `@@ -1,700 +1,700 @@\n${lines.join("\n")}`,
      rawAiOutput: null,
      parsedComments: [],
      inputTokens: null,
      outputTokens: null,
      durationMs: null,
      verdict: null,
      fileSummary: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
    } as any;

    render(
      <FileDiff
        file={file}
        open
        viewed={false}
        onOpenChange={vi.fn()}
        onToggleViewed={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show full diff" }));
    const region = screen.getByRole("region", { name: "Diff lines" });
    const renderedLines = region.querySelectorAll(".diff-add").length;
    expect(renderedLines).toBeGreaterThan(0);
    expect(renderedLines).toBeLessThan(100);
  });

  it("renders large job log lists in bounded batches", () => {
    const files = Array.from({ length: 260 }, (_, index) => ({
      id: `file-${index}`,
      jobId: "job-1",
      filePath: `src/file-${index}.ts`,
      fileStatus: "pending",
      modelUsed: "",
      diffLineCount: null,
      diffInput: "",
      rawAiOutput: null,
      parsedComments: [],
      inputTokens: null,
      outputTokens: null,
      durationMs: null,
      verdict: null,
      fileSummary: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
    })) as any;
    const { container } = render(
      <FileReviewList
        jobId="job-1"
        files={files}
        diffsLoading={false}
        batches={new Map()}
      />,
    );

    expect(container.querySelectorAll("details")).toHaveLength(100);
    fireEvent.click(screen.getByRole("button", { name: "Show 100 more files" }));
    expect(container.querySelectorAll("details")).toHaveLength(200);
    fireEvent.click(screen.getByRole("button", { name: "Show 60 more files" }));
    expect(container.querySelectorAll("details")).toHaveLength(260);
    expect(screen.queryByRole("button", { name: /show .* more files/i })).toBeNull();
  });
});
