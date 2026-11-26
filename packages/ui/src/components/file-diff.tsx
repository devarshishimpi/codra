import { memo, useMemo, type CSSProperties } from "react";
import { CopyButton } from "./copy-button";
import { highlightLine, langForPath } from "../lib/highlight";
import { cn } from "../lib/utils";
import {
  normalizeRows,
  parseDiffText,
  tokenize,
  type DiffRowInput,
  type FileDiffRow,
} from "../lib/file-diff-parser";

export { parseDiffText, tokenize, type DiffRowInput, type FileDiffRow };

export interface FileDiffProps {
  file?: string;
  rows?: DiffRowInput[];
  diff?: string;
  copyable?: boolean;
  className?: string;
  style?: CSSProperties;
  maxHeight?: number | string;
}

export const FileDiff = memo(function FileDiff({
  file,
  rows: initialRows,
  diff,
  copyable = false,
  className,
  style,
  maxHeight,
}: FileDiffProps) {
  const { file: detectedFile, normalized: rows } = useMemo(
    () => normalizeRows(initialRows, diff),
    [initialRows, diff],
  );

  const displayFile = file || detectedFile || "src/auth.ts";
  const lang = useMemo(() => langForPath(displayFile), [displayFile]);

  const added = useMemo(() => rows.filter((r) => r.type === "add").length, [rows]);
  const removed = useMemo(() => rows.filter((r) => r.type === "del").length, [rows]);

  const fullText = useMemo(() => {
    if (diff) return diff;
    return rows
      .map((r) => {
        const prefix = r.type === "add" ? "+" : r.type === "del" ? "-" : " ";
        return `${prefix}${r.text}`;
      })
      .join("\n");
  }, [diff, rows]);

  return (
    <div className={cn("aicss-diff", className)} style={style}>
      <div className="aicss-diff-head">
        <span className="aicss-diff-file-wrap" title={displayFile}>
          <svg
            className="aicss-diff-icon"
            viewBox="0 0 24 24"
            width="15"
            height="15"
            aria-hidden="true"
          >
            <path
              d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="aicss-diff-file">{displayFile}</span>
        </span>
        <span className="aicss-diff-stat">
          <span className="aicss-diff-add">+{added}</span>
          <span className="aicss-diff-del">-{removed}</span>
        </span>
        {copyable && (
          <span className="aicss-diff-actions">
            <CopyButton value={fullText} label="Copy diff" />
          </span>
        )}
      </div>

      <div
        className="aicss-diff-body"
        style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}
      >
        <div className="aicss-diff-lines">
          {rows.map((r, i) => {
            if (r.type === "hunk") {
              return (
                <div key={i} className="aicss-diff-row hunk">
                  <span className="aicss-diff-ln old" />
                  <span className="aicss-diff-ln new" />
                  <span className="aicss-diff-sign" />
                  <code>{r.text}</code>
                </div>
              );
            }

            return (
              <div key={i} className={cn("aicss-diff-row", r.type)}>
                <span className="aicss-diff-ln old">{r.old ?? ""}</span>
                <span className="aicss-diff-ln new">{r.cur ?? ""}</span>
                <span className="aicss-diff-sign">
                  {r.type === "add" ? "+" : r.type === "del" ? "-" : ""}
                </span>
                <code>
                  {lang ? (
                    highlightLine(r.text, lang)
                  ) : (
                    tokenize(r.text).map((tok, j) => (
                      <span
                        key={j}
                        className={tok.t === "txt" ? undefined : tok.t}
                      >
                        {tok.v}
                      </span>
                    ))
                  )}
                </code>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
