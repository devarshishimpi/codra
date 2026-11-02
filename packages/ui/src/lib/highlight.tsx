import type { ReactNode } from "react";
import { generate, parse } from "sugar-high/core";
import { lang as normalizeLang, languages } from "sugar-high/lang";
import type { LanguageName } from "sugar-high";

/**
 * Per-line syntax highlighting for the diff viewer, backed by sugar-high. Tokenizes one line at
 * a time; multi-line constructs (block comments, template literals) fall back to plain text -
 * the standard trade-off for cheap diff highlighting.
 */

/** `undefined` means "no highlighting" - the line renders as plain text. */
export type Lang = LanguageName | undefined;

// Extensions sugar-high's own alias table doesn't cover, mapped to the closest supported grammar.
const EXTRA_EXT: Record<string, LanguageName> = {
  mjs: "javascript",
  cjs: "javascript",
  mts: "typescript",
  cts: "typescript",
  vue: "html",
  svelte: "html",
  svg: "html",
  h: "c",
  hpp: "cpp",
  less: "css",
  env: "shell",
};

export function langForPath(path: string): Lang {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return normalizeLang(ext) ?? EXTRA_EXT[ext];
}

const CONFIGS = new Map(
  languages.map((language) => [language.id, language.config]),
);

export function highlightLine(text: string, lang: Lang): ReactNode {
  if (!lang || text.length === 0 || text.length > 1000) return text;

  const [line] = generate(parse(text, CONFIGS.get(lang)));
  if (!line) return text;

  return line.children.map((token, key) => (
    <span
      key={key}
      className={token.properties.className}
      style={token.properties.style}
    >
      {token.children.map((child) => child.value).join("")}
    </span>
  ));
}
