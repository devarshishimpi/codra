import { claimTypes, type RepoConfig } from "@codraoss/schema";
import type { FileDiff } from "../diff";
import type { ModelResponseSchema } from "../ports/model";
import { getLanguageForFile } from "./languages";
import {
  INTENT_CHECK_INSTRUCTION,
  renderFileContext,
  renderIntentBlock,
} from "./review-context";
import { EXEMPLAR_BLOCK_CHARS } from "../constants";

export { changelogExcerptFromDiff, wantsFileContext } from "./review-context";

// Pre-review_breadth fallback: generator was allowed ~2x the posted cap.
export function generatorFindingCap(maxComments: number): number {
  return Math.max(1, maxComments * 2);
}

/** Internal candidate cap upstream of posting; falls back for job snapshots queued before this field existed. */
export function reviewBreadth(
  config: Pick<RepoConfig["review"], "max_comments"> & {
    review_breadth?: number;
  },
): number {
  return config.review_breadth ?? generatorFindingCap(config.max_comments);
}

function findingItemSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "evidence",
      "code_location",
      "claim_type",
      "title",
      "body",
      "priority",
    ],
    properties: {
      evidence: { type: "string" },
      code_location: {
        type: "object",
        additionalProperties: false,
        properties: {
          absolute_file_path: { type: "string" },
          line: { type: "integer", minimum: 1 },
          line_range: {
            type: "object",
            additionalProperties: false,
            required: ["start", "end"],
            properties: {
              start: { type: "integer", minimum: 1 },
              end: { type: "integer", minimum: 1 },
            },
          },
        },
        anyOf: [{ required: ["line"] }, { required: ["line_range"] }],
      },
      claim_type: { type: "string", enum: [...claimTypes] },
      title: { type: "string", maxLength: 100 },
      body: { type: "string" },
      priority: { type: "integer", minimum: 0, maximum: 4 },
      code_suggestion: { type: "string" },
    },
  };
}

export function buildReviewResponseSchema(
  findingCap: number,
): ModelResponseSchema {
  return {
    name: "codra_file_review",
    schema: {
      type: "object",
      additionalProperties: false,
      required: [
        "findings",
        "overall_explanation",
        "overall_correctness",
        "overall_confidence_score",
      ],
      properties: {
        findings: {
          type: "array",
          maxItems: Math.max(1, findingCap),
          items: findingItemSchema(),
        },
        overall_explanation: { type: "string" },
        overall_correctness: {
          type: "string",
          enum: ["patch is correct", "patch is incorrect"],
        },
        overall_confidence_score: { type: "number", minimum: 0, maximum: 1 },
      },
    },
  };
}

export function buildBatchReviewResponseSchema(
  findingCap: number,
  fileCount: number,
): ModelResponseSchema {
  return {
    name: "codra_batch_review",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["files", "overall_confidence_score"],
      properties: {
        files: {
          type: "array",
          maxItems: fileCount,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "absolute_file_path",
              "findings",
              "overall_explanation",
              "overall_correctness",
            ],
            properties: {
              absolute_file_path: { type: "string" },
              findings: { type: "array", items: findingItemSchema() },
              overall_explanation: { type: "string" },
              overall_correctness: {
                type: "string",
                enum: ["patch is correct", "patch is incorrect"],
              },
            },
          },
        },
        overall_confidence_score: { type: "number", minimum: 0, maximum: 1 },
      },
    },
  };
}

const SINGLE_FILE_SCHEMA_FORMAT = `{
  "findings": [
    {
      "evidence": "<the exact line of code from the diff this finding is about>",
      "code_location": {
        "line": number,
        "line_range": { "start": number, "end": number }
      },
      "claim_type": "<one of the claim types listed above>",
      "title": "<Plain title, NO tags/emoji>",
      "body": "<Explanation of the concrete defect and its impact>",
      "priority": 0 | 1 | 2 | 3 | 4,
      "code_suggestion": "Optional replacement code"
    }
  ],
  "overall_explanation": "Summary",
  "overall_correctness": "patch is correct" | "patch is incorrect",
  "overall_confidence_score": number (0 to 1)
}`;

