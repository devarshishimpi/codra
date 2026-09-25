import type { FileReviewRecord } from "@codraoss/schema";

// Bin membership is never persisted (pack.ts derives it rather than storing it). But every file in
// a bin is written with the SAME shared response, so grouping on `rawAiOutput` reconstructs the bins
// exactly. Two different bins producing byte-identical JSON is not a real possibility: the payload
// names each file it covers.
export type BatchGroup = { index: number; paths: string[] };

export function groupBatches(
  files: FileReviewRecord[],
): Map<string, BatchGroup> {
  const byResponse = new Map<string, BatchGroup>();

  for (const file of files) {
    // 1 means reviewed alone, null predates batching, and a failed row has no response to group on.
    if ((file.batchSize ?? 1) <= 1 || !file.rawAiOutput) continue;
    const existing = byResponse.get(file.rawAiOutput);
    if (existing) existing.paths.push(file.filePath);
    else
      byResponse.set(file.rawAiOutput, {
        index: byResponse.size + 1,
        paths: [file.filePath],
      });
  }

  // Re-keyed by path, because a row only knows its own identity.
  const byPath = new Map<string, BatchGroup>();
  for (const group of byResponse.values()) {
    for (const path of group.paths) byPath.set(path, group);
  }
  return byPath;
}
