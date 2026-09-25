import { describe, expect, it } from "vitest";
import { classifySchemaRejection } from "@codraoss/models/google";

// A hit here latches the model into `schemaUnsupportedModels` for the rest of the job -- every later
// call runs unconstrained. It used to fire on a bare "Request contains an invalid argument.", which is
// also what an unrelated bad request looks like, so roughly two in five calls could be running without
// a response grammar with no way to tell. These pin both halves: what must still match, and what the
// heuristic branch now requires before it will claim a grammar rejection.
describe("classifySchemaRejection", () => {
  it("is confident when the error names the grammar", () => {
    const named = [
      "Invalid value at responseJsonSchema",
      'Unknown name "response_json_schema"',
      "responseSchema is not supported for this model",
      "Invalid JSON payload received.",
      'Unknown name "foo" at generation_config',
      "The schema is too deeply nested",
    ];
    for (const message of named) {
      expect(classifySchemaRejection(400, message)).toBe("confident");
    }
  });

  it("accepts a bare invalid-argument only alongside a grammar-adjacent term", () => {
    expect(
      classifySchemaRejection(
        400,
        "Request contains an invalid argument. generation_config is malformed",
      ),
    ).toBe("catchall");
    // Gemini's way of saying the grammar was too complex to compile.
    expect(
      classifySchemaRejection(
        400,
        "Request contains an invalid argument. too many states for serving",
      ),
    ).toBe("catchall");
    expect(
      classifySchemaRejection(
        400,
        "Request contains an invalid argument. constrained decoding failed",
      ),
    ).toBe("catchall");
  });

  // The regression this guards: one unrelated 400 used to cost the model its grammar for the whole job.
  it("refuses a bare invalid-argument with nothing grammar-shaped about it", () => {
    expect(
      classifySchemaRejection(400, "Request contains an invalid argument."),
    ).toBeNull();
    expect(
      classifySchemaRejection(
        400,
        "Request contains an invalid argument. The prompt is too long.",
      ),
    ).toBeNull();
    expect(
      classifySchemaRejection(
        400,
        "API key not valid. Please pass a valid API key.",
      ),
    ).toBeNull();
  });

  it("only ever classifies a 400", () => {
    expect(
      classifySchemaRejection(429, "responseJsonSchema is invalid"),
    ).toBeNull();
    expect(
      classifySchemaRejection(500, "Invalid JSON payload received."),
    ).toBeNull();
    expect(classifySchemaRejection(200, "schema")).toBeNull();
  });
});
