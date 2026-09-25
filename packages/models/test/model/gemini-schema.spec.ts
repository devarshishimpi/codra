import { describe, expect, it } from "vitest";
import { toGeminiResponseJsonSchema } from "../../src/gemini-schema";
import {
  buildBatchReviewResponseSchema,
  buildReviewResponseSchema,
} from "@codraoss/core/prompts/file-review";
import { VERIFY_RESPONSE_SCHEMA } from "@codraoss/core/prompts/verify";

// Transformations asserted on the pure function; the adapter specs only check a grammar reaches the
// wire. Every failure mode here is silent -- a mangled grammar still returns 200.
describe("toGeminiResponseJsonSchema", () => {
  const reviewSchema = () => buildReviewResponseSchema(10).schema;
  const findingProps = (out: any) => out.properties.findings.items.properties;

  it("adapts both review grammars: ordering by declaration, code_location union collapsed", () => {
    const out = toGeminiResponseJsonSchema(reviewSchema()) as any;
    const expected = [
      "evidence",
      "code_location",
      "claim_type",
      "title",
      "body",
      "priority",
      "code_suggestion",
    ];
    expect(Object.keys(findingProps(out))).toEqual(expected);
    // `propertyOrdering` is an OpenAPI `responseSchema` keyword; inside `responseJsonSchema` Gemini
    // 400s on it, which silently disabled constrained decoding for every review. Declaration order
    // above carries the ordering; the keyword must never reach the wire.
    expect(out.properties.findings.items.propertyOrdering).toBeUndefined();

    const location = findingProps(out).code_location;
    expect(location.anyOf).toBeUndefined();
    // Paired: deleting the union without substituting `required` is the outcome to avoid.
    expect(location.required).toEqual(["line"]);
    expect(Object.keys(location.properties)).toEqual([
      "absolute_file_path",
      "line",
      "line_range",
    ]);

    const verify = toGeminiResponseJsonSchema(
      VERIFY_RESPONSE_SCHEMA.schema as Record<string, unknown>,
    ) as any;
    // `reason` then `decidable`, both before `verdict`: the verifier justifies, and states whether the
    // window it was given can settle the claim at all, before it is allowed to emit a decision token.
    expect(Object.keys(verify.properties.results.items.properties)).toEqual([
      "index",
      "reason",
      "decidable",
      "verdict",
      "confidence",
    ]);
    expect(verify.properties.results.items.propertyOrdering).toBeUndefined();

    // The batch grammar nests one level deeper; the same transforms must reach it.
    const batch = toGeminiResponseJsonSchema(
      buildBatchReviewResponseSchema(10, 4).schema,
    ) as any;
    const fileProps = batch.properties.files.items.properties;
    expect(Object.keys(fileProps)[0]).toBe("absolute_file_path");
    expect(fileProps.findings.items.properties.code_location.required).toEqual([
      "line",
    ]);
  });

  it("collapses oneOf, but never a union it cannot safely replace", () => {
    const collapsed = toGeminiResponseJsonSchema({
      type: "object",
      properties: { a: { type: "string" }, b: { type: "string" } },
      oneOf: [{ required: ["a"] }, { required: ["b"] }],
    }) as any;
    expect(collapsed.oneOf).toBeUndefined();
    expect(collapsed.required).toEqual(["a"]);

    // A typed branch is a real union, and an unusable one can't be substituted. Both pass through.
    const untouched = [
      [{ type: "object", required: ["a"] }, { type: "string" }],
      [{ required: "a" }, { required: ["a"] }],
      [{ required: [123] }, { required: ["a"] }],
    ];
    for (const anyOf of untouched) {
      const out = toGeminiResponseJsonSchema({
        type: "object",
        properties: { a: { type: "string" } },
        anyOf,
      }) as any;
      expect(out.anyOf).toHaveLength(2);
      expect(out.required).toBeUndefined();
    }
  });

  it("never mutates or aliases the caller's schema", () => {
    // VERIFY_RESPONSE_SCHEMA is a module singleton, so an in-place edit would corrupt
    // the verify grammar for every later job.
    const verifyBefore = JSON.stringify(VERIFY_RESPONSE_SCHEMA.schema);
    const input = reviewSchema() as any;
    const before = JSON.stringify(input);

    toGeminiResponseJsonSchema(
      VERIFY_RESPONSE_SCHEMA.schema as Record<string, unknown>,
    );
    const out = toGeminiResponseJsonSchema(input) as any;

    expect(JSON.stringify(VERIFY_RESPONSE_SCHEMA.schema)).toBe(verifyBefore);
    expect(JSON.stringify(input)).toBe(before);
    expect(
      input.properties.findings.items.properties.code_location.anyOf,
    ).toBeDefined();
    // Arrays too, so an `enum` or tuple-form `items` cannot be shared.
    expect(out.required).not.toBe(input.required);
    expect(findingProps(out).claim_type.enum).not.toBe(
      findingProps(input).claim_type.enum,
    );
  });
});
