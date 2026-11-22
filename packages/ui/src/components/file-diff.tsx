import { memo, useMemo, type CSSProperties } from "react";
import { CopyButton } from "./copy-button";
import { highlightLine, langForPath } from "../lib/highlight";
import { cn } from "../lib/utils";

export interface FileDiffRow {
  old?: number | null;
  cur?: number | null;
  type: "add" | "del" | "ctx" | "hunk";
  text: string;
}

export type DiffRowInput =
  | FileDiffRow
  | {
      oldNo?: number | null;
      newNo?: number | null;
      kind?: "add" | "del" | "ctx" | "hunk";
      text: string;
    };

export interface FileDiffProps {
  file?: string;
  rows?: DiffRowInput[];
  diff?: string;
  copyable?: boolean;
  className?: string;
  style?: CSSProperties;
  maxHeight?: number | string;
}

const DEFAULT_ROWS: FileDiffRow[] = [
  { old: 12, cur: 12, type: "ctx", text: "export function getToken() {" },
  { old: 13, cur: null, type: "del", text: "  return localStorage.token;" },
  { old: null, cur: 13, type: "add", text: '  const t = cookies.get("session");' },
  { old: null, cur: 14, type: "add", text: '  if (!t) throw new Error("no session");' },
  { old: null, cur: 15, type: "add", text: "  return t;" },
  { old: 14, cur: 16, type: "ctx", text: "}" },
];

const KEYWORDS = new Set([
  "export", "function", "return", "const", "let", "var", "if", "else", "throw", "new",
  "import", "from", "async", "await", "class", "extends", "typeof", "void", "true",
  "false", "null", "undefined", "for", "while", "switch", "case", "break", "continue",
  "try", "catch", "finally", "this", "super", "static", "type", "interface", "enum", "as", "of", "in",
]);

export function tokenize(line: string): Array<{ t: string; v: string }> {
  const raw: Array<{ kind: string; v: string }> = [];
  const re =
    /(\s+)|(\/\/.*)|(\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_$][\w$]*\b)|(\S)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m[1]) raw.push({ kind: "txt", v: m[1] });
    else if (m[2] || m[3]) raw.push({ kind: "cm", v: m[0] });
    else if (m[4]) raw.push({ kind: "str", v: m[0] });
    else if (m[5]) raw.push({ kind: "num", v: m[0] });
    else if (m[6]) raw.push({ kind: "id", v: m[0] });
    else raw.push({ kind: "txt", v: m[0] });
  }
  const out: Array<{ t: string; v: string }> = [];
  for (let i = 0; i < raw.length; i++) {
    const cur = raw[i];
    if (cur.kind !== "id") {
      out.push({ t: cur.kind, v: cur.v });
      continue;
    }
    if (KEYWORDS.has(cur.v)) {
      out.push({ t: "kw", v: cur.v });
      continue;
    }
    let j = i + 1;
    while (j < raw.length && raw[j].kind === "txt" && /^\s+$/.test(raw[j].v)) j++;
    const next = raw[j];
    out.push({ t: next && next.v.startsWith("(") ? "fn" : "txt", v: cur.v });
  }
  return out;
}

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const SNIPPET_LINE = /^(\s*\d*) ([+\- ])(.*)$/;

function parsePaddedLine(line: string) {
  if (line.length < 11 || line[4] !== " " || line[9] !== " ") return null;
  const prefix = line[10];
  if (prefix !== "+" && prefix !== "-" && prefix !== " ") return null;
  const oldNo = line.slice(0, 4).trim();
  const newNo = line.slice(5, 9).trim();
  if (oldNo && !/^\d+$/.test(oldNo)) return null;
  if (newNo && !/^\d+$/.test(newNo)) return null;
  return { prefix, oldNo, newNo, content: line.slice(11) };
}

