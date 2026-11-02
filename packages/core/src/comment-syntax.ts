export type CommentSyntax = { line: readonly string[]; block: boolean };

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
