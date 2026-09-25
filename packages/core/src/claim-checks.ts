// SOUNDNESS, binding on every change: `refuted` asserts only that "X does not appear" is FALSE. There is no `confirmed` verdict, since a check that can confirm findings manufactures them. Losing a refutation is free; a wrong one silences a real defect.
import type { FileDiff } from "./diff";
import { normalizeDiffText } from "./fingerprint";

const PROXIMITY_WINDOW_LINES = 25;

const MIN_IDENTIFIER_LENGTH = 3;

const ABSENCE_PATTERNS: readonly RegExp[] = [
  /\b(?:never|not|no longer)\s+(?:being\s+)?(?:passed|provided|supplied|forwarded|included|used|called|invoked|awaited|checked|set|declared|defined|imported)\b/i,
  /\bdoes not\s+(?:pass|include|call|use|await|check|set|import)\b/i,
  /\bfails to\s+(?:pass|include|call|await|check|import)\b/i,
  /\bwithout\s+(?:passing|including|calling|awaiting|checking|importing)\b/i,
  /\b(?:missing|omitted|absent)\b/i,
  /\bis not defined\b/i,
];

const IDENTIFIER_STOPLIST = new Set([
  "await",
  "async",
  "if",
  "else",
  "try",
  "catch",
  "finally",
  "return",
  "throw",
  "new",
  "const",
  "let",
  "var",
  "function",
  "class",
  "this",
  "super",
  "import",
  "export",
  "from",
  "default",
  "null",
  "undefined",
  "true",
  "false",
  "void",
  "typeof",
  "instanceof",
  "delete",
  "yield",
  "props",
  "state",
  "error",
  "err",
  "data",
  "value",
  "key",
  "id",
  "type",
  "name",
  "index",
  "result",
  "response",
  "request",
  "req",
  "res",
  "params",
  "options",
  "config",
  "args",
]);

const VERSION_CLAIM_PATTERNS: readonly RegExp[] = [
  /\b(?:does not|doesn't|do not|don't)\s+exist\b/i,
  /\b(?:non-?existent|nonexistent)\b/i,
  /\bis not a valid\b/i,
  /\blatest (?:major )?version\b/i,
  /\bno such (?:version|tag|release)\b/i,
  /\bnot a valid (?:configuration )?(?:option|key|property)\b/i,
  /\b(?:does not|doesn't|do not|don't)\s+(?:expose|provide|have|support|include|offer)\b/i,
  /\bno such (?:function|method|export|property|api|field)\b/i,
  /\bis not (?:exposed|exported|available) (?:by|from|in)\b/i,
];

// Same soundness rule as the absence checker above.

const CROSS_FILE_SUBJECT =
  /\b(?:other|another|external|downstream|consuming|importing|dependent|calling)\s+(?:module|file|component|caller|package|consumer|import)s?\b/i;
