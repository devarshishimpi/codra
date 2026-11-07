import { useEffect, useState } from "react";
import type { FileReviewRecord } from "@codraoss/schema";
import type { BatchGroup } from "@client/lib/batch-groups";
import { FileRow } from "./file-row";

const PAGE_SIZE = 100;

export function FileReviewList({
  jobId,
  files,
  diffsLoading,
  batches,
}: {
  jobId: string;
  files: FileReviewRecord[];
  diffsLoading: boolean;
  batches: Map<string, BatchGroup>;
}) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [jobId]);

  const visibleFiles = files.slice(0, visibleCount);
  const remaining = files.length - visibleFiles.length;

  return (
    <>
      <div className="divide-y divide-ui-line/60">
        {visibleFiles.map((file) => (
          <FileRow
            key={file.id}
            file={file}
            diffsLoading={diffsLoading}
            batch={batches.get(file.filePath)}
          />
        ))}
      </div>
      {remaining > 0 && (
        <div className="border-t border-ui-line px-4 py-3 text-center">
          <button
            type="button"
            onClick={() =>
              setVisibleCount((count) => Math.min(files.length, count + PAGE_SIZE))
            }
            className="text-xs font-medium text-primary hover:underline"
          >
            Show {Math.min(remaining, PAGE_SIZE)} more files
          </button>
          <p className="mt-1 text-[11px] text-ui-subtle">
            {visibleFiles.length} of {files.length} files shown
          </p>
        </div>
      )}
    </>
  );
}
