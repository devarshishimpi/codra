import type { FileReviewRecord } from "@codraoss/schema";

/** Builds the collapsed directory tree the diff viewer's file list renders. */

export type TreeNode =
  | { type: "dir"; name: string; path: string; children: TreeNode[] }
  | { type: "file"; name: string; file: FileReviewRecord };

export function buildTree(files: FileReviewRecord[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const file of files) {
    const parts = file.filePath.split("/");
    const fileName = parts.pop()!;
    let level = root;
    let prefix = "";

    for (const part of parts) {
      prefix = prefix ? `${prefix}/${part}` : part;
      let dir = level.find(
        (n): n is Extract<TreeNode, { type: "dir" }> =>
          n.type === "dir" && n.name === part,
      );
      if (!dir) {
        dir = { type: "dir", name: part, path: prefix, children: [] };
        level.push(dir);
      }
      level = dir.children;
    }

    level.push({ type: "file", name: fileName, file });
  }

  // Collapse single-child directory chains (src → client → components → "src/client/components").
  function compress(nodes: TreeNode[]): TreeNode[] {
    return nodes.map((node) => {
      if (node.type !== "dir") return node;
      let dir = node;
      while (dir.children.length === 1 && dir.children[0].type === "dir") {
        const child = dir.children[0];
        dir = {
          type: "dir",
          name: `${dir.name}/${child.name}`,
          path: child.path,
          children: child.children,
        };
      }
      return { ...dir, children: compress(dir.children) };
    });
  }

  // Folders before files, each alphabetical - matches GitHub's ordering.
  function sortNodes(nodes: TreeNode[]): TreeNode[] {
    const sorted = nodes.toSorted((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of sorted)
      if (n.type === "dir") n.children = sortNodes(n.children);
    return sorted;
  }

  return sortNodes(compress(root));
}