const CROSS_FILE_CONSEQUENCE =
  /\b(?:break|breaks|breaking|broken|fail|fails|failing|error|errors|cannot import|can't import|unable to|compilation|compile|prevent|prevents|preventing|block|blocks|blocking)\b/i;

const ENVIRONMENT_HEDGE =
  /\b(?:depending on|might not|may not|could be undefined|if (?:this|the|it)\b[^.]{0,60}\b(?:is )?(?:rendered|run|executed|used)\b)/i;
const ENVIRONMENT_SUBJECT =
  /\b(?:older|legacy|earlier|some)\s+(?:node(?:\.js)?|browsers?|runtimes?|environments?|engines?|versions?)\b|\bserver[- ]side\b|\bSSR\b|\bhydration\b|\bpolyfill\b|\bis not defined on the server\b/i;

const CALLEE_FAILURE_CONDITION =
  /\b(?:if|when|should|were)\b(?:(?!\.\s)[^;!?]){0,62}\b(?:fails?|failing|rejects?|rejecting|throws?|throwing|errors? out)\b/i;
const CALLEE_CALL_SHAPE = /[\w.$]{1,50}\s*\(\s*\)|`[\w.$]{1,50}\(/;
const CALLEE_UNHANDLED_OUTCOME =
  /\bunhandled\b|\bunhandled promise\b|\bnot (?:caught|handled)\b|\bno (?:\.)?catch\b|\bwithout (?:a )?(?:try|catch)\b|\bcrash\b/i;

export type UndecidableClaimReason =
  "cross-file" | "environment" | "callee-errors";

/** Refutes a claim whose truth lives outside the diff; two signals per family, since one is ordinary. */
export function refuteUndecidableClaim(input: {
  title: string;
  body: string;
}): UndecidableClaimReason | null {
  const text = `${input.title}\n${input.body}`;

  if (CROSS_FILE_SUBJECT.test(text) && CROSS_FILE_CONSEQUENCE.test(text))
    return "cross-file";
  if (ENVIRONMENT_HEDGE.test(text) && ENVIRONMENT_SUBJECT.test(text))
    return "environment";
  if (
    CALLEE_FAILURE_CONDITION.test(text) &&
    CALLEE_CALL_SHAPE.test(text) &&
    CALLEE_UNHANDLED_OUTCOME.test(text)
  ) {
    return "callee-errors";
  }

  return null;
}

const FULL_SHA_PATTERN = /\b[0-9a-f]{40}\b/;

export function looksLikeExternalVersionClaim(
  title: string,
  body: string,
): boolean {
  const text = `${title}\n${body}`;
  return VERSION_CLAIM_PATTERNS.some((pattern) => pattern.test(text));
}

export function isVersionClaimRefutedByPin(input: {
  title: string;
  body: string;
  anchorContent: string;
}): boolean {
  if (!looksLikeExternalVersionClaim(input.title, input.body)) return false;
  return FULL_SHA_PATTERN.test(input.anchorContent);
}

/** One line the identifier could be found on; `hunkIndex` is null for lines from the post-image. */
type PresenceEntry = {
  newLineNumber: number | undefined;
  hunkIndex: number | null;
  code: string;
};

export type PresenceIndex = {
  byToken: Map<string, PresenceEntry[]>;
  entries: PresenceEntry[];
  hunkByLine: Map<number, number>;
};

export type AbsenceClaimVerdict =
  | {
      status: "unknown";
      reason:
        | "not_absence_shaped"
        | "no_identifier"
        | "ambiguous_identifier"
        | "stoplisted"
        | "not_present"
        | "out_of_window";
    }
  | { status: "refuted"; identifier: string; line: number | undefined };

type CommentSyntax = { line: readonly string[]; block: boolean };

// Must stay complete: a misclassified file keeps comment text as code, refuting real absence claims.
const HASH_COMMENT_EXTENSIONS = new Set([
  "py",
  "pyi",
  "rb",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ps1",
  "yaml",
  "yml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "tf",
  "tfvars",
  "hcl",
  "pl",
  "pm",
  "r",
  "jl",
  "nim",
  "cr",
  "ex",
  "exs",
  "elixir",
  "gemspec",
  "dockerfile",
  "containerfile",
  "mk",
  "cmake",
  "gradle",
  "properties",
  "env",
  "gitignore",
  "dockerignore",
  "editorconfig",
]);

const HASH_COMMENT_FILENAMES = new Set([
  "dockerfile",
  "containerfile",
  "makefile",
  "gnumakefile",
  "rakefile",
  "gemfile",
  "brewfile",
  "procfile",
  "vagrantfile",
  "justfile",
  "cmakelists.txt",
  ".gitignore",
  ".dockerignore",
  ".env",
]);

export function commentSyntaxFor(path: string): CommentSyntax {
  const name = path.toLowerCase().split("/").pop() ?? "";
  if (HASH_COMMENT_FILENAMES.has(name)) return { line: ["#"], block: false };

  const ext = name.includes(".") ? (name.split(".").pop() ?? "") : "";
  if (HASH_COMMENT_EXTENSIONS.has(ext)) return { line: ["#"], block: false };

  if (ext === "sql") return { line: ["--"], block: true };
  if (ext === "lua") return { line: ["--"], block: true };
  if (ext === "hs" || ext === "elm" || ext === "ada")
    return { line: ["--"], block: false };
  if (ext === "vim") return { line: ['"'], block: false };
  if (
    ext === "clj" ||
    ext === "cljs" ||
    ext === "edn" ||
    ext === "lisp" ||
    ext === "scm"
  ) {
    return { line: [";"], block: false };
  }
  return { line: ["//"], block: true };
}

export function stripCommentsAndStrings(
  input: string,
  syntax: CommentSyntax,
): string | null {
  let out = "";
  let i = 0;

  while (i < input.length) {
    const rest = input.slice(i);

    if (syntax.line.some((token) => rest.startsWith(token))) break;

    if (syntax.block && rest.startsWith("/*")) {
      const end = input.indexOf("*/", i + 2);
      if (end === -1) return null;
      out += " ";
      i = end + 2;
      continue;
    }

    const char = input[i];

    if (char === "'" || char === '"') {
      const close = findStringEnd(input, i + 1, char);
      if (close === -1) return null;
      out += " ";
      i = close + 1;
      continue;
    }

    if (char === "`") {
      const scanned = scanTemplateLiteral(input, i);
      if (!scanned) return null;
      out += scanned.code;
      i = scanned.next;
      continue;
    }

    out += char;
    i += 1;
  }

  return out;
}

