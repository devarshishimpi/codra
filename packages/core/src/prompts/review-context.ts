import type { FileDiff } from "../diff";
import { isChangelogPath } from "./languages";
import {
  CHANGELOG_EXCERPT_CHARS,
  FILE_CONTEXT_CHAR_BUDGET,
  FILE_CONTEXT_WINDOW_LINES,
  FRAGMENTED_HUNK_THRESHOLD,
  FRAGMENTED_MIN_LINES,
  PACKABLE_MAX_DIFF_LINES,
  PR_DESCRIPTION_CHARS,
} from "../constants";

// Prompt blocks that surround a diff: what the change is for, and what the rest of the file looks like.

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

// Must avoid the `===== FILE ` delimiter and lines starting `Language: `: the batch prompt splits on those.
export function renderIntentBlock(input: {
  prTitle: string | null;
  prDescription: string | null;
  changelogExcerpt?: string | null;
}): string {
  const description = input.prDescription?.trim();
  const changelog = input.changelogExcerpt?.trim();

  return [
    "## PR INTENT (what the author set out to do)",
    `Title: ${input.prTitle ?? "Untitled PR"}`,
    ...(description
      ? ["Description:", clip(description, PR_DESCRIPTION_CHARS)]
      : []),
    ...(changelog
      ? [
          "Changelog lines added by this PR:",
          clip(changelog, CHANGELOG_EXCERPT_CHARS),
        ]
      : []),
    "Behaviour that serves this stated intent is deliberate. Do not report it as an accident, an oversight, or a regression.",
  ].join("\n");
}

export function changelogExcerptFromDiff(
  files: readonly FileDiff[],
): string | null {
  const added: string[] = [];
  let used = 0;

  for (const file of files) {
    if (!isChangelogPath(file.path)) continue;
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.kind !== "add") continue;
        const text = line.content.trim();
        if (!text) continue;
        if (used + text.length > CHANGELOG_EXCERPT_CHARS) {
          return added.length > 0 ? added.join("\n") : null;
        }
        added.push(text);
        used += text.length + 1;
      }
    }
  }

  return added.length > 0 ? added.join("\n") : null;
}

export function wantsFileContext(
  file: Pick<FileDiff, "lineCount" | "isNew" | "isDeleted" | "isBinary"> & {
    hunks?: FileDiff["hunks"];
  },
  fullFileContext: boolean,
  gate: { compactPrompt?: boolean } = {},
): boolean {
  if (!fullFileContext) return false;
  if (gate.compactPrompt) return false;
  if (file.isNew || file.isDeleted || file.isBinary) return false;
  if (file.lineCount > PACKABLE_MAX_DIFF_LINES) return true;

  // Must stay in step with `planReviewUnits`: a promoted file given no context wastes a model call.
  return (
    (file.hunks?.length ?? 0) >= FRAGMENTED_HUNK_THRESHOLD &&
    file.lineCount >= FRAGMENTED_MIN_LINES
  );
}

// Windowed per chunk's own hunks so a chunked file doesn't repeat the whole block MAX_CHUNKS times.
export function renderFileContext(
  file: FileDiff,
  content: string,
): string | null {
  const lines = content.split("\n");

  let lowest = Number.POSITIVE_INFINITY;
  let highest = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (typeof line.newLineNumber !== "number") continue;
      lowest = Math.min(lowest, line.newLineNumber);
      highest = Math.max(highest, line.newLineNumber);
    }
  }
  if (!Number.isFinite(lowest)) return null;

  const start = Math.max(1, lowest - FILE_CONTEXT_WINDOW_LINES);
  const end = Math.min(lines.length, highest + FILE_CONTEXT_WINDOW_LINES);

  const numbered: string[] = [];
  let used = 0;
  for (let n = start; n <= end; n++) {
    const rendered = `${n}\t${lines[n - 1] ?? ""}`;
    if (used + rendered.length > FILE_CONTEXT_CHAR_BUDGET) break;
    numbered.push(rendered);
    used += rendered.length + 1;
  }
  if (numbered.length === 0) return null;

  const last = start + numbered.length - 1;
  const partial = start > 1 || last < lines.length;
  return [
    `Full file after the change, lines ${start}-${last}${partial ? ` of ${lines.length}` : ""} (CONTEXT ONLY, not reviewable):`,
    ...numbered,
  ].join("\n");
}

export const INTENT_CHECK_INSTRUCTION =
  "Intent check: every finding must survive a comparison with the PR INTENT above. If what you are about to flag IS the stated intent, it is not a finding - drop it. Otherwise open the `body` with one line saying how the problem differs from what the author set out to do.";