const MULTI_FILE_SCHEMA_FORMAT = `{
  "files": [
    {
      "absolute_file_path": "<exact path of one of the files listed below, copied character-for-character>",
      "findings": [
        {
          "evidence": "<the exact line of code from THIS file's diff this finding is about>",
          "code_location": {
            "absolute_file_path": "<the same path as above>",
            "line": number,
            "line_range": { "start": number, "end": number }
          },
          "claim_type": "<one of the claim types listed above>",
          "title": "<Plain title, NO tags/emoji>",
          "body": "<Explanation of the concrete defect and its impact>",
          "priority": 0 | 1 | 2 | 3 | 4,
          "code_suggestion": "Optional replacement code"
        }
      ],
      "overall_explanation": "Summary for THIS file",
      "overall_correctness": "patch is correct" | "patch is incorrect"
    }
  ],
  "overall_confidence_score": number (0 to 1)
}`;

export function buildFileReviewSystemPromptBase(opts?: {
  multiFile?: boolean;
  fileContext?: boolean;
}): string {
  const multi = opts?.multiFile === true;

  const singleFileScope =
    opts?.fileContext === true
      ? "- You can see the diff below and, after it, the full content of that one file. You cannot see the rest of the repository. Findings must still be about lines the diff CHANGED; the file content is there to tell you what the surrounding code does, not to be reviewed."
      : "- You can see ONLY the diff below, not the whole file or the rest of the repository.";

  const contextScope = multi
    ? `- You can see ONLY the diffs below, not the whole files or the rest of the repository.
- Each file below is INDEPENDENT. A finding about one file must be grounded in a line from THAT file's diff, and must be reported inside that file's entry. Never carry a claim from one file to another, and never assume two files interact unless both diffs show it.`
    : singleFileScope;

  const evidenceSource = multi
    ? `the single line of code the finding is about, copied VERBATIM from that file's diff below.`
    : "the single line of code the finding is about, copied VERBATIM from the diff below.";

  const capRule = multi
    ? "4. Return at most {{MAX_COMMENTS}} findings PER FILE, most severe first. Keep each body under 160 words."
    : "4. Return at most {{MAX_COMMENTS}} findings, most severe first. Keep each body under 160 words.";

  const emptyRule = multi
    ? `5. Return exactly one entry per file listed below, in the same order, and never omit a file. Review each file's diff with the same care you would give it if it were the only file in front of you. An empty findings array is a positive claim that this diff introduces no defect, so return one only when that is true. Do not pad, and do not withhold.`
    : "5. If the diff genuinely introduces no defect, return an empty findings array and a short explanation. Do not pad, and do not withhold.";

  return `You are a world-class software engineer performing a precise, high-signal code review.
Your goal is to find REAL defects (bugs, security vulnerabilities, and performance problems) introduced by the diff. Every finding must be grounded in a line you can quote from the diff.

### CONTEXT EXTENDS (read carefully, this prevents false positives):
${contextScope}
- You cannot see which files import this one. Never predict that a change breaks callers, importers, "other modules" or "external files" -- a removed \`export\`, a renamed symbol or a changed signature may have no consumers at all, and you have no way to check. The same applies in reverse to a function whose body is not shown: do not assume what it does with its errors or its return value.
- Assume every third-party package is at the version this project pins, and that its API is whatever that version provides. Never claim a library "does not expose", "does not provide" or "does not support" something; your training data predates the installed version.
- Assume the language, runtime and build target are whatever the project already uses successfully. A syntax or standard-library method appearing in the diff is available in this project by construction -- the code around it already compiles and ships. Do not raise compatibility, polyfill, transpilation, engine-version or server-side-rendering concerns unless the diff itself shows the incompatibility.
- Two async facts that are frequently misread. \`return somePromise()\` inside an \`async\` function IS awaited by whoever awaits that function; it is equivalent to \`return await\` except inside \`try\`/\`finally\`, so it is not a missing await and not a floating promise. And \`void someAsyncCall()\` is deliberate fire-and-forget: if the called function handles its own errors, there is no unhandled rejection to report.

### WHAT TO REPORT:
- Report anything a senior engineer reviewing this diff would want to investigate: a bug, a security hole, a performance problem, a resource leak, an unhandled failure, a broken invariant.
- You do not need to be certain. A finding you can ground in a quoted line is worth raising; every finding is independently checked against the diff afterwards, and a wrong one is discarded at no cost to you. A defect you decline to mention is simply lost.

### EVIDENCE (mandatory, a finding without it cannot be posted):
- Every finding MUST include "evidence": ${evidenceSource}
- Copy the code exactly as it appears. Do NOT include the two line-number columns or the +/- marker, do NOT paraphrase, reformat, shorten, or invent code.
- If you cannot quote a specific line from the diff that exhibits the problem, you do not have a finding. Omit it.

### CLAIM TYPE (required, pick the one that fits, or "other"):
${claimTypes.join(", ")}
- This is a label for the KIND of defect. It does not license the claim: only report a type if the
  diff actually shows it. Picking a type the code cannot exhibit makes the finding easy to discard.
- If nothing fits, use "other". Do not stretch a label to fit.
- NEVER claim that a package, action, tag or version "does not exist", or that a config key is invalid. You cannot know what was released after your training data, and a step pinned to a commit SHA resolves by that SHA regardless of the version written beside it. Such claims are discarded.
- Label honestly. The type you choose does not affect whether a finding is accepted; an inaccurate label only makes a real defect harder to act on.

### OUTPUT RULES:
1. Output MUST be valid JSON, EXACTLY ONE object matching the schema below.
2. DO NOT output any conversational text, source code, or diff hunks before or after the JSON.
3. Prioritize by severity: 0 = P0 critical, 1 = P1 high, 2 = P2 medium, 3 = P3 low, 4 = nit (cosmetic/trivial). Set priority honestly; do not inflate. Use 4 for anything a reviewer would prefix with "nit:".
   A finding that rests on a condition you cannot check from the diff -- "if this runs on an older engine", "if another module imports this", "depending on the caller" -- is at most priority 3, never 0 or 1, however serious the consequence would be if the condition held. Certainty about the consequence is not certainty about the premise.
${capRule}
${emptyRule}

### SCHEMA FORMAT:
${multi ? MULTI_FILE_SCHEMA_FORMAT : SINGLE_FILE_SCHEMA_FORMAT}

Identify security risks such as XSS, SQLi, CSRF, insecure randomness, and data leaks that the diff actually introduces.`;
}

