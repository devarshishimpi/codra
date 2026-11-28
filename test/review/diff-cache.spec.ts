import { getDiffFiles, getIncrementalDiffFiles } from "@server/core/review";
import { defaultRepoConfig } from "@codraoss/schema";
import { vi } from "vitest";

function fileDiff(path: string, line = "const a = 1;") {
  return `diff --git a/${path} b/${path}
index 1111111..2222222 100644
--- a/${path}
+++ b/${path}
@@ -1,1 +1,2 @@
 const a = 0;
+${line}
`;
}

function makeKv(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(
      async (
        key: string,
        value: string,
        _options?: { expirationTtl?: number },
      ) => {
        store.set(key, value);
      },
    ),
  };
}

const DIFF_CACHE_TTL_SECONDS = 6 * 60 * 60;
const job = { id: "job-1", owner: "acme", repo: "widgets" };
const config = defaultRepoConfig;

describe("getIncrementalDiffFiles", () => {
  it("fetches the compare diff between the two SHAs and returns only those files", async () => {
    const kv = makeKv();
    const github = {
      getCompareDiff: vi.fn(async () => fileDiff("src/new-change.ts")),
    };

    const result = await getIncrementalDiffFiles(
      { kv },
      job,
      github,
      config,
      "aaa111",
      "bbb222",
    );

    expect(github.getCompareDiff).toHaveBeenCalledWith(
      "acme",
      "widgets",
      "aaa111",
      "bbb222",
    );
    expect(result.files.map((file) => file.path)).toEqual([
      "src/new-change.ts",
    ]);
    expect(result.skipped).toBe(0);
  });

  it("applies the same reviewable-file filtering as the full diff path", async () => {
    const raw = [
      fileDiff("src/keep.ts"),
      fileDiff("package-lock.json", '"x": 1'),
      fileDiff("docs/skipped.md", "text"),
    ].join("");
    const customConfig = {
      ...config,
      review: { ...config.review, skip_files: ["docs/**"] },
    };

    const incremental = await getIncrementalDiffFiles(
      { kv: makeKv() },
      job,
      { getCompareDiff: vi.fn(async () => raw) },
      customConfig,
      "aaa111",
      "bbb222",
    );
    const full = await getDiffFiles(
      { kv: makeKv() },
      { ...job, prNumber: 7 },
      { getPullRequestDiff: vi.fn(async () => raw) },
      customConfig,
    );

    expect(incremental.files.map((file) => file.path)).toEqual(["src/keep.ts"]);
    expect(incremental).toEqual(full);
  });

  it("honours maxFiles", async () => {
    const raw = [fileDiff("src/a.ts"), fileDiff("src/b.ts")].join("");

    const result = await getIncrementalDiffFiles(
      { kv: makeKv() },
      job,
      { getCompareDiff: vi.fn(async () => raw) },
      config,
      "aaa111",
      "bbb222",
      1,
    );

    expect(result.files).toHaveLength(1);
  });

  it("caches the raw diff with the shared TTL and reuses it on the next call", async () => {
    const kv = makeKv();
    const github = {
      getCompareDiff: vi.fn(async () => fileDiff("src/cached.ts")),
    };
    const key = "diff:job-1:aaa111..bbb222";

    await getIncrementalDiffFiles(
      { kv },
      job,
      github,
      config,
      "aaa111",
      "bbb222",
    );
    expect(kv.put).toHaveBeenCalledWith(key, fileDiff("src/cached.ts"), {
      expirationTtl: DIFF_CACHE_TTL_SECONDS,
    });

    const again = await getIncrementalDiffFiles(
      { kv },
      job,
      github,
      config,
      "aaa111",
      "bbb222",
    );
    expect(github.getCompareDiff).toHaveBeenCalledTimes(1);
    expect(again.files.map((file) => file.path)).toEqual(["src/cached.ts"]);
  });

  it("does not share a cache entry with the full PR diff or with another SHA range", async () => {
    const fullKey = `diff:${job.id}`;
    const kv = makeKv({ [fullKey]: fileDiff("src/full-pr-only.ts") });
    const github = {
      getCompareDiff: vi.fn(async () => fileDiff("src/incremental.ts")),
    };

    const first = await getIncrementalDiffFiles(
      { kv },
      job,
      github,
      config,
      "aaa111",
      "bbb222",
    );
    expect(first.files.map((file) => file.path)).toEqual([
      "src/incremental.ts",
    ]);

    await getIncrementalDiffFiles(
      { kv },
      job,
      github,
      config,
      "bbb222",
      "ccc333",
    );
    expect(github.getCompareDiff).toHaveBeenCalledTimes(2);
    expect(kv.store.get(fullKey)).toBe(fileDiff("src/full-pr-only.ts"));
  });

  it("still returns the files when the cache write fails", async () => {
    const kv = makeKv();
    kv.put.mockRejectedValueOnce(new Error("kv unavailable"));

    const result = await getIncrementalDiffFiles(
      { kv },
      job,
      { getCompareDiff: vi.fn(async () => fileDiff("src/ok.ts")) },
      config,
      "aaa111",
      "bbb222",
    );

    expect(result.files.map((file) => file.path)).toEqual(["src/ok.ts"]);
  });
});
