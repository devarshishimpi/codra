import { useMemo } from "react";
import { highlightLine, langForPath } from "@codraoss/ui/highlight";
import { cn } from "@codraoss/ui/utils";
import { ROW_TONES } from "./diff-file-panel-utils";

/**
 * The stored diff context of a finding, rendered like the diff viewer: gutter, +/- marker and
 * syntax-highlighted code. Lines arrive from renderDiffSnippet as `%4d <prefix><content>`.
 */

const SNIPPET_LINE = /^(\s*\d*) ([+\- ])(.*)$/;

type SnippetRow = { gutter: string; kind: "add" | "del" | "ctx"; text: string };

function parseSnippet(snippet: string): SnippetRow[] {
  return snippet.split("\n").map((line) => {
    const match = SNIPPET_LINE.exec(line);
    // Anything that doesn't fit the server's shape renders verbatim as a context line.
    if (!match) return { gutter: "", kind: "ctx" as const, text: line };
    const [, gutter, prefix, text] = match;
    return {
      gutter: gutter.trim(),
      kind:
        prefix === "+"
          ? ("add" as const)
          : prefix === "-"
            ? ("del" as const)
            : ("ctx" as const),
      text,
    };
  });
}

export function ContextSnippet({
  snippet,
  filePath,
}: {
  snippet: string;
  filePath: string;
}) {
  const lang = useMemo(() => langForPath(filePath), [filePath]);
  const rows = useMemo(() => parseSnippet(snippet), [snippet]);

  return (
    <div
      className="thin-scroll mt-2 overflow-x-auto rounded-md border py-1.5"
      style={{
        background: "var(--code-bg)",
        borderColor: "var(--code-border)",
        color: "var(--code-fg)",
      }}
    >
      <div className="min-w-fit">
        {rows.map((row, i) => {
          const tone = ROW_TONES[row.kind];
          return (
            <div key={i} className={cn("flex", tone.row)}>
              <span
                className={cn(
                  "ui-font-mono w-[44px] shrink-0 select-none px-2 text-right text-[11px] leading-5 tabular-nums",
                  tone.gutter,
                )}
              >
                {row.gutter}
              </span>
              <span
                className={cn(
                  "ui-font-mono w-4 shrink-0 select-none text-center text-[11px] leading-5",
                  tone.marker,
                )}
              >
                {row.kind === "add" ? "+" : row.kind === "del" ? "-" : " "}
              </span>
              <span className="ui-font-mono whitespace-pre pr-4 text-[11px] leading-5">
                {highlightLine(row.text, lang)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