export const fileReviewSystemPromptBase = buildFileReviewSystemPromptBase();

export function buildFileReviewSystemPrompt(
  config: RepoConfig["review"],
  languagePersona?: string,
  opts?: { multiFile?: boolean; fileContext?: boolean },
) {
  const persona = languagePersona ? ` as ${languagePersona}` : "";
  const prompt = buildFileReviewSystemPromptBase(opts).replace(
    "{{MAX_COMMENTS}}",
    reviewBreadth(config).toString(),
  );
  return `You are a world-class professional senior code reviewer${persona}. ${prompt}`;
}

export type RejectedExemplar = { title: string; claimType?: string | null };

function renderExemplars(
  exemplars: readonly RejectedExemplar[] | undefined,
): string | null {
  if (!exemplars?.length) return null;

  const lines: string[] = [];
  let used = 0;
  for (const exemplar of exemplars) {
    const line = `- ${exemplar.title}${exemplar.claimType ? ` (${exemplar.claimType})` : ""}`;
    if (used + line.length > EXEMPLAR_BLOCK_CHARS) break;
    lines.push(line);
    used += line.length;
  }
  if (lines.length === 0) return null;

  const heading =
    "Findings a reviewer on THIS repository has already rejected. Do not report things like these:";
  return [heading, ...lines].join("\n");
}
function renderCustomRules(config: RepoConfig["review"]): string {
  const rules =
    config.custom_rules.length > 0
      ? config.custom_rules.map((rule) => `- ${rule}`).join("\n")
      : "- None";
  return `Custom rules:\n${rules}`;
}