function findStringEnd(input: string, start: number, quote: string): number {
  for (let i = start; i < input.length; i++) {
    if (input[i] === "\\") {
      i += 1;
      continue;
    }
    if (input[i] === quote) return i;
  }
  return -1;
}

function scanTemplateLiteral(
  input: string,
  start: number,
): { code: string; next: number } | null {
  let code = " ";
  let i = start + 1;

  while (i < input.length) {
    if (input[i] === "\\") {
      i += 2;
      continue;
    }
    if (input[i] === "`") return { code, next: i + 1 };
    if (input[i] === "$" && input[i + 1] === "{") {
      let depth = 1;
      let j = i + 2;
      while (j < input.length && depth > 0) {
        if (input[j] === "{") depth += 1;
        else if (input[j] === "}") depth -= 1;
        j += 1;
      }
      if (depth !== 0) return null;
      code += ` ${input.slice(i + 2, j - 1)} `;
      i = j;
      continue;
    }
    i += 1;
  }

  return null;
}

// MEASURED AND REJECTED: a call-site/reachability gate. The withheld slice had precision 27.3% vs an
// 18.7% pooled baseline, and "mentions callers" scored -0.3 on the codra-only subset. Any gate proposed
// from this corpus must be re-checked on the codra-only subset -- pooled signals do not survive it.

const TOKEN_PATTERN = /[A-Za-z_$][\w$]*/g;

/** Where each identifier appears after the change; without a post-image the index sees only the diff. */
export function buildPresenceIndex(
  file: FileDiff,
  fileContent?: string | null,
): PresenceIndex {
  const syntax = commentSyntaxFor(file.path);
  const byToken = new Map<string, PresenceEntry[]>();
  const entries: PresenceEntry[] = [];
  const hunkByLine = new Map<number, number>();

  const add = (entry: PresenceEntry) => {
    entries.push(entry);
    for (const match of entry.code.matchAll(TOKEN_PATTERN)) {
      const token = match[0];
      const existing = byToken.get(token);
      if (existing) existing.push(entry);
      else byToken.set(token, [entry]);
    }
  };

  file.hunks.forEach((hunk, hunkIndex) => {
    for (const line of hunk.lines) {
      if (line.newLineNumber !== undefined)
        hunkByLine.set(line.newLineNumber, hunkIndex);

      if (line.kind === "del") continue;

      const code = stripCommentsAndStrings(
        normalizeDiffText(line.content),
        syntax,
      );
      if (code === null) continue;

      add({ newLineNumber: line.newLineNumber, hunkIndex, code });
    }
  });

  if (fileContent) {
    const lines = fileContent.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const newLineNumber = i + 1;
      if (hunkByLine.has(newLineNumber)) continue;

      const code = stripCommentsAndStrings(normalizeDiffText(lines[i]), syntax);
      if (code === null) continue;

      add({ newLineNumber, hunkIndex: null, code });
    }
  }

  return { byToken, entries, hunkByLine };
}

