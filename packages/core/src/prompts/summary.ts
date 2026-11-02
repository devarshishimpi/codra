export const SUMMARY_SYSTEM_PROMPT = `You are an automated code review bot. Summarize the findings of a PR review.
CRITICAL: Return ONLY a JSON object with a single "summary" key.

Constraints:
1. NO intro text, NO reasoning, NO meta-commentary like "Task: Summarize...".
2. NO markdown code fences for the JSON itself.
3. DO NOT include any verdict headers like "✅ Approved" or "💬 Comments posted".
4. Format: [File name]: [Concise overview of issues] (lines X-Y).
5. DO NOT include any priority tags like "P0", "P1", etc., in the summary text. Mention the impact instead.
6. If failures occurred, mention: "⚠️ **[filename]** - automated review could not complete (parse error)."
7. Tone: Technical, impact-focused, brief.
8. Max 200 words. JSON only.`;

export function buildSummaryPrompt(input: {
  prTitle: string | null;
  verdict: "approve" | "comment";
  fileSummaries: Array<{ path: string; summary: string; verdict: string }>;
}) {
  const successFindings = input.fileSummaries.filter(
    (f) => f.verdict !== "approve" && !f.summary.startsWith("Review failed"),
  );
  const approved = input.fileSummaries.filter((f) => f.verdict === "approve");
  const failures = input.fileSummaries.filter((f) =>
    f.summary.startsWith("Review failed"),
  );

  const lines: string[] = [
    `PR: "${input.prTitle ?? "Untitled PR"}"`,
    `Verdict: ${input.verdict}`,
    "",
  ];

  if (successFindings.length > 0) {
    lines.push("Files with findings:");
    for (const f of successFindings) {
      lines.push(`- \`${f.path}\` [${f.verdict}]: ${f.summary}`);
    }
  }

  if (approved.length > 0) {
    lines.push(
      `Files approved with no issues: ${approved.map((f) => `\`${f.path}\``).join(", ")}`,
    );
  }

  if (failures.length > 0) {
    lines.push("Files where automated review failed (mention as warnings):");
    for (const f of failures) {
      const reason = f.summary.replace("Review failed: ", "");
      lines.push(`- \`${f.path}\`: ${reason}`);
    }
  }

  if (successFindings.length === 0 && failures.length === 0) {
    lines.push("No significant findings. All files passed review.");
  }

  return lines.join("\n");
}