export function parseDiffText(rawDiff: string): { file?: string; rows: FileDiffRow[] } {
  const rows: FileDiffRow[] = [];
  let detectedFile: string | undefined;
  let oldNo = 0;
  let curNo = 0;

  for (const line of rawDiff.split("\n")) {
    if (line.startsWith("diff --git")) {
      const parts = line.split(" ");
      if (parts[3]) {
        detectedFile = parts[3].replace(/^b\//, "");
      }
      continue;
    }
    if (line.startsWith("+++ ")) {
      const match = line.slice(4).trim().replace(/^b\//, "");
      if (match && match !== "/dev/null") detectedFile = match;
      continue;
    }
    if (line.startsWith("--- ")) {
      const match = line.slice(4).trim().replace(/^a\//, "");
      if (match && match !== "/dev/null" && !detectedFile) detectedFile = match;
      continue;
    }

    const hunk = HUNK_RE.exec(line);
    if (hunk) {
      oldNo = Number(hunk[1]);
      curNo = Number(hunk[2]);
      rows.push({ old: null, cur: null, type: "hunk", text: line });
      continue;
    }

    if (line.startsWith("\\") || line.startsWith("[NOTE")) continue;

    const padded = parsePaddedLine(line);
    if (padded) {
      if (padded.prefix === "+") {
        rows.push({
          old: null,
          cur: padded.newNo ? Number(padded.newNo) : null,
          type: "add",
          text: padded.content,
        });
      } else if (padded.prefix === "-") {
        rows.push({
          old: padded.oldNo ? Number(padded.oldNo) : null,
          cur: null,
          type: "del",
          text: padded.content,
        });
      } else {
        rows.push({
          old: padded.oldNo ? Number(padded.oldNo) : null,
          cur: padded.newNo ? Number(padded.newNo) : null,
          type: "ctx",
          text: padded.content,
        });
      }
      continue;
    }

    const snippetMatch = SNIPPET_LINE.exec(line);
    if (snippetMatch) {
      const [, gutter, prefix, text] = snippetMatch;
      const lineNum = gutter.trim() ? Number(gutter.trim()) : null;
      if (prefix === "+") {
        rows.push({ old: null, cur: lineNum, type: "add", text });
      } else if (prefix === "-") {
        rows.push({ old: lineNum, cur: null, type: "del", text });
      } else {
        rows.push({ old: lineNum, cur: lineNum, type: "ctx", text });
      }
      continue;
    }

    const prefix = line[0];
    if (prefix === "+") {
      rows.push({
        old: null,
        cur: curNo > 0 ? curNo++ : null,
        type: "add",
        text: line.slice(1),
      });
    } else if (prefix === "-") {
      rows.push({
        old: oldNo > 0 ? oldNo++ : null,
        cur: null,
        type: "del",
        text: line.slice(1),
      });
    } else if (prefix === " ") {
      rows.push({
        old: oldNo > 0 ? oldNo++ : null,
        cur: curNo > 0 ? curNo++ : null,
        type: "ctx",
        text: line.slice(1),
      });
    } else if (line.trim().length > 0) {
      rows.push({
        old: oldNo > 0 ? oldNo++ : null,
        cur: curNo > 0 ? curNo++ : null,
        type: "ctx",
        text: line,
      });
    }
  }

  const last = rows[rows.length - 1];
  if (last && last.type === "ctx" && last.text === "") rows.pop();

  return { file: detectedFile, rows };
}

function normalizeRows(rows?: DiffRowInput[], diff?: string): { file?: string; normalized: FileDiffRow[] } {
  if (diff) {
    const parsed = parseDiffText(diff);
    return { file: parsed.file, normalized: parsed.rows };
  }
  if (!rows || rows.length === 0) {
    return { normalized: DEFAULT_ROWS };
  }
  return {
    normalized: rows.map((r) => {
      if ("type" in r && r.type) {
        return {
          old: r.old ?? null,
          cur: r.cur ?? null,
          type: r.type,
          text: r.text,
        };
      }
      const kind = (r as { kind?: "add" | "del" | "ctx" | "hunk" }).kind ?? "ctx";
      return {
        old: (r as { oldNo?: number | null }).oldNo ?? null,
        cur: (r as { newNo?: number | null }).newNo ?? null,
        type: kind,
        text: r.text,
      };
    }),
  };
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
