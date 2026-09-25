import type { CSSProperties } from "react";
import type { DiffRow } from "@codraoss/ui/prompt-diff";
import type { ParsedReviewComment } from "@codraoss/schema";

export const LARGE_DIFF_ROWS = 300;

// Longer diffs render only the first PREVIEW_ROWS lines behind a "Show full diff" control, so a huge
// PR never dumps tens of thousands of rows into the DOM. Files with comments are never truncated.
export const PREVIEW_ROWS = 150;

// Estimated row height, used to size a panel before it first paints.
export const DIFF_ROW_PX = 20;

// Offscreen panels skip layout/paint; this placeholder height keeps the scrollbar and page height
// stable instead of the page "growing" as panels come into view.
export function panelCvStyle(
  open: boolean,
  lineEstimate: number,
): CSSProperties {
  const body = open
    ? Math.min(lineEstimate, PREVIEW_ROWS) * DIFF_ROW_PX + 140
    : 0;
  return {
    contentVisibility: "auto",
    containIntrinsicSize: `auto ${46 + body}px`,
  };
}

export function fileAnchorId(id: string) {
  return `diff-file-${id}`;
}

export const ROW_TONES: Record<
  DiffRow["kind"],
  { row: string; gutter: string; marker: string }
> = {
  add: { row: "diff-add", gutter: "diff-add-fg", marker: "diff-add-fg" },
  del: { row: "diff-del", gutter: "diff-del-fg", marker: "diff-del-fg" },
  ctx: { row: "", gutter: "text-ui-subtle/60", marker: "text-transparent" },
  hunk: { row: "ui-well", gutter: "", marker: "" },
};

export const NO_ROWS: DiffRow[] = [];

/** Row identity: the embedded line numbers, plus the text so hunk headers (which have none) differ. */
export function rowKey(row: DiffRow) {
  return `${row.kind}:${row.oldNo ?? ""}:${row.newNo ?? ""}:${row.text}`;
}

// The (path, line, title) triple `fingerprint` hashes, plus the position within the rendered list.
// The triple alone is not unique: `parsedComments` is the ungated set, so a model that reports the
// same finding twice on one line keeps both rows, and duplicate React keys drop siblings.
export function commentKey(comment: ParsedReviewComment, index: number) {
  return `${comment.path}:${comment.line ?? ""}:${comment.title}#${index}`;
}
