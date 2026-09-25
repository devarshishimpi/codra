import type { ClaimType, reviewSeverities } from "@codraoss/schema";

type ReviewSeverity = (typeof reviewSeverities)[number];

export type Rule = {
  id: string;
  claimType: ClaimType;
  severity: ReviewSeverity;
  title: string;
  body: string;
  triggers: readonly string[];
  pattern: RegExp;
  rejectRaw?: RegExp;
  extensions?: readonly string[];
  enabled: boolean;
};

const ts = ["ts", "tsx", "js", "jsx", "mjs", "cjs"] as const;

export const RULES: readonly Rule[] = [
  {
    id: "empty-catch",
    claimType: "swallowed_error",
    severity: "P2",
    title: "Empty catch block swallows the error",
    body:
      "This `catch` has no body, so the error is discarded with no log, no rethrow and no recovery. " +
      "A failure here becomes silent. If the error is genuinely expected, say so in a comment inside the block.",
    triggers: ["catch"],
    pattern: /\bcatch\s*(\([^)]*\))?\s*\{\s*\}/,
    rejectRaw: /\bcatch\s*(\([^)]*\))?\s*\{\s*(?:\/\/|\/\*)/,
    extensions: ts,
    enabled: true,
  },
  {
    id: "debugger-statement",
    claimType: "other",
    severity: "P1",
    title: "`debugger` statement left in the diff",
    body:
      "A `debugger` statement halts execution whenever devtools are open. This is almost always " +
      "a leftover from local debugging.",
    triggers: ["debugger"],
    pattern: /^\s*debugger\s*;?\s*$/,
    extensions: ts,
    enabled: true,
  },
  {
    id: "focused-test",
    claimType: "other",
    severity: "P1",
    title: "Focused test will skip the rest of the suite",
    body:
      "A focused test (`.only`) silently prevents every other test in the file from running, so " +
      "CI stays green while covering almost nothing.",
    triggers: [".only"],
    pattern: /\b(?:describe|it|test|context|suite)\s*\.\s*only\s*\(/,
    extensions: ts,
    enabled: true,
  },
  {
    id: "dynamic-code-exec",
    claimType: "unsafe_dynamic_code",
    severity: "P1",
    title: "Dynamic code execution",
    body:
      "`eval` and the `Function` constructor execute arbitrary strings as code. If any part of " +
      "that string can be influenced by input, this is remote code execution.",
    triggers: ["eval(", "Function("],
    pattern: /(?:^|[^.\w])eval\s*\(|new\s+Function\s*\(/,
    extensions: ts,
    enabled: true,
  },
  {
    id: "dynamic-html-sink",
    claimType: "unsafe_dom_sink",
    severity: "P1",
    title: "Unsanitized value assigned to an HTML sink",
    body:
      "Assigning a non-literal to `innerHTML`/`outerHTML` (or passing one to `insertAdjacentHTML`) " +
      "executes any markup it contains. If the value can carry user input this is XSS.",
    triggers: ["innerHTML", "outerHTML", "insertAdjacentHTML"],
    pattern:
      /\.(?:inner|outer)HTML\s*=\s*[A-Za-z_$][\w$.[\]()]*|insertAdjacentHTML\s*\([^)]*,\s*[A-Za-z_$]/,
    extensions: ts,
    enabled: true,
  },
  {
    id: "mutable-default-arg",
    claimType: "mutable_default_arg",
    severity: "P2",
    title: "Mutable default argument",
    body:
      "Python evaluates a default argument once, at definition time, so this list/dict/set is " +
      "shared by every call. Mutating it leaks state between invocations. Use `None` and build the " +
      "value inside the function.",
    triggers: ["def "],
    pattern:
      /\bdef\s+\w+\s*\([^)]*=\s*(?:\[\s*\]|\{\s*\}|set\s*\(\s*\)|dict\s*\(\s*\)|list\s*\(\s*\))/,
    extensions: ["py"],
    enabled: true,
  },
  {
    id: "destructive-migration",
    claimType: "destructive_migration",
    severity: "P1",
    title: "Destructive migration statement",
    body:
      "This statement discards data irreversibly. On a forward-only migration chain there is no " +
      "rollback: confirm the column/table is genuinely unused and that a backup exists.",
    triggers: ["DROP", "TRUNCATE", "drop", "truncate"],
    pattern: /\b(?:drop\s+(?:column|table)|truncate\s+table|truncate\s+\w)/i,
    extensions: ["sql"],
    enabled: true,
  },

  {
    id: "hardcoded-secret",
    claimType: "hardcoded_secret",
    severity: "P0",
    title: "Possible hardcoded credential",
    body:
      "This looks like a literal credential committed to the repository. If it is real, rotate it " +
      "and move it to a secret binding.",
    triggers: ["sk-", "AIza", "ghp_", "AKIA"],
    pattern:
      /\b(?:sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16})\b/,
    enabled: false,
  },
  {
    id: "insecure-random",
    claimType: "insecure_randomness",
    severity: "P2",
    title: "`Math.random()` used for a security-sensitive value",
    body:
      "`Math.random()` is not cryptographically secure and its output is predictable. Use " +
      "`crypto.getRandomValues()` for tokens, ids or anything an attacker should not guess.",
    triggers: ["Math.random"],
    pattern:
      /\b(?:token|secret|key|nonce|salt|password|session|id)\w*\s*=[^=]*Math\.random\s*\(/i,
    extensions: ts,
    enabled: false,
  },
];
