import { reviewCategories } from "./schema-enums";

export const claimTypes = [
  "react_hook_missing_deps",
  "react_missing_cleanup",
  "missing_await",
  "unhandled_promise_rejection",
  "resource_leak",
  "null_or_undefined_deref",
  "sql_injection",
  "unsafe_dom_sink",
  "unsafe_dynamic_code",
  "insecure_randomness",
  "hardcoded_secret",
  "redos_regex",
  "swallowed_error",
  "mutable_default_arg",
  "destructive_migration",
  "external_version_claim",
  "other",
] as const;

export type ClaimType = (typeof claimTypes)[number];

export const CLAIM_TYPE_CATEGORY: Record<
  ClaimType,
  (typeof reviewCategories)[number]
> = {
  sql_injection: "security",
  unsafe_dom_sink: "security",
  unsafe_dynamic_code: "security",
  insecure_randomness: "security",
  hardcoded_secret: "security",
  missing_await: "bugs",
  unhandled_promise_rejection: "bugs",
  null_or_undefined_deref: "bugs",
  react_hook_missing_deps: "bugs",
  swallowed_error: "bugs",
  mutable_default_arg: "bugs",
  resource_leak: "performance",
  redos_regex: "performance",
  destructive_migration: "correctness",
  react_missing_cleanup: "correctness",
  external_version_claim: "correctness",
  other: "quality",
};

export function toClaimType(value: unknown): ClaimType {
  return (claimTypes as readonly string[]).includes(value as string)
    ? (value as ClaimType)
    : "other";
}

export const CLAIM_TYPE_DECIDABILITY: Record<
  ClaimType,
  "diff_local" | "needs_whole_file" | "needs_external_facts"
> = {
  sql_injection: "diff_local",
  unsafe_dom_sink: "diff_local",
  unsafe_dynamic_code: "diff_local",
  insecure_randomness: "diff_local",
  hardcoded_secret: "diff_local",
  mutable_default_arg: "diff_local",
  destructive_migration: "diff_local",
  swallowed_error: "diff_local",
  unhandled_promise_rejection: "diff_local",
  missing_await: "diff_local",
  other: "diff_local",

  react_hook_missing_deps: "needs_whole_file",
  react_missing_cleanup: "needs_whole_file",
  resource_leak: "needs_whole_file",
  redos_regex: "needs_whole_file",

  null_or_undefined_deref: "needs_whole_file",

  external_version_claim: "needs_external_facts",
};

export const DEFAULT_DENIED_CLAIM_TYPES: ClaimType[] = claimTypes.filter(
  (type) => CLAIM_TYPE_DECIDABILITY[type] !== "diff_local",
);

export const DEFAULT_SHADOW_RULE_IDS = [
  "empty-catch",
  "debugger-statement",
  "focused-test",
  "dynamic-code-exec",
  "dynamic-html-sink",
  "mutable-default-arg",
  "destructive-migration",
  "hardcoded-secret",
  "insecure-random",
] as const;

export const findingDispositions = [
  "posted",
  "severity",
  "confidence",
  "suppression",
  "dedupe",
  "verify",
  "verify_unanswered",
  "rule_unverified",
  "cap",
  "unverifiable_passthrough",
] as const;

export type FindingDisposition = (typeof findingDispositions)[number];
