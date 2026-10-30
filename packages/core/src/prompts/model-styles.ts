import type { RepoConfig } from "@codraoss/schema";

// Per-model prompt styles, selected by a model registry profile (review.model_tuning.prompt_style).
// Each is a surgical transform of the prompt Codra built, kept verbatim from the evaluation that measured
// them, so production runs the prompts the precision numbers came from.

export type Prompts = { systemPrompt: string; userPrompt: string };

// Codra's own restraint clauses, as the base builders emit them.
const RESTRAINT =
  "Prioritize correctness, security, and production-impacting bugs. Raise anything you can ground in a quoted line; avoid subjective style feedback.";
const RESTRAINT_ALT =
  "Prioritize correctness, runtime stability, and production-impacting bugs. A finding you can ground in a quoted line is worth raising; wrong ones are discarded at no cost downstream. Even if a function looks minimal, report plausible runtime crashes, unhandled edge cases, or missing parameter checks (such as zero division, nil dereference, or out-of-bounds access). Avoid subjective style feedback.";

const BALANCED_DIRECTIVE = `Review the change below and report REAL defects introduced by it: bugs, security vulnerabilities, performance problems, resource leaks, unhandled failures, broken invariants. Correctness first. Do not report style preferences, naming, formatting, or missing tests unless the absence is itself a defect.
Set severity honestly and do not inflate. Most true findings are 2 or 3. Do not withhold a defect you can substantiate.`;

const TRACE_DIRECTIVE = `Review the changes across all files below and report REAL defects introduced by them: logic errors, security vulnerabilities, edge-case crashes, unhandled errors, and broken invariants.
Correctness first. Do not report style preferences, naming, formatting, or missing tests unless the absence is itself a defect.
Set severity honestly and do not inflate. Most true findings are 2 or 3. Do not withhold a defect you can substantiate.

You may analyze and trace the execution flow through the changes step-by-step first.
Then, output your findings in a single fenced JSON code block at the end of your response:
\`\`\`json
{
  "findings": [
    {
      "path": "<file path from diff>",
      "line": <new line number>,
      "severity": "<P0, P1, P2, or P3>",
      "title": "<concise title under 80 chars>",
      "body": "<description of defect and trigger>",
      "evidence": "<exact line of code from diff>"
    }
  ]
}
\`\`\`
If no real defects exist, output \`\`\`json { "findings": [] } \`\`\`.`;

const CALIBRATION = `Severity calibration, applied literally:
- 0 (P0): data loss, remote code execution, authentication bypass, or a crash on the ordinary path. The trigger must be visible in this diff.
- 1 (P1): wrong results, a resource leak, or an unhandled failure on a path a user reaches normally.
- 2 (P2): a real defect on an edge case, or a performance regression with a stated mechanism.
- 3 (P3): a defect whose trigger depends on anything outside this diff, or that needs an unusual input.
- 4 (nit): cosmetic.
Most true findings are 2 or 3. If you are about to emit more than one 0 or 1 on a single diff, re-read them: at most one is usually right.`;

const PROHIBITIONS =
  /- You cannot see which files import this one[\s\S]*?there is no unhandled rejection to report\./;
const GROUNDING =
  "- Ground every finding in a specific modified line. Focus on runtime crashes, unhandled errors, data corruption, resource leaks, and broken invariants.";

const VERIFY_STRICT_DIRECTIVE =
  "Judge the CLAIM strictly against the CODE. Drop claims that cannot be decisively proven from the provided diff window; keep only concrete, demonstrable defects introduced by these changes.";
const VERIFY_LENIENT_DIRECTIVE =
  "Judge on the balance of the evidence: keep a finding whose problem the window supports, drop one the window contradicts. Do not drop a finding merely because external caller details or helper function bodies are absent.";
const VERIFY_STRICT_DROP =
  '- "drop": if the claim cannot be proven from this window alone, if the code contradicts it, if the safeguard already exists, if it speculates on unseen callers or external files, or if it is a stylistic preference.';
const VERIFY_LENIENT_DROP =
  '- "drop": if the code contradicts the claim, if the safeguard already exists, if it speculates on unseen callers, or if it is a stylistic preference.';

/** Styles whose verifier is told to judge on the balance of evidence rather than demand proof. */
const LENIENT_VERIFY_STYLES = new Set(["calibrated", "balanced"]);

/** Removes the per-language guideline block, the largest fixed cost in Codra's user prompt. */
function stripLanguageGuidelines(userPrompt: string): string {
  return userPrompt
    .replace(/^Language: .*\nSpecific Guidelines \(check the diff against each of these\):\n(?:- .*\n?)+/gm, "")
    .replace(/^Language: Generic\nSpecific Guidelines: Follow general best practices\.\n?/gm, "")
    .replace(/^Custom rules:\n- None\n?/gm, "");
}

function replaceRestraint(userPrompt: string, directive: string): string {
  if (userPrompt.includes(RESTRAINT)) return userPrompt.replace(RESTRAINT, directive);
  if (userPrompt.includes(RESTRAINT_ALT)) return userPrompt.replace(RESTRAINT_ALT, directive);
  return `${directive}\n\n${userPrompt}`;
}

type Style = NonNullable<NonNullable<RepoConfig["review"]["model_tuning"]>["prompt_style"]>;

/** Applies a profile's generator prompt style. Styles without a transform return the prompts unchanged. */
export function applyModelPromptStyle(style: Style | undefined, prompts: Prompts): Prompts {
  let { systemPrompt, userPrompt } = prompts;
  switch (style) {
    case "calibrated":
      systemPrompt = `${systemPrompt}\n\n### SEVERITY CALIBRATION:\n${CALIBRATION}`;
      break;
    case "balanced":
      userPrompt = replaceRestraint(stripLanguageGuidelines(userPrompt), BALANCED_DIRECTIVE);
      systemPrompt = systemPrompt.replace(PROHIBITIONS, GROUNDING);
      systemPrompt = `${systemPrompt}\n\n### SEVERITY CALIBRATION:\n${CALIBRATION}`;
      break;
    case "trace_then_report":
      userPrompt = replaceRestraint(stripLanguageGuidelines(userPrompt), TRACE_DIRECTIVE);
      systemPrompt = systemPrompt.replace(PROHIBITIONS, GROUNDING);
      systemPrompt = `${systemPrompt}\n\n### SEVERITY CALIBRATION:\n${CALIBRATION}`;
      break;
    default:
      return prompts;
  }
  return { systemPrompt, userPrompt };
}

/** Applies a profile's style to the verifier's system prompt. */
export function applyModelVerifyStyle(style: Style | undefined, systemPrompt: string): string {
  if (!style || !LENIENT_VERIFY_STYLES.has(style)) return systemPrompt;
  return systemPrompt
    .replace(VERIFY_STRICT_DIRECTIVE, VERIFY_LENIENT_DIRECTIVE)
    .replace(VERIFY_STRICT_DROP, VERIFY_LENIENT_DROP);
}
