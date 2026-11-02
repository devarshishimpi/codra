import { describe, expect, it } from "vitest";
import { dropStrayKeyFragments, extractJson, parseRawPayload, sanitizeInnerQuotes } from "../src/model-output/json";

// One finding whose body is written exactly as a model wrote it, unescaped mistakes included.
const reply = (body: string) =>
  `{\n  "findings": [\n    {\n      "path": "a.py",\n      "line": 3,\n      "severity": "P2",\n      "title": "t",\n      "body": "${body}",\n      "evidence": "x = 1"\n    }\n  ]\n}`;
const bodyOf = (raw: string) => (parseRawPayload(raw) as { findings: Array<{ body?: string }> }).findings[0]?.body;

describe("model replies that quote escaping code", () => {
  // glm-4.7-flash on aio-libs/aiohttp#13054 (a fix to an escape_quotes helper) explained the bug by quoting
  // `\\"`: an escaped backslash followed by a bare quote. The whole reply was discarded as unparseable.
  it("keeps a reply with an escaped backslash followed by a bare quote", () => {
    expect(bodyOf(reply('value \\\\" inside'))).toBe('value \\" inside');
  });

  it("keeps a reply whose string value ends in a single backslash", () => {
    expect(bodyOf(reply("ends with a backslash \\"))).toBe("ends with a backslash \\");
  });

  it("keeps a reply with a malformed unicode escape", () => {
    expect(bodyOf(reply("bad \\u12 escape"))).toBe("bad \\u12 escape");
  });

  it("leaves correctly escaped and unrelated values as they were", () => {
    expect(bodyOf(reply('he said \\"hi\\" there'))).toBe('he said "hi" there');
    expect(bodyOf(reply('he said "hi" there'))).toBe('he said "hi" there');
    expect(bodyOf(reply("odd \\\\\\\" here"))).toBe('odd \\" here');
    expect(bodyOf(reply("path C:\\\\Users"))).toBe("path C:\\Users");
  });

  it("repairs quotes idempotently, so extractJson and preprocessJson can both run it", () => {
    for (const body of ['value \\\\" inside', "ends with \\", 'he said "hi"', 'ok \\"x\\"']) {
      const once = sanitizeInnerQuotes(reply(body));
      expect(sanitizeInnerQuotes(once)).toBe(once);
    }
  });

  // step-5-preview, codra-copy run: `{"  ,"findings": []}` lost the whole reply.
  it("drops a broken key fragment before the first real key", () => {
    expect((parseRawPayload('{"  ,"findings": []}') as { findings: unknown[] }).findings).toEqual([]);
    const one = '{"  ,"findings": [{"path": "a.h", "line": 76, "severity": "P2", "title": "t", "body": "b", "evidence": "x"}]}';
    expect((parseRawPayload(one) as { findings: unknown[] }).findings).toHaveLength(1);
    // A real key that happens to be quote-space-comma keeps its colon and is left alone.
    expect(dropStrayKeyFragments('{"  ,": 1}')).toBe('{"  ,": 1}');
    expect(dropStrayKeyFragments('```json\n{"  ,"findings": []}\n```')).toBe('```json\n{"findings": []}\n```');
  });

  // The first version matched anywhere and ate evidence ending in `{` (gold set: `  if (asChild) {`).
  it("leaves a brace at the end of a string value alone", () => {
    const evidence = '{"findings": [{"title": "t", "evidence": "  if (asChild) {","code_location": {"line": 20}}]}';
    expect(dropStrayKeyFragments(evidence)).toBe(evidence);
    const pretty = '{\n  "findings": [\n    {\n      "evidence": "  if (asChild) {",\n      "title": "t"\n    }\n  ]\n}';
    expect(dropStrayKeyFragments(pretty)).toBe(pretty);
  });

  it("still extracts a fenced object unchanged", () => {
    expect(extractJson('```json\n{"findings": []}\n```')).toBe('{"findings": []}');
  });

  it("stays linear on a long value line", () => {
    const long = reply(`${'a\\\\"'.repeat(20_000)}`);
    const started = performance.now();
    expect(() => parseRawPayload(long)).not.toThrow();
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
