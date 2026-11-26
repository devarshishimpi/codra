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

export const DEFAULT_ROWS: FileDiffRow[] = [
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

function isWhitespaceChar(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n" || /\s/.test(ch);
}

function isDigitChar(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isWordChar(ch: string): boolean {
  return (
    (ch >= "a" && ch <= "z") ||
    (ch >= "A" && ch <= "Z") ||
    (ch >= "0" && ch <= "9") ||
    ch === "_"
  );
}

function isIdentStart(ch: string): boolean {
  return (
    (ch >= "a" && ch <= "z") ||
    (ch >= "A" && ch <= "Z") ||
    ch === "_" ||
    ch === "$"
  );
}

/**
 * Linear-time fallback tokenizer for diff lines without a known language highlighter.
 */
export function tokenize(line: string): Array<{ t: string; v: string }> {
  const raw: Array<{ kind: string; v: string }> = [];
  let i = 0;
  const len = line.length;

  while (i < len) {
    const ch = line[i];

    if (isWhitespaceChar(ch)) {
      const start = i;
      i++;
      while (i < len && isWhitespaceChar(line[i])) i++;
      raw.push({ kind: "ws", v: line.slice(start, i) });
      continue;
    }

    if (ch === "/" && i + 1 < len) {
      if (line[i + 1] === "/") {
        raw.push({ kind: "cm", v: line.slice(i) });
        break;
      }
      if (line[i + 1] === "*") {
        const closeIdx = line.indexOf("*/", i + 2);
        if (closeIdx !== -1) {
          raw.push({ kind: "cm", v: line.slice(i, closeIdx + 2) });
          i = closeIdx + 2;
        } else {
          raw.push({ kind: "cm", v: line.slice(i) });
          break;
        }
        continue;
      }
    }

    if (ch === '"' || ch === "'") {
      const start = i;
      let j = i + 1;
      let closed = false;
      while (j < len) {
        if (line[j] === "\\") {
          j += 2;
          continue;
        }
        if (line[j] === ch) {
          j++;
          closed = true;
          break;
        }
        j++;
      }
      raw.push({ kind: "str", v: line.slice(start, closed ? j : len) });
      i = closed ? j : len;
      continue;
    }

    if (isDigitChar(ch) && (i === 0 || !isWordChar(line[i - 1]))) {
      let j = i + 1;
      while (j < len && isDigitChar(line[j])) j++;
      if (j + 1 < len && line[j] === "." && isDigitChar(line[j + 1])) {
        j += 2;
        while (j < len && isDigitChar(line[j])) j++;
      }
      if (j === len || !isWordChar(line[j])) {
        raw.push({ kind: "num", v: line.slice(i, j) });
        i = j;
        continue;
      }
    }

    if (isIdentStart(ch) && (ch === "$" || i === 0 || !isWordChar(line[i - 1]))) {
      let j = i + 1;
      while (j < len && (isWordChar(line[j]) || line[j] === "$")) j++;
      raw.push({ kind: "id", v: line.slice(i, j) });
      i = j;
      continue;
    }

    raw.push({ kind: "txt", v: ch });
    i++;
  }

  const out: Array<{ t: string; v: string }> = [];
  for (let k = 0; k < raw.length; k++) {
    const cur = raw[k];
    if (cur.kind === "ws") {
      out.push({ t: "txt", v: cur.v });
      continue;
    }
    if (cur.kind !== "id") {
      out.push({ t: cur.kind, v: cur.v });
      continue;
    }
    if (KEYWORDS.has(cur.v)) {
      out.push({ t: "kw", v: cur.v });
      continue;
    }
    let j = k + 1;
    while (j < raw.length && raw[j].kind === "ws") j++;
    const next = raw[j];
    out.push({ t: next && next.v.startsWith("(") ? "fn" : "txt", v: cur.v });
  }
  return out;
}

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function parseSnippetLine(
  line: string,
): { lineNum: number | null; prefix: string; text: string } | null {
  let i = 0;
  const len = line.length;
  while (i < len && (line[i] === " " || line[i] === "\t")) {
    i++;
  }
  const digitStart = i;
  while (i < len && isDigitChar(line[i])) {
    i++;
  }
  if (i > digitStart) {
    if (i + 1 >= len || line[i] !== " ") return null;
    const prefix = line[i + 1];
    if (prefix !== "+" && prefix !== "-" && prefix !== " ") return null;
    return {
      lineNum: Number(line.slice(digitStart, i)),
      prefix,
      text: line.slice(i + 2),
    };
  }
  if (i < len && (line[i] === "+" || line[i] === "-")) {
    if (i < 1 || line[i - 1] !== " ") return null;
    return {
      lineNum: null,
      prefix: line[i],
      text: line.slice(i + 1),
    };
  }
  if (i >= 2 && line[i - 2] === " " && line[i - 1] === " ") {
    return {
      lineNum: null,
      prefix: " ",
      text: line.slice(i),
    };
  }
  return null;
}

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

/**
 * Parses unified diff or finding context-snippet text into structured FileDiff rows.
 */
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

    const snippet = parseSnippetLine(line);
    if (snippet) {
      const { lineNum, prefix, text } = snippet;
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

/**
 * Normalizes raw diff text or input rows into FileDiffRow objects.
 */
export function normalizeRows(
  rows?: DiffRowInput[],
  diff?: string,
): { file?: string; normalized: FileDiffRow[] } {
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
