import { renderFileDiff } from "../prompts/file-review";
import type { FileDiff } from "../diff";
import {
  PACKABLE_MAX_DIFF_LINES,
  BIN_TARGET_DIFF_LINES,
  BIN_MAX_FILES,
  BIN_DIFF_CHAR_BUDGET,
  FRAGMENTED_HUNK_THRESHOLD,
  FRAGMENTED_MIN_LINES,
} from "../constants";

export type ReviewUnit =
  | { kind: "single"; file: FileDiff }
  | {
      kind: "bin";
      files: FileDiff[];
      diffLineCount: number;
      diffChars: number;
    };

export type LedgerEntry = { handled: boolean; transientErrorCount: number };

export function unitFiles(unit: ReviewUnit): FileDiff[] {
  return unit.kind === "single" ? [unit.file] : unit.files;
}

const measure = (file: FileDiff) => renderFileDiff(file).length;

/** Changes scattered thinly across a file rather than concentrated in one place. */
export function isFragmented(file: FileDiff): boolean {
  return (
    file.hunks.length >= FRAGMENTED_HUNK_THRESHOLD &&
    file.lineCount >= FRAGMENTED_MIN_LINES &&
    !file.isNew
  );
}

const asBin = (files: FileDiff[]): ReviewUnit =>
  files.length === 1
    ? { kind: "single", file: files[0] }
    : {
        kind: "bin",
        files,
        diffLineCount: files.reduce((sum, f) => sum + f.lineCount, 0),
        diffChars: files.reduce((sum, f) => sum + measure(f), 0),
      };

export function planReviewUnits(
  files: readonly FileDiff[],
  opts: { enabled: boolean; fullFileContext?: boolean },
): ReviewUnit[] {
  if (!opts.enabled) return files.map((file) => ({ kind: "single", file }));

  const units: ReviewUnit[] = [];
  let open: FileDiff[] = [];
  let lines = 0;
  let chars = 0;

  const close = () => {
    if (open.length > 0) units.push(asBin(open));
    open = [];
    lines = 0;
    chars = 0;
  };

  for (const file of files) {
    const fileChars = measure(file);
    const promoteForContext =
      opts.fullFileContext === true && isFragmented(file);
    if (
      promoteForContext ||
      file.lineCount > PACKABLE_MAX_DIFF_LINES ||
      fileChars > BIN_DIFF_CHAR_BUDGET
    ) {
      close();
      units.push({ kind: "single", file });
      continue;
    }

    if (
      open.length > 0 &&
      (lines + file.lineCount > BIN_TARGET_DIFF_LINES ||
        chars + fileChars > BIN_DIFF_CHAR_BUDGET ||
        open.length >= BIN_MAX_FILES)
    )
      close();

    open.push(file);
    lines += file.lineCount;
    chars += fileChars;
  }

  close();
  return units;
}

export function narrowUnit(
  unit: ReviewUnit,
  ledger: Map<string, LedgerEntry>,
): ReviewUnit[] {
  const outstanding = unitFiles(unit).filter(
    (file) => !ledger.get(file.path)?.handled,
  );
  if (outstanding.length === 0) return [];

  const failedBefore = outstanding.some(
    (file) => (ledger.get(file.path)?.transientErrorCount ?? 0) > 0,
  );
  if (failedBefore)
    return outstanding.map((file): ReviewUnit => ({ kind: "single", file }));

  return [asBin(outstanding)];
}
