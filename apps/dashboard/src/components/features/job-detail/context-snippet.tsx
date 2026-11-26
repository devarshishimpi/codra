import { FileDiff } from "@codraoss/ui";

/**
 * The stored diff context of a finding, rendered with the AICSS File Diff component:
 * header with file path, +adds/-dels stats, copy action, signature accent bars,
 * double line-number gutter, and syntax highlighting.
 */
export function ContextSnippet({
  snippet,
  filePath,
}: {
  snippet: string;
  filePath: string;
}) {
  return (
    <FileDiff
      file={filePath}
      diff={snippet}
      copyable
      className="mt-2"
    />
  );
}
