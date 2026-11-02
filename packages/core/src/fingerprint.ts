export function fnv1a32Hex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash =
      (hash +
        ((hash << 1) +
          (hash << 4) +
          (hash << 7) +
          (hash << 8) +
          (hash << 24))) >>>
      0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function normalizeDiffText(input: string): string {
  return input
    .replace(/^\s*\d*\s+\d*\s*[+\- ]?/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function foldEvidenceText(input: string): string {
  return normalizeDiffText(input)
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...");
}

export function normalizeFindingTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function buildFindingFingerprint(path: string, title: string): string {
  return fnv1a32Hex(`${path}\u0000${normalizeFindingTitle(title)}`);
}

export function buildFindingFingerprintV2(
  path: string,
  claimType: string | null | undefined,
  anchorHash: string | null | undefined,
): string | null {
  if (!anchorHash) return null;
  return fnv1a32Hex(`v2 ${path} ${claimType ?? "other"} ${anchorHash}`);
}

export function buildAnchorHash(lineContent: string): string {
  return fnv1a32Hex(normalizeDiffText(lineContent));
}