function renderLanguageGuidelines(path: string): string {
  const languageInfo = getLanguageForFile(path);
  const guidelineHeader =
    "Specific Guidelines (check the diff against each of these)";
  return languageInfo
    ? `Language: ${languageInfo.language}\n${guidelineHeader}:\n${languageInfo.guidelines.map((g) => `- ${g}`).join("\n")}`
    : "Language: Generic\nSpecific Guidelines: Follow general best practices.";
}

export function buildFileReviewPrompts(input: {
  file: FileDiff;
  fileContext?: string | null;
  prTitle: string | null;
  prDescription: string | null;
  changelogExcerpt?: string | null;
  config: RepoConfig["review"];
  rejectedExemplars?: readonly RejectedExemplar[];
}) {
  const languageInfo = getLanguageForFile(input.file.path);
  const rules =
    input.config.custom_rules.length > 0
      ? input.config.custom_rules.map((rule) => `- ${rule}`).join("\n")
      : "- None";
  const intentBlock = renderIntentBlock(input);
  const fileContext = input.fileContext
    ? renderFileContext(input.file, input.fileContext)
    : null;

  const systemPrompt = buildFileReviewSystemPrompt(
    input.config,
    languageInfo?.persona,
    {
      fileContext: fileContext !== null,
    },
  );
  const languageGuidelines = renderLanguageGuidelines(input.file.path);

  const exemplars = renderExemplars(input.rejectedExemplars);

  const userPrompt = [
    intentBlock,
    ...(exemplars ? [exemplars] : []),
    `File path: ${input.file.path}`,
    languageGuidelines,
    `Custom rules:\n${rules}`,
    "Review ONLY the diff shown below. You cannot see the rest of the file or repository - do not report something as undefined, unimported, unused, or missing just because it is not in the diff. If the diff note says it was truncated, do not infer issues from omitted lines.",
    "Line numbers: every diff line below is prefixed with two columns - the OLD file line number, then the NEW file line number. Always report `line` (and `line_range`) using the NEW (second, right-hand) number, and only ever cite a line that appears in the diff. For a removed line, cite the nearest NEW line number shown next to it.",
    `Evidence: every finding must carry an \`evidence\` string containing the exact code of the line it is about, copied character-for-character from the UNIFIED DIFF below. Strip the two leading line-number columns and the +/-/space marker - quote only the code itself. A finding whose evidence does not appear in the diff will be discarded${fileContext ? ", and the full-file context below is NOT the diff -- a line quoted from it counts as no evidence at all" : ""}.`,
    INTENT_CHECK_INSTRUCTION,
    "Prioritize correctness, security, and production-impacting bugs. Raise anything you can ground in a quoted line; avoid subjective style feedback.",
    "",
    `## Output JSON Schema (STRICTLY REQUIRED)`,
    `{
  "findings": [
    {
      "evidence": "<exact line of code copied verbatim from the diff below, without the line-number columns or +/- marker>",
      "code_location": {
        "absolute_file_path": "${input.file.path}",
        "line": <int>,
        "line_range": {"start": <int>, "end": <int>}
      },
      "claim_type": "<${claimTypes.join(" | ")}>",
      "title": "<Plain title>",
      "body": "<Technical explanation>",
      "priority": <0|1|2|3|4>,
      "code_suggestion": "string"
    }
  ],
  "overall_correctness": "patch is correct" | "patch is incorrect",
  "overall_explanation": "Summary",
  "overall_confidence_score": <float 0.0-1.0>
}`,
    "",
    "Unified diff:",
    renderFileDiff(input.file),
    ...(fileContext ? ["", fileContext] : []),
  ].join("\n");

  return { systemPrompt, userPrompt };
}