const SIMPLE_IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const DOTTED_IDENTIFIER = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/;

function extractIdentifier(
  sentence: string,
): { identifier: string } | "none" | "ambiguous" {
  const spans = [
    ...sentence.matchAll(/`([^`]+)`/g),
    ...sentence.matchAll(/'([^']+)'/g),
    ...sentence.matchAll(/"([^"]+)"/g),
  ].map((match) => match[1].trim());

  const candidates = new Set(
    spans.filter(
      (span) => SIMPLE_IDENTIFIER.test(span) || DOTTED_IDENTIFIER.test(span),
    ),
  );

  if (candidates.size === 0) return "none";
  if (candidates.size > 1) return "ambiguous";
  return { identifier: [...candidates][0] };
}

function absenceSentences(text: string): string[] {
  return text
    .split(/[.;\n]/)
    .filter((sentence) =>
      ABSENCE_PATTERNS.some((pattern) => pattern.test(sentence)),
    );
}

export function checkAbsenceClaim(input: {
  title: string;
  body: string;
  anchorLine: number | undefined;
  index: PresenceIndex;
}): AbsenceClaimVerdict {
  const text = `${input.title}\n${input.body.slice(0, 600)}`;

  const sentences = absenceSentences(text);
  if (sentences.length === 0)
    return { status: "unknown", reason: "not_absence_shaped" };

  let identifier: string | undefined;
  for (const sentence of sentences) {
    const extracted = extractIdentifier(sentence);
    if (extracted === "ambiguous")
      return { status: "unknown", reason: "ambiguous_identifier" };
    if (extracted !== "none") {
      identifier = extracted.identifier;
      break;
    }
  }
  if (!identifier) return { status: "unknown", reason: "no_identifier" };

  const head = identifier.split(".")[0];
  if (identifier.length < MIN_IDENTIFIER_LENGTH)
    return { status: "unknown", reason: "stoplisted" };
  if (
    IDENTIFIER_STOPLIST.has(identifier.toLowerCase()) ||
    IDENTIFIER_STOPLIST.has(head.toLowerCase())
  ) {
    return { status: "unknown", reason: "stoplisted" };
  }

  const occurrences = identifier.includes(".")
    ? input.index.entries.filter((entry) =>
        entry.code.replace(/\s*\.\s*/g, ".").includes(identifier),
      )
    : (input.index.byToken.get(identifier) ?? []);

  if (occurrences.length === 0)
    return { status: "unknown", reason: "not_present" };

  const anchorHunk =
    input.anchorLine !== undefined
      ? input.index.hunkByLine.get(input.anchorLine)
      : undefined;
  const nearby = occurrences.find((entry) => {
    if (
      anchorHunk !== undefined &&
      entry.hunkIndex !== null &&
      entry.hunkIndex === anchorHunk
    )
      return true;
    if (input.anchorLine === undefined || entry.newLineNumber === undefined)
      return false;
    return (
      Math.abs(entry.newLineNumber - input.anchorLine) <= PROXIMITY_WINDOW_LINES
    );
  });

  if (!nearby) return { status: "unknown", reason: "out_of_window" };
  return { status: "refuted", identifier, line: nearby.newLineNumber };
}
