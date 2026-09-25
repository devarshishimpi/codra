import { describe, expect, it } from "vitest";
import { extractJson } from "../src/model-output/json";
import { refuteUndecidableClaim } from "../src/claim-checks";

// Validates regex polynomial-redos fixes maintain parsing parity while capping execution time.

// ReDOS budget catching unbounded quantifiers without CI flakiness.
const BUDGET_MS = 250;

function timed(fn: () => unknown) {
  const startedAt = performance.now();
  fn();
  return performance.now() - startedAt;
}

describe("extractJson: fence parsing unchanged, backtracking gone", () => {
  it("still strips a ```json fence, with or without padding", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJson('```json     \n\n  {"a":1}  \n\n```')).toBe('{"a":1}');
  });

  it("still prefers the LAST json fence, as the parser always has", () => {
    expect(
      extractJson(
        '```json\n{"first":1}\n```\ntext\n```json\n{"second":2}\n```',
      ),
    ).toBe('{"second":2}');
  });

  it("still recovers an object from an unterminated fence via the later stages", () => {
    expect(extractJson('```json\t \t{"a":1}')).toBe('{"a":1}');
  });

  it("still reads an untagged or language-tagged generic fence", () => {
    const withKeys = '{"findings":[],"verdict":"approve"}';
    expect(extractJson(`\`\`\`\n${withKeys}\n\`\`\``)).toContain('"findings"');
    expect(extractJson(`\`\`\`js  \n${withKeys}\n\`\`\``)).toContain(
      '"findings"',
    );
    expect(extractJson(`\`\`\`c++-x\n${withKeys}\n\`\`\``)).toContain(
      '"findings"',
    );
  });

  it("returns the raw string when there is no fence at all", () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });

  it("does not degrade on a fence followed by a long whitespace run", () => {
    expect(
      timed(() => extractJson("```json" + " ".repeat(40_000))),
    ).toBeLessThan(BUDGET_MS);
    expect(timed(() => extractJson("```" + " ".repeat(40_000)))).toBeLessThan(
      BUDGET_MS,
    );
  });
});

describe("claim-check regexes: bounded, and unchanged for realistic input", () => {
  const claim = (body: string) => refuteUndecidableClaim({ title: "", body });

  it("still refutes a real callee-failure claim", () => {
    expect(
      claim(
        "If the `this.persistence.loadCooldowns()` call fails the rejection is unhandled.",
      ),
    ).toBe("callee-errors");
    expect(
      claim(`When getThing${" ".repeat(50)}() fails, the error is not caught.`),
    ).toBe("callee-errors");
  });

  it("still declines claims that lack one of the three signals", () => {
    expect(claim("If getThing() fails, nothing much happens.")).toBeNull();
    expect(claim("The unhandled rejection here is bad.")).toBeNull();
  });

  it("does not degrade on a body that is a long run of `$`", () => {
    expect(
      timed(() => claim("If " + "$".repeat(40_000) + " fails it is unhandled")),
    ).toBeLessThan(BUDGET_MS);
  });

  it("does not degrade on a diff line that is a long whitespace run", () => {
    expect(
      timed(() => " ".repeat(40_000).replace(/\s{0,50}\.\s{0,50}/g, ".")),
    ).toBeLessThan(BUDGET_MS);
  });

  it("documents the one accepted behaviour change: gaps beyond the bound stop matching", () => {
    expect(
      claim(`If getThing${" ".repeat(51)}() fails, the error is not caught.`),
    ).toBeNull();
    expect(
      claim(`If getThing${" ".repeat(50)}() fails, the error is not caught.`),
    ).toBe("callee-errors");
  });
});
