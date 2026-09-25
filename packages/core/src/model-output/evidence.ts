import { foldEvidenceText } from "../fingerprint";
import type { DiffLine, FileDiff } from "../diff";

import { MIN_DISCRIMINATING_EVIDENCE_CHARS } from "../constants";

/** `anchor` is where a quoting finding gets posted; `sourceKind` is the text's kind pre-re-anchoring. */
export type IndexedLine = { anchor: DiffLine; sourceKind: DiffLine["kind"] };

export type EvidenceIndex = {
  byContent: Map<string, IndexedLine[]>;
  lines: { normalized: string; line: IndexedLine }[];
};

export function buildEvidenceIndex(file: FileDiff): EvidenceIndex {
  const byContent = new Map<string, IndexedLine[]>();
  const lines: { normalized: string; line: IndexedLine }[] = [];

  for (const hunk of file.hunks) {
    const postable = hunk.lines.filter(
      (line) => line.kind !== "del" && line.newLineNumber !== undefined,
    );
    if (postable.length === 0) continue;

    hunk.lines.forEach((line, lineIndex) => {
      const normalized = foldEvidenceText(line.content);
      if (!normalized) return;

      let anchor = line;
      if (line.kind === "del" || line.newLineNumber === undefined) {
        anchor =
          hunk.lines
            .slice(lineIndex + 1)
            .find((l) => l.kind !== "del" && l.newLineNumber !== undefined) ??
          hunk.lines
            .slice(0, lineIndex)
            .reverse()
            .find((l) => l.kind !== "del" && l.newLineNumber !== undefined) ??
          postable[0];
      }

      const entry: IndexedLine = { anchor, sourceKind: line.kind };
      lines.push({ normalized, line: entry });
      const existing = byContent.get(normalized);
      if (existing) existing.push(entry);
      else byContent.set(normalized, [entry]);
    });
  }

  return { byContent, lines };
}

export function foldFirstEvidenceLine(evidence: unknown): string | null {
  if (typeof evidence !== "string") return null;
  return (
    evidence
      .split("\n")
      .map(foldEvidenceText)
      .find((l) => l.length > 0) ?? null
  );
}

export type BinAmbiguityIndex = Map<string, number>;

export function buildBinAmbiguityIndex(
  files: readonly FileDiff[],
): BinAmbiguityIndex {
  const filesPerLine = new Map<string, Set<string>>();

  for (const file of files) {
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        const normalized = foldEvidenceText(line.content);
        if (normalized.length < MIN_DISCRIMINATING_EVIDENCE_CHARS) continue;
        const paths = filesPerLine.get(normalized);
        if (paths) paths.add(file.path);
        else filesPerLine.set(normalized, new Set([file.path]));
      }
    }
  }

  const index: BinAmbiguityIndex = new Map();
  for (const [normalized, paths] of filesPerLine) {
    if (paths.size > 1) index.set(normalized, paths.size);
  }
  return index;
}

export type EvidenceResolution =
  | { status: "absent" }
  | { status: "weak" }
  // `touched` is false only when every occurrence of the quoted text is an untouched context line.
  | { status: "matched"; line: DiffLine; touched: boolean }
  | { status: "unmatched" };

export function resolveEvidence(
  evidence: unknown,
  index: EvidenceIndex,
  reportedLine: number | undefined,
): EvidenceResolution {
  if (typeof evidence !== "string") return { status: "absent" };

  const firstLine = foldFirstEvidenceLine(evidence);
  if (!firstLine) return { status: "absent" };
  if (firstLine.length < MIN_DISCRIMINATING_EVIDENCE_CHARS)
    return { status: "weak" };

  // Judged over the whole candidate set, so one context occurrence cannot refuse a changed one.
  const anyTouched = (candidates: IndexedLine[]) =>
    candidates.some((c) => c.sourceKind !== "context");

  const nearest = (candidates: IndexedLine[]) => {
    const preferred = candidates.some((c) => c.sourceKind !== "context")
      ? candidates.filter((c) => c.sourceKind !== "context")
      : candidates;
    if (reportedLine === undefined) return preferred[0].anchor;
    return preferred.reduce((best, candidate) =>
      Math.abs((candidate.anchor.newLineNumber ?? 0) - reportedLine) <
      Math.abs((best.anchor.newLineNumber ?? 0) - reportedLine)
        ? candidate
        : best,
    ).anchor;
  };

  const exact = index.byContent.get(firstLine);
  if (exact && exact.length > 0) {
    return {
      status: "matched",
      line: nearest(exact),
      touched: anyTouched(exact),
    };
  }

  const contained = index.lines.flatMap(({ normalized, line }) =>
    normalized.length >= MIN_DISCRIMINATING_EVIDENCE_CHARS &&
    (normalized.includes(firstLine) || firstLine.includes(normalized))
      ? [line]
      : [],
  );
  if (contained.length > 0) {
    return {
      status: "matched",
      line: nearest(contained),
      touched: anyTouched(contained),
    };
  }

  return { status: "unmatched" };
}
