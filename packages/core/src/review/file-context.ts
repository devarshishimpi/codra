import type { FileDiff } from "../diff";
import type { ReviewGitProvider } from "../ports";
import { logger } from "../logger";

const VALIDATION_SAMPLES = 5;

export function contentMatchesDiff(file: FileDiff, content: string): boolean {
  const lines = content.split("\n");
  const samples: Array<{ newLineNumber: number; content: string }> = [];

  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === "del" || typeof line.newLineNumber !== "number")
        continue;
      if (!line.content.trim()) continue;
      samples.push({
        newLineNumber: line.newLineNumber,
        content: line.content,
      });
    }
  }
  if (samples.length === 0) return false;

  const step = Math.max(1, Math.floor(samples.length / VALIDATION_SAMPLES));
  for (let i = 0; i < samples.length; i += step) {
    const sample = samples[i];
    if (lines[sample.newLineNumber - 1] !== sample.content) return false;
  }
  return true;
}

export async function loadFileContext(
  github: Pick<ReviewGitProvider, "getRepoFile">,
  job: { owner: string; repo: string; commitSha: string },
  file: FileDiff,
  onFetch?: () => void,
): Promise<string | null> {
  if (!github.getRepoFile) return null;

  let content: string | null;
  try {
    onFetch?.();
    content = await github.getRepoFile(
      job.owner,
      job.repo,
      file.path,
      job.commitSha,
    );
  } catch (error) {
    logger.warn(
      `Could not fetch file content for ${file.path}; reviewing the diff alone`,
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return null;
  }

  if (!content) return null;
  if (!contentMatchesDiff(file, content)) {
    logger.warn(
      `Fetched content for ${file.path} does not line up with the diff; reviewing the diff alone`,
      {
        commitSha: job.commitSha,
      },
    );
    return null;
  }
  return content;
}