function packFileHeader(file: FileDiff, index: number, total: number): string {
  return `===== FILE ${index + 1} of ${total}: ${file.path} =====`;
}

export function buildBatchReviewPrompts(input: {
  files: readonly FileDiff[];
  prTitle: string | null;
  prDescription: string | null;
  changelogExcerpt?: string | null;
  config: RepoConfig["review"];
  rejectedExemplars?: readonly RejectedExemplar[];
}) {
  const files = input.files;

  const languages = new Set(files.map((file) => getLanguageForFile(file.path)));
  const uniformLanguage = languages.size === 1 ? [...languages][0] : undefined;

  const systemPrompt = buildFileReviewSystemPrompt(
    input.config,
    uniformLanguage?.persona,
    { multiFile: true },
  );

  const intentBlock = renderIntentBlock(input);
  const exemplars = renderExemplars(input.rejectedExemplars);
  const pathList = files.map((file) => `- ${file.path}`).join("\n");

  const fileBlocks = files.flatMap((file, index) => [
    "",
    packFileHeader(file, index, files.length),
    ...(uniformLanguage ? [] : [renderLanguageGuidelines(file.path)]),
    "Unified diff:",
    renderFileDiff(file),
  ]);

  const userPrompt = [
    intentBlock,
    ...(exemplars ? [exemplars] : []),
    `You are reviewing ${files.length} files in ONE response. Return exactly ${files.length} entries in "files", one per path, in this order:\n${pathList}`,
    ...(uniformLanguage ? [renderLanguageGuidelines(files[0].path)] : []),
    renderCustomRules(input.config),
    "Review ONLY the diffs shown below. You cannot see the rest of any file or the repository - do not report something as undefined, unimported, unused, or missing just because it is not in a diff. If a diff note says it was truncated, do not infer issues from omitted lines.",
    "File scoping: each finding belongs to exactly ONE file. Put it inside that file's entry, set that file's path in `absolute_file_path`, and quote evidence from that file's diff only. Never report a finding about one file inside another file's entry, and never quote a line from a different file.",
    "Line numbers: every diff line below is prefixed with two columns - the OLD file line number, then the NEW file line number. Always report `line` (and `line_range`) using the NEW (second, right-hand) number, and only ever cite a line that appears in that file's diff. For a removed line, cite the nearest NEW line number shown next to it.",
    "Evidence: every finding must carry an `evidence` string containing the exact code of the line it is about, copied character-for-character from its own file's diff below. Strip the two leading line-number columns and the +/-/space marker - quote only the code itself. A finding whose evidence does not appear in that file's diff will be discarded.",
    INTENT_CHECK_INSTRUCTION,
    "Prioritize correctness, security, and production-impacting bugs. Raise anything you can ground in a quoted line; avoid subjective style feedback.",
    "",
    `## Output JSON Schema (STRICTLY REQUIRED)`,
    MULTI_FILE_SCHEMA_FORMAT,
    ...fileBlocks,
  ].join("\n");

  return { systemPrompt, userPrompt };
}

export function renderFileDiff(file: FileDiff) {
  const lines = [
    `diff --git a/${file.previousPath ?? file.path} b/${file.path}`,
  ];
  for (const hunk of file.hunks) {
    lines.push(hunk.header);
    for (const line of hunk.lines) {
      const prefix =
        line.kind === "add" ? "+" : line.kind === "del" ? "-" : " ";
      const left = line.oldLineNumber ?? "";
      const right = line.newLineNumber ?? "";
      lines.push(
        `${String(left).padStart(4, " ")} ${String(right).padStart(4, " ")} ${prefix}${line.content}`,
      );
    }
  }

  if (file.isTruncated) {
    lines.push("");
    lines.push(
      `[NOTE: This diff has been truncated from ${file.originalLineCount} lines to ${file.lineCount} lines for brevity.]`,
    );
  }

  return lines.join("\n");
}
