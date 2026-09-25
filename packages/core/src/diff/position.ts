export type DiffLineKind = "context" | "add" | "del";

export type DiffLine = {
  kind: DiffLineKind;
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
  position: number;
};

export type DiffHunk = {
  header: string;
  lines: DiffLine[];
};

export type FileDiff = {
  path: string;
  previousPath: string | null;
  isNew: boolean;
  isDeleted: boolean;
  isBinary: boolean;
  lineCount: number;
  hunks: DiffHunk[];
  isTruncated?: boolean;
  originalLineCount?: number;
};

export function getValidNewLines(file: FileDiff) {
  const newLines = new Set<number>();
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.kind !== "del" && line.newLineNumber !== undefined) {
        newLines.add(line.newLineNumber);
      }
    }
  }

  return newLines;
}

export function getValidPositions(file: FileDiff) {
  const positions = new Set<number>();
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.kind !== "del") {
        positions.add(line.position);
      }
    }
  }

  return positions;
}

export function findPositionForLine(file: FileDiff, lineNumber: number) {
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.newLineNumber === lineNumber && line.kind !== "del") {
        return line.position;
      }
    }
  }

  return undefined;
}

export function truncateFileDiff(file: FileDiff, maxLines: number): FileDiff {
  if (file.lineCount <= maxLines) {
    return file;
  }

  let currentLines = 0;
  const keptHunks: DiffHunk[] = [];

  for (const hunk of file.hunks) {
    const remainingLines = maxLines - currentLines;
    if (remainingLines <= 0) {
      break;
    }

    if (hunk.lines.length <= remainingLines) {
      keptHunks.push(hunk);
      currentLines += hunk.lines.length;
      continue;
    }

    keptHunks.push({
      ...hunk,
      lines: hunk.lines.slice(0, remainingLines),
    });
    currentLines += remainingLines;
    break;
  }

  return {
    ...file,
    hunks: keptHunks,
    lineCount: currentLines,
    isTruncated: true,
    originalLineCount: file.lineCount,
  };
}

export function chunkFileDiff(
  file: FileDiff,
  maxLinesPerChunk: number,
): FileDiff[] {
  if (file.lineCount <= maxLinesPerChunk) {
    return [file];
  }

  const chunks: FileDiff[] = [];
  let currentHunks: DiffHunk[] = [];
  let currentLines = 0;

  for (const hunk of file.hunks) {
    let linesRemainingInHunk = hunk.lines;

    while (linesRemainingInHunk.length > 0) {
      const roomInChunk = maxLinesPerChunk - currentLines;

      if (roomInChunk <= 0) {
        chunks.push({
          ...file,
          hunks: currentHunks,
          lineCount: currentLines,
          isTruncated: true,
          originalLineCount: file.lineCount,
        });
        currentHunks = [];
        currentLines = 0;
        continue;
      }

      if (linesRemainingInHunk.length <= roomInChunk) {
        currentHunks.push({
          ...hunk,
          lines: linesRemainingInHunk,
        });
        currentLines += linesRemainingInHunk.length;
        linesRemainingInHunk = [];
      } else {
        currentHunks.push({
          ...hunk,
          lines: linesRemainingInHunk.slice(0, roomInChunk),
        });
        currentLines += roomInChunk;
        linesRemainingInHunk = linesRemainingInHunk.slice(roomInChunk);
      }
    }
  }

  if (currentHunks.length > 0) {
    chunks.push({
      ...file,
      hunks: currentHunks,
      lineCount: currentLines,
      isTruncated: true,
      originalLineCount: file.lineCount,
    });
  }

  return chunks;
}
