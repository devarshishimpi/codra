/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { FileDiff } from "@codraoss/ui";
import { parseDiffText, tokenize } from "@codraoss/ui/file-diff";

describe("AICSS FileDiff Component", () => {
  it("renders default file and rows with correct statistics", () => {
    const { container } = render(<FileDiff />);
    expect(container.querySelector(".aicss-diff-file")?.textContent).toBe("src/auth.ts");
    expect(container.querySelector(".aicss-diff-add")?.textContent).toBe("+3");
    expect(container.querySelector(".aicss-diff-del")?.textContent).toBe("-1");

    const addRows = container.querySelectorAll(".aicss-diff-row.add");
    const delRows = container.querySelectorAll(".aicss-diff-row.del");
    const ctxRows = container.querySelectorAll(".aicss-diff-row.ctx");

    expect(addRows.length).toBe(3);
    expect(delRows.length).toBe(1);
    expect(ctxRows.length).toBe(2);
  });

  it("renders custom rows with old and cur line numbers", () => {
    const rows = [
      { old: 1, cur: 1, type: "ctx" as const, text: "const a = 1;" },
      { old: 2, cur: null, type: "del" as const, text: "const b = 2;" },
      { old: null, cur: 2, type: "add" as const, text: "const b = 3;" },
    ];
    const { container } = render(<FileDiff file="test/sample.ts" rows={rows} />);

    expect(container.querySelector(".aicss-diff-file")?.textContent).toBe("test/sample.ts");
    expect(container.querySelector(".aicss-diff-add")?.textContent).toBe("+1");
    expect(container.querySelector(".aicss-diff-del")?.textContent).toBe("-1");

    const lns = container.querySelectorAll(".aicss-diff-ln");
    // Each row has old and new line numbers
    expect(lns[0].textContent).toBe("1"); // row 1 old
    expect(lns[1].textContent).toBe("1"); // row 1 new
    expect(lns[2].textContent).toBe("2"); // row 2 old
    expect(lns[3].textContent).toBe("");  // row 2 new (deleted)
    expect(lns[4].textContent).toBe("");  // row 3 old (added)
    expect(lns[5].textContent).toBe("2"); // row 3 new
  });

  it("parses raw unified diff string automatically", () => {
    const rawDiff = `diff --git a/lib/math.ts b/lib/math.ts
--- a/lib/math.ts
+++ b/lib/math.ts
@@ -10,3 +10,4 @@
 function add(x, y) {
-  return x - y;
+  // Fix addition
+  return x + y;
 }`;
    const { file, rows } = parseDiffText(rawDiff);
    expect(file).toBe("lib/math.ts");
    expect(rows.length).toBe(6); // 1 hunk + 1 ctx + 1 del + 2 add + 1 ctx

    const { container } = render(<FileDiff diff={rawDiff} copyable />);
    expect(container.querySelector(".aicss-diff-file")?.textContent).toBe("lib/math.ts");
    expect(container.querySelector(".aicss-diff-add")?.textContent).toBe("+2");
    expect(container.querySelector(".aicss-diff-del")?.textContent).toBe("-1");
    expect(container.querySelector(".aicss-diff-actions button")).toBeTruthy();
  });

  it("parses snippet lines (%4d [+- ]content) from finding contextSnippet", () => {
    const snippet = `  12   export function getToken() {
  13 -   return localStorage.token;
  13 +   const t = cookies.get("session");
  14 +   return t;
  15   }`;
    const { rows } = parseDiffText(snippet);
    expect(rows.length).toBe(5);
    expect(rows[1].type).toBe("del");
    expect(rows[1].old).toBe(13);
    expect(rows[2].type).toBe("add");
    expect(rows[2].cur).toBe(13);
  });

  it("tokenizes language keywords, strings, and identifiers", () => {
    const tokens = tokenize('const secret = "my-token"; // comment');
    const kinds = tokens.map((t) => t.t);
    expect(kinds).toContain("kw");
    expect(kinds).toContain("str");
    expect(kinds).toContain("cm");
  });
});
