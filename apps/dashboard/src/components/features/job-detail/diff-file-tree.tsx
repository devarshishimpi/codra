import { Check, FileText, Folder, FolderOpen } from "lucide-react";
import { type TreeNode } from "@codraoss/ui/file-tree";
import { diffStats } from "@codraoss/ui/prompt-diff";
import { cn } from "@codraoss/ui/utils";
import type { FileReviewRecord } from "@codraoss/schema";

export interface TreeProps {
  nodes: TreeNode[];
  collapsedDirs: Set<string>;
  viewedFiles: Set<string>;
  selectedFileId: string | null;
  onToggleDir: (path: string) => void;
  onSelectFile: (file: FileReviewRecord) => void;
}

export function FileTree({
  nodes,
  collapsedDirs,
  viewedFiles,
  selectedFileId,
  onToggleDir,
  onSelectFile,
}: TreeProps) {
  // Indentation, guide lines, and connector ticks come from `.diff-tree` CSS; rows carry no depth styling themselves.
  return (
    <ul>
      {nodes.map((node) => {
        if (node.type === "dir") {
          const collapsed = collapsedDirs.has(node.path);
          return (
            <li key={`d:${node.path}`} className="min-w-0">
              <button
                type="button"
                onClick={() => onToggleDir(node.path)}
                aria-expanded={!collapsed}
                className="flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs font-medium text-ui-default transition-colors hover:bg-ui-fill/60"
              >
                {collapsed ? (
                  <Folder size={14} className="shrink-0 text-ui-subtle" />
                ) : (
                  <FolderOpen size={14} className="shrink-0 text-ui-default" />
                )}
                <span className="min-w-0 truncate">{node.name}</span>
              </button>
              <div className="diff-tree-children" data-collapsed={collapsed}>
                <div>
                  <FileTree
                    nodes={node.children}
                    collapsedDirs={collapsedDirs}
                    viewedFiles={viewedFiles}
                    selectedFileId={selectedFileId}
                    onToggleDir={onToggleDir}
                    onSelectFile={onSelectFile}
                  />
                </div>
              </div>
            </li>
          );
        }

        const { adds, dels } = diffStats(node.file.diffInput);
        const viewed = viewedFiles.has(node.file.id);
        const selected = selectedFileId === node.file.id;
        return (
          <li key={`f:${node.file.id}`} className="min-w-0">
            <button
              type="button"
              onClick={() => onSelectFile(node.file)}
              aria-current={selected ? "true" : undefined}
              className={cn(
                "group flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left transition-colors",
                selected
                  ? "bg-ui-fill font-medium text-ui-strong"
                  : "hover:bg-ui-fill/60",
              )}
              title={`${node.file.filePath} · +${adds} -${dels}`}
            >
              {viewed ? (
                <Check
                  size={13}
                  className="shrink-0 text-success"
                  strokeWidth={3}
                />
              ) : (
                <FileText
                  size={14}
                  className={cn(
                    "shrink-0",
                    selected ? "text-ui-default" : "text-ui-subtle",
                  )}
                />
              )}
              <span
                className={cn(
                  "ui-font-mono min-w-0 flex-1 truncate text-[11px]",
                  viewed
                    ? "text-ui-subtle line-through"
                    : selected
                      ? "text-ui-strong"
                      : "text-ui-default",
                )}
              >
                {node.name}
              </span>
              {node.file.parsedComments.length > 0 && (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
                  title={`${node.file.parsedComments.length} review comments`}
                />
              )}
              {/* `hidden` not opacity-0, so counts don't reserve width and squeeze the filename when invisible. */}
              <span
                className={cn(
                  "ui-font-mono shrink-0 text-[10px] tabular-nums",
                  selected ? "inline" : "hidden group-hover:inline",
                )}
              >
                <span className="diff-add-fg">+{adds}</span>{" "}
                <span className="diff-del-fg">-{dels}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
